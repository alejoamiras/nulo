export type TransferSide = "private" | "public"

/** `exposed` = public against a private origin; `unknown` = the wallet cannot vouch for the answer. */
export type Visibility = "hidden" | "public" | "exposed" | "unknown"
export type SideVisibility = "hidden" | "public"

/** Who pays, as far as the wallet can say. `unvouched` = a fee contract it cannot speak for. */
export type PayerKind = "account" | "contract" | "unvouched" | null

/** The fee card's reading of the method in effect. It can only ever withhold `contract`. */
export interface PayerDescriptor {
	type: "fj" | "private_fpc" | "fpc"
	fpcId?: string
	isProtocol: boolean
}

export type NoticeShape = "private-private" | "private-public"

export interface PublishFacts {
	you: Visibility
	recipient: SideVisibility
	amount: SideVisibility
	/** True exactly when `you === "exposed"`. */
	requiresReview: boolean
	noticeShape: NoticeShape | null
}

export type FactCell = "you" | "recipient" | "amount"

/** Nothing can be sent, so nothing is published: no strip, no tag, no review. */
export const NO_FACTS: Readonly<PublishFacts> = Object.freeze({
	you: "unknown",
	recipient: "hidden",
	amount: "hidden",
	requiresReview: false,
	noticeShape: null,
})

export const FACT_WORDS = {
	you: { hidden: "HIDDEN", public: "SENDER", exposed: "FEE PAYER", unknown: "—" },
	recipient: { hidden: "HIDDEN", public: "PUBLIC" },
	amount: { hidden: "HIDDEN", public: "PUBLIC" },
} as const satisfies {
	you: Record<Visibility, string>
	recipient: Record<SideVisibility, string>
	amount: Record<SideVisibility, string>
}

const NOTICE_BODY: Record<NoticeShape, string> = {
	"private-private":
		"This send hides the amount and the recipient, but the fee names your account publicly. Anyone watching the chain learns this account sent something, and when.",
	"private-public":
		"The recipient and amount on this send are already public. Paying from public Fee Juice adds your address to them, and the whole transfer becomes readable as yours.",
}

export const FACT_SENTENCES = {
	sender: "A public origin shows the balance leaving your account, so your address is on the chain as the sender.",
	unvouched: "This fee contract was added by hand. Nulo cannot tell what it publishes about you.",
	recipient: "A public destination shows the balance arriving at the recipient's address.",
	amount: "Either side being public shows the balance change, and with it the amount.",
} as const

export const PAID_BY = {
	account: "paid by your address",
	contract: "paid by the fee contract",
	sponsor: "paid by the sponsor",
} as const

type SubmittedFee = { paymentMethod?: { kind?: string; fpcId?: string } } | undefined

/**
 * Reads the payer off the settings that will actually be submitted. `account` needs nothing else;
 * `contract` — the only reading that lets the UI say HIDDEN — also needs the card's descriptor to
 * name the same contract and mark it protocol-derived.
 */
export function payerKindOf(settings: SubmittedFee, payer: PayerDescriptor | null): PayerKind {
	const method = settings?.paymentMethod
	if (method?.kind === "fj") return "account"
	if (method?.kind !== "fpc" || !method.fpcId || payer?.fpcId !== method.fpcId) return null
	return payer.isProtocol === true ? "contract" : "unvouched"
}

function youFor(origin: TransferSide, payer: PayerKind): Visibility {
	if (origin === "public") return "public"
	if (payer === "account") return "exposed"
	return payer === "contract" ? "hidden" : "unknown"
}

export function publishFacts(origin: TransferSide, destination: TransferSide, payer: PayerKind): PublishFacts {
	const you = youFor(origin, payer)
	const requiresReview = you === "exposed"
	const shape: NoticeShape = destination === "public" ? "private-public" : "private-private"
	return {
		you,
		recipient: destination === "public" ? "public" : "hidden",
		amount: origin === "public" || destination === "public" ? "public" : "hidden",
		requiresReview,
		noticeShape: requiresReview ? shape : null,
	}
}

export function factWord(cell: FactCell, facts: PublishFacts): string {
	if (cell === "you") return FACT_WORDS.you[facts.you]
	return FACT_WORDS[cell][facts[cell]]
}

/** The glyph Home and the token rows use for each side: the padlock only for hidden, and none
 *  while Nulo cannot tell, so a mark never claims more privacy than the send has. */
export function publishGlyph(visibility: Visibility): "lock" | "globe" | null {
	switch (visibility) {
		case "hidden":
			return "lock"
		case "public":
		case "exposed":
			return "globe"
		default:
			return null
	}
}

export function noticeBodyFor(shape: NoticeShape): string {
	return NOTICE_BODY[shape]
}

/** The sentence under a review row. Hidden rows carry none; "—" carries one only for a hand-added contract. */
export function rowSentence(cell: FactCell, facts: PublishFacts, payer: PayerKind): string | null {
	if (cell === "recipient") return facts.recipient === "public" ? FACT_SENTENCES.recipient : null
	if (cell === "amount") return facts.amount === "public" ? FACT_SENTENCES.amount : null
	if (facts.you === "public") return FACT_SENTENCES.sender
	if (facts.you === "exposed") return noticeBodyFor(facts.noticeShape ?? "private-private")
	return facts.you === "unknown" && payer === "unvouched" ? FACT_SENTENCES.unvouched : null
}

/** Null while no payer is resolved. `account` comes from the submitted settings, never from the row's type. */
export function paidBy(payer: PayerKind, type: PayerDescriptor["type"] | undefined): string | null {
	if (payer === "account") return PAID_BY.account
	if (payer === null) return null
	return type === "private_fpc" ? PAID_BY.contract : PAID_BY.sponsor
}

const joinList = (items: string[]): string =>
	items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

export function stripAriaLabel(facts: PublishFacts): string {
	const published: string[] = []
	if (facts.you === "public") published.push("your address as the sender")
	if (facts.you === "exposed") published.push("your address as the fee payer")
	if (facts.recipient === "public") published.push("the recipient")
	if (facts.amount === "public") published.push("the amount")

	const sentences: string[] = []
	if (published.length > 0) sentences.push(`This send publishes ${joinList(published)}.`)
	else if (facts.you !== "unknown") sentences.push("This send publishes nothing.")
	if (facts.you === "unknown") sentences.push("Your address: not known yet.")
	sentences.push("Open details")
	return sentences.join(" ")
}
