import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import type { RecordRuntime } from "@/composables/useBridgeJournal"
import { stepperPhases } from "./bridge-steps"

const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }

function dep(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xd",
		direction: "deposit",
		isPrivate: true,
		amount: "100000000",
		createdAt: 1,
		updatedAt: 1,
		recipient: "0xa",
		secretHashHex: "0xd",
		...DEPLOY,
		...over,
	}
}

function wd(over: Partial<WithdrawJournalRecord> = {}): WithdrawJournalRecord {
	return {
		schema: 1,
		id: "0xw",
		direction: "withdraw",
		isPrivate: false,
		amount: "40000000",
		createdAt: 1,
		updatedAt: 1,
		recipientL1: "0xe",
		exitTxHash: "0xw",
		...DEPLOY,
		...over,
	}
}

const states = (rec: DepositJournalRecord | WithdrawJournalRecord, rt: RecordRuntime = {}) =>
	Object.fromEntries(stepperPhases(rec, rt).map((p) => [p.key, p.state]))

describe("stepperPhases - fuel (fee-juice) records", () => {
	const fuelRec = (over: Partial<DepositJournalRecord> = {}): DepositJournalRecord =>
		dep({ schema: 2, assetKind: "fee-juice", fuel: { amount: "1", secret: "0x1", secretHashHex: "0x2", minOutput: "0" }, ...over })

	it("a public fuel record APPROVEs Permit2 (one-time) then SIGNs the router bridge()", () => {
		expect(stepperPhases(fuelRec({ isPrivate: false }), {}).map((p) => p.key)).toEqual([
			"approve",
			"sign",
			"deposit",
			"sync",
			"claim",
			"confirm",
		])
	})

	it("a private fuel record SEALs the salt, APPROVEs Permit2 (one-time), then SIGNs", () => {
		expect(stepperPhases(fuelRec({ isPrivate: true }), {}).map((p) => p.key)).toEqual([
			"seal",
			"approve",
			"sign",
			"deposit",
			"sync",
			"claim",
			"confirm",
		])
	})

	it("claim is labelled CLAIM GAS and deposit is plain DEPOSIT (gas-only, no token/swap leg)", () => {
		const phases = stepperPhases(fuelRec({ isPrivate: false }), {})
		expect(phases.find((p) => p.key === "claim")?.label).toBe("CLAIM GAS")
		expect(phases.find((p) => p.key === "deposit")?.label).toBe("DEPOSIT")
	})
})

