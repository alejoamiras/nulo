<script setup lang="ts">
/** Services */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import {
	type RouteOutcome,
	type SendDepositRecord,
	type SendJournalRecord,
	PERMIT_DEADLINE_SECONDS,
	type TokenState,
	PORTAL_FACTORY_ABI,
	assetKindOf,
	isSendRecord,
	predictPortal,
} from "@nulo/bridge-core"
import type { Address, PublicClient } from "viem"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { HUB, HUB_TOKEN_ARTIFACT, SEND_GENERATION, SWAP } from "@/contracts/bridge-generation"
import { readHubBinding } from "@/contracts/hub-binding"

/** Components */
import BridgeReceipt, { type ReceiptSnapshot } from "@/components/BridgeReceipt.vue"
import BridgeStepper from "@/components/BridgeStepper.vue"
import AmountStep from "./AmountStep.vue"
import MintStrip from "./MintStrip.vue"
import ReviewStep, { type ReviewEstimate } from "./ReviewStep.vue"
import TokenStep from "./TokenStep.vue"
import WizardShell from "./WizardShell.vue"

/** Composables */
import { useShell } from "@/composables/useShell"
import { useAddressLookup } from "@/composables/useAddressLookup"
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { type RecordRuntime, useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useAddDripToken } from "@/composables/useAddDripToken"
import { useGasHeld } from "@/composables/useGasHeld"
import { useGasShare } from "@/composables/useGasShare"
import { EXIT_TOKEN_NOT_REGISTERED, useHubExit } from "@/composables/useHubExit"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { useRouteQuote } from "@/composables/useRouteQuote"
import { useRowBalances } from "@/composables/useRowBalances"
import { previewBlock, useSend } from "@/composables/useSend"
import { useToast } from "@/composables/useToast"
import { useTokenCatalog } from "@/composables/useTokenCatalog"
import { useTokenGrant } from "@/composables/useTokenGrant"
import { useTokenSelection } from "@/composables/useTokenSelection"

/** Utils */
import { recordTokenBlock } from "@/lib/asset-label"
import { stepperPhases } from "@/lib/bridge-steps"
import { formatBigInt, formatCompact, parseAmountStrict, toDecimalString } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"
import { safeDisplay } from "@/lib/token-display"
import type { AmountToken, Direction, ExitPlan, GasLegPlan, ResolvedToken, SelectableToken, SendIntent, SendPlan } from "@/lib/send-model"
import { type OwnGasSource, decideOwnGasSource } from "@/lib/fuel-claim-state"

/** The rail's own etas, summed and rounded UP — the review must never undersell how long this takes. */
const DEPOSIT_TAKES = "usually 3–8 min end to end"
const EXIT_TAKES = "tens of minutes — Aztec proves exits in epoch batches"
/** The fee asset needs no swap, so its gas leg carries no pools at all. */
const NO_SWAP = { path: [], zeroForOnes: [] }
const ONE_TO_ONE = { probeIn: 1n, probeOut: 1n }
/** What one Aztec transaction is budgeted at on this network; null where nothing can buy gas. */
const fjPerTx = SWAP ? BigInt(SWAP.fjPerTx) : null
/** A token-only claim spends gas the account already holds; there is no sponsor to fall back on. */
const NO_GAS_FOR_TOKEN_ONLY =
	"Your Aztec account holds no gas the bridge can claim with, so the token alone could not be claimed. Choose Token + gas to arrive with some."
const SHORT_GAS_FOR_TOKEN_ONLY =
	"Your Aztec account's gas is under what this claim sets aside at current network fees. Choose Token + gas to arrive with more, or bridge gas first."
const UNREAD_GAS_FOR_TOKEN_ONLY =
	"Your Aztec account's gas could not be read just now, so the claim was not confirmed. Try again in a moment."
const UNPRICED_TOKEN_ONLY =
	"Aztec's network fees could not be re-read just now, so a claim from your held gas was not confirmed. Try again in a moment."
const CEILING_NOW_PRICED_TOKEN_ONLY =
	"The claim's fee was priced after you opened the review - it now shows what is set aside from your gas. Review it again."
const CEILING_MOVED_TOKEN_ONLY =
	"Aztec's network fees moved while you were on the review: the claim now sets aside more of your gas than it showed."
/** The review's figure is an "≈": a tenth more than it showed is no longer that figure. */
const CEILING_DRIFT_DIVISOR = 10n

const l1 = useL1Wallet()
const bridge = useBridgeWallet()
const journal = useBridgeJournal()
const shell = useShell()
const backup = useBridgeBackup()
const addToken = useAddDripToken()
const { push: pushToast } = useToast()

const catalog = useTokenCatalog()
const lookup = useAddressLookup({
	pub: () => l1.publicClient as unknown as PublicClient,
	query: catalog.search,
	known: () => catalog.tokens.value,
	chainId: () => catalog.chainId,
})
const rowBalances = useRowBalances({
	pub: () => l1.publicClient as unknown as PublicClient,
	owner: () => l1.address.value ?? undefined,
	tokens: () => catalog.filtered.value,
})
const selection = useTokenSelection({
	pub: () => l1.publicClient as unknown as PublicClient,
	l1Account: () => l1.address.value ?? undefined,
	readBinding: readHubBinding,
	l2Account: () => bridge.selectedAccount.value ?? undefined,
	tokenContract: async (l2Token) => {
		const wallet = bridge.wallet.value
		if (!wallet) return undefined
		return Contract.at(AztecAddress.fromStringUnsafe(l2Token), HUB_TOKEN_ARTIFACT, wallet as never)
	},
})
const grant = useTokenGrant()
const gasHeld = useGasHeld({ aztec: () => bridge.wallet.value, account: () => bridge.selectedAccount.value ?? undefined })
const routeQuote = useRouteQuote({ pub: () => l1.publicClient as unknown as PublicClient })
const gasShare = useGasShare()
// A private slice is sized from live fees: price them now so the amount step never waits on them.
void gasShare.prime()
const sendFlow = useSend({ epoch: selection.epoch })
const exitFlow = useHubExit()

const direction = ref<Direction>("l1-to-l2")
const step = ref<0 | 1 | 2>(0)
const intent = ref<SendIntent>("token")
const amount = ref("")
const isPrivate = ref(true)
const addError = ref<string | null>(null)
const grantState = ref<"idle" | "pending" | "declined" | "busy">("idle")
/** What the user tapped, held separately from what the chain came back with: the list must keep the
 *  tapped row lit while it resolves, and a failed resolve leaves nothing selected. */
