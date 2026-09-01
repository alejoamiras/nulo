/**
 * MAINNET (Alpha) bridge deploy conductor. Mirrors deploy-bridge-testnet.ts's journal-first
 * structure; the two stay SEPARATE conductors on purpose — the network policies differ in kind
 * (token model, fee bootstrap, broadcast staging), so they share mechanisms, never orchestration.
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
import { createHash, randomInt } from "node:crypto"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { EthAddress } from "@aztec/foundation/eth-address"
import { RegistryAbi } from "@aztec/l1-artifacts"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { type Abi, getContract } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { preexistingFeeJuicePayment, publicFeeJuicePayment } from "../src/fee-juice"
import { FeeJuicePortalAbi, feeJuiceDepositArgs, parseFeeJuiceDeposit, planPublicFuelDeposit } from "../src/fuel"
import {
	appendJournal,
	type CandidateManifest,
	type GenerationState,
	journaledEvmDeploy,
	readJournal,
	resolveResume,
	writeCandidateAtomic,
} from "./deploy-manifest"
import { requirePinnedSigner } from "./live-intent"
import { assertRuntimeMatchesTemplate, loadForkedPortalArtifact, rebuildAndVerifyPortal } from "./portal-artifact"
import { assertPortalInitializerPinned, assertRouterWitnessShape, assertSame, ERC20_MIN_ABI } from "./script-l1"
import { deployerSchnorrAccount, universalDeployInstance } from "./script-l2"
import { createL1Clients, createL2Wallet, createNode, mainnetChain, stopwatch } from "./script-bootstrap"

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

// Required env, asserted once at module init — the helper keeps the narrowed hex type inside main().
function requiredHex(name: string, hint: string): `0x${string}` {
	const v = process.env[name]
	if (!v) throw new Error(`${name} required (${hint})`)
	return v as `0x${string}`
}
const PRIVATE_KEY = requiredHex("MAINNET_PRIVATE_KEY", "packages/bridge-core/.env")
// Group-1 addresses (DeployBridgeMainnet.s.sol broadcast) — readback-verified below.
const FUEL_ROUTER = requiredHex("FUEL_ROUTER", "the group-1 deployed router")
const FUEL_SWAP = requiredHex("FUEL_SWAP", "the group-1 deployed swap target")

// Fee-juice bridge size: the FULL deploy sequence + FPC deploy + canaries run from this. 300 AZTEC
// is generous headroom at observed Alpha fees; the surplus stays claimable by the L2 deployer.
const FJ_BRIDGE_AMOUNT = BigInt(process.env.FJ_BRIDGE_AMOUNT ?? (300n * 10n ** 18n).toString())

const l1OnlyMode = process.argv.includes("--l1-only")
const fromJournalMode = process.argv.includes("--from-journal")

const here = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(here, "..", "..", "..", "apps", "tools", "public")
const CANDIDATE_PATH = join(PUBLIC_DIR, "mainnet-bridge.candidate.json")
const JOURNAL_PATH = join(PUBLIC_DIR, "mainnet-bridge.journal.jsonl")

const mainnet = mainnetChain(ETH_RPC)

interface NodeInfo {
	l1ChainId: number
	rollupVersion: number
	l1ContractAddresses: Record<string, `0x${string}`>
}

async function nodeInfo(): Promise<NodeInfo> {
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

interface MainnetCtx {
	account: { address: `0x${string}` }
	wallet: ReturnType<typeof createL1Clients>["wallet"]
	pub: ReturnType<typeof createL1Clients>["pub"]
	recorded: GenerationState | null
	salts: { proxy: number; token: number; bridge: number }
	mins: () => string
}

function recordedAddr(recorded: GenerationState | null, step: string): `0x${string}` {
	const a = recorded?.confirmed[step]
	if (!a || a === "done") throw new Error(`journal: step "${step}" never confirmed — partial landing; STOP`)
	return a as `0x${string}`
}

/** Resume gate for the staged broadcast groups (never fresh salts over a partial landing). */
function resolveGeneration(): { recorded: GenerationState | null; salts: MainnetCtx["salts"] } {
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
	return { recorded, salts }
}

