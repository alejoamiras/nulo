import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import http from "node:http"
import { execSync, spawn, type ChildProcess } from "node:child_process"
import { tmpdir } from "node:os"
import type { TestProject } from "vitest/node"
import {
	type AztecTestConfig,
	checkNodeHealth,
	waitForLocalNode,
	createTestWallet,
	deployTestToken,
	createSponsoredFeeOptions,
	LOCAL_NODE_URL,
} from "./fixtures/aztec"
import { type OwnedState, clearLock, isPidAlive, killOrphanByPid, readLock, writeLock } from "./lockfile"
import { markBootReady, markBootStarted } from "./sentinel"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, "../../dist/chrome")
const PLAYGROUND_DIR = path.resolve(__dirname, "../../../playground")
const FAUCET_DIR = path.resolve(__dirname, "../../../faucet")
const CONFIG_PATH = path.resolve(__dirname, ".test-config.json")
const AZTEC_BIN = path.resolve(process.env.HOME || "~", ".aztec/current/node_modules/.bin/aztec")
// 5.0 renamed bundled bare binaries to aztec-* on PATH: `anvil` → `aztec-anvil` (drop-in).
const ANVIL_BIN = path.resolve(process.env.HOME || "~", ".aztec/current/bin/aztec-anvil")
// We spawn node_modules/.bin/aztec directly (AZTEC_BIN), bypassing the bin/aztec wrapper that
// prepends `internal-bin` to PATH. Replicate that prepend so the node's L1 deploy uses the
// version-matched bundled `forge`, not a system/CI foundry whose `forge script` args differ — 5.0
// otherwise fails with "deploy_aztec_l1_contracts: the following required arguments were not provided".
const AZTEC_INTERNAL_BIN = path.resolve(process.env.HOME || "~", ".aztec/current/internal-bin")

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
/** Faucet dev server. Opt-in via FAUCET_DEV_PORT (the agent wrapper sets it when
 *  the suite includes the `faucet-add-token` spec). Without this gate, every
 *  network e2e run would spawn the faucet, which is expensive (Vite + Vue +
 *  Aztec deps) and pointless for tests that don't touch the faucet. */
const FAUCET_PORT = process.env.FAUCET_DEV_PORT ? Number(process.env.FAUCET_DEV_PORT) : undefined
const FAUCET_URL = FAUCET_PORT ? `http://localhost:${FAUCET_PORT}/` : undefined

/** Per-run aztec data directory. Mandatory even for in-memory mode because
 *  some aztec subsystems still write to ~/.aztec/data by default — two
 *  agents writing there at the same time will corrupt LMDB. The path is
 *  recorded in the ownership lockfile so a future run can clean it up
 *  if this run is killed before teardown. */
let AZTEC_DATA_DIR = path.join(tmpdir(), `nulo-aztec-${process.pid}-${Date.now()}`)

let anvilProcess: ChildProcess | null = null
let weStartedAnvil = false
let nodeProcess: ChildProcess | null = null
let weStartedNode = false
let playgroundProcess: ChildProcess | null = null
let weStartedPlayground = false
let faucetProcess: ChildProcess | null = null
let weStartedFaucet = false

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

