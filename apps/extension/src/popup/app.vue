<script setup>
/** Components */
import PopupManager from "./components/popups/PopupManager.vue"
import Navigation from "./components/Navigation.vue"

/** Utils */
import { managers, isBackgroundConnected } from "@/utils/core"
import { isPrefersDarkScheme, persistThemeHint } from "@/utils/general"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
import { shouldAdvanceToGeneral } from "./should-advance-to-general"
import { resolveBootSession } from "./boot-session"
import { decideLockLanding } from "./lock-landing"
import { reconcileLockedBoot } from "./reconcile-locked-boot"
import { defaultConfig } from "@/wallet/config"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { createNetworkSwitchHandler } from "@/popup/network-switch"
import { runFencedBootstrap } from "@/popup/profile-bootstrap"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Composables */
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const { bootstrapActiveProfile } = useProfileBootstrap()
const { openToast } = useToast()

/** Update theme */
const root = document.querySelector("html")
const theme = ref(defaultConfig().theme)
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (_event) => {
	if (theme.value === "system") root.setAttribute("theme", isPrefersDarkScheme() ? "dark" : "light")
})

import LogoIcon from "@/assets/logo.svg?raw"

const route = useRoute()
const router = useRouter()

/** Set data-has-nav on <html> so pages can use var(--nav-clearance) for bottom padding */
watch(
	() => route.meta.showBottomNav,
	(showBottomNav) => {
		root.setAttribute("data-has-nav", showBottomNav ? "true" : "false")
	},
	{ immediate: true },
)

const configService = new ConfigServiceClient()
configService.onUpdate.add(applySetting)

const intervalId = ref(null)

const settingHandlers = {
	theme(value) {
		theme.value = value
		persistThemeHint(value)
		if (value === "system") {
			root.setAttribute("theme", isPrefersDarkScheme() ? "dark" : "light")
		} else {
			root.setAttribute("theme", value)
		}
	},
	disableAnimations(value) {
		root.classList.toggle("noanimations", Boolean(value))
	},
	sidePanel(value) {
		chrome.sidePanel.setPanelBehavior({
			openPanelOnActionClick: Boolean(value),
		})
	},
	defaultExplorer(value) {
		appStore.defaultExplorer = value
	},
}
function applySetting(setting) {
	const handler = settingHandlers[setting.key]
	if (typeof handler === "function") {
		handler(setting.value)
	}
}

// initNetworks / initAccount factored into useProfileBootstrap. The compatible
// `bootstrapActiveProfile(profile)` below replays the same chain. The chain
// watchers below still reach into `managers.network`/`managers.account`
// directly because they're popup-local (chain switch, etc.) and don't need
// the bootstrap helper.

/** todo: ref */
watch(
	() => appStore.account,
	() => {
		if (!appStore.account || !appStore.isLogined) return

		if (managers.transaction) {
			appStore.syncTransactions()
		}
	},
)

// Identity-fenced network-switch orchestration — the body lives in
// `network-switch.ts` so its fence is unit-testable (this shell has no
// harness). The factory owns run invalidation, scope capture, and the
// generation+live-scope guard at every await boundary.
watch(
	() => appStore.network,
	createNetworkSwitchHandler({
		getScope: () =>
			appStore.network && appStore.profile ? { profileId: appStore.profile.id, chainId: appStore.network.chainId } : undefined,
		liveScopeMatches: (scope) => appStore.profile?.id === scope.profileId && appStore.network?.chainId === scope.chainId,
		syncNetworkStatus: () => appStore.syncNetworkStatus(),
		replaceAccountClient: () => {
			managers.account?.disconnect()
			managers.account = new AccountServiceClient()
			return managers.account
		},
		setAccounts: (accounts) => {
			appStore.accounts = accounts
		},
		setupActiveAccount: () => appStore.setupActiveAccount(),
		syncTransactions: () => appStore.syncTransactions(),
	}),
)

/** Sequence token for profile events. Handlers await service round-trips, and under load a
 *  stale LOCK event can resume after its own unlock has already re-activated the profile — its
 *  routing side effects would eject an active session to the auth screen (observed as e2e
 *  navigation stalls under CPU restriction). A newer event of either kind supersedes every
 *  older handler; superseded handlers abandon their mutations instead of racing them. */
