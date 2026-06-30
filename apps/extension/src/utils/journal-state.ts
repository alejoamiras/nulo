/**
 * Journal record → terminal-state display mapping (Phase 2 follow-up).
 *
 * Pure function — no Vue, no chrome.*, no service clients. Used by
 * `RecentActivityView` and the Archives page (`activity.vue`) to render
 * `TransactionTerminalCard` for journal records that ended without
 * producing an on-chain transaction.
 *
 * Why a separate util:
 *   - On-chain settled transactions get their visual state from
 *     `TransactionCard` (driven by `TransactionService` + chain status).
 *   - Journal records that terminated WITHOUT broadcasting (cancel pre-
 *     submit, SW-restart-killed, prover error, network failure pre-broadcast)
 *     have no TransactionService entry. Their terminal state is the
 *     `progress.stage === "cancelled"` or `error.kind` value carried in
 *     the journal record itself.
 *
 * 9 `JobError.kind` variants collapse into 3 user-facing visual states.
 * UX-locked by the user (2026-05-13):
 *
 *   - **Cancelled** (neutral gray, `circle-minus`)
 *       Maps from: `progress.stage === "cancelled"` OR `error.kind === "user_rejected"`.
 *       Tone: "you did this on purpose".
 *
 *   - **Interrupted** (amber, `refresh-cw`)
 *       Maps from: `error.kind ∈ { sw_restart_post_prove, stale_on_resume,
 *       stuck_proving }`. Tone: "recoverable — try again". The Phase 2
 *       reaper emits these when a SW restart leaves the prove pipeline
 *       in an unrecoverable state (no requestId to deliver the result back
 *       to in the new SW instance), or when a prove exceeds its 35-min
 *       sanity ceiling.
 *
 *   - **Failed** (red, `close-circle`)
 *       Catch-all for everything else: real failures the user can't recover
 *       from automatically (`network`, `simulation`, `prover`, `popup_bound`),
 *       plus the per-flow tags `transfer` / `dapp_execute` that
 *       `ExecutionService.normalizeError` emits as kind on uncategorized
 *       failures, plus any future / unknown kind.
 */

import { balanceFormatted } from "@/utils/amount.js"
import { formatTransferType, humanizeMethodName } from "@/utils/tx-enrichment"
import type { OperationKind, OperationRecord } from "@/wallet/services/operation-journal/spec"

/**
 * Operation kinds that render on the activity feed (both the home-surface
 * `RecentActivityView` widget and the dedicated `activity.vue` page).
 *
 * - `transfer` / `dapp_execute`: on-chain ops; in-flight cards come from
 *   the journal, settled cards come from `TransactionService`.
 * - `token_import` is intentionally absent: its in-flight + recently-failed
 *   states render in `TokensView.vue` via `TokenImportRow`, and its
 *   `succeeded` state is handed off to the regular `TokenCard` (with the
 *   `updatedAt === 0` initial-sync spinner).
 *
 * Adding a new `OperationKind` MUST update this set or fail the
 * `journal-state.test.ts` exhaustiveness pin. The failure is the signal
 * to make a deliberate "where does this kind render?" decision rather
 * than silently inheriting whichever default the next consumer assumes.
 */
export const ACTIVITY_FEED_KINDS: ReadonlySet<OperationKind> = new Set(["transfer", "dapp_execute"])

export type JournalTerminalVisualState = "cancelled" | "interrupted" | "failed"

export interface JournalTerminalDisplay {
	state: JournalTerminalVisualState
	subtitle: string
	icon: string
	color: "gray" | "amber" | "red"
}

/**
 * Canonical icon names per visual state. Centralized to prevent
 * invented-name regressions: the original v0.15.3 implementation
 * shipped `circle-minus` and `refresh-cw` (Material-Icons-style names)
 * which don't exist in `apps/extension/src/assets/icons.json` — the
 * `Icon` component silently renders empty SVG paths for missing names
 * (no console error), so the bug only surfaced during user QA.
 *
 * Every entry MUST match a key in `icons.json`. If a future state needs
 * a new icon, grep that file first.
 */
const ICONS = {
	cancelled: "cancel",
	interrupted: "refresh-circle",
	failed: "close-circle",
} as const

/**
 * Map a terminal journal record to its display shape.
 *
 * Returns `null` for non-terminal records and for successfully-completed
 * records — those are surfaced via the in-flight `TransactionAwaitingCard`
 * and the on-chain `TransactionCard` respectively, not by this mapping.
 */
