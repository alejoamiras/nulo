import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import http from "node:http"
import { execSync, spawn, type ChildProcess } from "node:child_process"
import type { TestProject } from "vitest/node"
import {
	type AztecTestConfig,
	checkNodeHealth,
	waitForLocalNode,
	createTestWallet,
	deployTestToken,
	getContractClassId,
	createSponsoredFeeOptions,
	LOCAL_NODE_URL,
} from "./fixtures/aztec"
import { type OwnedState, clearLock, isPidAlive, killOrphanByPid, newAztecDataDir, readLock, writeLock } from "./lockfile"
import { markBootReady, markBootStarted } from "./sentinel"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, "../../dist/chrome")
const PLAYGROUND_DIR = path.resolve(__dirname, "../../../playground")
const TOOLS_DIR = path.resolve(__dirname, "../../../tools")
const CONFIG_PATH = path.resolve(__dirname, ".test-config.json")
// ── Aztec toolchain resolution ──────────────────────────────────────────
// Resolve from the repo's `@aztec/aztec.js` pin (the SAME rule CI's
// setup-aztec action uses), NOT from the mutable `~/.aztec/current`
// symlink: ANY `aztec-up install` on the machine re-points `current`
// (other projects, other agents' worktrees), and @aztec/ethereum's
// `resolveFoundryBinary` hard-codes `current/internal-bin/forge` AHEAD of
// PATH — so a mismatched install there kills the L1 deploy for EVERY
// version's boot ("forge script: the following required arguments were
// not provided: --batch"), which the PATH prepend below cannot prevent.
// The FORGE_BIN/ANVIL_BIN env overrides (that resolver's highest-priority
// source) are exported at node spawn to close that hole. Falls back to
// `current` only when the pinned version isn't installed, with a warning
// logged at boot naming the fix.
const AZTEC_PIN_READ: { pin?: string; error?: string } = (() => {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as {
			dependencies?: Record<string, string>
		}
		const pin = pkg.dependencies?.["@aztec/aztec.js"]
		if (typeof pin !== "string" || pin.length === 0) {
			return { error: "dependencies['@aztec/aztec.js'] missing or not a string" }
		}
		return { pin }
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) }
	}
})()
const AZTEC_PIN = AZTEC_PIN_READ.pin

function isExecutable(p: string): boolean {
	try {
		fs.accessSync(p, fs.constants.X_OK)
		return true
	} catch {
		return false
	}
}

const AZTEC_HOME = path.resolve(process.env.HOME || "~", ".aztec")
// The pinned root is usable only as a COMPLETE toolchain. A partial install
// (CLI present, internal-bin/forge missing) would let the L1 deploy resolve
// forge through mutable `current` again — the exact hole this closes.
const AZTEC_TOOLCHAIN_RELPATHS = ["node_modules/.bin/aztec", "bin/aztec-anvil", "internal-bin/forge", "internal-bin/anvil"] as const
const AZTEC_PINNED_ROOT = AZTEC_PIN ? path.join(AZTEC_HOME, "versions", AZTEC_PIN) : undefined
const AZTEC_PIN_MISSING: readonly string[] = AZTEC_PINNED_ROOT
	? AZTEC_TOOLCHAIN_RELPATHS.filter((rel) => !isExecutable(path.join(AZTEC_PINNED_ROOT, rel)))
	: AZTEC_TOOLCHAIN_RELPATHS
const AZTEC_PIN_USABLE = AZTEC_PIN_MISSING.length === 0
const AZTEC_ROOT = AZTEC_PIN_USABLE && AZTEC_PINNED_ROOT ? AZTEC_PINNED_ROOT : path.join(AZTEC_HOME, "current")
const AZTEC_BIN = path.join(AZTEC_ROOT, "node_modules/.bin/aztec")
// 5.0 renamed bundled bare binaries to aztec-* on PATH: `anvil` → `aztec-anvil` (drop-in).
const ANVIL_BIN = path.join(AZTEC_ROOT, "bin/aztec-anvil")
// We spawn node_modules/.bin/aztec directly (AZTEC_BIN), bypassing the bin/aztec wrapper that
// prepends `internal-bin` to PATH. Replicate that prepend so subprocesses that DO resolve from
// PATH use the version-matched bundled binaries.
const AZTEC_INTERNAL_BIN = path.join(AZTEC_ROOT, "internal-bin")

/**
 * Port resolution. Falls back to today's defaults if the agent wrapper
 * (`bun run e2e:agent`) hasn't pre-allocated a fresh pack. The wrapper
 * passes ANVIL_PORT/AZTEC_PORT/AZTEC_ADMIN_PORT/AZTEC_P2P_PORT/PLAYGROUND_PORT
 * via env after writing them to .e2e-state/ports.json. Direct `vitest`
 * invocations without the wrapper still work for single-agent dev.
 */