describe("stepperPhases - deposit matrix", () => {
	it("private fresh record mid-seal: SEAL active, the rest pending", () => {
		expect(states(dep(), { step: "sealing" })).toEqual({
			seal: "active",
			sign: "pending",
			deposit: "pending",
			sync: "pending",
			claim: "pending",
			confirm: "pending",
		})
	})

	it("public records have NO seal phase (SIGN-first, no approve — the token pre-approves Permit2)", () => {
		const keys = stepperPhases(dep({ isPrivate: false }), {}).map((p) => p.key)
		expect(keys).toEqual(["sign", "deposit", "sync", "claim", "confirm"])
	})

	it("signing: SEAL done, SIGN active", () => {
		const s = states(dep(), { step: "signing" })
		expect(s.seal).toBe("done")
		expect(s.sign).toBe("active")
	})

	it("approveOutcome carries skipped (⊘) vs done vs honest degradation when absent (fuel-only, the sole approve path)", () => {
		// Only fuel-only shows a one-time Permit2 APPROVE now (bridge-only pre-approves via the token).
		const base = dep({
			assetKind: "fee-juice",
			fuel: { amount: "1", secret: "0x1", secretHashHex: "0x2", minOutput: "0" },
			isPrivate: false,
			depositTxHash: "0xt",
		})
		expect(states(base, { approveOutcome: "skipped" }).approve).toBe("skipped")
		expect(states(base, { approveOutcome: "done" }).approve).toBe("done")
		expect(states(base, {}).approve).toBe("done") // absent (reload) - no false skipped badge
	})

	it("depositTxHash without leafIndex: DEPOSIT active (waiting for Ethereum)", () => {
		const phases = stepperPhases(dep({ depositTxHash: "0xt" }), {})
		const deposit = phases.find((p) => p.key === "deposit")
		expect(deposit?.state).toBe("active")
		expect(deposit?.detail).toMatch(/waiting for the ethereum confirmation/i)
	})

	it("leafIndex zone: SYNC active by default; runtime sending/unsealing advances to CLAIM", () => {
		const rec = dep({ depositTxHash: "0xt", leafIndex: "7" })
		expect(states(rec, { step: "syncing" }).sync).toBe("active")
		expect(states(rec, { step: "sending" }).claim).toBe("active")
		expect(states(rec, { step: "unsealing" }).claim).toBe("active")
	})

	it("a post-gate failure lands its X on CLAIM, never on a completed CROSSING (claimable attribution)", () => {
		const rec = dep({ depositTxHash: "0xt", leafIndex: "7" })
		const s = states(rec, { claimable: true, attention: "error", note: "the prompt timed out" })
		expect(s.claim).toBe("failed")
		expect(s.sync).toBe("done")
	})

	it("monotonic latch: a cleared step between engine rounds cannot regress the phase", () => {
		const rec = dep({ depositTxHash: "0xt", leafIndex: "7", claimTxHash: "0xc" })
		const withStep = states(rec, { step: "confirming" })
		const cleared = states(rec, {})
		expect(withStep.confirm).toBe("active")
		expect(cleared.confirm).toBe("active") // facts hold the zone; no flicker to pending
		expect(cleared.claim).toBe("done")
	})

	it("completedAt: everything done", () => {
		const s = states(dep({ claimTxHash: "0xc", completedAt: 9 }), {})
		expect(Object.values(s).every((v) => v === "done")).toBe(true)
	})

	it("error attention fails the ACTIVE phase with the note as detail", () => {
		const phases = stepperPhases(dep({ depositTxHash: "0xt", leafIndex: "7" }), { attention: "error", note: "boom" })
		const sync = phases.find((p) => p.key === "sync")
		expect(sync?.state).toBe("failed")
		expect(sync?.detail).toBe("boom")
	})

	it("active detail prefers live stepDetail over the static prompt", () => {
		const phases = stepperPhases(dep({ depositTxHash: "0xt", leafIndex: "7", claimTxHash: "0xc" }), {
			step: "confirming",
			stepDetail: "check 12",
		})
		expect(phases.find((p) => p.key === "confirm")?.detail).toBe("check 12")
	})
})

describe("stepperPhases - determinate progress + ETA (only where real targets exist)", () => {
	it("SYNC carries block progress from the snapshot + live syncBlock", () => {
		const rec = dep({ depositTxHash: "0xt", leafIndex: "7", depositL2Block: 100 })
		const sync = stepperPhases(rec, { step: "syncing", syncBlock: 102 }).find((p) => p.key === "sync")
		expect(sync?.progress).toEqual({ current: 102, target: 103, fraction: 2 / 3 })
		expect(sync?.eta).toMatch(/min/)
	})

	it("SYNC without a snapshot or live block has NO bar (never fabricate determinism)", () => {
		expect(
			stepperPhases(dep({ depositTxHash: "0xt", leafIndex: "7" }), { step: "syncing" }).find((p) => p.key === "sync")?.progress,
		).toBeUndefined()
		expect(
			stepperPhases(dep({ depositTxHash: "0xt", leafIndex: "7", depositL2Block: 100 }), { step: "syncing" }).find(
				(p) => p.key === "sync",
			)?.progress,
		).toBeUndefined()
	})

	it("PROVE carries proven-block progress; CONFIRM never gets a bar", () => {
		const prove = stepperPhases(wd(), { provenBlock: 5, targetBlock: 10 }).find((p) => p.key === "prove")
		expect(prove?.progress).toEqual({ current: 5, target: 10, fraction: 0.5 })
		const confirm = stepperPhases(dep({ depositTxHash: "0xt", leafIndex: "7", claimTxHash: "0xc" }), { step: "confirming" }).find(
			(p) => p.key === "confirm",
		)
		expect(confirm?.progress).toBeUndefined()
		expect(confirm?.eta).toMatch(/min/)
	})

	it("failed phases drop the ETA (no cheery estimate on an error)", () => {
		const sync = stepperPhases(dep({ depositTxHash: "0xt", leafIndex: "7" }), { attention: "error", note: "boom" }).find(
			(p) => p.key === "sync",
		)
		expect(sync?.eta).toBeUndefined()
	})
})