const picked = ref<SelectableToken | null>(null)
const portalVerified = ref<"verified" | "absent" | "unknown" | "mismatch">("unknown")
/** The amount step owns its field's validation; the wizard only carries the verdict. */
const amountValid = ref(false)

// The takeover machine: ALL wizard gating keys off `stage`, never the flows' busy, which spans the
// whole send and would make RUN IN BACKGROUND a no-op. `permit` is the stepper before any record
// exists: the wallet's token permission is the run's first phase and is asked before anything is
// signed, so it is shown from a record the wizard builds out of the plan.
const stage = ref<"wizard" | "permit" | "stepper" | "receipt">("wizard")
const permitRecord = ref<SendDepositRecord | null>(null)
const PERMIT_RUNTIME: RecordRuntime = { step: "granting" }
// The engine's foreground stays the single DISPLAY owner, but the wizard ALSO tracks the id of the
// record IT started: a foreground-derived "my record" is racy while another surface can re-point it.
const activeId = journal.activeFlowId
const ownedId = ref<string | null>(null)
const receiptSnapshot = ref<ReceiptSnapshot | null>(null)
const receiptL2Token = ref<string | null>(null)
/** The record RUN IN BACKGROUND handed to the journal; the wizard keeps a line on it until it completes. */
const backgroundedId = ref<string | null>(null)
/** What the review promised for it — the strip's subject, whatever the record's own units are. */
const backgroundedLine = ref<string | null>(null)
/** A provisional record is rekeyed once its transaction names it; the wizard follows the rekey. */
const backgroundedCanonical = computed(() => (backgroundedId.value ? journal.canonicalRecordId(backgroundedId.value) : null))
const reviewSaid = ref<string | null>(null)
const submitting = ref(false)
/** Confirm's read of the gas gate: holds the buttons like a submit, but the review stays live. */
const preflighting = ref(false)
/** Record ids that existed before THIS submit — see `adoptRunRecord`. */
let preSubmitIds = new Set<string>()

/**
 * Everything the review renders and the confirm sends, frozen when the user reached the review. The
 * live plan keeps moving under it — a quote lands, an account switches — and a review the user read
 * is not a plan they consented to unless it is the plan that gets signed.
 */
interface ReviewSnapshot {
	plan: SendPlan | ExitPlan
	account: string
	slippageBps: number | null
	estimate: ReviewEstimate
	/** What a token-only deposit's claim was SHOWN to set aside from held gas; null when the review
	 *  opened unpriced, or for any other plan. */
	ownGasCeiling: bigint | null
}
const reviewed = ref<ReviewSnapshot | null>(null)
/** Set when a change under the frozen review sent the user back to the amount step. */
const reviewStale = ref(false)
/** The specific reason, when the stand-down has one worth naming over the generic line. */
const reviewStaleWhy = ref<string | null>(null)

const isExit = computed(() => direction.value === "l2-to-l1")
const resolved = selection.selected
const ownedRecord = computed(() => (ownedId.value ? journal.records.value.find((r) => r.id === ownedId.value) : undefined))
const activeRecord = computed(() => (activeId.value ? journal.records.value.find((r) => r.id === activeId.value) : undefined))

const busy = computed(() => preflighting.value || submitting.value || sendFlow.busy.value || exitFlow.busy.value)
const flowError = computed(() => sendFlow.error.value ?? exitFlow.error.value)

/** ---- amount ------------------------------------------------------------------------------- */

const amountUnits = computed(() => (resolved.value ? parseAmountStrict(amount.value, resolved.value.decimals) : null))

// The strip's labels render a symbol a list or a pasted contract chose; stripped and capped like
// every other place it lands.
/** What the amount step renders against: the chain's answer once it lands FOR THE ROW PICKED, the
 *  row's own symbol and decimals meanwhile, so picking a row moves on at once instead of waiting on
 *  a read — and a read still standing from the previous row never dresses the new one. */
const amountToken = computed<AmountToken | null>(() => {
	const row = picked.value
	if (!row) return null
	const read = resolved.value
	if (read && read.address === row.address) return read
	return row.decimals >= 0 ? { symbol: safeDisplay(row.symbol), decimals: row.decimals } : null
})

const tokenLabel = computed(() => (amountToken.value ? safeDisplay(amountToken.value.symbol) : undefined))

/** What the step strip shows for the amount once the user has moved past it. */
const amountLabel = computed(() => {
	const token = resolved.value
	const units = amountUnits.value
	return token && units !== null && units > 0n ? `${toDecimalString(units, token.decimals)} ${tokenLabel.value}` : undefined
})

/** ---- the gas leg -------------------------------------------------------------------------- */

/** One whole token unit: the amount the route is probed with, and half of the identity an outcome
 *  has to match before the wizard prices anything with it. */
function probeAmountOf(token: ResolvedToken): bigint {
	return 10n ** BigInt(token.decimals)
}

/** The route outcome ONLY while it answers the token on screen. A probe still in flight, or one
 *  left over from a token the user has moved off, prices nothing. */
const routeOutcome = computed<RouteOutcome | null>(() => {
	const token = resolved.value
	const answer = routeQuote.quoted.value
	if (!token || !answer) return null
	return answer.token === token.address && answer.probeAmount === probeAmountOf(token) ? answer.outcome : null
})

const routeKind = computed(() => routeOutcome.value?.kind ?? null)

/** The floor the swap is signed against. The fee asset arrives one-for-one, so its floor is the
 *  slice itself: applying slippage there would sign a floor the identity path can never miss. */
function floorFor(quote: bigint, outcome: RouteOutcome): bigint {
	return outcome.kind === "route" ? gasShare.floorFor(quote) : quote
}