const ANVIL_PORT = Number(process.env.ANVIL_PORT ?? 8545)
const ANVIL_URL = process.env.ANVIL_URL ?? `http://127.0.0.1:${ANVIL_PORT}`
const AZTEC_PORT = Number(process.env.AZTEC_PORT ?? 8080)
const AZTEC_ADMIN_PORT = Number(process.env.AZTEC_ADMIN_PORT ?? 8880)
const AZTEC_P2P_PORT = Number(process.env.AZTEC_P2P_PORT ?? 40400)
const PLAYGROUND_PORT = Number(process.env.PLAYGROUND_PORT ?? 5174)
const PLAYGROUND_URL = process.env.PLAYGROUND_URL ?? `http://localhost:${PLAYGROUND_PORT}/`
/** Tools dev server. Spawned only when TOOLS_DEV_PORT is set (the agent wrapper
 *  always sets it; a bare vitest run does not), so a run without it never pays
 *  the Vite + Vue + Aztec startup. */
const TOOLS_PORT = process.env.TOOLS_DEV_PORT ? Number(process.env.TOOLS_DEV_PORT) : undefined
const TOOLS_URL = TOOLS_PORT ? `http://localhost:${TOOLS_PORT}/` : undefined

/** Per-run aztec data directory. Mandatory even for in-memory mode because
 *  some aztec subsystems still write to ~/.aztec/data by default — two
 *  agents writing there at the same time will corrupt LMDB. On real disk (see
 *  `newAztecDataDir`/`E2E_DATA_ROOT`), NOT tmpfs. The path is recorded in the
 *  ownership lockfile so a future run — or `e2e:reap` — can clean it up if this
 *  run is killed before teardown. */
let AZTEC_DATA_DIR = newAztecDataDir()

let anvilProcess: ChildProcess | null = null
/** True only when THIS run wrote `.e2e-state/owned.json` (fresh sandbox or progressive partial
 *  lock). Teardown must never clear a lock it does not own: on the REUSE path (and on failures
 *  before any lock write) the file records a PRIOR run's still-live sandbox — deleting it would
 *  orphan those processes beyond reap (codex Med). */
let weOwnLock = false

let weStartedAnvil = false
let nodeProcess: ChildProcess | null = null
let weStartedNode = false
let playgroundProcess: ChildProcess | null = null
let weStartedPlayground = false
let toolsProcess: ChildProcess | null = null
let weStartedTools = false

/** Probe a URL with HEAD/GET; returns true on any 2xx/3xx/4xx response. */
async function probeHttp(url: string, timeoutMs = 1500): Promise<boolean> {
	return new Promise((resolve) => {
		const req = http.get(url, { timeout: timeoutMs }, (res) => {
			res.resume() // drain
			resolve((res.statusCode ?? 0) > 0)
		})
		req.on("error", () => resolve(false))
		req.on("timeout", () => {
			req.destroy()
			resolve(false)
		})
	})
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await probeHttp(url)) return
		await new Promise((r) => setTimeout(r, 500))
	}
	throw new Error(`Timed out waiting for ${url} (${timeoutMs}ms)`)
}

/** Single-shot anvil JSON-RPC eth_blockNumber probe. Confirms the L1 is
 *  speaking JSON-RPC, not just answering HTTP. */
async function probeAnvil(url: string, timeoutMs = 1500): Promise<boolean> {
	return new Promise((resolve) => {
		const u = new URL(url)
		const req = http.request(
			{
				hostname: u.hostname,
				port: u.port,
				path: "/",
				method: "POST",
				headers: { "Content-Type": "application/json" },
				timeout: timeoutMs,
			},
			(res) => {
				let body = ""
				res.on("data", (c) => {
					body += c.toString()
				})
				res.on("end", () => {
					try {
						const parsed = JSON.parse(body)
						resolve(typeof parsed.result === "string")
					} catch {
						resolve(false)
					}
				})
			},
		)
		req.on("error", () => resolve(false))
		req.on("timeout", () => {
			req.destroy()
			resolve(false)
		})
		req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }))
		req.end()
	})
}

async function waitForAnvil(url: string, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await probeAnvil(url)) return
		await new Promise((r) => setTimeout(r, 250))
	}
	throw new Error(`Timed out waiting for anvil at ${url} (${timeoutMs}ms)`)
}

/**
 * Kill orphan Chrome test processes started by THIS extension build only.
 *
 * Scoping by extension path (not just `--test-type`) lets a parallel impl in
 * a different folder run its own Chromes without us murdering each other's
 * test runs.
 */
function killOrphanChromes() {
	try {
		execSync(`pkill -f "chrome.*--load-extension=${EXTENSION_PATH}" 2>/dev/null || true`, { stdio: "ignore" })
	} catch {}
}

/** Vitest globalSetup contract: with a DEFAULT export present, the named `teardown` export is
 *  IGNORED — the teardown must be the default's RETURN VALUE. The named export stayed dead for
 *  the suite's whole life (cleanup ran only via the best-effort process-exit hook), which is how
 *  half-booted sandboxes could outlive a failed run. The default now returns `teardown`, and a
 *  setup that dies midway (e.g. the node fails after anvil started) tears down what it already
 *  started before rethrowing — the exit-86 classifier reads boot MARKERS, not live processes, so
 *  cleanup cannot mask the boot-failure classification. */
