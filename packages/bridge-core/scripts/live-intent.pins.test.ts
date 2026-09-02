/**
 * Characterization pins for `live-intent.ts verify` / `promote` — the testnet promotion gates —
 * driven with NO process, network or filesystem side effects: `./run` (run/git/resolveBin) and
 * `fetch` are scripted per case and DEFAULT-DENY (an unscripted call throws), and `node:fs` is
 * an overlay (a per-case map with tombstones; reads of untouched paths fall back to the real
 * file, writes never leave the map). Every boundary call appends to ONE ordered event stream,
 * so a case can assert the exact green trace or that the failing call happened and nothing
 * after it ran. The overlay's assumptions about the real fs are proven on a temp dir at the end.
 */
import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const h = vi.hoisted(() => {
	const repo = process.cwd().replace(/[\\/]packages[\\/]bridge-core$/, "")
	const state = {
		repo,
		events: [] as string[],
		files: new Map<string, Buffer>(),
		tombstones: new Set<string>(),
		symlinks: new Set<string>(),
		scripts: new Map<string, string | Error>(),
		/** JSON-RPC answers keyed `<url> <method>`; an unscripted call throws. */
		rpc: new Map<string, unknown>(),
		/** `resolveBin` calls, kept across cases: the script caches the cast path at module level. */
		resolves: [] as string[],
		logs: [] as string[],
	}
	const rel = (p: unknown) => String(p).split(repo).join("<repo>")
	const key = (bin: string, args: readonly string[]) => rel(`${bin} ${args.join(" ")}`)
	const reset = () => {
		// A fresh array: cases that hook `events.push` must not leak the hook into the next case.
		state.events = []
		state.files.clear()
		state.tombstones.clear()
		state.symlinks.clear()
		state.scripts.clear()
		state.rpc.clear()
		state.logs.length = 0
	}
	return { state, rel, key, reset }
})

vi.mock("./run", () => {
	type Opts = { cwd?: string; stdio?: unknown; env?: NodeJS.ProcessEnv; check?: boolean; maxBuffer?: number }
	// The event carries what the script passed BESIDES argv: cwd, stdio, and every env entry that
	// differs from the process env (the live verifier's BRIDGE_MANIFEST) — a regression that drops
	// or changes any of them breaks the golden trace.
	const envExtras = (env?: NodeJS.ProcessEnv) => {
		const extra: Record<string, string> = {}
		for (const [k, v] of Object.entries(env ?? {})) if (v !== undefined && process.env[k] !== v) extra[k] = h.rel(v)
		return extra
	}
	const project = (opts?: Opts) => {
		if (!opts) return ""
		const tag: Record<string, unknown> = {}
		if (opts.cwd) tag.cwd = h.rel(opts.cwd)
		if (opts.stdio) tag.stdio = opts.stdio
		if (opts.check !== undefined) tag.check = opts.check
		if (opts.maxBuffer !== undefined) tag.maxBuffer = opts.maxBuffer
		if (opts.env) {
			tag.env = envExtras(opts.env)
			// `{ ...process.env, X }` vs `{ X }`: the latter would drop PATH and the RPC credentials.
			tag.inheritsProcessEnv = opts.env.PATH === process.env.PATH
		}
		return Object.keys(tag).length ? ` ${JSON.stringify(tag)}` : ""
	}
	// The event serialises the argv ARRAY (never a joined string, so `["--mode","x"]` and
	// `["--mode x"]` cannot collide); the script table is keyed by the joined form for brevity.
	const runImpl = (bin: string, args: readonly string[], opts?: Opts) => {
		const k = h.key(bin, args)
		h.state.events.push(`run ${bin} ${h.rel(JSON.stringify(args))}${project(opts)}`)
		const scripted = h.state.scripts.get(k)
		if (scripted === undefined) throw new Error(`unscripted run: ${k}`)
		if (scripted instanceof Error) throw scripted
		return { exitCode: 0, signal: null, stdout: scripted, stderr: "" }
	}
	return {
		run: runImpl,
		git: (args: readonly string[], cwd: string) => runImpl("git", args, { cwd }).stdout.trim(),
		resolveBin: (name: string, opts: { envVar: string; prefer: string }) => {
			h.state.resolves.push(`${name} ${opts.envVar} ${opts.prefer}`)
			const scripted = h.state.scripts.get(`resolveBin ${name}`)
			if (scripted === undefined) throw new Error(`unscripted resolveBin: ${name}`)
			if (scripted instanceof Error) throw scripted
			return scripted
		},
	}
})

