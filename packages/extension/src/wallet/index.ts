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
import { getErrorData } from "@nulo/wallet-core/utils"

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
