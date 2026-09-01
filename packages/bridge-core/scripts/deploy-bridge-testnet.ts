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
 * Durability: a write-ahead journal records every step submitted (txHash, before
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
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { TxStatus } from "@aztec/aztec.js/tx"
import { EthAddress } from "@aztec/foundation/eth-address"
import { RegistryAbi } from "@aztec/l1-artifacts"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { type Abi, getContract } from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "../src/artifacts"
import { assertPortalUninitialized, assertReuseMatchesManifest, assertReusedTokenMetadata, parseReuseTokenArg } from "../src/reuse-token"
import {
	appendJournal,
	type CandidateManifest,
	type GenerationState,
	journaledEvmDeploy,
	readJournal,
	resolveResume,
	writeCandidateAtomic,
} from "./deploy-manifest"
import { PLAN_PINNED_L1_SIGNER } from "./live-intent"
import { assertRuntimeMatchesTemplate, loadForkedPortalArtifact, rebuildAndVerifyPortal } from "./portal-artifact"
import { evmArtifact } from "./script-artifacts"
import { assertPortalInitializerPinned, assertRouterWitnessShape, assertSame, lc } from "./script-l1"
import { deployAccountIfAbsent, deployerSchnorrAccount, sponsoredFpcFee, universalDeployInstance } from "./script-l2"
import { createL1Clients, createL2Wallet, createNode, sepoliaChain, stopwatch } from "./script-bootstrap"

// The bridged pair's identity - ONE source for both chains; the deploy asserts L1==L2 below.
// Token identity — env-overridable so a token cutover (e.g. the DP7 TestUsdc) configures the
// SAME conductor instead of forking it. Defaults = the legacy AZLO identity.
const TOKEN_NAME = process.env.TOKEN_NAME ?? "Aztec Nulo"
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? "AZLO"
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS ?? 18)
// Which of OUR mintable contracts backs the token: drives the deploy artifact, the metadata
// reads, and the manifest's token.sourceContract (verify-l1 verifies against it).
const TOKEN_CONTRACT = (process.env.TOKEN_CONTRACT ?? "MintableERC20") as "MintableERC20" | "TestUsdc"
if (TOKEN_CONTRACT !== "MintableERC20" && TOKEN_CONTRACT !== "TestUsdc") {
	throw new Error(`TOKEN_CONTRACT must be MintableERC20 | TestUsdc, got ${TOKEN_CONTRACT}`)
}

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined
const MNEMONIC = process.env.MNEMONIC
if (!PRIVATE_KEY && !MNEMONIC) throw new Error("PRIVATE_KEY or MNEMONIC required (packages/bridge-core/.env)")

const fromJournalMode = process.argv.includes("--from-journal")
// EXPLICIT token-cutover intent: reusing a token that differs from the live manifest's l1.usdc is
// normally a hard-stop (identity fork protection). This flag acknowledges the fork ON PURPOSE
// (a planned cutover to a new token, e.g. AZLO -> TestUsdc) — the metadata assert still runs.
const allowTokenCutover = process.argv.includes("--allow-token-cutover")
// `--reuse-token <address>`: keep the EXISTING AZLO L1 ERC20 (readback-verified below)
// and deploy only a NEW portal + L2 set against it. Malformed input hard-stops.
const reuseTokenAddress = parseReuseTokenArg(process.argv)

const here = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(here, "..", "..", "..", "apps", "faucet", "public")
const LIVE_PATH = join(PUBLIC_DIR, "testnet-bridge.json")
const CANDIDATE_PATH = join(PUBLIC_DIR, "testnet-bridge.candidate.json")
const JOURNAL_PATH = join(PUBLIC_DIR, "testnet-bridge.journal.jsonl")

const sepolia = sepoliaChain(SEPOLIA_RPC)

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

/**
 * The chain identity the manifest must self-declare (the startup build-integrity assertion needs
 * it). Read from the node — NOT hardcoded — so a network reset can't ship a stale
 * pin (the chain-constants incident). `walletChainId = (l1ChainId ^ rollupVersion) >>> 0`.
 */
async function nodeChainIdentity(): Promise<{ l1ChainId: number; walletChainId: number }> {
	const res = await fetch(NODE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "node_getNodeInfo", params: [] }),
	})
	const { l1ChainId, rollupVersion } = (await res.json()).result as { l1ChainId: number; rollupVersion: number }
	return { l1ChainId, walletChainId: (l1ChainId ^ rollupVersion) >>> 0 }
}

