import { buildFeeMethods, type FeeMethodOption, type GasBalances, type RegisteredFpc } from "./fee-helpers"

export type TransferSide = "private" | "public"

/** The compact form a pick is stored in — never a presentation row. `fpc.name` only labels the
 *  loading preview; a pick is resolved by `fpc.id` against fresh rows, never by name. */
export type SavedRecord = { type: "fj" | "private_fpc" | "fpc"; fpc?: { id: string; name?: string } | null }

/** The committed snapshot the card holds. `undefined` balances = the gas read failed. */
export type FeeKnowledge = { fpcs: RegisteredFpc[]; balances: GasBalances | undefined; allowSponsored: boolean }

export type SendSelection =
	/** No committed snapshot for the live identity yet. `preview` is display-only and never yields settings. */
	| { kind: "pending"; preview: FeeMethodOption | undefined }
	| { kind: "selected"; method: FeeMethodOption }
	/** The default could not be established on confirmed data: select nothing. */
	| { kind: "hold" }
	/** Every applicable payer was positively read and none can pay — the only state that may say "you have none". */
	| { kind: "none" }

export type FeePayerNotice = { shape: "private-private" | "private-public"; title: string; body: string }

const NOTICE_TITLE = "Your address pays this fee"
const NOTICE_BODY: Record<FeePayerNotice["shape"], string> = {
	"private-private":
		"This send hides the amount and the recipient, but the fee names your account publicly. Anyone watching the chain learns this account sent something, and when.",
	"private-public":
		"The recipient and amount on this send are already public. Paying from public Fee Juice adds your address to them, and the whole transfer becomes readable as yours.",
}

/** A balance counts only when it was actually read: `null`, `undefined` and a missing property are all unread. */
const isRead = (balance: string | null | undefined): balance is string => typeof balance === "string"
const canPay = (balance: string | null | undefined): boolean => isRead(balance) && balance !== "0"

/** Can this method pay right now, on a positive read? Unread is never eligible. */
export function isEligible(method: FeeMethodOption, know: FeeKnowledge): boolean {
	switch (method.type) {
		case "fj":
			return canPay(know.balances?.publicFeeJuice)
		case "private_fpc":
			return Boolean(method.fpc) && canPay(know.balances?.privateFeeJuice)
		case "fpc":
			return Boolean(method.fpc)
		default:
			return false
	}
}

interface Payers {
	fj: FeeMethodOption | undefined
	privateFj: FeeMethodOption | undefined
	sponsor: FeeMethodOption | undefined
}

function payersOf(methods: FeeMethodOption[]): Payers {
	return {
		fj: methods.find((m) => m.type === "fj"),
		privateFj: methods.find((m) => m.type === "private_fpc"),
		sponsor: methods.find((m) => m.type === "fpc"),
	}
}

const eligibleOrUndefined = (method: FeeMethodOption | undefined, know: FeeKnowledge) =>
	method && isEligible(method, know) ? method : undefined

const selected = (method: FeeMethodOption): SendSelection => ({ kind: "selected", method })

/**
 * Private Fee Juice → Fee Juice → Sponsored. Fee Juice names the account, so the walk reaches it
 * only on a private balance positively read as "0"; short of that it skips to a sponsor or holds.
 */
function walkPrivateOrigin(payers: Payers, know: FeeKnowledge): SendSelection {
	const privateFj = eligibleOrUndefined(payers.privateFj, know)
	if (privateFj) return selected(privateFj)

	const sponsor = eligibleOrUndefined(payers.sponsor, know)
	const privateReadAsZero = Boolean(payers.privateFj?.fpc) && know.balances?.privateFeeJuice === "0"
	if (!privateReadAsZero) return sponsor ? selected(sponsor) : { kind: "hold" }

	const fj = eligibleOrUndefined(payers.fj, know)
	if (fj) return selected(fj)
	if (sponsor) return selected(sponsor)
	return know.balances?.publicFeeJuice === "0" ? { kind: "none" } : { kind: "hold" }
}

