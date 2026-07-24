/**
 * Live "is a send in flight?" for the active profile.
 *
 * Owns a journal client for its lifetime: the caller connects nothing and only
 * reads `hasInFlightSend`. Callers that mount for the life of a screen should
 * call `dispose()` in `onBeforeUnmount`, per the composable convention.
 */

import { computed, ref, onBeforeUnmount } from "vue"
import { useAppStore } from "@/stores/app.store"
import { hasInFlightSend } from "@/utils/in-flight-send"
import { OperationJournalServiceClient } from "@/wallet/services/operation-journal/client"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"

export function useInFlightSend() {
	const appStore = useAppStore()
	const ops = ref<OperationRecord[]>([])

	const journal = new OperationJournalServiceClient()

	const upsert = (op: OperationRecord) => {
		const idx = ops.value.findIndex((row) => row.id === op.id)
		if (idx === -1) ops.value.push(op)
		else ops.value.splice(idx, 1, op)
	}
	const drop = (op: OperationRecord) => {
		ops.value = ops.value.filter((row) => row.id !== op.id)
	}

	journal.onOperationAdded.add(upsert)
	journal.onOperationUpdated.add(upsert)
	journal.onOperationDeleted.add(drop)

	const refresh = async () => {
		const profileId = appStore.profile?.id
		if (!profileId) {
			ops.value = []
			return
		}
		ops.value = await journal.getOperations({ profileId })
	}

	const connect = async () => {
		await journal.connect()
		await refresh()
	}

	const dispose = () => {
		journal.onOperationAdded.remove(upsert)
		journal.onOperationUpdated.remove(upsert)
		journal.onOperationDeleted.remove(drop)
		journal.disconnect()
	}

	onBeforeUnmount(dispose)

	return {
		/** True while the active profile has a send that has not finished. */
		hasInFlightSend: computed(() => hasInFlightSend(ops.value, appStore.profile?.id)),
		connect,
		refresh,
		dispose,
	}
}
