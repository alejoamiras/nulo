import { describe, expect, test } from "bun:test"
import { NEEDS_RESOLUTION_LABEL } from "./open-sync-pr"
import { type RunSyncOpts, runSync, type SyncIO } from "./open-sync-pr-run"

const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

interface Calls {
	resolveReleasePrMergeSha: string[]
	findOpenSyncPr: string[]
	prepareSyncBranch: Array<{ branch: string; version: string }>
	openPr: Array<{ branch: string; title: string }>
	mergeability: number[]
	flagConflict: Array<{ prNumber: number; label: string }>
}

function fakeIO(script: { releaseSha?: string | null; openPr?: number | null; mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"; prNumber?: number } = {}): { io: SyncIO; calls: Calls } {
	const calls: Calls = { resolveReleasePrMergeSha: [], findOpenSyncPr: [], prepareSyncBranch: [], openPr: [], mergeability: [], flagConflict: [] }
	const io: SyncIO = {
		async resolveReleasePrMergeSha(headSha) {
			calls.resolveReleasePrMergeSha.push(headSha)
			return script.releaseSha === undefined ? headSha : script.releaseSha
		},
		async findOpenSyncPr(branch) {
			calls.findOpenSyncPr.push(branch)
			return script.openPr ?? null
		},
		async prepareSyncBranch(branch, version) {
			calls.prepareSyncBranch.push({ branch, version })
		},
		async openPr(branch, title) {
			calls.openPr.push({ branch, title })
			return script.prNumber ?? 200
		},
		async mergeability(prNumber) {
			calls.mergeability.push(prNumber)
			return script.mergeable ?? "MERGEABLE"
		},
		async flagConflict(prNumber, label) {
			calls.flagConflict.push({ prNumber, label })
		},
		log() {},
	}
	return { io, calls }
}

function opts(over: Partial<RunSyncOpts> & Pick<RunSyncOpts, "io">): RunSyncOpts {
	return { eventName: "push", isPrerelease: false, headSha: SHA, version: "0.24.0", ...over }
}

describe("runSync — eligibility gate (zero-API on the common path)", () => {
	test("workflow_dispatch republish → skip, NO Release-PR resolution", async () => {
		const { io, calls } = fakeIO()
		const r = await runSync(opts({ io, eventName: "workflow_dispatch" }))
		expect(r.action).toBe("skip")
		expect(r.exitCode).toBe(0)
		expect(calls.resolveReleasePrMergeSha).toHaveLength(0)
		expect(calls.prepareSyncBranch).toHaveLength(0)
	})

	test("prerelease (rc) → skip, no resolution", async () => {
		const { io, calls } = fakeIO()
		const r = await runSync(opts({ io, isPrerelease: true }))
		expect(r.action).toBe("skip")
		expect(calls.resolveReleasePrMergeSha).toHaveLength(0)
	})

	test("push+stable but HEAD is not a Release-PR merge → skip (resolved, but no branch)", async () => {
		const { io, calls } = fakeIO({ releaseSha: null })
		const r = await runSync(opts({ io }))
		expect(r.action).toBe("skip")
		expect(calls.resolveReleasePrMergeSha).toHaveLength(1)
		expect(calls.prepareSyncBranch).toHaveLength(0)
	})

	test("push+stable but resolved merge sha != HEAD (old-tag push) → skip", async () => {
		const { io } = fakeIO({ releaseSha: "0000000000000000000000000000000000000000" })
		const r = await runSync(opts({ io }))
		expect(r.action).toBe("skip")
	})
})

describe("runSync — opening the sync PR", () => {
	test("eligible + a sync PR already open → exists, branch NOT re-prepared (idempotent)", async () => {
		const { io, calls } = fakeIO({ openPr: 199 })
		const r = await runSync(opts({ io }))
		expect(r.action).toBe("exists")
		expect(r.prNumber).toBe(199)
		expect(calls.prepareSyncBranch).toHaveLength(0)
		expect(calls.openPr).toHaveLength(0)
	})

	test("eligible + MERGEABLE → prepare + open, clean, no conflict label", async () => {
		const { io, calls } = fakeIO({ mergeable: "MERGEABLE", prNumber: 201 })
		const r = await runSync(opts({ io }))
		expect(r.action).toBe("opened-clean")
		expect(r.prNumber).toBe(201)
		expect(calls.prepareSyncBranch).toEqual([{ branch: "sync/main-to-dev-v0.24.0", version: "0.24.0" }])
		expect(calls.openPr[0].branch).toBe("sync/main-to-dev-v0.24.0")
		expect(calls.flagConflict).toHaveLength(0)
	})

	test("eligible + CONFLICTING → opened + labeled needs-manual-resolution (surfaced, exit 0)", async () => {
		const { io, calls } = fakeIO({ mergeable: "CONFLICTING", prNumber: 202 })
		const r = await runSync(opts({ io }))
		expect(r.action).toBe("opened-conflict")
		expect(r.exitCode).toBe(0)
		expect(calls.flagConflict).toEqual([{ prNumber: 202, label: NEEDS_RESOLUTION_LABEL }])
	})

	test("eligible + UNKNOWN (mergeability never computed) → labeled, fail-closed", async () => {
		const { io, calls } = fakeIO({ mergeable: "UNKNOWN", prNumber: 203 })
		const r = await runSync(opts({ io }))
		expect(r.action).toBe("opened-conflict")
		expect(calls.flagConflict).toHaveLength(1)
	})

	test("the branch + manifest re-baseline carry the stable version", async () => {
		const { io, calls } = fakeIO({ mergeable: "MERGEABLE" })
		await runSync(opts({ io, version: "1.2.3" }))
		expect(calls.prepareSyncBranch).toEqual([{ branch: "sync/main-to-dev-v1.2.3", version: "1.2.3" }])
	})
})
