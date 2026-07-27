/**
 * MAINNET (Alpha) bridge deploy conductor — Phase 8. Mirrors deploy-bridge-testnet.ts's journal-first
 * structure with the mainnet deltas; the testnet conductor stays untouched (battle-proven mid-arc).
 *
 * Deltas vs testnet:
 *   - The token is NEVER deployed: Circle's canonical USDC proxy is identity-asserted and reused
 *     (`source: "circle-proxy"`). The L1 legs this conductor owns are the NuloTokenPortal (+ its
 *     one-shot initialize) and the fee-juice bridge deposit; the router/swapTarget landed earlier
 *     via DeployBridgeMainnet.s.sol (broadcast group 1) and are passed in as FUEL_ROUTER/FUEL_SWAP.
 *   - No SponsoredFPC exists on mainnet: the L2 deployer account's FIRST tx is its own deploy paid
 *     claim-in-tx from the bridged fee juice (`publicFeeJuicePayment` — the shape the fresh-selfpay
 *     canary proved); every later tx pays from the claimed public FJ balance.
 *   - The FJ-deposit claim secret is DERIVED from BRIDGE_DEPLOYER_SECRET_MAINNET (domain-separated),
 *     so a crash between the L1 deposit and the L2 claim resumes with no secret persisted; a public
 *     deposit is recipient-bound, so the derivation leaking would be grief-free anyway.
 *   - The manifest candidate is `mainnet-bridge.candidate.json` (network "mainnet", chain identity
 *     read live from the Alpha node) with the swap block pinned to the DISCOVERED canonical pools
 *     (discover-mainnet-fuel.ts winners), not seeded ones.
 *
 * Broadcast staging (explicit owner go per group):
 *   --l1-only     group 2: portal deploy + initialize + FJ deposit. Exits before any L2 tx.
 *   (no flag)     group 3: resumes the journal, deploys the L2 account (claim-in-tx) + trio +
 *                 wiring, runs read-backs, writes the candidate.
 *   --from-journal validation-only rebind, as on testnet.
 *
 * Env (packages/bridge-core/.env): MAINNET_PRIVATE_KEY, BRIDGE_DEPLOYER_SECRET_MAINNET,
 * FUEL_ROUTER, FUEL_SWAP; ETH_RPC_URL + AZTEC_NODE_URL override the defaults.
 */
import { randomInt } from "node:crypto"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"

import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { EthAddress } from "@aztec/foundation/eth-address"
import { RegistryAbi } from "@aztec/l1-artifacts"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { type Abi, createPublicClient, createWalletClient, defineChain, getContract, http, keccak256 } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { preexistingFeeJuicePayment, publicFeeJuicePayment } from "../src/fee-juice"
import { FeeJuicePortalAbi, feeJuiceDepositArgs, parseFeeJuiceDeposit, planPublicFuelDeposit } from "../src/fuel"
import { appendJournal, type CandidateManifest, readJournal, resolveResume, writeCandidateAtomic } from "./deploy-manifest"
import { resolveDeployerKeys } from "./deployer-keys"
import { requirePinnedSigner } from "./live-intent"
import { loadForkedPortalArtifact, rebuildAndVerifyPortal } from "./portal-artifact"

// ── Canonical mainnet identity (same pins as DeployBridgeMainnet.s.sol / discover-mainnet-fuel.ts) ──
const CIRCLE_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const
const TOKEN_NAME = "USD Coin"
const TOKEN_SYMBOL = "USDC"
const TOKEN_DECIMALS = 6
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90"
const V4_QUOTER = "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203"
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"

const ETH_RPC = process.env.ETH_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k"
const PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY as `0x${string}` | undefined
if (!PRIVATE_KEY) throw new Error("MAINNET_PRIVATE_KEY required (packages/bridge-core/.env)")

// Group-1 addresses (DeployBridgeMainnet.s.sol broadcast) — REQUIRED, readback-verified below.
const FUEL_ROUTER = process.env.FUEL_ROUTER as `0x${string}` | undefined
const FUEL_SWAP = process.env.FUEL_SWAP as `0x${string}` | undefined
if (!FUEL_ROUTER || !FUEL_SWAP) throw new Error("FUEL_ROUTER + FUEL_SWAP required (the group-1 deployed addresses)")