/** Per-run state every stage threads: the L1 clients, the recorded generation, the salts. */
interface DeployCtx {
	account: { address: `0x${string}` }
	wallet: ReturnType<typeof createL1Clients>["wallet"]
	pub: ReturnType<typeof createL1Clients>["pub"]
	recorded: GenerationState | null
	salts: { proxy: number; token: number; bridge: number }
	mins: () => string
}

/** In --from-journal mode we never send L1/L2 deploys; we reuse the recorded addresses and only
 *  re-run the read-backs before writing the candidate. A missing step => partial landing => stop. */
function recordedAddr(recorded: GenerationState | null, step: string): `0x${string}` {
	const a = recorded?.confirmed[step]
	if (!a || a === "done") {
		throw new Error(
			`--from-journal: step "${step}" never confirmed - partial landing. Finish manually with the original deployer or archive for a clean start.`,
		)
	}
	return a as `0x${string}`
}

/** Resume gate (never fresh salts over a partial landing). */
function resolveGeneration(): { recorded: GenerationState | null; salts: DeployCtx["salts"] } {
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
	if (!recorded) appendJournal(JOURNAL_PATH, { phase: "generation", salts })
	return { recorded, salts }
}

/** The reuse-or-deploy fork for the L1 token: `--reuse-token` keeps the existing ERC20
 *  (manifest-identity + metadata readback-verified; `--allow-token-cutover` acknowledges an
 *  identity fork on purpose), otherwise a fresh TOKEN_CONTRACT deploy. */
async function resolveL1Token(ctx: DeployCtx): Promise<`0x${string}`> {
	if (!reuseTokenAddress) {
		if (fromJournalMode) return recordedAddr(ctx.recorded, "usdc")
		return await journaledEvmDeploy(
			{ wallet: ctx.wallet, pub: ctx.pub },
			JOURNAL_PATH,
			"usdc",
			TOKEN_CONTRACT,
			evmArtifact(TOKEN_CONTRACT),
			[TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, 1000n],
			(addr) => console.log(`${TOKEN_CONTRACT}:`, addr, `(${ctx.mins()})`),
		)
	}
	// --from-journal resume: the flag must agree with the journal's recorded usdc —
	// journaling the flag value unchecked would poison later resumes.
	if (fromJournalMode) {
		const recordedUsdc = ctx.recorded?.confirmed["usdc"]
		if (recordedUsdc && recordedUsdc.toLowerCase() !== reuseTokenAddress.toLowerCase()) {
			throw new Error(`--reuse-token ${reuseTokenAddress} != journal-recorded usdc ${recordedUsdc} — STOP`)
		}
	}
	// Reuse mode: the reused address must BE the manifest's token when a live
	// manifest exists (metadata alone accepts any same-shaped ERC20), and the
	// live contract's metadata must match the expected identity.
	let manifestUsdc: string | undefined
	try {
		manifestUsdc = (JSON.parse(readFileSync(LIVE_PATH, "utf8")) as { l1?: { usdc?: string } }).l1?.usdc
	} catch {
		manifestUsdc = undefined
	}
	if (manifestUsdc === undefined) console.log("no live manifest l1.usdc — metadata-only reuse verification")
	if (allowTokenCutover) {
		console.log(
			`⚠ INTENTIONAL TOKEN CUTOVER: reusing ${reuseTokenAddress} (live l1.usdc is ${manifestUsdc ?? "<none>"}) — ` +
				"the bridge identity FORKS to a fresh portal + L2 trio; prior journals/backups for the old token stop resolving.",
		)
	} else {
		assertReuseMatchesManifest(reuseTokenAddress, manifestUsdc)
	}
	const tokenR = getContract({ address: reuseTokenAddress, abi: evmArtifact(TOKEN_CONTRACT).abi as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const tr = tokenR.read as any
	assertReusedTokenMetadata(
		{ name: String(await tr.name()), symbol: String(await tr.symbol()), decimals: Number(await tr.decimals()) },
		{ name: TOKEN_NAME, symbol: TOKEN_SYMBOL, decimals: TOKEN_DECIMALS },
	)
	appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "usdc", address: reuseTokenAddress })
	console.log(`reusing L1 token ${reuseTokenAddress} (readback-verified ${TOKEN_SYMBOL}/${TOKEN_DECIMALS})`)
	return reuseTokenAddress
}

