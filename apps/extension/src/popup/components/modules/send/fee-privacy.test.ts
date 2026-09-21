import { describe, expect, test } from "vitest"
import { type PayerDescriptor, payerKindOf } from "@/components/composite/send/publish-facts"
import { FpcType } from "@/wallet/services/fpc/client"
import { buildFeeMethods, type FeeMethodOption, type GasBalances, type RegisteredFpc, settingsForMethod } from "./fee-helpers"
import {
	applyFpcEdits,
	type FeeKnowledge,
	feePayerNotice,
	isEligible,
	previewForPick,
	recordOf,
	resolveSendSelection,
	type SendSelection,
	type TransferSide,
} from "./fee-privacy"

const PRIVATE_FPC: RegisteredFpc = { id: "pfpc", type: FpcType.PrivateFpc, name: "Private Fee Juice", isProtocol: true }
const SPONSOR: RegisteredFpc = { id: "spon", type: FpcType.DefaultSponsoredFpc, name: "Sponsored FPC", isProtocol: true }
const SPONSOR_2: RegisteredFpc = { id: "spon2", type: FpcType.DefaultSponsoredFpc, name: "Other sponsor" }

const balances = (publicFeeJuice: string | null, privateFeeJuice: string | null): GasBalances =>
	({ publicFeeJuice, privateFeeJuice }) as GasBalances

const know = (fpcs: RegisteredFpc[], b: GasBalances | undefined, allowSponsored = true): FeeKnowledge => ({
	fpcs,
	balances: b,
	allowSponsored,
})

/** "fj" | "private_fpc" | "fpc:<id>" | "hold" | "none" — one token per outcome keeps the tables readable. */
const outcome = (s: SendSelection): string => {
	if (s.kind !== "selected") return s.kind
	return s.method.type === "fpc" ? `fpc:${s.method.fpc?.id}` : s.method.type
}

const FJ: FeeMethodOption = { type: "fj", title: "Fee Juice", subtitle: "public" }
const PRIV: FeeMethodOption = { type: "private_fpc", title: "Private Fee Juice", subtitle: "private", fpc: PRIVATE_FPC }
const SPON: FeeMethodOption = { type: "fpc", title: "Sponsored FPC", subtitle: "sponsored", fpc: SPONSOR }

describe("feePayerNotice", () => {
	const sides: (TransferSide | null)[] = ["private", "public", null]
	const methods: (FeeMethodOption | undefined)[] = [FJ, PRIV, SPON, undefined]

	test("yields a notice in exactly the private-origin Fee Juice cells", () => {
		for (const origin of sides) {
			for (const destination of sides) {
				for (const method of methods) {
					const notice = feePayerNotice(origin, destination, method)
					const expected = origin === "private" && method === FJ
					expect(notice !== null, `${origin}→${destination} ${method?.type}`).toBe(expected)
				}
			}
		}
	})

	test("the destination picks the wording; a null destination reads as private → private", () => {
		expect(feePayerNotice("private", "private", FJ)?.shape).toBe("private-private")
		expect(feePayerNotice("private", null, FJ)?.shape).toBe("private-private")
		expect(feePayerNotice("private", "public", FJ)?.shape).toBe("private-public")
	})

	test("pins the approved copy", () => {
		expect(feePayerNotice("private", "private", FJ)).toEqual({
			shape: "private-private",
			title: "Your address pays this fee",
			body: "This send hides the amount and the recipient, but the fee names your account publicly. Anyone watching the chain learns this account sent something, and when.",
		})
		expect(feePayerNotice("private", "public", FJ)?.body).toBe(
			"The recipient and amount on this send are already public. Paying from public Fee Juice adds your address to them, and the whole transfer becomes readable as yours.",
		)
	})
})

describe("payerKindOf — on the settings the card really submits", () => {
	const HAND_ADDED: RegisteredFpc = { id: "hand", type: FpcType.DefaultSponsoredFpc, name: "Mine", isProtocol: false }
	const HAND: FeeMethodOption = { type: "fpc", title: "Mine", subtitle: "sponsored", fpc: HAND_ADDED }
	const funded = balances("5", "5")
	const describe_ = (row: RegisteredFpc): PayerDescriptor => ({
		type: row === PRIVATE_FPC ? "private_fpc" : "fpc",
		fpcId: row.id,
		isProtocol: row.isProtocol === true,
	})

	test("each method type reads as the kind its settings name, with the card's descriptor agreeing", () => {
		expect(payerKindOf(settingsForMethod(FJ, "normal", funded), { type: "fj", isProtocol: false })).toBe("account")
		expect(payerKindOf(settingsForMethod(PRIV, "normal", funded), describe_(PRIVATE_FPC))).toBe("contract")
		expect(payerKindOf(settingsForMethod(SPON, "normal", funded), describe_(SPONSOR))).toBe("contract")
		expect(payerKindOf(settingsForMethod(HAND, "normal", funded), describe_(HAND_ADDED))).toBe("unvouched")
	})

	test("a descriptor for another row, or none, withholds the answer; fee juice needs none", () => {
		expect(payerKindOf(settingsForMethod(PRIV, "normal", funded), describe_(SPONSOR))).toBeNull()
		expect(payerKindOf(settingsForMethod(SPON, "normal", funded), null)).toBeNull()
		expect(payerKindOf(settingsForMethod(FJ, "normal", funded), null)).toBe("account")
	})

	test("settings the card refuses to produce read as no payer", () => {
		expect(payerKindOf(settingsForMethod(FJ, "normal", balances("0", "5")), { type: "fj", isProtocol: false })).toBeNull()
		expect(payerKindOf(settingsForMethod(PRIV, "normal", balances("5", null)), describe_(PRIVATE_FPC))).toBeNull()
		expect(payerKindOf(settingsForMethod(undefined, "normal", funded), describe_(SPONSOR))).toBeNull()
	})
})

