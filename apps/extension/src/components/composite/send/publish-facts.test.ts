import { describe, expect, test } from "vitest"
import {
	FACT_SENTENCES,
	FACT_WORDS,
	factWord,
	NO_FACTS,
	noticeBodyFor,
	PAID_BY,
	type PayerDescriptor,
	type PayerKind,
	paidBy,
	payerKindOf,
	publishFacts,
	publishGlyph,
	rowSentence,
	UNVOUCHED_FEE_SENTENCE,
	stripAriaLabel,
	type TransferSide,
} from "./publish-facts"

describe("publishFacts", () => {
	/** origin → destination · payer = you / recipient / amount / notice shape ("-" = none, so no review). */
	const TABLE: [TransferSide, TransferSide, PayerKind, string][] = [
		["private", "private", "account", "exposed/hidden/hidden/private-private"],
		["private", "private", "contract", "hidden/hidden/hidden/-"],
		["private", "private", "unvouched", "unknown/hidden/hidden/-"],
		["private", "private", null, "unknown/hidden/hidden/-"],
		["private", "public", "account", "exposed/public/public/private-public"],
		["private", "public", "contract", "hidden/public/public/-"],
		["private", "public", "unvouched", "unknown/public/public/-"],
		["private", "public", null, "unknown/public/public/-"],
		["public", "private", "account", "public/hidden/public/-"],
		["public", "private", "contract", "public/hidden/public/-"],
		["public", "private", "unvouched", "public/hidden/public/-"],
		["public", "private", null, "public/hidden/public/-"],
		["public", "public", "account", "public/public/public/-"],
		["public", "public", "contract", "public/public/public/-"],
		["public", "public", "unvouched", "public/public/public/-"],
		["public", "public", null, "public/public/public/-"],
	]

	test.each(TABLE)("%s → %s, payer %s", (origin, destination, payer, expected) => {
		const facts = publishFacts(origin, destination, payer)
		expect(`${facts.you}/${facts.recipient}/${facts.amount}/${facts.noticeShape ?? "-"}`).toBe(expected)
		expect(facts.requiresReview).toBe(facts.you === "exposed")
		expect(facts.requiresReview).toBe(facts.noticeShape !== null)
	})

	test("the table is every cell, and exactly two of them require review", () => {
		expect(new Set(TABLE.map(([o, d, p]) => `${o}/${d}/${p}`)).size).toBe(16)
		expect(TABLE.filter(([o, d, p]) => publishFacts(o, d, p).requiresReview)).toHaveLength(2)
	})

	test("no facts: nothing to review, nothing to tag", () => {
		expect(NO_FACTS).toEqual({ you: "unknown", recipient: "hidden", amount: "hidden", requiresReview: false, noticeShape: null })
		expect(Object.isFrozen(NO_FACTS)).toBe(true)
	})
})

describe("payerKindOf", () => {
	const PROTOCOL: PayerDescriptor = { type: "private_fpc", fpcId: "pfpc", isProtocol: true }
	const HAND_ADDED: PayerDescriptor = { type: "fpc", fpcId: "spon", isProtocol: false }
	const fpc = (fpcId?: string) => ({ paymentMethod: { kind: "fpc", fpcId } })

	test("own Fee Juice names the account whatever the card says", () => {
		for (const payer of [null, PROTOCOL, HAND_ADDED]) expect(payerKindOf({ paymentMethod: { kind: "fj" } }, payer)).toBe("account")
	})

	test("a contract is vouched for only when the card names the same id as protocol-derived", () => {
		expect(payerKindOf(fpc("pfpc"), PROTOCOL)).toBe("contract")
		expect(payerKindOf(fpc("spon"), HAND_ADDED)).toBe("unvouched")
		expect(payerKindOf(fpc("other"), PROTOCOL)).toBeNull()
		expect(payerKindOf(fpc("pfpc"), null)).toBeNull()
		expect(payerKindOf(fpc("pfpc"), { type: "fj", isProtocol: true })).toBeNull()
		expect(payerKindOf(fpc(undefined), { type: "fpc", isProtocol: true })).toBeNull()
	})

	test("isProtocol must be the literal true", () => {
		const truthy = { type: "fpc", fpcId: "spon", isProtocol: "yes" } as unknown as PayerDescriptor
		expect(payerKindOf(fpc("spon"), truthy)).toBe("unvouched")
	})

	test("anything else is no payer, never a guess", () => {
		const shapes = [undefined, {}, { paymentMethod: undefined }, { paymentMethod: {} }, { paymentMethod: { kind: "embedded" } }]
		for (const settings of [...shapes, { paymentMethod: { kind: "fjwc" } }, { kind: "fj" } as object]) {
			expect(payerKindOf(settings, PROTOCOL), JSON.stringify(settings)).toBeNull()
		}
	})
})