vi.mock("../src/private-fuel", () => ({
	PRIVATE_FPC_ADDRESS: `0x${"11".repeat(32)}`,
	PRIVATE_FPC_SALT: `0x${"00".repeat(31)}01`,
}))

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>()
	const enoent = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" })
	const eexist = (p: string) => Object.assign(new Error(`EEXIST: file already exists, open '${p}'`), { code: "EEXIST" })
	// A tombstone wins over both the map and the real file until a later write clears it.
	const exists = (p: string) => !h.state.tombstones.has(p) && (h.state.files.has(p) || actual.existsSync(p))
	return {
		...actual,
		readFileSync: (p: string, enc?: unknown) => {
			h.state.events.push(`read ${h.rel(p)}`)
			if (h.state.tombstones.has(p)) throw enoent(p)
			const inMap = h.state.files.get(p)
			if (!inMap && !actual.existsSync(p)) throw enoent(p)
			if (inMap) return enc ? inMap.toString("utf8") : Buffer.from(inMap)
			return actual.readFileSync(p, enc as BufferEncoding)
		},
		writeFileSync: (p: string, data: string | Buffer, opts?: { flag?: string }) => {
			h.state.events.push(`write ${h.rel(p)}${opts?.flag ? ` ${opts.flag}` : ""}`)
			if (opts?.flag === "wx" && (exists(p) || h.state.symlinks.has(p))) throw eexist(p)
			h.state.files.set(p, Buffer.from(data))
			h.state.tombstones.delete(p)
		},
		renameSync: (from: string, to: string) => {
			h.state.events.push(`rename ${h.rel(from)} -> ${h.rel(to)}`)
			const bytes = h.state.files.get(from)
			if (!bytes) throw enoent(from)
			h.state.files.delete(from)
			h.state.files.set(to, bytes)
			h.state.tombstones.delete(to)
		},
		rmSync: (p: string) => {
			h.state.events.push(`rm ${h.rel(p)}`)
			h.state.files.delete(p)
			h.state.symlinks.delete(p)
			h.state.tombstones.add(p)
		},
		mkdirSync: (p: string) => {
			h.state.events.push(`mkdir ${h.rel(p)}`)
		},
		lstatSync: (p: string) => {
			h.state.events.push(`lstat ${h.rel(p)}`)
			if (h.state.symlinks.has(p)) return { isSymbolicLink: () => true }
			if (exists(p)) return { isSymbolicLink: () => false }
			throw enoent(p)
		},
	}
})

import { readFileSync as readReal } from "node:fs"
import { join } from "node:path"
import { promote, verify } from "./live-intent"

// ── Fixtures ─────────────────────────────────────────────────────────────────
const REPO = h.state.repo
const SEPOLIA = "https://sepolia.example/rpc"
const NODE_URL = "https://node.example"
const SIGNER = "0xFcc2238319aC360e985f1736aBB3df6251DAF6F5"
const PK = "ab".repeat(32)
const COMMIT = "39de187a444e623f76ced479b07a5dd322ce10c7"
const INTENT_PATH = join(REPO, "implementations-plan/aztec-5.0.1-line/lessons/intent.json")
const BRIDGE_CANDIDATE = join(REPO, "apps/tools/public/testnet-bridge.candidate.json")
const BRIDGE_LIVE = join(REPO, "apps/tools/public/testnet-bridge.json")
const DRIP_CANDIDATE = join(REPO, "apps/tools/src/contracts/deployments.candidate.json")
const DRIP_LIVE = join(REPO, "apps/tools/src/contracts/deployments.json")
const RECEIPT = join(REPO, "implementations-plan/aztec-5.0.1-line/lessons/promotion-receipt.json")
const NOIR = [
	"token_bridge/target/token_bridge_contract-TokenBridge.json",
	"token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json",
	"keystone/target/keystone.json",
]
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex")

/** The live testnet manifest is a strict-valid candidate; its fee-juice pins match the intent. */
const liveManifest = JSON.parse(readReal(BRIDGE_LIVE, "utf8")) as {
	l1: { feeJuice: { portal: string; asset: string; feeAssetHandler?: string }; fuel: { core: { router: string; swapTarget: string } } }
}
const canonicalFpcSha = (
	JSON.parse(readReal(join(REPO, "packages/bridge-core/src/private-fpc-canonical.json"), "utf8")) as { artifactSha256: string }
).artifactSha256

function baseIntent(): Record<string, unknown> {
	return {
		builtAt: "2026-07-18T21:32:35.033Z",
		primaryRpc: NODE_URL,
		identity: { nodeVersion: "5.0.0", l1ChainId: 11155111, rollupVersion: 1821665230, walletChainId: 1816023401 },
		l1: {
			rollup: "0xd73a91bdcf6891c7642f3e460036e1ef2cc23178",
			feeJuicePortal: liveManifest.l1.feeJuice.portal,
			feeJuice: liveManifest.l1.feeJuice.asset,
			feeAssetHandler: liveManifest.l1.feeJuice.feeAssetHandler,
			registry: "0xa0bfb1b494fb49041e5c6e8c2c1be09cd171c6ba",
		},
		l1Corroboration: { rollupHasCode: true, portalHasCode: true, source: "direct eth_getCode via SEPOLIA_RPC_URL" },
		secondEndpoint: { posture: "SINGLE-L2-NODE" },
		signer: SIGNER,
		caps: { maxTotalEthSpend: "2.0", maxWethSeed: "1.5" },
		startingBalanceEth: 8.5,
		artifacts: {
			privateFpc: { address: `0x${"11".repeat(32)}`, salt: `0x${"00".repeat(31)}01`, sha256: canonicalFpcSha },
			noirTargets: Object.fromEntries(NOIR.map((rel) => [rel, sha(`artifact:${rel}`)])),
		},
		source: { commit: COMMIT, treeClean: true, operationalAllowlist: [] },
	}
}

function identityFor(intent: Record<string, unknown>) {
	const i = intent.identity as { nodeVersion: string; l1ChainId: number; rollupVersion: number }
	const l1 = intent.l1 as { rollup: string }
	return {
		nodeVersion: i.nodeVersion,
		l1ChainId: i.l1ChainId,
		rollupVersion: i.rollupVersion,
		l1ContractAddresses: { rollupAddress: l1.rollup },
	}
}

const put = (p: string, data: string | Buffer) => h.state.files.set(p, Buffer.from(data))
const script = (k: string, out: string | Error = "") => h.state.scripts.set(k, out)
const events = () => [...h.state.events]
const logs = () => [...h.state.logs]