/** Fee Juice → Private Fee Juice → Sponsored. No step here costs privacy, so an unread payer is stepped past. */
function walkPublicOrigin(payers: Payers, know: FeeKnowledge): SendSelection {
	const first =
		eligibleOrUndefined(payers.fj, know) ?? eligibleOrUndefined(payers.privateFj, know) ?? eligibleOrUndefined(payers.sponsor, know)
	if (first) return selected(first)

	const publicUnread = !isRead(know.balances?.publicFeeJuice)
	const privateUnread = Boolean(payers.privateFj?.fpc) && !isRead(know.balances?.privateFeeJuice)
	return publicUnread || privateUnread ? { kind: "hold" } : { kind: "none" }
}

/** The fresh row a saved pick names, or undefined when that row no longer exists. */
export function rowForPick(pick: SavedRecord | undefined, methods: FeeMethodOption[]): FeeMethodOption | undefined {
	if (!pick) return undefined
	if (pick.type !== "fpc") return methods.find((m) => m.type === pick.type)
	const id = pick.fpc?.id
	return id ? methods.find((m) => m.type === "fpc" && m.fpc?.id === id) : undefined
}

/** What the trigger shows before the first snapshot. FPC rows do not exist until the FPC list has
 *  loaded, so a sponsor pick is drawn from its saved label — display only, it carries no `fpc` to pay with. */
export function previewForPick(
	pick: SavedRecord | undefined,
	methods: FeeMethodOption[],
	allowSponsored: boolean,
): FeeMethodOption | undefined {
	const row = rowForPick(pick, methods)
	if (row || pick?.type !== "fpc" || !pick.fpc?.id || !allowSponsored) return row
	return { type: "fpc", title: pick.fpc.name || "Sponsored FPC", subtitle: "sponsored" }
}

/** A saved pick wins when its row still exists and is eligible; otherwise the default walk. */
export function resolveSendSelection(origin: TransferSide, know: FeeKnowledge, pick: SavedRecord | undefined): SendSelection {
	const methods = buildFeeMethods(know.fpcs, know.balances, { allowSponsored: know.allowSponsored })
	const picked = eligibleOrUndefined(rowForPick(pick, methods), know)
	if (picked) return selected(picked)
	const payers = payersOf(methods)
	return origin === "private" ? walkPrivateOrigin(payers, know) : walkPublicOrigin(payers, know)
}

/**
 * The store's FPC snapshot with this card's own FPC events applied on top: deleted ids dropped,
 * updated rows replaced, never a row added. Idempotent, so it survives every snapshot commit.
 */
export function applyFpcEdits<T extends { id: string }>(fpcs: T[], edits: ReadonlyMap<string, T | null>): T[] {
	if (edits.size === 0) return fpcs
	const out: T[] = []
	for (const fpc of fpcs) {
		const edit = edits.has(fpc.id) ? edits.get(fpc.id) : fpc
		if (edit) out.push(edit)
	}
	return out
}

/**
 * Non-null exactly when the origin is private and the method is the account's own Fee Juice —
 * the one payer that names the account. A null destination takes the private → private wording.
 */
export function feePayerNotice(
	origin: TransferSide | null,
	destination: TransferSide | null,
	method: FeeMethodOption | undefined,
): FeePayerNotice | null {
	if (origin !== "private" || method?.type !== "fj") return null
	const shape = destination === "public" ? "private-public" : "private-private"
	return { shape, title: NOTICE_TITLE, body: NOTICE_BODY[shape] }
}

/** The compact record persisted for a picked row. */
export function recordOf(method: FeeMethodOption): SavedRecord {
	if (method.type !== "fpc" || !method.fpc) return { type: method.type }
	return { type: "fpc", fpc: method.fpc.name ? { id: method.fpc.id, name: method.fpc.name } : { id: method.fpc.id } }
}
