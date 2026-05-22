/**
 * Durable journal for in-flight wallet operations — Phase 2 evolution.
 *
 * The substrate for durable jobs: every transaction submission becomes
 * an `OperationRecord` with a stage (Phase 2 FSM) plus carry fields that
 * Phase 2+ uses for fairness, retries, tombstones, and idempotency.
 *
 * Records live in `chrome.storage.session` — survive SW suspension, are
 * cleared on full browser exit. The v6 storage migration wipes pre-Phase 2
 * shapes; there are no production users to migrate.
 *
 * Phase 2 carries (see `implementations-plan/phase-2/approval.html`):
 *   #1  `origin`, `profileId` tagged at create-time
 *   #2  terminal records kept with `terminalAt` set (never deleted)
 *   #3  client-side multi-observer via subscribe-with-snapshot pattern
 *   #4  `progress` is the extensible tagged-union from `@nulo/wallet-core/jobs`
 *   #5  `error.normalizedRaw` preserves the raw boundary error
 *   #6  `attempts` for Phase 2+ retry counters (defaults to 0)
 */

import { type JobError, type JobProgress, type JobStage, NORMALIZED_RAW_MAX_CHARS } from "@nulo/wallet-core/jobs"
import { z } from "zod"
import { TransferType } from "@/wallet/services/transaction/spec"

export const OPERATION_JOURNAL_SERVICE_NAME = "operation-journal"

/** Coarse operation category.
 *
 * - `transfer` / `dapp_execute`: on-chain ops (full FSM with prove + submit).
 * - `token_import` (Phase 2.5): single-shot no-tx op — `pending → simulating
 *   → succeeded`. The kind ↔ `succeeded.txHash` invariant is enforced in
 *   `OperationJournalService.transitionOperation` so non-tx kinds cannot
 *   carry a fake txHash and on-chain kinds cannot succeed without one. */
export type OperationKind = "transfer" | "dapp_execute" | "token_import"

/**
 * Where the operation originated. Used by Phase 2+ fairness (per-origin
 * rate limits) and observability.
 *
 * Phase 2 emits `"popup"` (UI-initiated transfers) and `"dapp"` (wallet-sdk
 * + dApp interactions, which share `DappInteractionService`). `"sdk"` as a
 * separate origin would require a path that bypasses dapp-interaction; it
 * doesn't exist today. Add the enum variant back when one does.
 */
export type OperationOrigin = "popup" | "dapp"

/**
 * Caller-provided context for services that internally journal an operation
 * (`TokenService.addToken`, future Phase B graduations). The discriminated
 * shape forces the dapp branch to carry the originating dapp's URL — codex
 * called out that a defaulted optional `origin` would let future callers
 * forget context silently.
 */
export type OperationContext = { origin: "popup" } | { origin: "dapp"; dappOrigin: string }

export interface OperationRecord {
	/** Random 16-hex id assigned at `createOperation`. */
	id: string
	kind: OperationKind
	/** Carry #1: where the operation came from — tagged at create-time. */
	origin: OperationOrigin
	/** Carry #1: profile id — tagged at create-time for Phase 2+ fairness. */
	profileId: string
	/** Carry #4: extensible per-stage progress payload (from `@nulo/wallet-core/jobs`). */
	progress: JobProgress
	/** Carry #5: present iff `progress.stage === "failed"`; raw category preserved. */
	error: JobError | null
	/** Carry #2: set when the record enters a terminal stage; `null` otherwise. */
	terminalAt: number | null
	/** Carry #6: attempt counter for Phase 2+ retry policy; starts at 0. */
	attempts: number
	createdAt: number
	updatedAt: number
	/** Scope metadata — preserved for activity UI + chain purge consumers. */
	accountAddress?: string
	networkId?: string
	tokenId?: number
	/** UI metadata. Short strings intended for activity card rendering. */
	title?: string
	subtitle?: string
	/**
	 * Phase 2 follow-up v4: raw transfer amount in base units, BigInt
	 * serialized as a string (BigInt doesn't JSON round-trip). Suffix
	 * `Raw` matches the convention of `balanceFormatted(rawAmount, decimals, length)`.
	 * Set by `executeTransfer` for UI-initiated transfers; undefined for
	 * other kinds (dApp ops don't carry a wallet-known amount).
	 */
	amountRaw?: string
	/**
	 * Phase 2 follow-up v4: transfer recipient address. Persisted on the
	 * journal for future tx-detail views; not rendered on cards in this
	 * phase. Undefined for non-transfer kinds.
	 */
	recipientAddress?: string
	/**
	 * Phase 2.5: token contract address for `kind: "token_import"` records.
	 * Identifies the in-flight import in the tokens view (where the journal
	 * record drives the `TokenImportRow` until the token is added to the
	 * watchlist and the normal `TokenCard` takes over). Undefined for
	 * non-import kinds.
	 */
	contractAddress?: string
	/**
	 * `TransferType` enum value for `kind: "transfer"` records. Lets the
	 * in-flight `TransactionAwaitingCard` render the same Private/Public
	 * direction chip the settled card shows via `formatTransferType()`.
	 * Undefined for non-transfer kinds AND for legacy records persisted
	 * before this field existed — gate consumers on `=== undefined` because
	 * `TransferType.Private === 0` (a truthy check would silently drop the
	 * Private → Private chip).
	 */
	transferType?: TransferType
}

/**
 * Fields a caller supplies at create-time. The journal fills in
 * `id`, `progress` (defaults to `{ stage: "pending" }`), `error: null`,
 * `terminalAt: null`, `attempts: 0`, `createdAt`, `updatedAt`.
 */