/** A green `verify --candidate` world: intent recorded against the live manifest bytes. */
function greenWorld(opts: { recorded?: boolean; balance?: string } = {}) {
	const candidate = Buffer.from(readReal(BRIDGE_LIVE))
	const intent = baseIntent()
	if (opts.recorded !== false) intent.candidateSha256 = sha(candidate)
	put(INTENT_PATH, JSON.stringify(intent, null, "\t"))
	put(BRIDGE_CANDIDATE, candidate)
	for (const rel of NOIR) put(join(REPO, "contracts", "bridge", "aztec", rel), `artifact:${rel}`)
	h.state.rpc.set(`${NODE_URL} node_getNodeInfo`, identityFor(intent))
	script("resolveBin cast", "cast")
	script(`git --literal-pathspecs status --porcelain -- ${h.rel(INTENT_PATH)}`, "")
	script("git status --porcelain", "")
	script(`git diff --name-only --end-of-options ${COMMIT} HEAD --`, "")
	script(`cast wallet address --private-key ${PK}`, SIGNER)
	const fj = liveManifest.l1.feeJuice
	script(`cast call ${fj.portal} UNDERLYING()(address) --rpc-url ${SEPOLIA}`, fj.asset)
	if (fj.feeAssetHandler) script(`cast call ${fj.feeAssetHandler} FEE_ASSET()(address) --rpc-url ${SEPOLIA}`, fj.asset)
	const core = liveManifest.l1.fuel.core
	script(`cast call ${core.router} owner()(address) --rpc-url ${SEPOLIA}`, SIGNER.toLowerCase())
	script(`cast call ${core.router} swapTarget()(address) --rpc-url ${SEPOLIA}`, core.swapTarget)
	script(`cast balance ${SIGNER} --rpc-url ${SEPOLIA} --ether`, opts.balance ?? "8.0")
	// The fixture reads above went through the overlay too; the trace starts with the call under test.
	h.state.events.length = 0
	return { intent, candidate }
}

/** Extends a green verify world into a green bridge+drip promote world. */
function promoteWorld(opts: { bridgeOnly?: boolean } = {}) {
	const world = greenWorld()
	const drip = Buffer.from(JSON.stringify({ tokens: [{ constructorArgs: { authContract: `0x${"cd".repeat(32)}` } }], dripper: {} }))
	put(BRIDGE_LIVE, world.candidate)
	if (opts.bridgeOnly) put(DRIP_LIVE, drip)
	else put(DRIP_CANDIDATE, drip)
	script("run bun <repo>/packages/bridge-core/scripts/check-fpc-version.ts --mode require-deployed".slice(4), "")
	script(`bun <repo>/apps/tools/scripts/verify-deployments.ts --config ${h.rel(DRIP_CANDIDATE)}`, "")
	script("bun <repo>/apps/tools/scripts/verify-deployments.ts", "")
	script("git rev-parse HEAD", COMMIT)
	h.state.events.length = 0
	return { ...world, drip }
}

const IN_REPO = ' {"cwd":"<repo>"}'
const CAST_IO = ' {"stdio":["ignore","pipe","pipe"]}'
const VERIFY_GREEN_TRACE = [
	"read <repo>/implementations-plan/aztec-5.0.1-line/lessons/intent.json",
	`run git ["--literal-pathspecs","status","--porcelain","--","<repo>/implementations-plan/aztec-5.0.1-line/lessons/intent.json"]${IN_REPO}`,
	`run git ["status","--porcelain"]${IN_REPO}`,
	`run git ["diff","--name-only","--end-of-options","39de187a444e623f76ced479b07a5dd322ce10c7","HEAD","--"]${IN_REPO}`,
	"fetch https://node.example node_getNodeInfo []",
	`run cast ["wallet","address","--private-key","abababababababababababababababababababababababababababababababab"]${CAST_IO}`,
	"read <repo>/contracts/bridge/aztec/token_bridge/target/token_bridge_contract-TokenBridge.json",
	"read <repo>/contracts/bridge/aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json",
	"read <repo>/contracts/bridge/aztec/keystone/target/keystone.json",
	"read <repo>/packages/bridge-core/src/private-fpc-canonical.json",
	"read <repo>/apps/tools/public/testnet-bridge.candidate.json",
	`run cast ["call","0xb4a9f8eadc8ca944729d61e59a9f491faff237a3","UNDERLYING()(address)","--rpc-url","https://sepolia.example/rpc"]${CAST_IO}`,
	`run cast ["call","0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9","FEE_ASSET()(address)","--rpc-url","https://sepolia.example/rpc"]${CAST_IO}`,
	`run cast ["call","0x78365a471dfce304f25d0382cdbd65b2b7935820","owner()(address)","--rpc-url","https://sepolia.example/rpc"]${CAST_IO}`,
	`run cast ["call","0x78365a471dfce304f25d0382cdbd65b2b7935820","swapTarget()(address)","--rpc-url","https://sepolia.example/rpc"]${CAST_IO}`,
	`run cast ["balance","0xFcc2238319aC360e985f1736aBB3df6251DAF6F5","--rpc-url","https://sepolia.example/rpc","--ether"]${CAST_IO}`,
]

