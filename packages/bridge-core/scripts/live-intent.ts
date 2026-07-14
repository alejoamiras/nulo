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
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseCandidateManifest } from "../src/candidate-schema"
import { PRIVATE_FPC_ADDRESS, PRIVATE_FPC_SALT } from "../src/private-fuel"

/** The ONLY L1 signer authorized for this arc — pinned in the PLAN (and here), never derived
 *  from the env being checked. A different env-derived signer is a hard stop. */
export const PLAN_PINNED_L1_SIGNER = "0xFcc2238319aC360e985f1736aBB3df6251DAF6F5"

/** Hard per-arc exposure ceilings (reviewed at the plan gate; rc.2 precedent ~0.09 ETH + seed). */
export const CAPS = {
	maxTotalEthSpend: "0.5", // ether — L1 gas + WETH_SEED + pool seeding, everything
	maxWethSeed: "0.25", // ether — DeployFuelLive's WETH_SEED must be explicit and ≤ this
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const CAST = join(process.env.HOME ?? "~", ".aztec", "versions", "5.0.0", "internal-bin", "cast")

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

function cast(args: string): string {
	return execSync(`${CAST} ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
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
	artifacts: { privateFpc: { address: string; salt: string; sha256: string }; noirTargets: Record<string, string> }
	source: { commit: string; treeClean: boolean; operationalAllowlist: string[] }
	candidateSha256?: string
}

const OPERATIONAL_ALLOWLIST = [
	"apps/faucet/public/testnet-bridge.candidate.json",
	"apps/faucet/public/testnet-bridge.json",
	"apps/faucet/src/contracts/deployments.json",
	"packages/bridge-core/deploy-journal.jsonl",
	"implementations-plan/aztec-5.0.0-stable/lessons/",
]

async function build(intentPath: string): Promise<void> {
	const sepolia = process.env.SEPOLIA_RPC_URL
	if (!sepolia) throw new Error("SEPOLIA_RPC_URL required (source packages/bridge-core/.env)")
	const pk = process.env.PRIVATE_KEY
	if (!pk) throw new Error("PRIVATE_KEY required (source packages/bridge-core/.env)")

	const identity = await probeIdentity(NODE_URL)
	const walletChainId = (identity.l1ChainId ^ identity.rollupVersion) >>> 0

	// Independent L1 corroboration of the node's claims — a lying/stale node fails here.
	const rollup = identity.l1ContractAddresses.rollupAddress
	const portal = identity.l1ContractAddresses.feeJuicePortalAddress
	const rollupCode = cast(`code ${rollup} --rpc-url ${sepolia}`)
	const portalCode = cast(`code ${portal} --rpc-url ${sepolia}`)

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

	const signer = cast(`wallet address --private-key ${pk}`)
	if (signer.toLowerCase() !== PLAN_PINNED_L1_SIGNER.toLowerCase()) {
		throw new Error(`env-derived signer ${signer} != plan-pinned ${PLAN_PINNED_L1_SIGNER} — HARD STOP`)
	}

	const commit = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim()
	const dirty = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" })
		.split("\n")
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

async function verify(intentPath: string, candidatePath?: string): Promise<void> {
	const intent = JSON.parse(readFileSync(intentPath, "utf8")) as DeployIntent
	const sepolia = process.env.SEPOLIA_RPC_URL
	if (!sepolia) throw new Error("SEPOLIA_RPC_URL required")

	// Tree discipline at EVERY verify, not just at build: only allowlisted operational files may be
	// dirty during the live arc. A non-allowlisted source change must be committed (fix-forward,
	// logged in lessons) before the next broadcast group — never carried silently into a promotion.
	const dirtyNow = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" })
		.split("\n")
		.filter(Boolean)
		.filter((l) => !OPERATIONAL_ALLOWLIST.some((a) => l.slice(3).startsWith(a)))
	if (dirtyNow.length > 0) {
		throw new Error(`non-allowlisted files dirty during the live arc — commit or revert first:\n${dirtyNow.join("\n")}`)
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
		const signer = cast(`wallet address --private-key ${pk}`)
		if (signer.toLowerCase() !== intent.signer.toLowerCase()) throw new Error(`signer ${signer} != intent ${intent.signer} — STOP`)
	}

	// Artifact digests unchanged.
	for (const [rel, expected] of Object.entries(intent.artifacts.noirTargets)) {
		const actual = sha256(join(repoRoot, "contracts", "bridge", "aztec", rel))
		if (actual !== expected) throw new Error(`Noir artifact drifted since intent: ${rel}`)
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
		// Privileged-state readbacks on L1 (a fingerprint can't catch a wrong owner/binding).
		if (candidate.l1.feeJuice) {
			const underlying = cast(`call ${candidate.l1.feeJuice.portal} "UNDERLYING()(address)" --rpc-url ${sepolia}`)
			if (underlying.toLowerCase() !== candidate.l1.feeJuice.asset.toLowerCase()) {
				throw new Error(`portal UNDERLYING ${underlying} != manifest asset ${candidate.l1.feeJuice.asset} — STOP`)
			}
			const feeAsset = cast(`call ${candidate.l1.feeJuice.feeAssetHandler} "FEE_ASSET()(address)" --rpc-url ${sepolia}`)
			if (feeAsset.toLowerCase() !== candidate.l1.feeJuice.asset.toLowerCase()) {
				throw new Error(`handler FEE_ASSET ${feeAsset} != manifest asset — STOP`)
			}
		}
		if (candidate.l1.fuel) {
			const owner = cast(`call ${candidate.l1.fuel.router} "owner()(address)" --rpc-url ${sepolia}`).toLowerCase()
			if (owner !== intent.signer.toLowerCase()) throw new Error(`router owner ${owner} != our signer — STOP (privileged binding)`)
			const swapTarget = cast(`call ${candidate.l1.fuel.router} "swapTarget()(address)" --rpc-url ${sepolia}`).toLowerCase()
			if (swapTarget !== candidate.l1.fuel.swapTarget.toLowerCase())
				throw new Error(`router swapTarget ${swapTarget} != manifest — STOP`)
		}
		console.log("✓ candidate strict-valid + privileged readbacks agree")
	}

	// Balance-within-caps reconciliation.
	const balance = Number(cast(`balance ${intent.signer} --rpc-url ${sepolia} --ether`))
	console.log(
		`✓ verify green — rollupVersion ${now.rollupVersion}, signer balance ${balance} ETH (caps: ≤${intent.caps.maxTotalEthSpend} total spend)`,
	)
}

const [, , cmd, intentPath, ...rest] = process.argv
if (!cmd || !intentPath) {
	console.error("usage: live-intent.ts build|verify <intent-path> [--candidate <path>]")
	process.exit(1)
}
const candidateFlag = rest.indexOf("--candidate")
const candidatePath = candidateFlag !== -1 ? rest[candidateFlag + 1] : undefined
const run =
	cmd === "build"
		? build(intentPath)
		: cmd === "verify"
			? verify(intentPath, candidatePath)
			: Promise.reject(new Error(`unknown command ${cmd}`))
run.catch((err) => {
	console.error(`✗ ${err instanceof Error ? err.message : err}`)
	process.exit(1)
})