describe("isEligible", () => {
	test("a self-paid method needs a positive read of its own balance", () => {
		expect(isEligible(FJ, know([], balances("5", null)))).toBe(true)
		for (const b of [balances("0", "9"), balances(null, "9"), undefined, {} as GasBalances]) {
			expect(isEligible(FJ, know([], b))).toBe(false)
		}
		expect(isEligible(PRIV, know([PRIVATE_FPC], balances(null, "5")))).toBe(true)
		for (const b of [balances("9", "0"), balances("9", null), undefined, {} as GasBalances]) {
			expect(isEligible(PRIV, know([PRIVATE_FPC], b))).toBe(false)
		}
		expect(isEligible({ ...PRIV, fpc: null }, know([], balances("9", "9")))).toBe(false)
	})

	test("a sponsor needs no balance", () => {
		expect(isEligible(SPON, know([SPONSOR], undefined))).toBe(true)
	})
})

describe("resolveSendSelection — private origin", () => {
	const resolve = (k: FeeKnowledge, pick?: Parameters<typeof resolveSendSelection>[2]) =>
		outcome(resolveSendSelection("private", k, pick))

	test("private gas first, even with a sponsor and public gas available", () => {
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("9", "9")))).toBe("private_fpc")
	})

	test("reaches Fee Juice in exactly one knowledge state: private positively zero, public held", () => {
		expect(resolve(know([PRIVATE_FPC], balances("9", "0")))).toBe("fj")
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("9", "0")))).toBe("fj")
	})

	test.each<[string, RegisteredFpc[], GasBalances | undefined]>([
		["no FPC rows", [], balances("9", "0")],
		["sponsor-only list, private balance says zero", [SPONSOR], balances("9", "0")],
		["private balance null", [PRIVATE_FPC], balances("9", null)],
		["private balance missing", [PRIVATE_FPC], { publicFeeJuice: "9" } as GasBalances],
		["no balances at all", [PRIVATE_FPC], undefined],
		["non-protocol PrivateFPC only", [{ ...PRIVATE_FPC, isProtocol: false }], balances("9", "0")],
	])("without a positive private zero it never defaults to Fee Juice: %s", (_name, fpcs, b) => {
		const withoutSponsor = fpcs.filter((f) => f.type !== FpcType.DefaultSponsoredFpc)
		expect(resolve(know(withoutSponsor, b))).toBe("hold")
		expect(resolve(know([...withoutSponsor, SPONSOR], b))).toBe("fpc:spon")
	})

	test("private zero and public zero or unread → the sponsor when there is one", () => {
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("0", "0")))).toBe("fpc:spon")
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances(null, "0")))).toBe("fpc:spon")
	})

	test("none only on confirmed exhaustion; an unread public balance holds", () => {
		expect(resolve(know([PRIVATE_FPC], balances("0", "0")))).toBe("none")
		expect(resolve(know([PRIVATE_FPC], balances(null, "0")))).toBe("hold")
	})

	test("a sponsor the network disallows is not a payer", () => {
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("0", "0"), false))).toBe("none")
		expect(resolve(know([SPONSOR], undefined, false))).toBe("hold")
	})
})

describe("resolveSendSelection — public origin", () => {
	const resolve = (k: FeeKnowledge, pick?: Parameters<typeof resolveSendSelection>[2]) => outcome(resolveSendSelection("public", k, pick))

	test("Fee Juice → Private Fee Juice → Sponsored", () => {
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("9", "9")))).toBe("fj")
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("0", "9")))).toBe("private_fpc")
		expect(resolve(know([PRIVATE_FPC, SPONSOR], balances("0", "0")))).toBe("fpc:spon")
	})

	test("steps past an unread payer — no step here costs privacy", () => {
		expect(resolve(know([PRIVATE_FPC], balances(null, "9")))).toBe("private_fpc")
		expect(resolve(know([PRIVATE_FPC, SPONSOR], undefined))).toBe("fpc:spon")
	})

	test("hold while an applicable payer is unread, none once all are read", () => {
		expect(resolve(know([PRIVATE_FPC], balances(null, "0")))).toBe("hold")
		expect(resolve(know([PRIVATE_FPC], balances("0", null)))).toBe("hold")
		expect(resolve(know([PRIVATE_FPC], balances("0", "0")))).toBe("none")
		// No PrivateFPC listed: its balance is not a question.
		expect(resolve(know([], balances("0", null)))).toBe("none")
		expect(resolve(know([], undefined))).toBe("hold")
	})
})