let profileEventSeq = 0

const onActiveProfileChanged = async (profile) => {
	const seq = ++profileEventSeq
	if (profile) {
		// bootstrapActiveProfile carries its own lock-wins guard: a stale profile event whose
		// session was already locked re-checks getActiveProfile() before flipping isLogined.
		// The wrap is load-bearing: an emitter-callback rejection would otherwise become an
		// unhandled rejection that silently starves the unlock flow's activation wait. The
		// identity-keyed failure record releases that waiter IMMEDIATELY (never the full
		// timeout); the seq fence makes the channel compare-and-commit, so a superseded run
		// can neither clear a newer run's record nor toast over a newer profile's outcome.
		await runFencedBootstrap({
			profileId: profile.id,
			bootstrap: () => bootstrapActiveProfile(profile),
			isCurrent: () => seq === profileEventSeq,
			setFailure: (record) => {
				appStore.bootstrapFailure = record
			},
			shouldToast: () => !appStore.isLogined || appStore.profile?.id === profile.id,
			toast: () => openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG),
		})
		return
	}
	// Lock cleanup must survive a failed lookup: a transport rejection here (SW churn at the
	// exact moment of a lock) must not leave the popup rendered as authenticated over a closed
	// session. The list only picks auth vs register — the cached one is good enough for that.
	let profiles = appStore.profiles
	try {
		profiles = await managers.profile.getProfiles()
	} catch {
		// Cached list stands in; the cleanup below runs regardless.
	}
	if (seq !== profileEventSeq) return
	enterLockedState(profiles)
}

/** The popup's locked state, entered from the lock event and from a boot-time session check
 *  that finds no session under an authenticated page (a worker restart). */
const enterLockedState = (profiles) => {
	popupStore.closeAll()
	appStore.isLogined = false
	// Every cached scope goes with the lock, so no profile's activity outlives
	// it in memory. Switching profiles runs through lock/unlock, which means a
	// switch deliberately starts cold rather than repainting from cache.
	appStore.clearActivity()
	appStore.profiles = profiles
	router.push(appStore.profiles.length ? "/popup/auth" : "/popup/register")
}

/** The profile unlocked DERIVED-ONLY: its imported-keys DEK (or the envelope MAC over it) failed,
 *  so every imported account is unusable until the cause is repaired. The service deliberately does
 *  NOT block the profile — derived funds stay reachable — which means this warning is the only
 *  signal the user gets before an imported account fails at use time. */
const onImportedKeysDegraded = (profile) => {
	openToast({ label: `Imported accounts unavailable in "${profile.name}"`, icon: "warning" }, TOAST_DURATION.LONG)
}

/** How the boot-time session check ended when it could NOT decide: "unreachable" (the service
 *  stayed unreachable across the backoff) or "failed" (an OPEN session whose activation
 *  bootstrap threw). Rendered as `data-boot-outcome` on the shell plus a banner with RETRY,
 *  so the user (and the e2e harness) can tell it from the transient lock screen the route guard
 *  parks a still-deciding popup on. Empty = deciding or decided. */
const bootOutcome = ref("")
// True from a RETRY pressed on a FAILED boot until that run reaches a decision: the marker
// clears at run start (the run may succeed), but the auth form must stay withheld meanwhile —
// re-enabling it mid-retry would invite a password into a screen about to route away.
const bootRetrying = ref(false)
// The auth page reads both to withhold its form while a FAILED boot's banner is the only true
// recovery: a password typed there would unlock an already-open session and repair nothing.
provide("bootOutcome", bootOutcome)
provide("bootRetrying", bootRetrying)

/** The boot-time check gave up. Mark it done so the guard's own retry takes over — an
 *  un-checked session would park the popup on /popup/auth for good. Unreachable with a known
 *  profile lands on the lock screen (the password path is a recovery, so it must be reachable,
 *  and the auth page needs a selected profile to submit against); unreachable with no profile
 *  known, and a failed bootstrap over an OPEN session, are NOT locks — re-entering a password
 *  repairs neither — so the popup stays put and the banner's RETRY is the recovery. */
