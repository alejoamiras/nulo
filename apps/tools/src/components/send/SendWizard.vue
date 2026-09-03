<script setup lang="ts">
/** Services */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract } from "@aztec/aztec.js/contracts"
import {
	type RouteOutcome,
	type SendJournalRecord,
	PERMIT_DEADLINE_SECONDS,
	PORTAL_FACTORY_ABI,
	assetKindOf,
	isSendRecord,
	predictPortal,
} from "@nulo/bridge-core"
import type { Address, PublicClient } from "viem"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { HUB_TOKEN_ARTIFACT, SEND_GENERATION, SWAP } from "@/contracts/bridge-generation"
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
import { useAddressLookup } from "@/composables/useAddressLookup"
import { useBridgeBackup } from "@/composables/useBridgeBackup"
import { useBridgeJournal } from "@/composables/useBridgeJournal"
import { useBridgeWallet } from "@/composables/useBridgeWallet"
import { useAddDripToken } from "@/composables/useAddDripToken"
import { useGasHeld } from "@/composables/useGasHeld"
import { useGasShare } from "@/composables/useGasShare"
import { EXIT_TOKEN_NOT_REGISTERED, useHubExit } from "@/composables/useHubExit"
import { useL1Wallet } from "@/composables/useL1Wallet"
import { useRouteQuote } from "@/composables/useRouteQuote"
import { useRowBalances } from "@/composables/useRowBalances"
import { useSend } from "@/composables/useSend"
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
import type { Direction, ExitPlan, GasLegPlan, ResolvedToken, SelectableToken, SendIntent, SendPlan } from "@/lib/send-model"

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
	"Your Aztec account holds no gas (Fee Juice) yet, so the token could not be claimed. Choose Token + gas to arrive with some."

const l1 = useL1Wallet()
const bridge = useBridgeWallet()
const journal = useBridgeJournal()
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
// whole send and would make RUN IN BACKGROUND a no-op.
const stage = ref<"wizard" | "stepper" | "receipt">("wizard")
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
}
const reviewed = ref<ReviewSnapshot | null>(null)
/** Set when a change under the frozen review sent the user back to the amount step. */
const reviewStale = ref(false)

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
const tokenLabel = computed(() => (resolved.value ? safeDisplay(resolved.value.symbol) : undefined))

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
	const share = gasShare.propose({ amount: units, decimals: token.decimals, state: token.state, rate })
	if (!share) return { plan: null, error: "This network has no swap venue, so a send cannot buy gas." }
	// Gas-only spends the whole amount; the router refuses any other split.
	const fuelAmount = intent.value === "gas" ? units : share.fuelAmount
	if (intent.value === "token+gas" && fuelAmount >= units) {
		return { plan: null, error: "The amount is too small to buy gas and still send a token." }
	}
	const quote = outcome.kind === "route" ? (fuelAmount * outcome.quoteOut) / probeIn : fuelAmount
	const route = outcome.kind === "route" ? outcome.route : NO_SWAP
	return {
		plan: { fuelAmount, fuelFj: share.fuelFj, quote, minFuelOutput: floorFor(quote, outcome), route, capped: share.capped },
		error: null,
	}
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
const gasError = computed(() => gasResult.value.error ?? routeQuote.error.value)

/** ---- step gating -------------------------------------------------------------------------- */

const tokenChosen = computed(() => resolved.value !== null)

/** An exit burns through the HUB's binding for the token. A portal on Ethereum is not that binding —
 *  the registration message may exist and never have been consumed — and without it there is no L2
 *  balance to spend, no ceiling to check the amount against, and no burn the hub could authorize. */
const exitBlocked = computed<string | null>(() => {
	const token = resolved.value
	return isExit.value && token && token.state.kind !== "registered" ? EXIT_TOKEN_NOT_REGISTERED : null
})

