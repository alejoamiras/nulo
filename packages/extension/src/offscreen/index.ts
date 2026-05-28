import { ACCELERATOR_HOST, ACCELERATOR_PORT, ACCELERATOR_REQUIRED } from "@/accelerator/config"
import { consoleMethods, LogLevel } from "@/wallet/logger"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { ProfileServiceClient } from "@/wallet/services/profile/client"
import { createPxeOffscreen } from "@nulo/aztec-runtime/offscreen/entry"
import { ProductionPxeFactory } from "@nulo/aztec-runtime/pxe"
import { getErrorData } from "@nulo/wallet-core/utils"
import { OFFSCREEN_READY_MESSAGE, OFFSCREEN_PING, OFFSCREEN_PONG } from "@/wallet/utils/offscreen"
import { isBenignSwDisconnect } from "./is-benign-sw-disconnect"

// Respond to health check pings from the service worker.
// Registered before anything else so even a slow init doesn't block pong.
chrome.runtime.onMessage.addListener((message) => {
	if (message === OFFSCREEN_PING) {
		chrome.runtime.sendMessage(OFFSCREEN_PONG).catch(() => {})
	}
	return false
})

// catch console
const logger = new LoggerServiceClient("offscreen")
for (const [method, level] of consoleMethods) {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
	;(self as any)[`on${method}`] = (...args: any[]) => {
		logger.log("pxe", level, ...args)
	}
}

// catch unhandled errors
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
	try {
		// Known-benign cascade: when the SW port closes, every pending
		// background-port RPC rejects with "Client disconnected". Most
		// are fire-and-forget callers (LoggerServiceClient.log from the
		// console-sniffer above) that don't attach .catch handlers, so
		// each rejection fires here. That's expected unwind, not failure
		// — demote to Debug + one summary line so the activity log isn't
		// flooded with 14× identical errors per SW boot.
		if (isBenignSwDisconnect(e.reason)) {
			logger.log("pxe", LogLevel.Debug, "background port closed; pending RPC rejected (benign cascade)")
			return
		}
		logger.log("pxe", LogLevel.Error, getErrorData(e.reason))
	} catch {
		// Logger itself may fail if SW is dead — don't cascade
	}
}

// run services — await initialization before signaling ready.
// Bootstrap lives in @nulo/aztec-runtime/offscreen/entry; this shell
// wires the concrete Chrome-backed clients and keeps the READY send
// so aztec-runtime stays chrome-free.
const t0 = Date.now()
// `factory` is only customized when ACCELERATOR_REQUIRED (CI builds). For
// production builds the field is omitted; PxeService defaults to a vanilla
// ProductionPxeFactory with no accelerator policy, preserving the SDK's
// silent WASM fallback for users without Aztec Accelerator installed.
await createPxeOffscreen({
	profiles: new ProfileServiceClient(),
	logger: new LoggerServiceClient(),
	factory: ACCELERATOR_REQUIRED
		? new ProductionPxeFactory(undefined, {
				required: true,
				host: ACCELERATOR_HOST,
				port: ACCELERATOR_PORT,
			})
		: undefined,
})
logger.log("pxe", LogLevel.Info, `Offscreen services initialized (${Date.now() - t0}ms)`)

// notify bg only after services are actually initialized
chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)
