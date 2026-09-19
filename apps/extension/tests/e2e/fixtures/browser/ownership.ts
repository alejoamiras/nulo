import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { E2E_DATA_ROOT } from "../../lockfile"

/**
 * Ownership records for launched WebDriver processes.
 *
 * Many agents share this host, so teardown must kill exactly what this launch started and nothing
 * else: no `pkill -f geckodriver`, which would take down a neighbour's run and leave it believing
 * its browser crashed.
 *
 * Identity is a random marker in the launch's environment, which every process it starts
 * inherits. Numbers cannot carry it: a pid is reissued once its process is gone, a pgid once its
 * group is, and an orphan's record sits unattended for exactly the interval in which that happens
 * — so neither "the leader's start time matches" nor "the group still has members" proves the
 * processes found are the ones recorded. A marker also follows a child that leaves the group.
 *
 * Records live on real disk, not tmpfs: a run killed before teardown must leave a record the next
 * run can read, and a profile directory under `/tmp` would be RAM-backed and pinned open by the
 * very process that failed to exit.
 */

const RECORD_ROOT = path.join(E2E_DATA_ROOT, "webdriver-owned")

/** The only place a driver creates profiles, and so the only place teardown may delete one. */
const PROFILE_ROOT = path.join(E2E_DATA_ROOT, "firefox-profiles")
const PROFILE_PREFIX = "profile-"
const PROFILE_MARKER_FILE = ".nulo-launch"

export const LAUNCH_ENV = "NULO_E2E_LAUNCH"
const MARKER_SHAPE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

export const newLaunchMarker = (): string => randomUUID()

export interface LaunchOwnership {
	marker: string
	/** The process we spawned. For the log line only; never an identity. */
	pid: number
	/** The test run that spawned it. A record whose owner is still alive belongs to a run in
	 *  progress — possibly another agent's — and is never an orphan. Pid plus start time is sound
	 *  here where it is not for the launch, because the owner is only ever COMPARED, never
	 *  signalled: a reissued pid cannot share the tick its predecessor started on, and with no
	 *  signal there is no gap between the read and an action for a reissue to fall into. */
	ownerPid: number
	ownerStartTime: string
	profileDir: string
	/** False when the caller supplied the directory. A relaunch-on-the-same-profile test owns its
	 *  dir and its whole point is that the data survives teardown, so deleting it is destroying
	 *  the fixture, not cleaning up after it. */
	ownsProfile: boolean
	label: string
}

/** Throws rather than record an owner it could not identify: that record would read as orphaned
 *  to every other run on the host, and be reaped under its live owner. */
