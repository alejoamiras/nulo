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
import { createSingleFlightStart } from "./single-flight-start"
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
import { ChromeStorageRestoreGate } from "@/e2e/chrome-storage-restore-gate"
import { ChromeStorageIncomingPollGate } from "@/e2e/chrome-storage-incoming-poll-gate"
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
import { type MigrationResult, Migrator, SCHEMA_ATTEMPTS_KEY } from "@nulo/wallet-core/migration"
import {
	BASELINE_VERSION,
	decodeBlockedStatus,
	isValidRetryRequest,
	migrations,
	SCHEMA_BLOCKED_KEY,
	SCHEMA_DEGRADED_KEY,
	SCHEMA_RETRY_REQUESTED_KEY,
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
	/** Manifest version, injected at the construction site — `BrowserApi.runtime`
	 *  exposes no `getManifest`, and the migration gate needs a build identity
	 *  to void blocked verdicts (terminal included) once an update ships. */
	manifestVersion: string
}

/** Minimum quiet time before the gate authorizes its ONE autonomous engine
 *  re-run per blocked episode; every other retry needs the barrier's button. */
const MIGRATION_RETRY_BACKSTOP_MS = 30 * 60_000

type MigrationGateDecision =
	| { action: "run"; backstopRuns: number; gestureRuns: number; authorizedBy: "none" | "gesture" | "backstop" }
	| { action: "short-circuit"; reason: string }

/** Handle returned by `createWalletRuntime`. Lifecycle-controlled, not singleton. */
export interface WalletRuntime {
	/** Kick off migrations, config load, BB init, service-graph startup,
	 *  heartbeat. Single-flight: concurrent callers share ONE in-flight boot
	 *  and resolve only when it genuinely finishes. REJECTS on boot failure —
	 *  callers must handle it; a retry-vetoed failure (migration-blocked, BB
	 *  init, registration zone) rejects for the SW's remaining lifetime, a
	 *  retryable one is re-attempted by the next call. */
	start(): Promise<void>
	/** Stop the heartbeat. Services are not disposed (no mechanism yet), and
	 *  the start memo is NOT reset — after a COMPLETED boot, a later start()
	 *  returns the settled memo and the heartbeat stays disarmed. stop()
	 *  during an in-flight boot does NOT cancel it — the boot's tail will
	 *  still arm the heartbeat. Same semantics as the pre-memo `started`
	 *  flag; zero production callers today. */
	stop(): void
	/** Exposed so shell code + tests can inspect / drive the graph. */
	readonly services: ServiceCollection
}

/** Heartbeat cadence — matches the previous MV3 keepalive cadence (see AUDIT notes). */
const HEARTBEAT_INTERVAL_MS = 10_000

/** Uninstall URL. Matches nulo.sh brand; documented in SECURITY.md. */
const UNINSTALL_URL = "https://nulo.sh/forms/uninstall"

