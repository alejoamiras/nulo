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
import { createRouter, createWebHashHistory } from "vue-router"
import App from "./app.vue"
import routes from "~pages"
import "@nulo/design/base.css"
import "./index.scss"

import { initAppServiceContext, managers } from "@/utils/core"
import { createPopupGuard } from "./route-guard"

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

// The guard's decision logic (and its synchronous-early-branch contract) lives in `route-guard.ts`,
// where it is unit-tested; this module only mounts.
router.beforeEach(
	createPopupGuard(
		() => useAppStore(),
		() => managers.profile,
	),
)

createApp(App).use(router).use(createPinia()).mount("#app")
