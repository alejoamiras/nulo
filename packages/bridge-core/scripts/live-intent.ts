/**
 * Deployment-intent tooling for live testnet arcs (plan D11): a schema-validated `intent.json`
 * BUILT from dual-source probes before any signing, and a `verify` stage re-run before every
 * broadcast group and at promotion. Executable enforcement, not narrative discipline.
 *
 *   bun packages/bridge-core/scripts/live-intent.ts build <intent-path>
 *   bun packages/bridge-core/scripts/live-intent.ts verify <intent-path> [--candidate <path>]
 *
 * `build` records: node identity from the PRIMARY Aztec RPC; an INDEPENDENT L1 corroboration
 * (direct `eth_getCode` on the node-claimed rollup + FeeJuicePortal via SEPOLIA_RPC_URL); a
 * second Aztec endpoint's identity when INTENT_SECOND_AZTEC_RPC is set, else the documented
 * single-node posture; the env-derived signer CHECKED against the PLAN-PINNED allowlist (the
 * constant below — not the env, breaking the env-file tautology); artifact digests (canonical
 * PrivateFPC + the three committed Noir targets); the git source snapshot; and the spend caps.
 *
 * `verify` re-probes identity + signer + digests and fails on ANY divergence; with `--candidate`
 * it also digest-pins the candidate manifest, strict-validates it, and cross-reads the portal's
 * UNDERLYING() + handler's FEE_ASSET() on L1.
 */
import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import { parseCandidateManifest } from "../src/candidate-schema"
import { assertDripCandidateShape, assertZeroSeed } from "../src/promotion"
import { PRIVATE_FPC_ADDRESS, PRIVATE_FPC_SALT } from "../src/private-fuel"
import { git, resolveBin, run } from "./run"

/** The ONLY L1 signer authorized for this arc — pinned in the PLAN (and here), never derived
 *  from the env being checked. A different env-derived signer is a hard stop. */
/**
 * Per-network plan-pinned L1 signers (DP4: keys never cross networks). `mainnet` stays null until
 * the owner creates the FRESH mainnet-only EOA at Phase 8 and pins it here — until then
 * `requirePinnedSigner("mainnet")` fails closed, so no mainnet script can broadcast with an
 * unpinned (or testnet) key.
 */
export const PLAN_PINNED_L1_SIGNERS: Record<"testnet" | "mainnet", string | null> = {
	testnet: "0xFcc2238319aC360e985f1736aBB3df6251DAF6F5",
	// Fresh network-keyed mainnet EOA (DP4), generated 2026-07-27; key held owner-side only.
	mainnet: "0xE75e277a6800a37429dac55FcD2f3540E371059c",
}

/** Fail-closed signer lookup — throws while a network's signer is unpinned. */
export function requirePinnedSigner(network: "testnet" | "mainnet"): string {
	const pinned = PLAN_PINNED_L1_SIGNERS[network]
	if (!pinned) {
		throw new Error(
			`no plan-pinned L1 signer for ${network} — create the fresh network-keyed EOA and pin it in ` +
				"PLAN_PINNED_L1_SIGNERS (live-intent.ts) before any broadcast. STOP.",
		)
	}
	return pinned
}

/** The testnet pin — the historical single-network export every testnet script asserts against. */
export const PLAN_PINNED_L1_SIGNER = requirePinnedSigner("testnet")

/** Hard per-arc exposure ceilings (reviewed at the plan gate; raised from 0.5/0.25 for the
 *  owner-directed pool deepening — a ~1.25 WETH seed to cut swap price impact to ~1.5% at a
 *  25-token fill). Testnet ETH only; the mainnet arc re-reviews these from scratch. */
export const CAPS = {
	maxTotalEthSpend: "2.0", // ether — L1 gas + WETH_SEED + pool seeding, everything
	maxWethSeed: "1.5", // ether — SeedTokenPool/DeployFuelLive's WETH_SEED must be explicit and ≤ this
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
let castPath: string | undefined

/** `CAST_BIN` → the current Aztec toolchain → the 5.0.0 pin → PATH; resolved on first use so
 *  importing this module for its signer constants never requires `cast` to exist. */
function castBin(): string {
	castPath ??= resolveBin("cast", {
		envVar: "CAST_BIN",
		candidates: [
			join(homedir(), ".aztec", "current", "internal-bin", "cast"),
			join(homedir(), ".aztec", "versions", "5.0.0", "internal-bin", "cast"),
		],
		prefer: "candidates",
	})
	return castPath
}

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	})
	if (!res.ok) throw new Error(`${method} @ ${url}: HTTP ${res.status}`)
	const body = (await res.json()) as { result?: T; error?: { message: string } }
	if (body.error) throw new Error(`${method} @ ${url}: ${body.error.message}`)
	return body.result as T
}