export function createWalletRuntime(deps: WalletRuntimeDeps): WalletRuntime {
	const { browserApi, clock, config, logger, manifestVersion } = deps
	const services = new ServiceCollection()
	let heartbeatHandle: TimerHandle | undefined
	let reaper: JournalReaper | undefined
	let journalGc: JournalGC | undefined
	// Retry classification for the single-flight memo. `retrySafe` is vetoed at
	// the three points where an in-lifetime re-run is pointless or harmful:
	//   - ANY migration-blocked throw (every `Migrator.run()` on a failing
	//     migration bumps the DURABLE attempt counter whose cadence is
	//     next-boot by design — an in-lifetime retry loop driven by the price
	//     alarm would burn the whole cross-boot budget in minutes);
	//   - a Barretenberg init failure (`BarretenbergSync.initSingleton`
	//     memoizes its REJECTED promise upstream with no reset — verified in
	//     the vendored source — so a retry can only re-observe the same error);
	//   - the registration zone (`ServiceCollection.add` throws on duplicates,
	//     and the tabs/pxe-provider registrations are not re-entrant).
	// A vetoed failure keeps the rejected memo: callers observe the rejection,
	// and a fresh SW lifetime — fresh module state — is the retry. What
	// remains genuinely retryable: transient storage writes — the schema-status
	// sets/removes and config.load's own apply() write, all of which can
	// throw transiently and re-run safely.
	let retrySafe = true

	const doStart = async (): Promise<void> => {
		// Uninstall URL comes first — zero-cost and covers the user experience
		// even if the rest of startup fails.
		try {
			await browserApi.runtime.setUninstallURL(UNINSTALL_URL)
		} catch (error) {
			logger.log("wallet", LogLevel.Warn, "Failed to set uninstall URL", getErrorMessage(error))
		}

		// Migration GATE, before the engine: every MV3 respawn re-evaluates this
		// module and calls start(), and every engine run on a failing migration
		// spends one durable attempt — so a persisted non-terminal block must
		// short-circuit ambient wakes. The engine runs only under an authority:
		// no blocked status, a version-stamp invalidation (an update shipped —
		// terminal verdicts must not outlive their build), a consumed Retry
		// gesture, or the ONE autonomous backstop per episode. The gate FAILS
		// CLOSED: if its reads/writes fail, no engine this boot (repeated read
		// faults can neither burn attempts nor bypass a terminal verdict) — the
		// next respawn retries the gate.
		const evaluateMigrationGate = async (): Promise<MigrationGateDecision> => {
			const gate = await browserApi.storage.local.get([SCHEMA_BLOCKED_KEY, SCHEMA_RETRY_REQUESTED_KEY])
			const retryRequested = isValidRetryRequest(gate[SCHEMA_RETRY_REQUESTED_KEY])
			const hasRetryKey = SCHEMA_RETRY_REQUESTED_KEY in gate
			const decoded = decodeBlockedStatus(gate[SCHEMA_BLOCKED_KEY], manifestVersion, clock.now())
			if (decoded.kind === "invalidated") {
				// A new build is a new episode: void the verdict AND the engine's
				// durable attempt budget (inheriting exhausted attempts would make
				// the new episode's first failure instantly terminal).
				await browserApi.storage.local.remove([SCHEMA_BLOCKED_KEY, SCHEMA_RETRY_REQUESTED_KEY, SCHEMA_ATTEMPTS_KEY])
				return { action: "run", backstopRuns: 0, gestureRuns: 0, authorizedBy: "none" }
			}
			if (decoded.kind === "absent") {
				// Stale-key hygiene on unblocked boots — TOLERANT on purpose: a
				// leftover token is at worst consumed as one gesture later, so a
				// transient remove() failure must not veto a healthy boot (this
				// is the one gate write where fail-closed protects nothing).
				if (hasRetryKey) await browserApi.storage.local.remove(SCHEMA_RETRY_REQUESTED_KEY).catch(() => {})
				return { action: "run", backstopRuns: 0, gestureRuns: 0, authorizedBy: "none" }
			}
			const s = decoded.status
			if (s.terminal) {
				if (hasRetryKey) await browserApi.storage.local.remove(SCHEMA_RETRY_REQUESTED_KEY)
				return { action: "short-circuit", reason: `storage migration blocked: ${s.kind}` }
			}
			if (retryRequested) {
				// Durably claim the gesture and consume the key BEFORE the run:
				// one tap authorizes one durable attempt, whichever wake executes
				// it, and the claim survives a kill mid-run (a lost claim would
				// re-arm the backstop after the user already retried). The claim
				// also stamps lastAttemptAt so the barrier can hold its button
				// during the authorized run. A failing write throws → fail closed.
				const claimed = s.gestureRuns + 1
				await browserApi.storage.local.set({ [SCHEMA_BLOCKED_KEY]: { ...s, gestureRuns: claimed, claimedAt: clock.now() } })
				await browserApi.storage.local.remove(SCHEMA_RETRY_REQUESTED_KEY)
				return { action: "run", backstopRuns: s.backstopRuns, gestureRuns: claimed, authorizedBy: "gesture" }
			}
			if (hasRetryKey) {
				// Present-but-invalid token beside a live block: consume it (the
				// documented contract — ignored AND consumed), fail-closed like
				// every other write on the blocked paths.
				await browserApi.storage.local.remove(SCHEMA_RETRY_REQUESTED_KEY)
			}
			if (clock.now() - s.lastAttemptAt >= MIGRATION_RETRY_BACKSTOP_MS && s.backstopRuns < 1 && s.gestureRuns === 0) {
				// The one autonomous run per episode, allowed only BEFORE any
				// gesture (a user who already retried owns the remaining budget —
				// this ordering is what makes terminal strictly gesture-reached).
				// Durable claim BEFORE the run — a kill mid-run must not reset it.
				const claimed = s.backstopRuns + 1
				await browserApi.storage.local.set({ [SCHEMA_BLOCKED_KEY]: { ...s, backstopRuns: claimed, claimedAt: clock.now() } })
				return { action: "run", backstopRuns: claimed, gestureRuns: s.gestureRuns, authorizedBy: "backstop" }
			}
			return { action: "short-circuit", reason: `storage migration blocked: ${s.kind}` }
		}
		let gateDecision: MigrationGateDecision
		try {
			gateDecision = await evaluateMigrationGate()
		} catch (error) {
			retrySafe = false
			throw new Error(`storage migration gate unreadable: ${getErrorMessage(error)}`)
		}
		if (gateDecision.action === "short-circuit") {
			retrySafe = false
			throw new Error(gateDecision.reason)
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
			// A `spentAttempt: false` result recorded NOTHING on the durable
			// counter (the engine's outer catch — a free transient failure), so
			// charging the episode's retry allowance for it would park a healthy
			// wallet behind the barrier for the whole backstop window. Persist it
			// as instantly-eligible instead: the next ambient wake re-runs, and
			// because the counter never moved this can never walk to terminal.
			const freeFailure = migration.kind === "needs-recovery" && migration.spentAttempt === false
			const blocked: MigrationBlockedStatus = {
				kind: migration.kind,
				detail: migration.reason,
				terminal: migration.kind === "failed" ? migration.terminal : !migration.retryable,
				// Build identity + gate bookkeeping: the verdict is void once an
				// update ships; `backstopRuns` CARRIES the pre-run claim forward
				// so a failing episode keeps its spent autonomous allowance.
				atExtensionVersion: manifestVersion,
				lastAttemptAt: freeFailure ? 0 : clock.now(),
				backstopRuns: freeFailure ? 0 : gateDecision.backstopRuns,
				gestureRuns: gateDecision.gestureRuns,
			}
			// EVERY blocked outcome vetoes in-lifetime retry — not just terminal
			// ones: the engine's durable attempt counter bumps on each run, and
			// its retry cadence is next-boot (SW respawn) by construction. An
			// in-lifetime retry loop would consume the cross-boot budget and
			// flip a recoverable block to terminal without a single real boot.
			retrySafe = false
			await browserApi.storage.local.set({ [SCHEMA_BLOCKED_KEY]: blocked })
			// A gesture-authorized run that failed FREE (nothing recorded) must
			// not strand the user's tap: gestureRuns > 0 disables the backstop,
			// so re-arm the consumed token — the next ambient wake re-runs under
			// the same (still unspent) authorization.
			if (freeFailure && gateDecision.action === "run" && gateDecision.authorizedBy === "gesture") {
				await browserApi.storage.local.set({ [SCHEMA_RETRY_REQUESTED_KEY]: { requestedAt: clock.now() } }).catch(() => {})
			}
			throw new Error(`storage migration blocked: ${migration.kind}`)
		}
		if (migration.kind === "failed") {
			logger.log("wallet", LogLevel.Warn, `Storage migration failed on an additive migration; booting degraded: ${migration.reason}`)
			const degraded: MigrationDegradedStatus = { version: migration.version, error: migration.reason }
			// A stale blocked status from an EARLIER boot must not outrank the
			// degraded banner over a wallet that just booted. The ATTEMPTS clear
			// matters too: without a blocked key the gate runs the engine on
			// every ambient wake, and a lingering counter would let those wakes
			// silently exhaust the budget — a later restore failure would then
			// arrive instantly terminal with zero gestures.
			await browserApi.storage.local.set({ [SCHEMA_DEGRADED_KEY]: degraded })
			await browserApi.storage.local.remove([SCHEMA_BLOCKED_KEY, SCHEMA_ATTEMPTS_KEY])
		} else {
			// Healthy boot clears any stale status from a prior failed run.
			await browserApi.storage.local.remove([SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY])
		}

		// Config + Barretenberg load in parallel — neither depends on the other.
		// Plain Promise.all (not allSettled): a BB failure vetoes the memo so
		// no retry can overlap a still-pending config leg, and a config
		// rejection (its apply() storage write can throw) settles that leg
		// itself before the retry re-runs it — while allSettled would leave the
		// boot promise silently pending forever when a leg hangs after the
		// other failed, which is the defect class this arc exists to remove.
		await Promise.all([
			// Settle log retention the moment the real config is known: the LoggerStore was built
			// at module scope on schema defaults, and rehydrate() has already restored the previous
			// lifecycle's entries unconditionally. `finally` so a REJECTED load still settles it —
			// the config is then defaults, retention reads off, and the safe action (purge) runs;
			// the rejection still propagates and vetoes the boot exactly as before.
			config
				.load()
				.then(() => logger.log("wallet", LogLevel.Info, "Config loaded"))
				.finally(() => logger.applyRetentionPolicy()),
			BarretenbergSync.initSingleton({ wasmPath: process.env.BB_WASM_PATH })
				.then(() => logger.log("wallet", LogLevel.Info, "Barretenberg initialized"))
				.catch((err) => {
					// initSingleton memoizes its rejected promise upstream — an
					// in-lifetime retry can only re-observe this same error.
					retrySafe = false
					throw err
				}),
		])

		// Service graph. Services migrated to ports accept `browserApi`;
		// remaining services still reach into `chrome.*` directly until
		// their migration lands. Registration order here is a visual
		// convention only — actual startup ordering is determined by
		// `ServiceCollection.start()`'s topological phases.
		retrySafe = false
		services.add(new AccountService(logger, browserApi))
		// Same tree-shake contract as the proof gate: constructed only under the
		// statically-false E2E_PROVERLESS constant, so prod builds carry neither
		// the class nor the nulo:e2e:restore-gate key (negative grep enforced).
		const restoreGate = E2E_PROVERLESS ? new ChromeStorageRestoreGate() : undefined
		services.add(new AccountStateService(logger, restoreGate))
		services.add(new AuthRegistryService(logger, browserApi))
		services.add(new ConfigService(config, logger))
		const windowManager = new WindowManager(browserApi.windows, clock, logger)
		services.add(new ContactService(logger, browserApi, restoreGate))
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
		// E2E_PROVERLESS injects the incoming-poll gate (same tree-shaken-in-prod
		// pattern + negative-grep as the proof gate above). Default poll interval kept.
		services.add(
			new IncomingTransferService(
				logger,
				browserApi,
				undefined, // pollIntervalMs (default)
				undefined, // publicReader (production uses the built-in PXE reader)
				E2E_PROVERLESS ? new ChromeStorageIncomingPollGate() : undefined,
			),
		)
		services.add(new PasskeyService(logger, windowManager))
		// Started LAST (declares dependencies on every service it purges) — finding D.
		const deletionCoordinator = new ProfileDeletionCoordinator(logger)
		services.add(deletionCoordinator)
		// Also last-phase: registers as ProfileService's pre-open address verifier + AccountService's
		// operation-time mismatch sink (the address-freeze runtime guard).
		services.add(new AccountIntegrityCoordinator(logger, browserApi))

		// B-03: capture the journal boot cutoff BEFORE services start. Service RPC
		// handlers (including journal-creating ones) go live during `services.start()`,
		// so a popup request replayed mid-startup can create an operation before the
		// reaper's boot sweep runs. Anchoring the cutoff here means every op created
		// in THIS SW lifetime has `createdAt >= journalBootCutoff` and is protected
		// from the aggressive sweep.
		const journalBootCutoff = Date.now()
		await services.start()
		logger.log("wallet", LogLevel.Info, "Services started")

		// Resume any profile deletion a prior SW left tombstoned (crashed
		// mid-cleanup) AND sweep torn imports (F-B24: a restore-pending marker
		// from a PREVIOUS lifetime whose generation matches its row — the
		// compensating delete the import's rollback couldn't durably guarantee).
		// The cutoff is the same pre-`services.start()` instant as the journal's
		// (B-03): a marker written by an import RPC racing startup has
		// `at >= cutoff` and is never touched. Fire-and-forget; idempotent.
		void deletionCoordinator
			.resumePending(journalBootCutoff)
			.catch((error) => logger.log("wallet", LogLevel.Error, "resumePendingDeletions failed", getErrorMessage(error)))

		// Phase 2 Week 4: durable-job reaper. Runs a chrome.alarms-driven
		// sweep + a boot sweep against the operation journal; transitions
		// any non-terminal record older than its stage's grace window to
		// `failed` with kind=`stuck_proving`/`stale_on_resume`. Closes the
		// "popup waits forever on a lost prove" failure mode.
		const journalService = services.get(OperationJournalService.name) as OperationJournalService
		reaper = new JournalReaper(journalService, browserApi.alarms, logger, undefined, journalBootCutoff)
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
				// The journal lives in storage.LOCAL (it moved off session so
				// records survive full browser exits); count it there. Count-only:
				// the storage port strips getBytesInUse, so a byte figure would
				// always be n/a.
				const all = await browserApi.storage.local.get()
				const journalCount = Object.keys(all).filter((k) => k.startsWith("nulo:journal@")).length
				logger.log("wallet", LogLevel.Info, `local storage: ${journalCount} journal records`)
			} catch (error) {
				logger.log("wallet", LogLevel.Debug, "local-storage probe skipped", getErrorMessage(error))
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

	const start = createSingleFlightStart(doStart, () => retrySafe)

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