export default async function setup(project: TestProject) {
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

	// ── Lockfile: reap orphans or take over a still-healthy pack ───────
	// `bun run e2e:agent` always allocates fresh ports, so the prior lock's
	// ports never match the current ones — we fall through to reaping
	// orphans, then a fresh spawn. Direct vitest invocations with stable
	// env can land on the reuse path.
	const priorLock = readLock()
	if (priorLock) {
		const portsMatch =
			priorLock.ports.anvil === ANVIL_PORT &&
			priorLock.ports.aztec === AZTEC_PORT &&
			priorLock.ports.aztecAdmin === AZTEC_ADMIN_PORT &&
			priorLock.ports.aztecP2P === AZTEC_P2P_PORT &&
			priorLock.ports.playground === PLAYGROUND_PORT &&
			// Faucet port is optional — match only if both sides agree on its
			// presence and value. Lockfiles written before faucet wiring have
			// `priorLock.ports.faucet === undefined`; current runs without
			// faucet have `FAUCET_PORT === undefined`. Both match.
			priorLock.ports.faucet === FAUCET_PORT
		const urlMatch = priorLock.bakedLocalRpcUrl === LOCAL_NODE_URL
		if (portsMatch && urlMatch) {
			console.log("[e2e-setup] prior ownership lock matches current run — probing for reuse")
			const allCoreAlive =
				isPidAlive(priorLock.pids.anvil) && isPidAlive(priorLock.pids.aztec) && isPidAlive(priorLock.pids.playground)
			const faucetAlive = FAUCET_PORT ? isPidAlive(priorLock.pids.faucet) : true
			const faucetHealthy = FAUCET_URL ? await probeHttp(FAUCET_URL) : true
			const allHealthy =
				allCoreAlive &&
				faucetAlive &&
				(await probeAnvil(ANVIL_URL)) &&
				(await checkNodeHealth(LOCAL_NODE_URL)) &&
				(await probeHttp(PLAYGROUND_URL)) &&
				faucetHealthy
			if (allHealthy) {
				const identityOk = await verifyIdentity(LOCAL_NODE_URL, priorLock.l1ContractAddresses)
				if (identityOk) {
					console.log("[e2e-setup] reusing prior sandbox (identity check passed)")
					weStartedAnvil = false
					weStartedNode = false
					weStartedPlayground = false
					weStartedFaucet = false
					AZTEC_DATA_DIR = priorLock.aztecDataDir
					project.provide("playgroundUrl", PLAYGROUND_URL)
					project.provide("faucetUrl", FAUCET_URL)
					await deployContractsAndProvide(project)
					markBootReady()
					return
				}
				console.warn("[e2e-setup] prior sandbox identity mismatch — tearing down and starting fresh")
			} else {
				console.warn("[e2e-setup] prior sandbox not all healthy — tearing down")
			}
			killOrphanByPid(priorLock.pids.anvil, "anvil")
			killOrphanByPid(priorLock.pids.aztec, "aztec")
			killOrphanByPid(priorLock.pids.playground, "playground")
			killOrphanByPid(priorLock.pids.faucet, "faucet")
			try {
				fs.rmSync(priorLock.aztecDataDir, { recursive: true, force: true })
			} catch {}
		} else {
			// Different ports — fresh agent run after a previous one in the
			// same worktree. Reap any orphans on the previous ports.
			console.log("[e2e-setup] prior lock is for different ports — reaping orphans")
			killOrphanByPid(priorLock.pids.anvil, "anvil")
			killOrphanByPid(priorLock.pids.aztec, "aztec")
			killOrphanByPid(priorLock.pids.playground, "playground")
			killOrphanByPid(priorLock.pids.faucet, "faucet")
			try {
				fs.rmSync(priorLock.aztecDataDir, { recursive: true, force: true })
			} catch {}
		}
		clearLock()
	}

	// Sandbox bring-up begins here — this opens the boot-failure (exit 86)
	// window. Manifest validation + orphan reap above are deliberately OUTSIDE
	// it: a failure there is a build/env problem, not an infra-boot flake, so it
	// must NOT be retried.
	markBootStarted()

	// ── Anvil (L1) ─────────────────────────────────────────────────────
	const anvilAlreadyRunning = await probeAnvil(ANVIL_URL)
	if (anvilAlreadyRunning) {
		console.log("[e2e-setup] Anvil already speaking JSON-RPC at", ANVIL_URL)
		weStartedAnvil = false
	} else {
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
			project.provide("aztecTestConfig", undefined)
			project.provide("playgroundUrl", PLAYGROUND_URL)
			project.provide("faucetUrl", FAUCET_URL)
			return
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
			project.provide("aztecTestConfig", undefined)
			project.provide("playgroundUrl", PLAYGROUND_URL)
			project.provide("faucetUrl", FAUCET_URL)
			return
		}
	}

	// ── Aztec (L2) ─────────────────────────────────────────────────────
	const nodeAlreadyRunning = await checkNodeHealth(LOCAL_NODE_URL)

	if (nodeAlreadyRunning) {
		console.log("[e2e-setup] Local Aztec node already running at", LOCAL_NODE_URL)
		weStartedNode = false
	} else {
		console.log("[e2e-setup] Starting local Aztec network at", LOCAL_NODE_URL, "...")
		if (!fs.existsSync(AZTEC_BIN)) {
			// See comment above the matching ANVIL_BIN gate for the rationale.
			if (process.env.E2E_REQUIRE_SETUP === "1") {
				throw new Error(
					`[e2e-setup] FATAL: aztec CLI not found at ${AZTEC_BIN} and E2E_REQUIRE_SETUP=1 is set. ` +
						`Aborting run to prevent silent pass-by-skip. Ensure setup-aztec installed Aztec CLI ` +
						`AND created the ~/.aztec/current symlink (CI: see .github/actions/setup-aztec/action.yml).`,
				)
			}
			console.warn("[e2e-setup] aztec CLI not found at", AZTEC_BIN, "— skipping network setup")
			project.provide("aztecTestConfig", undefined)
			project.provide("playgroundUrl", PLAYGROUND_URL)
			project.provide("faucetUrl", FAUCET_URL)
			return
		}

		// Mandatory --data-directory per agent: aztec writes to $HOME/.aztec/data
		// by default for some subsystems, which would corrupt LMDB if two
		// agents run concurrently with the default path.
		fs.mkdirSync(AZTEC_DATA_DIR, { recursive: true })

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
				},
			},
		)
		weStartedNode = true

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
			project.provide("aztecTestConfig", undefined)
			project.provide("playgroundUrl", PLAYGROUND_URL)
			project.provide("faucetUrl", FAUCET_URL)
			return
		}
	}

	// ── Playground dev server ──────────────────────────────────────────
	const playgroundAlreadyRunning = await probeHttp(PLAYGROUND_URL, 1500)
	if (playgroundAlreadyRunning) {
		console.log("[e2e-setup] Playground already running at", PLAYGROUND_URL)
		weStartedPlayground = false
	} else {
		console.log("[e2e-setup] Starting playground dev server at", PLAYGROUND_URL, "...")
		try {
			playgroundProcess = spawn("bun", ["run", "dev"], {
				cwd: PLAYGROUND_DIR,
				stdio: "pipe",
				detached: true,
				env: {
					...process.env,
					NODE_ENV: "test",
					VITE_DISABLE_HMR: "1",
					PLAYGROUND_PORT: String(PLAYGROUND_PORT),
				},
			})
			weStartedPlayground = true

			playgroundProcess.stdout?.on("data", (data: Buffer) => {
				const line = data.toString().trim()
				if (line.includes("Local:") || line.includes("error")) {
					console.log("[playground]", line.slice(0, 200))
				}
			})
			playgroundProcess.stderr?.on("data", (data: Buffer) => {
				const line = data.toString().trim()
				if (line.includes("error") || line.includes("Error")) {
					console.error("[playground]", line.slice(0, 200))
				}
			})

			await waitForHttp(PLAYGROUND_URL, 30_000)
			console.log("[e2e-setup] Playground is ready")
		} catch (error) {
			console.warn("[e2e-setup] Failed to start playground:", error)
			await killProcessGroup(playgroundProcess, "playground", weStartedPlayground)
			playgroundProcess = null
			// Continue without playground — tests that depend on it will skip / fail individually
		}
	}
	project.provide("playgroundUrl", PLAYGROUND_URL)

	// ── Faucet dev server (opt-in via FAUCET_DEV_PORT) ─────────────────
	// Only spawned when the test runner pre-allocated a faucet port. This
	// keeps the default network suite lightweight — faucet startup adds ~5s
	// + a Vite + Vue process per worktree.
	if (FAUCET_PORT && FAUCET_URL) {
		const faucetAlreadyRunning = await probeHttp(FAUCET_URL, 1500)
		if (faucetAlreadyRunning) {
			console.log("[e2e-setup] Faucet already running at", FAUCET_URL)
			weStartedFaucet = false
		} else {
			console.log("[e2e-setup] Starting faucet dev server at", FAUCET_URL, "...")
			try {
				faucetProcess = spawn("bun", ["run", "dev"], {
					cwd: FAUCET_DIR,
					stdio: "pipe",
					detached: true,
					env: {
						...process.env,
						NODE_ENV: "test",
						FAUCET_DEV_PORT: String(FAUCET_PORT),
					},
				})
				weStartedFaucet = true

				faucetProcess.stdout?.on("data", (data: Buffer) => {
					const line = data.toString().trim()
					if (line.includes("Local:") || line.includes("error")) {
						console.log("[faucet]", line.slice(0, 200))
					}
				})
				faucetProcess.stderr?.on("data", (data: Buffer) => {
					const line = data.toString().trim()
					if (line.includes("error") || line.includes("Error")) {
						console.error("[faucet]", line.slice(0, 200))
					}
				})

				await waitForHttp(FAUCET_URL, 30_000)
				console.log("[e2e-setup] Faucet is ready")
			} catch (error) {
				console.warn("[e2e-setup] Failed to start faucet:", error)
				await killProcessGroup(faucetProcess, "faucet", weStartedFaucet)
				faucetProcess = null
				// Continue — only faucet-specific tests will fail.
			}
		}
	}
	project.provide("faucetUrl", FAUCET_URL)

	await deployContractsAndProvide(project)
	// Sandbox healthy + contracts deployed, BEFORE any test worker starts —
	// this closes the boot-failure (exit 86) window. Any failure from here on
	// (fixture, import, test body) is a real failure, never an infra-boot flake.
	markBootReady()
}