function buildGas(): { plan: GasLegPlan | null; error: string | null } {
	const token = resolved.value
	const units = amountUnits.value
	const outcome = routeOutcome.value
	if (!token || units === null || units <= 0n || !outcome) return { plan: null, error: null }
	if (outcome.kind !== "route" && outcome.kind !== "identity") return { plan: null, error: null }
	const probeIn = probeAmountOf(token)
	const rate = outcome.kind === "route" ? { probeIn, probeOut: outcome.quoteOut } : ONE_TO_ONE
	const share = gasShare.propose({ amount: units, decimals: token.decimals, state: token.state, rate, isPrivate: isPrivate.value })
	// A private slice is priced from live fees; until they arrive there is nothing to size, like a
	// route probe still in flight.
	if (share === "pricing") return { plan: null, error: null }
	if (!share) return { plan: null, error: "This network has no swap venue, so a send cannot buy gas." }
	// Gas-only spends the whole amount; the router refuses any other split.
	const fuelAmount = intent.value === "gas" ? units : share.fuelAmount
	if (intent.value === "token+gas" && fuelAmount >= units) {
		return { plan: null, error: "The amount is too small to buy gas and still send a token." }
	}
	const quote = outcome.kind === "route" ? (fuelAmount * outcome.quoteOut) / probeIn : fuelAmount
	const minFuelOutput = floorFor(quote, outcome)
	const shortfall = quoteShortfall(quote) ?? (intent.value === "gas" ? null : privateSliceShortfall(token.state, minFuelOutput))
	if (shortfall) return { plan: null, error: shortfall }
	const route = outcome.kind === "route" ? outcome.route : NO_SWAP
	return {
		plan: { fuelAmount, fuelFj: share.fuelFj, quote, minFuelOutput, route, capped: share.capped },
		error: null,
	}
}

/** The bridge refuses gas under its claim minimum on Ethereum (the swap reverts at the router's
 *  floor), so a quote under it is a deposit that cannot go through — say so before a signature. The
 *  slice may have been capped at half the amount, far under what the transactions asked for. */
function quoteShortfall(quote: bigint): string | null {
	if (!SWAP || quote >= BigInt(SWAP.minFuelFj)) return null
	return `This amount buys only ≈ ${formatCompact(quote, 18)} FJ of gas, under the ≈ ${formatCompact(BigInt(SWAP.minFuelFj), 18)} FJ minimum a claim needs - send a larger amount.`
}

/** A private claim forfeits its fee ceilings before any gas reaches the user: a slice whose
 *  GUARANTEED floor cannot cover them (the half-of-the-deposit cap ships less than the target while
 *  the target still counts the ceilings) would cross to Aztec only for the fee ladder to refuse it,
 *  after the Ethereum deposit is already irreversible — so it is refused here, before a signature. */
function privateSliceShortfall(state: TokenState, minFuelOutput: bigint): string | null {
	if (!isPrivate.value) return null
	const ceilings = gasShare.ceilingsFor(state)
	if (ceilings === null || minFuelOutput >= ceilings) return null
	return "The gas slice is too small to cover the fees a private claim sets aside - send a larger amount, or send it publicly."
}

const gasResult = computed(() => {
	if (isExit.value || intent.value === "token") return { plan: null, error: null }
	try {
		return buildGas()
	} catch (e) {
		return { plan: null, error: e instanceof Error ? e.message : "This amount cannot carry a gas slice." }
	}
})
const gas = computed(() => gasResult.value.plan)
const gasError = computed(
	() =>
		gasResult.value.error ??
		routeQuote.error.value ??
		(isPrivate.value && intent.value !== "token" ? gasShare.pricingError.value : null),
)

/** ---- step gating -------------------------------------------------------------------------- */

const tokenChosen = computed(() => resolved.value !== null)

/** An exit burns through the HUB's binding for the token. A portal on Ethereum is not that binding —
 *  the registration message may exist and never have been consumed — and without it there is no L2
 *  balance to spend, no ceiling to check the amount against, and no burn the hub could authorize. */
const exitBlocked = computed<string | null>(() => {
	const token = resolved.value
	return isExit.value && token && token.state.kind !== "registered" ? EXIT_TOKEN_NOT_REGISTERED : null
})

/** What a claim from the account's held gas sets aside for this token, at the last price; null while unpriced. */
const ownGasCeiling = computed(() => (resolved.value ? gasShare.ownGasCeilingFor(resolved.value.state, isPrivate.value) : null))
/** Which held gas would pay a token-only claim at this ceiling — the decision the claim's own ladder
 *  makes, so a balance known to cover pays whatever the other read did — or null while unpriced with
 *  something held: without a price only an empty account is known. */
function heldGasSource(ceiling: bigint | null, preferPrivate: boolean): OwnGasSource | null {
	const credit = gasHeld.credit.value
	const pub = gasHeld.publicFeeJuice.value
	const publicAllowed = gasHeld.selfPay.value
	if (ceiling === null) {
		const empty = credit === 0n && pub !== null && (!publicAllowed || pub === 0n)
		return empty ? "none" : null
	}
	return decideOwnGasSource({ publicFeeJuice: pub, privateFeeJuice: credit, ceiling, preferPrivate, publicAllowed })
}
const PAYS = new Set<OwnGasSource>(["public", "private"])

/** Why the token alone cannot be chosen right now — known as soon as the gas verdict lands, whatever
 *  the choice on screen, so the card itself can be greyed out and say why. An unread balance blocks
 *  nothing here; the confirm requires it read. */
const tokenOnlyReason = computed<string | null>(() => {
	if (isExit.value) return null
	const source = heldGasSource(ownGasCeiling.value, isPrivate.value)
	if (source === null || source === "unverifiable" || PAYS.has(source)) return null
	return source === "none" ? NO_GAS_FOR_TOKEN_ONLY : SHORT_GAS_FOR_TOKEN_ONLY
})
const tokenOnlyBlocked = computed<string | null>(() => (intent.value === "token" ? tokenOnlyReason.value : null))
// A gasless account's choice moves off the token alone — at the verdict, and again whenever a new
// token resets the choice — to the one that can go through; a token that can buy no gas at all
// leaves the token choice in place, blocked and explained, since nothing else is open.
watch(
	[tokenOnlyReason, intent, routeKind],
	() => {
		const gasOpen = routeKind.value !== "no-route" && routeKind.value !== "unavailable"
		if (tokenOnlyReason.value && intent.value === "token" && gasOpen) intent.value = "token+gas"
	},
	{ immediate: true },
)

// The step's verdict decides; the parsed amount is re-read so a reset that unmounts the step (a new
// direction, a new send) cannot leave a stale "valid" standing behind it.
const amountReady = computed(() => {
	const units = amountUnits.value
	return exitBlocked.value === null && tokenOnlyBlocked.value === null && amountValid.value && units !== null && units > 0n
})

