import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, test } from "vitest"

// Set before the module loads: `E2E_DATA_ROOT` is read at import time, and these cases write
// ownership records that must never land in a real run's state directory.
const ROOT = mkdtempSync(path.join(tmpdir(), "nulo-ownership-test-"))
process.env.NULO_E2E_DATA_ROOT = ROOT

const { ownedByThisRun, listOwnedLaunches, newProfileDir, ownsProcess, readStartTime, reapOrphanLaunches, recordLaunch, releaseLaunch } =
	await import("../../tests/e2e/fixtures/browser/ownership")

const profileFor = (name: string) => {
	const dir = path.join(ROOT, name)
	mkdirSync(dir, { recursive: true })
	return dir
}

/** A real detached process group to own, so the kill path is exercised rather than mocked. */
function spawnSleeper() {
	const child = spawn("sleep", ["120"], { detached: true, stdio: "ignore" })
	if (!child.pid) throw new Error("could not spawn a test process")
	return child.pid
}

describe("webdriver launch ownership", () => {
	const sleepers: number[] = []
	afterAll(() => {
		for (const pid of sleepers) {
			try {
				process.kill(-pid, "SIGKILL")
			} catch {
				// already reaped by the case under test
			}
		}
		rmSync(ROOT, { recursive: true, force: true })
	})

	test("a start time identifies the process, and a dead pid has none", () => {
		expect(readStartTime(process.pid)).toMatch(/^\d+$/)
		// pid 0 is never a readable process; a recycled pid is what this guards against.
		expect(readStartTime(0)).toBeUndefined()
	})

	test("ownership fails when the start time does not match — a recycled pid is not ours", () => {
		const pid = spawnSleeper()
		sleepers.push(pid)
		const record = ownedByThisRun({
			pid,
			profileDir: profileFor("owned"),
			ownsProfile: true,
			label: "t",
		})
		expect(ownsProcess(record)).toBe(true)
		expect(ownsProcess({ ...record, startTime: "999999999" })).toBe(false)
	})

	test("release kills the group and only then removes the profile", async () => {
		const pid = spawnSleeper()
		sleepers.push(pid)
		const profileDir = newProfileDir()
		const record = ownedByThisRun({ pid, profileDir, ownsProfile: true, label: "release" })
		recordLaunch(record)
		await releaseLaunch(record)
		expect(ownsProcess(record)).toBe(false)
		expect(existsSync(profileDir)).toBe(false)
	})

	// A relaunch-on-the-same-profile test hands in its own directory and exists to prove the data
	// survives teardown. Deleting it destroys the fixture and the failure looks like a storage bug.
	test("a caller-supplied profile survives release, and the record is still cleared", async () => {
		const pid = spawnSleeper()
		sleepers.push(pid)
		const profileDir = profileFor("caller-owned")
		const record = ownedByThisRun({ pid, profileDir, ownsProfile: false, label: "borrowed" })
		recordLaunch(record)
		await releaseLaunch(record)
		expect(ownsProcess(record)).toBe(false)
		expect(existsSync(profileDir)).toBe(true)
		expect(listOwnedLaunches()).toEqual([])
	})

	test("a record whose owner is still alive is NOT an orphan — it belongs to a running agent", async () => {
		const pid = spawnSleeper()
		sleepers.push(pid)
		const profileDir = profileFor("live-owner")
		// Owned by THIS process, which is alive for the duration of the test.
		recordLaunch(ownedByThisRun({ pid, profileDir, ownsProfile: true, label: "live" }))
		expect(await reapOrphanLaunches()).toEqual([])
		expect(existsSync(profileDir)).toBe(true)
		expect(readStartTime(pid)).toBeDefined()
	})

	test("a record whose owner is gone is reaped, process group and profile both", async () => {
		const pid = spawnSleeper()
		sleepers.push(pid)
		const profileDir = newProfileDir()
		recordLaunch({
			pid,
			startTime: readStartTime(pid) ?? "",
			ownerPid: 0,
			ownerStartTime: "1",
			profileDir,
			ownsProfile: true,
			label: "orphan",
		})
		expect(await reapOrphanLaunches()).toContain("orphan")
		expect(readStartTime(pid)).toBeUndefined()
		expect(existsSync(profileDir)).toBe(false)
	})

	// geckodriver can exit on SIGTERM while the Firefox it started lives on. Judging by the leader
	// alone would call that group gone and delete the profile under a running browser.
	test("a group whose leader has exited is still owned while a member survives", async () => {
		const leader = spawn("sh", ["-c", "sleep 120 & echo $!; exec sleep 0.2"], { detached: true, stdio: ["ignore", "pipe", "ignore"] })
		if (!leader.pid) throw new Error("could not spawn a test process group")
		sleepers.push(leader.pid)
		const profileDir = newProfileDir()
		const record = ownedByThisRun({ pid: leader.pid, profileDir, ownsProfile: true, label: "leaderless" })
		await new Promise((resolve) => leader.once("exit", resolve))
		expect(readStartTime(leader.pid)).toBeUndefined()
		expect(ownsProcess(record)).toBe(true)

		await releaseLaunch(record)
		expect(ownsProcess(record)).toBe(false)
		expect(existsSync(profileDir)).toBe(false)
	})

	// A record is a file any process on this host can write, and it names a directory to delete.
	test("a record cannot authorise deleting a directory the driver did not create", async () => {
		const outside = profileFor("not-a-driver-profile")
		recordLaunch({
			pid: 2_000_000_000,
			startTime: "1",
			ownerPid: 0,
			ownerStartTime: "1",
			profileDir: outside,
			ownsProfile: true,
			label: "forged",
		})
		expect(await reapOrphanLaunches()).toContain("forged")
		expect(existsSync(outside)).toBe(true)
		expect(listOwnedLaunches().map((record) => record.label)).not.toContain("forged")
	})

	test("a malformed or misfiled record is discarded without acting on it", async () => {
		const outside = profileFor("named-by-a-bad-record")
		const dir = path.join(ROOT, "webdriver-owned")
		writeFileSync(
			path.join(dir, "12345.json"),
			JSON.stringify({
				pid: 54321,
				startTime: "1",
				ownerPid: 0,
				ownerStartTime: "1",
				profileDir: outside,
				ownsProfile: true,
				label: "misfiled",
			}),
		)
		writeFileSync(path.join(dir, "777.json"), "{ not json")
		expect(await reapOrphanLaunches()).toEqual([])
		expect(existsSync(outside)).toBe(true)
		expect(existsSync(path.join(dir, "12345.json"))).toBe(false)
		expect(existsSync(path.join(dir, "777.json"))).toBe(false)
	})

	test("an identity that cannot be read is refused, not recorded as empty", () => {
		expect(() =>
			ownedByThisRun({ pid: 2_000_000_000, profileDir: profileFor("unreadable"), ownsProfile: true, label: "ghost" }),
		).toThrow(/refusing to own/)
	})
})
