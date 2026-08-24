import { consoleMethods, LogLevel } from "@/wallet/logger"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { getErrorData } from "@nulo/wallet-core/utils"
import { isClientDisconnectRejection } from "@nulo/extension-messaging/errors"

// catch console
const logger = new LoggerServiceClient("popup")
for (const [method, level] of consoleMethods) {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
	;(self as any)[`on${method}`] = (...args: any[]) => {
		logger.log("ui", level, ...args)
	}
}

// catch unhandled errors
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
	// A SW restart rejects every in-flight request with the disconnect error
	// while the clients auto-reconnect — expected churn, kept at debug so a
	// restart under an open page doesn't spam one error line per request.
	const level = isClientDisconnectRejection(e.reason) ? LogLevel.Debug : LogLevel.Error
	logger.log("ui", level, getErrorData(e.reason))
}

import { createPinia } from "pinia"
import { createApp } from "vue"
import { createRouter, createWebHashHistory, type RouteLocationNormalized, type NavigationGuardNext } from "vue-router"
import App from "./app.vue"
import routes from "~pages"
import "@nulo/design/base.css"
import "./index.scss"

import { initAppServiceContext, managers } from "@/utils/core"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
import { authRequiredGate } from "./auth-guard"

// Eagerly open profile + contact service-worker ports at boot. Matches the
// timing of the previous module-eval init in core.js so no consumer sees a
// "ports not ready" race. Under the new shape, importers that never call
// this (tests, tooling) get silent ports — they connect only on first
// `managers.*` access, if at all.
initAppServiceContext()

/** Store */
import { useAppStore } from "@/stores/app.store"

routes.push({
	path: "/",
	redirect: "/popup",
})

const router = createRouter({
	history: createWebHashHistory(import.meta.env.BASE_URL),
	routes,
})

router.beforeEach(async (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
	const appStore = useAppStore()

	if (to.meta.isPasskeyInteraction) {
		next()
		return
	}

	if (to.name === "popup-register" && appStore.isRegistered) {
		next({ name: from.name || "popup-general" })
		return
	}

	// Flag-only, deliberately SYNCHRONOUS: isLogined=true exists only AFTER the activation
	// bootstrap has completed, so this check never needs the authoritative session read. An
	// async lookup here fires during cold boot (ports not ready → rejects) and its optimistic
	// degrade redirects to `from` before loadProfile has chosen a destination — stranding the
	// boot at the bare index route (reproduced under CPU restriction; see
	// implementations-plan/mac-identity-binding/lessons/phase-1.md).
	if (to.name === "popup-auth" && appStore.isLogined) {
		next({ name: from.name || "popup-general" })
		return
	}

	// The auth-required gate delegates to authRequiredGate: isLogined lags an accepted unlock
	// until the activation bootstrap finishes, and a blind bounce here ejects a genuinely
	// unlocked user mid-navigation (the guard consults the service's active session instead).
	if (to.meta.isAuthRequired && !appStore.isLogined) {
		const gate = await authRequiredGate(appStore.isLogined, appStore.isSessionChecked, () => managers.profile.getActiveProfile())
		if (gate === "auth") {
			next({ name: "popup-auth" })
			return
		}
	}

	if (!appStore.profile && to.name !== "popup-register" && to.name !== "popup-import" && to.name !== "popup-profile-new") {
		const profiles = await managers.profile.getProfiles()
		if (profiles.length) {
			const lastActiveId = await getLastActiveProfileId()
			const lastActive = lastActiveId ? profiles.find((p) => p.id === lastActiveId) : undefined
			appStore.profile = lastActive ?? profiles[0]
		} else {
			next({ name: "popup-register" })
			return
		}
	}

	if (to.meta.requirePasswordProfile && appStore.profile?.type === "passkey") {
		next({ path: "/popup/settings/profile" })
		return
	}

	next()
})

createApp(App).use(router).use(createPinia()).mount("#app")