const completed = computed(() => (amountReady.value ? 2 : tokenChosen.value ? 1 : 0))

/** ---- the plan ----------------------------------------------------------------------------- */

const plan = computed<SendPlan | ExitPlan | null>(() => {
	const token = resolved.value
	const units = amountUnits.value
	if (!token || units === null || units <= 0n) return null
	if (isExit.value) {
		const recipientL1 = l1.address.value
		// No plan at all for a token the hub cannot burn: a review the user could confirm is what puts
		// a burn authwit behind a transaction that would revert.
		if (exitBlocked.value !== null || !recipientL1) return null
		// The exit always releases to the connected Ethereum account; there is no recipient field.
		return { direction: "l2-to-l1", token, amount: units, isPrivate: isPrivate.value, recipientL1 }
	}
	const gasLeg = gas.value
	return {
		direction: "l1-to-l2",
		intent: intent.value,
		token,
		amount: units,
		isPrivate: isPrivate.value,
		...(gasLeg ? { gas: gasLeg } : {}),
	}
})

/** How many Aztec transactions the gas leg covers: what the slice was sized for, or for a gas-only
 *  send (which spends the whole amount) what the quote divides into. */
/** Transactions the bought gas covers AFTER what the claim path must set aside — counted from the
 *  floor the swap is signed against, never from the sizing target: a capped slice ships less than
 *  the target, and the review must not promise what the deposit cannot deliver. */
function txCoveredOf(target: SendPlan | ExitPlan): number | null {
	if (target.direction !== "l1-to-l2" || !target.gas || !fjPerTx) return null
	// A gas-only send lands its whole floor as gas; a floor under one transaction's budget covers
	// nothing worth counting.
	const guaranteed = target.gas.minFuelOutput - (target.intent === "gas" ? 0n : mandatoryGasOf(target))
	const whole = guaranteed > 0n ? Number(guaranteed / fjPerTx) : 0
	return whole >= 1 ? whole : null
}

/** What a token send's claim path spends before any per-transaction gas: the ceilings a private
 *  claim forfeits, or the registration a public first claim pays for. */
function mandatoryGasOf(target: SendPlan): bigint {
	if (target.isPrivate) return gasShare.ceilingsFor(target.token.state) ?? 0n
	return target.token.state.kind === "registered" || !SWAP ? 0n : BigInt(SWAP.fjRegister)
}

/** The claim is the first transaction the bought gas pays for; an unregistered token's claim also
 *  registers it, which is budgeted on top. A private claim is paid through the PrivateFPC, which
 *  keeps each transaction's committed fee ceiling rather than its charge — so what leaves the gas
 *  is the ceiling, priced from live fees, and the review says so. */
function networkFeeOf(target: SendPlan | ExitPlan): { networkFee: string; networkFeeNote: string | null } {
	if (target.direction === "l2-to-l1") {
		return { networkFee: "your Aztec wallet's own fee, then Ethereum gas to finish", networkFeeNote: null }
	}
	if (!target.gas || !SWAP || !fjPerTx) return heldGasFeeOf(target)
	if (target.isPrivate) {
		const ceilings = gasShare.ceilingsFor(target.token.state)
		return {
			networkFee: ceilings === null ? "priced from network fees at claim time" : `≈ ${formatCompact(ceilings, 18)} FJ`,
			networkFeeNote: "taken from the gas that arrives - a private claim sets aside its fee ceiling, not its exact cost",
		}
	}
	const feeFj = fjPerTx + (target.token.state.kind === "registered" ? 0n : BigInt(SWAP.fjRegister))
	return { networkFee: `≈ ${formatCompact(feeFj, 18)} FJ`, networkFeeNote: "taken from the gas that arrives" }
}

/** The fee line of a claim paid from held gas. Public Fee Juice pays as the account itself, at the
 *  wallet's exact fee; the private balance pays through the fee contract, which keeps the whole
 *  ceiling it commits to — the same preference the claim's own ladder applies. */
function heldGasFeeOf(target: SendPlan): { networkFee: string; networkFeeNote: string | null } {
	const ceiling = gasShare.ownGasCeilingFor(target.token.state, target.isPrivate)
	if (ceiling !== null && heldGasSource(ceiling, target.isPrivate) === "public") {
		return {
			networkFee: `up to ≈ ${formatCompact(ceiling, 18)} FJ from the Fee Juice you already hold`,
			networkFeeNote: "paid by your account as its own fee - your wallet shows the exact fee before you confirm",
		}
	}
	return {
		networkFee:
			ceiling === null
				? "paid from the private gas you already hold on Aztec"
				: `≈ ${formatCompact(ceiling, 18)} FJ from the private gas you already hold`,
		networkFeeNote: "set aside in full from your gas at the fee contract - the claim's fee ceiling, not its exact cost",
	}
}

/** Freeze the plan AND everything stated about it in one object: a review whose account or fee line
 *  can move independently of the plan is the same hazard in a smaller place. */
function freezeReview(target: SendPlan | ExitPlan): ReviewSnapshot {
	const gasLeg = target.direction === "l1-to-l2" ? target.gas : undefined
	const txCovered = txCoveredOf(target)
	return {
		plan: target,
		account: target.direction === "l2-to-l1" ? target.recipientL1 : (bridge.selectedAccount.value ?? ""),
		slippageBps: gasLeg && SWAP ? SWAP.slippageBps : null,
		estimate: {
			takes: target.direction === "l2-to-l1" ? EXIT_TAKES : DEPOSIT_TAKES,
			...networkFeeOf(target),
			txCovered,
		},
		ownGasCeiling:
			target.direction === "l1-to-l2" && target.intent === "token"
				? gasShare.ownGasCeilingFor(target.token.state, target.isPrivate)
				: null,
	}
}

/** The promise the receipt replays back to the user. */
function promisedLine(target: SendPlan | ExitPlan): string {
	const token = `${toDecimalString(target.amount, target.token.decimals)} ${safeDisplay(target.token.symbol)}`
	const gasLeg = target.direction === "l1-to-l2" ? target.gas : undefined
	if (!gasLeg) return token
	// The quote, as the review showed it — not the sizing target, which a gas-only send outgrows.
	const gas = `≈ ${formatCompact(gasLeg.quote, 18)} FJ gas`
	return target.direction === "l1-to-l2" && target.intent === "gas" ? `${gas} from ${token}` : `${token} + ${gas}`
}