const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")

/** Run `cast` with an ARGV array — NEVER a shell string. A node-returned address containing shell
 *  metacharacters must not be able to execute commands (the deployer key is in this process's env
 *  AND in this argv); `run` never touches a shell and adds nothing from argv to a failure — what
 *  `cast` itself prints to stderr is kept verbatim. */
function cast(args: string[]): string {
	return run(castBin(), args, { stdio: ["ignore", "pipe", "pipe"] }).stdout.trim()
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const PRIVATE_KEY_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/
const COMMIT_SHA = /^[0-9a-f]{40}$/

/** The key reaches `cast` as an argument; a value that is not a 32-byte hex key must never get there. */
function requirePrivateKey(value: string): string {
	if (!PRIVATE_KEY_HEX.test(value)) throw new Error("PRIVATE_KEY is not a 32-byte hex key — STOP")
	return value
}
/** Fail-closed validation for any value that flows into a `cast` invocation from an UNTRUSTED source
 *  (a node RPC response, primarily). Even with `run` closing the shell vector, a malformed
 *  address must hard-stop rather than silently produce a wrong on-chain read. */
function requireAddress(value: string | undefined, label: string): string {
	if (!value || !EVM_ADDRESS.test(value)) {
		throw new Error(`${label} is not a valid 20-byte address: ${JSON.stringify(value)} — STOP`)
	}
	return value
}

interface NodeIdentity {
	nodeVersion: string
	l1ChainId: number
	rollupVersion: number
	l1ContractAddresses: Record<string, string>
}

async function probeIdentity(url: string): Promise<NodeIdentity> {
	return rpc<NodeIdentity>(url, "node_getNodeInfo", [])
}

export interface DeployIntent {
	builtAt: string
	primaryRpc: string
	identity: { nodeVersion: string; l1ChainId: number; rollupVersion: number; walletChainId: number }
	l1: { rollup: string; feeJuicePortal: string; feeJuice: string; feeAssetHandler: string; registry: string }
	l1Corroboration: { rollupHasCode: boolean; portalHasCode: boolean; source: string }
	secondEndpoint:
		| { url: string; agreed: true }
		| { posture: "SINGLE-L2-NODE (documented residual: no second public endpoint; L1-anchored; caps bound exposure)" }
	signer: string
	caps: typeof CAPS
	/** The signer's ETH balance at build time (pre-spend). verify enforces `baseline - now <= cap`. */
	startingBalanceEth: number
	artifacts: { privateFpc: { address: string; salt: string; sha256: string }; noirTargets: Record<string, string> }
	source: { commit: string; treeClean: boolean; operationalAllowlist: string[] }
	candidateSha256?: string
}

const OPERATIONAL_ALLOWLIST = [
	"apps/tools/public/testnet-bridge.candidate.json",
	"apps/tools/public/testnet-bridge.json",
	"apps/tools/src/contracts/deployments.candidate.json",
	"apps/tools/src/contracts/deployments.json",
	"packages/bridge-core/deploy-journal.jsonl",
	"implementations-plan/aztec-5.0.0-stable/lessons/",
	"implementations-plan/aztec-5.0.1-line/lessons/",
	"implementations-plan/tools-two-network/lessons/",
	"apps/tools/public/testnet-bridge.journal.jsonl",
]

/** Network-identity pinning against the COMMITTED previous-arc intent: no network reset has
 *  happened on this line (nodeVersion 5.0.0, rollupVersion unchanged), so every node-claimed
 *  L1 address MUST be byte-equal to the values the 5.0.0 arc recorded and committed. A
 *  mismatch is a STOP — either the network reset (redeploy plan changes) or the node is
 *  lying/stale (never build an intent from it). Code-presence corroboration in `build` stays:
 *  this check authenticates the claims against history, that one against the L1 itself.
 *  Read the pin from the COMMITTED blob (git show HEAD:…), never the working tree:
 *  the lessons dir is allowlisted-dirty during live arcs, so a tree read could be
 *  silently re-pointed without tripping tree discipline (review finding #7). */
function assertNoResetPins(identity: Awaited<ReturnType<typeof probeIdentity>>): void {
	const previousArc = JSON.parse(git(["show", "HEAD:implementations-plan/aztec-5.0.0-stable/lessons/intent.json"], repoRoot)) as {
		identity: { l1ChainId: number; rollupVersion: number }
		l1: Record<string, string>
	}
	if (identity.l1ChainId !== previousArc.identity.l1ChainId || identity.rollupVersion !== previousArc.identity.rollupVersion) {
		throw new Error(
			`network identity moved: live l1ChainId=${identity.l1ChainId}/rollupVersion=${identity.rollupVersion} != ` +
				`committed ${previousArc.identity.l1ChainId}/${previousArc.identity.rollupVersion} — RESET or wrong network; STOP`,
		)
	}
	const l1Pins: Array<[keyof typeof previousArc.l1, string]> = [
		["rollup", identity.l1ContractAddresses.rollupAddress],
		["feeJuicePortal", identity.l1ContractAddresses.feeJuicePortalAddress],
		["feeJuice", identity.l1ContractAddresses.feeJuiceAddress],
		["feeAssetHandler", identity.l1ContractAddresses.feeAssetHandlerAddress],
		["registry", identity.l1ContractAddresses.registryAddress],
	]
	for (const [key, claimed] of l1Pins) {
		const committed = previousArc.l1[key]
		if (!committed || String(claimed).toLowerCase() !== committed.toLowerCase()) {
			throw new Error(
				`node-claimed L1 ${String(key)} ${claimed} != committed previous-arc ${committed} — no-reset pin violated; STOP`,
			)
		}
	}
}

async function build(intentPath: string): Promise<void> {
	const sepolia = process.env.SEPOLIA_RPC_URL
	if (!sepolia) throw new Error("SEPOLIA_RPC_URL required (source packages/bridge-core/.env)")
	const pk = process.env.PRIVATE_KEY
	if (!pk) throw new Error("PRIVATE_KEY required (source packages/bridge-core/.env)")

	const identity = await probeIdentity(NODE_URL)
	const walletChainId = (identity.l1ChainId ^ identity.rollupVersion) >>> 0
	assertNoResetPins(identity)

	// Independent L1 corroboration of the node's claims — a lying/stale node fails here. The node
	// controls these strings, so validate them as addresses BEFORE they reach `cast`.
	const rollup = requireAddress(identity.l1ContractAddresses.rollupAddress, "node rollupAddress")
	const portal = requireAddress(identity.l1ContractAddresses.feeJuicePortalAddress, "node feeJuicePortalAddress")
	const rollupCode = cast(["code", rollup, "--rpc-url", sepolia])
	const portalCode = cast(["code", portal, "--rpc-url", sepolia])

	// Second Aztec endpoint, when one exists.
	const secondUrl = process.env.INTENT_SECOND_AZTEC_RPC
	let secondEndpoint: DeployIntent["secondEndpoint"]
	if (secondUrl) {
		const second = await probeIdentity(secondUrl)
		if (second.rollupVersion !== identity.rollupVersion || second.l1ContractAddresses.rollupAddress !== rollup) {
			throw new Error(`second endpoint DISAGREES: rollupVersion ${second.rollupVersion} vs ${identity.rollupVersion}`)
		}
		secondEndpoint = { url: secondUrl, agreed: true }
	} else {
		secondEndpoint = { posture: "SINGLE-L2-NODE (documented residual: no second public endpoint; L1-anchored; caps bound exposure)" }
	}

	const signer = cast(["wallet", "address", "--private-key", requirePrivateKey(pk)])
	if (signer.toLowerCase() !== PLAN_PINNED_L1_SIGNER.toLowerCase()) {
		throw new Error(`env-derived signer ${signer} != plan-pinned ${PLAN_PINNED_L1_SIGNER} — HARD STOP`)
	}

	// The PRE-SPEND baseline the caps are measured against. Recorded ONCE at build (before any
	// broadcast); verify computes `baseline - current` and hard-stops if it exceeds maxTotalEthSpend.
	const startingBalanceEth = Number(cast(["balance", signer, "--rpc-url", sepolia, "--ether"]))
	if (!Number.isFinite(startingBalanceEth)) throw new Error(`could not read starting signer balance — STOP`)

	const commit = git(["rev-parse", "HEAD"], repoRoot)
	const dirty = run("git", ["status", "--porcelain"], { cwd: repoRoot })
		.stdout.split("\n")
		.filter(Boolean)
		.filter((l) => !OPERATIONAL_ALLOWLIST.some((a) => l.slice(3).startsWith(a)))

	const intent: DeployIntent = {
		builtAt: new Date().toISOString(),
		primaryRpc: NODE_URL,
		identity: {
			nodeVersion: identity.nodeVersion,
			l1ChainId: identity.l1ChainId,
			rollupVersion: identity.rollupVersion,
			walletChainId,
		},
		l1: {
			rollup,
			feeJuicePortal: portal,
			feeJuice: identity.l1ContractAddresses.feeJuiceAddress,
			feeAssetHandler: identity.l1ContractAddresses.feeAssetHandlerAddress,
			registry: identity.l1ContractAddresses.registryAddress,
		},
		l1Corroboration: {
			rollupHasCode: rollupCode.length > 4,
			portalHasCode: portalCode.length > 4,
			source: "direct eth_getCode via SEPOLIA_RPC_URL",
		},
		secondEndpoint,
		signer,
		caps: CAPS,
		startingBalanceEth,
		artifacts: {
			privateFpc: {
				address: PRIVATE_FPC_ADDRESS,
				salt: PRIVATE_FPC_SALT,
				sha256: JSON.parse(readFileSync(join(here, "..", "src", "private-fpc-canonical.json"), "utf8")).artifactSha256,
			},
			noirTargets: Object.fromEntries(
				[
					"token_bridge/target/token_bridge_contract-TokenBridge.json",
					"token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json",
					"keystone/target/keystone.json",
				].map((rel) => [rel, sha256(join(repoRoot, "contracts", "bridge", "aztec", rel))]),
			),
		},
		source: { commit, treeClean: dirty.length === 0, operationalAllowlist: OPERATIONAL_ALLOWLIST },
	}
	if (!intent.l1Corroboration.rollupHasCode || !intent.l1Corroboration.portalHasCode) {
		throw new Error("L1 corroboration FAILED: node-claimed rollup/portal has no code on Sepolia — HARD STOP")
	}
	if (dirty.length > 0) {
		throw new Error(`source tree not clean outside the operational allowlist:\n${dirty.join("\n")}`)
	}
	writeFileSync(intentPath, `${JSON.stringify(intent, null, "\t")}\n`)
	console.log(
		`✓ intent written to ${intentPath} (commit ${commit.slice(0, 8)}, rollupVersion ${identity.rollupVersion}, signer ${signer})`,
	)
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (91 lines) — split when touched, never grow
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 61) — refactor when touched, never raise
async function verify(intentPath: string, candidatePath?: string): Promise<void> {
	const intent = JSON.parse(readFileSync(intentPath, "utf8")) as DeployIntent
	const sepolia = process.env.SEPOLIA_RPC_URL
	if (!sepolia) throw new Error("SEPOLIA_RPC_URL required")

	// The intent is the gate's own trust anchor (caps, signer, digests). It lives under the
	// otherwise-allowlisted lessons dir, so once it carries a recorded candidate digest (i.e. we are
	// PAST the one-time digest-recording verify and into the gating regime) it MUST be committed — an
	// uncommitted edit to weaken caps/signer/digest would otherwise slip through the tree check.
	if (intent.candidateSha256) {
		// `--literal-pathspecs` + `--`: the path is neither an option nor pathspec magic.
		const intentStatus = run("git", ["--literal-pathspecs", "status", "--porcelain", "--", intentPath], {
			cwd: repoRoot,
		}).stdout.trim()
		if (intentStatus.length > 0) {
			throw new Error(`intent.json is uncommitted — the gate's own anchor must be committed before promotion:\n${intentStatus}`)
		}
	}

	// Tree discipline at EVERY verify, not just at build: only allowlisted operational files may be
	// dirty during the live arc. A non-allowlisted source change must be committed (fix-forward,
	// logged in lessons) before the next broadcast group — never carried silently into a promotion.
	const dirtyNow = run("git", ["status", "--porcelain"], { cwd: repoRoot })
		.stdout.split("\n")
		.filter(Boolean)
		.filter((l) => !OPERATIONAL_ALLOWLIST.some((a) => l.slice(3).startsWith(a)))
	if (dirtyNow.length > 0) {
		throw new Error(`non-allowlisted files dirty during the live arc — commit or revert first:\n${dirtyNow.join("\n")}`)
	}

	// Source-commit discipline (codex ultra-audit HIGH): tree-discipline catches UNCOMMITTED
	// changes, but a CLEAN commit between build and a later verify (changing a deploy script or
	// EVM artifact) would pass. Diff HEAD against the intent's recorded build commit and require
	// every changed path to be allowlisted — so the intent commit itself (allowlisted lessons)
	// is fine, but a deploy-relevant change since build is a STOP.
	if (intent.source?.commit) {
		// The intent is a type-cast JSON file: the commit is validated before it becomes a git argument.
		if (!COMMIT_SHA.test(intent.source.commit)) throw new Error(`intent.source.commit is not a 40-hex commit — STOP`)
		const changedSinceBuild = git(["diff", "--name-only", "--end-of-options", intent.source.commit, "HEAD", "--"], repoRoot)
			.split("\n")
			.filter(Boolean)
			.filter((path) => !OPERATIONAL_ALLOWLIST.some((a) => path.startsWith(a)))
		if (changedSinceBuild.length > 0) {
			throw new Error(
				`deploy-relevant files changed since the intent was built (commit ${intent.source.commit.slice(0, 12)}):\n` +
					`${changedSinceBuild.join("\n")}\nrebuild the intent — STOP`,
			)
		}
	}

	// Identity re-validation (before EVERY broadcast group + at promotion).
	const now = await probeIdentity(intent.primaryRpc)
	if (now.rollupVersion !== intent.identity.rollupVersion)
		throw new Error(`rollupVersion MOVED mid-arc: ${now.rollupVersion} != ${intent.identity.rollupVersion} — STOP`)
	if (now.nodeVersion !== intent.identity.nodeVersion)
		throw new Error(`nodeVersion moved: ${now.nodeVersion} != ${intent.identity.nodeVersion} — STOP`)
	if (now.l1ContractAddresses.rollupAddress !== intent.l1.rollup) throw new Error("rollup address moved — STOP")

	// Signer re-check.
	const pk = process.env.PRIVATE_KEY
	if (pk) {
		const signer = cast(["wallet", "address", "--private-key", requirePrivateKey(pk)])
		if (signer.toLowerCase() !== intent.signer.toLowerCase()) throw new Error(`signer ${signer} != intent ${intent.signer} — STOP`)
	}

	// Artifact digests unchanged — the Noir targets AND the canonical PrivateFPC
	// (previously recorded at build but never re-verified — review finding #6).
	for (const [rel, expected] of Object.entries(intent.artifacts.noirTargets)) {
		const actual = sha256(join(repoRoot, "contracts", "bridge", "aztec", rel))
		if (actual !== expected) throw new Error(`Noir artifact drifted since intent: ${rel}`)
	}
	{
		const descriptorSha = JSON.parse(readFileSync(join(here, "..", "src", "private-fpc-canonical.json"), "utf8")).artifactSha256
		if (descriptorSha !== intent.artifacts.privateFpc.sha256) {
			throw new Error(
				`canonical PrivateFPC digest drifted since intent: ${descriptorSha} != ${intent.artifacts.privateFpc.sha256} — STOP`,
			)
		}
	}

	if (candidatePath) {
		const raw = readFileSync(candidatePath, "utf8")
		const digest = createHash("sha256").update(raw).digest("hex")
		if (intent.candidateSha256 && intent.candidateSha256 !== digest) {
			throw new Error(`candidate digest CHANGED since recorded: ${digest} != ${intent.candidateSha256} — never promote`)
		}
		const candidate = parseCandidateManifest(JSON.parse(raw))
		if (!intent.candidateSha256) {
			intent.candidateSha256 = digest
			writeFileSync(intentPath, `${JSON.stringify(intent, null, "\t")}\n`)
			console.log(`✓ candidate digest recorded: ${digest}`)
		}
		// Privileged-state readbacks on L1 (a fingerprint can't catch a wrong owner/binding). The
		// candidate addresses are schema-validated (EVM-address regex), so they're shell-safe; passed
		// as argv all the same. The `"UNDERLYING()(address)"` sig is one argv element (no shell parse).
		if (candidate.l1.feeJuice) {
			// Cross-pin against the intent's corroborated L1 set FIRST (review finding #1):
			// internal consistency (portal↔asset readbacks below) is not authentication —
			// a lying node at deploy time can mint a self-consistent FAKE pair. The intent's
			// values went through previous-arc byte-equality + eth_getCode; the candidate
			// must match them exactly or deposits go to the wrong portal (unrecoverable).
			if (candidate.l1.feeJuice.portal.toLowerCase() !== intent.l1.feeJuicePortal.toLowerCase()) {
				throw new Error(
					`candidate feeJuice.portal ${candidate.l1.feeJuice.portal} != intent pin ${intent.l1.feeJuicePortal} — STOP`,
				)
			}
			if (candidate.l1.feeJuice.asset.toLowerCase() !== intent.l1.feeJuice.toLowerCase()) {
				throw new Error(`candidate feeJuice.asset ${candidate.l1.feeJuice.asset} != intent pin ${intent.l1.feeJuice} — STOP`)
			}
			const underlying = cast(["call", candidate.l1.feeJuice.portal, "UNDERLYING()(address)", "--rpc-url", sepolia])
			if (underlying.toLowerCase() !== candidate.l1.feeJuice.asset.toLowerCase()) {
				throw new Error(`portal UNDERLYING ${underlying} != manifest asset ${candidate.l1.feeJuice.asset} — STOP`)
			}
			// The FeeAssetHandler is testnet-only (permissionless mint); mainnet is BYO-$AZTEC with no
			// handler. Verify it (intent-pin + FEE_ASSET readback) only when the manifest declares one.
			const handler = candidate.l1.feeJuice.feeAssetHandler
			if (handler) {
				if (handler.toLowerCase() !== intent.l1.feeAssetHandler.toLowerCase()) {
					throw new Error(`candidate feeJuice.feeAssetHandler ${handler} != intent pin ${intent.l1.feeAssetHandler} — STOP`)
				}
				const feeAsset = cast(["call", handler, "FEE_ASSET()(address)", "--rpc-url", sepolia])
				if (feeAsset.toLowerCase() !== candidate.l1.feeJuice.asset.toLowerCase()) {
					throw new Error(`handler FEE_ASSET ${feeAsset} != manifest asset — STOP`)
				}
			}
		}
		if (candidate.l1.fuel) {
			const owner = cast(["call", candidate.l1.fuel.core.router, "owner()(address)", "--rpc-url", sepolia]).toLowerCase()
			if (owner !== intent.signer.toLowerCase()) throw new Error(`router owner ${owner} != our signer — STOP (privileged binding)`)
			const swapTarget = cast(["call", candidate.l1.fuel.core.router, "swapTarget()(address)", "--rpc-url", sepolia]).toLowerCase()
			if (swapTarget !== candidate.l1.fuel.core.swapTarget.toLowerCase())
				throw new Error(`router swapTarget ${swapTarget} != manifest — STOP`)
		}
		console.log("✓ candidate strict-valid + privileged readbacks agree")
	}

	// Balance-within-caps reconciliation — ENFORCED, not merely printed. A build recorded the
	// pre-spend baseline; if the cumulative spend since then exceeds the cap, hard-stop.
	const balance = Number(cast(["balance", requireAddress(intent.signer, "intent signer"), "--rpc-url", sepolia, "--ether"]))
	if (typeof intent.startingBalanceEth === "number" && Number.isFinite(intent.startingBalanceEth)) {
		const spent = intent.startingBalanceEth - balance
		const cap = Number(intent.caps.maxTotalEthSpend)
		if (spent > cap) {
			throw new Error(
				`spend ${spent.toFixed(6)} ETH EXCEEDS the ${cap} ETH cap (baseline ${intent.startingBalanceEth} → now ${balance}) — STOP`,
			)
		}
		console.log(
			`✓ verify green — rollupVersion ${now.rollupVersion}, spend ${spent.toFixed(6)}/${cap} ETH (baseline ${intent.startingBalanceEth} → ${balance})`,
		)
	} else {
		// Legacy intent with no recorded baseline: fall back to printing (can't enforce a delta).
		console.log(
			`✓ verify green — rollupVersion ${now.rollupVersion}, signer balance ${balance} ETH (caps: ≤${intent.caps.maxTotalEthSpend} total spend; no baseline to enforce)`,
		)
	}
}

/**
 * Crash-safe, receipted promotion of BOTH candidates to their live paths:
 *   apps/tools/public/testnet-bridge.candidate.json      → testnet-bridge.json
 *   apps/tools/src/contracts/deployments.candidate.json  → deployments.json
 *
 * Invariant: verify → validate-in-memory → temp-write+rename → re-hash →
 * re-verify → receipt. The candidates are read ONCE into buffers and every later
 * step operates on/against those exact bytes; symlinked candidates or live paths
 * are rejected; each write is a same-directory temp + rename (atomic on one fs);
 * both written files are re-hashed against the source buffers and the drip
 * derivation is re-proven by the REAL verify-deployments gate over the live file.
 * Nothing here runs `git commit` — a crash at any point leaves only uncommitted
 * working-tree changes (never a partially-promoted COMMITTED state). NOTE the
 * live paths are operationally allowlisted, so tree discipline does NOT flag a
 * crash-interrupted pair; the recovery is to RE-RUN promote — it is idempotent
 * (re-verifies and rewrites BOTH targets from the same pinned candidates) and
 * converges the pair before anything is committed (codex audit).
 *
 * Zero-seed assertion (this arc deploys no fuel/router and seeds no WETH): the
 * candidate's `l1.fuel` section must be BYTE-carried from the current live
 * manifest — new or changed fuel infrastructure hard-fails the promotion.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (91 lines) — split when touched, never grow
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 35) — refactor when touched, never raise
async function promote(intentPath: string, opts: { bridgeOnly?: boolean; dropSwap?: boolean; restoreSwap?: boolean } = {}): Promise<void> {
	// --bridge-only: a bridge cutover that touches NO drip deployment. The drip
	// candidate is not required; instead the LIVE drip manifest is digest-pinned before/after so the
	// promotion provably leaves it byte-identical.
	const bridgeOnly = opts.bridgeOnly === true
	const bridgeCandidatePath = join(repoRoot, "apps/tools/public/testnet-bridge.candidate.json")
	const bridgeLivePath = join(repoRoot, "apps/tools/public/testnet-bridge.json")
	const dripCandidatePath = join(repoRoot, "apps/tools/src/contracts/deployments.candidate.json")
	const dripLivePath = join(repoRoot, "apps/tools/src/contracts/deployments.json")

	// 0. The recorded candidate digest is REQUIRED BEFORE promote's own verify runs — verify
	// RECORDS a missing digest, so checking after it would always pass (the one-time recording
	// regime would never have happened; codex bug-bash r2 HIGH). Read + require FIRST.
	const intent = JSON.parse(readFileSync(intentPath, "utf8")) as DeployIntent
	if (!intent.candidateSha256) {
		throw new Error("intent has no recorded candidateSha256 — run verify --candidate (and commit the intent) BEFORE promote — STOP")
	}

	// 0b. The full gate, candidate-pinned, immediately before anything is written (re-pins the
	// candidate bytes against the digest required above).
	await verify(intentPath, bridgeCandidatePath)

	// 0c. The FPC require-deployed gate as CODE, not operator discipline (review finding #6):
	// promotion enables the app's Fuel tab, which hard-uses PRIVATE_FPC_ADDRESS — an
	// undeployed or upgraded-out FPC at that address must abort the promotion.
	run("bun", [join(here, "check-fpc-version.ts"), "--mode", "require-deployed"], { stdio: "inherit" })

	// 1. Symlink rejection on every involved path (a symlinked live target would
	// redirect the rename; a symlinked candidate breaks the read-once contract).
	const involvedPaths = bridgeOnly
		? [bridgeCandidatePath, bridgeLivePath, dripLivePath]
		: [bridgeCandidatePath, dripCandidatePath, bridgeLivePath, dripLivePath]
	for (const p of involvedPaths) {
		let st: ReturnType<typeof lstatSync> | undefined
		try {
			st = lstatSync(p)
		} catch {
			if (p === bridgeCandidatePath || (!bridgeOnly && p === dripCandidatePath))
				throw new Error(`candidate missing: ${p} — nothing to promote`)
			if (bridgeOnly && p === dripLivePath)
				throw new Error(`--bridge-only requires an existing live drip manifest to pin: ${p} — STOP`)
			continue // a live target may not exist yet — rename will create it
		}
		if (st.isSymbolicLink()) throw new Error(`refusing to promote through a symlink: ${p}`)
	}

	// 2. Read ONCE into buffers + validate the exact bytes that will be written. The
	// bridge buffer must equal the RECORDED digest — verify() above read the file
	// separately, and an edit between the two reads would otherwise ship bytes that
	// skipped the digest pin + privileged readbacks (review finding #4).
	const bridgeBytes = readFileSync(bridgeCandidatePath)
	const dripBytes = bridgeOnly ? null : readFileSync(dripCandidatePath)
	const bridgeSha = createHash("sha256").update(bridgeBytes).digest("hex")
	const dripSha = dripBytes ? createHash("sha256").update(dripBytes).digest("hex") : null
	// The bridge-only pin: the live drip manifest's digest BEFORE any write; re-asserted after.
	const dripLivePin = bridgeOnly ? createHash("sha256").update(readFileSync(dripLivePath)).digest("hex") : null
	if (bridgeSha !== intent.candidateSha256) {
		throw new Error(
			`bridge candidate bytes changed between verify and promote: ${bridgeSha} != recorded ${intent.candidateSha256} — STOP`,
		)
	}
	const bridgeCandidate = parseCandidateManifest(JSON.parse(bridgeBytes.toString("utf8")))
	if (dripBytes) {
		assertDripCandidateShape(JSON.parse(dripBytes.toString("utf8")))

		// 2b. Prove the drip CANDIDATE's derivation BEFORE any live write:
		// previously a junk candidate failed only AFTER the live file was overwritten.
		run("bun", [join(repoRoot, "apps/tools/scripts/verify-deployments.ts"), "--config", dripCandidatePath], {
			stdio: "inherit",
		})
	}

	// 3. Zero-seed assertion: fuel section byte-carried from live (or absent in both).
	let liveFuel: unknown
	try {
		liveFuel = (JSON.parse(readFileSync(bridgeLivePath, "utf8")) as { l1?: { fuel?: unknown } }).l1?.fuel
	} catch {
		liveFuel = undefined
	}
	assertZeroSeed(bridgeCandidate.l1.fuel, liveFuel, {
		allowSwapDrop: opts.dropSwap === true,
		allowSwapAdd: opts.restoreSwap === true,
	})

	// 4. Temp-write + same-directory rename, then re-hash the written outputs.
	const writes: Array<[string, Buffer, string]> =
		dripBytes && dripSha
			? [
					[bridgeLivePath, bridgeBytes, bridgeSha],
					[dripLivePath, dripBytes, dripSha],
				]
			: [[bridgeLivePath, bridgeBytes, bridgeSha]]
	for (const [target, bytes, sha] of writes) {
		mkdirSync(dirname(target), { recursive: true })
		const tmp = `${target}.promote-tmp`
		// A pre-planted tmp (symlink or file) must not be followed or reused: remove it,
		// then exclusive-create so a racing recreate fails loudly (review finding #10).
		rmSync(tmp, { force: true })
		writeFileSync(tmp, bytes, { flag: "wx" })
		renameSync(tmp, target)
		const written = createHash("sha256").update(readFileSync(target)).digest("hex")
		if (written !== sha) throw new Error(`re-hash mismatch after write: ${target} ${written} != ${sha} — investigate before committing`)
	}

	// 5. Re-verify the LIVE files: strict-parse the bridge manifest as written, and
	// re-prove the drip derivation through the real gate.
	parseCandidateManifest(JSON.parse(readFileSync(bridgeLivePath, "utf8")))
	run("bun", [join(repoRoot, "apps/tools/scripts/verify-deployments.ts")], {
		stdio: "inherit",
		env: { ...process.env, BRIDGE_MANIFEST: bridgeLivePath },
	})
	if (dripLivePin) {
		const after = createHash("sha256").update(readFileSync(dripLivePath)).digest("hex")
		if (after !== dripLivePin) {
			throw new Error(`--bridge-only violated: live drip manifest changed (${after} != pinned ${dripLivePin}) — investigate NOW`)
		}
	}

	// 6. Promotion receipt — committed by the operator alongside the promoted files.
	const receiptPath = join(repoRoot, "implementations-plan/aztec-5.0.1-line/lessons/promotion-receipt.json")
	mkdirSync(dirname(receiptPath), { recursive: true })
	const commit = git(["rev-parse", "HEAD"], repoRoot)
	writeFileSync(
		receiptPath,
		`${JSON.stringify(
			{
				promotedAt: new Date().toISOString(),
				intent: intentPath,
				commitAtPromotion: commit,
				mode: bridgeOnly ? "bridge-only" : "bridge+drip",
				bridge: { candidateSha256: bridgeSha, live: "apps/tools/public/testnet-bridge.json" },
				drip: dripSha
					? { candidateSha256: dripSha, live: "apps/tools/src/contracts/deployments.json" }
					: { unchangedSha256: dripLivePin, live: "apps/tools/src/contracts/deployments.json" },
				zeroSeed: opts.restoreSwap
					? "l1.fuel.core byte-carried; swap RESTORED (--restore-swap, pools seeded this arc)"
					: opts.dropSwap
						? "l1.fuel.core byte-carried; swap RETIRED (--drop-swap, token cutover); no fuel/router deploys this arc"
						: "l1.fuel byte-carried from live; no fuel/router deploys, no WETH seed this arc",
			},
			null,
			"\t",
		)}\n`,
	)
	console.log(`✓ promoted both candidates; receipt at ${receiptPath} — commit the promoted files + receipt together`)
}

// CLI dispatch — guarded so importing this module (e.g. for PLAN_PINNED_L1_SIGNER)
// never triggers argv parsing / process.exit.
const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === resolvePath(process.argv[1]) : false
if (isMain) {
	const [, , cmd, intentPath, ...rest] = process.argv
	if (!cmd || !intentPath) {
		console.error("usage: live-intent.ts build|verify|promote <intent-path> [--candidate <path>]")
		process.exit(1)
	}
	const candidateFlag = rest.indexOf("--candidate")
	const candidatePath = candidateFlag !== -1 ? rest[candidateFlag + 1] : undefined
	const bridgeOnly = rest.includes("--bridge-only")
	const dropSwap = rest.includes("--drop-swap")
	const restoreSwap = rest.includes("--restore-swap")
	const dispatch =
		cmd === "build"
			? build(intentPath)
			: cmd === "verify"
				? verify(intentPath, candidatePath)
				: cmd === "promote"
					? promote(intentPath, { bridgeOnly, dropSwap, restoreSwap })
					: Promise.reject(new Error(`unknown command ${cmd}`))
	dispatch.catch((err) => {
		console.error(`✗ ${err instanceof Error ? err.message : err}`)
		process.exit(1)
	})
}
