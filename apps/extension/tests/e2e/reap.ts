/**
 * `bun run e2e:reap` — session-end cleanup for local e2e runs.
 *
 * The teardown stack + next-run orphan reap only fire when a run exits cleanly or when the NEXT run
 * boots. When you stop running e2e (walk away after a burst, `git worktree remove` a throwaway
 * baseline), the last runs' sandboxes are never reaped — and each orphaned aztec process holds its
 * multi-GB data dir open, which under the old tmpfs layout pinned that space in RAM until the box
 * thrashed. This script is the explicit "clean up after myself" step:
 *
 *   1. Reap THIS worktree's owned run (from `.e2e-state/owned.json`): kill the recorded process
 *      groups, remove the recorded data dir, clear the lock.
 *   2. Sweep {@link E2E_DATA_ROOT} for orphaned `nulo-aztec-<pid>-*` dirs whose owning process is
 *      DEAD, and remove them (live pids are skipped, so a concurrent agent's run is never touched).
 *
 * Ownership-scoped by design: it only kills pids this worktree's lock recorded and only deletes
 * data dirs whose owner is gone — never a blanket `pkill -f aztec` that could hit another agent.
 */
import { readdirSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { E2E_DATA_ROOT, clearLock, isPidAlive, killOrphanByPid, readLock } from "./lockfile"

function reapOwnedRun(): boolean {
	const lock = readLock()
	if (!lock) return false
	console.log("[e2e:reap] found owned.json — reaping this worktree's run")
	killOrphanByPid(lock.pids.anvil, "anvil")
	killOrphanByPid(lock.pids.aztec, "aztec")
	killOrphanByPid(lock.pids.playground, "playground")
	killOrphanByPid(lock.pids.tools, "tools")
	if (lock.aztecDataDir) {
		rmSync(lock.aztecDataDir, { recursive: true, force: true })
		console.log(`[e2e:reap] removed data dir ${lock.aztecDataDir}`)
	}
	clearLock()
	console.log("[e2e:reap] cleared lock")
	return true
}

/** Remove `nulo-aztec-<pid>-<ts>` dirs whose `<pid>` is no longer alive. */
function sweepOrphanDataDirs(): number {
	let removed = 0
	let entries: string[]
	try {
		entries = readdirSync(E2E_DATA_ROOT)
	} catch {
		return 0 // root doesn't exist yet — nothing to sweep
	}
	for (const name of entries) {
		const match = name.match(/^nulo-aztec-(\d+)-\d+$/)
		if (!match) continue
		const pid = Number(match[1])
		if (isPidAlive(pid)) continue // a live (possibly another worktree's) run owns it — leave it
		const full = path.join(E2E_DATA_ROOT, name)
		try {
			if (!statSync(full).isDirectory()) continue
			rmSync(full, { recursive: true, force: true })
			removed++
			console.log(`[e2e:reap] swept orphan data dir ${full} (pid ${pid} dead)`)
		} catch {
			// best-effort
		}
	}
	return removed
}

const reaped = reapOwnedRun()
const swept = sweepOrphanDataDirs()
if (!reaped && swept === 0) {
	console.log("[e2e:reap] nothing to reap — no owned run, no orphaned data dirs")
} else {
	console.log(`[e2e:reap] done (owned run reaped: ${reaped}, orphan data dirs swept: ${swept})`)
}