export type NewOperationInput = {
	kind: OperationKind
	origin: OperationOrigin
	profileId: string
	accountAddress?: string
	networkId?: string
	tokenId?: number
	title?: string
	subtitle?: string
	amountRaw?: string
	recipientAddress?: string
	contractAddress?: string
	transferType?: TransferType
}

// ── Zod schemas ──────────────────────────────────────────────────────

export const OperationKindSchema = z.enum(["transfer", "dapp_execute", "token_import"])
export const OperationOriginSchema = z.enum(["popup", "dapp"])

export const JobProgressSchema: z.ZodType<JobProgress> = z.discriminatedUnion("stage", [
	z.object({ stage: z.literal("pending") }),
	z.object({ stage: z.literal("simulating") }),
	z.object({ stage: z.literal("proving"), enteredProveAt: z.number() }),
	z.object({ stage: z.literal("submitting"), txHash: z.string().optional() }),
	z.object({ stage: z.literal("succeeded"), txHash: z.string().optional() }),
	z.object({ stage: z.literal("failed") }),
	z.object({ stage: z.literal("cancelled") }),
])

export const JobErrorSchema: z.ZodType<JobError> = z.object({
	kind: z.string().min(1),
	message: z.string(),
	normalizedRaw: z.string().max(NORMALIZED_RAW_MAX_CHARS).nullable(),
})

export const OperationRecordSchema: z.ZodType<OperationRecord> = z.object({
	id: z.string(),
	kind: OperationKindSchema,
	origin: OperationOriginSchema,
	profileId: z.string().min(1),
	progress: JobProgressSchema,
	error: JobErrorSchema.nullable(),
	terminalAt: z.number().nullable(),
	attempts: z.number().int().nonnegative(),
	createdAt: z.number(),
	updatedAt: z.number(),
	accountAddress: z.string().optional(),
	networkId: z.string().optional(),
	tokenId: z.number().optional(),
	title: z.string().optional(),
	subtitle: z.string().optional(),
	amountRaw: z.string().optional(),
	recipientAddress: z.string().optional(),
	contractAddress: z.string().optional(),
	transferType: z.nativeEnum(TransferType).optional(),
})

export const NewOperationInputSchema: z.ZodType<NewOperationInput> = z.object({
	kind: OperationKindSchema,
	origin: OperationOriginSchema,
	profileId: z.string().min(1),
	accountAddress: z.string().optional(),
	networkId: z.string().optional(),
	tokenId: z.number().optional(),
	title: z.string().optional(),
	subtitle: z.string().optional(),
	amountRaw: z.string().optional(),
	recipientAddress: z.string().optional(),
	contractAddress: z.string().optional(),
	transferType: z.nativeEnum(TransferType).optional(),
})

export const JobStageSchema: z.ZodType<JobStage> = z.enum([
	"pending",
	"simulating",
	"proving",
	"submitting",
	"succeeded",
	"failed",
	"cancelled",
])

export const OperationFilterSchema = z.object({
	accountAddress: z.string().optional(),
	profileId: z.string().optional(),
	stage: JobStageSchema.optional(),
	isTerminal: z.boolean().optional(),
	kind: OperationKindSchema.optional(),
})

export type OperationFilter = z.infer<typeof OperationFilterSchema>

// ── RPC surface ──────────────────────────────────────────────────────

export const OperationJournalMethodSchemas = {
	createOperation: {
		params: z.tuple([NewOperationInputSchema]),
		result: OperationRecordSchema,
	},
	/**
	 * Phase 2 replaces the old `updateOperationState` with a transition-aware
	 * call. The service validates `progress.stage` against the current stage
	 * via `assertCanTransition` and refuses illegal transitions.
	 *
	 * `error` MUST be provided when `progress.stage === "failed"`; for all
	 * other stages it MUST be `null` (or omitted). The service throws on mismatch.
	 */
	transitionOperation: {
		params: z.tuple([z.string().min(1), JobProgressSchema, JobErrorSchema.nullable().optional()]),
		result: OperationRecordSchema,
	},
	/**
	 * Update non-FSM metadata on an existing record (title / subtitle). Unlike
	 * `transitionOperation`, this never moves the stage and is safe to call on
	 * terminal records. Used by `tokenService.addToken` to backfill the
	 * resolved symbol as the title once metadata fetch returns — the journal
	 * entry is created up-front (so the tokens-view in-flight row pops in
	 * immediately) and gets its title rewritten when the symbol resolves.
	 */
	setOperationMeta: {
		params: z.tuple([
			z.string().min(1),
			z.object({
				title: z.string().optional(),
				subtitle: z.string().optional(),
			}),
		]),
		result: OperationRecordSchema,
	},
	getOperation: {
		params: z.tuple([z.string().min(1)]),
		result: OperationRecordSchema.optional(),
	},
	getOperations: {
		params: z.tuple([OperationFilterSchema.optional()]),
		result: z.array(OperationRecordSchema),
	},
	deleteOperation: {
		params: z.tuple([z.string().min(1)]),
		result: z.void(),
	},
} as const

export type Methods = {
	createOperation(input: NewOperationInput): OperationRecord
	transitionOperation(id: string, progress: JobProgress, error?: JobError | null): OperationRecord
	setOperationMeta(id: string, meta: { title?: string; subtitle?: string }): OperationRecord
	getOperation(id: string): OperationRecord | undefined
	getOperations(filter?: OperationFilter): OperationRecord[]
	deleteOperation(id: string): void
}

export type Events = {
	onOperationAdded: OperationRecord
	onOperationUpdated: OperationRecord
	onOperationDeleted: OperationRecord
}
