/**
 * Wallet composition root.
 *
 * `createWalletRuntime(deps)` returns a handle that can start/stop the full
 * service graph. Everything that touches the Chrome / WASM / filesystem world
 * flows in through `deps`, so tests can construct a runtime with fakes and
 * inspect/exercise the graph without loading the MV3 shell.
 *
 * The shell (src/wallet/index.ts) is now a thin wiring layer: instantiate
 * real adapters and call `createWalletRuntime(...).start()`.
 *
 * Dependencies are explicit. They are NOT module-level globals here; any
 * side effect the runtime has on the outside world goes through a port.
 */

import { BarretenbergSync } from "@aztec/bb.js"
import type { BrowserApi, ClockPort, TimerHandle } from "@nulo/wallet-core/ports"
import { ServiceCollection } from "./base"
import type { ConfigStore } from "./config"
import { LogLevel, type LoggerStore } from "./logger"
import { AccountService } from "./services/account/service"
import { AccountStateService } from "./services/account-state/service"
import { AuthRegistryService } from "./services/auth-registry/service"
import { ConfigService } from "./services/config/service"
import { ContactService } from "./services/contact/service"
import { DappInteractionService } from "./services/dapp-interaction/service"
import { DappSessionService } from "./services/dapp-session/service"
import { ExecutionService } from "./services/execution/service"
import { E2E_PROVERLESS } from "@/e2e/config"
import { ChromeStorageProofGate } from "@/e2e/chrome-storage-proof-gate"
import { FpcService } from "./services/fpc/service"
import { LogViewerService } from "./services/log-viewer/service"
import { LoggerService } from "./services/logger/service"
import { NetworkService } from "./services/network/service"
import { NoteService } from "./services/note/service"
import { OperationJournalService } from "./services/operation-journal/service"
import { JournalGC } from "./services/operation-journal/gc"
import { JournalReaper } from "./services/operation-journal/reaper"
import { PasskeyService } from "./services/passkey/service"
import { ProfileService } from "./services/profile/service"
import { TaskService } from "./services/task/service"
import { TokenService } from "./services/token/service"
import { TokenBalanceService } from "./services/token-balance/service"
import { TransactionService } from "./services/transaction/service"
import { IncomingTransferService } from "./services/incoming-transfer/service"
import { WindowManager } from "./services/window-manager/window-manager"
import { initWalletSdkHandler } from "./services/wallet-sdk/background"
import { runStorageMigration } from "./storage/migrate"
import { getErrorMessage } from "@nulo/wallet-core/utils"

/** Shell-supplied dependencies. All I/O goes through ports on this object. */
export interface WalletRuntimeDeps {
	browserApi: BrowserApi
	clock: ClockPort
	config: ConfigStore
	logger: LoggerStore
}

/** Handle returned by `createWalletRuntime`. Lifecycle-controlled, not singleton. */
export interface WalletRuntime {
	/** Kick off config load, BB init, migrations, service-graph startup, heartbeat. Idempotent. */
	start(): Promise<void>
	/** Stop the heartbeat. Services are not disposed (no mechanism yet). */
	stop(): void
	/** Exposed so shell code + tests can inspect / drive the graph. */
	readonly services: ServiceCollection
}

/** Heartbeat cadence — matches the previous MV3 keepalive cadence (see AUDIT notes). */
const HEARTBEAT_INTERVAL_MS = 10_000

/** Uninstall URL. Matches nulo.sh brand; documented in SECURITY.md. */
const UNINSTALL_URL = "https://nulo.sh/forms/uninstall"

