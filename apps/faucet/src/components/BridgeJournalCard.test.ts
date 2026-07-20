import type { BridgeJournalRecord, DepositJournalRecord, WithdrawJournalRecord } from "@nulo/bridge-core"
import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import type { RecordRuntime } from "@/composables/useBridgeJournal"

const runtime = ref<Record<string, RecordRuntime>>({})
const runDepositClaim = vi.fn(async () => {})
const runWithdrawConsume = vi.fn(async () => {})
const discard = vi.fn()
const clearDone = vi.fn()

vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({ runtime, runDepositClaim, runWithdrawConsume, discard, clearDone }),
}))
const fuelResume = vi.fn(async () => {})
vi.mock("@/composables/useFuel", () => ({
	useFuelFlow: () => ({ resume: fuelResume, busy: ref(false), error: ref(null) }),
}))
const claimFuelStandalone = vi.fn(async () => {})
const depositResume = vi.fn(async () => {})
const attachDepositHash = vi.fn(async () => null as string | null)
vi.mock("@/composables/useDeposit", () => ({
	claimFuelStandalone: (...a: unknown[]) => claimFuelStandalone(...(a as [])),
	overrideFuelClaim: vi.fn(),
	reconcileFuelConsumed: vi.fn(async () => {}),
	useDepositFlow: () => ({ resume: depositResume, attachDepositHash, busy: ref(false), error: ref(null) }),
}))

import { TESTIDS } from "@/lib/testids"
import BridgeJournalCard from "./BridgeJournalCard.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }

function deposit(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xdep",
		direction: "deposit",
		isPrivate: false,
		amount: "100000000000000000000",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		recipient: "0xaztec",
		secretHashHex: "0xdep",
		...DEPLOY,
		...over,
	}
}

function withdraw(over: Partial<WithdrawJournalRecord> = {}): WithdrawJournalRecord {
	return {
		schema: 1,
		id: "0xwd",
		direction: "withdraw",
		isPrivate: false,
		amount: "40000000000000000000",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		recipientL1: "0xeth",
		exitTxHash: "0xwd",
		...DEPLOY,
		...over,
	}
}

function mountCard(record: BridgeJournalRecord) {
	return mount(BridgeJournalCard, { props: { record } })
}

