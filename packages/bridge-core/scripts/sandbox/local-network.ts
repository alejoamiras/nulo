/**
 * A per-run local network (anvil + `aztec start --local-network`) the sandbox scripts OWN: ports
 * drawn from a static window below the ephemeral floor, data on real disk, and a `stop()` that
 * signals exactly the process GROUPS this module spawned. Other agents run their own anvil and
 * aztec on the same machine, so a name-matched kill would take down someone else's network.
 *
 * `SANDBOX_L1_RPC` + `SANDBOX_NODE_URL` together attach to an already-running network instead
 * (a no-op `stop()`), which is how `--keep` is re-entered.
 */
import { type ChildProcess, spawn } from "node:child_process"
import {
	accessSync,
	closeSync,
	constants,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(here, "..", "..")
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── Port reservation ────────────────────────────────────────────────────────

/** Ports at or above the OS dynamic range can be handed to an OUTGOING connection between the
 *  bind test and the spawn; ports below it never are, which is the property the pack needs. */
const DEFAULT_EPHEMERAL_FLOOR = 32768
const STATIC_LO = 10_000
const FLOOR_GUARD = 512
const MAX_STATIC_TRIES = 256

interface PortReservation {
	port: number
	release: () => Promise<void>
}

async function ephemeralFloor(): Promise<number> {
	try {
		const raw = readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8")
		const lo = Number.parseInt(raw.trim().split(/\s+/)[0] ?? "", 10)
		return Number.isFinite(lo) && lo > STATIC_LO + 256 ? lo : DEFAULT_EPHEMERAL_FLOOR
	} catch {
		return DEFAULT_EPHEMERAL_FLOOR
	}
}

/** Resolves `null` on ANY bind failure so the probe loop stays a plain retry. */
function tryBind(port: number): Promise<PortReservation | null> {
	return new Promise((res) => {
		const srv = createServer()
		srv.unref()
		let settled = false
		const settle = (v: PortReservation | null) => {
			if (settled) return
			settled = true
			res(v)
		}
		srv.once("error", () => {
			srv.close()
			settle(null)
		})
		srv.listen(port, "127.0.0.1", () => {
			const addr = srv.address()
			if (!addr || typeof addr !== "object") {
				srv.close()
				settle(null)
				return
			}
			settle({ port: addr.port, release: () => new Promise<void>((rs) => srv.close(() => rs())) })
		})
	})
}

async function reservePort(): Promise<PortReservation> {
	const hi = Math.max(STATIC_LO + 256, (await ephemeralFloor()) - FLOOR_GUARD)
	const span = hi - STATIC_LO
	for (let i = 0; i < MAX_STATIC_TRIES && span >= 256; i++) {
		const reservation = await tryBind(STATIC_LO + Math.floor(Math.random() * span))
		if (reservation) return reservation
	}
	throw new Error(`no free loopback port in [${STATIC_LO}, ${hi}) after ${MAX_STATIC_TRIES} probes — the static window is exhausted`)
}

export interface SandboxPorts {
	anvil: number
	aztec: number
	aztecAdmin: number
	aztecP2P: number
}

/** Four distinct loopback ports, bind-tested against each other and released for the spawn. */
export async function reserveSandboxPorts(): Promise<SandboxPorts> {
	const held = [await reservePort(), await reservePort(), await reservePort(), await reservePort()]
	const ports = { anvil: held[0].port, aztec: held[1].port, aztecAdmin: held[2].port, aztecP2P: held[3].port }
	await Promise.all(held.map((h) => h.release()))
	return ports
}

// ─── Host port registry (~/.agents/ports.md) ─────────────────────────────────

const REGISTRY = join(homedir(), ".agents", "ports.md")
const REGISTRY_LOCK = `${REGISTRY}.lock`
/** A lock older than this belonged to a run that died holding it; the alternative is a deadlock. */
const LOCK_STALE_MS = 15_000

function tryAcquireLock(): boolean {
	try {
		closeSync(openSync(REGISTRY_LOCK, "wx", 0o600))
		return true
	} catch {
		try {
			if (Date.now() - statSync(REGISTRY_LOCK).mtimeMs > LOCK_STALE_MS) unlinkSync(REGISTRY_LOCK)
		} catch {}
		return false
	}
}

/** Rewrites the registry under the lock; `false` when the lock never came free. A missing registry
 *  means the host does not keep one, so there is nothing to write and nothing left behind. */
async function withRegistry(mutate: (lines: string[]) => string[]): Promise<boolean> {
	if (!existsSync(REGISTRY)) return true
	for (let i = 0; i < 60; i++) {
		if (tryAcquireLock()) {
			try {
				writeFileSync(REGISTRY, `${mutate(readFileSync(REGISTRY, "utf8").split("\n")).join("\n")}`)
			} finally {
				try {
					unlinkSync(REGISTRY_LOCK)
				} catch {}
			}
			return true
		}
		await sleep(100)
	}
	return false
}

const ownerCell = (runId: string) => `| ${runId} |`

async function registerPorts(runId: string, ports: SandboxPorts, pidHint: number): Promise<void> {
	const claimed = new Date().toISOString()
	const rows = Object.entries(ports).map(
		([service, port]) => `| ${port} | bridge-sandbox-${service} | ${runId} | ${REPO_ROOT} | ${pidHint} | ${claimed} |`,
	)
	await withRegistry((lines) => {
		const body = lines.filter((l) => l.trim().length > 0)
		return [...body, ...rows, ""]
	})
}

/** A registry that stayed locked keeps this run's rows forever; the warning is what makes the leak
 *  recoverable by hand. It never throws — a registry hiccup must not fail an otherwise clean run. */
async function releasePorts(runId: string, ports: SandboxPorts): Promise<void> {
	if (await withRegistry((lines) => lines.filter((l) => !l.includes(ownerCell(runId))))) return
	console.warn(
		`[sandbox] ${REGISTRY} stayed locked — remove the rows owned by ${runId} (ports ${Object.values(ports).join(", ")}) by hand`,
	)
}

// ─── Toolchain ───────────────────────────────────────────────────────────────

/** The `@aztec/aztec.js` pin this package declares — the toolchain version that matches it. */
export function aztecPin(): string {
	const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> }
	const pin = pkg.dependencies?.["@aztec/aztec.js"]
	if (typeof pin !== "string" || pin.length === 0) {
		throw new Error("packages/bridge-core/package.json declares no @aztec/aztec.js — cannot locate the matching toolchain")
	}
	return pin
}