export function createWalletRuntime(deps: WalletRuntimeDeps): WalletRuntime {
	const { browserApi, clock, config, logger } = deps
	const services = new ServiceCollection()
	let heartbeatHandle: TimerHandle | undefined
	let reaper: JournalReaper | undefined
	let journalGc: JournalGC | undefined
	let started = false

	const start = async (): Promise<void> => {
		if (started) return
		started = true

		// Uninstall URL comes first — zero-cost and covers the user experience
		// even if the rest of startup fails.
		try {
			await browserApi.runtime.setUninstallURL(UNINSTALL_URL)
		} catch (error) {
			logger.log("wallet", LogLevel.Warn, "Failed to set uninstall URL", getErrorMessage(error))
		}

		// Config + Barretenberg can load in parallel — neither depends on the other.
		await Promise.all([
			config.load().then(() => logger.log("wallet", LogLevel.Info, "Config loaded")),
			BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH }).then(() =>
				logger.log("wallet", LogLevel.Info, "Barretenberg initialized"),
			),
		])

		// Destructive storage migration (version-gated) must run before any
		// service reads storage. Older shapes get wiped; profiles/passkeys preserved.
		await runStorageMigration((msg) => logger.log("wallet", LogLevel.Info, msg))

		// Service graph. Services migrated to ports accept `browserApi`;
		// remaining services still reach into `chrome.*` directly until
		// their migration lands. Registration order here is a visual
		// convention only — actual startup ordering is determined by
		// `ServiceCollection.start()`'s topological phases.
		services.add(new AccountService(logger, browserApi))
		services.add(new AccountStateService(logger))
		services.add(new AuthRegistryService(logger, browserApi))
		services.add(new ConfigService(config, logger))
		const windowManager = new WindowManager(browserApi.windows, clock, logger)
		services.add(new ContactService(logger, browserApi))
		services.add(new DappInteractionService(logger, windowManager))
		services.add(new DappSessionService(logger, browserApi))
		// E2E_PROVERLESS injects a chrome.storage-backed proof gate into the SW
		// ExecutionCoordinator (the SW has chrome.storage; the offscreen does not).
		// `E2E_PROVERLESS` is a statically-false constant in prod builds, so this
		// dead branch — and the otherwise-unused ChromeStorageProofGate import —
		// is tree-shaken out (verified: prod dist contains neither the gate class
		// nor the nulo:e2e:proof-gate key). NOTE: a dynamic `import()` here was
		// tried and REJECTED — rollup emits a code-split chunk for it that SHIPS
		// even when the call is dead, leaking the gate into prod dist. The
		// _build-extension.yml negative grep is the enforcement that caught that.
		services.add(new ExecutionService(logger, E2E_PROVERLESS ? new ChromeStorageProofGate() : undefined))
		services.add(new FpcService(logger))
		services.add(new LogViewerService(logger))
		services.add(new LoggerService(logger))
		services.add(new NetworkService(logger))
		services.add(new NoteService(logger))
		services.add(new OperationJournalService(logger, browserApi))
		services.add(new ProfileService(config, logger))
		services.add(new TaskService(logger))
		services.add(new TokenService(logger))
		services.add(new TokenBalanceService(logger, browserApi))
		services.add(new TransactionService(logger, browserApi))
		services.add(new IncomingTransferService(logger, browserApi))
		services.add(new PasskeyService(logger, windowManager))

		await services.start()
		logger.log("wallet", LogLevel.Info, "Services started")

		// Phase 2 Week 4: durable-job reaper. Runs a chrome.alarms-driven
		// sweep + a boot sweep against the operation journal; transitions
		// any non-terminal record older than its stage's grace window to
		// `failed` with kind=`stuck_proving`/`stale_on_resume`. Closes the
		// "popup waits forever on a lost prove" failure mode.
		const journalService = services.get(OperationJournalService.name) as OperationJournalService
		reaper = new JournalReaper(journalService, browserApi.alarms, logger)
		reaper.start().catch((error) => logger.log("wallet", LogLevel.Error, "JournalReaper start failed", getErrorMessage(error)))

		// Bundle 1 (Phase 2+) terminal-record GC. Disjoint from the reaper:
		// reaper watches non-terminal stuck records; GC bounds the count of
		// kept terminal tombstones per (profile, account).
		journalGc = new JournalGC(journalService, browserApi.alarms, logger)
		journalGc.start().catch((error) => logger.log("wallet", LogLevel.Error, "JournalGC start failed", getErrorMessage(error)))

		// Boot-time storage-usage probe. Races the reaper/GC boot sweeps
		// (both fire-and-forget), so the logged count is the *pre-cleanup*
		// snapshot — useful for "how much did we wake up with" telemetry but
		// not authoritative about steady-state usage.
		void (async () => {
			try {
				const getBytes = (browserApi.storage.session as { getBytesInUse?: () => Promise<number> }).getBytesInUse
				const bytes = typeof getBytes === "function" ? await getBytes.call(browserApi.storage.session) : undefined
				const all = await browserApi.storage.session.get()
				const journalCount = Object.keys(all).filter((k) => k.startsWith("nulo:journal@")).length
				logger.log("wallet", LogLevel.Info, `session storage: ${bytes ?? "n/a"} bytes, ${journalCount} journal records`)
			} catch (error) {
				logger.log("wallet", LogLevel.Debug, "session-storage probe skipped", getErrorMessage(error))
			}
		})()

		// Wallet-sdk protocol handler (discovery, key exchange, encrypted channel).
		// Still reaches for chrome.runtime.onMessage internally; will be
		// port-migrated alongside its own refactor.
		initWalletSdkHandler(services, logger)

		// First liveness write — fire-and-forget so a flaky storage write
		// can't wedge startup. Mirrors the heartbeat error handling below.
		// The setInterval delays its FIRST fire by HEARTBEAT_INTERVAL_MS,
		// so without this immediate write, anything waiting on the liveness
		// signal (popup pages, e2e fixtures) sees a 10s gap on cold boot.
		// Restored from the original d571d2f while-loop semantics; the
		// c67e4f0 composition-root extraction had accidentally dropped the
		// immediate-first-write contract by switching to setInterval. Placed
		// AFTER the SDK handler so liveness means "runtime is fully wired
		// and ready to handle messages."
		browserApi.storage.session
			.set({ "nulo:liveness": clock.now() })
			.catch((error) => logger.log("wallet", LogLevel.Error, "Initial liveness write failed", getErrorMessage(error)))

		// Heartbeat — keeps MV3 service worker alive long enough for cross-SW
		// calls. Routed through browserApi.storage + clock for testability.
		heartbeatHandle = clock.setInterval(() => {
			browserApi.storage.session
				.set({ "nulo:liveness": clock.now() })
				.catch((error) => logger.log("wallet", LogLevel.Error, "Heartbeat failed", getErrorMessage(error)))
		}, HEARTBEAT_INTERVAL_MS)
	}

	const stop = (): void => {
		if (heartbeatHandle !== undefined) {
			clock.clearInterval(heartbeatHandle)
			heartbeatHandle = undefined
		}
		if (reaper !== undefined) {
			reaper.stop().catch((error) => logger.log("wallet", LogLevel.Error, "JournalReaper stop failed", getErrorMessage(error)))
			reaper = undefined
		}
		if (journalGc !== undefined) {
			journalGc.stop().catch((error) => logger.log("wallet", LogLevel.Error, "JournalGC stop failed", getErrorMessage(error)))
			journalGc = undefined
		}
	}

	return {
		start,
		stop,
		get services() {
			return services
		},
	}
}