describe("BridgeJournalCard", () => {
	beforeEach(() => {
		runtime.value = {}
		runDepositClaim.mockClear()
		runWithdrawConsume.mockClear()
		discard.mockClear()
		clearDone.mockClear()
	})

	it("stranded L1-timeout shape (depositTxHash, no leafIndex) OFFERS CLAIM - the deposit-leg recovery entry", () => {
		const w = mountCard(deposit({ depositTxHash: `0x${"ab".repeat(32)}` }))
		const btn = w.find(`[data-testid="${TESTIDS.journalClaim}"]`)
		expect(btn.exists()).toBe(true)
		btn.trigger("click")
		expect(runDepositClaim).toHaveBeenCalledWith("0xdep")
	})

	it("genuinely pre-send deposit (no depositTxHash, no leafIndex) hides CLAIM (discard guidance)", () => {
		const w = mountCard(deposit({}))
		expect(w.find(`[data-testid="${TESTIDS.journalClaim}"]`).exists()).toBe(false)
	})

	it("renders direction, amount, privacy and the stage attrs", () => {
		const w = mountCard(deposit({ isPrivate: true, leafIndex: "7" }))
		const card = w.find(sel(TESTIDS.journalCard))
		expect(card.attributes("data-direction")).toBe("deposit")
		expect(card.attributes("data-stage")).toBe("claimable")
		expect(card.attributes("data-privacy")).toBe("private")
		expect(w.text()).toContain("ETHEREUM → AZTEC")
		expect(w.text()).toContain("100.00 AZLO")
		expect(w.text()).toContain("PRIVATE")
	})

	it("withdraw header reads AZTEC → ETHEREUM", () => {
		const w = mountCard(withdraw())
		expect(w.text()).toContain("AZTEC → ETHEREUM")
	})

	it("renders the compact phase rail with the live narration (one mapper, both surfaces)", () => {
		runtime.value = { "0xdep": { step: "confirming", stepDetail: "check 12 - the claim is processing on Aztec" } }
		const w = mountCard(deposit({ leafIndex: "7", claimTxHash: `0x${"ab".repeat(32)}` }))
		expect(w.find(sel(TESTIDS.journalRail)).exists()).toBe(true)
		// The fact zone puts CONFIRM active; the live detail flows through the rail's step line.
		const confirmCell = w.findAll(sel(TESTIDS.journalPhase)).find((c) => c.attributes("data-phase") === "confirm")
		expect(confirmCell?.attributes("data-state")).toBe("active")
		expect(w.find(sel(TESTIDS.journalStep)).text()).toContain("check 12")
	})

	it("a done card shows the BRIDGED stamp during its grace window (peak-end)", () => {
		const w = mountCard(deposit({ leafIndex: "7", claimTxHash: `0x${"ab".repeat(32)}`, completedAt: Date.now() }))
		expect(w.text()).toContain("BRIDGED ✓")
		expect(w.find(sel(TESTIDS.journalRail)).exists()).toBe(false)
	})

	it("an error note renders ONCE (the rail's failed phase owns it; the note line stays empty)", () => {
		runtime.value = { "0xdep": { attention: "error", note: "boom - funds safe", claimable: true } }
		const w = mountCard(deposit({ leafIndex: "7" }))
		expect(w.find(sel(TESTIDS.journalAttention)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalStep)).text()).toContain("boom - funds safe")
	})

	it("a soft note renders without an attention state (the 30-min still-confirming case)", () => {
		runtime.value = { "0xdep": { note: "Still confirming after ~30 minutes - slow testnet." } }
		const w = mountCard(deposit({ leafIndex: "7" }))
		expect(w.find(sel(TESTIDS.journalAttention)).text()).toContain("Still confirming")
		expect(w.find(sel(TESTIDS.journalCard)).attributes("data-attention")).toBeUndefined()
	})

	it("explorer links render per tx hash with strict validation (junk hashes get no link)", () => {
		const goodEth = `0x${"ab".repeat(32)}`
		const goodAz = `0x${"cd".repeat(32)}`
		const w = mountCard(deposit({ depositTxHash: goodEth, claimTxHash: goodAz, leafIndex: "7" }))
		const links = w.findAll(sel(TESTIDS.journalTxLink))
		expect(links).toHaveLength(2)
		expect(links[0].attributes("href")).toBe(`https://sepolia.etherscan.io/tx/${goodEth}`)
		expect(links[0].attributes("rel")).toContain("noopener")
		expect(links[1].attributes("href")).toContain(`/tx-effects/${goodAz}`)

		const junk = mountCard(deposit({ depositTxHash: "javascript:alert(1)", leafIndex: "7" }))
		expect(junk.findAll(sel(TESTIDS.journalTxLink))).toHaveLength(0)
	})

	it("the approval tx gets its own per-leg link (J3), before the deposit link", () => {
		const approve = `0x${"11".repeat(32)}`
		const dtx = `0x${"22".repeat(32)}`
		const w = mountCard(deposit({ approveTxHash: approve, depositTxHash: dtx, leafIndex: "7" }))
		const links = w.findAll(sel(TESTIDS.journalTxLink))
		expect(links[0].attributes("href")).toBe(`https://sepolia.etherscan.io/tx/${approve}`)
		expect(links[0].text()).toMatch(/approval/i)
		expect(links[1].attributes("href")).toBe(`https://sepolia.etherscan.io/tx/${dtx}`)
	})

	it("an approve-death record (persisted facts, no runtime) narrates the honest failed phase", () => {
		// The exact reload shape from the smoke test: approve leg died, nothing else recorded.
		const w = mountCard(deposit({ isPrivate: false, failedLeg: "approving", failedOutcome: "no-funds-moved" }))
		expect(w.find(sel(TESTIDS.journalStep)).text().toLowerCase()).toContain("no funds moved")
	})

	it("deposit stage matrix renders exactly the right action", () => {
		// depositing: no claim button.
		expect(mountCard(deposit()).find(sel(TESTIDS.journalClaim)).exists()).toBe(false)
		// claimable (leafIndex known): CLAIM.
		expect(
			mountCard(deposit({ leafIndex: "7" }))
				.find(sel(TESTIDS.journalClaim))
				.text(),
		).toBe("CLAIM")
		// claiming (claimTxHash set): button still rendered (prompt-free retry) but stage shows claiming.
		const claiming = mountCard(deposit({ leafIndex: "7", claimTxHash: "0xc" }))
		expect(claiming.find(sel(TESTIDS.journalCard)).attributes("data-stage")).toBe("claiming")
		// done: CLEAR only, no claim, no discard.
		const done = mountCard(deposit({ leafIndex: "7", claimTxHash: "0xc", completedAt: 1 }))
		expect(done.find(sel(TESTIDS.journalClear)).exists()).toBe(true)
		expect(done.find(sel(TESTIDS.journalClaim)).exists()).toBe(false)
		expect(done.find(sel(TESTIDS.journalDiscard)).exists()).toBe(false)
	})

	it("withdraw stage matrix: proving countdown + FINISH, consuming, done→CLEAR", () => {
		runtime.value = { "0xwd": { provenBlock: 5, targetBlock: 9 } }
		const proving = mountCard(withdraw())
		expect(proving.find(sel(TESTIDS.journalCard)).attributes("data-stage")).toBe("proving")
		// The countdown lives in the rail's bar now; the idle stage line gives the resume action.
		expect(proving.find(sel(TESTIDS.journalStage)).text()).toMatch(/press finish/i)
		expect(proving.find(sel(TESTIDS.journalFinish)).text()).toBe("FINISH")

		runtime.value = {}
		const consuming = mountCard(withdraw({ consumeTxHash: "0xc" }))
		expect(consuming.find(sel(TESTIDS.journalCard)).attributes("data-stage")).toBe("consuming")

		const done = mountCard(withdraw({ consumeTxHash: "0xc", completedAt: 1 }))
		expect(done.find(sel(TESTIDS.journalClear)).exists()).toBe(true)
		expect(done.find(sel(TESTIDS.journalFinish)).exists()).toBe(false)
	})

	it("CLAIM invokes runDepositClaim; FINISH invokes runWithdrawConsume", async () => {
		const dep = mountCard(deposit({ leafIndex: "7" }))
		await dep.find(sel(TESTIDS.journalClaim)).trigger("click")
		expect(runDepositClaim).toHaveBeenCalledWith("0xdep")

		const wd = mountCard(withdraw())
		await wd.find(sel(TESTIDS.journalFinish)).trigger("click")
		expect(runWithdrawConsume).toHaveBeenCalledWith("0xwd")
	})

	it("discard is two-step: DISCARD arms, CONFIRM DISCARD deletes (distinct testids)", async () => {
		const w = mountCard(deposit({ isPrivate: true, leafIndex: "7" }))
		await w.find(sel(TESTIDS.journalDiscard)).trigger("click")
		expect(discard).not.toHaveBeenCalled()
		const confirm = w.find(sel(TESTIDS.journalDiscardConfirm))
		expect(confirm.text()).toBe("CONFIRM DISCARD")
		expect(w.text()).toMatch(/destroys the only copy/i)
		await confirm.trigger("click")
		expect(discard).toHaveBeenCalledWith("0xdep")
	})

	it("the ⤓ export icon: unfinished cards show it, done cards swap to ✕, provisional withdraws hide it", () => {
		expect(
			mountCard(deposit({ leafIndex: "7" }))
				.find(sel(TESTIDS.cardBackup))
				.exists(),
		).toBe(true)
		const done = mountCard(deposit({ leafIndex: "7", claimTxHash: "0xc", completedAt: 1 }))
		expect(done.find(sel(TESTIDS.cardBackup)).exists()).toBe(false)
		expect(done.find(sel(TESTIDS.journalClear)).exists()).toBe(true)
		const prov = mountCard(withdraw({ id: "wd-pending-x1", exitTxHash: undefined }))
		expect(prov.find(sel(TESTIDS.cardBackup)).exists()).toBe(false)
	})

	it("the ⤓ emits the backup event with the record", async () => {
		const w = mountCard(deposit({ leafIndex: "7" }))
		await w.find(sel(TESTIDS.cardBackup)).trigger("click")
		expect(w.emitted("backup")?.[0]?.[0]).toMatchObject({ id: "0xdep" })
	})

	it("a done private card retains its sealed blob and offers CLEAR - never DISCARD (retention pin)", () => {
		const rec = deposit({ isPrivate: true, leafIndex: "7", claimTxHash: "0xc", completedAt: 1, sealedEnvelope: "blob" })
		const w = mountCard(rec)
		expect(rec.sealedEnvelope).toBe("blob")
		expect(w.find(sel(TESTIDS.journalClear)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.journalDiscard)).exists()).toBe(false)
	})

	it("mismatch attention keeps the action (fix the cause, press it) and the rail carries the note", () => {
		runtime.value = { "0xdep": { attention: "mismatch", note: "Connect that Aztec account." } }
		const w = mountCard(deposit({ leafIndex: "7" }))
		// The run re-validates guards idempotently - hiding the button stranded this state.
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
		// The note lives in the rail's failed phase; the parallel note line stays empty.
		expect(w.find(sel(TESTIDS.journalAttention)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalStep)).text()).toContain("Connect that Aztec account")
		expect(w.find(sel(TESTIDS.journalCard)).attributes("data-attention")).toBe("mismatch")
	})

	it("unknown-outcome shows RETRY instead of CLAIM/FINISH", () => {
		runtime.value = { "0xwd": { attention: "unknown-outcome", note: "Couldn't confirm." } }
		const w = mountCard(withdraw({ consumeTxHash: "0xc" }))
		expect(w.find(sel(TESTIDS.journalFinish)).text()).toBe("RETRY")
	})

	it("a DRIVING card hides its buttons + stage line (the rail narrates); idle brings them back", () => {
		runtime.value = { "0xdep": { busy: true } }
		const driving = mountCard(deposit({ leafIndex: "7" }))
		expect(driving.find(sel(TESTIDS.journalClaim)).exists()).toBe(false)
		expect(driving.find(sel(TESTIDS.journalDiscard)).exists()).toBe(false)
		expect(driving.find(sel(TESTIDS.journalStage)).exists()).toBe(false)

		runtime.value = {}
		const idle = mountCard(deposit({ leafIndex: "7" }))
		expect(idle.find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
		expect(idle.find(sel(TESTIDS.journalClaim)).attributes("disabled")).toBeUndefined()
		expect(idle.find(sel(TESTIDS.journalDiscard)).exists()).toBe(true)
		expect(idle.find(sel(TESTIDS.journalStage)).text()).toMatch(/press claim/i)
	})

	const fuel = {
		amount: "250000000000000000",
		secret: "0xs",
		secretHashHex: "0xsh",
		minOutput: "11",
		received: "487000000000000000000",
		leafIndex: "9",
	}

	it("shows CLAIM YOUR GAS when a COMPLETED fueled record has unconsumed, unclaimed fuel", () => {
		const w = mountCard(deposit({ schema: 2, fuel, completedAt: Date.now(), claimTxHash: "0xc" }))
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(true)
	})

	it("hides CLAIM YOUR GAS once the fuel was consumed by an fjwc claim", () => {
		const w = mountCard(deposit({ schema: 2, fuel: { ...fuel, consumed: true }, completedAt: Date.now(), claimTxHash: "0xc" }))
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
	})

	it("hides CLAIM YOUR GAS once the fuel landed standalone", () => {
		const w = mountCard(deposit({ schema: 2, fuel: { ...fuel, standaloneClaimed: true }, completedAt: Date.now(), claimTxHash: "0xc" }))
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
	})

	it("a non-fueled completed record never shows CLAIM YOUR GAS", () => {
		const w = mountCard(deposit({ completedAt: Date.now(), claimTxHash: "0xc" }))
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
	})

	it("CLAIM YOUR GAS triggers the standalone recovery claim", async () => {
		claimFuelStandalone.mockClear()
		const w = mountCard(deposit({ schema: 2, fuel, completedAt: Date.now(), claimTxHash: "0xc" }))
		await w.find(sel(TESTIDS.journalClaimGas)).trigger("click")
		expect(claimFuelStandalone).toHaveBeenCalledWith("0xdep")
	})
})

