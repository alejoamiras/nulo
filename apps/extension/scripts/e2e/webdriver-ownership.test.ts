import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, test, vi } from "vitest"

// Set before the module loads: `E2E_DATA_ROOT` is read at import time, and these cases write
// ownership records that must never land in a real run's state directory.
const ROOT = mkdtempSync(path.join(tmpdir(), "nulo-ownership-test-"))
process.env.NULO_E2E_DATA_ROOT = ROOT

const {
	LAUNCH_ENV,
	disownProfile,
	listOwnedLaunches,
	newLaunchMarker,
	newProfileDir,
	ownedByThisRun,
	ownedProcesses,
	ownsProcess,
	readStartTime,
	reapOrphanLaunches,
	recordLaunch,
	releaseLaunch,
} = await import("../../tests/e2e/fixtures/browser/ownership")

const RECORDS = path.join(ROOT, "webdriver-owned")

const plainDir = (name: string) => {
	const dir = path.join(ROOT, name)
	mkdirSync(dir, { recursive: true })
	return dir
}

const markers: string[] = []
function launchMarker(): string {
	const marker = newLaunchMarker()
	markers.push(marker)
	return marker
}

/** Real processes to own, so the kill path is exercised rather than mocked. Returns once a scan has
 *  found the child carrying its marker: Bun's spawn returns while the child is still inside execve,
 *  and until the kernel has set up the new image its `/proc/<pid>/environ` reads empty. A child that
 *  execs again reads empty again, so one sighting is the proof, not a second read. */
async function spawnMarked(marker: string, command = "sleep", args = ["120"]): Promise<number> {
	const child = spawn(command, args, { detached: true, stdio: "ignore", env: { ...process.env, [LAUNCH_ENV]: marker } })
	const pid = child.pid
	if (!pid) throw new Error("could not spawn a test process")
	let seen = false
	await until(() => {
		seen = ownedProcesses(marker).includes(pid)
		return seen
	})
	if (!seen) throw new Error(`process ${pid} never showed its marker`)
	return pid
}

/** Runs a release on fake timers, so each poll lands on a fixed tick however slow a scan is, and
 *  records every signal meant for `pid` instead of sending it; with `failFirst` the first send
 *  fails. Returns the signals in the order they were sent. */
async function recordSignals(pid: number, release: () => Promise<void>, failFirst = false): Promise<unknown[]> {
	const sent: unknown[] = []
	const realKill = process.kill.bind(process)
	const kill = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
		if (target !== pid) return realKill(target, signal)
		sent.push(signal)
		if (failFirst && sent.length === 1) throw new Error("not sent")
		return true
	})
	vi.useFakeTimers({ toFake: ["setTimeout", "Date"] })
	try {
		const released = release()
		await vi.advanceTimersByTimeAsync(10_000)
		await released
	} finally {
		vi.useRealTimers()
		kill.mockRestore()
	}
	return sent
}

/** A record whose owning run is gone, which is what makes the sweep act on it. */
const orphaned = (record: { marker: string; pid: number; profileDir: string; ownsProfile: boolean; label: string }) => ({
	...record,
	ownerPid: 0,
	ownerStartTime: "1",
})

async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
}