const PROMOTE_GREEN_TRACE = [
	"read <repo>/implementations-plan/aztec-5.0.1-line/lessons/intent.json",
	...VERIFY_GREEN_TRACE,
	'run bun ["<repo>/packages/bridge-core/scripts/check-fpc-version.ts","--mode","require-deployed"] {"stdio":"inherit"}',
	"lstat <repo>/apps/tools/public/testnet-bridge.candidate.json",
	"lstat <repo>/apps/tools/src/contracts/deployments.candidate.json",
	"lstat <repo>/apps/tools/public/testnet-bridge.json",
	"lstat <repo>/apps/tools/src/contracts/deployments.json",
	"read <repo>/apps/tools/public/testnet-bridge.candidate.json",
	"read <repo>/apps/tools/src/contracts/deployments.candidate.json",
	'run bun ["<repo>/apps/tools/scripts/verify-deployments.ts","--config","<repo>/apps/tools/src/contracts/deployments.candidate.json"] {"stdio":"inherit"}',
	"read <repo>/apps/tools/public/testnet-bridge.json",
	"mkdir <repo>/apps/tools/public",
	"rm <repo>/apps/tools/public/testnet-bridge.json.promote-tmp",
	"write <repo>/apps/tools/public/testnet-bridge.json.promote-tmp wx",
	"rename <repo>/apps/tools/public/testnet-bridge.json.promote-tmp -> <repo>/apps/tools/public/testnet-bridge.json",
	"read <repo>/apps/tools/public/testnet-bridge.json",
	"mkdir <repo>/apps/tools/src/contracts",
	"rm <repo>/apps/tools/src/contracts/deployments.json.promote-tmp",
	"write <repo>/apps/tools/src/contracts/deployments.json.promote-tmp wx",
	"rename <repo>/apps/tools/src/contracts/deployments.json.promote-tmp -> <repo>/apps/tools/src/contracts/deployments.json",
	"read <repo>/apps/tools/src/contracts/deployments.json",
	"read <repo>/apps/tools/public/testnet-bridge.json",
	'run bun ["<repo>/apps/tools/scripts/verify-deployments.ts"] {"stdio":"inherit","env":{"BRIDGE_MANIFEST":"<repo>/apps/tools/public/testnet-bridge.json"},"inheritsProcessEnv":true}',
	"mkdir <repo>/implementations-plan/aztec-5.0.1-line/lessons",
	`run git ["rev-parse","HEAD"]${IN_REPO}`,
	"write <repo>/implementations-plan/aztec-5.0.1-line/lessons/promotion-receipt.json",
]

const env = { SEPOLIA_RPC_URL: SEPOLIA, PRIVATE_KEY: PK }

beforeEach(() => {
	h.reset()
	for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
	vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
		const req = JSON.parse(init.body) as { method: string; params: unknown[] }
		h.state.events.push(`fetch ${url} ${req.method} ${JSON.stringify(req.params)}`)
		const answer = h.state.rpc.get(`${url} ${req.method}`)
		if (answer === undefined) throw new Error(`unscripted fetch: ${url} ${req.method}`)
		return { ok: true, json: async () => ({ result: answer }) }
	})
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		h.state.logs.push(args.map(String).join(" "))
	})
})
afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