describe("RESUME affordance (J4 — fee-juice)", () => {
	const fuelDep = (over: Partial<DepositJournalRecord> = {}) =>
		deposit({
			schema: 2,
			assetKind: "fee-juice",
			isPrivate: false,
			fuel: { amount: "1", secret: "0x1", secretHashHex: "0xdep", minOutput: "0" },
			...over,
		})

	beforeEach(() => fuelResume.mockClear())

	it("shows RESUME on a pre-deposit, proven-safe, not-yet-attempted fuel record", () => {
		const w = mountCard(fuelDep({ failedLeg: "approving", failedOutcome: "no-funds-moved" }))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(true)
	})

	it("hides RESUME once a resume was attempted (one-shot)", () => {
		const w = mountCard(fuelDep({ failedLeg: "approving", failedOutcome: "no-funds-moved", resumeAttemptAt: 1 }))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(false)
	})

	it("hides RESUME for unknown-outcome (never resumable)", () => {
		const w = mountCard(fuelDep({ failedLeg: "depositing", failedOutcome: "unknown-outcome" }))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(false)
	})

	it("hides RESUME once a deposit tx exists (recovery owns it)", () => {
		const w = mountCard(fuelDep({ failedLeg: "depositing", failedOutcome: "no-funds-moved", depositTxHash: "0xd" }))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(false)
	})

	it("arms review-consent on first click, resumes on the second", async () => {
		const w = mountCard(fuelDep({ failedLeg: "approving", failedOutcome: "no-funds-moved" }))
		await w.find(sel(TESTIDS.journalResume)).trigger("click")
		expect(w.find(sel(TESTIDS.journalResumeReview)).exists()).toBe(true)
		expect(fuelResume).not.toHaveBeenCalled()
		await w.find(sel(TESTIDS.journalResume)).trigger("click")
		expect(fuelResume).toHaveBeenCalledWith("0xdep")
	})

	it("a legacy fuel record (no persisted facts) shows no RESUME", () => {
		const w = mountCard(fuelDep({}))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(false)
	})
})