// Ownership is read from `/proc/<pid>/environ`, so the Firefox driver — and these cases — are
// Linux-only. The unit suite still has to pass for a Chrome-only developer elsewhere.
// `releaseLaunch` may spend its whole grace (5 s, then 2 s after SIGKILL) on a loaded host, which
// is already past the runner's 5 s default.
describe.skipIf(process.platform !== "linux")("webdriver launch ownership", { timeout: 20_000 }, () => {
	afterAll(() => {
		for (const pid of markers.flatMap((marker) => ownedProcesses(marker))) {
			try {
				process.kill(pid, "SIGKILL")
			} catch {
				// Already reaped by the case under test.
			}
		}
		rmSync(ROOT, { recursive: true, force: true })
	})

	test("a start time identifies the owning run, and a dead pid has none", () => {
		expect(readStartTime(process.pid)).toMatch(/^\d+$/)
		expect(readStartTime(0)).toBeUndefined()
	})

	test("a process is owned by the marker it inherited, not by its number", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		expect(ownedProcesses(marker)).toEqual([pid])
		// The same pid under another launch's marker is a stranger: this is the recycled-number case.
		expect(ownsProcess(ownedByThisRun({ marker: launchMarker(), pid, profileDir: "", ownsProfile: false, label: "t" }))).toBe(false)
	})

	test("release stops the processes and only then removes the profile", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		const profileDir = newProfileDir(marker)
		const record = ownedByThisRun({ marker, pid, profileDir, ownsProfile: true, label: "release" })
		recordLaunch(record)
		await releaseLaunch(record)
		expect(ownsProcess(record)).toBe(false)
		expect(existsSync(profileDir)).toBe(false)
		expect(existsSync(path.join(RECORDS, `${marker}.json`))).toBe(false)
	})

	// No test process can be made to outlive SIGKILL, so here its signals are recorded, not sent, and
	// the first one fails. A failed send is retried on the next poll; a sent one is not repeated.
	test("a launch that outlives SIGKILL keeps its profile and its record", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		const profileDir = newProfileDir(marker)
		const record = ownedByThisRun({ marker, pid, profileDir, ownsProfile: true, label: "unkillable" })
		recordLaunch(record)
		expect(await recordSignals(pid, () => releaseLaunch(record, 1_000), true)).toEqual(["SIGTERM", "SIGTERM", "SIGKILL"])
		expect(existsSync(profileDir)).toBe(true)
		expect(existsSync(path.join(RECORDS, `${marker}.json`))).toBe(true)
	})

	// A process inside execve reads an empty environ, so one scan can miss it and a later one find it.
	test("a process a later scan finds is signalled, and only two empty scans in a row free the profile", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		const profileDir = newProfileDir(marker)
		const record = ownedByThisRun({ marker, pid, profileDir, ownsProfile: true, label: "late" })
		recordLaunch(record)
		const polls = [[], [pid], [], []]
		const profileAtPoll: boolean[] = []
		const scan = () => {
			profileAtPoll.push(existsSync(profileDir))
			return polls[profileAtPoll.length - 1] ?? []
		}
		expect(await recordSignals(pid, () => releaseLaunch(record, 1_000, scan))).toEqual(["SIGTERM"])
		expect(profileAtPoll).toEqual([true, true, true, true])
		expect(existsSync(profileDir)).toBe(false)
	})

	// Firefox's children are free to start their own session. A group signal would miss that one
	// and the profile would be deleted under it.
	test("a child that left the process group is still found and stopped", async () => {
		const marker = launchMarker()
		const leader = await spawnMarked(marker, "sh", ["-c", "setsid sleep 120 & exec sleep 120"])
		await until(() => ownedProcesses(marker).length === 2)
		expect(ownedProcesses(marker)).toHaveLength(2)

		const record = ownedByThisRun({ marker, pid: leader, profileDir: newProfileDir(marker), ownsProfile: true, label: "escaped" })
		await releaseLaunch(record)
		expect(ownedProcesses(marker)).toEqual([])
		expect(existsSync(record.profileDir)).toBe(false)
	})

	// A relaunch-on-the-same-profile test hands in its own directory and exists to prove the data
	// survives teardown. Deleting it destroys the fixture and the failure looks like a storage bug.
	test("a caller-supplied profile survives release, and the record is still cleared", async () => {
		const marker = launchMarker()
		const profileDir = plainDir("caller-owned")
		const record = ownedByThisRun({ marker, pid: await spawnMarked(marker), profileDir, ownsProfile: false, label: "borrowed" })
		recordLaunch(record)
		await releaseLaunch(record)
		expect(ownsProcess(record)).toBe(false)
		expect(existsSync(profileDir)).toBe(true)
		expect(listOwnedLaunches().map((r) => r.marker)).not.toContain(marker)
	})

	test("a record whose owner is still alive is NOT an orphan — it belongs to a running agent", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		const profileDir = newProfileDir(marker)
		// Owned by THIS process, which is alive for the duration of the test.
		recordLaunch(ownedByThisRun({ marker, pid, profileDir, ownsProfile: true, label: "live" }))
		expect(await reapOrphanLaunches()).not.toContain("live")
		expect(existsSync(profileDir)).toBe(true)
		expect(ownedProcesses(marker)).toEqual([pid])
	})

	test("a record whose owner is gone is reaped, processes and profile both", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		const profileDir = newProfileDir(marker)
		recordLaunch(orphaned({ marker, pid, profileDir, ownsProfile: true, label: "orphan" }))
		expect(await reapOrphanLaunches()).toContain("orphan")
		expect(ownedProcesses(marker)).toEqual([])
		expect(existsSync(profileDir)).toBe(false)
	})

	test("a disowned profile survives the sweep of a run that died before its own cleanup", async () => {
		const marker = launchMarker()
		const profileDir = newProfileDir(marker)
		const record = orphaned({ marker, pid: 0, profileDir, ownsProfile: true, label: "disowned" })
		recordLaunch(record)
		disownProfile(record)
		expect(await reapOrphanLaunches()).toContain("disowned")
		expect(existsSync(profileDir)).toBe(true)
		expect(existsSync(path.join(RECORDS, `${marker}.json`))).toBe(false)
	})

	// The interval an orphan's record sits unattended is exactly when its numbers get reissued.
	test("an orphan's record never authorises a signal to a process that lacks its marker", async () => {
		const stranger = await spawnMarked(launchMarker())
		recordLaunch(orphaned({ marker: launchMarker(), pid: stranger, profileDir: "", ownsProfile: false, label: "reissued" }))
		expect(await reapOrphanLaunches()).toContain("reissued")
		expect(readStartTime(stranger)).toBeDefined()
	})

	// A record is a file any process on this host can write, and it names a directory to delete.
	describe("a record cannot authorise deleting", () => {
		const reapForged = async (profileDir: string, marker = launchMarker()) => {
			recordLaunch(orphaned({ marker, pid: 2_000_000_000, profileDir, ownsProfile: true, label: "forged" }))
			expect(await reapOrphanLaunches()).toContain("forged")
		}

		test("a directory the driver did not create", async () => {
			const outside = plainDir("not-a-driver-profile")
			await reapForged(outside)
			expect(existsSync(outside)).toBe(true)
		})

		test("another launch's profile, however well-formed its path", async () => {
			const victim = newProfileDir(launchMarker())
			await reapForged(victim)
			expect(existsSync(victim)).toBe(true)
		})

		// `path.resolve` folds `link/..` away as text; the filesystem follows `link` first.
		test("a path that only looks contained until its symlinks are resolved", async () => {
			const marker = launchMarker()
			const outside = plainDir("reached-through-a-link")
			const victim = path.join(outside, "profile-victim")
			mkdirSync(victim)
			writeFileSync(path.join(victim, ".nulo-launch"), marker)
			const link = path.join(path.dirname(newProfileDir(launchMarker())), "profile-link")
			symlinkSync(victim, link)
			await reapForged(link, marker)
			expect(existsSync(victim)).toBe(true)
		})
	})

	test("a malformed or misfiled record is discarded without acting on it", async () => {
		const marker = launchMarker()
		const pid = await spawnMarked(marker)
		mkdirSync(RECORDS, { recursive: true })
		const misfiled = path.join(RECORDS, `${newLaunchMarker()}.json`)
		writeFileSync(misfiled, JSON.stringify(orphaned({ marker, pid, profileDir: "", ownsProfile: false, label: "misfiled" })))
		const garbage = path.join(RECORDS, "777.json")
		writeFileSync(garbage, "{ not json")
		expect(await reapOrphanLaunches()).not.toContain("misfiled")
		expect(ownedProcesses(marker)).toEqual([pid])
		expect(existsSync(misfiled)).toBe(false)
		expect(existsSync(garbage)).toBe(false)
	})
})