/** Deploy (or, in --from-journal mode, re-bind) a universal-deploy L2 contract. The deterministic
 *  address is recomputed from the recorded salt/args; a resume mismatch is a hard stop. */
async function deployL2Contract(
	ctx: DeployCtx,
	ewallet: unknown,
	opts: unknown,
	p: { step: string; label: string; art: unknown; args: unknown[]; ctor: string; saltNum: number },
): Promise<Contract> {
	const instance = await universalDeployInstance(p.art, p.args, p.ctor, p.saltNum)
	if (fromJournalMode) {
		assertSame(instance.address.toString(), recordedAddr(ctx.recorded, p.step), `${p.label} recompute == recorded`)
	} else {
		// The L2 address is deterministic (salt + args + universal deploy), so journal it BEFORE the
		// send - that is the durable recovery key (DeploySentTx exposes no pre-wait txHash accessor;
		// `.send({ wait })` is the proven inclusion path, mirroring deposit-testnet.ts).
		appendJournal(JOURNAL_PATH, { phase: "submitted", step: p.step, address: instance.address.toString() })
		// 5.0: salt + universalDeploy are construction-time DeployInstantiationOptions (the deployer is
		// locked at construction), NOT send options. Passing them to .send() is silently ignored, so the
		// deploy lands at the wallet-as-deployer / default-salt address — DIFFERENT from the deployer=ZERO
		// instance computed above — and the wiring + read-backs then target a never-deployed address.
		// Mirrors the faucet deploy (faucet/scripts/deploy.ts), which gets this right on V5.
		await Contract.deploy(ewallet as never, p.art as never, p.args as never, p.ctor, {
			salt: new Fr(p.saltNum),
			universalDeploy: true,
		} as never).send({
			...(opts as object),
			wait: { waitForStatus: TxStatus.CHECKPOINTED },
		} as never)
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: p.step, address: instance.address.toString() })
	}
	const c = await Contract.at(instance.address, p.art as never, ewallet as never)
	console.log(`${p.label}:`, c.address.toString(), `(${ctx.mins()})`)
	return c
}

/** set_token + the one-time set_bridge, then the F-001 portal initialize: the portal's
 *  initialize is guarded to the EOA that DEPLOYED it (constructor-pinned immutable), so a
 *  journal resume must broadcast with the SAME PRIVATE_KEY that landed the portal step. */
