/**
 * PERSISTENT testnet bridge deploy for the faucet's Bridge tab - the SECURITY-FORK generation.
 *
 * Deploys the bridge's OWN set - L1: MintableERC20 USDC + the F-001 fork NuloTokenPortal (deployed
 * uninitialized from committed reviewed bytes, then `initialize`d once); L2: token_minter_proxy +
 * Token(minter=proxy) + token_bridge(proxy, portal) with per-generation random salts. It wires them
 * (set_token + the one-time set_bridge), runs expanded on-chain read-backs, and writes a CANDIDATE
 * manifest (`testnet-bridge.candidate.json`) - never the live `testnet-bridge.json`. Promotion of the
 * candidate to live is the deliberate cutover step (after smoke).
 *
 * Durability (per codex 019ecbee): a write-ahead journal records every step submitted (txHash, before
 * the receipt) then confirmed (address). A one-shot cutover must not start fresh salts over a partial
 * landing, so if a journal already exists this refuses to run unless `--from-journal` is passed:
 *   - clean start (no journal): full deploy + journal + candidate.
 *   - `--from-journal`: validate a FULLY-landed recorded generation (read-backs) and write the
 *     candidate from it. A partial landing HARD-STOPS - this never continues a partial deploy with a
 *     new L2 account (the proxy owner is the original deployer, so a fresh account can't wire it).
 *
 * Run ONCE (real proofs -> ~8 min; L1 addresses are non-deterministic). From packages/bridge-core:
 * `bun run scripts/deploy-bridge-testnet.ts`. Needs PRIVATE_KEY + SEPOLIA_RPC_URL in
 * packages/bridge-core/.env; AZTEC_NODE_URL defaults to the public testnet RPC.
 */
import { randomInt } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { EthAddress } from "@aztec/foundation/eth-address"
import { RegistryAbi } from "@aztec/l1-artifacts"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { deriveSigningKey } from "@aztec/stdlib/keys"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { TokenContractArtifact } from "@alejoamiras/aztec-standards/dist/src/artifacts/Token.js"
import { type Abi, createPublicClient, createWalletClient, defineChain, getContract, http, keccak256 } from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { appendJournal, type CandidateManifest, readJournal, resolveResume, writeCandidateAtomic } from "./deploy-manifest"
import { loadForkedPortalArtifact, rebuildAndVerifyPortal } from "./portal-artifact"

// The bridged pair's identity - ONE source for both chains; the deploy asserts L1==L2 below.
const TOKEN_NAME = "Aztec Nulo"
const TOKEN_SYMBOL = "AZLO"
const TOKEN_DECIMALS = 18

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
const MNEMONIC = process.env.MNEMONIC
if (!PRIVATE_KEY && !MNEMONIC) throw new Error("PRIVATE_KEY or MNEMONIC required (packages/bridge-core/.env)")

const fromJournalMode = process.argv.includes("--from-journal")

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, "..", "..", "..", "contracts", "bridge", "evm", "out")
const AZTEC = join(here, "..", "..", "..", "contracts", "bridge", "aztec")
const PUBLIC_DIR = join(here, "..", "..", "..", "apps", "faucet", "public")
const LIVE_PATH = join(PUBLIC_DIR, "testnet-bridge.json")
const CANDIDATE_PATH = join(PUBLIC_DIR, "testnet-bridge.candidate.json")
const JOURNAL_PATH = join(PUBLIC_DIR, "testnet-bridge.journal.jsonl")

const sepolia = defineChain({
	id: 11155111,
	name: "sepolia",
	nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
	rpcUrls: { default: { http: [SEPOLIA_RPC] } },
})

function evmArtifact(name: string): { abi: unknown[]; bytecode: `0x${string}` } {
	const j = JSON.parse(readFileSync(join(OUT, `${name}.sol`, `${name}.json`), "utf8"))
	return { abi: j.abi, bytecode: j.bytecode.object as `0x${string}` }
}