export default async function setupWithTeardown(project: TestProject): Promise<() => Promise<void>> {
	try {
		await setup(project)
	} catch (err) {
		try {
			await teardown()
		} catch (cleanupErr) {
			console.warn("[e2e-setup] teardown after failed setup also failed:", cleanupErr)
		}
		throw err
	}
	return teardown
}

/**
 * Boot coordinator. The ORDER here is the contract: orphan reap + build guard run before the
 * boot-failure (exit 86) window opens; the provisional lock is written before the first spawn;
 * `markBootStarted()` sits between them and the first spawn so a missing-binary FATAL is still a
 * retryable boot failure; on reuse this run owns nothing (no provisional lock, `weOwnLock` stays
 * false) and skips straight to the shared tail.
 */
export async function setup(project: TestProject) {
	killOrphanChromes()

	// Guard: ensure extension is built
	const manifest = path.join(EXTENSION_PATH, "manifest.json")
	if (!fs.existsSync(manifest)) {
		throw new Error(`Extension not found at ${EXTENSION_PATH}\nRun "bun run build" or "bun run dev" first.`)
	}
	project.provide("extensionPath", EXTENSION_PATH)

	console.log(
		`[e2e-setup] ports: anvil=:${ANVIL_PORT} aztec=:${AZTEC_PORT} (admin :${AZTEC_ADMIN_PORT}, p2p :${AZTEC_P2P_PORT}) playground=:${PLAYGROUND_PORT}`,
	)

	if ((await reconcilePriorLock()) === "reused") {
		await finishBoot(project)
		return
	}

	// Provisional lock BEFORE the first spawn, updated after each spawn (recordSpawnedPid): the
	// agent.sh signal trap and future-run orphan reap read pids from the lock, and the final
	// post-deploy write used to land only after MINUTES of boot — a cancel in that window left
	// untracked process groups behind (codex Med).
	writeProvisionalLock()

	// Sandbox bring-up begins here — this opens the boot-failure (exit 86)
	// window. Manifest validation + orphan reap above are deliberately OUTSIDE
	// it: a failure there is a build/env problem, not an infra-boot flake, so it
	// must NOT be retried.
	markBootStarted()

	if ((await ensureAnvil()) === "skip") {
		provideWithoutSandbox(project)
		return
	}
	if ((await ensureAztecNode()) === "skip") {
		provideWithoutSandbox(project)
		return
	}

	await ensureDevServer({
		label: "playground",
		title: "Playground",
		cwd: PLAYGROUND_DIR,
		url: PLAYGROUND_URL,
		env: { NODE_ENV: "test", VITE_DISABLE_HMR: "1", PLAYGROUND_PORT: String(PLAYGROUND_PORT) },
		setHandle: (child) => {
			playgroundProcess = child
		},
		setStarted: (started) => {
			weStartedPlayground = started
		},
	})

	// ── Tools dev server (opt-in via TOOLS_DEV_PORT) ─────────────────
	// Only spawned when the test runner pre-allocated a tools port. This
	// keeps the default network suite lightweight — tools startup adds ~5s
	// + a Vite + Vue process per worktree.
	if (TOOLS_PORT && TOOLS_URL) {
		await ensureDevServer({
			label: "tools",
			title: "Tools",
			cwd: TOOLS_DIR,
			url: TOOLS_URL,
			env: { NODE_ENV: "test", TOOLS_DEV_PORT: String(TOOLS_PORT) },
			setHandle: (child) => {
				toolsProcess = child
			},
			setStarted: (started) => {
				weStartedTools = started
			},
		})
	}

	await finishBoot(project)
}

/** The permissive skip exits (no sandbox, `E2E_REQUIRE_SETUP` unset): suites gate on
 *  `aztecTestConfig` being undefined; the dev-server URLs are still provided so the rest can run. */
function provideWithoutSandbox(project: TestProject): void {
	project.provide("aztecTestConfig", undefined)
	project.provide("playgroundUrl", PLAYGROUND_URL)
	project.provide("toolsUrl", TOOLS_URL)
}

/** The shared tail of the reuse and fresh paths. The dev-server URLs are provided even when a
 *  server was not spawned (only the tests that need it fail), then contracts, then the ready
 *  marker. */
async function finishBoot(project: TestProject): Promise<void> {
	project.provide("playgroundUrl", PLAYGROUND_URL)
	project.provide("toolsUrl", TOOLS_URL)
	await deployContractsAndProvide(project)
	// Sandbox healthy + contracts deployed, BEFORE any test worker starts —
	// this closes the boot-failure (exit 86) window. Any failure from here on
	// (fixture, import, test body) is a real failure, never an infra-boot flake.
	markBootReady()
}