export function journalTerminalDisplay(op: OperationRecord): JournalTerminalDisplay | null {
	if (op.terminalAt === null) return null

	const stage = op.progress.stage
	if (stage === "succeeded") return null

	// Cancelled: either the journal-level cancel stage, or the user-rejected
	// error kind (popup-side reject can transition to failed:user_rejected
	// instead of cancelled when it happens late in the flow).
	if (stage === "cancelled" || op.error?.kind === "user_rejected") {
		return { state: "cancelled", subtitle: "Cancelled", icon: ICONS.cancelled, color: "gray" }
	}

	// At this point stage is "failed" by elimination (FSM has no other
	// terminal-non-success state). Branch on error.kind for the user-facing
	// distinction. Defensive: if error is null somehow (FSM invariant says
	// it shouldn't be), fall through to the generic Failed.
	const kind = op.error?.kind ?? "unknown"

	if (kind === "sw_restart_post_prove" || kind === "stale_on_resume" || kind === "stuck_proving") {
		return { state: "interrupted", subtitle: "Transaction was interrupted", icon: ICONS.interrupted, color: "amber" }
	}

	// Failed branch — kind-specific subtitle where useful, generic fallback otherwise.
	const subtitle = failedSubtitleFor(kind)
	return { state: "failed", subtitle, icon: ICONS.failed, color: "red" }
}

/**
 * Render a journal-record `subtitle` (dApp-controlled at session-discover time)
 * as defensive plain text. A malicious dApp could set its origin/subtitle to
 * something that LOOKS like an http(s) URL — if we ever rendered it as an
 * anchor or even just bare text in a context the user reads top-down, it could
 * mislead. Bracket any URL-shaped value so the UI signals "not a link" at a
 * glance. Returns null on null/undefined/empty input.
 *
 * Pure helper to keep the regression pin testable without mounting Vue.
 * Consumed by `journal/[id].vue`.
 */
export function sanitizeJournalSubtitle(raw: string | undefined | null): string | null {
	if (!raw) return null
	// Match any `<scheme>:` prefix (http://, mailto:, tel:, javascript:, data:,
	// chrome-extension://, aztec://, arbitrary custom schemes). The widened
	// match (scheme + bare colon, not just scheme://) catches schemeful values
	// that aren't URL-shaped per RFC 3986 §1.1.2 but still read as actionable
	// links to a glancing user. False-positives on plain text containing colons
	// (timestamps `12:34`, versions `v1:`, CSS-like `color:red`) are accepted —
	// callers only pass dApp-controlled origin fields here, where bracketing
	// noise is safer than missing a real link-shaped value.
	// RFC 3986 scheme grammar: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ).
	if (/^[a-z][a-z0-9+.\-]*:/i.test(raw)) return `[${raw}]`
	return raw
}

/**
 * User-facing label for an error kind. Each documented `JobError.kind`
 * value maps to a short tag-style label; unknown kinds → `"Error"`.
 *
 * The journal-detail page renders this as the "Reason" row — distinct
 * from `failedSubtitleFor`'s sentence-form subtitle ("Network" vs.
 * "Network error"). Both surfaces stay consistent with the kind value
 * the reaper / executor classify against.
 *
 * `stuck_queued` IS in the whitelist — the reaper at
 * `operation-journal/reaper.ts:192` emits it on queued-record time-out.
 * Without humanization it would leak the raw kind name into the UI.
 * Codex post-impl audit H2 + opus C1.
 */
export function humanizeErrorKind(kind: string): string {
	switch (kind) {
		case "network":
			return "Network"
		case "simulation":
			return "Simulation"
		case "prover":
			return "Proof generation"
		case "popup_bound":
			return "Popup closed"
		case "dapp_execute":
			return "App"
		case "transfer":
			return "Transfer"
		case "sw_restart_post_prove":
			return "Browser restart"
		case "stale_on_resume":
			return "Stale on resume"
		case "stuck_proving":
			return "Stuck proving"
		case "stuck_queued":
			return "Stuck queued"
		case "user_rejected":
			return "User rejected"
		case "unknown":
			return "Unknown"
		default:
			return "Error"
	}
}

/**
 * B2: categorical label + one-line context for a failed/cancelled
 * journal record. Maps `op.error?.kind` to a user-friendly category
 * with a brief explanation. Distinguishes pre-broadcast failures
 * (your wallet caught it before reaching the network) from interrupted-
 * mid-flight (wallet restarted; tx may still be on-chain) from generic
 * categories (network errors, app errors).
 *
 * Consumes ONLY wallet-controlled fields: `op.error?.kind`,
 * `op.kind`, `op.progress?.stage`. NEVER reads `op.subtitle` (dApp-
 * controlled) so the new B1 detail page can render the category
 * without re-opening the P1 sanitize hole.
 *
 * The "Reason" row in journal/[id].vue continues to use
 * `humanizeErrorKind` for the technical-name surface; this helper is
 * the categorical chip + context surface.
 */
export type CategoricalFailureLabel = {
	label: string
	context: string
}