// ── verify ────────────────────────────────────────────────────────────────────
describe("verify — the gate ladder", () => {
	test("green trace: the exact boundary sequence and the operator lines", async () => {
		greenWorld()
		await verify(INTENT_PATH, BRIDGE_CANDIDATE)
		expect(events()).toEqual(VERIFY_GREEN_TRACE)
		expect(logs()).toEqual([
			"✓ candidate strict-valid + privileged readbacks agree",
			"✓ verify green — rollupVersion 1821665230, spend 0.500000/2 ETH (baseline 8.5 → 8)",
		])
	})

	test("without a recorded digest the first candidate verify RECORDS it (writes the intent) after the strict parse, before the readbacks", async () => {
		const { candidate } = greenWorld({ recorded: false })
		await verify(INTENT_PATH, BRIDGE_CANDIDATE)
		const written = JSON.parse(h.state.files.get(INTENT_PATH)?.toString("utf8") ?? "{}") as { candidateSha256?: string }
		expect(written.candidateSha256).toBe(sha(candidate))
		const ev = events()
		expect(ev.indexOf(`write ${h.rel(INTENT_PATH)}`)).toBeGreaterThan(ev.indexOf(`read ${h.rel(BRIDGE_CANDIDATE)}`))
		expect(ev.indexOf(`write ${h.rel(INTENT_PATH)}`)).toBeLessThan(ev.findIndex((e) => e.includes("UNDERLYING()")))
		expect(logs()).toContain(`✓ candidate digest recorded: ${sha(candidate)}`)
		// An unrecorded intent skips the committed-intent check entirely.
		expect(ev.some((e) => e.includes("--literal-pathspecs"))).toBe(false)
	})

	test("an invalid candidate never records a digest and never reaches a readback", async () => {
		greenWorld({ recorded: false })
		put(BRIDGE_CANDIDATE, JSON.stringify({ network: "testnet" }))
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(/bridge manifest failed strict validation/)
		expect(events().some((e) => e.startsWith("write "))).toBe(false)
		expect(events().some((e) => e.includes('run cast ["call"'))).toBe(false)
	})

	test("a valid candidate whose readback fails leaves the digest recorded (verbatim ordering)", async () => {
		const { candidate } = greenWorld({ recorded: false })
		const fj = liveManifest.l1.feeJuice
		script(`cast call ${fj.portal} UNDERLYING()(address) --rpc-url ${SEPOLIA}`, `0x${"99".repeat(20)}`)
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(/portal UNDERLYING .* != manifest asset .* — STOP/)
		const written = JSON.parse(h.state.files.get(INTENT_PATH)?.toString("utf8") ?? "{}") as { candidateSha256?: string }
		expect(written.candidateSha256).toBe(sha(candidate))
	})

	test.each([
		[
			"intent uncommitted",
			() => script(`git --literal-pathspecs status --porcelain -- ${h.rel(INTENT_PATH)}`, " M intent.json"),
			/intent\.json is uncommitted/,
			'"--literal-pathspecs"',
			'["status","--porcelain"]',
		],
		[
			"non-allowlisted dirty tree",
			() => script("git status --porcelain", " M packages/bridge-core/src/x.ts"),
			/non-allowlisted files dirty during the live arc/,
			'["status","--porcelain"]',
			'["diff"',
		],
		[
			"deploy-relevant change since build",
			() => script(`git diff --name-only --end-of-options ${COMMIT} HEAD --`, "packages/bridge-core/src/x.ts\n"),
			/deploy-relevant files changed since the intent was built/,
			'["diff"',
			"fetch ",
		],
	] as const)("STOP: %s — the failing call ran and nothing after it did", async (_name, arm, message, failingCall, nextStage) => {
		greenWorld()
		arm()
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(message)
		expect(events().some((e) => e.includes(failingCall))).toBe(true)
		expect(events().some((e) => e.includes(nextStage))).toBe(false)
	})

	test("allowlisted-only dirt and allowlisted-only diffs pass the two tree gates", async () => {
		greenWorld()
		script(
			"git status --porcelain",
			" M implementations-plan/aztec-5.0.1-line/lessons/x.md\n?? packages/bridge-core/deploy-journal.jsonl",
		)
		script(`git diff --name-only --end-of-options ${COMMIT} HEAD --`, "apps/tools/public/testnet-bridge.json\n")
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).resolves.toBeUndefined()
	})

	test("a malformed source.commit never reaches git", async () => {
		const { intent } = greenWorld()
		;(intent.source as { commit: string }).commit = "HEAD; rm -rf /"
		put(INTENT_PATH, JSON.stringify(intent))
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(/intent\.source\.commit is not a 40-hex commit — STOP/)
		expect(events().some((e) => e.includes('["diff"'))).toBe(false)
	})

	test.each([
		[
			"rollupVersion",
			(id: Record<string, unknown>) => ({ ...id, rollupVersion: 7 }),
			/rollupVersion MOVED mid-arc: 7 != 1821665230 — STOP/,
		],
		["nodeVersion", (id: Record<string, unknown>) => ({ ...id, nodeVersion: "5.1.0" }), /nodeVersion moved: 5\.1\.0 != 5\.0\.0 — STOP/],
		[
			"rollup address",
			(id: Record<string, unknown>) => ({ ...id, l1ContractAddresses: { rollupAddress: `0x${"aa".repeat(20)}` } }),
			/rollup address moved — STOP/,
		],
	] as const)("identity: %s moved — after the tree gates, before the signer", async (_name, mutate, message) => {
		const { intent } = greenWorld()
		h.state.rpc.set(`${NODE_URL} node_getNodeInfo`, mutate(identityFor(intent) as unknown as Record<string, unknown>))
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(message)
		const ev = events()
		expect(ev.indexOf("fetch https://node.example node_getNodeInfo []")).toBeGreaterThan(ev.findIndex((e) => e.includes('["diff"')))
		expect(ev.some((e) => e.includes('"wallet","address"'))).toBe(false)
	})

	test("signer: a mismatch stops; no PRIVATE_KEY skips the check", async () => {
		greenWorld()
		script(`cast wallet address --private-key ${PK}`, `0x${"bb".repeat(20)}`)
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(/signer 0xbb.* != intent .* — STOP/)
		h.reset()
		greenWorld()
		vi.stubEnv("PRIVATE_KEY", "")
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).resolves.toBeUndefined()
		expect(events().some((e) => e.includes('"wallet","address"'))).toBe(false)
	})

	test("artifacts: a drifted Noir target, then a drifted canonical PrivateFPC, each stop before the candidate read", async () => {
		greenWorld()
		put(join(REPO, "contracts", "bridge", "aztec", NOIR[0]), "tampered")
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(`Noir artifact drifted since intent: ${NOIR[0]}`)
		expect(events().some((e) => e === `read ${h.rel(BRIDGE_CANDIDATE)}`)).toBe(false)
		h.reset()
		const { intent } = greenWorld()
		;(intent.artifacts as { privateFpc: { sha256: string } }).privateFpc.sha256 = "0".repeat(64)
		put(INTENT_PATH, JSON.stringify(intent))
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(/canonical PrivateFPC digest drifted since intent/)
	})

	test("candidate: bytes that no longer match the recorded digest are never parsed", async () => {
		greenWorld()
		put(BRIDGE_CANDIDATE, `${readReal(BRIDGE_LIVE, "utf8")}\n`)
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(/candidate digest CHANGED since recorded: .* — never promote/)
		expect(events().some((e) => e.includes('run cast ["call"'))).toBe(false)
	})

	test.each([
		[
			"portal pin",
			(i: Record<string, unknown>) => ((i.l1 as { feeJuicePortal: string }).feeJuicePortal = `0x${"22".repeat(20)}`),
			/candidate feeJuice\.portal .* != intent pin .* — STOP/,
		],
		[
			"asset pin",
			(i: Record<string, unknown>) => ((i.l1 as { feeJuice: string }).feeJuice = `0x${"33".repeat(20)}`),
			/candidate feeJuice\.asset .* != intent pin .* — STOP/,
		],
		[
			"handler pin",
			(i: Record<string, unknown>) => ((i.l1 as { feeAssetHandler: string }).feeAssetHandler = `0x${"44".repeat(20)}`),
			/candidate feeJuice\.feeAssetHandler .* != intent pin .* — STOP/,
		],
	] as const)("candidate vs intent: %s mismatch stops before any L1 readback of that leg", async (_name, mutate, message) => {
		const { intent, candidate } = greenWorld()
		mutate(intent)
		intent.candidateSha256 = sha(candidate)
		put(INTENT_PATH, JSON.stringify(intent))
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(message)
	})

	test("handler absent in the manifest (mainnet posture) skips the FEE_ASSET readback", async () => {
		const { intent } = greenWorld()
		const manifest = JSON.parse(readReal(BRIDGE_LIVE, "utf8")) as { l1: { feeJuice: { feeAssetHandler?: string } } }
		manifest.l1.feeJuice.feeAssetHandler = undefined
		const bytes = Buffer.from(JSON.stringify(manifest))
		put(BRIDGE_CANDIDATE, bytes)
		intent.candidateSha256 = sha(bytes)
		put(INTENT_PATH, JSON.stringify(intent))
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).resolves.toBeUndefined()
		expect(events().some((e) => e.includes("FEE_ASSET()"))).toBe(false)
	})

	test.each([
		[
			"FEE_ASSET",
			() =>
				script(
					`cast call ${liveManifest.l1.feeJuice.feeAssetHandler} FEE_ASSET()(address) --rpc-url ${SEPOLIA}`,
					`0x${"55".repeat(20)}`,
				),
			/handler FEE_ASSET .* != manifest asset — STOP/,
		],
		[
			"router owner",
			() => script(`cast call ${liveManifest.l1.fuel.core.router} owner()(address) --rpc-url ${SEPOLIA}`, `0x${"66".repeat(20)}`),
			/router owner .* != our signer — STOP \(privileged binding\)/,
		],
		[
			"router swapTarget",
			() =>
				script(`cast call ${liveManifest.l1.fuel.core.router} swapTarget()(address) --rpc-url ${SEPOLIA}`, `0x${"77".repeat(20)}`),
			/router swapTarget .* != manifest — STOP/,
		],
	] as const)("privileged readback: %s disagrees — stops before the balance read", async (_name, arm, message) => {
		greenWorld()
		arm()
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(message)
		expect(events().some((e) => e.includes('run cast ["balance"'))).toBe(false)
	})

	test("spend: over the cap stops; within the cap logs the delta; a legacy intent without a baseline logs the balance", async () => {
		greenWorld({ balance: "6.0" })
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).rejects.toThrow(
			/spend 2\.500000 ETH EXCEEDS the 2 ETH cap \(baseline 8\.5 → now 6\) — STOP/,
		)
		h.reset()
		greenWorld({ balance: "8.0" })
		await verify(INTENT_PATH, BRIDGE_CANDIDATE)
		expect(logs().at(-1)).toBe("✓ verify green — rollupVersion 1821665230, spend 0.500000/2 ETH (baseline 8.5 → 8)")
		h.reset()
		const { intent, candidate } = greenWorld({ balance: "8.0" })
		intent.startingBalanceEth = undefined
		intent.candidateSha256 = sha(candidate)
		put(INTENT_PATH, JSON.stringify(intent))
		await verify(INTENT_PATH, BRIDGE_CANDIDATE)
		expect(logs().at(-1)).toBe(
			"✓ verify green — rollupVersion 1821665230, signer balance 8 ETH (caps: ≤2.0 total spend; no baseline to enforce)",
		)
	})

	test("(AS-IS, owner disposition) a malformed balance is NaN and NaN > cap is false — verify stays green", async () => {
		greenWorld({ balance: "not-a-number" })
		await expect(verify(INTENT_PATH, BRIDGE_CANDIDATE)).resolves.toBeUndefined()
		expect(logs().at(-1)).toContain("spend NaN/2 ETH")
	})
})

