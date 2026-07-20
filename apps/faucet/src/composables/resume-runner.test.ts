import type { DepositJournalRecord } from "@nulo/bridge-core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ResumeVerdict } from "@/lib/resume-validator"
import { type ResumeRunnerDeps, runResume } from "./resume-runner"

const OK: ResumeVerdict = { ok: true, variant: "direct-fuel-public" }

function makeDeps(over: Partial<ResumeRunnerDeps> = {}, recOver: Partial<DepositJournalRecord> = {}) {
	let rec: DepositJournalRecord | undefined = { id: "0xr", direction: "deposit", ...recOver } as DepositJournalRecord
	const events: string[] = []
	let latched = false
	const deps: ResumeRunnerDeps = {
		getRecord: () => rec,
		validate: async () => OK,
		withLock: async (_n, fn) => {
			events.push("lock-acquire")
			const r = await fn()
			events.push("lock-release")
			return r
		},
		latch: (id) => {
			events.push("latch")
			if (latched) return false
			latched = true
			rec = { ...(rec as DepositJournalRecord), resumeAttemptAt: 1 }
			return true
		},
		allowanceSufficient: async () => {
			events.push("allowance")
			return true
		},
		approve: async () => {
			events.push("approve")
		},
		deposit: async () => {
			events.push("deposit")
			return "0xdeposit"
		},
		onDepositHash: (id, hash) => {
			events.push(`hash:${hash}`)
			rec = { ...(rec as DepositJournalRecord), depositTxHash: hash }
		},
		reclassifyUnknownOutcome: () => {
			events.push("reclassify-unknown")
		},
		runClaim: async () => {
			events.push("claim")
		},
		setStep: () => {},
		flagError: (_id, note) => {
			events.push(`flag:${note.slice(0, 12)}`)
		},
		lockName: (id) => `bridge-resume:${id}`,
		...over,
	}
	return { deps, events, setRec: (r: DepositJournalRecord | undefined) => (rec = r), getRec: () => rec }
}

describe("runResume — the safe ordering", () => {
	it("happy path: validate → lock → allowance → latch → deposit → hash → release → claim", async () => {
		const { deps, events } = makeDeps({}, { failedOutcome: "no-funds-moved", failedLeg: "approving" })
		const res = await runResume("0xr", deps)
		expect(res).toEqual({ status: "ok" })
		expect(events).toEqual(["lock-acquire", "allowance", "latch", "deposit", "hash:0xdeposit", "lock-release", "claim"])
	})

	it("the claim is handed off ONLY after the lock releases (no nesting)", async () => {
		const { deps, events } = makeDeps()
		await runResume("0xr", deps)
		expect(events.indexOf("lock-release")).toBeLessThan(events.indexOf("claim"))
	})

	it("the latch is taken AFTER the allowance leg (an approve death must not burn the attempt)", async () => {
		const { deps, events } = makeDeps({ allowanceSufficient: async () => false })
		await runResume("0xr", deps)
		expect(events.indexOf("approve")).toBeLessThan(events.indexOf("latch"))
		expect(events.indexOf("latch")).toBeLessThan(events.indexOf("deposit"))
	})

	it("refuses a record the validator rejects — no lock, no deposit", async () => {
		const verdict: ResumeVerdict = { ok: false, affordance: "review-only", reason: "unknown" }
		const { deps, events } = makeDeps({ validate: async () => verdict })
		const res = await runResume("0xr", deps)
		expect(res).toEqual({ status: "refused", verdict })
		expect(events).toEqual([])
	})

	it("a depositTxHash appearing before the latch (cross-tab) aborts to claim, never re-deposits", async () => {
		const { deps, events } = makeDeps({
			allowanceSufficient: async () => true,
		})
		// Simulate the OTHER tab landing a hash during our allowance step.
		const orig = deps.allowanceSufficient
		deps.allowanceSufficient = async (r) => {
			const ok = await orig(r)
			deps.getRecord = () => ({ id: "0xr", direction: "deposit", depositTxHash: "0xother" }) as DepositJournalRecord
			return ok
		}
		const res = await runResume("0xr", deps)
		expect(res).toEqual({ status: "ok" })
		expect(events).not.toContain("deposit")
		expect(events).not.toContain("latch")
		expect(events).toContain("claim")
	})

	it("a second attempt (latch already set) refuses and never deposits", async () => {
		const { deps, events } = makeDeps({ latch: () => false })
		const res = await runResume("0xr", deps)
		expect(res).toEqual({ status: "already-attempted" })
		expect(events).not.toContain("deposit")
	})

	it("a deposit-prompt throw reclassifies unknown-outcome and surfaces the error (latched → permanent)", async () => {
		const { deps, events } = makeDeps({
			deposit: async () => {
				throw new Error("wallet closed")
			},
		})
		const res = await runResume("0xr", deps)
		expect(res.status).toBe("error")
		expect(events).toContain("reclassify-unknown")
		expect(events).toContain("latch") // the attempt WAS burned — ambiguous send
		expect(events).not.toContain("claim")
	})

	it("a vanished record returns gone before any work", async () => {
		const { deps } = makeDeps({ getRecord: () => undefined })
		expect(await runResume("0xr", deps)).toEqual({ status: "gone" })
	})
})