describe("stepperPhases - withdraw matrix", () => {
	it("provisional (no exitTxHash): EXIT active", () => {
		expect(states(wd({ exitTxHash: undefined }), { step: "exiting" }).exit).toBe("active")
	})

	it("public exit prompt names BOTH signatures", () => {
		const exit = stepperPhases(wd({ exitTxHash: undefined }), {}).find((p) => p.key === "exit")
		expect(exit?.detail).toMatch(/two signatures/i)
	})

	it("proving: PROVE active with the countdown detail", () => {
		const prove = stepperPhases(wd(), { provenBlock: 5, targetBlock: 9 }).find((p) => p.key === "prove")
		expect(prove?.state).toBe("active")
		expect(prove?.detail).toContain("Proven block 5 of 9")
	})

	it("proven: FINISH active (facts + runtime proven flag)", () => {
		expect(states(wd(), { provenBlock: 9, targetBlock: 9 }).finish).toBe("active")
		expect(states(wd(), { proven: true }).finish).toBe("active")
	})

	it("consumeTxHash: CONFIRM active; completion: all done", () => {
		expect(states(wd({ consumeTxHash: "0xc" }), {}).confirm).toBe("active")
		const s = states(wd({ consumeTxHash: "0xc", completedAt: 5 }), {})
		expect(Object.values(s).every((v) => v === "done")).toBe(true)
	})
})

describe("fueled deposit rail", () => {
	const fuel = { amount: "250000000000000000", secret: "0xs", secretHashHex: "0xsh", minOutput: "450" }

	it("fueled rail merges the swap into DEPOSIT: SIGN replaces APPROVE, no separate FUEL phase", () => {
		const phases = stepperPhases(dep({ schema: 2, fuel, isPrivate: false }))
		expect(phases.map((p) => p.key)).toEqual(["sign", "deposit", "sync", "claim", "confirm"])
		const deposit = phases.find((p) => p.key === "deposit")
		expect(deposit?.label).toBe("DEPOSIT + FUEL")
		expect(deposit?.detail).toMatch(/fuel swap rides along/i)
	})

	it("private fueled rail keeps SEAL first, still no FUEL phase", () => {
		const phases = stepperPhases(dep({ schema: 2, fuel, isPrivate: true }))
		expect(phases.map((p) => p.key)).toEqual(["seal", "sign", "deposit", "sync", "claim", "confirm"])
	})

	it("a non-fueled deposit keeps the plain DEPOSIT label", () => {
		expect(stepperPhases(dep({ isPrivate: false })).find((p) => p.key === "deposit")?.label).toBe("DEPOSIT")
	})

	it("rt.step signing activates SIGN", () => {
		const phases = stepperPhases(dep({ schema: 2, fuel, isPrivate: false }), { step: "signing" })
		expect(phases.find((p) => p.key === "sign")?.state).toBe("active")
	})

	it("the merged DEPOSIT+FUEL completes when the crossing starts; the swap never flips on its own", () => {
		const phases = stepperPhases(
			dep({ schema: 2, fuel: { ...fuel, received: "487", leafIndex: "7" }, depositTxHash: "0xd", leafIndex: "7", isPrivate: false }),
		)
		// The swap is not independently observable - no FUEL cell in the rail to latch on its own.
		expect(phases.map((p) => p.key)).toEqual(["sign", "deposit", "sync", "claim", "confirm"])
		expect(phases.find((p) => p.key === "deposit")?.state).toBe("done")
		expect(phases.find((p) => p.key === "sync")?.state).toBe("active")
	})

	it("a fueled CLAIM names the one-tx token+gas confirmation", () => {
		const phases = stepperPhases(
			dep({ schema: 2, fuel: { ...fuel, received: "487", leafIndex: "7" }, depositTxHash: "0xd", leafIndex: "7", isPrivate: false }),
			{ claimable: true },
		)
		expect(phases.find((p) => p.key === "claim")?.detail).toMatch(/tokens and your gas/)
	})

	it("a NON-fueled bridge-only record SIGNs (no approve, no fuel keys leak)", () => {
		const phases = stepperPhases(dep({ isPrivate: false }))
		expect(phases.map((p) => p.key)).toEqual(["sign", "deposit", "sync", "claim", "confirm"])
	})
})