export function categoricalLabel(op: OperationRecord): CategoricalFailureLabel {
	// Cancelled-stage ops carry no `error.kind` (the FSM transitions to
	// cancelled via user action, not a thrown error). Default-arm
	// "Error" was wrong for cancellation; surface as "Cancelled" instead.
	if (op.progress?.stage === "cancelled" && !op.error?.kind) {
		return { label: "Cancelled", context: "This transaction was cancelled." }
	}
	const kind = op.error?.kind ?? "unknown"
	switch (kind) {
		case "user_rejected":
			return { label: "You rejected", context: "You stopped this transaction." }
		case "popup_bound":
			return { label: "Popup closed early", context: "The popup closed before this transaction could finish." }
		case "simulation":
		case "prover":
		case "stuck_proving":
		case "stuck_queued":
			return {
				label: "Stopped before broadcast",
				context: "Your wallet caught this before reaching the network. Often balance, fees, or invalid call.",
			}
		case "sw_restart_post_prove":
		case "stale_on_resume":
			return {
				label: "Interrupted mid-flight",
				context: "The wallet restarted before confirming this. Transaction may still be on-chain — check the explorer.",
			}
		case "network":
			return {
				label: "Network error",
				context: "Couldn't reach the network. The transaction may not have been submitted.",
			}
		case "transfer":
		case "dapp_execute":
			return { label: "Reported by app", context: "The connected app reported an error." }
		default:
			return { label: "Error", context: "Something went wrong with this transaction." }
	}
}

/** Subtitle copy per documented `JobError.kind` + live execution catch-alls. */
function failedSubtitleFor(kind: string): string {
	switch (kind) {
		case "network":
			return "Network error"
		case "simulation":
			return "Simulation failed"
		case "prover":
			return "Couldn't generate proof"
		// popup_bound, transfer, dapp_execute, unknown, and any other / future
		// kind all fall through to the generic copy. The kind is still preserved
		// in the journal record's error.kind field for debugging / future
		// granularity.
		default:
			return "Transaction failed"
	}
}

/** Minimal token shape the activity-feed terminal-card resolver needs. */
export interface TokenForCardProps {
	symbol?: string
	decimals?: number
}

export interface JournalTerminalCardCtx {
	tokenById: (id: number) => TokenForCardProps | undefined
}

/**
 * Props shape a terminal `TransactionTerminalCard` consumes. Mirrors the
 * inline shapes that `RecentActivityView` and `TransactionsList` each used
 * to build independently — the duplication risked drift between the home
 * widget and the dedicated activity page.
 */
export interface JournalTerminalCardProps {
	title: string
	activityIcon: string
	originLabel: string | null
	/** Privacy-direction chip ("Private → Public" etc.) for transfer ops.
	 *  Mutually exclusive with originLabel — the terminal card renders
	 *  whichever is set in the title-trailing slot. Null for non-transfer
	 *  kinds AND for transfer records persisted before the v0.17 schema
	 *  added `transferType` (gracefully degrades to no chip). */
	transferTypeLabel: string | null
	amount: string | null
	amountSymbol: string | null
	state: JournalTerminalVisualState
	subtitle: string
	icon: string
	color: "gray" | "amber" | "red"
}

/**
 * Resolve card props for a terminal journal record. Returns `null` when
 * the record should NOT render an activity-feed terminal card:
 *  - The record is non-terminal or `succeeded` (no terminal card; succeeded
 *    on-chain ops surface via TransactionService instead).
 *  - The kind is not in {@link ACTIVITY_FEED_KINDS} (e.g. `token_import`
 *    renders in TokensView via `TokenImportRow`, not in the activity feed).
 *
 * The non-activity-kind guard is intentional: it lets an accidental caller
 * get a clean `null` rather than a malformed card. Codex flagged the
 * pre-guard signature as a footgun.
 *
 * Pure function. `tokenById` is passed via ctx because the token cache
 * lives in popup-store land; this file stays free of Pinia / Vue refs.
 */
export function buildJournalTerminalCardProps(op: OperationRecord, ctx: JournalTerminalCardCtx): JournalTerminalCardProps | null {
	if (!ACTIVITY_FEED_KINDS.has(op.kind)) return null
	const display = journalTerminalDisplay(op)
	if (!display) return null

	const isTransfer = op.kind === "transfer"
	const token = isTransfer && op.tokenId !== undefined ? ctx.tokenById(op.tokenId) : undefined
	const title = isTransfer ? token?.symbol || "Transfer" : op.title ? humanizeMethodName(op.title) : "Transaction"
	const activityIcon = isTransfer ? "arrow-narrow-up-right" : "zap"
	// `op.subtitle` is the dApp-controlled origin/name persisted at session-
	// discover time. Bracket schemeful values so a malicious dApp can't make
	// its label visually read as a clickable link on the main feed.
	const originLabel = isTransfer ? null : sanitizeJournalSubtitle(op.subtitle)
	// Gate on `=== undefined` because TransferType.Private === 0; a truthy
	// check would silently drop the Private → Private chip.
	const transferTypeLabel = isTransfer && op.transferType !== undefined ? formatTransferType(op.transferType) : null

	// Pre-v7 records lacking `amountRaw` would have `balanceFormatted(undefined, …)`
	// silently render "0", surfacing as a fake "0 USDC" ghost on the card
	// (codex audit catch). Only emit amount when both pieces are present.
	let amount: string | null = null
	let amountSymbol: string | null = null
	if (isTransfer && op.amountRaw && token) {
		amount = balanceFormatted(op.amountRaw, token.decimals || 0, 8).value
		amountSymbol = token.symbol ?? null
	}

	return { title, activityIcon, originLabel, transferTypeLabel, amount, amountSymbol, ...display }
}