export function ownedByThisRun(record: Omit<LaunchOwnership, "ownerPid" | "ownerStartTime">): LaunchOwnership {
	const ownerStartTime = readStartTime(process.pid)
	if (!ownerStartTime) throw new Error("cannot read this run's start time — refusing to record a launch it could not be shown to own")
	return { ...record, ownerPid: process.pid, ownerStartTime }
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

/** A profile stamped with the launch that will own it, so a record cannot claim another's. */
export function newProfileDir(marker: string): string {
	mkdirSync(PROFILE_ROOT, { recursive: true })
	const dir = mkdtempSync(path.join(PROFILE_ROOT, PROFILE_PREFIX))
	try {
		writeFileSync(path.join(dir, PROFILE_MARKER_FILE), marker, "utf8")
	} catch (err) {
		// Unstamped, no record could ever claim it, so nothing later would remove it.
		rmSync(dir, { recursive: true, force: true })
		throw err
	}
	return dir
}

/** Every live process carrying the marker. Another user's environ is unreadable, and skipped:
 *  a process we cannot read is not one we started. */
export function ownedProcesses(marker: string): number[] {
	return readdirSync("/proc")
		.filter((name) => /^\d+$/.test(name))
		.map(Number)
		.filter((pid) => carriesMarker(pid, marker))
}

function carriesMarker(pid: number, marker: string): boolean {
	try {
		return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(`${LAUNCH_ENV}=${marker}`)
	} catch {
		// Exited since it was listed, or not ours to read.
		return false
	}
}

export const ownsProcess = (record: LaunchOwnership): boolean => ownedProcesses(record.marker).length > 0

/**
 * The canonical path to delete, or `undefined` if this record has no right to one. A record is a
 * file any process on this host can write and it names a directory to remove recursively, so
 * the claim is checked against the filesystem rather than the string: resolved through symlinks,
 * directly inside the profile root, and stamped with this launch's own marker — which also stops
 * a record naming another live launch's perfectly well-formed profile.
 */
function deletableProfile(record: LaunchOwnership): string | undefined {
	try {
		const real = realpathSync(record.profileDir)
		if (path.dirname(real) !== realpathSync(PROFILE_ROOT) || !path.basename(real).startsWith(PROFILE_PREFIX)) return undefined
		return readFileSync(path.join(real, PROFILE_MARKER_FILE), "utf8") === record.marker ? real : undefined
	} catch {
		return undefined
	}
}

function isRecord(value: unknown): value is LaunchOwnership {
	const r = value as Partial<LaunchOwnership> | null
	return (
		typeof r === "object" &&
		r !== null &&
		typeof r.marker === "string" &&
		MARKER_SHAPE.test(r.marker) &&
		Number.isInteger(r.pid) &&
		Number.isInteger(r.ownerPid) &&
		typeof r.ownerStartTime === "string" &&
		typeof r.profileDir === "string" &&
		typeof r.ownsProfile === "boolean" &&
		typeof r.label === "string"
	)
}

const recordFile = (record: Pick<LaunchOwnership, "marker">): string => path.join(RECORD_ROOT, `${record.marker}.json`)

/** `undefined` for anything that is not a well-formed record filed under its own marker. */
function readRecord(file: string): LaunchOwnership | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(RECORD_ROOT, file), "utf8"))
		return isRecord(parsed) && file === `${parsed.marker}.json` ? parsed : undefined
	} catch {
		return undefined
	}
}

export function recordLaunch(record: LaunchOwnership): void {
	mkdirSync(RECORD_ROOT, { recursive: true })
	const tmp = `${recordFile(record)}.tmp`
	writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8")
	renameSync(tmp, recordFile(record))
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

/**
 * Stop the launch's processes and only then delete the profile. Deleting a profile a live Firefox
 * still holds open leaves the store pinned as a deleted-but-open file, which is how a reaper turns
 * one failed run into host-wide memory pressure.
 */
export async function releaseLaunch(record: LaunchOwnership, graceMs = 5_000): Promise<void> {
	signalOwned(record, "SIGTERM")
	if (!(await waitForExit(record, graceMs))) {
		signalOwned(record, "SIGKILL")
		// A killed process stays in /proc until it is reaped, so this has to wait as well.
		await waitForExit(record, 2_000)
	}
	// A process that outlived SIGKILL is unkillable (uninterruptible sleep); leaving its profile is
	// the lesser harm, and the record survives for the next run's sweep.
	if (ownsProcess(record)) return
	const profile = record.ownsProfile ? deletableProfile(record) : undefined
	if (profile) rmSync(profile, { recursive: true, force: true })
	rmSync(recordFile(record), { force: true })
}

async function waitForExit(record: LaunchOwnership, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (!ownsProcess(record)) return true
		await new Promise((resolve) => setTimeout(resolve, 100))
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

function signalOwned(record: LaunchOwnership, signal: NodeJS.Signals): void {
	for (const pid of ownedProcesses(record.marker)) {
		// A whole /proc scan separates finding this pid from signalling it, long enough for it to
		// exit and be reissued. Asking again leaves one read between the check and the signal, which
		// is as narrow as it gets without a pidfd — and the runtime exposes none.
		if (!carriesMarker(pid, record.marker)) continue
		try {
			process.kill(pid, signal)
		} catch {
			// Already gone.
		}
	}
}