// Fee-juice bridge size: the FULL deploy sequence + FPC deploy + canaries run from this. 300 AZTEC
// is generous headroom at observed Alpha fees; the surplus stays claimable by the L2 deployer.
const FJ_BRIDGE_AMOUNT = BigInt(process.env.FJ_BRIDGE_AMOUNT ?? (300n * 10n ** 18n).toString())

const l1OnlyMode = process.argv.includes("--l1-only")
const fromJournalMode = process.argv.includes("--from-journal")

const here = dirname(fileURLToPath(import.meta.url))
const AZTEC = join(here, "..", "..", "..", "contracts", "bridge", "aztec")
const PUBLIC_DIR = join(here, "..", "..", "..", "apps", "faucet", "public")
const CANDIDATE_PATH = join(PUBLIC_DIR, "mainnet-bridge.candidate.json")
const JOURNAL_PATH = join(PUBLIC_DIR, "mainnet-bridge.journal.jsonl")

const mainnet = defineChain({
	id: 1,
	name: "ethereum",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [ETH_RPC] } },
})

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function nodeInfo(): Promise<{
	l1ChainId: number
	rollupVersion: number
	l1ContractAddresses: Record<string, `0x${string}`>
}> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const r = (await res.json()).result as {
		l1ChainId: number
		rollupVersion: number
		l1ContractAddresses: Record<string, unknown>
	}
	const pick = (v: unknown) => (typeof v === "object" && v ? (v as { value: string }).value : (v as string)) as `0x${string}`
	return {
		l1ChainId: r.l1ChainId,
		rollupVersion: r.rollupVersion,
		l1ContractAddresses: Object.fromEntries(Object.entries(r.l1ContractAddresses).map(([k, v]) => [k, pick(v)])),
	}
}

const lc = (v: unknown) => String(v).toLowerCase()
function assertSame(actual: unknown, expected: unknown, label: string): void {
	if (lc(actual) !== lc(expected)) throw new Error(`read-back FAILED: ${label} - on-chain ${lc(actual)} != expected ${lc(expected)}`)
	console.log(`  ✓ ${label}`)
}

