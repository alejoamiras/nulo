/**
 * Onboarding HTML entry. Mirrors popup/index.ts (Pinia + base styles +
 * service-client init) — NOT setup/index.ts which is a placeholder with no
 * stores. The onboarding tab is a full Vue app that talks to the same SW
 * services as the popup.
 */

import { installConsoleForwarding } from "@/wallet/logger/console-forwarding"

installConsoleForwarding("onboarding")

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