/** A deposit that buys no gas is claimed with gas the account already holds — known to be none. */
const tokenOnlyBlocked = computed<string | null>(() =>
	!isExit.value && intent.value === "token" && gasHeld.held.value === false ? NO_GAS_FOR_TOKEN_ONLY : null,
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
function txCoveredOf(target: SendPlan | ExitPlan): number | null {
	if (target.direction !== "l1-to-l2" || !target.gas || !fjPerTx) return null
	if (target.intent !== "gas") return gasShare.txTarget.value
	// A quote under one transaction's budget covers nothing worth counting.
	const whole = Number(target.gas.quote / fjPerTx)
	return whole >= 1 ? whole : null
}

/** The claim is the first transaction the bought gas pays for; an unregistered token's claim also
 *  registers it, which is budgeted on top. */
function networkFeeOf(target: SendPlan | ExitPlan, txCovered: number | null): string {
	if (target.direction === "l2-to-l1") return "your Aztec wallet's own fee, then Ethereum gas to finish"
	if (!target.gas || !SWAP || !fjPerTx) return "paid from the gas you already hold on Aztec"
	const feeFj = fjPerTx + (target.token.state.kind === "registered" ? 0n : BigInt(SWAP.fjRegister))
	const ofThose = txCovered === null ? "" : ` — the first of those ${txCovered}, paid from that gas`
	return `≈ ${formatCompact(feeFj, 18)} FJ${ofThose}`
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
			networkFee: networkFeeOf(target, txCovered),
			txCovered,
		},
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

async function onSelect(token: SelectableToken): Promise<void> {
	resetAmount()
	addError.value = null
	picked.value = token
	await reselect(token, direction.value)
}

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
function invalidateReview(): void {
	const signingThisReview = submitting.value && backgroundedId.value === null
	if (step.value !== 2 || stage.value !== "wizard" || signingThisReview) return
	reviewed.value = null
	step.value = 1
	reviewStale.value = true
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
		gas,
		tokenOnlyBlocked,
		() => bridge.selectedAccount.value,
		() => l1.address.value,
		() => l1.chainId.value,
	],
	invalidateReview,
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
	if (!submitting.value || ownedId.value || stage.value !== "wizard") return
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
async function preflight(target: SendPlan | ExitPlan): Promise<boolean> {
	if (target.direction !== "l1-to-l2" || target.intent !== "token") return true
	preflighting.value = true
	try {
		await gasHeld.refresh()
	} finally {
		preflighting.value = false
	}
	if (reviewed.value?.plan !== target || step.value !== 2) return false
	if (tokenOnlyBlocked.value !== null) {
		invalidateReview()
		return false
	}
	return true
}

async function onConfirm(): Promise<void> {
	const target = reviewed.value?.plan
	if (!target || submitting.value || preflighting.value || stage.value !== "wizard") return
	if (!(await preflight(target))) return
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

async function runSend(target: SendPlan): Promise<void> {
	// The grant is raised inside the send, BEFORE anything is signed; surface it while it is open.
	grantState.value = grant.isGranted(target.token.l2Token) ? "idle" : "pending"
	const id = await sendFlow.send(target)
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
		addTokenLabel: token ? `ADD ${token.displaySymbol} TO WALLET` : undefined,
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

function showActivity(): void {
	document.querySelector<HTMLElement>(`[data-testid="${TESTIDS.journal}"]`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })
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
	<BridgeStepper
		v-if="stage === 'stepper' && ownedRecord"
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
				:resolved="resolved"
				:resolving="selection.loading.value"
				:selection-error="selection.error.value"
				:balances="selection.balances.value"
				:row-balances="rowBalances.balances.value"
				@update:search="catalog.search.value = $event"
				@select="onSelect"
				@add="onAdd"
				@next="step = 1"
			/>
		</template>
		<template #amount>
			<p v-if="reviewStale" class="stale" aria-live="polite" :data-testid="TESTIDS.sendReviewStale">
				Something changed while you were on the review, so it was stood down. Check the amount and review again.
			</p>
			<AmountStep
				v-if="resolved"
				:direction="direction"
				:token="resolved"
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
				:token-only-blocked="tokenOnlyBlocked"
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