/** The reused canonical Circle proxy must BE the expected token — never a lookalike. */
async function assertCircleUsdc(ctx: MainnetCtx): Promise<void> {
	const usdcR = getContract({ address: CIRCLE_USDC, abi: ERC20_MIN_ABI as unknown as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const ur = usdcR.read as any
	assertSame(await ur.name(), TOKEN_NAME, "Circle USDC name")
	assertSame(await ur.symbol(), TOKEN_SYMBOL, "Circle USDC symbol")
	if (Number(await ur.decimals()) !== TOKEN_DECIMALS) throw new Error("Circle USDC decimals != 6; STOP")
	appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "usdc", address: CIRCLE_USDC })
}

async function landPortal(ctx: MainnetCtx, portalArt: ReturnType<typeof loadForkedPortalArtifact>): Promise<`0x${string}`> {
	if (ctx.recorded?.confirmed["portal"]) {
		const portal = recordedAddr(ctx.recorded, "portal")
		console.log("portal (recorded):", portal)
		return portal
	}
	return await journaledEvmDeploy(
		{ wallet: ctx.wallet, pub: ctx.pub },
		JOURNAL_PATH,
		"portal",
		"NuloTokenPortal",
		portalArt,
		[],
		(addr) => console.log("NuloTokenPortal:", addr, `(${ctx.mins()})`),
	)
}

/** The portal's one-shot initialize, bound to the PRECOMPUTED bridge address — what makes
 *  the L1-only group self-contained. F-001: the initialize is guarded to the EOA that
 *  DEPLOYED the portal, so a resume must broadcast with the SAME key. */
async function initializePortalOnce(
	ctx: MainnetCtx,
	d: { portal: `0x${string}`; portalArt: ReturnType<typeof loadForkedPortalArtifact>; registry: `0x${string}`; bridgeAddress: string },
): Promise<void> {
	if (ctx.recorded?.confirmed["portal-init"]) return
	const portalPre = getContract({ address: d.portal, abi: d.portalArt.abi as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const preBridge = String(await (portalPre.read as any).l2Bridge())
	if (!/^0x0+$/.test(preBridge)) throw new Error(`portal already initialized (l2Bridge ${preBridge}) — reuse forbidden; STOP`)
	await assertPortalInitializerPinned(ctx.pub, d.portal, d.portalArt.abi as Abi, ctx.account.address)
	const portalC = getContract({ address: d.portal, abi: d.portalArt.abi as never, client: ctx.wallet as never })
	// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
	const initHash = await (portalC as any).write.initialize([d.registry, CIRCLE_USDC, d.bridgeAddress])
	appendJournal(JOURNAL_PATH, { phase: "submitted", step: "portal-init", txHash: initHash })
	const ir = await ctx.pub.waitForTransactionReceipt({ hash: initHash })
	if (ir.status !== "success") throw new Error("portal.initialize reverted; STOP")
	appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "portal-init", address: "done" })
	console.log(`portal initialized (${ctx.mins()})`)
}

/** GROUP 2 (L1) part 2: the FJ deposit — approve (exact) + depositToAztecPublic(to = L2
 *  deployer, derived secret). The step's address slot records amount:leafIndex (the claim's
 *  resume key; the secret is derived, never persisted). */
