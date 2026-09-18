import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
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

/** The only place a driver creates profiles, and so the only place teardown may delete one. */
export const PROFILE_ROOT = path.join(E2E_DATA_ROOT, "firefox-profiles")
const PROFILE_PREFIX = "profile-"

/**
 * A record is a file any process on this host can write, and it names a directory to delete
 * recursively. Deletion is therefore bounded by what a driver could have created, not by what the
 * record claims.
 */
function isDriverProfile(dir: string): boolean {
	const resolved = path.resolve(dir)
	return path.dirname(resolved) === PROFILE_ROOT && path.basename(resolved).startsWith(PROFILE_PREFIX)
}

export function newProfileDir(): string {
	mkdirSync(PROFILE_ROOT, { recursive: true })
	return mkdtempSync(path.join(PROFILE_ROOT, PROFILE_PREFIX))
}

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

/** Throws rather than record an identity it could not read: an empty start time matches nothing,
 *  so such a record would call a live group "gone" and delete the profile under it. */
export function ownedByThisRun(record: Omit<LaunchOwnership, "ownerPid" | "ownerStartTime" | "startTime">): LaunchOwnership {
	const startTime = readStartTime(record.pid)
	const ownerStartTime = readStartTime(process.pid)
	if (!startTime || !ownerStartTime) throw new Error(`cannot read a start time for pid ${record.pid} or this run — refusing to own it`)
	return { ...record, startTime, ownerPid: process.pid, ownerStartTime }
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

/** True while anything in the group exists. EPERM means it exists under another user — not ours
 *  to signal, and not gone either. */
function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0)
		return true
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * Whether the recorded GROUP is still ours, not just its leader: geckodriver can exit on SIGTERM
 * while the Firefox it spawned lives on. With the leader gone, the kernel still will not reissue a
 * pid that names a live process group, so members surviving under it can only be ours — whereas a
 * live leader with another start time proves the pid was reissued, which in turn proves our group
 * had emptied first.
 */
export function ownsProcess(record: LaunchOwnership): boolean {
	const leader = readStartTime(record.pid)
	if (leader !== undefined) return leader === record.startTime
	return groupAlive(record.pid)
}

function isRecord(value: unknown): value is LaunchOwnership {
	const r = value as Partial<LaunchOwnership> | null
	return (
		typeof r === "object" &&
		r !== null &&
		Number.isInteger(r.pid) &&
		(r.pid as number) > 1 &&
		Number.isInteger(r.ownerPid) &&
		typeof r.startTime === "string" &&
		r.startTime !== "" &&
		typeof r.ownerStartTime === "string" &&
		typeof r.profileDir === "string" &&
		typeof r.ownsProfile === "boolean" &&
		typeof r.label === "string"
	)
}

/** `undefined` for anything that is not a well-formed record filed under its own pid. */
function readRecord(file: string): LaunchOwnership | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(RECORD_ROOT, file), "utf8"))
		return isRecord(parsed) && file === `${parsed.pid}.json` ? parsed : undefined
	} catch {
		return undefined
	}
}

export function recordLaunch(record: LaunchOwnership): void {
	mkdirSync(RECORD_ROOT, { recursive: true })
	const file = path.join(RECORD_ROOT, `${record.pid}.json`)
	const tmp = `${file}.tmp`
	writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8")
	renameSync(tmp, file)
}

function recordFiles(): string[] {
	try {
		return readdirSync(RECORD_ROOT).filter((f) => f.endsWith(".json"))
	} catch {
		return []
	}
}

/** Every well-formed record on disk, this run's and other runs'. */
export function listOwnedLaunches(): LaunchOwnership[] {
	return recordFiles().flatMap((file) => readRecord(file) ?? [])
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
	if (record.ownsProfile && isDriverProfile(record.profileDir)) rmSync(record.profileDir, { recursive: true, force: true })
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
	const reaped: string[] = []
	for (const file of recordFiles()) {
		const record = readRecord(file)
		if (!record) {
			// Unreadable or misfiled: it identifies nothing that could be safely signalled or deleted.
			rmSync(path.join(RECORD_ROOT, file), { force: true })
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
		// Already gone.
	}
}
