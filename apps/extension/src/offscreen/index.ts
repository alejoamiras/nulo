// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import { PRESTO_HOST, PRESTO_HTTPS_PORT, PRESTO_PORT, PRESTO_REQUIRED, PRESTO_REQUIRED_BUILD_STAMP } from "@/presto/config"
import { E2E_PROVERLESS, E2E_PROVERLESS_BUILD_STAMP } from "@/e2e/config"
import { consoleMethods, LogLevel } from "@/wallet/logger"
import { documentLogger } from "@/wallet/services/logger/client"
import { ProfileServiceClient } from "@/wallet/services/profile/client"
import { createPxeOffscreen } from "@nulo/aztec-runtime/offscreen/entry"
import { ProductionPxeFactory, createProvePhaseSink } from "@nulo/aztec-runtime/pxe"
import { getErrorData } from "@nulo/wallet-core/utils"
import { OFFSCREEN_READY_MESSAGE, OFFSCREEN_PONG, shouldRespondPong } from "@/wallet/utils/offscreen"
import { isClientDisconnectRejection } from "@nulo/extension-messaging/errors"

// B-17: a PONG must mean "PXE services are up", not just "document loaded". The
// listener is registered early (so a ping is never dropped for lack of a
// receiver), but it withholds PONG until `servicesReady` flips true after
// `createPxeOffscreen` below. A PONG during init previously let the SW adopt a
// still-initializing document and dispatch a PXE RPC before PxeService existed.
let servicesReady = false
chrome.runtime.onMessage.addListener((message, sender) => {
	if (shouldRespondPong(message, servicesReady, sender)) {
		chrome.runtime.sendMessage(OFFSCREEN_PONG).catch(() => {})
	}
	return false
})

// catch console
const logger = documentLogger("offscreen")
for (const [method, level] of consoleMethods) {
	// biome-ignore lint/suspicious/noExplicitAny: dynamic global property + console varargs
	;(self as any)[`nuloOn${method}`] = (...args: any[]) => {
		logger.log("pxe", level, ...args)
	}
}

// catch unhandled errors
self.onunhandledrejection = (e: PromiseRejectionEvent) => {
	try {
		// Known-benign cascade: when the SW port closes, every pending background-port RPC rejects
		// with "Client disconnected", and the un-awaited ones land here. Expected unwind, not
		// failure — demoted to Debug so a SW restart does not flood the activity log.
		if (isClientDisconnectRejection(e.reason)) {
			// Only preventDefault() keeps DevTools from printing the rejection; the demotion never did.
			e.preventDefault()
			logger.log("pxe", LogLevel.Debug, "background port closed; pending RPC rejected (benign cascade)")
			return
		}
		logger.log("pxe", LogLevel.Error, getErrorData(e.reason))
	} catch {
		// Logger itself may fail if SW is dead — don't cascade
	}
}

// Pin the presto-required build stamp into the bundle so vite cannot
// tree-shake the import. The CI agent greps dist/chrome for the literal
// value as a propagation assertion. No-op at runtime.
// See apps/extension/src/presto/config.ts for full context.
if (PRESTO_REQUIRED_BUILD_STAMP) {
	;(globalThis as { __NULO_PRESTO_REQUIRED_BUILD_STAMP__?: string }).__NULO_PRESTO_REQUIRED_BUILD_STAMP__ = PRESTO_REQUIRED_BUILD_STAMP
}

// Mutually exclusive: a build cannot be both proverless (skip proving) and
// presto-required (enforce native proving). Fail fast if misbuilt.
if (E2E_PROVERLESS && PRESTO_REQUIRED) {
	throw new Error("[e2e] VITE_NULO_E2E_PROVERLESS and VITE_NULO_PRESTO_REQUIRED are mutually exclusive.")
}

// Pin the proverless build stamp (same anti-tree-shake reason as above).
// Present ONLY in proverless e2e builds; the negative grep in
// _build-extension.yml asserts its absence from production bundles.
if (E2E_PROVERLESS_BUILD_STAMP) {
	;(globalThis as { __NULO_E2E_PROVERLESS_BUILD_STAMP__?: string }).__NULO_E2E_PROVERLESS_BUILD_STAMP__ = E2E_PROVERLESS_BUILD_STAMP
}

// run services — await initialization before signaling ready.
// Bootstrap lives in @nulo/aztec-runtime/offscreen/entry; this shell
// wires the concrete Chrome-backed clients and keeps the READY send
// so aztec-runtime stays chrome-free.
const t0 = Date.now()
// The prover reports each attempt's phases through this sink; PxeService
// forwards them to the SW, where the coordinator attributes them by proveId.
const provePhases = createProvePhaseSink()
await createPxeOffscreen({
	profiles: new ProfileServiceClient(),
	logger: documentLogger(),
	// E2E_PROVERLESS builds the proverless PXE (proverEnabled:false, no
	// PrestoProver) — referenced only in this flag-gated branch so DCE
	// strips it from prod. The controllable barrier lives SW-side (the
	// offscreen has no chrome.storage); see ExecutionCoordinator's ProofGate.
	// PRESTO_REQUIRED (CI builds) adds the plaintext endpoint + the preflight;
	// production is HTTPS-only Presto with the silent WASM fallback.
	factory: E2E_PROVERLESS
		? new ProductionPxeFactory(undefined, { provingMode: "proverless" })
		: PRESTO_REQUIRED
			? new ProductionPxeFactory(undefined, {
					provingMode: "required",
					host: PRESTO_HOST,
					port: PRESTO_PORT,
					httpsPort: PRESTO_HTTPS_PORT,
					onProvePhase: provePhases.emit,
				})
			: new ProductionPxeFactory(undefined, { provingMode: "default", onProvePhase: provePhases.emit }),
	provePhaseSink: provePhases,
})
// B-17: PXE services are now up — start answering health PINGs with PONG.
servicesReady = true
logger.log("pxe", LogLevel.Info, `Offscreen services initialized (${Date.now() - t0}ms)`)

// notify bg only after services are actually initialized
chrome.runtime.sendMessage(OFFSCREEN_READY_MESSAGE)