/** ---- selection --------------------------------------------------------------------------- */

async function reselect(token: SelectableToken, dir: Direction): Promise<void> {
	await selection.select(token, dir)
	await ensureExitGrant()
}

/** An exit spends an authwit against the token, so its grant is raised at SELECTION: a refusal then
 *  costs nothing, where a refusal mid-flow would land after the burn was already authorised. */
async function ensureExitGrant(): Promise<void> {
	const token = selection.selected.value
	if (direction.value !== "l2-to-l1" || !token) return
	if (grant.isGranted(token.l2Token)) {
		grantState.value = "idle"
		return
	}
	grantState.value = "pending"
	const outcome = await grant.ensureGranted(token, selection.epoch)
	// A superseded selection's approval describes a token the user is no longer looking at.
	if (outcome === "stale") return
	grantState.value = outcome === "granted" ? "idle" : outcome
}

function resetAmount(): void {
	amount.value = ""
	intent.value = "token"
	grantState.value = "idle"
}

/** Picking a row is the whole token step: the wizard moves to the amount at once and reads the
 *  token behind it; a read that fails brings the user back to the row with the reason. */
async function onSelect(token: SelectableToken): Promise<void> {
	resetAmount()
	addError.value = null
	picked.value = token
	if (token.decimals >= 0) goToStep(1)
	await reselect(token, direction.value)
}

watch(
	() => selection.error.value,
	(failure) => {
		if (failure) goToStep(0)
	},
)

/** The looked-up token joins the list under the identity the lookup read, and the search clears so
 *  the new row is what the user sees selected. */
async function onAdd(address: string): Promise<void> {
	addError.value = null
	const seen = lookup.state.value
	const identity = seen?.status === "found" && seen.address === address ? seen.identity : undefined
	try {
		const token = catalog.addPasted(address, identity)
		catalog.search.value = ""
		await onSelect(token)
	} catch (e) {
		addError.value = e instanceof Error ? e.message : "That address could not be added."
	}
}

function onMinted(): void {
	void selection.refreshBalances()
	void rowBalances.refresh()
}

function onDirection(next: Direction): void {
	direction.value = next
	goToStep(0)
	resetAmount()
	const token = selection.selected.value
	// Re-resolve rather than clear: the same token has a different balance column on the other side.
	if (token) void reselect(token, next)
}

/** ---- chain reads the review depends on ---------------------------------------------------- */

// A clone the factory does not hold yet, a clone at the derived address, and a clone at some OTHER
// address are three different facts, and only the first is "this send creates it". A read that never
// came back is a fourth: unknown, never reported as either.
function portalStateOf(onChain: string, derived: string): "verified" | "absent" | "mismatch" {
	const actual = onChain.toLowerCase()
	if (/^0x0+$/.test(actual)) return "absent"
	return actual === derived.toLowerCase() ? "verified" : "mismatch"
}

async function verifyPortal(): Promise<void> {
	portalVerified.value = "unknown"
	const token = resolved.value
	const gen = SEND_GENERATION
	if (!token || !gen) return
	const mine = selection.epoch()
	try {
		const onChain = (await l1.publicClient.readContract({
			address: gen.factory,
			abi: PORTAL_FACTORY_ABI,
			functionName: "portalOf",
			args: [token.address],
		})) as Address
		if (selection.epoch() === mine) {
			portalVerified.value = portalStateOf(onChain, predictPortal(gen.factory, gen.implementation, token.address))
		}
	} catch (e) {
		console.error(e instanceof Error ? e : new Error("portal verification failed"))
	}
}

function quoteRoute(): void {
	const token = resolved.value
	if (step.value !== 1 || isExit.value || !token) return
	void routeQuote.quote(token.address, probeAmountOf(token))
}

/** ---- the frozen review -------------------------------------------------------------------- */

function enterReview(): void {
	const target = plan.value
	if (!amountReady.value || !target) return
	reviewed.value = freezeReview(target)
	reviewStale.value = false
	step.value = 2
}

function goToStep(index: 0 | 1 | 2): void {
	if (index === 2) {
		enterReview()
		return
	}
	reviewed.value = null
	reviewStale.value = false
	step.value = index
}

/** A change under the frozen review: the snapshot no longer describes what a confirm would send, so
 *  the wizard stands the review down and says why instead of signing a plan nobody read. The one
 *  review that must NOT move is the one being signed; a review built while a backgrounded send is
 *  still running is a different review and moves like any other. */
function invalidateReview(why?: string): void {
	const signingThisReview = submitting.value && backgroundedId.value === null
	if (step.value !== 2 || stage.value !== "wizard" || signingThisReview) return
	reviewed.value = null
	step.value = 1
	reviewStale.value = true
	reviewStaleWhy.value = why ?? null
}

watch(resolved, () => void verifyPortal())
watch([step, resolved, direction], quoteRoute)
// The gas the account holds decides whether a token-only send may go: re-read on the way into the
// amount step, and a verdict that lands after the review was frozen stands it down like any change.
watch(step, (index) => {
	if (index === 1) void gasHeld.refresh()
})
watch(
	[
		resolved,
		amount,
		intent,
		isPrivate,
		// The gas leg's INPUTS, not the leg itself: a private slice re-prices with every fee tick,
		// which is not a change the user made — the confirm re-reads the fees and stands the review
		// down itself when the frozen slice no longer covers them.
		routeOutcome,
		gasShare.txTarget,
		tokenOnlyBlocked,
		() => bridge.selectedAccount.value,
		() => l1.address.value,
		() => l1.chainId.value,
	],
	() => invalidateReview(),
)
// The grant window closes the moment the send starts signing: from there the prompt is the wallet's.
watch(
	() => sendFlow.busy.value,
	(flowBusy) => {
		if (flowBusy && grantState.value === "pending") grantState.value = "idle"
	},
)

/** ---- submit + the takeover ---------------------------------------------------------------- */

function adopt(id: string): void {
	if (ownedId.value && ownedId.value !== id) journal.releaseForeground(ownedId.value)
	ownedId.value = id
	journal.claimForeground(id)
	permitRecord.value = null
	stage.value = "stepper"
}

/**
 * The send lane resolves only once the whole bridge is done, so the stepper takes over as soon as
 * the run's own record appears. "Its own" is decided by provenance, never by recency: the record
 * must be one THIS tab's engine created (`isSessionLive`) and must not have existed before the
 * submit. A second tab writing a record mid-send is not this wizard's transfer, and adopting it
 * would put its receipt — and this review's promise — on someone else's send.
 */
