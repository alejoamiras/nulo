<script setup>
/** Components */
import PopupManager from "./components/popups/PopupManager.vue"
import Navigation from "./components/Navigation.vue"

/** Utils */
import { managers, isBackgroundConnected } from "@/utils/core"
import { isPrefersDarkScheme, persistThemeHint } from "@/utils/general"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
import { shouldAdvanceToGeneral } from "./should-advance-to-general"
import { lookupActiveProfileWithBackoff } from "./auth-guard"
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

/** How the boot-time session check ended when it could NOT decide: the service stayed
 *  unreachable across the backoff, or the activation bootstrap threw. Rendered as
 *  `data-boot-outcome` on the shell so the lock screen the user lands on is distinguishable
 *  from the transient one the route guard parks a still-deciding popup on. Empty = deciding
 *  or decided. */
const bootOutcome = ref("")

/** The boot-time check gave up: mark it done so the guard's own retry takes over, and land on
 *  the lock screen — the password path is the recovery, and it must be reachable. An
 *  un-checked session would otherwise park the popup on /popup/auth for good. `outcome` is
 *  "unreachable" or "failed". */
const settleUndecidedBoot = (outcome) => {
	bootOutcome.value = outcome
	appStore.isSessionChecked = true
	router.push("/popup/auth")
}

// Generation fence for loadProfile: mount and every background reconnect start a run, and a
// run that awaited past a newer one must not commit — its push or marker would land on top of
// the newer run's (or the user's own unlock's) state.
let loadProfileSeq = 0

/** The boot-time reads, both through the guard's backoff: right after a service-worker restart
 *  the first requests can reject while the worker is still booting, and a rejection here used
 *  to leave `isSessionChecked` false forever (the guard answers "auth" without retrying while
 *  it is). The profile list decides register-vs-auth, so a stale one must never stand in.
 *  Resolves to the active profile, `undefined` for a clean lock, or "unreachable"; a run
 *  superseded mid-read resolves "superseded" and its caller commits nothing. */
const readBootSession = async (isCurrent) => {
	const profiles = await lookupActiveProfileWithBackoff(() => managers.profile.getProfiles())
	if (!isCurrent()) return "superseded"
	if (profiles.kind === "unreachable") return "unreachable"
	appStore.profiles = profiles.kind === "active" ? profiles.profile : []
	const lookup = await lookupActiveProfileWithBackoff(() => managers.profile.getActiveProfile())
	if (!isCurrent()) return "superseded"
	if (lookup.kind === "unreachable") return "unreachable"
	return lookup.kind === "active" ? lookup.profile : undefined
}

/** No open session: pick the lock screen's profile (the last active one, else the first) and
 *  land on it, or stay put on a passkey-interaction route. */
const landOnLockScreen = async (isCurrent) => {
	if (appStore.profile || route.meta.isPasskeyInteraction || !appStore.profiles.length) {
		if (!route.meta.isPasskeyInteraction || appStore.profile) appStore.isSessionChecked = true
		return
	}
	const lastActiveId = await getLastActiveProfileId()
	if (!isCurrent()) return
	const lastActive = lastActiveId ? appStore.profiles.find((p) => p.id === lastActiveId) : undefined
	appStore.profile = lastActive ?? appStore.profiles[0]
	appStore.isSessionChecked = true
	router.push("/popup/auth")
}

const loadProfile = async () => {
	const seq = ++loadProfileSeq
	const isCurrent = () => seq === loadProfileSeq
	// A new run supersedes any earlier give-up: it may well succeed this time.
	bootOutcome.value = ""
	managers.profile.onActiveProfileChanged.add(onActiveProfileChanged)
	managers.profile.onImportedKeysDegraded.add(onImportedKeysDegraded)

	const session = await readBootSession(isCurrent)
	// The helper fenced itself before resolving; this caller resumes a microtask later, and a
	// reconnect can bump the sequence in between — fence again here, never on the helper's word.
	if (session === "superseded" || !isCurrent()) return
	if (session === "unreachable") {
		settleUndecidedBoot("unreachable")
		return
	}
	if (session === undefined) {
		await landOnLockScreen(isCurrent)
		return
	}

	let stillActive = false
	try {
		stillActive = await bootstrapActiveProfile(session)
	} catch (error) {
		if (!isCurrent()) return
		console.error("activation bootstrap failed", { error })
		settleUndecidedBoot("failed")
		return
	}
	if (!isCurrent()) return
	appStore.isSessionChecked = true

	// Only advance into the authed area if the session survived bootstrap (a lock
	// mid-bootstrap leaves stillActive=false). See shouldAdvanceToGeneral.
	if (shouldAdvanceToGeneral(stillActive, route.name)) router.push("/popup/general")
}

onBeforeMount(async () => {
	await router.isReady()

	const settings = await configService.getProps()
	settings.forEach(applySetting)

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

watch(
	() => isBackgroundConnected.value,
	() => {
		if (isBackgroundConnected.value) {
			loadProfile()
		}
	},
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
</style>