describe("publishGlyph", () => {
	test("the padlock only for hidden, the globe for anything public, nothing when Nulo can't tell", () => {
		expect(publishGlyph("hidden")).toBe("lock")
		expect(publishGlyph("public")).toBe("globe")
		expect(publishGlyph("exposed")).toBe("globe")
		expect(publishGlyph("unknown")).toBeNull()
	})
})

describe("copy", () => {
	test("pins the approved words and sentences", () => {
		expect(FACT_WORDS).toEqual({
			you: { hidden: "HIDDEN", public: "SENDER", exposed: "FEE PAYER", unknown: "—" },
			recipient: { hidden: "HIDDEN", public: "PUBLIC" },
			amount: { hidden: "HIDDEN", public: "PUBLIC" },
		})
		expect(FACT_SENTENCES).toEqual({
			sender: "A public origin shows the balance leaving your account, so your address is on the chain as the sender.",
			unvouched: "This fee contract was added by hand. Nulo cannot tell what it publishes about you.",
			recipient: "A public destination shows the balance arriving at the recipient's address.",
			amount: "Either side being public shows the balance change, and with it the amount.",
		})
		expect(PAID_BY).toEqual({
			account: "paid by your address",
			contract: "paid by the fee contract",
			sponsor: "paid by the sponsor",
		})
		expect(UNVOUCHED_FEE_SENTENCE).toBe("Nulo can't tell what this fee contract charges you.")
	})

	test("each cell's word is the one for its visibility", () => {
		const gated = publishFacts("private", "public", "account")
		expect([factWord("you", gated), factWord("recipient", gated), factWord("amount", gated)]).toEqual(["FEE PAYER", "PUBLIC", "PUBLIC"])
		const hidden = publishFacts("private", "private", "contract")
		expect([factWord("you", hidden), factWord("recipient", hidden), factWord("amount", hidden)]).toEqual(["HIDDEN", "HIDDEN", "HIDDEN"])
		expect(factWord("you", publishFacts("public", "private", null))).toBe("SENDER")
		expect(factWord("you", NO_FACTS)).toBe("—")
	})

	test("the notice bodies are the shipped ones, word for word", () => {
		expect(noticeBodyFor("private-private")).toBe(
			"This send hides the amount and the recipient, but the fee names your account publicly. Anyone watching the chain learns this account sent something, and when.",
		)
		expect(noticeBodyFor("private-public")).toBe(
			"The recipient and amount on this send are already public. Paying from public Fee Juice adds your address to them, and the whole transfer becomes readable as yours.",
		)
	})

	test("a row carries a sentence only when it publishes something, or when the wallet cannot vouch", () => {
		const gated = publishFacts("private", "public", "account")
		expect(rowSentence("you", gated, "account")).toBe(noticeBodyFor("private-public"))
		expect(rowSentence("recipient", gated, "account")).toBe(FACT_SENTENCES.recipient)
		expect(rowSentence("amount", gated, "account")).toBe(FACT_SENTENCES.amount)
		expect(rowSentence("you", publishFacts("private", "private", "account"), "account")).toBe(noticeBodyFor("private-private"))
		expect(rowSentence("you", publishFacts("public", "private", "contract"), "contract")).toBe(FACT_SENTENCES.sender)

		const hidden = publishFacts("private", "private", "contract")
		for (const cell of ["you", "recipient", "amount"] as const) expect(rowSentence(cell, hidden, "contract")).toBeNull()

		const unknown = publishFacts("private", "private", "unvouched")
		expect(rowSentence("you", unknown, "unvouched")).toBe(FACT_SENTENCES.unvouched)
		expect(rowSentence("you", unknown, null)).toBeNull()
	})

	test("the fee line names the payer from the settings' reading, and none while pending or hand-added", () => {
		expect(paidBy("account", "fj")).toBe(PAID_BY.account)
		expect(paidBy("account", "fpc")).toBe(PAID_BY.account)
		expect(paidBy("contract", "private_fpc")).toBe(PAID_BY.contract)
		expect(paidBy("contract", "fpc")).toBe(PAID_BY.sponsor)
		expect(paidBy("unvouched", "fpc")).toBeNull()
		expect(paidBy(null, "fj")).toBeNull()
	})

	test("the strip's label says nothing only when all three are hidden, and never guesses an unknown", () => {
		const label = (o: TransferSide, d: TransferSide, p: PayerKind) => stripAriaLabel(publishFacts(o, d, p))
		expect(label("private", "private", "contract")).toBe("This send publishes nothing. Open details")
		expect(label("private", "private", "account")).toBe("This send publishes your address as the fee payer. Open details")
		expect(label("public", "private", null)).toBe("This send publishes your address as the sender and the amount. Open details")
		expect(label("public", "public", "account")).toBe(
			"This send publishes your address as the sender, the recipient and the amount. Open details",
		)
		expect(label("private", "private", null)).toBe("Your address: not known yet. Open details")
		expect(label("private", "public", "unvouched")).toBe(
			"This send publishes the recipient and the amount. Your address: not known yet. Open details",
		)
	})
})