function adoptRunRecord(): void {
	if (!submitting.value || ownedId.value || (stage.value !== "wizard" && stage.value !== "permit")) return
	const mine = journal.records.value.find((r) => isSendRecord(r) && !preSubmitIds.has(r.id) && journal.isSessionLive(r.id))
	if (mine && mine.id !== backgroundedCanonical.value) adopt(mine.id)
}
watch(journal.records, adoptRunRecord)

/**
 * The gas gate is re-read at CONFIRM, not trusted from when the amount step opened: gas spent
 * elsewhere meanwhile would strand the deposit at its claim. The read holds the buttons but leaves
 * the review live, so an account or chain that moves under it stands it down as usual; only a
 * review still standing when the read returns goes on to sign.
 */
async function preflight(snapshot: ReviewSnapshot): Promise<boolean> {
	const target = snapshot.plan
	if (target.direction !== "l1-to-l2") return true
	const privateSlice = target.isPrivate && target.intent === "token+gas" ? (target.gas ?? null) : null
	if (target.intent !== "token" && !privateSlice) return true
	const repriced = await preflightReads(target.intent === "token", privateSlice !== null)
	// The SNAPSHOT must be the one still on screen — not merely its plan, which the wizard caches
	// across an account switch, so a review re-entered under another account would carry the same
	// plan object and let a confirm nobody gave for it resume.
	if (reviewed.value !== snapshot || step.value !== 2) return false
	if (snapshot.account !== (bridge.selectedAccount.value ?? "")) return false
	const why = preflightStandDown(target, privateSlice, repriced, snapshot.ownGasCeiling)
	if (why === undefined) return true
	invalidateReview(why ?? undefined)
	return false
}

/** The confirm's re-reads, under the preflighting hold: a token-only claim needs the gas it will
 *  pay with to be held and priced, a private slice needs the fees it was priced at to still hold —
 *  neither is trusted from the review. Returns whether the fees were re-read. */
async function preflightReads(tokenOnly: boolean, privateSlice: boolean): Promise<boolean> {
	preflighting.value = true
	try {
		if (tokenOnly) await gasHeld.refresh()
		return privateSlice || tokenOnly ? await gasShare.prime() : true
	} finally {
		preflighting.value = false
	}
}

/** Why the confirm stands the review down: `undefined` = it may proceed, `null` = the generic
 *  line, a string = the named reason. */
function preflightStandDown(
	target: SendPlan,
	privateSlice: GasLegPlan | null,
	repriced: boolean,
	shownCeiling: bigint | null,
): string | null | undefined {
	if (tokenOnlyBlocked.value !== null) return null
	if (target.intent === "token") return tokenOnlyStoodDown(target, repriced, shownCeiling)
	if (!privateSlice) return undefined
	return privateSliceStoodDown(target.token.state, privateSlice.minFuelOutput, repriced) ?? undefined
}

/** Why a token-only send cannot be signed at confirm: the gas it will claim with must be KNOWN to
 *  cover what the claim sets aside at fees re-read now — an unread balance or an unpriced claim is
 *  not one to fund an irreversible deposit on — and what is set aside must be what the review
 *  showed: a figure that only appeared, or grew, after the review opened was never approved. */
function tokenOnlyStoodDown(target: SendPlan, repriced: boolean, shown: bigint | null): string | undefined {
	if (!repriced) return UNPRICED_TOKEN_ONLY
	const ceiling = gasShare.ownGasCeilingFor(target.token.state, target.isPrivate)
	if (ceiling === null) return SHORT_GAS_FOR_TOKEN_ONLY
	const source = heldGasSource(ceiling, target.isPrivate)
	if (source === null || source === "unverifiable") return UNREAD_GAS_FOR_TOKEN_ONLY
	if (!PAYS.has(source)) return SHORT_GAS_FOR_TOKEN_ONLY
	if (shown === null) return CEILING_NOW_PRICED_TOKEN_ONLY
	return ceiling > shown + shown / CEILING_DRIFT_DIVISOR ? CEILING_MOVED_TOKEN_ONLY : undefined
}

/** Why a private slice cannot be signed at confirm: the fees could not be re-read (a price nobody
 *  could refresh is not one to fund an irreversible deposit on), or they moved and the slice no
 *  longer covers the ceilings. */
function privateSliceStoodDown(state: TokenState, minFuelOutput: bigint, repriced: boolean): string | null {
	if (!repriced) return "Aztec's network fees could not be re-read just now, so the gas slice was not confirmed. Try again in a moment."
	const short = privateSliceShortfall(state, minFuelOutput)
	return short === null
		? null
		: "Aztec's network fees moved while you were on the review: the gas slice no longer covers what a private claim sets aside."
}

async function onConfirm(): Promise<void> {
	const snapshot = reviewed.value
	const target = snapshot?.plan
	if (!snapshot || !target || submitting.value || preflighting.value || stage.value !== "wizard") return
	if (!(await preflight(snapshot))) return
	submitting.value = true
	backgroundedId.value = null
	backgroundedLine.value = null
	preSubmitIds = new Set(journal.records.value.map((r) => r.id))
	reviewSaid.value = promisedLine(target)
	try {
		await (target.direction === "l2-to-l1" ? runExit(target) : runSend(target))
	} finally {
		submitting.value = false
	}
}

/** The record the permission phase is rendered from: the plan, filed the way the send will file it,
 *  under a provisional id so nothing offers to back it up. The id is fresh per prompt: the rail's
 *  phase clock is keyed on it, and a reused id would show the previous prompt's elapsed time. */
function permitRecordOf(target: SendPlan): SendDepositRecord {
	const now = Date.now()
	const base = {
		schema: 3 as const,
		id: `dep-pending-permit-${now.toString(36)}`,
		direction: "deposit" as const,
		isPrivate: target.isPrivate,
		amount: (target.amount - (target.gas?.fuelAmount ?? 0n)).toString(),
		createdAt: now,
		updatedAt: now,
		chainId: catalog.chainId,
		portal: target.token.portal.toLowerCase(),
		bridge: HUB?.toString() ?? "",
		recipient: bridge.selectedAccount.value ?? "",
		secretHashHex: "",
		...(target.token.state.kind !== "registered" ? { registers: true as const } : {}),
	}
	return { ...base, intent: target.intent === "gas" ? "token" : target.intent, token: previewBlock(target) } as SendDepositRecord
}

