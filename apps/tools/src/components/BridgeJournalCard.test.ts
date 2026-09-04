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
const claimFuelStandalone = vi.fn(async () => {})
vi.mock("@/composables/fuel-recovery", () => ({
	claimFuelStandalone: (...a: unknown[]) => claimFuelStandalone(...(a as [])),
	overrideFuelClaim: vi.fn(),
	reconcileFuelConsumed: vi.fn(async () => {}),
}))

// Account attribution: the card reads the session (accounts/selectedAccount) via useBridgeWallet
// and switches via switchActiveAccount. Defaults match the fixtures' recipient ("0xaztec" =
// active, aliased "Main") so pre-existing tests keep their unlabeled-era behavior semantics.
const walletAccounts = ref<Array<{ address: string; alias: string }>>([{ address: "0xaztec", alias: "Main" }])
const walletSelected = ref<string | null>("0xaztec")
const walletStatus = ref("connected")
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ accounts: walletAccounts, selectedAccount: walletSelected, status: walletStatus }),
}))
const switchActiveAccount = vi.fn((address: string) => {
	walletSelected.value = address
	return true
})
vi.mock("@/composables/useWalletConnection", () => ({
	switchActiveAccount: (address: string) => switchActiveAccount(address),
}))

import { __resetOpsInFlightForTests, withOperation } from "@/composables/useOpsInFlight"
import { TESTIDS } from "@/lib/testids"
import BridgeJournalCard from "./BridgeJournalCard.vue"
// Amounts + symbol derive from the LIVE manifest (the token cutover changes both — a hardcoded
// 18-dec "AZLO" fixture breaks on a 6-dec USDC manifest).
// A journal record with no token block of its own renders under asset-label's generic fallback.
const BRIDGE_TOKEN_DECIMALS = 18
const BRIDGE_TOKEN_SYMBOL = "TOKEN"
const UNIT = 10n ** BigInt(BRIDGE_TOKEN_DECIMALS)

const sel = (t: string) => `[data-testid="${t}"]`
const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }

