import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { E2E_DATA_ROOT } from "../../lockfile"

/**
 * Ownership records for launched WebDriver processes.
 *
 * Many agents share this host, so teardown must kill exactly what this launch started and nothing
 * else: no `pkill -f geckodriver`, which would take down a neighbour's run and leave it believing
 * its browser crashed. Ownership is therefore a process group plus a start-time-verified pid — the
 * start time is what makes a recycled pid detectable, and a recycled pid is the one way a
 * pgid-scoped kill can still hit a stranger.
 *
 * Records live on real disk, not tmpfs: a run killed before teardown must leave a record the next
 * run can read, and a profile directory under `/tmp` would be RAM-backed and pinned open by the
 * very process that failed to exit.
 */

const RECORD_ROOT = path.join(E2E_DATA_ROOT, "webdriver-owned")

export interface LaunchOwnership {
	/** The process we spawned; also the group leader, since it is spawned detached. */
	pid: number
	/** Field 22 of `/proc/<pid>/stat` at spawn time. A pid reused by another process has another. */
	startTime: string
	/** The test run that spawned it, identified the same way. A record whose owner is still alive
	 *  belongs to a run in progress — possibly another agent's — and is never an orphan. */
	ownerPid: number
	ownerStartTime: string
	profileDir: string
	/** False when the caller supplied the directory. A relaunch-on-the-same-profile test owns its
	 *  dir and its whole point is that the data survives teardown, so deleting it is destroying
	 *  the fixture, not cleaning up after it. */
	ownsProfile: boolean
	label: string
}

/** Fill in the owner fields for a record this process is about to take ownership of. */
export function ownedByThisRun(record: Omit<LaunchOwnership, "ownerPid" | "ownerStartTime">): LaunchOwnership {
	return { ...record, ownerPid: process.pid, ownerStartTime: readStartTime(process.pid) ?? "" }
}

/** `undefined` when the pid is gone — a dead process has no start time to compare. */
export function readStartTime(pid: number): string | undefined {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
		// The comm field is parenthesised and may itself contain spaces, so split after it.
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
		return fields[19]
	} catch {
		return undefined
	}
}

/** True only if this pid is alive AND is still the process we recorded. */
export function ownsProcess(record: LaunchOwnership): boolean {
	return readStartTime(record.pid) === record.startTime
}

export function recordLaunch(record: LaunchOwnership): void {
	mkdirSync(RECORD_ROOT, { recursive: true })
	const file = path.join(RECORD_ROOT, `${record.pid}.json`)
	const tmp = `${file}.tmp`
	writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8")
	renameSync(tmp, file)
}

/** Every record currently on disk, this run's and other runs'. Teardown assertions read this. */
export function listOwnedLaunches(): LaunchOwnership[] {
	try {
		return readdirSync(RECORD_ROOT)
			.filter((f) => f.endsWith(".json"))
			.flatMap((f) => {
				try {
					return [JSON.parse(readFileSync(path.join(RECORD_ROOT, f), "utf8")) as LaunchOwnership]
				} catch {
					return []
				}
			})
	} catch {
		return []
	}
}

export function forgetLaunch(pid: number): void {
	rmSync(path.join(RECORD_ROOT, `${pid}.json`), { force: true })
}

/**
 * Stop the process group and only then delete the profile. Deleting a profile a live Firefox still
 * holds open leaves the store pinned as a deleted-but-open file, which is how a reaper turns one
 * failed run into host-wide memory pressure.
 */
export async function releaseLaunch(record: LaunchOwnership, graceMs = 5_000): Promise<void> {
	if (ownsProcess(record)) {
		signalGroup(record.pid, "SIGTERM")
		if (!(await waitForExit(record, graceMs))) {
			signalGroup(record.pid, "SIGKILL")
			// A killed process stays in /proc until it is reaped, so this has to wait as well:
			// reading the start time in the same tick always still says the process is ours.
			await waitForExit(record, 2_000)
		}
	}
	// A process that outlived SIGKILL is unkillable (uninterruptible sleep); leaving its profile is
	// the lesser harm, and the record survives for the next run's sweep.
	if (ownsProcess(record)) return
	if (record.ownsProfile) rmSync(record.profileDir, { recursive: true, force: true })
	forgetLaunch(record.pid)
}

async function waitForExit(record: LaunchOwnership, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (!ownsProcess(record)) return true
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	return !ownsProcess(record)
}

/**
 * Sweep records whose owning test run is gone. A record whose owner is still alive belongs to a
 * run in progress — very often another agent on this host — and killing it would look to that run
 * exactly like its browser crashing, which is the failure this whole module exists to prevent.
 */
export async function reapOrphanLaunches(): Promise<string[]> {
	let files: string[]
	try {
		files = readdirSync(RECORD_ROOT).filter((f) => f.endsWith(".json"))
	} catch {
		return []
	}
	const reaped: string[] = []
	for (const file of files) {
		const full = path.join(RECORD_ROOT, file)
		let record: LaunchOwnership
		try {
			record = JSON.parse(readFileSync(full, "utf8")) as LaunchOwnership
		} catch {
			rmSync(full, { force: true })
			continue
		}
		if (readStartTime(record.ownerPid) === record.ownerStartTime) continue
		await releaseLaunch(record)
		reaped.push(record.label)
	}
	return reaped
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal)
	} catch {
		// The group is already gone, or the leader exited before its children were reparented.
	}
}