async function depositFeeJuice(
	ctx: MainnetCtx,
	d: { feeJuicePortal: `0x${string}`; feeJuiceAsset: `0x${string}`; from: AztecAddress; claimSecret: Fr },
): Promise<{ amount: bigint; leafIndex: bigint }> {
	if (ctx.recorded?.confirmed["fj-deposit"]) {
		const [amt, leaf] = String(ctx.recorded.confirmed["fj-deposit"]).split(":")
		const record = { amount: BigInt(amt), leafIndex: BigInt(leaf) }
		console.log(`fj-deposit (recorded): ${record.amount} FJ-wei, leaf ${record.leafIndex}`)
		return record
	}
	// Cross-check the node-claimed portal/asset against the group-1 script's constants.
	const fjPortalR = getContract({ address: d.feeJuicePortal, abi: FeeJuicePortalAbi as unknown as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	assertSame(await (fjPortalR.read as any).UNDERLYING(), d.feeJuiceAsset, "FeeJuicePortal.UNDERLYING == node fee asset")
	const assetR = getContract({ address: d.feeJuiceAsset, abi: ERC20_MIN_ABI as unknown as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const ar = assetR.read as any
	const aztecBal = (await ar.balanceOf([ctx.account.address])) as bigint
	if (aztecBal < FJ_BRIDGE_AMOUNT) throw new Error(`$AZTEC balance ${aztecBal} < FJ_BRIDGE_AMOUNT ${FJ_BRIDGE_AMOUNT}; STOP`)
	const plan = await planPublicFuelDeposit(d.from, FJ_BRIDGE_AMOUNT, d.claimSecret)
	const allowance = (await ar.allowance([ctx.account.address, d.feeJuicePortal])) as bigint
	if (allowance < FJ_BRIDGE_AMOUNT) {
		const approveHash = await ctx.wallet.writeContract({
			address: d.feeJuiceAsset,
			abi: ERC20_MIN_ABI,
			functionName: "approve",
			args: [d.feeJuicePortal, FJ_BRIDGE_AMOUNT],
		})
		const apr = await ctx.pub.waitForTransactionReceipt({ hash: approveHash })
		if (apr.status !== "success") throw new Error("$AZTEC approve reverted; STOP")
	}
	const depHash = await ctx.wallet.writeContract({
		address: d.feeJuicePortal,
		abi: FeeJuicePortalAbi,
		functionName: "depositToAztecPublic",
		args: feeJuiceDepositArgs(plan) as never,
	})
	appendJournal(JOURNAL_PATH, { phase: "submitted", step: "fj-deposit", txHash: depHash })
	const dr = await ctx.pub.waitForTransactionReceipt({ hash: depHash })
	if (dr.status !== "success") throw new Error("depositToAztecPublic reverted; STOP")
	const dep = parseFeeJuiceDeposit(dr.logs as never)
	appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "fj-deposit", address: `${dep.amount}:${dep.leafIndex}` })
	console.log(`FJ deposited: ${dep.amount} FJ-wei, leaf ${dep.leafIndex} (${ctx.mins()})`)
	return { amount: dep.amount, leafIndex: BigInt(dep.leafIndex) }
}

/** GROUP 3 (L2) part 1: the deployer account's FIRST tx is its own deploy paid CLAIM-IN-TX
 *  from the bridged FJ (no SponsoredFPC on mainnet); retries until the message syncs. */
async function deployAccountClaimInTx(
	ctx: MainnetCtx,
	d: {
		node: ReturnType<typeof createNode>
		manager: { getDeployMethod: () => Promise<{ send: (o: never) => Promise<unknown> }> }
		from: AztecAddress
		claim: { claimAmount: bigint; claimSecret: Fr; messageLeafIndex: bigint }
	},
): Promise<void> {
	if (await d.node.getContract(d.from)) return
	console.log(`deploying L2 account paid CLAIM-IN-TX from the bridged FJ (real proof; retries until the message syncs)… (${ctx.mins()})`)
	const deployMethod = await d.manager.getDeployMethod()
	let landed = false
	for (let i = 0; i < 200 && !landed; i++) {
		try {
			await deployMethod.send({
				fee: { paymentMethod: publicFeeJuicePayment(d.from, d.claim) },
				from: "NO_FROM" as never,
				wait: { waitForStatus: TxStatus.CHECKPOINTED },
			} as never)
			landed = true
		} catch (e) {
			if (i % 10 === 0) console.log(`  account-deploy retry (${ctx.mins()}): ${e instanceof Error ? e.message.slice(0, 160) : e}`)
			await new Promise((r) => setTimeout(r, 12_000))
		}
	}
	if (!landed) throw new Error("L2 account deploy (claim-in-tx) never landed; the FJ message may not have synced — re-run to resume")
	console.log(`L2 account deployed + FJ claimed (${ctx.mins()})`)
}

/** Deploy (or re-bind) a universal-deploy L2 contract with mainnet's THREE-way resume: a
 *  --from-journal rebind, a group-resume re-bind of an already-confirmed step, or a fresh
 *  journaled deploy. */
async function deployL2Contract(
	ctx: MainnetCtx,
	ewallet: unknown,
	opts: unknown,
	p: { step: string; label: string; art: unknown; args: unknown[]; ctor: string; saltNum: number },
): Promise<Contract> {
	const instance = await universalDeployInstance(p.art, p.args, p.ctor, p.saltNum)
	if (fromJournalMode) {
		assertSame(instance.address.toString(), recordedAddr(ctx.recorded, p.step), `${p.label} recompute == recorded`)
	} else if (ctx.recorded?.confirmed[p.step]) {
		assertSame(instance.address.toString(), recordedAddr(ctx.recorded, p.step), `${p.label} recompute == recorded (resume)`)
	} else {
		// The L2 address is deterministic (salt + args + universal deploy), so journal it BEFORE
		// the send — that is the durable recovery key (DeploySentTx exposes no pre-wait txHash
		// accessor; `.send({ wait })` is the proven inclusion path).
		appendJournal(JOURNAL_PATH, { phase: "submitted", step: p.step, address: instance.address.toString() })
		await Contract.deploy(ewallet as never, p.art as never, p.args as never, p.ctor, {
			salt: new Fr(p.saltNum),
			universalDeploy: true,
		} as never).send({ ...(opts as object), wait: { waitForStatus: TxStatus.CHECKPOINTED } } as never)
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: p.step, address: instance.address.toString() })
	}
	const c = await Contract.at(instance.address, p.art as never, ewallet as never)
	console.log(`${p.label}:`, c.address.toString(), `(${ctx.mins()})`)
	return c
}