const settleUndecidedBoot = (outcome, candidate) => {
	bootOutcome.value = outcome
	appStore.isSessionChecked = true
	if (outcome !== "unreachable") return
	if (!appStore.profile && candidate) appStore.profile = candidate
	if (appStore.profile) router.push("/popup/auth")
}

/** No open session. Which way the shell goes is `decideLockLanding` over the shell's state at
 *  action time; `reconcileLockedBoot` fences the `lock` action against an unlock that landed
 *  through the event path while the lookup was in flight. */
const lockLandingState = (result) => ({
	hasProfile: !!appStore.profile,
	onAuthRequiredRoute: !!route.meta.isAuthRequired,
	isPasskeyRoute: !!route.meta.isPasskeyInteraction,
	hasCandidate: !!result.candidate,
})
const lockLandingActions = {
	selectAndAuth: (result) => {
		appStore.profile = result.candidate
		appStore.isSessionChecked = true
		router.push("/popup/auth")
	},
	lock: (result) => {
		appStore.isSessionChecked = true
		enterLockedState(result.profiles)
	},
	settle: () => {
		appStore.isSessionChecked = true
	},
}

// Generation fence for loadProfile: mount and every background reconnect start a run, and a
// run that awaited past a newer one must not commit — its push or marker would land on top of
// the newer run's (or the user's own unlock's) state.
let loadProfileSeq = 0

const loadProfile = async () => {
	const seq = ++loadProfileSeq
	const isCurrent = () => seq === loadProfileSeq
	// A new run supersedes any earlier give-up: it may well succeed this time. A retry of a
	// FAILED boot keeps the auth form withheld until a run DECIDES — latched, not recomputed:
	// a reconnect that starts a newer run mid-retry sees an empty outcome and must not drop it.
	bootRetrying.value = bootRetrying.value || bootOutcome.value === "failed"
	bootOutcome.value = ""
	managers.profile.onActiveProfileChanged.add(onActiveProfileChanged)
	managers.profile.onImportedKeysDegraded.add(onImportedKeysDegraded)

	const result = await reconcileLockedBoot({
		readEventSeq: () => profileEventSeq,
		isCurrent,
		lookup: () =>
			resolveBootSession({
				getProfiles: () => managers.profile.getProfiles(),
				getActiveProfile: () => managers.profile.getActiveProfile(),
				bootstrap: (profile) => bootstrapActiveProfile(profile),
				lastActiveProfileId: getLastActiveProfileId,
				isCurrent,
			}),
		decide: (locked) => decideLockLanding(lockLandingState(locked)),
		act: lockLandingActions,
	})
	// The core fenced itself before resolving; this caller resumes a microtask later, and a
	// reconnect can bump the sequence in between — fence again here, never on the core's word.
	if (result.kind === "superseded" || !isCurrent()) return
	// An event landed while the lookup was in flight: the event path owns the outcome, and this
	// run's profile list and candidate are stale — apply nothing.
	if (result.kind === "event-superseded") return
	// A decision — of any kind — ends the retrying presentation; a newer run owns the next one.
	bootRetrying.value = false
	appStore.profiles = result.profiles
	if (result.kind === "unreachable") return settleUndecidedBoot("unreachable", result.candidate)
	if (result.kind === "failed") {
		console.error("activation bootstrap failed for the open session", { profileId: result.profile.id })
		return settleUndecidedBoot("failed", undefined)
	}
	// The reconcile already acted on a lock, under its fences.
	if (result.kind === "locked") return

	appStore.isSessionChecked = true
	// Only advance into the authed area if the session survived bootstrap (a lock
	// mid-bootstrap leaves stillActive=false). See shouldAdvanceToGeneral.
	if (shouldAdvanceToGeneral(result.stillActive, route.name)) router.push("/popup/general")
}

onBeforeMount(async () => {
	await router.isReady()

	// Settings are cosmetic (theme, links…): a read that rejects during a service-worker
	// restart keeps the defaults and must never keep the session check from running.
	try {
		const settings = await configService.getProps()
		settings.forEach(applySetting)
	} catch (error) {
		console.error("settings read failed at boot; defaults kept", { error })
	}

	await loadProfile()
})

