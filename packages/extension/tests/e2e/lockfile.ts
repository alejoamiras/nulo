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
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const E2E_STATE_DIR = path.resolve(__dirname, "../../.e2e-state")
const LOCK_PATH = path.join(E2E_STATE_DIR, "owned.json")

export interface OwnedPorts {
	anvil: number
	aztec: number
	aztecAdmin: number
	aztecP2P: number
	playground: number
}

export interface OwnedState {
	startedAt: string
	bakedLocalRpcUrl: string
	ports: OwnedPorts
	pids: { anvil?: number; aztec?: number; playground?: number }
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
