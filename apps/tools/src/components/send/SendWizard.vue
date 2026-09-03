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
	hubAt,
	isSendRecord,
	predictPortal,
} from "@nulo/bridge-core"
import type { Address, PublicClient } from "viem"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { HUB, HUB_TOKEN_ARTIFACT, SEND_GENERATION, SWAP } from "@/contracts/bridge-generation"

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
import { formatBigInt, formatCompact, parseAmountStrict, toDecimalString } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"
import type { Direction, ExitPlan, GasLegPlan, ResolvedToken, SelectableToken, SendIntent, SendPlan } from "@/lib/send-model"

/** The rail's own etas, summed and rounded UP — the review must never undersell how long this takes. */
const DEPOSIT_TAKES = "usually 3–8 min end to end"
const EXIT_TAKES = "tens of minutes — Aztec proves exits in epoch batches"
/** The fee asset needs no swap, so its gas leg carries no pools at all. */
const NO_SWAP = { path: [], zeroForOnes: [] }
const ONE_TO_ONE = { probeIn: 1n, probeOut: 1n }
/** What one Aztec transaction is budgeted at on this network; null where nothing can buy gas. */
const fjPerTx = SWAP ? BigInt(SWAP.fjPerTx) : null

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
	tokens: () => catalog.tokens.value,
})
const selection = useTokenSelection({
	pub: () => l1.publicClient as unknown as PublicClient,
	l1Account: () => l1.address.value ?? undefined,
	hub: () => (bridge.wallet.value && HUB ? hubAt(bridge.wallet.value as never, HUB.toString()) : undefined),
	l2Account: () => bridge.selectedAccount.value ?? undefined,
	tokenContract: async (l2Token) => {
		const wallet = bridge.wallet.value
		if (!wallet) return undefined
		return Contract.at(AztecAddress.fromStringUnsafe(l2Token), HUB_TOKEN_ARTIFACT, wallet as never)
	},
})
const grant = useTokenGrant()
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
const reviewSaid = ref<string | null>(null)
const submitting = ref(false)
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

const busy = computed(() => submitting.value || sendFlow.busy.value || exitFlow.busy.value)
const flowError = computed(() => sendFlow.error.value ?? exitFlow.error.value)

/** ---- amount ------------------------------------------------------------------------------- */

const amountUnits = computed(() => (resolved.value ? parseAmountStrict(amount.value, resolved.value.decimals) : null))

/** What the step strip shows for the amount once the user has moved past it. */
const amountLabel = computed(() => {
	const token = resolved.value
	const units = amountUnits.value
	return token && units !== null && units > 0n ? `${toDecimalString(units, token.decimals)} ${token.symbol}` : undefined
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

// The step's verdict decides; the parsed amount is re-read so a reset that unmounts the step (a new
// direction, a new send) cannot leave a stale "valid" standing behind it.
const amountReady = computed(() => {
	const units = amountUnits.value
	return exitBlocked.value === null && amountValid.value && units !== null && units > 0n
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
	return target.intent === "gas" ? Number(target.gas.quote / fjPerTx) : gasShare.txTarget.value
}

/** The claim is the first transaction the bought gas pays for; an unregistered token's claim also
 *  registers it, which is budgeted on top. */
function networkFeeOf(target: SendPlan | ExitPlan, txCovered: number | null): string {
	if (target.direction === "l2-to-l1") return "your Aztec wallet's own fee, then Ethereum gas to finish"
	if (!target.gas || !SWAP || !fjPerTx) return "paid by the sponsor"
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
	const token = `${toDecimalString(target.amount, target.token.decimals)} ${target.token.symbol}`
	const gasLeg = target.direction === "l1-to-l2" ? target.gas : undefined
	return gasLeg ? `${token} + ≈ ${formatBigInt(gasLeg.fuelFj, 18)} FJ gas` : token
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
 *  the wizard stands the review down and says why instead of signing a plan nobody read. */
function invalidateReview(): void {
	if (step.value !== 2 || stage.value !== "wizard" || submitting.value) return
	reviewed.value = null
	step.value = 1
	reviewStale.value = true
}

watch(resolved, () => void verifyPortal())
watch([step, resolved, direction], quoteRoute)
watch(
	[resolved, amount, intent, isPrivate, gas, () => bridge.selectedAccount.value, () => l1.address.value, () => l1.chainId.value],
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
	if (mine) adopt(mine.id)
}
watch(journal.records, adoptRunRecord)

async function onConfirm(): Promise<void> {
	const target = reviewed.value?.plan
	if (!target || submitting.value || stage.value !== "wizard") return
	submitting.value = true
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
		if (ownedId.value !== id) adopt(id)
		return
	}
	// Nothing was sent. A grant that never landed is the reason worth naming on the review.
	grantState.value = grant.isGranted(target.token.l2Token) ? "idle" : "declined"
}

async function runExit(target: ExitPlan): Promise<void> {
	const id = await exitFlow.exit(target)
	if (id && ownedId.value !== id) adopt(id)
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
	goToStep(0)
	standDown()
	void selection.refreshBalances()
	void rowBalances.refresh()
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
		@background="standDown"
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
	<WizardShell
		v-else
		:direction="direction"
		:step="step"
		:completed="completed"
		:can-switch-direction="!busy"
		:token-label="resolved?.symbol"
		:amount-label="amountLabel"
		@update:direction="onDirection"
		@goto="onGoto"
	>
		<template #token>
			<!-- Renders only when the manifest publishes permissionless-mint tokens, so never on mainnet. -->
			<MintStrip v-if="!isExit" class="mint" @minted="onMinted" />
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
</template>

<style scoped>
.mint {
	margin-bottom: 12px;
}

.stale {
	margin: 0 0 12px;
	padding: 8px 10px;
	border: 1px dashed var(--nulo-outline);
	font: 500 12px/1.5 var(--font-mono);
	color: var(--yellow);
}
</style>