// ── Lockfile: reap orphans or take over a still-healthy pack ───────
// `bun run e2e:agent` always allocates fresh ports, so the prior lock's
// ports never match the current ones — we fall through to reaping
// orphans, then a fresh spawn. Direct vitest invocations with stable
// env can land on the reuse path.
async function reconcilePriorLock(): Promise<"reused" | "fresh"> {
	const priorLock = readLock()
	if (!priorLock) return "fresh"
	if (priorPortsMatch(priorLock)) {
		console.log("[e2e-setup] prior ownership lock matches current run — probing for reuse")
		if (await priorPackHealthy(priorLock)) {
			const identityOk = await verifyIdentity(LOCAL_NODE_URL, priorLock.l1ContractAddresses)
			if (identityOk) {
				console.log("[e2e-setup] reusing prior sandbox (identity check passed)")
				weStartedAnvil = false
				weStartedNode = false
				weStartedPlayground = false
				weStartedTools = false
				AZTEC_DATA_DIR = priorLock.aztecDataDir
				return "reused"
			}
			console.warn("[e2e-setup] prior sandbox identity mismatch — tearing down and starting fresh")
		} else {
			console.warn("[e2e-setup] prior sandbox not all healthy — tearing down")
		}
		reapPrior(priorLock)
	} else {
		// Different ports — fresh agent run after a previous one in the
		// same worktree. Reap any orphans on the previous ports.
		console.log("[e2e-setup] prior lock is for different ports — reaping orphans")
		reapPrior(priorLock)
	}
	clearLock()
	return "fresh"
}

function priorPortsMatch(priorLock: OwnedState): boolean {
	const portsMatch =
		priorLock.ports.anvil === ANVIL_PORT &&
		priorLock.ports.aztec === AZTEC_PORT &&
		priorLock.ports.aztecAdmin === AZTEC_ADMIN_PORT &&
		priorLock.ports.aztecP2P === AZTEC_P2P_PORT &&
		priorLock.ports.playground === PLAYGROUND_PORT &&
		// Tools port is optional — match only if both sides agree on its
		// presence and value. Lockfiles written before tools wiring have
		// `priorLock.ports.tools === undefined`; current runs without
		// tools have `TOOLS_PORT === undefined`. Both match.
		priorLock.ports.tools === TOOLS_PORT
	const urlMatch = priorLock.bakedLocalRpcUrl === LOCAL_NODE_URL
	return portsMatch && urlMatch
}

/** Every recorded process alive AND every endpoint answering, probed in the recorded order. */
async function priorPackHealthy(priorLock: OwnedState): Promise<boolean> {
	const allCoreAlive = isPidAlive(priorLock.pids.anvil) && isPidAlive(priorLock.pids.aztec) && isPidAlive(priorLock.pids.playground)
	const toolsAlive = TOOLS_PORT ? isPidAlive(priorLock.pids.tools) : true
	const toolsHealthy = TOOLS_URL ? await probeHttp(TOOLS_URL) : true
	return (
		allCoreAlive &&
		toolsAlive &&
		(await probeAnvil(ANVIL_URL)) &&
		(await checkNodeHealth(LOCAL_NODE_URL)) &&
		(await probeHttp(PLAYGROUND_URL)) &&
		toolsHealthy
	)
}

function reapPrior(priorLock: OwnedState): void {
	killOrphanByPid(priorLock.pids.anvil, "anvil")
	killOrphanByPid(priorLock.pids.aztec, "aztec")
	killOrphanByPid(priorLock.pids.playground, "playground")
	killOrphanByPid(priorLock.pids.tools, "tools")
	try {
		fs.rmSync(priorLock.aztecDataDir, { recursive: true, force: true })
	} catch {}
}

// ── Anvil (L1) ─────────────────────────────────────────────────────
/** Probe first: an anvil already speaking JSON-RPC on our port is adopted, never respawned. */
async function ensureAnvil(): Promise<"ready" | "skip"> {
	const anvilAlreadyRunning = await probeAnvil(ANVIL_URL)
	if (anvilAlreadyRunning) {
		console.log("[e2e-setup] Anvil already speaking JSON-RPC at", ANVIL_URL)
		weStartedAnvil = false
		return "ready"
	}
	if (!fs.existsSync(ANVIL_BIN)) {
		// Same fail-loud gate as the deploy-failure path below: when invoked
		// via scripts/e2e/agent.sh, missing infrastructure must abort the
		// run, not pass-by-skip. Otherwise CI reports `61 skipped` exit 0
		// and the suite stays silently broken (this regressed in CI from
		// 2026-05-22 when the setup-aztec action didn't symlink
		// ~/.aztec/current — every PR's network-e2e check was "green" while
		// running zero tests).
		if (process.env.E2E_REQUIRE_SETUP === "1") {
			throw new Error(
				`[e2e-setup] FATAL: anvil binary not found at ${ANVIL_BIN} and E2E_REQUIRE_SETUP=1 is set. ` +
					`Aborting run to prevent silent pass-by-skip. Ensure setup-aztec installed Aztec CLI ` +
					`AND created the ~/.aztec/current symlink (CI: see .github/actions/setup-aztec/action.yml).`,
			)
		}
		console.warn("[e2e-setup] anvil binary not found at", ANVIL_BIN, "— skipping network setup")
		return "skip"
	}
	console.log("[e2e-setup] Starting anvil at", ANVIL_URL, "...")
	anvilProcess = spawn(
		ANVIL_BIN,
		["--host", "127.0.0.1", "--port", String(ANVIL_PORT), "--chain-id", "31337", "--slots-in-an-epoch", "1", "--silent"],
		{
			stdio: "pipe",
			detached: true,
		},
	)
	weStartedAnvil = true
	recordSpawnedPid()

	anvilProcess.stderr?.on("data", (data: Buffer) => {
		const line = data.toString().trim()
		if (line.includes("error") || line.includes("Error") || line.includes("address already in use")) {
			console.error("[anvil]", line.slice(0, 200))
		}
	})
	anvilProcess.once("exit", (code) => {
		if (weStartedAnvil && code !== 0 && code !== null) {
			console.error(`[anvil] exited unexpectedly with code ${code}`)
		}
	})

	try {
		await waitForAnvil(ANVIL_URL, 30_000)
		console.log("[e2e-setup] Anvil is ready")
	} catch (error) {
		console.error("[e2e-setup] Failed to start anvil:", error)
		await killProcessGroup(anvilProcess, "anvil", weStartedAnvil)
		anvilProcess = null
		// Under the real agent runner a dead sandbox MUST be a loud
		// failure, not a silent pass-by-skip — a green run where every
		// suite skipped hides exactly the breakage the gate exists for.
		if (process.env.E2E_REQUIRE_SETUP === "1") {
			throw new Error("[e2e-setup] FATAL: anvil failed to become healthy and E2E_REQUIRE_SETUP=1 is set.")
		}
		return "skip"
	}
	return "ready"
}