const ERC20_META = [
	{ type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
	{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
	{
		type: "function",
		name: "allowance",
		stateMutability: "view",
		inputs: [{ type: "address" }, { type: "address" }],
		outputs: [{ type: "uint256" }],
	},
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [{ type: "address" }, { type: "uint256" }],
		outputs: [{ type: "bool" }],
	},
] as const

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── 0. Reviewed portal bytes + live network identity ────────────
	rebuildAndVerifyPortal()
	const portalArt = loadForkedPortalArtifact()
	const info = await nodeInfo()
	if (info.l1ChainId !== 1) throw new Error(`Alpha node reports l1ChainId ${info.l1ChainId} != 1 — wrong node; STOP`)
	console.log(`Alpha node: rollupVersion ${info.rollupVersion}, registry ${info.l1ContractAddresses.registryAddress}`)
	const registry = info.l1ContractAddresses.registryAddress
	const feeJuicePortal = info.l1ContractAddresses.feeJuicePortalAddress
	const feeJuiceAsset = info.l1ContractAddresses.feeJuiceAddress

	// ─── 1. Resume gate (never fresh salts over a partial landing) ───
	const recorded = resolveResume(readJournal(JOURNAL_PATH))
	if (recorded && !fromJournalMode && !l1OnlyMode && !recorded.confirmed["portal-init"]) {
		throw new Error("journal exists but portal-init never confirmed — finish the L1 group (--l1-only) first; STOP")
	}
	if (recorded && l1OnlyMode && recorded.confirmed["fj-deposit"]) {
		throw new Error("the L1 group already fully landed (fj-deposit confirmed) — run without --l1-only for the L2 group")
	}
	if (!recorded && fromJournalMode) throw new Error("--from-journal given but no journal to read.")

	const salts = recorded?.salts ?? {
		proxy: randomInt(2, 2 ** 40),
		token: randomInt(2, 2 ** 40),
		bridge: randomInt(2, 2 ** 40),
	}
	if (!recorded) appendJournal(JOURNAL_PATH, { phase: "generation", salts })

	// ─── 2. L1 signer (plan-pinned) + Circle USDC identity ───────────
	const account = privateKeyToAccount(PRIVATE_KEY)
	const pinned = requirePinnedSigner("mainnet")
	if (account.address.toLowerCase() !== pinned.toLowerCase()) {
		throw new Error(`L1 deployer ${account.address} != plan-pinned mainnet signer ${pinned} — wrong key; STOP`)
	}
	console.log("L1 deployer", account.address)
	const wallet = createWalletClient({ account, chain: mainnet, transport: http(ETH_RPC) })
	const pub = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) })

	const usdcR = getContract({ address: CIRCLE_USDC, abi: ERC20_META as unknown as Abi, client: pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const ur = usdcR.read as any
	assertSame(await ur.name(), TOKEN_NAME, "Circle USDC name")
	assertSame(await ur.symbol(), TOKEN_SYMBOL, "Circle USDC symbol")
	if (Number(await ur.decimals()) !== TOKEN_DECIMALS) throw new Error("Circle USDC decimals != 6; STOP")
	appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "usdc", address: CIRCLE_USDC })

	// ─── 3. L2 deployer identity (stable, derived) + precomputed L2 addresses ──
	const { secret, salt: acctSalt } = resolveDeployerKeys("mainnet")
	const { signingKey, secretKey } = await deriveNuloAccountKeys(secret)
	// The claim secret derives from the SAME root (fresh domain), so the L1-deposit → L2-claim arc
	// is crash-resumable without persisting anything.
	const claimSecret = Fr.fromHexString(
		`0x${createHash("sha256").update(`nulo-mainnet-fj-claim:${secret.toString()}`).digest("hex").slice(0, 62)}`,
	)

	const proxyArt = nargoArtifact("token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json")
	const bridgeArt = nargoArtifact("token_bridge/target/token_bridge_contract-TokenBridge.json")
	const instanceOf = async (art: unknown, args: unknown[], ctor: string, saltNum: number) =>
		await getContractInstanceFromInstantiationParams(
			art as never,
			{
				constructorArgs: args,
				salt: new Fr(saltNum),
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: ctor,
			} as never,
		)

	const recordedAddr = (step: string): `0x${string}` => {
		const a = recorded?.confirmed[step]
		if (!a || a === "done") throw new Error(`journal: step "${step}" never confirmed — partial landing; STOP`)
		return a as `0x${string}`
	}

	// ─── 4. GROUP 2 (L1): portal deploy + initialize + FJ deposit ────
	let portal: `0x${string}`
	if (recorded?.confirmed["portal"]) {
		portal = recordedAddr("portal")
		console.log("portal (recorded):", portal)
	} else {
		const hash = await wallet.deployContract({ abi: portalArt.abi as never, bytecode: portalArt.bytecode, args: [] })
		appendJournal(JOURNAL_PATH, { phase: "submitted", step: "portal", txHash: hash })
		const r = await pub.waitForTransactionReceipt({ hash })
		if (!r.contractAddress) throw new Error("portal: no contractAddress")
		portal = r.contractAddress
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "portal", address: portal })
		console.log("NuloTokenPortal:", portal, `(${mins()})`)
	}

	// L2 addresses are deterministic — compute them NOW so the portal can bind to the bridge
	// before any L2 tx exists (this is what makes the L1-only group self-contained).
	const proxyInstance = await instanceOf(proxyArt, [], "constructor", salts.proxy)
	const tokenInstance = await instanceOf(
		TokenContractArtifact,
		[TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxyInstance.address, AztecAddress.ZERO],
		"constructor_with_minter",
		salts.token,
	)
	const bridgeInstance = await instanceOf(bridgeArt, [proxyInstance.address, EthAddress.fromString(portal)], "constructor", salts.bridge)
	console.log("L2 (precomputed) proxy:", proxyInstance.address.toString())
	console.log("L2 (precomputed) token:", tokenInstance.address.toString())
	console.log("L2 (precomputed) bridge:", bridgeInstance.address.toString())

	if (!recorded?.confirmed["portal-init"]) {
		const portalPre = getContract({ address: portal, abi: portalArt.abi as Abi, client: pub })
		// biome-ignore lint/suspicious/noExplicitAny: viem read typing
		const preBridge = String(await (portalPre.read as any).l2Bridge())
		if (!/^0x0+$/.test(preBridge)) throw new Error(`portal already initialized (l2Bridge ${preBridge}) — reuse forbidden; STOP`)
		const portalC = getContract({ address: portal, abi: portalArt.abi as never, client: wallet as never })
		// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
		const initHash = await (portalC as any).write.initialize([registry, CIRCLE_USDC, bridgeInstance.address.toString()])
		appendJournal(JOURNAL_PATH, { phase: "submitted", step: "portal-init", txHash: initHash })
		const ir = await pub.waitForTransactionReceipt({ hash: initHash })
		if (ir.status !== "success") throw new Error("portal.initialize reverted; STOP")
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "portal-init", address: "done" })
		console.log(`portal initialized (${mins()})`)
	}

	// FJ deposit: approve (exact) + depositToAztecPublic(to = L2 deployer, derived secret).
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const manager = await ewallet.createSchnorrAccount(secretKey, acctSalt, signingKey)
	const deployer = await manager.getAccount()
	const from = deployer.getAddress()
	console.log("L2 deployer", from.toString())

	let depositRecord: { amount: bigint; leafIndex: bigint }
	if (recorded?.confirmed["fj-deposit"]) {
		const [amt, leaf] = String(recorded.confirmed["fj-deposit"]).split(":")
		depositRecord = { amount: BigInt(amt), leafIndex: BigInt(leaf) }
		console.log(`fj-deposit (recorded): ${depositRecord.amount} FJ-wei, leaf ${depositRecord.leafIndex}`)
	} else {
		// Cross-check the node-claimed portal/asset against the group-1 script's constants.
		const fjPortalR = getContract({ address: feeJuicePortal, abi: FeeJuicePortalAbi as unknown as Abi, client: pub })
		// biome-ignore lint/suspicious/noExplicitAny: viem read typing
		assertSame(await (fjPortalR.read as any).UNDERLYING(), feeJuiceAsset, "FeeJuicePortal.UNDERLYING == node fee asset")
		const assetR = getContract({ address: feeJuiceAsset, abi: ERC20_META as unknown as Abi, client: pub })
		// biome-ignore lint/suspicious/noExplicitAny: viem read typing
		const ar = assetR.read as any
		const aztecBal = (await ar.balanceOf([account.address])) as bigint
		if (aztecBal < FJ_BRIDGE_AMOUNT) throw new Error(`$AZTEC balance ${aztecBal} < FJ_BRIDGE_AMOUNT ${FJ_BRIDGE_AMOUNT}; STOP`)
		const plan = await planPublicFuelDeposit(from, FJ_BRIDGE_AMOUNT, claimSecret)
		const allowance = (await ar.allowance([account.address, feeJuicePortal])) as bigint
		if (allowance < FJ_BRIDGE_AMOUNT) {
			const approveHash = await wallet.writeContract({
				address: feeJuiceAsset,
				abi: ERC20_META,
				functionName: "approve",
				args: [feeJuicePortal, FJ_BRIDGE_AMOUNT],
			})
			const apr = await pub.waitForTransactionReceipt({ hash: approveHash })
			if (apr.status !== "success") throw new Error("$AZTEC approve reverted; STOP")
		}
		const depHash = await wallet.writeContract({
			address: feeJuicePortal,
			abi: FeeJuicePortalAbi,
			functionName: "depositToAztecPublic",
			args: feeJuiceDepositArgs(plan) as never,
		})
		appendJournal(JOURNAL_PATH, { phase: "submitted", step: "fj-deposit", txHash: depHash })
		const dr = await pub.waitForTransactionReceipt({ hash: depHash })
		if (dr.status !== "success") throw new Error("depositToAztecPublic reverted; STOP")
		const dep = parseFeeJuiceDeposit(dr.logs as never)
		depositRecord = { amount: dep.amount, leafIndex: BigInt(dep.leafIndex) }
		// The step's address slot records amount:leafIndex (the claim's resume key; secret is derived).
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "fj-deposit", address: `${dep.amount}:${dep.leafIndex}` })
		console.log(`FJ deposited: ${dep.amount} FJ-wei, leaf ${dep.leafIndex} (${mins()})`)
	}

	if (l1OnlyMode) {
		console.log(
			`\n✅ L1 group complete (${mins()}): portal ${portal} initialized → bridge ${bridgeInstance.address.toString()}, ` +
				`FJ deposit ${depositRecord.amount} wei @ leaf ${depositRecord.leafIndex}.`,
		)
		console.log("   Re-run WITHOUT --l1-only (after owner go) for the L2 group.")
		return
	}

	// ─── 5. GROUP 3 (L2): account (claim-in-tx) + trio + wiring ──────
	const node = createAztecNodeClient(NODE_URL)
	const claim = {
		claimAmount: depositRecord.amount,
		claimSecret,
		messageLeafIndex: depositRecord.leafIndex,
	}
	if (!(await node.getContract(from))) {
		console.log(`deploying L2 account paid CLAIM-IN-TX from the bridged FJ (real proof; retries until the message syncs)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		let landed = false
		for (let i = 0; i < 200 && !landed; i++) {
			try {
				await deployMethod.send({
					fee: { paymentMethod: publicFeeJuicePayment(from, claim) },
					from: "NO_FROM" as never,
					wait: { waitForStatus: TxStatus.CHECKPOINTED },
				} as never)
				landed = true
			} catch (e) {
				if (i % 10 === 0) console.log(`  account-deploy retry (${mins()}): ${e instanceof Error ? e.message.slice(0, 160) : e}`)
				await new Promise((r) => setTimeout(r, 12_000))
			}
		}
		if (!landed) throw new Error("L2 account deploy (claim-in-tx) never landed; the FJ message may not have synced — re-run to resume")
		console.log(`L2 account deployed + FJ claimed (${mins()})`)
	}

	const fee = { paymentMethod: preexistingFeeJuicePayment(from) }
	const opts = { from, fee }
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.CHECKPOINTED } }

	const deployL2 = async (
		step: string,
		label: string,
		art: unknown,
		args: unknown[],
		ctor: string,
		saltNum: number,
	): Promise<Contract> => {
		const instance = await instanceOf(art, args, ctor, saltNum)
		if (fromJournalMode) {
			assertSame(instance.address.toString(), recordedAddr(step), `${label} recompute == recorded`)
		} else if (recorded?.confirmed[step]) {
			assertSame(instance.address.toString(), recordedAddr(step), `${label} recompute == recorded (resume)`)
		} else {
			appendJournal(JOURNAL_PATH, { phase: "submitted", step, address: instance.address.toString() })
			await Contract.deploy(ewallet as never, art as never, args as never, ctor, {
				salt: new Fr(saltNum),
				universalDeploy: true,
			} as never).send({ ...opts, wait: { waitForStatus: TxStatus.CHECKPOINTED } } as never)
			appendJournal(JOURNAL_PATH, { phase: "confirmed", step, address: instance.address.toString() })
		}
		const c = await Contract.at(instance.address, art as never, ewallet as never)
		console.log(`${label}:`, c.address.toString(), `(${mins()})`)
		return c
	}

	const proxy = await deployL2("proxy", "TokenMinterProxy", proxyArt, [], "constructor", salts.proxy)
	const token = await deployL2(
		"token",
		"Token",
		TokenContractArtifact,
		[TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address, AztecAddress.ZERO],
		"constructor_with_minter",
		salts.token,
	)
	const bridge = await deployL2(
		"bridge",
		"TokenBridge",
		bridgeArt,
		[proxy.address, EthAddress.fromString(portal)],
		"constructor",
		salts.bridge,
	)
	assertSame(bridge.address.toString(), bridgeInstance.address.toString(), "deployed bridge == portal-bound address")

	if (!fromJournalMode) {
		if (!recorded?.confirmed["set-token"]) {
			await proxy.methods.set_token(token.address).send(sendOpts)
			appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "set-token", address: "done" })
		}
		if (!recorded?.confirmed["set-bridge"]) {
			await proxy.methods.set_bridge(bridge.address).send(sendOpts)
			appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "set-bridge", address: "done" })
		}
		console.log(`proxy wired (${mins()})`)
	}

	// ─── 6. Read-backs ───────────────────────────────────────────────
	console.log("read-backs:")
	const portalR = getContract({ address: portal, abi: portalArt.abi as Abi, client: pub })
	const reg = getContract({ address: registry, abi: RegistryAbi as Abi, client: pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const pr = portalR.read as any
	assertSame(await pr.registry(), registry, "portal.registry")
	assertSame(await pr.underlying(), CIRCLE_USDC, "portal.underlying == Circle USDC")
	assertSame(await pr.l2Bridge(), bridge.address.toString(), "portal.l2Bridge")
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	assertSame(await pr.rollup(), await (reg.read as any).getCanonicalRollup(), "portal.rollup == registry canonical")
	if ((await pr.rollupVersion()) !== BigInt(info.rollupVersion)) throw new Error("read-back FAILED: portal.rollupVersion != node")
	const onchain = await pub.getCode({ address: portal })
	if (!onchain) throw new Error("read-back FAILED: portal has no deployed code")
	assertSame(keccak256(onchain), portalArt.runtimeCodeHash, "portal runtime code hash == pin")

	// Router wiring (group 1): swapTarget bound + the F-004 witness shape present.
	const routerR = getContract({
		address: FUEL_ROUTER,
		abi: [
			{ type: "function", name: "swapTarget", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
			{ type: "function", name: "BRIDGE_WITNESS_TYPE_STRING", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
		] as Abi,
		client: pub,
	})
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const rr = routerR.read as any
	assertSame(await rr.swapTarget(), FUEL_SWAP, "router.swapTarget == FUEL_SWAP")
	if (!((await rr.BRIDGE_WITNESS_TYPE_STRING()) as string).includes("swapTarget"))
		throw new Error("router witness shape lacks swapTarget; STOP")

	// ─── 7. Candidate manifest (never the live file) ─────────────────
	const manifest: CandidateManifest = {
		network: "mainnet",
		l1ChainId: info.l1ChainId,
		walletChainId: (info.l1ChainId ^ info.rollupVersion) >>> 0,
		l1: {
			usdc: CIRCLE_USDC.toLowerCase(),
			portal,
			portalSource: "forked-v1",
			privateClaimMode: "salt-v2",
			token: { name: TOKEN_NAME, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS, source: "circle-proxy" },
			fuel: {
				core: {
					router: FUEL_ROUTER.toLowerCase(),
					permit2: PERMIT2.toLowerCase(),
					swapTarget: FUEL_SWAP.toLowerCase(),
					swapTargetContract: "UniswapFuelSwap",
					feeJuicePortal: feeJuicePortal.toLowerCase(),
				},
				// The DISCOVERED canonical route (discover-mainnet-fuel.ts winners) — mainnet rides
				// existing liquidity, never seeds. minFuelFj is a conservative pre-canary default;
				// the fueled canary recalibrates it before promote.
				swap: {
					poolManager: POOL_MANAGER.toLowerCase(),
					quoter: V4_QUOTER.toLowerCase(),
					weth: WETH.toLowerCase(),
					feeJuice: feeJuiceAsset.toLowerCase(),
					pools: { tokenWeth: { fee: 500, tickSpacing: 10 }, ethFj: { fee: 10000, tickSpacing: 200 } },
					slippageBps: 300,
					minFuelFj: String(process.env.MIN_FUEL_FJ ?? (30n * 10n ** 18n).toString()),
				},
			},
			// No FeeAssetHandler on mainnet (BYO-$AZTEC) — the schema keys the mint affordance off its absence.
			feeJuice: {
				portal: feeJuicePortal.toLowerCase(),
				asset: feeJuiceAsset.toLowerCase(),
				minFj: String(process.env.FUEL_MIN_FJ ?? (16n * 10n ** 18n).toString()),
			},
		},
		l2: {
			proxy: { address: proxy.address.toString(), salt: salts.proxy, constructorArtifact: "constructor", constructorArgs: [] },
			token: {
				address: token.address.toString(),
				salt: salts.token,
				constructorArtifact: "constructor_with_minter",
				constructorArgs: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address.toString(), AztecAddress.ZERO.toString()],
			},
			bridge: {
				address: bridge.address.toString(),
				salt: salts.bridge,
				constructorArtifact: "constructor",
				constructorArgs: [proxy.address.toString(), portal],
			},
		},
	}
	writeCandidateAtomic(CANDIDATE_PATH, manifest)
	console.log(`\n✅ candidate written to apps/faucet/public/mainnet-bridge.candidate.json in ${mins()}.`)
	console.log("   Next: PrivateFPC deploy + dust canary + smoke, THEN promote to mainnet-bridge.json.")

	if (process.env.ETHERSCAN_API_KEY) {
		console.log("\nVerifying the candidate's L1 sources on Etherscan…")
		const v = spawnSync("bun", [join(here, "verify-l1.ts"), "--config", CANDIDATE_PATH], { stdio: "inherit" })
		if (v.status !== 0) console.log("⚠ verification failed — retry with `bun run verify:l1 --config <candidate>`.")
	}
	console.log(JSON.stringify(manifest, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
