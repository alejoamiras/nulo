import type { Router } from "vue-router"
import type { useAppStore } from "@/stores/app.store"
import { initTransactionService, managers, setSentinel } from "@/utils/core"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
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

	managers.account = new AccountServiceClient()

	appStore.profile = profile as AppStore["profile"]
	await setLastActiveProfileId(profile.id)
	if (!appStore.network) throw new Error("Network not set")
	appStore.accounts = await managers.account.getAccounts(profile.id, appStore.network.chainId, true)

	initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)

	await chrome.storage.local.set({
		"nulo:ui:activeAccount": appStore.account?.address,
	})

	await setSentinel()

	router.push("/popup/general")
}

/**
 * Canonical Enter double-fire guard (mirrors `NewContactPopup.vue`): only treat
 * Enter as a submit when it originates from a text input, so Enter while a
 * button is focused doesn't fire the document-level handler in addition to the
 * button's native Enter→click activation. Enter from the name field still
 * submits; Enter on a method-tab button no longer does.
 */
export function shouldHandleEnter(e: KeyboardEvent): boolean {
	if (e.key !== "Enter") return false
	const target = e.target
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * Builds popup-create's document-level keydown handler: submit only when the
 * Enter originates from a text field (see `shouldHandleEnter`). Extracted so the
 * page WIRING — not just the predicate — is unit-tested, without mounting the
 * whole page.
 */
export function makeCreateKeydownHandler(onSubmit: () => void): (e: KeyboardEvent) => void {
	return (e) => {
		if (shouldHandleEnter(e)) onSubmit()
	}
}