/** GROUP 3 (L2) part 2: the trio deploy (fees paid from the claimed public FJ) + wiring. */
async function landL2Trio(
	ctx: MainnetCtx,
	ewallet: unknown,
	portal: `0x${string}`,
	from: AztecAddress,
): Promise<{ proxy: Contract; token: Contract; bridge: Contract }> {
	const fee = { paymentMethod: preexistingFeeJuicePayment(from) }
	const opts = { from, fee }
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.CHECKPOINTED } }

	const proxy = await deployL2Contract(ctx, ewallet, opts, {
		step: "proxy",
		label: "TokenMinterProxy",
		art: bridgeProxyArtifact,
		args: [],
		ctor: "constructor",
		saltNum: ctx.salts.proxy,
	})
	const token = await deployL2Contract(ctx, ewallet, opts, {
		step: "token",
		label: "Token",
		art: TokenContractArtifact,
		args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address, AztecAddress.ZERO],
		ctor: "constructor_with_minter",
		saltNum: ctx.salts.token,
	})
	const bridge = await deployL2Contract(ctx, ewallet, opts, {
		step: "bridge",
		label: "TokenBridge",
		art: tokenBridgeArtifact,
		args: [proxy.address, EthAddress.fromString(portal)],
		ctor: "constructor",
		saltNum: ctx.salts.bridge,
	})

	if (!fromJournalMode) {
		if (!ctx.recorded?.confirmed["set-token"]) {
			await proxy.methods.set_token(token.address).send(sendOpts as never)
			appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "set-token", address: "done" })
		}
		if (!ctx.recorded?.confirmed["set-bridge"]) {
			await proxy.methods.set_bridge(bridge.address).send(sendOpts as never)
			appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "set-bridge", address: "done" })
		}
		console.log(`proxy wired (${ctx.mins()})`)
	}
	return { proxy, token, bridge }
}

