import { Service } from "@nulo/extension-messaging/background"
import { ValidationError } from "@nulo/extension-messaging/errors"
import { validateParams } from "@nulo/extension-messaging/zod"
import { type JobError, type JobProgress, assertCanTransition, isTerminal } from "@nulo/wallet-core/jobs"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import type { ILogger } from "@/wallet/logger"
import { NetworkService } from "@/wallet/services/network/service"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex } from "@/wallet/utils"
import {
	type Events,
	type Methods,
	type NewOperationInput,
	OPERATION_JOURNAL_SERVICE_NAME,
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
	public static name = OPERATION_JOURNAL_SERVICE_NAME

	public readonly onOperationAdded = new EventHandler<OperationRecord>()
	public readonly onOperationUpdated = new EventHandler<OperationRecord>()
	public readonly onOperationDeleted = new EventHandler<OperationRecord>()

	private readonly storage: EntityStorage<OperationRecord>

	public constructor(logger: ILogger, browserApi?: BrowserApi) {
		super(OPERATION_JOURNAL_SERVICE_NAME, logger)
		// Session storage: records survive SW restart but clear on browser exit
		// (stale ops post-reboot aren't actionable anyway).
		this.storage = browserApi
			? new EntityStorage<OperationRecord>("nulo:journal", browserApi.storage.session)
			: new EntityStorage<OperationRecord>("nulo:journal", chrome.storage.session)
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
	}

	/**
	 * Load a single record and re-validate it against `OperationRecordSchema`.
	 *
	 * Layer 1 (`EntityStorage`) catches byte-level JSON corruption. This is
	 * layer 2: a row that *parses* as JSON but doesn't fit the schema (e.g.
	 * a forward-incompatible field set written by a future version) gets
	 * dropped here so downstream FSM/lookup code never sees a malformed
	 * record. The kind ↔ stage invariants downstream of this load (e.g.
	 * `assertCanTransition`) all assume a schema-valid `OperationRecord`.
	 */
	private async _loadValidated(id: string): Promise<OperationRecord | undefined> {
		const raw = await this.storage.get(id)
		if (raw === undefined) return undefined
		const parsed = OperationRecordSchema.safeParse(raw)
		if (parsed.success) return parsed.data
		this.logError(`dropping schema-invalid record ${id}: ${parsed.error.message}`)
		await this.storage.delete(id)
		return undefined
	}

	/**
	 * Multi-row variant of `_loadValidated`. `EntityStorage.getAll` already
	 * skips byte-malformed rows; this pass drops schema-invalid ones (and
	 * deletes them) so callers iterate only over records they can trust.
	 */
	private async _loadAllValidated(): Promise<OperationRecord[]> {
		const all = await this.storage.getAll()
		const out: OperationRecord[] = []
		for (const [id, raw] of all) {
			const parsed = OperationRecordSchema.safeParse(raw)
			if (parsed.success) {
				out.push(parsed.data)
			} else {
				this.logError(`dropping schema-invalid record ${id}: ${parsed.error.message}`)
				await this.storage.delete(id)
			}
		}
		return out
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
		const records = (await this._loadAllValidated()).filter((r) => r.networkId === networkId)
		for (const record of records) {
			await this.storage.delete(record.id)
			this.emit("onOperationDeleted", record)
		}
	}

	public async createOperation(input: NewOperationInput): Promise<OperationRecord> {
		validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
		await this.ensureInitialized()

		let id: string
		do {
			id = getRandomHex(8)
		} while (await this.storage.contains(id))

		const now = Date.now()
		const record: OperationRecord = {
			id,
			kind: input.kind,
			origin: input.origin,
			profileId: input.profileId,
			progress: { stage: "pending" },
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

	public async deleteOperation(id: string): Promise<void> {
		validateParams(OperationJournalMethodSchemas.deleteOperation.params, [id], "deleteOperation")
		await this.ensureInitialized()
		const existing = await this._loadValidated(id)
		if (!existing) return
		await this.storage.delete(id)
		this.emit("onOperationDeleted", existing)
	}
}