function nargoArtifact(rel: string) {
	return loadContractArtifact(JSON.parse(readFileSync(join(AZTEC, rel), "utf8")))
}

async function nodeL1Addresses(): Promise<Record<string, `0x${string}`>> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const a = (await res.json()).result.l1ContractAddresses as Record<string, unknown>
	const pick = (v: unknown) => (typeof v === "object" && v ? (v as { value: string }).value : (v as string)) as `0x${string}`
	return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, pick(v)]))
}

async function nodeRegistry(): Promise<`0x${string}`> {
	return (await nodeL1Addresses()).registryAddress
}

const lc = (v: unknown) => String(v).toLowerCase()
function assertSame(actual: unknown, expected: unknown, label: string): void {
	if (lc(actual) !== lc(expected)) throw new Error(`read-back FAILED: ${label} - on-chain ${lc(actual)} != expected ${lc(expected)}`)
	console.log(`  ✓ ${label}`)
}

async function main() {
	const t0 = Date.now()
	const mins = () => `${((Date.now() - t0) / 60000).toFixed(1)}m`

	// ─── 0. Reviewed bytes + drift alarm ─────────────────────────────
	// Rebuild the fork from source and assert it still matches the reviewed pins, then deploy the
	// COMMITTED bytes (exact reviewed bytes, not "whatever builds today").
	rebuildAndVerifyPortal()
	const portalArt = loadForkedPortalArtifact()

	// ─── 1. Resume gate (never fresh salts over a partial landing) ───
	const recorded = resolveResume(readJournal(JOURNAL_PATH))
	if (recorded && !fromJournalMode) {
		throw new Error(
			`a prior generation journal exists at ${JOURNAL_PATH}. Pass --from-journal to validate + write the ` +
				"candidate from it, or archive the journal for a clean start. This never starts fresh salts over a partial landing.",
		)
	}
	if (!recorded && fromJournalMode) throw new Error("--from-journal given but no generation journal to read.")

	const salts = recorded?.salts ?? {
		proxy: randomInt(2, 2 ** 40),
		token: randomInt(2, 2 ** 40),
		bridge: randomInt(2, 2 ** 40),
	}

	// ─── L1 (Sepolia) ────────────────────────────────────────────────
	const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : mnemonicToAccount(MNEMONIC as string)
	console.log("L1 deployer", account.address)
	const wallet = createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC) })
	const pub = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) })
	const registry = await nodeRegistry()

	// In --from-journal mode we never send L1/L2 deploys; we reuse the recorded addresses and only
	// re-run the read-backs before writing the candidate. A missing step => partial landing => stop.
	const recordedAddr = (step: string): `0x${string}` => {
		const a = recorded?.confirmed[step]
		if (!a || a === "done") {
			throw new Error(
				`--from-journal: step "${step}" never confirmed - partial landing. Finish manually with the original deployer or archive for a clean start.`,
			)
		}
		return a as `0x${string}`
	}

	const deployEvm = async (
		step: string,
		name: string,
		abi: unknown,
		bytecode: `0x${string}`,
		args: unknown[],
	): Promise<`0x${string}`> => {
		if (fromJournalMode) return recordedAddr(step)
		const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never })
		appendJournal(JOURNAL_PATH, { phase: "submitted", step, txHash: hash })
		const r = await pub.waitForTransactionReceipt({ hash })
		if (!r.contractAddress) throw new Error(`${name}: no contractAddress`)
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step, address: r.contractAddress })
		console.log(`${name}:`, r.contractAddress, `(${mins()})`)
		return r.contractAddress
	}

	if (!recorded) appendJournal(JOURNAL_PATH, { phase: "generation", salts })

	const usdcArt = evmArtifact("MintableERC20")
	const usdc = await deployEvm("usdc", "MintableERC20", usdcArt.abi, usdcArt.bytecode, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, 1000n])
	const portal = await deployEvm("portal", "NuloTokenPortal", portalArt.abi, portalArt.bytecode, [])

	// ─── L2 (testnet aztec.js - REAL proofs) ─────────────────────────
	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const secret = Fr.random()
	const manager = await ewallet.createSchnorrAccount(secret, Fr.random(), deriveSigningKey(secret))
	const deployer = await manager.getAccount()
	const from = deployer.getAddress()
	console.log("L2 deployer", from.toString())

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const fee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	const opts = { from, fee }
	// V5 finalization ladder is PROPOSED → CHECKPOINTED → PROVEN → FINALIZED. A merely-PROPOSED
	// contract is not yet served for public simulation, so a dependent step (the proxy wiring below, or
	// a later deploy referencing an earlier one) sees "Contract not deployed". Wait for CHECKPOINTED —
	// the first state the node publicly simulates against. PROPOSED sufficed on V4 (no checkpoint stage).
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.CHECKPOINTED } }

	if (!(await node.getContract(from))) {
		console.log(`deploying L2 account (real proof, ~minutes)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		// NO_FROM: first account deploy can't route through its own (not-yet-deployed) entrypoint.
		await deployMethod.send({ fee, from: "NO_FROM" as never } as never)
		console.log(`L2 account deployed (${mins()})`)
	}

	// Deploy (or, in --from-journal mode, re-bind) a universal-deploy L2 contract. The deterministic
	// address is recomputed from the recorded salt/args; a resume mismatch is a hard stop.
	const deployL2 = async (
		step: string,
		label: string,
		art: unknown,
		args: unknown[],
		ctor: string,
		saltNum: number,
	): Promise<Contract> => {
		const salt = new Fr(saltNum)
		const instance = await getContractInstanceFromInstantiationParams(
			art as never,
			{
				constructorArgs: args,
				salt,
				publicKeys: PublicKeys.default(),
				deployer: AztecAddress.ZERO,
				constructorArtifact: ctor,
			} as never,
		)
		if (fromJournalMode) {
			assertSame(instance.address.toString(), recordedAddr(step), `${label} recompute == recorded`)
		} else {
			// The L2 address is deterministic (salt + args + universal deploy), so journal it BEFORE the
			// send - that is the durable recovery key (DeploySentTx exposes no pre-wait txHash accessor;
			// `.send({ wait })` is the proven inclusion path, mirroring deposit-testnet.ts).
			appendJournal(JOURNAL_PATH, { phase: "submitted", step, address: instance.address.toString() })
			// 5.0: salt + universalDeploy are construction-time DeployInstantiationOptions (the deployer is
			// locked at construction), NOT send options. Passing them to .send() is silently ignored, so the
			// deploy lands at the wallet-as-deployer / default-salt address — DIFFERENT from the deployer=ZERO
			// instance computed above — and the wiring + read-backs then target a never-deployed address.
			// Mirrors the faucet deploy (faucet/scripts/deploy.ts), which gets this right on V5.
			await Contract.deploy(ewallet as never, art as never, args as never, ctor, {
				salt,
				universalDeploy: true,
			} as never).send({
				...opts,
				wait: { waitForStatus: TxStatus.CHECKPOINTED },
			} as never)
			appendJournal(JOURNAL_PATH, { phase: "confirmed", step, address: instance.address.toString() })
		}
		const c = await Contract.at(instance.address, art as never, ewallet as never)
		console.log(`${label}:`, c.address.toString(), `(${mins()})`)
		return c
	}

	const proxy = await deployL2(
		"proxy",
		"TokenMinterProxy",
		nargoArtifact("token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"),
		[],
		"constructor",
		salts.proxy,
	)
	const token = await deployL2(
		"token",
		"Token",
		TokenContractArtifact,
		[TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address],
		"constructor_with_minter",
		salts.token,
	)
	const bridge = await deployL2(
		"bridge",
		"TokenBridge",
		nargoArtifact("token_bridge/target/token_bridge_contract-TokenBridge.json"),
		[proxy.address, EthAddress.fromString(portal)],
		"constructor",
		salts.bridge,
	)

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

		const portalC = getContract({ address: portal, abi: portalArt.abi as never, client: wallet as never })
		// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
		const initHash = await (portalC as any).write.initialize([registry, usdc, bridge.address.toString()])
		appendJournal(JOURNAL_PATH, { phase: "submitted", step: "portal-init", txHash: initHash })
		await pub.waitForTransactionReceipt({ hash: initHash })
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "portal-init", address: "done" })
		console.log(`portal initialized (${mins()})`)
	} else if (!recorded?.confirmed["portal-init"]) {
		throw new Error("--from-journal: portal-init never confirmed - partial landing. Finish manually or archive for a clean start.")
	}

	// ─── Read-backs (codex 019ecbee #6): abort on any mismatch ───────
	console.log("read-backs:")
	const portalR = getContract({ address: portal, abi: portalArt.abi as Abi, client: pub })
	const reg = getContract({ address: registry, abi: RegistryAbi as Abi, client: pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const pr = portalR.read as any
	assertSame(await pr.registry(), registry, "portal.registry")
	assertSame(await pr.underlying(), usdc, "portal.underlying")
	assertSame(await pr.l2Bridge(), bridge.address.toString(), "portal.l2Bridge")
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	assertSame(await pr.rollup(), await (reg.read as any).getCanonicalRollup(), "portal.rollup == registry canonical")
	if ((await pr.rollupVersion()) <= 0n) throw new Error("read-back FAILED: portal.rollupVersion is 0")
	const onchain = await pub.getCode({ address: portal })
	if (!onchain) throw new Error("read-back FAILED: portal has no deployed code")
	assertSame(keccak256(onchain), portalArt.runtimeCodeHash, "portal runtime code hash == pin")

	// L2 read-backs are BEST-EFFORT (log, never abort): aztec.js view-simulate returns `{ result }` and
	// the decoded shape varies (AztecAddress / Fr / bigint), so a decode quirk must not false-abort a
	// correct deploy. The deposit->claim smoke is the definitive L2 gate - it mints via the proxy and
	// claims via the bridge config end to end - and promotion is gated on it.
	const l2Check = async (label: string, p: Promise<unknown>, expected: string) => {
		try {
			const v = await p
			const r = v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v
			const got = String(typeof r === "bigint" ? new Fr(r) : r)
			console.log(`  ${lc(got) === lc(expected) ? "✓" : "⚠"} ${label}: ${lc(got).slice(0, 16)}… (want ${lc(expected).slice(0, 16)}…)`)
		} catch (e) {
			console.log(`  ⚠ ${label} undecodable: ${(e as Error).message}`)
		}
	}
	await l2Check("proxy.get_token", proxy.methods.get_token().simulate({ from }), token.address.toString())
	await l2Check("proxy.get_bridge", proxy.methods.get_bridge().simulate({ from }), bridge.address.toString())

	// ─── Fuel arc: carry the POOL config forward, but the router/swap must be the F-004/F-006 build ──
	// The router/swap addresses are bridge-independent, BUT they carry the security fixes (F-004 binds
	// swapTarget into the Permit2 witness; F-006 the non-zero minOutput). A pre-B2 router would reject
	// the wallet's signature (Permit2 InvalidSigner) AND leave F-004/F-006 unshipped. So a cutover
	// deploys fresh fuel (DeployFuelLive) and passes FUEL_ROUTER + FUEL_SWAP; the pool config (pools,
	// quoter, slippage, …) carries forward from the live manifest. Pre-B2 fuel is a hard abort.
	const prior = existsSync(LIVE_PATH) ? JSON.parse(readFileSync(LIVE_PATH, "utf8")) : null
	const priorFuel = prior?.l1?.fuel as Record<string, unknown> | undefined
	const l1a = await nodeL1Addresses()
	const fuel = priorFuel
		? {
				...priorFuel,
				// The FeeJuicePortal is ROLLUP-COUPLED — refresh it from the node so a carried fuel
				// block never re-promotes the previous rollup's (dead) portal (codex post-impl MED).
				feeJuicePortal: l1a.feeJuicePortalAddress.toLowerCase(),
				...(process.env.FUEL_ROUTER ? { router: process.env.FUEL_ROUTER.toLowerCase() } : {}),
				...(process.env.FUEL_SWAP ? { swapTarget: process.env.FUEL_SWAP.toLowerCase() } : {}),
			}
		: undefined

	// ─── Direct-Fuel config (`l1.feeJuice`): the portal/asset/handler are ROLLUP-COUPLED (a network
	// reset re-points them), so they come fresh from the node — never carried from the prior manifest.
	// Only `minFj` (empirically calibrated, network-independent) carries forward, env-overridable.
	// Omitting this block from a promotion would silently disable the faucet's Fuel tab.
	const priorFeeJuice = prior?.l1?.feeJuice as Record<string, unknown> | undefined
	const feeJuice = {
		portal: l1a.feeJuicePortalAddress.toLowerCase(),
		asset: l1a.feeJuiceAddress.toLowerCase(),
		feeAssetHandler: l1a.feeAssetHandlerAddress.toLowerCase(),
		minFj: String(process.env.FUEL_MIN_FJ ?? priorFeeJuice?.minFj ?? "16000000000000000000"),
	}
	if (fuel?.router && fuel?.swapTarget) {
		const router = getContract({
			address: fuel.router as `0x${string}`,
			abi: [
				{ type: "function", name: "swapTarget", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
				{
					type: "function",
					name: "BRIDGE_WITNESS_TYPE_STRING",
					stateMutability: "view",
					inputs: [],
					outputs: [{ type: "string" }],
				},
			] as Abi,
			client: pub,
		})
		// biome-ignore lint/suspicious/noExplicitAny: viem read typing
		const rr = router.read as any
		assertSame(await rr.swapTarget(), fuel.swapTarget, "router.swapTarget")
		const witnessType = (await rr.BRIDGE_WITNESS_TYPE_STRING()) as string
		if (!witnessType.includes("swapTarget")) {
			throw new Error(
				"fuel router is PRE-B2 (witness type string lacks swapTarget) - F-004/F-006 not shipped. Deploy fresh fuel " +
					"(contracts/bridge/evm DeployFuelLive.s.sol, no-reuse) and pass FUEL_ROUTER + FUEL_SWAP.",
			)
		}
	}

	// ─── Write the CANDIDATE (never the live file) ───────────────────
	const manifest: CandidateManifest = {
		network: "testnet",
		l1: {
			usdc,
			portal,
			portalSource: "forked-v1",
			token: { name: TOKEN_NAME, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS, maxWholePerTx: 1000 },
			...(fuel ? { fuel } : {}),
			feeJuice,
		},
		l2: {
			proxy: { address: proxy.address.toString(), salt: salts.proxy, constructorArtifact: "constructor", constructorArgs: [] },
			token: {
				address: token.address.toString(),
				salt: salts.token,
				constructorArtifact: "constructor_with_minter",
				constructorArgs: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address.toString()],
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
	console.log(`\n✅ candidate written to apps/faucet/public/testnet-bridge.candidate.json in ${mins()}.`)
	console.log("   Promote it to testnet-bridge.json at cutover, AFTER the candidate passes smoke.")

	if (process.env.ETHERSCAN_API_KEY) {
		console.log("\nETHERSCAN_API_KEY set — verifying the candidate's L1 sources on Etherscan…")
		const v = spawnSync("bun", [join(here, "verify-l1.ts"), "--config", CANDIDATE_PATH], { stdio: "inherit" })
		if (v.status !== 0) console.log("⚠ verification failed — retry with `bun run verify:l1 --config <candidate>`.")
	} else {
		console.log("\nETHERSCAN_API_KEY not set — run `bun run verify:l1 --config <candidate>` to verify L1 sources.")
	}
	console.log(JSON.stringify(manifest, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
