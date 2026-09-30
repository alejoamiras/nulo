import type { IEventHandler } from "@nulo/wallet-core/utils"
import { ACTIVITY_FEED_KINDS } from "@/utils/journal-state"
import type { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"

/** The profile, network and account the popup is showing. */
export interface JournalDetailScope {
	profileId: string | undefined
	networkId: string | undefined
	accountAddress: string | undefined
}

export interface JournalDetailEvents {
	onOperationUpdated: IEventHandler<OperationRecord>
	onConnected: IEventHandler<void>
}

/**
 * The record the journal page may show under `id`, or `undefined`. The journal reads by id alone,
 * so a record of another profile, network or account is refused, or it would show that account's
 * amount, recipient, app and error. `scope` is read once the read returns: a switch while it is in
 * flight judges the record against the new scope.
 */
export async function readJournalDetail(
	client: Pick<OperationJournalServiceClient, "getOperation">,
	id: string,
	scope: () => JournalDetailScope,
): Promise<OperationRecord | undefined> {
	const record = await client.getOperation(id)
	if (!record || !ACTIVITY_FEED_KINDS.has(record.kind) || record.terminalAt === null) return undefined
	const { profileId, networkId, accountAddress } = scope()
	const inScope = record.profileId === profileId && record.networkId === networkId && record.accountAddress === accountAddress
	return inScope ? record : undefined
}

/**
 * Reloads the page's record when it changes, and on every reconnect, since an update sent while
 * the port was down is not replayed. Returns the unbind, which the page calls when it unmounts.
 */
export function bindJournalDetailUpdates(client: JournalDetailEvents, id: () => string | undefined, reload: () => void): () => void {
	const onUpdated = (op: OperationRecord): void => {
		if (op.id === id()) reload()
	}
	const onConnected = (): void => reload()
	client.onOperationUpdated.add(onUpdated)
	client.onConnected.add(onConnected)
	return () => {
		client.onOperationUpdated.remove(onUpdated)
		client.onConnected.remove(onConnected)
	}
}