/** Read-backs: abort on any L1 mismatch, then the group-1 router wiring gate. */
async function runReadbacks(
	ctx: MainnetCtx,
	d: {
		portal: `0x${string}`
		portalArt: ReturnType<typeof loadForkedPortalArtifact>
		registry: `0x${string}`
		bridge: Contract
		rollupVersion: number
	},
): Promise<void> {
	console.log("read-backs:")
	const portalR = getContract({ address: d.portal, abi: d.portalArt.abi as Abi, client: ctx.pub })
	const reg = getContract({ address: d.registry, abi: RegistryAbi as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const pr = portalR.read as any
	assertSame(await pr.registry(), d.registry, "portal.registry")
	assertSame(await pr.underlying(), CIRCLE_USDC, "portal.underlying == Circle USDC")
	assertSame(await pr.l2Bridge(), d.bridge.address.toString(), "portal.l2Bridge")
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	assertSame(await pr.rollup(), await (reg.read as any).getCanonicalRollup(), "portal.rollup == registry canonical")
	if ((await pr.rollupVersion()) !== BigInt(d.rollupVersion)) throw new Error("read-back FAILED: portal.rollupVersion != node")
	const onchain = await ctx.pub.getCode({ address: d.portal })
	if (!onchain) throw new Error("read-back FAILED: portal has no deployed code")
	// Immutable-aware verification — see deploy-bridge-testnet.ts for rationale.
	const observedInit = assertRuntimeMatchesTemplate(
		onchain,
		d.portalArt.deployedBytecode,
		ctx.account.address,
		d.portalArt.immutableReferences,
	)
	assertSame(observedInit.toLowerCase(), ctx.account.address.toLowerCase(), "portal initializer == broadcaster")

	// Router wiring (group 1): swapTarget bound + the F-004 witness shape present.
	await assertRouterWitnessShape(ctx.pub, FUEL_ROUTER, FUEL_SWAP, "router witness shape lacks swapTarget; STOP")
}

/** Writes ONLY the candidate — promotion to the live manifest is a separate deliberate step. */
function writeCandidate(d: {
	info: NodeInfo
	portal: `0x${string}`
	salts: MainnetCtx["salts"]
	proxy: Contract
	token: Contract
	bridge: Contract
	feeJuicePortal: `0x${string}`
	feeJuiceAsset: `0x${string}`
	mins: () => string
}): void {
	const manifest: CandidateManifest = {
		network: "mainnet",
		l1ChainId: d.info.l1ChainId,
		walletChainId: (d.info.l1ChainId ^ d.info.rollupVersion) >>> 0,
		l1: {
			usdc: CIRCLE_USDC.toLowerCase(),
			portal: d.portal,
			portalSource: "forked-v1",
			privateClaimMode: "salt-v2",
			token: { name: TOKEN_NAME, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS, source: "circle-proxy" },
			fuel: {
				core: {
					router: FUEL_ROUTER.toLowerCase(),
					permit2: PERMIT2.toLowerCase(),
					swapTarget: FUEL_SWAP.toLowerCase(),
					swapTargetContract: "UniswapFuelSwap",
					feeJuicePortal: d.feeJuicePortal.toLowerCase(),
				},
				// The DISCOVERED canonical route (discover-mainnet-fuel.ts winners) — mainnet rides
				// existing liquidity, never seeds. minFuelFj is a conservative pre-canary default;
				// the fueled canary recalibrates it before promote.
				swap: {
					poolManager: POOL_MANAGER.toLowerCase(),
					quoter: V4_QUOTER.toLowerCase(),
					weth: WETH.toLowerCase(),
					feeJuice: d.feeJuiceAsset.toLowerCase(),
					pools: { tokenWeth: { fee: 500, tickSpacing: 10 }, ethFj: { fee: 10000, tickSpacing: 200 } },
					slippageBps: 300,
					minFuelFj: String(process.env.MIN_FUEL_FJ ?? (30n * 10n ** 18n).toString()),
				},
			},
			// No FeeAssetHandler on mainnet (BYO-$AZTEC) — the schema keys the mint affordance off its absence.
			feeJuice: {
				portal: d.feeJuicePortal.toLowerCase(),
				asset: d.feeJuiceAsset.toLowerCase(),
				minFj: String(process.env.FUEL_MIN_FJ ?? (16n * 10n ** 18n).toString()),
			},
		},
		l2: {
			proxy: { address: d.proxy.address.toString(), salt: d.salts.proxy, constructorArtifact: "constructor", constructorArgs: [] },
			token: {
				address: d.token.address.toString(),
				salt: d.salts.token,
				constructorArtifact: "constructor_with_minter",
				constructorArgs: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, d.proxy.address.toString(), AztecAddress.ZERO.toString()],
			},
			bridge: {
				address: d.bridge.address.toString(),
				salt: d.salts.bridge,
				constructorArtifact: "constructor",
				constructorArgs: [d.proxy.address.toString(), d.portal],
			},
		},
	}
	writeCandidateAtomic(CANDIDATE_PATH, manifest)
	console.log(`\n✅ candidate written to apps/tools/public/mainnet-bridge.candidate.json in ${d.mins()}.`)
	console.log("   Next: PrivateFPC deploy + dust canary + smoke, THEN promote to mainnet-bridge.json.")

	if (process.env.ETHERSCAN_API_KEY) {
		console.log("\nVerifying the candidate's L1 sources on Etherscan…")
		const v = spawnSync("bun", [join(here, "verify-l1.ts"), "--config", CANDIDATE_PATH], { stdio: "inherit" })
		if (v.status !== 0) console.log("⚠ verification failed — retry with `bun run verify:l1 --config <candidate>`.")
	}
	console.log(JSON.stringify(manifest, null, 2))
}

async function main() {
	const mins = stopwatch()

	// ─── 0. Reviewed portal bytes + live network identity ────────────
	const portalArt = loadForkedPortalArtifact()
	rebuildAndVerifyPortal(portalArt.immutableReferences)
	const info = await nodeInfo()
	if (info.l1ChainId !== 1) throw new Error(`Alpha node reports l1ChainId ${info.l1ChainId} != 1 — wrong node; STOP`)
	console.log(`Alpha node: rollupVersion ${info.rollupVersion}, registry ${info.l1ContractAddresses.registryAddress}`)
	const registry = info.l1ContractAddresses.registryAddress
	const feeJuicePortal = info.l1ContractAddresses.feeJuicePortalAddress
	const feeJuiceAsset = info.l1ContractAddresses.feeJuiceAddress

	// ─── 1. Resume gate ──────────────────────────────────────────────
	const { recorded, salts } = resolveGeneration()

	// ─── 2. L1 signer (plan-pinned) + Circle USDC identity ───────────
	const account = privateKeyToAccount(PRIVATE_KEY)
	const pinned = requirePinnedSigner("mainnet")
	if (account.address.toLowerCase() !== pinned.toLowerCase()) {
		throw new Error(`L1 deployer ${account.address} != plan-pinned mainnet signer ${pinned} — wrong key; STOP`)
	}
	console.log("L1 deployer", account.address)
	const { wallet, pub } = createL1Clients({ chain: mainnet, rpcUrl: ETH_RPC, account })
	const ctx: MainnetCtx = { account, wallet, pub, recorded, salts, mins }
	await assertCircleUsdc(ctx)

	// ─── 3. L2 deployer identity (stable, derived) + precomputed L2 addresses ──
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { manager, from, secret } = await deployerSchnorrAccount(ewallet as never, "mainnet")
	console.log("L2 deployer", from.toString())
	// The claim secret derives from the SAME root (fresh domain), so the L1-deposit → L2-claim arc
	// is crash-resumable without persisting anything.
	const claimSecret = Fr.fromHexString(
		`0x${createHash("sha256").update(`nulo-mainnet-fj-claim:${secret.toString()}`).digest("hex").slice(0, 62)}`,
	)

	// ─── 4. GROUP 2 (L1): portal deploy + initialize + FJ deposit ────
	const portal = await landPortal(ctx, portalArt)

	// L2 addresses are deterministic — compute them NOW so the portal can bind to the bridge
	// before any L2 tx exists (this is what makes the L1-only group self-contained).
	const proxyInstance = await universalDeployInstance(bridgeProxyArtifact, [], "constructor", salts.proxy)
	const tokenInstance = await universalDeployInstance(
		TokenContractArtifact,
		[TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxyInstance.address, AztecAddress.ZERO],
		"constructor_with_minter",
		salts.token,
	)
	const bridgeInstance = await universalDeployInstance(
		tokenBridgeArtifact,
		[proxyInstance.address, EthAddress.fromString(portal)],
		"constructor",
		salts.bridge,
	)
	console.log("L2 (precomputed) proxy:", proxyInstance.address.toString())
	console.log("L2 (precomputed) token:", tokenInstance.address.toString())
	console.log("L2 (precomputed) bridge:", bridgeInstance.address.toString())

	await initializePortalOnce(ctx, { portal, portalArt, registry, bridgeAddress: bridgeInstance.address.toString() })
	const depositRecord = await depositFeeJuice(ctx, { feeJuicePortal, feeJuiceAsset, from, claimSecret })

	if (l1OnlyMode) {
		console.log(
			`\n✅ L1 group complete (${mins()}): portal ${portal} initialized → bridge ${bridgeInstance.address.toString()}, ` +
				`FJ deposit ${depositRecord.amount} wei @ leaf ${depositRecord.leafIndex}.`,
		)
		console.log("   Re-run WITHOUT --l1-only (after owner go) for the L2 group.")
		return
	}

	// ─── 5. GROUP 3 (L2): account (claim-in-tx) + trio + wiring ──────
	const node = createNode(NODE_URL)
	await deployAccountClaimInTx(ctx, {
		node,
		manager: manager as never,
		from,
		claim: { claimAmount: depositRecord.amount, claimSecret, messageLeafIndex: depositRecord.leafIndex },
	})

	const { proxy, token, bridge } = await landL2Trio(ctx, ewallet, portal, from)
	assertSame(bridge.address.toString(), bridgeInstance.address.toString(), "deployed bridge == portal-bound address")

	// ─── 6. Read-backs ───────────────────────────────────────────────
	await runReadbacks(ctx, { portal, portalArt, registry, bridge, rollupVersion: info.rollupVersion })

	// ─── 7. Candidate manifest ───────────────────────────────────────
	writeCandidate({ info, portal, salts, proxy, token, bridge, feeJuicePortal, feeJuiceAsset, mins })
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