// ── promote ───────────────────────────────────────────────────────────────────
describe("promote — the stage sequence", () => {
	test("green trace (bridge + drip): the exact boundary sequence, the live files, the receipt", async () => {
		const { candidate, drip } = promoteWorld()
		await promote(INTENT_PATH)
		expect(events()).toEqual(PROMOTE_GREEN_TRACE)
		expect(h.state.files.get(BRIDGE_LIVE)?.equals(candidate)).toBe(true)
		expect(h.state.files.get(DRIP_LIVE)?.equals(drip)).toBe(true)
		const receipt = JSON.parse(h.state.files.get(RECEIPT)?.toString("utf8") ?? "{}") as Record<string, unknown>
		expect(receipt).toMatchObject({
			intent: INTENT_PATH,
			commitAtPromotion: COMMIT,
			mode: "bridge+drip",
			bridge: { candidateSha256: sha(candidate), live: "apps/tools/public/testnet-bridge.json" },
			drip: { candidateSha256: sha(drip), live: "apps/tools/src/contracts/deployments.json" },
			zeroSeed: "l1.fuel byte-carried from live; no fuel/router deploys, no WETH seed this arc",
		})
		expect(logs().at(-1)).toBe(`✓ promoted both candidates; receipt at ${RECEIPT} — commit the promoted files + receipt together`)
	})

	test("a missing recorded digest stops before verify runs", async () => {
		promoteWorld()
		const intent = JSON.parse(h.state.files.get(INTENT_PATH)?.toString("utf8") ?? "{}") as Record<string, unknown>
		intent.candidateSha256 = undefined
		put(INTENT_PATH, JSON.stringify(intent))
		await expect(promote(INTENT_PATH)).rejects.toThrow(
			/intent has no recorded candidateSha256 — run verify --candidate .* BEFORE promote — STOP/,
		)
		expect(events().some((e) => e.startsWith("run ") || e.startsWith("fetch "))).toBe(false)
	})

	test("the FPC require-deployed gate fails → no lstat, no read-once, no write", async () => {
		promoteWorld()
		script(
			"bun <repo>/packages/bridge-core/scripts/check-fpc-version.ts --mode require-deployed",
			new Error("bun failed (exit 1): FPC not deployed"),
		)
		await expect(promote(INTENT_PATH)).rejects.toThrow(/FPC not deployed/)
		expect(events().some((e) => e.startsWith("lstat ") || e.startsWith("write ") || e.startsWith("rename "))).toBe(false)
	})

	test("symlink rejection runs after the FPC gate, over every involved path, before any read-once", async () => {
		promoteWorld()
		h.state.symlinks.add(BRIDGE_LIVE)
		await expect(promote(INTENT_PATH)).rejects.toThrow(`refusing to promote through a symlink: ${BRIDGE_LIVE}`)
		const ev = events()
		expect(ev.findIndex((e) => e.startsWith("lstat "))).toBeGreaterThan(ev.findIndex((e) => e.includes("check-fpc-version")))
		expect(ev.filter((e) => e.startsWith("write ")).length).toBe(0)
	})

	test("missing-path matrix: a drip candidate absent stops; a bridge candidate that vanished after verify stops; --bridge-only needs a live drip manifest", async () => {
		promoteWorld()
		h.state.tombstones.add(DRIP_CANDIDATE)
		await expect(promote(INTENT_PATH)).rejects.toThrow(`candidate missing: ${DRIP_CANDIDATE} — nothing to promote`)
		h.reset()
		promoteWorld()
		// Vanish between verify's read and promote's lstat: the bridge candidate disappears the moment
		// the FPC gate runs (after verify has already read and pinned it).
		const originalPush = h.state.events.push.bind(h.state.events)
		h.state.events.push = (e: string) => {
			if (e.includes("check-fpc-version")) {
				h.state.files.delete(BRIDGE_CANDIDATE)
				h.state.tombstones.add(BRIDGE_CANDIDATE)
			}
			return originalPush(e)
		}
		await expect(promote(INTENT_PATH)).rejects.toThrow(`candidate missing: ${BRIDGE_CANDIDATE} — nothing to promote`)
		h.reset()
		promoteWorld({ bridgeOnly: true })
		h.state.tombstones.add(DRIP_LIVE)
		await expect(promote(INTENT_PATH, { bridgeOnly: true })).rejects.toThrow(
			/--bridge-only requires an existing live drip manifest to pin/,
		)
	})

	test("read-once: candidate bytes that changed between verify and promote stop before any write", async () => {
		promoteWorld()
		const originalPush = h.state.events.push.bind(h.state.events)
		let mutated = false
		h.state.events.push = (e: string) => {
			// Verify's own candidate read passes; the bytes change before promote's read-once.
			if (!mutated && e.includes("check-fpc-version")) {
				mutated = true
				put(BRIDGE_CANDIDATE, `${readReal(BRIDGE_LIVE, "utf8")} `)
			}
			return originalPush(e)
		}
		await expect(promote(INTENT_PATH)).rejects.toThrow(/bridge candidate bytes changed between verify and promote: .* — STOP/)
		expect(events().some((e) => e.startsWith("write "))).toBe(false)
	})

	test("drip derivation failure stops before the zero-seed read and any write", async () => {
		promoteWorld()
		script(
			`bun <repo>/apps/tools/scripts/verify-deployments.ts --config ${h.rel(DRIP_CANDIDATE)}`,
			new Error("bun failed (exit 1): derivation mismatch"),
		)
		await expect(promote(INTENT_PATH)).rejects.toThrow(/derivation mismatch/)
		expect(events().some((e) => e.startsWith("write "))).toBe(false)
	})

	test("zero-seed: a changed fuel section stops (the real assertZeroSeed), and the flags are forwarded", async () => {
		const { candidate } = promoteWorld()
		const live = JSON.parse(candidate.toString("utf8")) as { l1: { fuel: { core: { router: string } } } }
		live.l1.fuel.core.router = `0x${"88".repeat(20)}`
		put(BRIDGE_LIVE, JSON.stringify(live))
		await expect(promote(INTENT_PATH)).rejects.toThrow(/zero-seed violated/)
		expect(events().some((e) => e.startsWith("write "))).toBe(false)
	})

	test("--drop-swap: a candidate that dropped swap with core byte-carried promotes and the receipt says RETIRED", async () => {
		const { candidate } = promoteWorld()
		const dropped = JSON.parse(candidate.toString("utf8")) as { l1: { fuel: { swap?: unknown } } }
		dropped.l1.fuel.swap = undefined
		const bytes = Buffer.from(JSON.stringify(dropped))
		put(BRIDGE_CANDIDATE, bytes)
		const intent = JSON.parse(h.state.files.get(INTENT_PATH)?.toString("utf8") ?? "{}") as Record<string, unknown>
		intent.candidateSha256 = sha(bytes)
		put(INTENT_PATH, JSON.stringify(intent))
		await promote(INTENT_PATH, { dropSwap: true })
		const receipt = JSON.parse(h.state.files.get(RECEIPT)?.toString("utf8") ?? "{}") as { zeroSeed: string }
		expect(receipt.zeroSeed).toBe(
			"l1.fuel.core byte-carried; swap RETIRED (--drop-swap, token cutover); no fuel/router deploys this arc",
		)
	})

	test("(AS-IS, owner disposition) --drop-swap and --restore-swap together are both accepted and the receipt reports RESTORED", async () => {
		promoteWorld()
		await promote(INTENT_PATH, { dropSwap: true, restoreSwap: true })
		const receipt = JSON.parse(h.state.files.get(RECEIPT)?.toString("utf8") ?? "{}") as { zeroSeed: string }
		expect(receipt.zeroSeed).toBe("l1.fuel.core byte-carried; swap RESTORED (--restore-swap, pools seeded this arc)")
	})

	test("writes: per target rm(tmp) → wx → rename → re-hash, bridge before drip; a first-target re-hash failure leaves the drip unwritten", async () => {
		promoteWorld()
		const originalPush = h.state.events.push.bind(h.state.events)
		let renamed = false
		h.state.events.push = (e: string) => {
			// Corrupt the bridge target between its rename and the re-hash read (the overlay records
			// the read event before serving the bytes, so the swap lands exactly there).
			if (e === `rename ${h.rel(`${BRIDGE_LIVE}.promote-tmp`)} -> ${h.rel(BRIDGE_LIVE)}`) renamed = true
			else if (renamed && e === `read ${h.rel(BRIDGE_LIVE)}`) put(BRIDGE_LIVE, "corrupted")
			return originalPush(e)
		}
		await expect(promote(INTENT_PATH)).rejects.toThrow(
			/re-hash mismatch after write: .*testnet-bridge\.json .* — investigate before committing/,
		)
		expect(events().some((e) => e === `write ${h.rel(`${DRIP_LIVE}.promote-tmp`)} wx`)).toBe(false)
	})

	test("live re-verification failure leaves no receipt; the receipt's git rev-parse runs only after it", async () => {
		promoteWorld()
		script("bun <repo>/apps/tools/scripts/verify-deployments.ts", new Error("bun failed (exit 1): live derivation mismatch"))
		await expect(promote(INTENT_PATH)).rejects.toThrow(/live derivation mismatch/)
		expect(h.state.files.has(RECEIPT)).toBe(false)
		expect(events().some((e) => e.includes('"rev-parse"'))).toBe(false)
	})

	test("--bridge-only: the drip candidate is not required, the live drip digest is pinned before and after, the receipt says unchanged", async () => {
		const { candidate } = promoteWorld({ bridgeOnly: true })
		await promote(INTENT_PATH, { bridgeOnly: true })
		expect(h.state.files.get(BRIDGE_LIVE)?.equals(candidate)).toBe(true)
		const receipt = JSON.parse(h.state.files.get(RECEIPT)?.toString("utf8") ?? "{}") as {
			mode: string
			drip: { unchangedSha256?: string }
		}
		expect(receipt.mode).toBe("bridge-only")
		expect(receipt.drip.unchangedSha256).toBe(sha(h.state.files.get(DRIP_LIVE) as Buffer))
		expect(events().some((e) => e.includes("--config"))).toBe(false)
	})

	test("a pre-planted tmp symlink is removed, then exclusive-created, then renamed over the target", async () => {
		const { candidate } = promoteWorld()
		const tmp = `${BRIDGE_LIVE}.promote-tmp`
		h.state.symlinks.add(tmp)
		await promote(INTENT_PATH)
		const ev = events()
		expect(ev.indexOf(`rm ${h.rel(tmp)}`)).toBeLessThan(ev.indexOf(`write ${h.rel(tmp)} wx`))
		expect(h.state.files.get(BRIDGE_LIVE)?.equals(candidate)).toBe(true)
	})

	test("--bridge-only: a live drip manifest that changed during the promotion stops before the receipt", async () => {
		promoteWorld({ bridgeOnly: true })
		const originalPush = h.state.events.push.bind(h.state.events)
		h.state.events.push = (e: string) => {
			const r = originalPush(e)
			if (e === `rename ${h.rel(`${BRIDGE_LIVE}.promote-tmp`)} -> ${h.rel(BRIDGE_LIVE)}`) put(DRIP_LIVE, '{"tokens":[],"dripper":{}}')
			return r
		}
		await expect(promote(INTENT_PATH, { bridgeOnly: true })).rejects.toThrow(/--bridge-only violated: live drip manifest changed/)
		expect(h.state.files.has(RECEIPT)).toBe(false)
	})
})