// ── Aztec (L2) ─────────────────────────────────────────────────────
/** Probe first: a healthy node on our port is adopted. Otherwise the pinned toolchain is checked,
 *  the node is spawned with a per-run data directory, and a node that never becomes healthy is
 *  torn down together with anvil. A missing CLI leaves anvil alive until teardown, as before. */
async function ensureAztecNode(): Promise<"ready" | "skip"> {
	const nodeAlreadyRunning = await checkNodeHealth(LOCAL_NODE_URL)
	if (nodeAlreadyRunning) {
		console.log("[e2e-setup] Local Aztec node already running at", LOCAL_NODE_URL)
		weStartedNode = false
		return "ready"
	}
	console.log("[e2e-setup] Starting local Aztec network at", LOCAL_NODE_URL, "...")
	if (!AZTEC_PIN_USABLE) requirePinnedToolchainOrWarn()
	if (!fs.existsSync(AZTEC_BIN)) {
		// See comment above the matching ANVIL_BIN gate for the rationale.
		if (process.env.E2E_REQUIRE_SETUP === "1") {
			throw new Error(
				`[e2e-setup] FATAL: aztec CLI not found at ${AZTEC_BIN} and E2E_REQUIRE_SETUP=1 is set. ` +
					`Aborting run to prevent silent pass-by-skip. Ensure the repo's pinned aztec version is ` +
					`installed under ~/.aztec/versions (aztec-up install ${AZTEC_PIN ?? "<pin>"}; ` +
					`CI: see .github/actions/setup-aztec/action.yml).`,
			)
		}
		console.warn("[e2e-setup] aztec CLI not found at", AZTEC_BIN, "— skipping network setup")
		return "skip"
	}

	// Mandatory --data-directory per agent: aztec writes to $HOME/.aztec/data
	// by default for some subsystems, which would corrupt LMDB if two
	// agents run concurrently with the default path.
	fs.mkdirSync(AZTEC_DATA_DIR, { recursive: true })

	spawnAztecNode()

	try {
		await waitForLocalNode(LOCAL_NODE_URL, 90_000)
		console.log("[e2e-setup] Local Aztec node is ready")
	} catch (error) {
		console.error("[e2e-setup] Failed to start local node:", error)
		await killProcessGroup(nodeProcess, "aztec", weStartedNode)
		nodeProcess = null
		await killProcessGroup(anvilProcess, "anvil", weStartedAnvil)
		anvilProcess = null
		// Same loud-failure contract as the anvil path: a node that never
		// became healthy (e.g. native bb SIGILL) must fail the run, not
		// skip it green.
		if (process.env.E2E_REQUIRE_SETUP === "1") {
			throw new Error("[e2e-setup] FATAL: local Aztec node failed to become healthy and E2E_REQUIRE_SETUP=1 is set.")
		}
		return "skip"
	}
	return "ready"
}

/** The pinned toolchain is unusable. Strict runs fail CLOSED: falling back to the mutable
 *  `current` symlink is exactly the drift that breaks the L1 deploy, and a silent skip/pass would
 *  hide it. Permissive runs warn, naming the fix, and boot from `current`. */
function requirePinnedToolchainOrWarn(): void {
	const reason = AZTEC_PIN
		? `pinned aztec ${AZTEC_PIN} at ${AZTEC_PINNED_ROOT} is missing: ${AZTEC_PIN_MISSING.join(", ")}`
		: `repo aztec pin unreadable (${AZTEC_PIN_READ.error})`
	if (process.env.E2E_REQUIRE_SETUP === "1") {
		throw new Error(
			`[e2e-setup] FATAL: ${reason}, and E2E_REQUIRE_SETUP=1 forbids the ~/.aztec/current fallback. Fix: aztec-up install ${AZTEC_PIN ?? "<repo @aztec/aztec.js pin>"}`,
		)
	}
	console.warn(
		`[e2e-setup] ${reason} — falling back to ~/.aztec/current, which may mismatch the repo pin. Fix: aztec-up install ${AZTEC_PIN ?? "<pin>"}`,
	)
}

