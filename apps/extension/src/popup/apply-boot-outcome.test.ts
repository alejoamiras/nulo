import { describe, expect, test } from "vitest"
import { applyBootOutcome, type BootOutcomeShell } from "./apply-boot-outcome"

const p1 = { id: "p1" }

function shell() {
	const calls: string[] = []
	const s: BootOutcomeShell<{ id: string }> = {
		setRetrying: (v) => calls.push(`retrying=${v}`),
		setProfiles: (p) => calls.push(`profiles=${p.map((x) => x.id).join(",")}`),
		markChecked: () => calls.push("checked"),
		settleUndecided: (o, c) => calls.push(`undecided:${o}:${c?.id ?? "-"}`),
		logFailed: (id) => calls.push(`log:${id}`),
		advance: (still) => calls.push(`advance:${still}`),
	}
	return { calls, s }
}

describe("applyBootOutcome", () => {
	test("superseded by a newer run: nothing at all — that run owns every flag", () => {
		const { calls, s } = shell()
		applyBootOutcome({ kind: "superseded" }, s)
		expect(calls).toEqual([])
	})

	test("superseded by an event: the retry presentation ends and the session counts as checked; no list, no candidate, no route", () => {
		// A retried FAILED boot whose lookup was overtaken by a lock event: the event routed the
		// shell to auth, but only this run can end `retrying` — left true, the auth form stays
		// withheld with RETRY disabled until the next reconnect.
		const { calls, s } = shell()
		applyBootOutcome({ kind: "event-superseded" }, s)
		expect(calls).toEqual(["retrying=false", "checked"])
	})

	test("initial boot superseded by an event still marks the session checked", () => {
		const { calls, s } = shell()
		applyBootOutcome({ kind: "event-superseded" }, s)
		expect(calls).toContain("checked")
	})

	test("locked: the list is applied; the reconcile already acted", () => {
		const { calls, s } = shell()
		applyBootOutcome({ kind: "locked", profiles: [p1], candidate: p1 }, s)
		expect(calls).toEqual(["retrying=false", "profiles=p1"])
	})

	test("unreachable and failed settle undecided with the list applied", () => {
		const a = shell()
		applyBootOutcome({ kind: "unreachable", profiles: [p1], candidate: p1 }, a.s)
		expect(a.calls).toEqual(["retrying=false", "profiles=p1", "undecided:unreachable:p1"])
		const b = shell()
		applyBootOutcome({ kind: "failed", profiles: [p1], profile: p1 }, b.s)
		expect(b.calls).toEqual(["retrying=false", "profiles=p1", "log:p1", "undecided:failed:-"])
	})

	test("active: checked, then advance with the survival flag", () => {
		const { calls, s } = shell()
		applyBootOutcome({ kind: "active", profiles: [p1], profile: p1, stillActive: false }, s)
		expect(calls).toEqual(["retrying=false", "profiles=p1", "checked", "advance:false"])
	})
})