describe("cast resolution (module-cached)", () => {
	test("resolveBin was consulted exactly once across the file: CAST_BIN override, candidates before PATH", () => {
		expect(h.state.resolves).toEqual(["cast CAST_BIN candidates"])
	})
})

// ── The overlay's assumptions about the real fs, proven on a temp dir ───────────
describe("fs overlay contract (real temp dir)", () => {
	test("wx refuses an existing file AND a dangling symlink; lstat sees a broken symlink; rename replaces; reads type by encoding", async () => {
		const fs = await vi.importActual<typeof import("node:fs")>("node:fs")
		const os = await vi.importActual<typeof import("node:os")>("node:os")
		const dir = fs.mkdtempSync(join(os.tmpdir(), "live-intent-fs-contract-"))
		try {
			const regular = join(dir, "regular")
			fs.writeFileSync(regular, "a")
			expect(() => fs.writeFileSync(regular, "b", { flag: "wx" })).toThrow(expect.objectContaining({ code: "EEXIST" }))
			const dangling = join(dir, "dangling")
			fs.symlinkSync(join(dir, "missing"), dangling)
			expect(() => fs.writeFileSync(dangling, "b", { flag: "wx" })).toThrow(expect.objectContaining({ code: "EEXIST" }))
			expect(fs.lstatSync(dangling).isSymbolicLink()).toBe(true)
			expect(() => fs.readFileSync(join(dir, "missing"))).toThrow(expect.objectContaining({ code: "ENOENT" }))
			const tmp = join(dir, "regular.promote-tmp")
			fs.writeFileSync(tmp, "c", { flag: "wx" })
			fs.renameSync(tmp, regular)
			expect(fs.readFileSync(regular, "utf8")).toBe("c")
			expect(Buffer.isBuffer(fs.readFileSync(regular))).toBe(true)
			expect(fs.existsSync(tmp)).toBe(false)
			// The promote recovery: a pre-planted dangling tmp symlink is removed, then exclusive-created.
			fs.symlinkSync(join(dir, "missing"), tmp)
			expect(() => fs.writeFileSync(tmp, "d", { flag: "wx" })).toThrow(expect.objectContaining({ code: "EEXIST" }))
			fs.rmSync(tmp, { force: true })
			fs.writeFileSync(tmp, "d", { flag: "wx" })
			fs.renameSync(tmp, regular)
			expect(fs.readFileSync(regular, "utf8")).toBe("d")
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