/**
 * Deploy SponsoredFPC + a test Token, write `.test-config.json`, and write
 * the ownership lock with PIDs + L1 contract addresses + the address book.
 * On reuse the lock's `deployedConfig` lets us recreate `.test-config.json`
 * without redeploying.
 */
async function deployContractsAndProvide(project: TestProject): Promise<void> {
	const existingLock = readLock()
	if (existingLock?.deployedConfig?.nodeUrl === LOCAL_NODE_URL) {
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

			config = {
				nodeUrl: LOCAL_NODE_URL,
				tokenAddress,
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
	const owned: OwnedState = {
		startedAt: new Date().toISOString(),
		bakedLocalRpcUrl: LOCAL_NODE_URL,
		ports: {
			anvil: ANVIL_PORT,
			aztec: AZTEC_PORT,
			aztecAdmin: AZTEC_ADMIN_PORT,
			aztecP2P: AZTEC_P2P_PORT,
			playground: PLAYGROUND_PORT,
			...(FAUCET_PORT ? { faucet: FAUCET_PORT } : {}),
		},
		pids: {
			anvil: weStartedAnvil ? anvilProcess?.pid : undefined,
			aztec: weStartedNode ? nodeProcess?.pid : undefined,
			playground: weStartedPlayground ? playgroundProcess?.pid : undefined,
			faucet: weStartedFaucet ? faucetProcess?.pid : undefined,
		},
		aztecDataDir: AZTEC_DATA_DIR,
		l1ContractAddresses,
		deployedConfig: config,
	}
	writeLock(owned)
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

	await killProcessGroup(faucetProcess, "faucet", weStartedFaucet)
	faucetProcess = null
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

	clearLock()
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
	bestEffortKill(playgroundProcess, weStartedPlayground)
	bestEffortKill(nodeProcess, weStartedNode)
	bestEffortKill(anvilProcess, weStartedAnvil)
	clearLock()
}
process.on("SIGINT", onExit)
process.on("SIGTERM", onExit)
process.on("exit", onExit)

declare module "vitest" {
	export interface ProvidedContext {
		extensionPath: string
		aztecTestConfig?: AztecTestConfig
		playgroundUrl: string
		/** Defined only when the network suite pre-allocated a faucet port via
		 *  `FAUCET_DEV_PORT`. Tests that exercise the faucet dApp (e.g.
		 *  `faucet-add-token.test.ts`) consume this; tests that don't need it
		 *  ignore the field. */
		faucetUrl?: string
	}
}
