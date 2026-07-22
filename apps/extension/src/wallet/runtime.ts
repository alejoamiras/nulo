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
import { ProfileDeletionCoordinator } from "./services/profile-deletion/coordinator"
import { AccountIntegrityCoordinator } from "./services/account-integrity/coordinator"
import { PriceService } from "./services/price/service"
import { ProfileService } from "./services/profile/service"
import { registerPxeGenerationProvider, registerPxeStoreKeyProvider } from "./services/pxe/client"
import { derivePxeStoreKey } from "@nulo/wallet-crypto"
import { TaskService } from "./services/task/service"
import { TokenService } from "./services/token/service"
import { TokenBalanceService } from "./services/token-balance/service"
import { TransactionService } from "./services/transaction/service"
import { IncomingTransferService } from "./services/incoming-transfer/service"
import { WindowManager } from "./services/window-manager/window-manager"
import { initWalletSdkHandler } from "./services/wallet-sdk/background"
import { type MigrationResult, Migrator } from "@nulo/wallet-core/migration"
import {
	BASELINE_VERSION,
	migrations,
	SCHEMA_BLOCKED_KEY,
	SCHEMA_DEGRADED_KEY,
	type MigrationBlockedStatus,
	type MigrationDegradedStatus,
} from "./storage/migrations"
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

		// Data-preserving storage migration runs FIRST — before config.load() (a
		// config-reshaping migration must not be shadowed by an already-loaded
		// config) and before any service reads storage.
		// The engine contractually never throws (a throw becomes a retryable
		// needs-recovery result) — this catch is belt-and-braces so even an
		// engine BUG still lands on the blocked-status recovery UX instead of a
		// bare boot crash. It deliberately clears NOTHING: an armed backup may
		// be load-bearing, and the engine's next-boot resume owns journal
		// cleanup for every stranded shape.
		const migration = await new Migrator({
			store: browserApi.storage.local,
			migrations,
			baselineVersion: BASELINE_VERSION,
		})
			.run()
			.catch(
				(err): MigrationResult => ({
					kind: "needs-recovery",
					reason: `migration engine threw: ${getErrorMessage(err)}`,
					retryable: true,
				}),
			)
		logger.log("wallet", LogLevel.Info, `Storage migration: ${migration.kind}`)
		if (migration.kind === "needs-recovery" || (migration.kind === "failed" && migration.breaking)) {
			logger.log("wallet", LogLevel.Error, `Storage migration blocked boot (${migration.kind}): ${migration.reason}`)
			// Persist the blocked status so the UI shells render the recovery
			// screen (MigrationBarrier) instead of a dead popup, then fail
			// closed: never start services on un-migrated / incompatible data.
			const blocked: MigrationBlockedStatus = {
				kind: migration.kind,
				detail: migration.reason,
				terminal: migration.kind === "failed" ? migration.terminal : !migration.retryable,
			}
			await browserApi.storage.local.set({ [SCHEMA_BLOCKED_KEY]: blocked })
			throw new Error(`storage migration blocked: ${migration.kind}`)
		}
		if (migration.kind === "failed") {
			logger.log("wallet", LogLevel.Warn, `Storage migration failed on an additive migration; booting degraded: ${migration.reason}`)
			const degraded: MigrationDegradedStatus = { version: migration.version, error: migration.reason }
			// A stale blocked status from an EARLIER boot must not outrank the
			// degraded banner over a wallet that just booted.
			await browserApi.storage.local.set({ [SCHEMA_DEGRADED_KEY]: degraded })
			await browserApi.storage.local.remove(SCHEMA_BLOCKED_KEY)
		} else {
			// Healthy boot clears any stale status from a prior failed run.
			await browserApi.storage.local.remove([SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY])
		}

		// Config + Barretenberg can load in parallel — neither depends on the other.
		await Promise.all([
			config.load().then(() => logger.log("wallet", LogLevel.Info, "Config loaded")),
			BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH }).then(() =>
				logger.log("wallet", LogLevel.Info, "Barretenberg initialized"),
			),
		])

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
		services.add(new FpcService(logger, browserApi))
		services.add(new LogViewerService(logger))
		services.add(new LoggerService(logger))
		services.add(new NetworkService(logger, browserApi))
		services.add(new NoteService(logger))
		services.add(new OperationJournalService(logger, browserApi))
		services.add(new PriceService(logger, browserApi))
		// Passing `browserApi` threads the storage port into ProfileService AND, because the port
		// carries alarms, ACTIVATES SessionManager's proactive TTL auto-lock (dormant pre-arc when the
		// composition root passed no port — see session-manager.ts "proactive TTL lights up once the
		// composition root wires browserApi"). Accepted behavior change; seam-pinned in
		// service.integration.test.ts "Q10 composition seam".
		const profileService = new ProfileService(config, logger, browserApi)
		services.add(profileService)
		// The per-profile PXE store encryption key: derived on demand from the in-memory master
		// (HKDF, wallet-crypto) and provisioned to the offscreen by the PXE clients' missing-key
		// retry path. The master never crosses the seam; a locked profile yields undefined and
		// the PXE op fails as it should. The provision pairs the key with the row's CURRENT
		// pxeGeneration — read fresh under the facade lock (row-exists + not-tombstoned), so a
		// provider that captured the master before a deletion cannot re-provision the erased
		// incarnation afterwards (#281 D4).
		registerPxeStoreKeyProvider(async (profileId) => {
			const generation = await profileService.getPxeGeneration(profileId)
			if (!generation) return undefined
			const master = await profileService.getProfileSecret(profileId).catch(() => undefined)
			if (!master) return undefined
			const key = await derivePxeStoreKey(new Uint8Array(master.toBuffer()), profileId)
			// Re-read the generation AFTER the slow HKDF and require it unchanged: a deletion
			// (+ possible same-id re-import) can land during derivation, and the offscreen's
			// in-memory `deleted(gen)` fence does NOT survive an offscreen restart — a stale
			// provision that crosses a restart would otherwise be accepted by a fresh `unseen`
			// offscreen and resurrect the erased store (concurrency audit HIGH #1). This SW-side
			// re-check closes the read→HKDF→send gap regardless of offscreen reincarnation.
			const generationNow = await profileService.getPxeGeneration(profileId)
			if (generationNow !== generation) return undefined
			return { key, generation }
		})
		// Generation-only capture for outgoing ops (no HKDF per op) — stamps
		// pxeGeneration onto each op's NetworkInfo; a retry reuses its capture.
		registerPxeGenerationProvider((profileId) => profileService.getPxeGeneration(profileId))
		services.add(new TaskService(logger))
		services.add(new TokenService(logger, browserApi))
		services.add(new TokenBalanceService(logger, browserApi))
		services.add(new TransactionService(logger, browserApi))
		services.add(new IncomingTransferService(logger, browserApi))
		services.add(new PasskeyService(logger, windowManager))
		// Started LAST (declares dependencies on every service it purges) — finding D.
		const deletionCoordinator = new ProfileDeletionCoordinator(logger)
		services.add(deletionCoordinator)
		// Also last-phase: registers as ProfileService's pre-open address verifier + AccountService's
		// operation-time mismatch sink (the address-freeze runtime guard).
		services.add(new AccountIntegrityCoordinator(logger, browserApi))

		await services.start()
		logger.log("wallet", LogLevel.Info, "Services started")

		// Resume any profile deletion a prior SW left tombstoned (crashed
		// mid-cleanup). Fire-and-forget so it never blocks startup; idempotent +
		// single-flight; a corrupt tombstone stays reserved ("deletion pending").
		void deletionCoordinator
			.resumePending()
			.catch((error) => logger.log("wallet", LogLevel.Error, "resumePendingDeletions failed", getErrorMessage(error)))

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
