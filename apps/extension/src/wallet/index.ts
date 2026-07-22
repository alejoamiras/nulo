/**
 * MV3 service-worker shell. All this file does is:
 *   1. Install the shell-level side effects that can't live behind a port
 *      (self.onunhandledrejection, console hijack — both target `self`).
 *   2. Instantiate real-world adapters (RealChromeBrowserApi, SystemClock)
 *      and shared stores (ConfigStore, LoggerStore).
 *   3. Hand them to `createWalletRuntime()` and call `start()`.
 *
 * Everything else — service graph construction, storage migration, BB init,
 * heartbeat, wallet-sdk handler — is inside runtime.ts and consumes the
 * ports passed through `deps`.
 */

import "@/utils/console-sniffer"
import { RealChromeBrowserApi, SystemClock } from "@/core/adapters"
import { ConfigStore } from "./config"
import { consoleMethods, LoggerStore, LogLevel } from "./logger"
import { createWalletRuntime } from "./runtime"
import { PRICE_REFRESH_ALARM_NAME, PriceService } from "./services/price/service"
import { getErrorData } from "@nulo/wallet-core/utils"
import { openOrFocusOnboardingTab } from "./utils/onboarding-tab"

// MV3: onInstalled fires once, synchronously, when the SW boots after install.
// Late addListener calls miss the historic event. Register at top level BEFORE
// any awaited startup work. Use a STATIC import (above) — a dynamic
// import("./utils/onboarding-tab") trips vite's preload runtime which calls
// window.dispatchEvent on preload-error, but SW has no `window`.
chrome.runtime.onInstalled.addListener(({ reason }) => {
	if (reason !== "install") return
	void openOrFocusOnboardingTab()
})

// Done page sends this message after the user clicks "Open wallet". The SW
// calls chrome.action.openPopup from a context that survives the onboarding
// tab closing itself, so the popup's lifecycle isn't tied to the tab's.
chrome.runtime.onMessage.addListener((message: unknown): false => {
	if (message && typeof message === "object") {
		const msg = message as { type?: string; windowId?: number }
		if (msg.type === "nulo:open-toolbar-popup") {
			const windowId = typeof msg.windowId === "number" ? msg.windowId : undefined
			chrome.action.openPopup(windowId !== undefined ? { windowId } : {}).catch((error) => {
				console.error("SW openPopup failed:", error)
			})
		}
	}
	// Return false: we never call sendResponse, fire-and-forget only.
	return false
})

const config = new ConfigStore()
const logger = new LoggerStore(config)
const browserApi = new RealChromeBrowserApi()
const clock = new SystemClock()

// Console hijack — forward every console.{log,warn,error,...} through the
// LoggerStore so everything ends up in a single log pipe.
for (const [method, level] of consoleMethods) {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic console hijack on ServiceWorkerGlobalScope
	;(self as any)[`on${method}`] = (...args: unknown[]) => {
		logger.log("wallet", level, ...args)
	}
}

// Unhandled rejections. Routed through the logger so we can see them across
// SW restarts via log rehydration.
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
	logger.log("wallet", LogLevel.Error, getErrorData(e.reason))
}

logger.log("wallet", LogLevel.Info, "Runtime configured")

const runtime = createWalletRuntime({ browserApi, clock, config, logger })

// MV3: when an alarm WAKES the SW, only listeners registered synchronously
// at module scope receive the triggering event — a listener added inside
// `runtime.start()` (after awaited config/BB/migration work) would miss it,
// and with it every price tick of that SW lifetime. This shim is the SINGLE
// dispatch path for the price alarm: it ensures startup completed (start()
// is idempotent) and forwards the tick into the service, which does NOT
// subscribe to alarms itself (no double dispatch).
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name !== PRICE_REFRESH_ALARM_NAME) return
	runtime
		.start()
		.then(() => (runtime.services.get(PriceService.name) as PriceService).onAlarmTick())
		.catch((error) => {
			logger.log("wallet", LogLevel.Error, "price alarm dispatch failed", getErrorData(error))
		})
})

// Rehydrate logs from the previous SW lifecycle, then start. A failed
// rehydrate (session storage unavailable) is non-fatal — we start anyway.
logger
	.rehydrate()
	.catch(() => {})
	.then(() => {
		logger.log("wallet", LogLevel.Info, "Service worker started")
		runtime.start().catch((error) => {
			logger.log("wallet", LogLevel.Error, "Runtime start failed", getErrorData(error))
		})
	})