function deposit(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xdep",
		direction: "deposit",
		isPrivate: false,
		amount: (100n * UNIT).toString(),
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
		amount: (40n * UNIT).toString(),
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
		expect(w.text()).toContain(`100.00 ${BRIDGE_TOKEN_SYMBOL}`)
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

describe("BridgeJournalCard — account attribution (Options 1+2)", () => {
	const OTHER = "0xsavings"

	beforeEach(() => {
		runtime.value = {}
		walletAccounts.value = [
			{ address: "0xaztec", alias: "Main" },
			{ address: OTHER, alias: "Savings" },
		]
		walletSelected.value = "0xaztec"
		walletStatus.value = "connected"
		switchActiveAccount.mockClear()
		runDepositClaim.mockClear()
		__resetOpsInFlightForTests()
	})

	it("every deposit card carries its account tag; active account renders neutral", () => {
		const w = mountCard(deposit({ leafIndex: "1" }))
		const tag = w.find(sel(TESTIDS.journalAccount))
		expect(tag.exists()).toBe(true)
		expect(tag.text()).toContain("Main")
		expect(tag.classes()).not.toContain("other")
		// Active account: the normal CLAIM action, no switch offer.
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(false)
	})

	it("another granted account's card: sand tag + SWITCH replaces CLAIM; click switches (shared path)", async () => {
		const w = mountCard(deposit({ recipient: OTHER, leafIndex: "1" }))
		const tag = w.find(sel(TESTIDS.journalAccount))
		expect(tag.classes()).toContain("other")
		expect(tag.text()).toContain("Savings")
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(false)

		const switchBtn = w.find(sel(TESTIDS.journalSwitchAccount))
		expect(switchBtn.text()).toBe("SWITCH TO SAVINGS")
		await switchBtn.trigger("click")
		expect(switchActiveAccount).toHaveBeenCalledWith(OTHER)
		expect(runDepositClaim).not.toHaveBeenCalled() // switch never auto-claims

		// Post-switch re-render: the card becomes actionable normally.
		await w.vm.$nextTick()
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(false)
	})

	it("a recipient OUTSIDE the current grant keeps the address-only tag and the normal action (guard explains)", () => {
		const w = mountCard(deposit({ recipient: "0xrevoked", leafIndex: "1" }))
		const tag = w.find(sel(TESTIDS.journalAccount))
		expect(tag.classes()).toContain("other")
		expect(tag.text()).toBe("0xrevoked") // short-addr fallback (short fixture stays as-is)
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(false)
	})

	it("the switch action respects the ops-in-flight gate", async () => {
		const w = mountCard(deposit({ recipient: OTHER, leafIndex: "1" }))
		let release: () => void = () => {}
		const span = withOperation(() => new Promise<void>((res) => (release = res)))
		await w.vm.$nextTick()
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).attributes("disabled")).toBeDefined()
		release()
		await span
	})

	it("account matching is case-insensitive but switching passes the CANONICAL grant address", async () => {
		const w = mountCard(deposit({ recipient: "0xSAVINGS", leafIndex: "1" }))
		await w.find(sel(TESTIDS.journalSwitchAccount)).trigger("click")
		expect(switchActiveAccount).toHaveBeenCalledWith(OTHER) // canonical "0xsavings", not record casing
	})

	it("fuel recovery on a completed mismatched card also redirects to switch", () => {
		const w = mountCard(
			deposit({
				recipient: OTHER,
				completedAt: Date.now(),
				fuel: {
					amount: "1",
					secret: "0xs",
					secretHashHex: "0xsh",
					minOutput: "1",
					received: "1000000000000000000",
					leafIndex: "7",
				},
			}),
		)
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(true)
	})

	it("a TAMPERED (non-string) recipient renders without crashing and without a tag", () => {
		const w = mountCard(deposit({ recipient: 42 as unknown as string, leafIndex: "1" }))
		expect(w.find(sel(TESTIDS.journalAccount)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(true) // engine guard owns the refusal
	})

	it("no switch offer while the session is not connected (selectAccount would reject)", () => {
		walletStatus.value = "setting-up"
		const w = mountCard(deposit({ recipient: OTHER, leafIndex: "1" }))
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
	})

	// The user-reported bug: a private bridge showed CLAIM YOUR GAS, and clicking it failed
	// confusingly. Private fuel pays for the completing tx itself, and the recovery ladder is
	// public + sponsored — which private records must never touch (L11).
	const FUEL = { amount: "1", secret: "0xs", secretHashHex: "0xsh", minOutput: "1", received: "1000000000000000000", leafIndex: "7" }

	it("a WELL-FORMED completed private record offers nothing and says nothing (its fuel is spent)", () => {
		const w = mountCard(
			deposit({ isPrivate: true, recipient: "0xaztec", completedAt: Date.now(), fuel: { ...FUEL, bridgeSecretSalt: "0xsalt" } }),
		)
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalPrivateFuelUnknown)).exists()).toBe(false)
	})

	it("a private record with INCOMPLETE metadata still offers no recovery, but surfaces the unknown state", () => {
		const w = mountCard(deposit({ isPrivate: true, recipient: "0xaztec", completedAt: Date.now(), fuel: FUEL }))
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalPrivateFuelUnknown)).exists()).toBe(true)
	})

	it("a terminal receipt/record mismatch offers no CLAIM or RETRY — the retry could only fail again", () => {
		const rec = deposit({ leafIndex: "1" })
		runtime.value = { [rec.id]: { attention: "receipt-mismatch", note: "…can't be recovered from the chain." } }
		const w = mountCard(rec)
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(false)
		// ...and the guidance line must not tell the user to press the button that isn't there.
		expect(w.find(sel(TESTIDS.journalStage)).exists()).toBe(false)
		// A retryable error on the same record DOES keep the action — the suppression is terminal-only.
		runtime.value = { [rec.id]: { attention: "error", note: "transient" } }
		expect(mountCard(rec).find(sel(TESTIDS.journalClaim)).exists()).toBe(true)
	})

	it("the PUBLIC twin still offers recovery — the gate is privacy-scoped, not a blanket removal", () => {
		const w = mountCard(deposit({ isPrivate: false, recipient: "0xaztec", completedAt: Date.now(), fuel: FUEL }))
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.journalPrivateFuelUnknown)).exists()).toBe(false)
	})

	it("account attribution still applies to private cards: another account's CLAIMABLE private record redirects to switch", () => {
		// Exercised on a CLAIMABLE record with an OTHER recipient — on a completed one there is no
		// claim action to redirect, so asserting the switch there would prove nothing either way.
		const w = mountCard(deposit({ isPrivate: true, recipient: OTHER, leafIndex: "1", fuel: FUEL }))
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(true)
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(false)
		// Not completed ⇒ the gas affordance is out of scope here (pinned by the completed cases).
		expect(w.find(sel(TESTIDS.journalClaimGas)).exists()).toBe(false)
	})

	it("withdraw cards carry no account tag and FINISH is never redirected", () => {
		walletSelected.value = OTHER // some other account active — irrelevant to withdraws
		const w = mountCard(withdraw({ exitBlock: 1 }))
		expect(w.find(sel(TESTIDS.journalAccount)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalSwitchAccount)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalFinish)).exists()).toBe(true)
	})

	it("a send card reads its amount at the record's OWN token decimals and symbol", () => {
		const send = {
			...deposit({ amount: "150000000", leafIndex: "1" }),
			schema: 3,
			intent: "token",
			token: { erc20: "0xe", portal: "0xp", l2Token: "0xl2", nameWord: "0xn", symbolWord: "0xs", decimals: 8, displaySymbol: "WBTC" },
		} as unknown as BridgeJournalRecord
		expect(mountCard(send).text()).toContain("1.50 WBTC")
	})

	// A blocked record is terminal and its reason is PERSISTED: the card must state it and offer no
	// run, from the first render — not only after a run has narrated a runtime attention.
	it("a blocked record states its reason and offers no CLAIM, guidance or retry", () => {
		const blocked = deposit({ leafIndex: "1", blocked: "This token's registration on Ethereum no longer matches this record." })
		const w = mountCard(blocked)
		expect(w.find(sel(TESTIDS.journalAttention)).text()).toContain("no longer matches this record")
		expect(w.find(sel(TESTIDS.journalClaim)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalStage)).exists()).toBe(false)
	})

	it("a blocked record keeps DISCARD — it is the only way out", () => {
		const w = mountCard(deposit({ leafIndex: "1", blocked: "stopped for your safety" }))
		expect(w.find(sel(TESTIDS.journalDiscard)).exists()).toBe(true)
	})

	it("a blocked WITHDRAW offers no FINISH either", () => {
		const w = mountCard(withdraw({ exitBlock: 1, blocked: "stopped for your safety" }))
		expect(w.find(sel(TESTIDS.journalFinish)).exists()).toBe(false)
		expect(w.find(sel(TESTIDS.journalAttention)).text()).toContain("stopped for your safety")
	})
})
