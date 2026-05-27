import { consoleMethods, LogLevel } from "@/wallet/logger"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { getErrorData } from "@nulo/wallet-core/utils"

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
	logger.log("ui", LogLevel.Error, getErrorData(e.reason))
}

import { createPinia } from "pinia"
import { createApp } from "vue"
import { createRouter, createWebHashHistory, type RouteLocationNormalized, type NavigationGuardNext } from "vue-router"
import App from "./app.vue"
import routes from "~pages"
import "@/assets/styles/_base.scss"
import "./index.scss"

import { initAppServiceContext, managers } from "@/utils/core"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"

// Eagerly open profile + contact service-worker ports at boot. Matches the
// timing of the previous module-eval init in core.js so no consumer sees a
// "ports not ready" race. Under the new shape, importers that never call
// this (tests, tooling) get silent ports — they connect only on first
// `managers.*` access, if at all.
initAppServiceContext()

// E2E test affordance: expose `managers` on `window.__nuloE2E` when the
// build was made with `VITE_E2E_DEBUG=1`. The e2e runner (scripts/e2e/
// agent.sh) sets it; production builds don't, so the symbol is absent
// from shipped bundles. The bundle-grep guard in
// .github/workflows/_network-e2e.yml (`PROBE|nulo:probe:|VITE_E2E_PROBE`)
// catches diagnostic-probe code that ships by mistake; the same review
// discipline applies here — if `__nuloE2E` ever appears in dist/chrome
// without the e2e env, that's a regression to flag.
if (import.meta.env.VITE_E2E_DEBUG === "1") {
	// biome-ignore lint/suspicious/noExplicitAny: e2e-only debug surface
	;(window as any).__nuloE2E = { managers }
}

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

	if (to.name === "popup-auth" && appStore.isLogined) {
		next({ name: from.name || "popup-general" })
		return
	}

	if (to.meta.isAuthRequired && !appStore.isLogined && appStore.isSessionChecked) {
		next({ name: "popup-auth" })
		return
	}

	if (to.meta.isAuthRequired && !appStore.isLogined && !appStore.isSessionChecked) {
		next({ name: "popup-auth" })
		return
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