describe("RESUME — plain token + paste-hash (J5)", () => {
	beforeEach(() => {
		depositResume.mockClear()
		attachDepositHash.mockClear()
	})

	it("a plain-token proven-safe record routes RESUME to the deposit flow", async () => {
		const w = mountCard(deposit({ failedLeg: "approving", failedOutcome: "no-funds-moved" }))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(true)
		await w.find(sel(TESTIDS.journalResume)).trigger("click")
		await w.find(sel(TESTIDS.journalResume)).trigger("click")
		expect(depositResume).toHaveBeenCalledWith("0xdep")
	})

	it("an unknown-outcome record shows the paste-hash input, not RESUME", () => {
		const w = mountCard(deposit({ failedLeg: "depositing", failedOutcome: "unknown-outcome" }))
		expect(w.find(sel(TESTIDS.journalResume)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalPasteHash)).exists()).toBe(true)
	})

	it("submitting a pasted hash calls the engine handler; a returned error surfaces", async () => {
		attachDepositHash.mockResolvedValueOnce("That transaction reverted on Ethereum")
		const w = mountCard(deposit({ failedLeg: "depositing", failedOutcome: "unknown-outcome" }))
		await w.find(sel(TESTIDS.journalPasteHash)).setValue("0xabc")
		await w.find(sel(TESTIDS.journalPasteHashSubmit)).trigger("click")
		expect(attachDepositHash).toHaveBeenCalledWith("0xdep", "0xabc")
		expect(w.find(sel(TESTIDS.journalPasteHashError)).text()).toMatch(/reverted/i)
	})
})