onMounted(async () => {
	/** DevTools Warnings -> Logo + Scam Prevention */
	const svgDataUrl = `data:image/svg+xml;base64,${btoa(LogoIcon)}`

	// biome-ignore lint/suspicious/noConsole: `_log` is the sniffer's saved original — this banner must reach the real DevTools console, not the log store.
	console._log(
		"%c ",
		`
			background-image: url(${svgDataUrl});
			padding-bottom: 100px;
			padding-left: 100px;
			margin: 20px;
			background-size: contain;
			background-position: center center;
			background-repeat: no-repeat;
		`,
	)

	const styleTitle = "color: #fff; font-family: sans-serif; font-size: 10em;"
	const styleText =
		"color: #fff; font-family: sans-serif; font-size: 2em; padding: 40px; border-radius: 24px; border: 2px solid orange; background: #1f1f1f; line-height: 160%"
	// biome-ignore lint/suspicious/noConsole: `_log` is the sniffer's saved original — this banner must reach the real DevTools console, not the log store.
	console._log("%cHold up!", styleTitle)
	// biome-ignore lint/suspicious/noConsole: `_log` is the sniffer's saved original — this banner must reach the real DevTools console, not the log store.
	console._log(
		"%cIf someone asks you to do something in this interface (DevTools), 100% they are trying to scam you. If you don't know what you are doing, close this window (cross in the upper right corner).",
		styleText,
	)
	// biome-ignore lint/suspicious/noConsole: `_log` is the sniffer's saved original — this banner must reach the real DevTools console, not the log store.
	console._log("%cYou can report a scam through the form: https://nulo.sh/forms/report-scam", styleText)
	/****************** */

	intervalId.value = window.setInterval(() => {
		if (!appStore.isLogined) return

		const _ = managers.profile?.getActiveProfile()
	}, 10_000)
})

watch(
	() => route.name,
	() => {
		if (appStore.isLogined) {
			const _ = managers.profile?.refreshSession()
		}

		appStore._isHomeScreenOpened = route.name === "popup-register" || route.name?.includes("windows-")
	},
)

// `flush: "sync"` is load-bearing: the port client reconnects synchronously inside its own
// disconnect callback (a dead worker is woken by `chrome.runtime.connect`, which returns at
// once), so the flag goes false → true in ONE tick and a batched watcher sees no change at all.
// Every worker restart under an open popup must start a boot run, or the shell keeps a session
// that no longer exists.
watch(
	() => isBackgroundConnected.value,
	(connected) => {
		if (connected) loadProfile()
	},
	{ flush: "sync" },
)

onBeforeUnmount(() => {
	clearInterval(intervalId.value)
	configService.disconnect()
})
</script>

<template>
	<Flex wide direction="column" :class="$style.wrapper" :data-boot-outcome="bootOutcome || undefined">
		<!-- Popup Teleport -->
		<div id="popup" />
		<div id="tooltip" />
		<div id="dropdown" />
		<div id="popover" />
		<div id="toast" />

		<div>
			<PopupManager />
			<ToastManager />
			<NotificationManager />
			<GlobalLoader />
			<MigrationBarrier />
			<AccountIntegrityBarrier />
		</div>

		<Header />

		<Banner v-if="bootOutcome || bootRetrying" variant="warning" direction="vertical" data-testid="boot-outcome-banner">
			<Text size="13" weight="500">
				{{
					bootRetrying
						? "Retrying…"
						: bootOutcome === "failed"
							? "The wallet could not finish starting up."
							: "The wallet service could not be reached."
				}}
			</Text>
			<button type="button" :class="$style.retry" data-testid="boot-retry" :disabled="bootRetrying" @click="loadProfile()">RETRY</button>
		</Banner>

		<RouterView v-slot="{ Component }">
			<component :is="Component"></component>
		</RouterView>

		<Navigation v-if="$route.meta.showBottomNav" />
	</Flex>
</template>

<style module>
.wrapper {
	position: relative;

	overflow: hidden;
}

.retry {
	align-self: flex-start;
	margin-top: 8px;
	padding: 4px 10px;
	font: inherit;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	color: inherit;
	background: transparent;
	border: 1px solid currentColor;
	border-radius: 4px;
	cursor: pointer;
}
</style>