async function runSend(target: SendPlan): Promise<void> {
	// The grant is raised inside the send, BEFORE anything is signed; while it is open the stepper
	// shows it as the run's first phase.
	const asking = target.intent !== "gas" && !grant.isGranted(target.token.l2Token)
	grantState.value = asking ? "pending" : "idle"
	if (asking) {
		permitRecord.value = permitRecordOf(target)
		stage.value = "permit"
	}
	let id = ""
	try {
		id = await sendFlow.send(target)
	} finally {
		// A lane that threw before filing a record (a grant that errored rather than declined) must not
		// leave the permission screen up with nothing behind it.
		if (stage.value === "permit") {
			stage.value = "wizard"
			permitRecord.value = null
		}
	}
	if (id) {
		// The run NAMES its record; that id wins over whatever the takeover adopted provisionally.
		// Unless the user sent it to the background meanwhile: the lane resolves only once the whole
		// bridge is done, and re-adopting then would drag the finished send back over a new one.
		if (ownedId.value !== id && backgroundedCanonical.value !== id) adopt(id)
		return
	}
	// Nothing was sent. A grant that never landed is the reason worth naming on the review.
	grantState.value = grant.isGranted(target.token.l2Token) ? "idle" : "declined"
}

async function runExit(target: ExitPlan): Promise<void> {
	const id = await exitFlow.exit(target)
	if (id && ownedId.value !== id && backgroundedCanonical.value !== id) adopt(id)
}

/** ---- stepper → receipt -------------------------------------------------------------------- */

function snapshotOf(rec: SendJournalRecord): ReceiptSnapshot {
	const token = recordTokenBlock(rec)
	const base = {
		amount: rec.amount,
		isPrivate: rec.isPrivate,
		startedAt: rec.createdAt,
		completedAt: rec.completedAt,
		token,
		reviewSaid: reviewSaid.value ?? undefined,
	}
	if (rec.direction === "withdraw") {
		return { ...base, direction: "withdraw", l1TxHash: rec.consumeTxHash, l2TxHash: rec.exitTxHash }
	}
	return {
		...base,
		direction: "deposit",
		assetKind: assetKindOf(rec),
		l1TxHash: rec.depositTxHash,
		l2TxHash: rec.claimTxHash,
		fuelReceived: rec.fuel?.received,
		addTokenLabel: token ? `ADD ${safeDisplay(token.displaySymbol)} TO WALLET` : undefined,
	}
}

// The stepper→receipt transition keys off the RECORD's completion (never the flow promise — the
// engine detaches receipt rounds), snapshotting everything the receipt shows.
watch(
	() => ownedRecord.value?.completedAt,
	(done) => {
		const rec = ownedRecord.value
		if (!done || stage.value !== "stepper" || !rec || !isSendRecord(rec)) return
		receiptSnapshot.value = snapshotOf(rec)
		receiptL2Token.value = rec.direction === "deposit" ? (rec.token?.l2Token ?? null) : null
		stage.value = "receipt"
		// Release the takeover so the finished record surfaces in the journal list; the receipt renders
		// from the snapshot, so it survives the release.
		journal.releaseForeground(rec.id)
	},
)

// Fail-open guard on the OWNED record: a vanished record (cross-tab discard, rejection cleanup) or a
// foreground another surface took stands the wizard down. A provisional→exit rekey re-points
// ownership engine-side, so a vanished record whose replacement is OURS is re-adopted instead.
watch(
	() => {
		if (stage.value !== "stepper") return false
		const rec = ownedRecord.value
		if (rec === undefined) return true
		return activeId.value !== ownedId.value && !rec.completedAt
	},
	(broken) => {
		if (!broken) return
		if (ownedRecord.value === undefined) {
			const adoptable = activeRecord.value
			if (adoptable && isSendRecord(adoptable)) {
				ownedId.value = adoptable.id
				return
			}
			if (ownedId.value) journal.releaseForeground(ownedId.value)
		}
		ownedId.value = null
		stage.value = "wizard"
	},
)

function standDown(): void {
	if (ownedId.value) journal.releaseForeground(ownedId.value)
	ownedId.value = null
	sendFlow.error.value = null
	exitFlow.error.value = null
	stage.value = "wizard"
}

function onGoto(index: number): void {
	// The strip only offers reachable steps, so an index it emits is one the wizard already cleared.
	if (index === 0 || index === 1 || index === 2) goToStep(index)
}

function onNewSend(): void {
	receiptSnapshot.value = null
	receiptL2Token.value = null
	reviewSaid.value = null
	resetAmount()
	gasShare.reset()
	goToStep(0)
	standDown()
	// The send that just ran may have registered the token: its state, binding and balances are
	// re-read rather than carried over, so the next send is priced and worded for what it now is.
	const token = picked.value
	if (token) void reselect(token, direction.value)
	void rowBalances.refresh()
	void gasHeld.refresh()
}

/** RUN IN BACKGROUND: the send keeps running in the journal; the wizard starts over from the token
 *  step, with one line above it that follows the send until it lands. */
function onBackground(): void {
	backgroundedId.value = ownedId.value
	backgroundedLine.value = reviewSaid.value
	// The run is still in flight: neither its record's next write nor its lane resolving may take
	// the wizard over again (see `adoptRunRecord` / `runSend`).
	if (ownedId.value) preSubmitIds.add(ownedId.value)
	onNewSend()
}

const backgrounded = computed(() => {
	const id = backgroundedCanonical.value
	const rec = id ? journal.records.value.find((r) => r.id === id) : undefined
	return rec && !rec.completedAt ? rec : undefined
})

// A backgrounded send may register the token while the user prepares the next one from it: once
// it lands, the token is re-resolved, which also stands down a review priced for a first send.
watch(
	() => {
		const id = backgroundedCanonical.value
		return id ? journal.records.value.find((r) => r.id === id)?.completedAt : undefined
	},
	(done) => {
		if (done && picked.value) void reselect(picked.value, direction.value)
	},
)