function isExecutable(p: string): boolean {
	try {
		accessSync(p, constants.X_OK)
		return true
	} catch {
		return false
	}
}

interface Toolchain {
	anvilBin: string
	aztecBin: string
	internalBin: string
}

/**
 * The pinned root is usable only as a COMPLETE toolchain: `@aztec/ethereum` resolves forge/anvil
 * from `~/.aztec/current` ahead of PATH, so a partial install would silently deploy L1 with
 * whatever version another agent's `aztec-up` last pointed that symlink at.
 */
function resolveToolchain(root: string): Toolchain {
	const tool = {
		anvilBin: join(root, "bin", "aztec-anvil"),
		aztecBin: join(root, "node_modules", ".bin", "aztec"),
		internalBin: join(root, "internal-bin"),
	}
	const missing = [tool.anvilBin, tool.aztecBin, join(tool.internalBin, "forge"), join(tool.internalBin, "anvil")].filter(
		(p) => !isExecutable(p),
	)
	if (missing.length > 0) {
		throw new Error(`aztec toolchain at ${root} is incomplete (missing ${missing.join(", ")}) — run: aztec-up install ${aztecPin()}`)
	}
	return tool
}

// ─── Health ──────────────────────────────────────────────────────────────────

async function rpcResponds(url: string, method: string): Promise<boolean> {
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
		})
		if (!res.ok) return false
		return ((await res.json()) as { result?: unknown }).result != null
	} catch {
		return false
	}
}

async function waitHealthy(label: string, probe: () => Promise<boolean>, timeoutMs: number): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await probe()) return
		await sleep(500)
	}
	throw new Error(`${label} did not answer within ${timeoutMs}ms`)
}

