/**
 * Onboarding HTML entry. Mirrors popup/index.ts (Pinia + base styles +
 * service-client init) — NOT setup/index.ts which is a placeholder with no
 * stores. The onboarding tab is a full Vue app that talks to the same SW
 * services as the popup.
 */

import { consoleMethods, LogLevel } from "@/wallet/logger"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { getErrorData } from "@nulo/wallet-core/utils"
import { isClientDisconnectRejection } from "@nulo/extension-messaging/errors"

// Forward console.{log,warn,error,...} to the unified log pipe.
const logger = new LoggerServiceClient("onboarding")
for (const [method, level] of consoleMethods) {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
	;(self as any)[`on${method}`] = (...args: any[]) => {
		logger.log("ui", level, ...args)
	}
}

self.onunhandledrejection = (e: PromiseRejectionEvent) => {
	// A SW restart rejects every in-flight request with the disconnect error
	// while the clients auto-reconnect — expected churn, kept at debug so a
	// restart under an open tab doesn't spam one error line per request.
	const level = isClientDisconnectRejection(e.reason) ? LogLevel.Debug : LogLevel.Error
	logger.log("ui", level, getErrorData(e.reason))
}

import { createPinia } from "pinia"
import { createApp } from "vue"
import { createRouter, createWebHashHistory } from "vue-router"
import App from "./app.vue"
import routes from "~pages"
import "@nulo/design/base.css"
import "./onboarding.scss"

import { initAppServiceContext } from "@/utils/core"

// Match popup's eager service-context init so consumers don't race on
// "ports not ready". Idempotent — safe to call from any context.
initAppServiceContext()

// Default landing for any non-onboarding URL hits.
routes.push({
	path: "/",
	redirect: "/onboarding/welcome",
})

const router = createRouter({
	history: createWebHashHistory(import.meta.env.BASE_URL),
	routes,
})

createApp(App).use(router).use(createPinia()).mount("#app")
