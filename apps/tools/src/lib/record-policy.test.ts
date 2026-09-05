import type { DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import type { RecordRuntime } from "@/composables/useBridgeJournal"
import { accountOf, recordState, type WalletView } from "./record-policy"

const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }
const HASH = `0x${"ab".repeat(32)}`

function dep(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xd",
		direction: "deposit",
		isPrivate: false,
		amount: "100",
		createdAt: 1,
		updatedAt: 1,
		recipient: "0xAztec",
		secretHashHex: "0x1",
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
		amount: "40",
		createdAt: 1,
		updatedAt: 1,
		recipientL1: "0xe",
		...DEPLOY,
		...over,
	}
}
const connected: WalletView = { status: "connected", selectedAccount: "0xaztec", accounts: [{ address: "0xaztec", alias: "Main" }] }
const state = (rec: DepositJournalRecord | WithdrawJournalRecord, rt: RecordRuntime = {}, wallet: WalletView = connected) =>
	recordState(rec, rt, wallet)

describe("recordState — the gates the card and the dock share", () => {
	it("an idle deposit with a leaf is claimable (the card's leafIndex default), so CLAIM shows", () => {
		const s = state(dep({ leafIndex: "1" }))
		expect(s.stage).toBe("claimable")
		expect(s.showClaim).toBe(true)
		expect(s.retry).toBe(false)
	})

	it("a pre-send deposit hides CLAIM; the stranded L1-timeout shape (deposit hash, no leaf) offers it", () => {
		expect(state(dep()).showClaim).toBe(false)
		const stranded = state(dep({ depositTxHash: HASH }))
		expect(stranded.depositLegRecoverable).toBe(true)
		expect(stranded.showClaim).toBe(true)
	})

	it("busy hides every button; completion ends the stage", () => {
		expect(state(dep({ leafIndex: "1" }), { busy: true }).showClaim).toBe(false)
		expect(state(dep({ leafIndex: "1", completedAt: 5 })).stage).toBe("done")
	})

	it("blocked and terminal attentions are not actionable; a plain error is a retry", () => {
		expect(state(dep({ leafIndex: "1", blocked: "stopped" })).actionable).toBe(false)
		expect(state(dep({ leafIndex: "1" }), { attention: "receipt-mismatch" }).actionable).toBe(false)
		const err = state(dep({ leafIndex: "1" }), { attention: "error" })
		expect(err.actionable).toBe(true)
		expect(err.retry).toBe(true)
	})

	it("withdraws: FINISH from proving on, never while exiting; no account tag ever", () => {
		expect(state(wd()).showFinish).toBe(false)
		expect(state(wd({ exitTxHash: HASH })).showFinish).toBe(true)
		expect(accountOf(wd({ exitTxHash: HASH }), connected)).toBeNull()
	})

	it("ownedByOther needs a CONNECTED session and a recipient that is another GRANTED account", () => {
		const other: WalletView = {
			status: "connected",
			selectedAccount: "0xother",
			accounts: [{ address: "0xaztec" }, { address: "0xother" }],
		}
		const s = state(dep({ leafIndex: "1" }), {}, other)
		expect(s.ownedByOther).toBe(true)
		expect(s.switchTarget).toBe("0xaztec")
		expect(state(dep({ leafIndex: "1" }), {}, { ...other, status: "setting-up" }).ownedByOther).toBe(false)
		// Outside the grant: the engine's guard explains; no switch is offered.
		expect(state(dep({ leafIndex: "1", recipient: "0xstranger" }), {}, other).ownedByOther).toBe(false)
	})

	it("a tampered non-string recipient yields no account and never throws", () => {
		expect(accountOf(dep({ recipient: 42 as unknown as string }), connected)).toBeNull()
	})

	it("fuel recovery is offered only on a completed public fueled deposit whose gas never settled", () => {
		const fueled = dep({
			schema: 2,
			leafIndex: "1",
			completedAt: 5,
			fuel: { received: "10", leafIndex: "2" } as DepositJournalRecord["fuel"],
		})
		expect(state(fueled).fuelRecoverable).toBe(true)
		expect(state({ ...fueled, completedAt: undefined }).fuelRecoverable).toBe(false)
	})

	it("CLAIM WITHOUT FUEL: a stuck fueled claim that is not itself a fee-juice record", () => {
		const fueled = dep({ schema: 2, leafIndex: "1", fuel: { received: "10" } as DepositJournalRecord["fuel"] })
		expect(state(fueled, { attention: "error" }).showClaimWithoutFuel).toBe(true)
		expect(state({ ...fueled, assetKind: "fee-juice" }, { attention: "error" }).showClaimWithoutFuel).toBe(false)
		expect(state(fueled).showClaimWithoutFuel).toBe(false)
	})
})