// ─── Process ownership ───────────────────────────────────────────────────────

/** A spawned child plus the one authority on whether it is still running: its own `exit` event.
 *  `killed` only records that a signal was sent, and an exited PID may already name someone else. */
interface OwnedChild {
	child: ChildProcess
	hasExited: () => boolean
	exited: Promise<void>
}

function own(child: ChildProcess): OwnedChild {
	let done = false
	const exited = new Promise<void>((resolve) => {
		child.once("exit", () => {
			done = true
			resolve()
		})
	})
	return { child, hasExited: () => done, exited }
}

/** The timer is cleared on exit so a child that goes down at once does not hold the loop open. */
function exitedWithin(owned: OwnedChild, ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms)
		void owned.exited.then(() => {
			clearTimeout(timer)
			resolve()
		})
	})
}

/** Signals the process GROUP this module created (`detached: true` makes the child a group leader),
 *  so the node's own children die with it, and nothing else on the machine is touched. A child that
 *  already exited is left alone: the kernel may have handed its PID — and so its group — to a
 *  stranger. */
async function killGroup(owned: OwnedChild): Promise<void> {
	const pid = owned.child.pid
	if (pid === undefined || owned.hasExited()) return
	const signal = (sig: NodeJS.Signals) => {
		try {
			process.kill(-pid, sig)
		} catch {
			try {
				owned.child.kill(sig)
			} catch {}
		}
	}
	signal("SIGTERM")
	await exitedWithin(owned, 5_000)
	if (!owned.hasExited()) signal("SIGKILL")
}

/**
 * BOTH streams must be consumed. A piped stdout nobody reads fills its 64 KiB kernel buffer and the
 * child blocks on its next write — the aztec node stops sequencing a few blocks in, with no error
 * anywhere. Attaching a listener puts the stream in flowing mode, which is the drain.
 */
function drainOutput(child: ChildProcess, label: string): void {
	const report = (data: Buffer) => {
		const line = data.toString().trim()
		if (/\bERROR\b|\bFATAL\b|already in use/i.test(line)) console.error(`[${label}]`, line.slice(0, 200))
	}
	child.stdout?.on("data", report)
	child.stderr?.on("data", report)
}

function spawnAnvil(tool: Toolchain, port: number): ChildProcess {
	const child = spawn(
		tool.anvilBin,
		["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--slots-in-an-epoch", "1", "--silent"],
		{ stdio: "pipe", detached: true },
	)
	drainOutput(child, "anvil")
	return child
}

function nodeEnv(tool: Toolchain, anvilUrl: string): NodeJS.ProcessEnv {
	const forge = join(tool.internalBin, "forge")
	const anvil = join(tool.internalBin, "anvil")
	return {
		...process.env,
		PATH: `${tool.internalBin}${delimiter}${process.env.PATH ?? ""}`,
		// Drops the sequencer's per-block transaction floor so a single tx makes a block. It does NOT
		// make the chain tick on its own — this network still builds a block only when a transaction
		// arrives, which is why the L1→L2 waits carry a `forceBlock`.
		SEQ_MIN_TX_PER_BLOCK: "0",
		ETHEREUM_HOSTS: anvilUrl,
		// `@aztec/ethereum`'s resolver reads `~/.aztec/current/internal-bin/forge` ahead of PATH; these
		// overrides are its highest-priority source and the only way to pin the L1 deploy to this version.
		...(isExecutable(forge) ? { FORGE_BIN: forge } : {}),
		...(isExecutable(anvil) ? { ANVIL_BIN: anvil } : {}),
	}
}

function spawnNode(tool: Toolchain, p: { ports: SandboxPorts; anvilUrl: string; dataDir: string }): ChildProcess {
	const child = spawn(
		tool.aztecBin,
		[
			"start",
			"--local-network",
			"--port",
			String(p.ports.aztec),
			"--admin-port",
			String(p.ports.aztecAdmin),
			"--p2p.p2pPort",
			String(p.ports.aztecP2P),
			"--l1-rpc-urls",
			p.anvilUrl,
			"--data-directory",
			p.dataDir,
			"--disable-admin-api-key",
		],
		{ stdio: "pipe", detached: true, env: nodeEnv(tool, p.anvilUrl) },
	)
	drainOutput(child, "aztec")
	return child
}

