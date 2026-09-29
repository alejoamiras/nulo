import type { Router } from "vue-router"
import { isPopupSubmitKey } from "@/composables/usePopupEntity"
import type { useAppStore } from "@/stores/app.store"
import { initTransactionService, managers } from "@/utils/core"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { storageLocalSet } from "@/utils/storage"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { sleep } from "@/wallet/utils"

type AppStore = ReturnType<typeof useAppStore>

/**
 * Popup-only activation of a freshly created profile.
 *
 * The popup relies on `popup/app.vue`'s `onActiveProfileChanged` listener to
 * run the heavy bootstrap and flip `appStore.isLogined`; this waits for that
 * handshake, then loads accounts, wires the transaction service, persists the
 * active account, and opens the session. This is intentionally DISTINCT from
 * `useProfileBootstrap.bootstrapActiveProfile` (which onboarding uses and which
 * does strictly more) — do NOT merge the two. Extracted from the page so the
 * call ordering is unit-testable.
 */
export async function activateCreatedProfile(profile: { id: string }, deps: { appStore: AppStore; router: Router }): Promise<void> {
	const { appStore, router } = deps
	while (!appStore.isLogined) {
		await sleep(100)
	}

	// Keep an existing client: replacing it abandoned a connected port, and disconnecting it would
	// reject the calls of any flow still holding it.
	managers.account ??= new AccountServiceClient()

	appStore.profile = profile as AppStore["profile"]
	await setLastActiveProfileId(profile.id)
	if (!appStore.network) throw new Error("Network not set")
	appStore.accounts = await managers.account.getAccounts(profile.id, appStore.network.chainId, true)

	initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)

	await storageLocalSet({
		"nulo:ui:activeAccount": appStore.account?.address,
	})

	router.push("/popup/general")
}

/** Popup-create's Enter shortcut, bound on the page's root: an Enter in one of its fields submits
 *  unless a child already handled it. */
export function makeCreateKeydownHandler(onSubmit: () => void): (e: KeyboardEvent) => void {
	return (e) => {
		if (!e.defaultPrevented && isPopupSubmitKey(e)) onSubmit()
	}
}