// The subject is what the review promised, never the record's own amount: a gas-only record files
// the token amount it swapped, which is not a Fee Juice figure.
const backgroundLine = computed(() => {
	const rec = backgrounded.value
	if (!rec) return null
	const subject = backgroundedLine.value ?? "Your send"
	const active = stepperPhases(rec, journal.runtime.value[rec.id] ?? {}).find((p) => p.state === "active" || p.state === "failed")
	if (!active) return `${subject} is on its way.`
	const eta = active.eta ? ` · ${active.eta}` : ""
	return active.state === "failed"
		? `${subject} needs your attention — see Activity.`
		: `${subject} is on its way — ${active.label.toLowerCase()}${eta}`
})

/** A provisional record can be rekeyed before Activity opens: hand over the canonical id. */
function showActivity(): void {
	shell.openActivity(backgroundedCanonical.value ?? backgroundedId.value ?? undefined)
}

async function onAddToken(): Promise<void> {
	const wallet = bridge.wallet.value
	const account = bridge.selectedAccount.value
	const l2Token = receiptL2Token.value
	if (!wallet || !account || !l2Token) return
	await addToken.addToken(wallet, account, AztecAddress.fromStringUnsafe(l2Token))
	const final = addToken.status.value
	if (final.kind === "ok") pushToast({ kind: "ok", text: "Token added to your Aztec wallet." })
	else if (final.kind === "error") pushToast({ kind: "error", text: final.error.message })
	else if (final.kind === "unsupported") pushToast({ kind: "error", text: "Your wallet cannot add tokens yet. Update Nulo and reload." })
}

void catalog.refresh()

// Reverse of construction: the flows read the selection's epoch and the selection reads the catalog,
// so each is stood down before the thing it depends on stops answering.
onBeforeUnmount(() => {
	exitFlow.dispose()
	sendFlow.dispose()
	gasShare.dispose()
	routeQuote.dispose()
	gasHeld.dispose()
	grant.dispose()
	selection.dispose()
	rowBalances.dispose()
	lookup.dispose()
	catalog.dispose()
})
</script>

<template>
	<BridgeStepper v-if="stage === 'permit' && permitRecord" :record="permitRecord" :runtime="PERMIT_RUNTIME" :can-background="false" />
	<BridgeStepper
		v-else-if="stage === 'stepper' && ownedRecord"
		:record="ownedRecord"
		@background="onBackground"
		@backup="backup.exportBridgeWithToast"
	/>
	<BridgeReceipt
		v-else-if="stage === 'receipt' && receiptSnapshot"
		:snapshot="receiptSnapshot"
		cta-label="NEW SEND"
		:add-token-busy="addToken.status.value.kind === 'submitting'"
		@new-bridge="onNewSend"
		@add-token="onAddToken"
	/>
	<div v-else class="host">
	<div v-if="backgroundLine" class="strip" role="status" :data-testid="TESTIDS.sendBackgroundStrip">
		<span class="dot" aria-hidden="true" />
		<span class="strip-text">{{ backgroundLine }}</span>
		<button type="button" class="strip-link" :data-testid="TESTIDS.sendBackgroundActivity" @click="showActivity">Activity</button>
	</div>
	<WizardShell
		:direction="direction"
		:step="step"
		:completed="completed"
		:can-switch-direction="!busy"
		:token-label="tokenLabel"
		:amount-label="amountLabel"
		@update:direction="onDirection"
		@goto="onGoto"
	>
		<template #token>
			<!-- Renders only when the manifest publishes permissionless-mint tokens, so never on mainnet. -->
			<MintStrip v-if="!isExit" @minted="onMinted" />
			<TokenStep
				:direction="direction"
				:tokens="catalog.filtered.value"
				:search="catalog.search.value"
				:loading="catalog.loading.value"
				:catalog-error="catalog.error.value"
				:lookup="lookup.state.value"
				:add-error="addError"
				:selected="picked"
				:selection-error="selection.error.value"
				:row-balances="rowBalances.balances.value"
				@update:search="catalog.search.value = $event"
				@select="onSelect"
				@add="onAdd"
			/>
		</template>
		<template #amount>
			<p v-if="reviewStale" class="stale" aria-live="polite" :data-testid="TESTIDS.sendReviewStale">
				{{ reviewStaleWhy ?? "Something changed while you were on the review, so it was stood down." }} Check the amount and review again.
			</p>
			<AmountStep
				v-if="amountToken"
				:direction="direction"
				:token="amountToken"
				:resolving="selection.loading.value"
				:balances="selection.balances.value"
				:intent="intent"
				:amount="amount"
				:is-private="isPrivate"
				:gas="gas"
				:route-kind="routeKind"
				:route-loading="routeQuote.loading.value"
				:tx-target="gasShare.txTarget.value"
				:fj-per-tx="fjPerTx"
				:gas-error="gasError"
				:blocked-reason="exitBlocked"
				:token-only-blocked="tokenOnlyReason"
				@update:valid="amountValid = $event"
				@update:intent="intent = $event"
				@update:amount="amount = $event"
				@update:is-private="isPrivate = $event"
				@update:tx-target="gasShare.txTarget.value = $event"
				@back="goToStep(0)"
				@next="enterReview()"
			/>
		</template>
		<template #review>
			<ReviewStep
				v-if="reviewed"
				:plan="reviewed.plan"
				:portal-verified="portalVerified"
				:account="reviewed.account"
				:signature-validity-seconds="Number(PERMIT_DEADLINE_SECONDS)"
				:slippage-bps="reviewed.slippageBps"
				:estimate="reviewed.estimate"
				:grant="grantState"
				:busy="busy"
				:error="flowError"
				:paused="exitFlow.paused.value"
				@back="goToStep(1)"
				@confirm="onConfirm"
			/>
		</template>
	</WizardShell>
	</div>
</template>

<style scoped>
.host {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.strip {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 14px;
	border: 1px solid var(--nulo-outline);
	background: var(--card-bg);
}

.dot {
	flex: none;
	width: 8px;
	height: 8px;
	background: var(--mint);
}

.strip-text {
	font: 500 12px/1.4 var(--font-mono);
	color: var(--txt-primary);
}

.strip-link {
	margin-left: auto;
	padding: 0;
	background: transparent;
	border: none;
	color: var(--nulo-accent);
	font: 500 12px/1.4 var(--font-mono);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.stale {
	margin: 0 0 12px;
	padding: 8px 10px;
	border: 1px dashed var(--nulo-outline);
	font: 500 12px/1.5 var(--font-mono);
	color: var(--yellow);
}
</style>
