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
	// Until the first snapshot lands, an empty list is "we don't know yet", not
	// "nothing is in flight". Reporting false there would let a click that lands
	// before the journal answers switch during a send — the exact case the guard
	// exists for, and the easiest one to hit.
	const ready = ref(false)

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
			ready.value = true
			return
		}
		ops.value = await journal.getOperations({ profileId })
		ready.value = true
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
		/**
		 * True while the viewed account has a send that has not finished — and
		 * also while the answer is still unknown, so callers fail closed.
		 */
		hasInFlightSend: computed(
			() =>
				!ready.value ||
				hasInFlightSend(ops.value, {
					profileId: appStore.profile?.id,
					accountAddress: appStore.account?.address,
					networkId: appStore.network?.id,
				}),
		),
		/** False until the first journal snapshot has been read. */
		ready,
		connect,
		refresh,
		dispose,
	}
}
