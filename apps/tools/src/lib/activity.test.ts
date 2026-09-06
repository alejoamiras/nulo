import type { BridgeJournalRecord, DepositJournalRecord, SendDepositRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import type { RecordRuntime } from "@/composables/useBridgeJournal"
import { ageWords, classify, groupRecords, needsYouCount, phaseWord, rowStrings, visibilityWords } from "./activity"
import { recordState, type WalletView } from "./record-policy"

const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }
const HASH = `0x${"ab".repeat(32)}`
const FUEL = { received: "10", leafIndex: "2" } as DepositJournalRecord["fuel"]

function dep(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xd",
		direction: "deposit",
		isPrivate: false,
		amount: "100",
		createdAt: 1,
		updatedAt: 1,
		recipient: "0xaztec",
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
const mine: WalletView = { status: "connected", selectedAccount: "0xaztec", accounts: [{ address: "0xaztec" }, { address: "0xother" }] }
const theirs: WalletView = { ...mine, selectedAccount: "0xother" }

const read = (rec: BridgeJournalRecord, rt: RecordRuntime = {}, wallet: WalletView = mine) => classify(rec, recordState(rec, rt, wallet))

describe("classify — the decision table, in the card's precedence", () => {
	it.each<[string, BridgeJournalRecord, RecordRuntime, WalletView, string, string | null]>([
		["busy record → running, no action", dep({ leafIndex: "1" }), { busy: true }, mine, "running", null],
		["completed + stale busy → done wins", dep({ leafIndex: "1", completedAt: 5 }), { busy: true }, mine, "done", null],
		[
			"completed, fuel unsettled, own account → CLAIM GAS",
			dep({ schema: 2, leafIndex: "1", completedAt: 5, fuel: FUEL }),
			{},
			mine,
			"done",
			"claim-gas",
		],
		[
			"completed, fuel unsettled, other granted account → SWITCH",
			dep({ schema: 2, leafIndex: "1", completedAt: 5, fuel: FUEL }),
			{},
			theirs,
			"done",
			"switch",
		],
		["blocked → needs you, no dock action", dep({ leafIndex: "1", blocked: "stopped" }), {}, mine, "needs-you", null],
		[
			"terminal attention → needs you, no dock action",
			dep({ leafIndex: "1" }),
			{ attention: "malformed-record" },
			mine,
			"needs-you",
			null,
		],
		["stuck before send → needs you, no dock action", dep(), {}, mine, "needs-you", null],
		["deposit hash, no leaf → CLAIM (leg recovery)", dep({ depositTxHash: HASH }), {}, mine, "needs-you", "claim"],
		["idle with a leaf → CLAIM", dep({ leafIndex: "1" }), {}, mine, "needs-you", "claim"],
		["idle with a leaf, error attention → RETRY", dep({ leafIndex: "1" }), { attention: "error" }, mine, "needs-you", "retry"],
		[
			"idle with a leaf, unknown outcome → RETRY",
			dep({ leafIndex: "1" }),
			{ attention: "unknown-outcome" },
			mine,
			"needs-you",
			"retry",
		],
		["claim sent, idle → CLAIM (keep watching)", dep({ leafIndex: "1", claimTxHash: HASH }), {}, mine, "needs-you", "claim"],
		["another granted account owns it → SWITCH", dep({ leafIndex: "1" }), {}, theirs, "needs-you", "switch"],
		["exit not sent → needs you, no dock action", wd(), {}, mine, "needs-you", null],
		["exit sent, proving → FINISH", wd({ exitTxHash: HASH }), {}, mine, "needs-you", "finish"],
		["exit sent, error → RETRY", wd({ exitTxHash: HASH }), { attention: "error" }, mine, "needs-you", "retry"],
		["exit consumed → done", wd({ exitTxHash: HASH, consumeTxHash: HASH, completedAt: 9 }), {}, mine, "done", null],
	])("%s", (_name, rec, rt, wallet, group, action) => {
		expect(read(rec, rt, wallet)).toEqual({ group, action })
	})

	it("parity pin: the dock offers an action exactly where the card shows CLAIM / FINISH / CLAIM YOUR GAS", () => {
		const fixtures: Array<[BridgeJournalRecord, RecordRuntime, WalletView]> = [
			[dep(), {}, mine],
			[dep({ leafIndex: "1" }), {}, mine],
			[dep({ leafIndex: "1" }), { busy: true }, mine],
			[dep({ leafIndex: "1" }), { attention: "stale-deployment" }, mine],
			[dep({ leafIndex: "1", blocked: "x" }), {}, mine],
			[dep({ depositTxHash: HASH }), {}, mine],
			[dep({ leafIndex: "1" }), {}, theirs],
			[dep({ schema: 2, leafIndex: "1", completedAt: 5, fuel: FUEL }), {}, mine],
			[dep({ leafIndex: "1", completedAt: 5 }), {}, mine],
			[wd(), {}, mine],
			[wd({ exitTxHash: HASH }), {}, mine],
			[wd({ exitTxHash: HASH }), { busy: true }, mine],
		]
		for (const [rec, rt, wallet] of fixtures) {
			const s = recordState(rec, rt, wallet)
			const cardOffers = s.showClaim || s.showFinish || s.fuelRecoverable
			expect(classify(rec, s).action !== null, JSON.stringify({ id: rec.id, rt, wallet: wallet.selectedAccount })).toBe(cardOffers)
		}
	})
})

describe("rows", () => {
	it("needsYouCount counts blocked rows too; groups sort newest first", () => {
		const rows = [
			{ id: "a", group: "needs-you" as const, createdAt: 1 },
			{ id: "b", group: "needs-you" as const, createdAt: 3 },
			{ id: "c", group: "running" as const, createdAt: 2 },
			{ id: "d", group: "done" as const, createdAt: 4 },
		]
		expect(needsYouCount(rows)).toBe(2)
		expect(groupRecords(rows).needsYou.map((r) => r.id)).toEqual(["b", "a"])
		expect(groupRecords(rows).running.map((r) => r.id)).toEqual(["c"])
	})

	it("phaseWord is the live phase's label, lower-cased; a done record names its last phase", () => {
		expect(phaseWord(dep({ leafIndex: "1" }), { busy: true, step: "syncing" })).toBe("crossing")
		expect(phaseWord(wd({ exitTxHash: HASH }), {})).toBe("prove")
	})

	it("visibilityWords: privacy as a word, plus gas when a fuel leg rides along", () => {
		expect(visibilityWords(dep({ isPrivate: true }))).toBe("private")
		expect(visibilityWords(dep({ schema: 2, fuel: FUEL }))).toBe("public + gas")
		const send = { ...dep({ id: "0xs" }), schema: 3, intent: "token+gas", token: undefined } as unknown as SendDepositRecord
		expect(visibilityWords(send)).toBe("public + gas")
		expect(visibilityWords(dep({ assetKind: "fee-juice" }))).toBe("public")
	})

	it("rowStrings strips and caps a persisted symbol (a restore file can carry anything)", () => {
		const rec = dep({
			id: "0xs",
			schema: 3,
			intent: "token",
			token: { displaySymbol: "US‮DC", decimals: 6 },
		} as unknown as Partial<DepositJournalRecord>)
		expect(rowStrings(rec).symbol).toBe("USDC")
	})

	it("ageWords", () => {
		const t = 10 * 60_000
		expect(ageWords(t, t + 10_000)).toBe("just now")
		expect(ageWords(t, t + 3 * 60_000)).toBe("3m ago")
		expect(ageWords(t, t + 5 * 3_600_000)).toBe("5h ago")
		expect(ageWords(t, t + 72 * 3_600_000)).toBe("3d ago")
	})
})
