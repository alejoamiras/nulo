import { ServiceClient } from "@nulo/extension-messaging/background"
import { validateParams, validateResult } from "@nulo/extension-messaging/zod"
import type { JobError, JobProgress } from "@nulo/wallet-core/jobs"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ServiceSpec } from "@/wallet/base"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import {
	type Events,
	type Methods,
	type NewOperationInput,
	OPERATION_JOURNAL_SERVICE_NAME,
	type OperationFilter,
	OperationJournalMethodSchemas,
	type OperationRecord,
} from "./spec"

export * from "./spec"

export class OperationJournalServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onOperationAdded = new EventHandler<OperationRecord>()
	public readonly onOperationUpdated = new EventHandler<OperationRecord>()
	public readonly onOperationDeleted = new EventHandler<OperationRecord>()

	public constructor(name?: string) {
		super(OPERATION_JOURNAL_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	public async createOperation(input: NewOperationInput): Promise<OperationRecord> {
		validateParams(OperationJournalMethodSchemas.createOperation.params, [input], "createOperation")
		const result = await this.request("createOperation", input)
		return validateResult(OperationJournalMethodSchemas.createOperation.result, result, "createOperation")
	}

	public async transitionOperation(id: string, progress: JobProgress, error?: JobError | null): Promise<OperationRecord> {
		validateParams(OperationJournalMethodSchemas.transitionOperation.params, [id, progress, error ?? null], "transitionOperation")
		const result = await this.request("transitionOperation", id, progress, error ?? null)
		return validateResult(OperationJournalMethodSchemas.transitionOperation.result, result, "transitionOperation")
	}

	public async getOperation(id: string): Promise<OperationRecord | undefined> {
		validateParams(OperationJournalMethodSchemas.getOperation.params, [id], "getOperation")
		const result = await this.request("getOperation", id)
		return validateResult(OperationJournalMethodSchemas.getOperation.result, result, "getOperation")
	}

	public async getOperations(filter?: OperationFilter): Promise<OperationRecord[]> {
		validateParams(OperationJournalMethodSchemas.getOperations.params, [filter], "getOperations")
		const result = await this.request("getOperations", filter)
		return validateResult(OperationJournalMethodSchemas.getOperations.result, result, "getOperations")
	}

	public async deleteOperation(id: string): Promise<void> {
		validateParams(OperationJournalMethodSchemas.deleteOperation.params, [id], "deleteOperation")
		await this.request("deleteOperation", id)
	}

	/**
	 * Watch a single job. Fires `handler` once with the current snapshot,
	 * then on every subsequent change (add / update / delete) for that id.
	 *
	 * Closes the snapshot-then-events microtask race: the change handler is
	 * registered BEFORE the snapshot fetch, so any events arriving during
	 * the fetch reach the handler. On `onConnected` (port reconnect after
	 * SW restart), the snapshot is re-fetched and re-fired to catch any
	 * events missed during the disconnect window.
	 *
	 * The handler is called with `undefined` when the record is deleted
	 * (e.g. chain purge). Phase 2 doesn't auto-delete terminal records, so
	 * in practice this only fires on explicit cleanup.
	 *
	 * Returns an unsubscribe function that detaches all listeners. Call it
	 * from `onBeforeUnmount` (Vue) or service teardown.
	 */
	public async subscribeJob(id: string, handler: (op: OperationRecord | undefined) => void): Promise<() => void> {
		// Late-snapshot guard: a Vue consumer that unsubscribes while a
		// snapshot fetch is in flight should NOT receive the final stale
		// tick when the fetch resolves. Same pattern as `subscribeWithSnapshot`.
		let unsubscribed = false

		const onAnyChange = (op: OperationRecord) => {
			if (unsubscribed || op.id !== id) return
			handler(op)
		}
		const onAnyDelete = (op: OperationRecord) => {
			if (unsubscribed || op.id !== id) return
			handler(undefined)
		}

		// Register change listeners FIRST — closes the microtask race window.
		this.onOperationAdded.add(onAnyChange)
		this.onOperationUpdated.add(onAnyChange)
		this.onOperationDeleted.add(onAnyDelete)

		const emitSnapshot = async () => {
			try {
				const snapshot = await this.getOperation(id)
				if (unsubscribed) return
				handler(snapshot)
			} catch {
				// Reconnect hook will retry; or the next onChange event catches up.
			}
		}
		this.onConnected.add(emitSnapshot)
		await emitSnapshot()

		return () => {
			unsubscribed = true
			this.onOperationAdded.remove(onAnyChange)
			this.onOperationUpdated.remove(onAnyChange)
			this.onOperationDeleted.remove(onAnyDelete)
			this.onConnected.remove(emitSnapshot)
		}
	}
}