async function wirePortal(
	ctx: DeployCtx,
	d: {
		portal: `0x${string}`
		portalAbi: Abi
		registry: `0x${string}`
		usdc: `0x${string}`
		proxy: Contract
		token: Contract
		bridge: Contract
		sendOpts: unknown
	},
): Promise<void> {
	if (fromJournalMode) {
		if (!ctx.recorded?.confirmed["portal-init"]) {
			throw new Error("--from-journal: portal-init never confirmed - partial landing. Finish manually or archive for a clean start.")
		}
		return
	}
	if (!ctx.recorded?.confirmed["set-token"]) {
		await d.proxy.methods.set_token(d.token.address).send(d.sendOpts as never)
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "set-token", address: "done" })
	}
	if (!ctx.recorded?.confirmed["set-bridge"]) {
		await d.proxy.methods.set_bridge(d.bridge.address).send(d.sendOpts as never)
		appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "set-bridge", address: "done" })
	}
	console.log(`proxy wired (${ctx.mins()})`)

	const portalC = getContract({ address: d.portal, abi: d.portalAbi as never, client: ctx.wallet as never })
	// Preflight (P5): the portal we are about to initialize must still be
	// UNINITIALIZED — a non-zero l2Bridge() means this address is an
	// already-bound portal and reusing it is forbidden (the one-shot
	// initialize binding to the NEW L2 bridge is the security anchor).
	const portalPre = getContract({ address: d.portal, abi: d.portalAbi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	assertPortalUninitialized(String(await (portalPre.read as any).l2Bridge()))
	await assertPortalInitializerPinned(ctx.pub, d.portal, d.portalAbi, ctx.account.address)
	// biome-ignore lint/suspicious/noExplicitAny: viem contract write typing
	const initHash = await (portalC as any).write.initialize([d.registry, d.usdc, d.bridge.address.toString()])
	appendJournal(JOURNAL_PATH, { phase: "submitted", step: "portal-init", txHash: initHash })
	await ctx.pub.waitForTransactionReceipt({ hash: initHash })
	appendJournal(JOURNAL_PATH, { phase: "confirmed", step: "portal-init", address: "done" })
	console.log(`portal initialized (${ctx.mins()})`)
}

/** Expanded on-chain read-backs: abort on any L1 mismatch. L2 read-backs
 *  are BEST-EFFORT (log, never abort): aztec.js view-simulate returns `{ result }` and the
 *  decoded shape varies (AztecAddress / Fr / bigint), so a decode quirk must not false-abort a
 *  correct deploy. The deposit->claim smoke is the definitive L2 gate - it mints via the proxy
 *  and claims via the bridge config end to end - and promotion is gated on it. */
async function runReadbacks(
	ctx: DeployCtx,
	d: {
		portal: `0x${string}`
		portalArt: ReturnType<typeof loadForkedPortalArtifact>
		registry: `0x${string}`
		usdc: `0x${string}`
		proxy: Contract
		token: Contract
		bridge: Contract
		from: AztecAddress
	},
): Promise<void> {
	console.log("read-backs:")
	const portalR = getContract({ address: d.portal, abi: d.portalArt.abi as Abi, client: ctx.pub })
	const reg = getContract({ address: d.registry, abi: RegistryAbi as Abi, client: ctx.pub })
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	const pr = portalR.read as any
	assertSame(await pr.registry(), d.registry, "portal.registry")
	assertSame(await pr.underlying(), d.usdc, "portal.underlying")
	assertSame(await pr.l2Bridge(), d.bridge.address.toString(), "portal.l2Bridge")
	// biome-ignore lint/suspicious/noExplicitAny: viem read typing
	assertSame(await pr.rollup(), await (reg.read as any).getCanonicalRollup(), "portal.rollup == registry canonical")
	if ((await pr.rollupVersion()) <= 0n) throw new Error("read-back FAILED: portal.rollupVersion is 0")
	const onchain = await ctx.pub.getCode({ address: d.portal })
	if (!onchain) throw new Error("read-back FAILED: portal has no deployed code")
	// The constructor patches the immutable initializer into the runtime bytes, so raw keccak
	// equality vs the template can never hold; verify structurally (diff confined to immutable
	// words encoding THIS broadcaster) instead.
	const observedInit = assertRuntimeMatchesTemplate(
		onchain,
		d.portalArt.deployedBytecode,
		ctx.account.address,
		d.portalArt.immutableReferences,
	)
	assertSame(observedInit.toLowerCase(), ctx.account.address.toLowerCase(), "portal initializer == broadcaster")

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
	await l2Check("proxy.get_token", d.proxy.methods.get_token().simulate({ from: d.from }), d.token.address.toString())
	await l2Check("proxy.get_bridge", d.proxy.methods.get_bridge().simulate({ from: d.from }), d.bridge.address.toString())
}

/** Fuel arc: carry the POOL config forward, but the router/swap must be the F-004/F-006 build.
 *  The router/swap addresses are bridge-independent, BUT they carry the security fixes (F-004
 *  binds swapTarget into the Permit2 witness; F-006 the non-zero minOutput). A pre-B2 router
 *  would reject the wallet's signature AND leave F-004/F-006 unshipped. So a cutover deploys
 *  fresh fuel (DeployFuelLive) and passes FUEL_ROUTER + FUEL_SWAP; the pool config (pools,
 *  quoter, slippage, …) carries forward from the live manifest. Pre-B2 fuel is a hard abort. */
async function buildFuelCarry(
	ctx: DeployCtx,
	prior: { l1?: { fuel?: { core?: Record<string, unknown>; swap?: Record<string, unknown> } } } | null,
	l1a: Record<string, `0x${string}`>,
): Promise<Record<string, unknown> | undefined> {
	const priorFuel = prior?.l1?.fuel
	// The router + its constructor deps (permit2/swapTarget/feeJuicePortal) live under `core`; the
	// swap-quoting stack carries forward untouched under `swap`. The rollup-coupled + env overrides
	// land INSIDE `core` (they used to be flat).
	// A token cutover DROPS the swap stack: the Uniswap pools are keyed by the token address, so the
	// prior token's pools cannot serve the new token — carrying them would emit a manifest whose
	// quoting path points at nonexistent liquidity. The cutover shape is
	// bridge-only + direct fuel: core carried (refreshed), swap gone — exactly the mainnet shape.
	if (allowTokenCutover && priorFuel?.swap) {
		console.log("⚠ token cutover: DROPPING the prior swap stack (pools are token-keyed) — promote with --drop-swap")
	}
	const fuel = priorFuel
		? {
				...(allowTokenCutover ? { core: priorFuel.core } : priorFuel),
				core: {
					...priorFuel.core,
					// Record WHICH contract the (carried) swapTarget is — verification must never infer it
					// from swap-absence. The carried testnet target is the AZLO-era UniswapFuelSwap unless
					// the operator deployed a replacement and says so via SWAP_TARGET_CONTRACT.
					...(allowTokenCutover ? { swapTargetContract: process.env.SWAP_TARGET_CONTRACT ?? "UniswapFuelSwap" } : {}),
					// The FeeJuicePortal is ROLLUP-COUPLED — refresh it from the node so a carried fuel
					// block never re-promotes the previous rollup's (dead) portal.
					feeJuicePortal: l1a.feeJuicePortalAddress.toLowerCase(),
					...(process.env.FUEL_ROUTER ? { router: process.env.FUEL_ROUTER.toLowerCase() } : {}),
					...(process.env.FUEL_SWAP ? { swapTarget: process.env.FUEL_SWAP.toLowerCase() } : {}),
				},
			}
		: undefined
	if (fuel?.core?.router && fuel?.core?.swapTarget) {
		await assertRouterWitnessShape(
			ctx.pub,
			fuel.core.router as `0x${string}`,
			fuel.core.swapTarget as string,
			"fuel router is PRE-B2 (witness type string lacks swapTarget) - F-004/F-006 not shipped. Deploy fresh fuel " +
				"(contracts/bridge/evm DeployFuelLive.s.sol, no-reuse) and pass FUEL_ROUTER + FUEL_SWAP.",
		)
	}
	return fuel
}

/** Write the CANDIDATE (never the live file), then offer Etherscan verification. */
async function writeCandidate(d: {
	usdc: `0x${string}`
	portal: `0x${string}`
	salts: DeployCtx["salts"]
	proxy: Contract
	token: Contract
	bridge: Contract
	fuel: Record<string, unknown> | undefined
	feeJuice: { portal: string; asset: string; feeAssetHandler?: string; minFj: string }
	mins: () => string
}): Promise<void> {
	// Chain identity from the node (reset-safe) — the startup build-integrity assertion requires it.
	const chainIdentity = await nodeChainIdentity()
	const manifest: CandidateManifest = {
		network: "testnet",
		l1ChainId: chainIdentity.l1ChainId,
		walletChainId: chainIdentity.walletChainId,
		l1: {
			usdc: d.usdc,
			portal: d.portal,
			portalSource: "forked-v1",
			// L9 runtime interlock: the recipient-committed deposit code REFUSES to build a private deposit
			// unless the active manifest declares this. Written ONLY into the candidate (this file is never
			// the live manifest before promotion), so a stray preview/static deploy of new code against an
			// OLD (bearer-bridge) manifest fails closed instead of stranding funds.
			privateClaimMode: "salt-v2",
			token: {
				name: TOKEN_NAME,
				symbol: TOKEN_SYMBOL,
				decimals: TOKEN_DECIMALS,
				maxWholePerTx: 1000,
				source: "permissionless-mint",
				sourceContract: TOKEN_CONTRACT,
			},
			...(d.fuel ? { fuel: d.fuel } : {}),
			feeJuice: d.feeJuice,
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
	console.log(`\n✅ candidate written to apps/faucet/public/testnet-bridge.candidate.json in ${d.mins()}.`)
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

async function main() {
	const mins = stopwatch()

	// ─── 0. Reviewed bytes + drift alarm ─────────────────────────────
	// Rebuild the fork from source and assert it still matches the reviewed pins, then deploy the
	// COMMITTED bytes (exact reviewed bytes, not "whatever builds today").
	const portalArt = loadForkedPortalArtifact()
	rebuildAndVerifyPortal(portalArt.immutableReferences)

	// ─── 1. Resume gate ──────────────────────────────────────────────
	const { recorded, salts } = resolveGeneration()

	// ─── L1 (Sepolia) ────────────────────────────────────────────────
	const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY) : mnemonicToAccount(MNEMONIC as string)
	// Signer pin: the broadcast script itself asserts the
	// deployer == the plan-pinned signer, so sourcing a WRONG key/mnemonic before this
	// script can't spend from an unexpected account (verify runs in a separate shell).
	if (account.address.toLowerCase() !== PLAN_PINNED_L1_SIGNER.toLowerCase()) {
		throw new Error(`L1 deployer ${account.address} != plan-pinned signer ${PLAN_PINNED_L1_SIGNER} — wrong key; STOP`)
	}
	console.log("L1 deployer", account.address)
	const { wallet, pub } = createL1Clients({ chain: sepolia, rpcUrl: SEPOLIA_RPC, account })
	const l1a = await nodeL1Addresses()
	const registry = l1a.registryAddress
	const ctx: DeployCtx = { account, wallet, pub, recorded, salts, mins }

	const usdc = await resolveL1Token(ctx)
	const portal = fromJournalMode
		? recordedAddr(recorded, "portal")
		: await journaledEvmDeploy({ wallet, pub }, JOURNAL_PATH, "portal", "NuloTokenPortal", portalArt, [], (addr) =>
				console.log("NuloTokenPortal:", addr, `(${mins()})`),
			)

	// ─── L2 (testnet aztec.js - REAL proofs) ─────────────────────────
	const node = createNode(NODE_URL)
	const ewallet = await createL2Wallet({ nodeUrl: NODE_URL, proverEnabled: true })
	const { manager, from } = await deployerSchnorrAccount(ewallet as never, "testnet")
	console.log("L2 deployer", from.toString())

	const { fee } = await sponsoredFpcFee(ewallet)
	const opts = { from, fee }
	// V5 finalization ladder is PROPOSED → CHECKPOINTED → PROVEN → FINALIZED. A merely-PROPOSED
	// contract is not yet served for public simulation, so a dependent step (the proxy wiring below, or
	// a later deploy referencing an earlier one) sees "Contract not deployed". Wait for CHECKPOINTED —
	// the first state the node publicly simulates against. PROPOSED sufficed on V4 (no checkpoint stage).
	const sendOpts = { ...opts, wait: { waitForStatus: TxStatus.CHECKPOINTED } }

	await deployAccountIfAbsent({
		node,
		manager: manager as never,
		from,
		fee,
		log: (stage) =>
			console.log(
				stage === "deploying" ? `deploying L2 account (real proof, ~minutes)… (${mins()})` : `L2 account deployed (${mins()})`,
			),
	})

	const proxy = await deployL2Contract(ctx, ewallet, opts, {
		step: "proxy",
		label: "TokenMinterProxy",
		art: bridgeProxyArtifact,
		args: [],
		ctor: "constructor",
		saltNum: salts.proxy,
	})
	const token = await deployL2Contract(ctx, ewallet, opts, {
		step: "token",
		label: "Token",
		art: TokenContractArtifact,
		// 5.0.1 standards Token: 5th constructor param auth_contract (ZERO = none).
		args: [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS, proxy.address, AztecAddress.ZERO],
		ctor: "constructor_with_minter",
		saltNum: salts.token,
	})
	const bridge = await deployL2Contract(ctx, ewallet, opts, {
		step: "bridge",
		label: "TokenBridge",
		art: tokenBridgeArtifact,
		args: [proxy.address, EthAddress.fromString(portal)],
		ctor: "constructor",
		saltNum: salts.bridge,
	})

	await wirePortal(ctx, { portal, portalAbi: portalArt.abi as Abi, registry, usdc, proxy, token, bridge, sendOpts })
	await runReadbacks(ctx, { portal, portalArt, registry, usdc, proxy, token, bridge, from })

	const prior = existsSync(LIVE_PATH) ? JSON.parse(readFileSync(LIVE_PATH, "utf8")) : null
	const fuel = await buildFuelCarry(ctx, prior, l1a)

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

	await writeCandidate({ usdc, portal, salts, proxy, token, bridge, fuel, feeJuice, mins })
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