/** Spawn the pinned aztec CLI as its own process group, own it (handle → flag → lock record, in
 *  that order), and pipe its logs. */
function spawnAztecNode(): void {
	nodeProcess = spawn(
		AZTEC_BIN,
		[
			"start",
			"--local-network",
			"--port",
			String(AZTEC_PORT),
			"--admin-port",
			String(AZTEC_ADMIN_PORT),
			"--p2p.p2pPort",
			String(AZTEC_P2P_PORT),
			"--l1-rpc-urls",
			ANVIL_URL,
			"--data-directory",
			AZTEC_DATA_DIR,
			"--disable-admin-api-key",
		],
		{
			stdio: "pipe",
			detached: true,
			env: {
				...process.env,
				PATH: `${AZTEC_INTERNAL_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
				SEQ_MIN_TX_PER_BLOCK: "0",
				ETHEREUM_HOSTS: ANVIL_URL,
				ANVIL_PORT: String(ANVIL_PORT),
				AZTEC_PORT: String(AZTEC_PORT),
				// Highest-priority override for @aztec/ethereum's
				// resolveFoundryBinary: without these, the node's L1 deploy
				// reads `~/.aztec/current/internal-bin/forge` regardless of
				// which version's CLI is booting — a `current` re-pointed by
				// any other install on the machine then breaks the deploy
				// with a forge-CLI arg mismatch. A caller-supplied override
				// wins (same rule as the resolver itself); the executable
				// guard matters because the resolver THROWS on a
				// set-but-missing override rather than falling back.
				...(!process.env.FORGE_BIN && isExecutable(path.join(AZTEC_INTERNAL_BIN, "forge"))
					? { FORGE_BIN: path.join(AZTEC_INTERNAL_BIN, "forge") }
					: {}),
				...(!process.env.ANVIL_BIN && isExecutable(path.join(AZTEC_INTERNAL_BIN, "anvil"))
					? { ANVIL_BIN: path.join(AZTEC_INTERNAL_BIN, "anvil") }
					: {}),
			},
		},
	)
	weStartedNode = true
	recordSpawnedPid()

	nodeProcess.stdout?.on("data", (data: Buffer) => {
		const line = data.toString().trim()
		if (line.includes("Aztec") || line.includes("ready") || line.includes("error")) {
			console.log("[aztec-node]", line.slice(0, 200))
		}
	})
	nodeProcess.stderr?.on("data", (data: Buffer) => {
		const line = data.toString().trim()
		if (line.includes("error") || line.includes("Error")) {
			console.error("[aztec-node]", line.slice(0, 200))
		}
	})
}

// ── Vite dev servers (playground; tools opt-in) ───────────────────
interface DevServerSpec {
	/** Log tag + the lower-case name in "Starting … dev server" / "Failed to start …". */
	label: string
	/** The capitalised name in "… already running" / "… is ready". */
	title: string
	cwd: string
	url: string
	env: Record<string, string>
	/** Handle ownership stays with the module-level slots; the helper assigns in the strict
	 *  order the provisional lock needs: handle → started flag → `recordSpawnedPid()`. */
	setHandle: (child: ChildProcess | null) => void
	setStarted: (started: boolean) => void
}

/** Adopt a server already answering on its URL, else spawn `bun run dev`, own it, pipe its logs
 *  and wait up to 30 s. A server that fails to come up is killed and the boot continues — only
 *  the tests that depend on it fail individually. */
async function ensureDevServer(spec: DevServerSpec): Promise<void> {
	const alreadyRunning = await probeHttp(spec.url, 1500)
	if (alreadyRunning) {
		console.log(`[e2e-setup] ${spec.title} already running at`, spec.url)
		spec.setStarted(false)
		return
	}
	console.log(`[e2e-setup] Starting ${spec.label} dev server at`, spec.url, "...")
	let child: ChildProcess | null = null
	try {
		child = spawn("bun", ["run", "dev"], {
			cwd: spec.cwd,
			stdio: "pipe",
			detached: true,
			env: { ...process.env, ...spec.env },
		})
		spec.setHandle(child)
		spec.setStarted(true)
		recordSpawnedPid()

		child.stdout?.on("data", (data: Buffer) => {
			const line = data.toString().trim()
			if (line.includes("Local:") || line.includes("error")) {
				console.log(`[${spec.label}]`, line.slice(0, 200))
			}
		})
		child.stderr?.on("data", (data: Buffer) => {
			const line = data.toString().trim()
			if (line.includes("error") || line.includes("Error")) {
				console.error(`[${spec.label}]`, line.slice(0, 200))
			}
		})

		await waitForHttp(spec.url, 30_000)
		console.log(`[e2e-setup] ${spec.title} is ready`)
	} catch (error) {
		console.warn(`[e2e-setup] Failed to start ${spec.label}:`, error)
		await killProcessGroup(child, spec.label, true)
		spec.setHandle(null)
		// Continue without the server — tests that depend on it will skip / fail individually
	}
}

/**
 * Deploy SponsoredFPC + a test Token, write `.test-config.json`, and write
 * the ownership lock with PIDs + L1 contract addresses + the address book.
 * On reuse the lock's `deployedConfig` lets us recreate `.test-config.json`
 * without redeploying.
 */
async function deployContractsAndProvide(project: TestProject): Promise<void> {
	const existingLock = readLock()
	// A lock written before `tokenClassId` existed carries a config the
	// default-token seeding spec cannot use; redeploy rather than reuse it.
	if (existingLock?.deployedConfig?.nodeUrl === LOCAL_NODE_URL && existingLock.deployedConfig.tokenClassId) {
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingLock.deployedConfig, null, 2))
		project.provide("aztecTestConfig", existingLock.deployedConfig)
		console.log("[e2e-setup] reused deployed contracts from lockfile:", existingLock.deployedConfig)
		return
	}

	let l1ContractAddresses: Record<string, string> | undefined
	let config: AztecTestConfig | undefined
	try {
		console.log("[e2e-setup] Deploying test contracts...")
		const { wallet, accounts, node, cleanup } = await createTestWallet(LOCAL_NODE_URL)
		try {
			const nodeInfo = await node.getNodeInfo()
			l1ContractAddresses = serializeL1ContractAddresses(nodeInfo.l1ContractAddresses)
			const minterAddress = accounts[0]
			const { paymentMethod, address: sponsoredFpcAddress } = await createSponsoredFeeOptions(wallet)
			const feeOptions = { paymentMethod }

			const tokenAddress = await deployTestToken(wallet, minterAddress, feeOptions)
			const tokenClassId = await getContractClassId(node, tokenAddress)

			config = {
				nodeUrl: LOCAL_NODE_URL,
				tokenAddress,
				tokenClassId,
				sponsoredFpcAddress,
				minterAddress: minterAddress.toString(),
			}

			fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
			console.log("[e2e-setup] Test contracts deployed:", JSON.stringify(config, null, 2))
		} finally {
			await cleanup()
		}
		project.provide("aztecTestConfig", config)
	} catch (error) {
		console.error("[e2e-setup] Failed to deploy test contracts:", error)
		project.provide("aztecTestConfig", undefined)
		// Env-gated fail-loud. The `bun run e2e:agent` wrapper
		// (`scripts/e2e/agent.sh`) sets `E2E_REQUIRE_SETUP=1` to mark this
		// as a real test invocation where the sandbox is supposed to be
		// available. In that mode we propagate the deploy failure so vitest
		// exits non-zero with a clear message — instead of every test
		// gating on `describe.skipIf(!hasAztecTestConfig)` and silently
		// passing-by-skip. Without this gate, the suite was reporting
		// `61 skipped` exit 0 on every CI run since the public repo opened.
		//
		// For contributor-local invocations without the agent wrapper
		// (e.g. running vitest directly without an Aztec sandbox), the env
		// var is unset and we keep the legacy skip-silently behavior so
		// they aren't blocked from running unrelated tests.
		if (process.env.E2E_REQUIRE_SETUP === "1") {
			throw new Error(
				`[e2e-setup] FATAL: failed to deploy test contracts and E2E_REQUIRE_SETUP=1 is set. ` +
					`Aborting run to prevent silent pass-by-skip. Original error: ` +
					`${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	// Always write the lock once children are alive, even if contract deploy
	// failed — orphan cleanup on a future run is more valuable than the
	// missing identity field.
	if (weOwnLock) {
		writeLock(buildOwnedState({ l1ContractAddresses, deployedConfig: config }))
	} else {
		// REUSE path (this run started nothing): the on-disk lock records the PRIOR run's live pids.
		// Update ONLY the deployment fields in place - overwriting with our (empty) pid map and
		// claiming ownership would let teardown clear a lock whose processes we cannot reap later
		// (review CONFIRMED finding).
		const prior = readLock()
		if (prior) writeLock({ ...prior, l1ContractAddresses, deployedConfig: config })
	}
}

function buildOwnedState(extra: Partial<OwnedState> = {}): OwnedState {
	return {
		startedAt: new Date().toISOString(),
		bakedLocalRpcUrl: LOCAL_NODE_URL,
		ports: {
			anvil: ANVIL_PORT,
			aztec: AZTEC_PORT,
			aztecAdmin: AZTEC_ADMIN_PORT,
			aztecP2P: AZTEC_P2P_PORT,
			playground: PLAYGROUND_PORT,
			...(TOOLS_PORT ? { tools: TOOLS_PORT } : {}),
		},
		pids: currentPids(),
		aztecDataDir: AZTEC_DATA_DIR,
		...extra,
	}
}

function writeProvisionalLock(): void {
	writeLock(buildOwnedState())
	weOwnLock = true
}

/** Update the owned lock's pid map right after a spawn — keeps the agent trap + orphan reap
 *  current through the whole boot instead of only after deployment. */
function recordSpawnedPid(): void {
	if (!weOwnLock) return
	writeLock(buildOwnedState())
}

function currentPids(): OwnedState["pids"] {
	return {
		anvil: weStartedAnvil ? anvilProcess?.pid : undefined,
		aztec: weStartedNode ? nodeProcess?.pid : undefined,
		playground: weStartedPlayground ? playgroundProcess?.pid : undefined,
		tools: weStartedTools ? toolsProcess?.pid : undefined,
	}
}

function serializeL1ContractAddresses(addrs: unknown): Record<string, string> {
	if (!addrs || typeof addrs !== "object") return {}
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(addrs as Record<string, unknown>)) {
		if (v == null) continue
		// AztecAddress / EthAddress instances expose `.toString()`; primitives
		// stringify naturally. Anything else gets serialized as JSON.
		const s = typeof v === "object" && "toString" in v ? String(v) : JSON.stringify(v)
		out[k] = s
	}
	return out
}

/**
 * Identity assertion for the reuse path. Calls `getNodeInfo()` against the
 * candidate sandbox URL and compares its L1 contract addresses to what the
 * lockfile recorded. A foreign aztec on the same port reports different
 * addresses and is rejected.
 */
async function verifyIdentity(url: string, expected: Record<string, string> | undefined): Promise<boolean> {
	if (!expected || Object.keys(expected).length === 0) return false
	try {
		const { createAztecNodeClient } = await import("@aztec/aztec.js/node")
		const node = createAztecNodeClient(url)
		const info = await node.getNodeInfo()
		const got = serializeL1ContractAddresses(info.l1ContractAddresses)
		for (const [k, v] of Object.entries(expected)) {
			if (got[k] !== v) {
				console.warn(`[e2e-setup] identity mismatch on ${k}: lock=${v} actual=${got[k] ?? "<missing>"}`)
				return false
			}
		}
		return true
	} catch (err) {
		console.warn("[e2e-setup] identity check failed:", err)
		return false
	}
}

export async function teardown() {
	try {
		fs.unlinkSync(CONFIG_PATH)
	} catch {
		// ignore
	}

	await killProcessGroup(toolsProcess, "tools", weStartedTools)
	toolsProcess = null
	await killProcessGroup(playgroundProcess, "playground", weStartedPlayground)
	playgroundProcess = null
	await killProcessGroup(nodeProcess, "aztec", weStartedNode)
	nodeProcess = null
	await killProcessGroup(anvilProcess, "anvil", weStartedAnvil)
	anvilProcess = null

	if (weStartedNode) {
		try {
			fs.rmSync(AZTEC_DATA_DIR, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}

	if (weOwnLock) clearLock()
	killOrphanChromes()
}

/**
 * Send SIGTERM to the process group, wait up to 5s for clean exit, then
 * SIGKILL escalate. Synchronous best-effort fallback for the `process.on("exit")`
 * path lives in `bestEffortKill` below.
 */
async function killProcessGroup(child: ChildProcess | null, label: string, weStarted: boolean): Promise<void> {
	if (!child?.pid || !weStarted) return
	console.log(`[e2e-setup] Stopping ${label} (pid=${child.pid})...`)
	try {
		process.kill(-child.pid, "SIGTERM")
	} catch {
		try {
			child.kill("SIGTERM")
		} catch {
			// ignore
		}
	}
	const start = Date.now()
	while (child.exitCode === null && !child.killed && Date.now() - start < 5_000) {
		await new Promise((r) => setTimeout(r, 100))
	}
	if (child.exitCode === null && !child.killed) {
		console.warn(`[e2e-setup] ${label} did not exit on SIGTERM; sending SIGKILL`)
		try {
			process.kill(-child.pid, "SIGKILL")
		} catch {
			try {
				child.kill("SIGKILL")
			} catch {
				// ignore
			}
		}
	}
}

/** Best-effort sync kill for the `process.on("exit")` path. Sync-only:
 *  fires SIGTERM and lets the OS finish what it can — async waits aren't
 *  available here. */
function bestEffortKill(child: ChildProcess | null, weStarted: boolean): void {
	if (!child?.pid || !weStarted) return
	try {
		process.kill(-child.pid, "SIGTERM")
	} catch {
		try {
			child.kill("SIGTERM")
		} catch {
			// ignore
		}
	}
}

const onExit = () => {
	bestEffortKill(toolsProcess, weStartedTools)
	bestEffortKill(playgroundProcess, weStartedPlayground)
	bestEffortKill(nodeProcess, weStartedNode)
	bestEffortKill(anvilProcess, weStartedAnvil)
	// Deliberately NO clearLock here: these kills are fire-and-forget TERMs. If a TERM-resistant
	// process survives, the lock is the ONLY record the next run's liveness-checked orphan reap
	// can find it by - deleting it would orphan the survivor permanently (review CONFIRMED).
	// The awaited teardown() (KILL escalation) remains the sole ownership-gated lock clearer.
}
process.on("SIGINT", onExit)
process.on("SIGTERM", onExit)
process.on("exit", onExit)

declare module "vitest" {
	export interface ProvidedContext {
		extensionPath: string
		aztecTestConfig?: AztecTestConfig
		playgroundUrl: string
		/** Defined only when `TOOLS_DEV_PORT` pre-allocated a tools port; tests
		 *  that drive the tools app consume it, the rest ignore the field. */
		toolsUrl?: string
	}
}
