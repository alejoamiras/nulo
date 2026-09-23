/**
 * The popup router's global guard, as a factory so its decision logic is testable without mounting
 * the app (`popup/index.ts` mounts on import). Two halves with different timing contracts:
 *
 *  - `earlyDecision` is SYNCHRONOUS and decides — and the guard calls `next` — BEFORE any suspension.
 *    `isLogined=true` exists only AFTER the activation bootstrap has completed, so the auth check never
 *    needs the authoritative session read. An async lookup here fires during cold boot (ports not
 *    ready → rejects) and its optimistic degrade redirects to `from` before loadProfile has chosen a
 *    destination — stranding the boot at the bare index route (reproduced under CPU restriction; see
 *    implementations-plan/mac-identity-binding/lessons/phase-1.md).
 *  - `lateDecision` holds the awaited checks, each under the guard it always had.
 */
import type { NavigationGuardNext, RouteLocationNormalized, RouteLocationRaw } from "vue-router"
import type { useAppStore } from "@/stores/app.store"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
import { authRequiredGate } from "./auth-guard"

type AppStore = ReturnType<typeof useAppStore>
export interface GuardProfileApi {
	getActiveProfile: () => Promise<ProfileInfo | undefined>
	getProfiles: () => Promise<ProfileInfo[]>
}

export type EarlyDecision = { kind: "proceed" } | { kind: "redirect"; to: RouteLocationRaw }

export function earlyDecision(to: RouteLocationNormalized, from: RouteLocationNormalized, appStore: AppStore): EarlyDecision | undefined {
	if (to.meta.isPasskeyInteraction) return { kind: "proceed" }
	if (to.name === "popup-register" && appStore.isRegistered) return { kind: "redirect", to: { name: from.name || "popup-general" } }
	if (to.name === "popup-auth" && appStore.isLogined) return { kind: "redirect", to: { name: from.name || "popup-general" } }
	return undefined
}

export async function lateDecision(
	to: RouteLocationNormalized,
	appStore: AppStore,
	profileApi: GuardProfileApi,
): Promise<RouteLocationRaw | undefined> {
	// The auth-required gate delegates to authRequiredGate: isLogined lags an accepted unlock
	// until the activation bootstrap finishes, and a blind bounce here ejects a genuinely
	// unlocked user mid-navigation (the guard consults the service's active session instead).
	if (to.meta.isAuthRequired && !appStore.isLogined) {
		const gate = await authRequiredGate(appStore.isLogined, appStore.isSessionChecked, () => profileApi.getActiveProfile())
		if (gate === "auth") return { name: "popup-auth" }
	}

	if (!appStore.profile && to.name !== "popup-register" && to.name !== "popup-import" && to.name !== "popup-profile-new") {
		const profiles = await profileApi.getProfiles()
		if (profiles.length) {
			const lastActiveId = await getLastActiveProfileId()
			const lastActive = lastActiveId ? profiles.find((p) => p.id === lastActiveId) : undefined
			appStore.profile = lastActive ?? profiles[0]
		} else {
			return { name: "popup-register" }
		}
	}

	if (to.meta.requirePasswordProfile && appStore.profile?.type === "passkey") return { path: "/popup/settings/profile" }
	return undefined
}

/** The `beforeEach` callback. Terminal early decisions call `next` synchronously, before the
 *  first `await`; everything else resolves through `lateDecision` and calls `next` once. */
export function createPopupGuard(getAppStore: () => AppStore, getProfileApi: () => GuardProfileApi) {
	return async (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext): Promise<void> => {
		const appStore = getAppStore()
		const early = earlyDecision(to, from, appStore)
		if (early) {
			if (early.kind === "proceed") next()
			else next(early.to)
			return
		}
		const late = await lateDecision(to, appStore, getProfileApi())
		if (late) next(late)
		else next()
	}
}
