<script setup>
/** Components */
import PopupManager from "./components/popups/PopupManager.vue"
import Navigation from "./components/Navigation.vue"

/** Utils */
import { managers, isBackgroundConnected } from "@/utils/core"
import { isPrefersDarkScheme, persistThemeHint } from "@/utils/general"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
import { shouldAdvanceToGeneral } from "./should-advance-to-general"
import { defaultConfig } from "@/wallet/config"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { createNetworkSwitchHandler } from "@/popup/network-switch"
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
		await bootstrapActiveProfile(profile)
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

const loadProfile = async () => {
	managers.profile.onActiveProfileChanged.add(onActiveProfileChanged)
	managers.profile.onImportedKeysDegraded.add(onImportedKeysDegraded)

	appStore.profiles = await managers.profile.getProfiles()
	const activeProfile = await managers.profile.getActiveProfile()
	if (activeProfile) {
		const stillActive = await bootstrapActiveProfile(activeProfile)
		appStore.isSessionChecked = true

		// Only advance into the authed area if the session survived bootstrap (a lock
		// mid-bootstrap leaves stillActive=false). See shouldAdvanceToGeneral.
		if (shouldAdvanceToGeneral(stillActive, route.name)) router.push("/popup/general")

		return
	}

	if (!appStore.profile) {
		if (route.meta.isPasskeyInteraction) {
			return
		}

		if (appStore.profiles.length) {
			const lastActiveId = await getLastActiveProfileId()
			const lastActive = lastActiveId ? appStore.profiles.find((p) => p.id === lastActiveId) : undefined
			appStore.profile = lastActive ?? appStore.profiles[0]

			appStore.isSessionChecked = true

			router.push("/popup/auth")
			return
		}
	}

	appStore.isSessionChecked = true
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
	console._log("%cHold up!", styleTitle)
	console._log(
		"%cIf someone asks you to do something in this interface (DevTools), 100% they are trying to scam you. If you don't know what you are doing, close this window (cross in the upper right corner).",
		styleText,
	)
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
	<Flex wide direction="column" :class="$style.wrapper">
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