// ─── Public surface ──────────────────────────────────────────────────────────

export interface LocalNetwork {
	anvilUrl: string
	nodeUrl: string
	stop(): Promise<void>
}

/** Both env vars together mean "use the network already running"; one alone would boot a fresh
 *  network whose other half the operator pointed elsewhere, so it is refused rather than guessed. */
function attachedNetwork(): LocalNetwork | undefined {
	const anvilUrl = process.env.SANDBOX_L1_RPC
	const nodeUrl = process.env.SANDBOX_NODE_URL
	if (!anvilUrl && !nodeUrl) return undefined
	if (!anvilUrl || !nodeUrl) {
		throw new Error(
			`SANDBOX_L1_RPC and SANDBOX_NODE_URL must be set together — only ${anvilUrl ? "SANDBOX_L1_RPC" : "SANDBOX_NODE_URL"} is set`,
		)
	}
	return { anvilUrl, nodeUrl, stop: () => Promise.resolve() }
}

export interface StartLocalNetworkOptions {
	/** Names the data directory and the registry rows this run owns. */
	runId: string
	/** Defaults to the installed toolchain matching this package's `@aztec/aztec.js` pin. */
	toolchainRoot?: string
}

/**
 * Boots anvil + an aztec local network, or attaches to the one the env names. The data directory is
 * on real disk under `~/.cache`: a tmpfs store killed before teardown pins multi-GB of RAM in a
 * deleted-but-open file until its holder dies.
 */
export async function startLocalNetwork(opts: StartLocalNetworkOptions): Promise<LocalNetwork> {
	const attached = attachedNetwork()
	if (attached) {
		console.log(`[sandbox] attaching to ${attached.anvilUrl} + ${attached.nodeUrl}`)
		return attached
	}
	const tool = resolveToolchain(opts.toolchainRoot ?? join(homedir(), ".aztec", "versions", aztecPin()))
	const ports = await reserveSandboxPorts()
	const anvilUrl = `http://127.0.0.1:${ports.anvil}`
	const nodeUrl = `http://127.0.0.1:${ports.aztec}`
	const dataDir = join(homedir(), ".cache", "nulo-bridge-sandbox", opts.runId)
	mkdirSync(dataDir, { recursive: true })
	await registerPorts(opts.runId, ports, process.pid)

	const spawned: OwnedChild[] = []
	const stop = async (): Promise<void> => {
		for (const owned of spawned.reverse()) await killGroup(owned)
		spawned.length = 0
		await releasePorts(opts.runId, ports)
		// The store belongs to this network and nothing outlives it; removing it only after the
		// holders are gone is what keeps the pages from staying pinned.
		rmSync(dataDir, { recursive: true, force: true })
	}
	// Each child is its own process-group leader, so an interrupt delivered to THIS group leaves them
	// running with the registry still claiming their ports. Reap them on the way out instead.
	const onSignal = () => {
		void stop().then(() => process.exit(130))
	}
	process.once("SIGINT", onSignal)
	process.once("SIGTERM", onSignal)
	try {
		console.log(`[sandbox] anvil ${anvilUrl}, aztec ${nodeUrl}, data ${dataDir}`)
		spawned.push(own(spawnAnvil(tool, ports.anvil)))
		await waitHealthy(`anvil at ${anvilUrl}`, () => rpcResponds(anvilUrl, "eth_chainId"), 60_000)
		spawned.push(own(spawnNode(tool, { ports, anvilUrl, dataDir })))
		await waitHealthy(`aztec node at ${nodeUrl}`, () => rpcResponds(nodeUrl, "node_getNodeInfo"), 180_000)
	} catch (e) {
		await stop()
		throw e
	}
	console.log("[sandbox] local network ready")
	return { anvilUrl, nodeUrl, stop }
}
