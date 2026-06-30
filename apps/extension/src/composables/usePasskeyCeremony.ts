/**
 * Page-local composable that drives a passkey ceremony via the
 * in-page `PasskeyCeremonyDialog`. Returns:
 *
 *   - `request` — reactive ref the caller binds to the dialog's `:request`
 *     prop with `v-if="request"`. Null when no ceremony is in flight.
 *   - `runCeremony(req)` — opens the dialog, returns a Promise that
 *     resolves with `PasskeyCredentialData` or rejects on cancel/error.
 *   - `onResolve` / `onReject` — handlers the caller wires to the
 *     dialog's emits.
 *
 * Caller pattern (see auth.vue, profile/new.vue, import.vue):
 *
 *   const { request, runCeremony, onResolve, onReject } = usePasskeyCeremony()
 *   ...
 *   const credData = await runCeremony({ mode: "get", credentialId })
 *   ...
 *   <template>
 *     <PasskeyCeremonyDialog v-if="request" :request="request" @resolve="onResolve" @reject="onReject" />
 *   </template>
 *
 * Why a composable and not a service-bound C1 — there is NO service
 * client subscription here. It's a one-shot Promise wrapper around an
 * event-emitting child component. Caller still owns the dialog mount
 * via `v-if`, so layering is page-local. (Per CLAUDE.md C0/C1 split.)
 */
import { ref } from "vue"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"

type Pending = {
	resolve(data: PasskeyCredentialData): void
	reject(err: Error): void
}

export function usePasskeyCeremony() {
	const request = ref<PasskeyRequest | null>(null)
	let pending: Pending | null = null

	function runCeremony(req: PasskeyRequest): Promise<PasskeyCredentialData> {
		if (pending) {
			return Promise.reject(new Error("A passkey ceremony is already in flight"))
		}
		return new Promise<PasskeyCredentialData>((resolve, reject) => {
			pending = { resolve, reject }
			request.value = req
		})
	}

	function onResolve(data: PasskeyCredentialData) {
		const p = pending
		pending = null
		request.value = null
		p?.resolve(data)
	}

	function onReject(err: Error) {
		const p = pending
		pending = null
		request.value = null
		p?.reject(err)
	}

	return { request, runCeremony, onResolve, onReject }
}
