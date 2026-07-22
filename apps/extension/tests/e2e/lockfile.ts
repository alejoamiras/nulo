/**
 * Per-worktree ownership lockfile for the e2e setup.
 *
 * Two jobs:
 *  - **Orphan cleanup.** When a previous `bun run e2e:agent` run was killed
 *    abnormally (Ctrl-C, OOM, machine sleep), its anvil/aztec/playground
 *    children may still be alive on the previous run's ports. The lockfile
 *    records those PIDs/pgids so the next run can reap them before
 *    allocating new ports.
 *  - **Stable-port reuse.** When the user runs `vitest` directly (no agent
 *    wrapper) with the same env vars across runs, setup reuses the prior
 *    sandbox if every check passes:
 *      • lock present
 *      • bakedLocalRpcUrl matches current BUILT_LOCAL_RPC_URL
 *      • PIDs alive
 *      • L1ContractAddresses on the candidate sandbox match what the lock
 *        recorded — proves we're talking to OUR sandbox, not a stranger
 *        that drifted onto the same port.
 *    `bun run e2e:agent` always allocates fresh ports, so it never hits
 *    the reuse path; orphan cleanup is the value there.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const E2E_STATE_DIR = path.resolve(__dirname, "../../.e2e-state")
const LOCK_PATH = path.join(E2E_STATE_DIR, "owned.json")

/**
 * Real-disk root for per-run aztec data dirs. Deliberately NOT tmpdir()/`/tmp` — that is
 * RAM-backed tmpfs, so a run killed before teardown orphans a process holding its multi-GB LMDB
 * store open as a deleted-but-open file, pinning that RAM until the holder dies (fills swap,
 * thrashes the box, breaks the agent's own tooling). Disk + the OS page cache gives RAM-speed hot
 * reads adaptively (evicts under pressure instead of OOMing), so it is not meaningfully slower —
 * and under many parallel agents it is faster, since tmpfs steals RAM from proving/Chrome. Override
 * with `NULO_E2E_DATA_ROOT` (e.g. a CI runner that wants a specific mount). Reaped by `e2e:reap`.
 */
export const E2E_DATA_ROOT = process.env.NULO_E2E_DATA_ROOT ?? path.join(homedir(), ".cache", "nulo-e2e")

/** Per-run aztec data dir path under {@link E2E_DATA_ROOT}. The `<pid>` segment lets `e2e:reap`
 *  sweep orphaned dirs whose owning process is dead. */
export function newAztecDataDir(): string {
	return path.join(E2E_DATA_ROOT, `nulo-aztec-${process.pid}-${Date.now()}`)
}

export interface OwnedPorts {
	anvil: number
	aztec: number
	aztecAdmin: number
	aztecP2P: number
	playground: number
	/** Optional: only allocated when the network suite needs the faucet dev
	 *  server (e.g. the `faucet-add-token` spec). Older lockfiles won't have
	 *  this field — the reuse path treats `undefined` as "no faucet owned". */
	faucet?: number
}

export interface OwnedState {
	startedAt: string
	bakedLocalRpcUrl: string
	ports: OwnedPorts
	pids: { anvil?: number; aztec?: number; playground?: number; faucet?: number }
	aztecDataDir: string
	/** Recorded post-deploy. Used as the identity assertion on reuse. */
	l1ContractAddresses?: Record<string, string>
	/** Address book emitted to .test-config.json. Persisted so the reuse
	 *  path can recreate that file (teardown deletes it). */
	deployedConfig?: {
		nodeUrl: string
		tokenAddress: string
		sponsoredFpcAddress: string
		minterAddress: string
	}
}

export function readLock(): OwnedState | undefined {
	try {
		if (!existsSync(LOCK_PATH)) return undefined
		const raw = readFileSync(LOCK_PATH, "utf-8")
		return JSON.parse(raw) as OwnedState
	} catch {
		return undefined
	}
}

export function writeLock(state: OwnedState): void {
	mkdirSync(E2E_STATE_DIR, { recursive: true })
	const tmp = `${LOCK_PATH}.tmp`
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
	// Atomic rename so a crash mid-write never leaves a torn JSON file.
	renameSync(tmp, LOCK_PATH)
}

export function clearLock(): void {
	try {
		rmSync(LOCK_PATH, { force: true })
	} catch {
		// ignore
	}
}

/** `process.kill(pid, 0)` returns true if the pid is alive (and we have
 *  permission to signal it). Returns false otherwise. Cheap, no side effects. */
export function isPidAlive(pid: number | undefined): boolean {
	if (typeof pid !== "number" || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/** Best-effort kill of a PID's process group. Used by orphan cleanup. */
export function killOrphanByPid(pid: number | undefined, label: string): void {
	if (!isPidAlive(pid)) return
	try {
		process.kill(-(pid as number), "SIGTERM")
	} catch {
		try {
			process.kill(pid as number, "SIGTERM")
		} catch {
			// ignore
		}
	}
	console.warn(`[e2e-setup] reaped orphan ${label} pid=${pid}`)
}