describe("resolveSendSelection — picks", () => {
	test("an eligible pick beats the walk, on either origin", () => {
		const k = know([PRIVATE_FPC, SPONSOR, SPONSOR_2], balances("9", "9"))
		expect(outcome(resolveSendSelection("private", k, { type: "fpc", fpc: { id: "spon2" } }))).toBe("fpc:spon2")
		expect(outcome(resolveSendSelection("public", k, { type: "private_fpc" }))).toBe("private_fpc")
	})

	test("a private-origin fj pick is honored with the alternatives unread", () => {
		expect(outcome(resolveSendSelection("private", know([PRIVATE_FPC], balances("9", null)), { type: "fj" }))).toBe("fj")
	})

	test("a pick whose row is gone, or whose own balance is unread or zero, falls to the walk", () => {
		const gone = know([PRIVATE_FPC, SPONSOR], balances("9", "9"))
		expect(outcome(resolveSendSelection("private", gone, { type: "fpc", fpc: { id: "deleted" } }))).toBe("private_fpc")
		expect(outcome(resolveSendSelection("private", gone, { type: "fpc" }))).toBe("private_fpc")
		expect(outcome(resolveSendSelection("private", know([PRIVATE_FPC], balances(null, "0")), { type: "fj" }))).toBe("hold")
		expect(outcome(resolveSendSelection("private", know([PRIVATE_FPC, SPONSOR], balances("0", "9")), { type: "fj" }))).toBe(
			"private_fpc",
		)
		expect(outcome(resolveSendSelection("public", know([PRIVATE_FPC], balances("9", "0")), { type: "private_fpc" }))).toBe("fj")
	})
})

describe("applyFpcEdits", () => {
	const rows = [PRIVATE_FPC, SPONSOR, SPONSOR_2]

	test("no edits returns the snapshot itself", () => {
		expect(applyFpcEdits(rows, new Map())).toBe(rows)
	})

	test("drops a deleted id, replaces an updated row, keeps order", () => {
		const renamed = { ...SPONSOR_2, name: "Renamed" }
		const edits = new Map<string, RegisteredFpc | null>([
			["spon", null],
			["spon2", renamed],
		])
		expect(applyFpcEdits(rows, edits)).toEqual([PRIVATE_FPC, renamed])
	})

	test("never adds a row the snapshot lacks, and is idempotent", () => {
		const edits = new Map<string, RegisteredFpc | null>([
			["absent", { ...SPONSOR, id: "absent" }],
			["spon", null],
		])
		const once = applyFpcEdits(rows, edits)
		expect(once).toEqual([PRIVATE_FPC, SPONSOR_2])
		expect(applyFpcEdits(once, edits)).toEqual(once)
	})

	test("an update after a delete brings the row back", () => {
		const edits = new Map<string, RegisteredFpc | null>([["spon", null]])
		edits.set("spon", { ...SPONSOR, name: "Back" })
		expect(applyFpcEdits(rows, edits)[1]).toEqual({ ...SPONSOR, name: "Back" })
	})
})

describe("previewForPick", () => {
	const loading = buildFeeMethods([], undefined, { allowSponsored: true })

	test("a row that exists is the preview", () => {
		expect(previewForPick({ type: "fj" }, loading, true)?.type).toBe("fj")
		expect(previewForPick({ type: "private_fpc" }, loading, true)?.type).toBe("private_fpc")
	})

	test("a sponsor pick with no row yet is drawn from its label, and carries nothing to pay with", () => {
		const preview = previewForPick({ type: "fpc", fpc: { id: "spon", name: "My sponsor" } }, loading, true)
		expect(preview).toEqual({ type: "fpc", title: "My sponsor", subtitle: "sponsored" })
		expect(previewForPick({ type: "fpc", fpc: { id: "spon" } }, loading, true)?.title).toBe("Sponsored FPC")
	})

	test("nothing where sponsors are not offered, or for no pick", () => {
		expect(previewForPick({ type: "fpc", fpc: { id: "spon", name: "My sponsor" } }, loading, false)).toBeUndefined()
		expect(previewForPick(undefined, loading, true)).toBeUndefined()
	})
})

describe("recordOf", () => {
	test("stores the semantic key, plus the sponsor's label for the loading preview", () => {
		expect(recordOf(FJ)).toEqual({ type: "fj" })
		expect(recordOf(PRIV)).toEqual({ type: "private_fpc" })
		expect(recordOf(SPON)).toEqual({ type: "fpc", fpc: { id: "spon", name: SPON.fpc?.name } })
	})
})
