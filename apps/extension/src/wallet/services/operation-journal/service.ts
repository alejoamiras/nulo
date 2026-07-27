import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { ValidationError } from "@nulo/extension-messaging/errors"
import { validateParams } from "@nulo/extension-messaging/zod"
import { type JobError, type JobProgress, assertCanTransition, isTerminal } from "@nulo/wallet-core/jobs"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { Lock, EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import type { ILogger } from "@/wallet/logger"
import { NetworkService } from "@/wallet/services/network/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex } from "@/wallet/utils"
import {
	type Events,
	type Methods,
	type NewOperationInput,
	OPERATION_JOURNAL_SERVICE_NAME,
	type OperationCountFilter,
	type OperationFilter,
	OperationJournalMethodSchemas,
	type OperationRecord,
	OperationRecordSchema,
} from "./spec"

export * from "./spec"

/**
 * Durable operation journal (Phase 2).
 *
 * Storage-only service — no orchestration, no business logic, no calls out
 * to other services. Consumers (ExecutionService, dApp interaction flows)
 * drive transitions; this service persists them, validates FSM legality
 * via `@nulo/wallet-core/jobs`, and fans out events.
 *
 * Phase 2 carries owned here:
 *   #1  origin + profileId required at create-time (NewOperationInput schema)
 *   #2  terminal records keep `terminalAt`; `deleteOperation` is only for
 *       explicit cleanup (chain purge) — terminal stages don't auto-delete
 *   #4  progress is the tagged union from wallet-core/jobs
 *   #5  error preserved with `normalizedRaw`
 *   #6  attempts counter defaults to 0; consumers increment on retry
 */
export class OperationJournalService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"createOperation",
		"transitionOperation",
		"setOperationMeta",
		"getOperation",
		"getOperations",
		"countOperations",
		"deleteOperation",
	)
	public static name = OPERATION_JOURNAL_SERVICE_NAME

	public readonly onOperationAdded = new EventHandler<OperationRecord>()
	public readonly onOperationUpdated = new EventHandler<OperationRecord>()
	public readonly onOperationDeleted = new EventHandler<OperationRecord>()

	private readonly storage: EntityStorage<OperationRecord>

	/**
	 * Serializes `transitionOperation` calls across ALL records.
	 *
	 * `transitionOperation` does load → validate → write. Without this lock,
	 * two concurrent transitions on the SAME record can both read the same
	 * starting stage, both pass `assertCanTransition`, then last-write wins
	 * at the storage layer — producing a state that doesn't match either
	 * caller's expectation. The pathological case (caught by codex-round-5)
	 * is claim vs. cancel: `cancelJob(queued|pending → cancelled)` racing
	 * with a handler's `claim(queued → pending)`.
	 *
	 * Global rather than per-record because:
	 *   - per-record requires a Map<id, Lock> with eviction policy headaches
	 *   - each transition is fast (a single chrome.storage write)
	 *   - transition volume is low (a handful per tx lifecycle)
	 *
	 * Every path that reads a row and then writes (or deletes) it takes this
	 * lock: `transitionOperation`, `touchOperation`, `setOperationMeta` and
	 * `deleteOperation`. `createOperation` and `getOperation` don't, since
	 * neither is a load-then-write on an existing row. A new load+merge+write
	 * path MUST acquire it too.
	 */
	private readonly transitionLock: Lock

	/** Optional profile-existence fence for `createOperation` — see `init`. */
	private profileService: ProfileService | null = null

	public constructor(logger: ILogger, browserApi?: BrowserApi) {
		super(OPERATION_JOURNAL_SERVICE_NAME, logger)
		// Local storage: records survive SW restart AND full browser exit.
		// Originally used `chrome.storage.session` on the rationale that
		// "stale ops post-reboot aren't actionable anyway" — true for IN-
		// FLIGHT records, but terminal records (failed/cancelled/succeeded)
		// ARE the user's history. Session storage's browser-exit wipe was
		// erasing failed/cancelled history that the user expected to keep
		// (QA feedback 2026-06-05). The reaper's boot-sweep still marks
		// surviving non-terminal records as failed on SW restart — same
		// behavior as before, just the durability layer changed.
		this.storage = browserApi
			? new EntityStorage<OperationRecord>("nulo:journal", browserApi.storage.local, (raw) => OperationRecordSchema.parse(raw))
			: new EntityStorage<OperationRecord>("nulo:journal", chrome.storage.local, (raw) => OperationRecordSchema.parse(raw))
		// Instantiated in the constructor (not as a field initializer) so the
		// logger reference is guaranteed to be the same instance the base
		// Service stores on `this`. See class field comment above for the
		// mutex contract.
		this.transitionLock = new Lock("operation-journal:transition", logger)
	}

	protected async init(services: ServiceCollection): Promise<void> {
		// Cascade registration is optional — minimal test fixtures don't
		// register NetworkService, and the journal still works as a standalone
		// storage primitive in those contexts.
		try {
			const networkService = services.get(NetworkService.name) as NetworkService
			networkService.registerChainPurgeSubscriber(async (_profileId, _chainId, networkId) => this.clearChainState(networkId))
		} catch {
			// NetworkService not registered in this collection — skip cascade wiring.
		}
		// Same optionality for the profile-existence fence in `createOperation`:
		// absent ProfileService (minimal fixtures) means no fence, matching the
		// pre-fence behavior those fixtures pin.
		try {
			this.profileService = services.get(ProfileService.name) as ProfileService
		} catch {
			this.profileService = null
		}
	}

	/**
	 * Load a single record. Validation now lives in `EntityStorage`'s injected
	 * `OperationRecordSchema` codec (constructor): a byte-corrupt row is dropped
	 * (layer 1); a row that parses as JSON but fails the schema is KEPT (not
	 * deleted) and read as `undefined` — see `EntityStorage.decodeRow`. This
	 * changed the old behavior, which DELETED schema-invalid rows; keeping them
	 * avoids silent data loss on a forward-incompatible shape while downstream
	 * FSM/lookup code still never sees a schema-invalid record (the kind↔stage
	 * invariants downstream assume a schema-valid `OperationRecord`).
	 */
	private async _loadValidated(id: string): Promise<OperationRecord | undefined> {
		return this.storage.get(id)
	}

	/**
	 * Multi-row variant of `_loadValidated`. `EntityStorage.getAll` applies the
	 * injected codec per row — byte-corrupt rows dropped, schema-invalid rows
	 * KEPT-but-skipped — so callers iterate only over schema-valid records.
	 */
	private async _loadAllValidated(): Promise<OperationRecord[]> {
		return (await this.storage.getAll()).map(([, record]) => record)
	}

	/**
	 * Wipe journal records bound to `networkId`. Called by
	 * `NetworkService.purgeChain` when a chain is being deleted. Terminal
	 * records ARE deleted here (chain purge is the explicit cleanup path —
	 * Carry #2's "kept terminal" rule applies to natural job lifecycle, not
	 * to chain teardown).
	 */
	public async clearChainState(networkId: string): Promise<void> {
		await this.ensureInitialized()
		// One lock hold for snapshot + sweep, same as `purgeForProfile`: an
		// unserialized purge lets a transition that has already read a row write
		// it back afterwards, and a snapshot outside the hold misses a row a
		// concurrent `createOperation` (same lock) is about to land.
		await this.transitionLock.enter()
		try {
			const records = (await this._loadAllValidated()).filter((r) => r.networkId === networkId)
			await purgeRows(
				records,
				(record) => this.storage.delete(record.id),
				(record) => this.emit("onOperationDeleted", record),
			)
		} finally {
			this.transitionLock.leave()
		}
	}

	/** Awaited profile-scoped journal purge — the deletion coordinator calls this
	 *  to catch records on a network-less chain that the per-network
	 *  `clearChainState` (chain-purge cascade) misses (finding D). */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		// Snapshot AND delete under one transition-lock hold: `createOperation`
		// writes under the same lock, so a row can never land between the
		// snapshot and the sweep. A snapshot taken outside missed exactly that
		// row, leaving a record for the deleted profile behind.
		await this.transitionLock.enter()
		try {
			const records = (await this._loadAllValidated()).filter((r) => r.profileId === profileId)
			await purgeRows(
				records,
				(record) => this.storage.delete(record.id),
				(record) => this.emit("onOperationDeleted", record),
			)
		} finally {
			this.transitionLock.leave()
		}
	}

	public async createOperation(input: NewOperationInput): Promise<OperationRecord> {
		validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
		await this.ensureInitialized()
		// The whole create runs under the transition lock so it serializes
		// against `purgeForProfile`: the row either lands before the purge's
		// snapshot (and is swept) or the fence below sees the profile already
		// absent — tombstoned profiles are absent from every read — and refuses.
		// Without this, a creator that captured its profile before a deletion
		// began could persist durable dApp metadata for an erased profile after
		// its purge ran, and nothing would ever sweep it.
		await this.transitionLock.enter()
		try {
			return await this._createOperationLocked(input)
		} finally {
			this.transitionLock.leave()
		}
	}

	private async _createOperationLocked(input: NewOperationInput): Promise<OperationRecord> {
		if (this.profileService) {
			const known = await this.profileService.getProfiles()
			if (!known.some((p) => p.id === input.profileId)) {
				throw new Error(`profile ${input.profileId} does not exist — operation not created`)
			}
		}

		let id: string
		do {
			// 16 bytes / 128 bits — bumped from 8/32-bit on the recommendation of
			// codex round-1 (defense-in-depth against requestId / journal-id
			// collisions once concurrent dApp interactions are possible).
			id = getRandomHex(16)
		} while (await this.storage.contains(id))

		const now = Date.now()
		const record: OperationRecord = {
			id,
			kind: input.kind,
			origin: input.origin,
			profileId: input.profileId,
			sessionId: input.sessionId,
			// `initialStage` defaults to pending — see NewOperationInput docs.
			// Narrow type ({queued} | {pending}) at the input boundary prevents
			// callers from skipping the FSM by passing terminal stages here.
			progress: input.initialStage ?? { stage: "pending" },
			error: null,
			terminalAt: null,
			attempts: 0,
			createdAt: now,
			updatedAt: now,
			accountAddress: input.accountAddress,
			networkId: input.networkId,
			tokenId: input.tokenId,
			title: input.title,
			subtitle: input.subtitle,
			amountRaw: input.amountRaw,
			recipientAddress: input.recipientAddress,
			contractAddress: input.contractAddress,
			transferType: input.transferType,
		}
		await this.storage.set(record.id, record)
		this.emit("onOperationAdded", record)
		return record
	}

	/**
	 * Transition a record's stage. Enforces the FSM legality rules in
	 * `@nulo/wallet-core/jobs` and the "error iff failed" invariant.
	 *
	 * Sets `terminalAt` if the new stage is terminal (Carry #2).
	 */
	public async transitionOperation(id: string, progress: JobProgress, error?: JobError | null): Promise<OperationRecord> {
		validateParams(OperationJournalMethodSchemas.transitionOperation.params, [id, progress, error ?? null], "transitionOperation")
		await this.ensureInitialized()

		// Serialize ALL transitions globally — see `transitionLock` doc for
		// the claim-vs-cancel race this closes. Critical section is small
		// (one load + one validate + one write), so global is acceptable.
		await this.transitionLock.enter()
		try {
			return await this._transitionLocked(id, progress, error)
		} finally {
			this.transitionLock.leave()
		}
	}

	private async _transitionLocked(id: string, progress: JobProgress, error?: JobError | null): Promise<OperationRecord> {
		const existing = await this._loadValidated(id)
		if (!existing) {
			throw new Error(`Operation not found: ${id}`)
		}

		// FSM legality — throws IllegalTransitionError on a bad transition.
		assertCanTransition(existing.progress.stage, progress.stage)

		// "error iff failed" invariant.
		if (progress.stage === "failed") {
			if (!error) {
				throw new ValidationError("transitionOperation: `error` is required when stage is 'failed'")
			}
		} else if (error) {
			throw new ValidationError(`transitionOperation: \`error\` must be null when stage is '${progress.stage}' (got failed envelope)`)
		}

		// Phase 2.5: kind ↔ succeeded.txHash invariant + shortcut gate.
		// On-chain ops (transfer, dapp_execute) must succeed with a txHash AND
		// must go through the full prove + submit path (no `simulating → succeeded`
		// shortcut). Non-tx ops (token_import) must succeed without a txHash and
		// take the shortcut. Both halves of the invariant matter — codex caught
		// that a buggy caller could otherwise drag an on-chain kind through the
		// shortcut by attaching a fake txHash.
		if (progress.stage === "succeeded") {
			const hasTxHash = typeof progress.txHash === "string" && progress.txHash.length > 0
			const cameFromSimulating = existing.progress.stage === "simulating"
			if (existing.kind === "transfer" || existing.kind === "dapp_execute") {
				if (!hasTxHash) {
					throw new ValidationError(`transitionOperation: succeeded ${existing.kind} requires a txHash`)
				}
				if (cameFromSimulating) {
					throw new ValidationError(
						`transitionOperation: ${existing.kind} cannot use the simulating → succeeded shortcut (must prove + submit)`,
					)
				}
			} else if (existing.kind === "token_import") {
				if (hasTxHash) {
					throw new ValidationError("transitionOperation: succeeded token_import must not carry a txHash")
				}
			}

			// v2 Layer A: pin `submitting.txHash === succeeded.txHash` when both
			// are populated. The four execution paths emit the canonical
			// `tx.getTxHash().toString()` at BOTH the submitting and succeeded
			// transitions; if they ever drift the RecentActivityView per-hash
			// pending-suppression filter (`filterPendingDoubleRender`) silently
			// no-ops and the disappearing-card bug returns. Catch the drift here
			// at the FSM layer rather than letting it surface as a UI
			// regression. The check is conditional on submitting carrying a
			// hash so older records / non-tx kinds aren't affected.
			if (existing.progress.stage === "submitting" && existing.progress.txHash && hasTxHash) {
				if (existing.progress.txHash !== progress.txHash) {
					throw new ValidationError(
						`transitionOperation: submitting.txHash !== succeeded.txHash (${existing.progress.txHash} vs ${progress.txHash}) — hash drift across the prove/submit boundary`,
					)
				}
			}
		}

		const now = Date.now()
		const updated: OperationRecord = {
			...existing,
			progress,
			error: error ?? null,
			terminalAt: isTerminal(progress.stage) ? now : existing.terminalAt,
			updatedAt: now,
		}
		await this.storage.set(id, updated)
		this.emit("onOperationUpdated", updated)
		return updated
	}

	/**
	 * Update title / subtitle on an existing record. Does NOT transition the
	 * stage and does NOT touch terminalAt. Used by `tokenService.addToken` to
	 * backfill the resolved symbol as the title — the journal entry is created
	 * with `title: undefined` up-front so the in-flight row appears
	 * immediately, then this method rewrites the title once metadata fetch
	 * succeeds. Emits `onOperationUpdated` so subscribers (TokensView) re-render.
	 *
	 * Unlike `transitionOperation`, this is safe to call on terminal records —
	 * if the import succeeded and the row vanished, the update lands but
	 * affects nothing user-visible. That keeps the caller simple (no need to
	 * race against the success transition).
	 */
	public async setOperationMeta(id: string, meta: { title?: string; subtitle?: string }): Promise<OperationRecord> {
		validateParams(OperationJournalMethodSchemas.setOperationMeta.params, [id, meta], "setOperationMeta")
		await this.ensureInitialized()
		// Load → merge → write on the same row, so it takes the same lock as
		// `transitionOperation`: otherwise a transition landing in between is
		// overwritten by this stale snapshot and its stage change is lost.
		await this.transitionLock.enter()
		try {
			const existing = await this._loadValidated(id)
			if (!existing) {
				throw new Error(`Operation not found: ${id}`)
			}
			const updated: OperationRecord = {
				...existing,
				title: meta.title !== undefined ? meta.title : existing.title,
				subtitle: meta.subtitle !== undefined ? meta.subtitle : existing.subtitle,
				updatedAt: Date.now(),
			}
			await this.storage.set(id, updated)
			this.emit("onOperationUpdated", updated)
			return updated
		} finally {
			this.transitionLock.leave()
		}
	}

	/**
	 * v3: bump `updatedAt` without changing any field. SW-internal liveness
	 * heartbeat for records actively WAITING on the ExecutionMutex — keeps the
	 * periodic reaper (which keys on `updatedAt` vs the per-stage grace window)
	 * from declaring a legitimately-waiting record "stuck". Deliberately does
	 * NOT emit `onOperationUpdated`: a heartbeat changes nothing user-visible,
	 * and emitting on every tick would churn the popup's `subscribeJob`
	 * consumers. The boot sweep is `unconditional` (ignores `updatedAt`), so a
	 * record whose heartbeat stopped because the SW died is still failed on
	 * restart — exactly the desired recovery. No-ops if the record is gone.
	 */
	public async touchOperation(id: string): Promise<void> {
		await this.ensureInitialized()
		// MUST take the same global lock as `transitionOperation`: this is a
		// load → merge → write, and without the lock a stale snapshot could
		// clobber a concurrent `queued→pending` / `*→cancelled` / reaper
		// `*→failed` transition (codex v3 engine-audit blocker). Re-read FRESH
		// inside the lock so the bump applies to the current record, and skip
		// the write entirely once the record is terminal — a heartbeat must
		// never resurrect a just-cancelled/failed/succeeded record's updatedAt
		// (which could briefly hide it from a terminal-state consumer).
		await this.transitionLock.enter()
		try {
			const existing = await this._loadValidated(id)
			if (!existing) return
			if (isTerminal(existing.progress.stage)) return
			await this.storage.set(id, { ...existing, updatedAt: Date.now() })
		} finally {
			this.transitionLock.leave()
		}
	}

	public async getOperation(id: string): Promise<OperationRecord | undefined> {
		validateParams(OperationJournalMethodSchemas.getOperation.params, [id], "getOperation")
		await this.ensureInitialized()
		return await this._loadValidated(id)
	}

	public async getOperations(filter?: OperationFilter): Promise<OperationRecord[]> {
		validateParams(OperationJournalMethodSchemas.getOperations.params, [filter], "getOperations")
		await this.ensureInitialized()
		const all = await this._loadAllValidated()
		if (!filter) return all
		return all.filter((op) => {
			if (filter.accountAddress !== undefined && op.accountAddress !== filter.accountAddress) return false
			if (filter.profileId !== undefined && op.profileId !== filter.profileId) return false
			if (filter.stage !== undefined && op.progress.stage !== filter.stage) return false
			if (filter.isTerminal !== undefined && (op.terminalAt !== null) !== filter.isTerminal) return false
			if (filter.kind !== undefined && op.kind !== filter.kind) return false
			return true
		})
	}

	/**
	 * Lightweight count query for callers that just need a number (cap
	 * enforcement) without materializing full records. Used by
	 * `background.ts:tryCreateQueuedJournal` for the per-session and global
	 * queued-record caps.
	 *
	 * Sessionless records (`sessionId === undefined`) are excluded whenever
	 * a `sessionId` filter is provided — UI-initiated transfers and token
	 * imports don't count against the per-session cap for dApp messages.
	 */
	public async countOperations(filter: OperationCountFilter): Promise<number> {
		validateParams(OperationJournalMethodSchemas.countOperations.params, [filter], "countOperations")
		await this.ensureInitialized()
		const all = await this._loadAllValidated()
		let n = 0
		for (const op of all) {
			if (filter.sessionId !== undefined && op.sessionId !== filter.sessionId) continue
			if (filter.stage !== undefined && op.progress.stage !== filter.stage) continue
			n++
		}
		return n
	}

	public async deleteOperation(id: string): Promise<void> {
		validateParams(OperationJournalMethodSchemas.deleteOperation.params, [id], "deleteOperation")
		await this.ensureInitialized()
		// Serialized against transitions: a transition that has already read the
		// row would otherwise write it back after the delete and resurrect it.
		await this.transitionLock.enter()
		try {
			const existing = await this._loadValidated(id)
			if (!existing) return
			await this.storage.delete(id)
			this.emit("onOperationDeleted", existing)
		} finally {
			this.transitionLock.leave()
		}
	}

	/**
	 * Delete only if the row's CURRENT stage (re-read under the transition lock)
	 * is one of `allowedStages`. A concurrent cancel serialized ahead of us moves
	 * the row to a terminal stage, and an unconditional delete would erase that
	 * decision — the caller must observe `false` and honor the cancel instead.
	 * A missing row returns `true`: it is already gone, so the caller's
	 * delete-then-replace can proceed exactly as after a successful delete.
	 */
	public async deleteOperationIfStage(id: string, allowedStages: readonly JobProgress["stage"][]): Promise<boolean> {
		await this.ensureInitialized()
		await this.transitionLock.enter()
		try {
			const existing = await this._loadValidated(id)
			if (!existing) return true
			if (!allowedStages.includes(existing.progress.stage)) return false
			await this.storage.delete(id)
			this.emit("onOperationDeleted", existing)
			return true
		} finally {
			this.transitionLock.leave()
		}
	}
}
