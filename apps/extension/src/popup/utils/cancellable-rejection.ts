/**
 * Classify a rejection from any cancellable RPC into a UX action.
 *
 * Used by every popup that awaits a long-running wallet operation that the
 * user can cancel mid-flight:
 *   - `send.vue` → `executionService.executeTransfer`
 *   - `RevokeAuthwitsPopup.vue` → `authwitsService.revokeAuthwits`
 *   - `ChangeAuthwitsRegistryPopup.vue` → `authwitsService.setRegistryEnabled`
 *
 * Returns "silent" when the user intentionally cancelled — the caller
 * suppresses its failure toast / error UI. The cancelled state is already
 * communicated by the terminal card in `RecentActivityView`.
 *
 * Returns "toast" for any other rejection — the caller surfaces a failure
 * indicator as before.
 *
 * Detection relies on `JobCancelledError` from extension-messaging, which
 * round-trips structurally via `WalletError.toPayload()` /
 * `walletErrorFromPayload()` over the chrome.runtime port RPC. Class
 * identity survives — `instanceof` works.
 */
import { JobCancelledError } from "@nulo/extension-messaging/errors"

export type CancellableAction = "silent" | "toast"

export function classifyCancellableRejection(err: unknown): CancellableAction {
	if (err instanceof JobCancelledError) return "silent"
	return "toast"
}
