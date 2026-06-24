<script setup>
/** Components */
import PopupManager from "./components/popups/PopupManager.vue"
import Navigation from "./components/Navigation.vue"

/** Utils */
import { managers, isBackgroundConnected } from "@/utils/core"
import { isPrefersDarkScheme, persistThemeHint } from "@/utils/general"
import { getLastActiveProfileId } from "@/utils/lastActiveProfile"
import { Config } from "@/wallet/config"
import { AccountServiceClient, AccountType } from "@/wallet/services/account/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Composables */
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const { bootstrapActiveProfile } = useProfileBootstrap()

/** Update theme */
const root = document.querySelector("html")
const theme = ref(new Config().theme)
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

/** todo: ref */
watch(
	() => appStore.network,
	async () => {
		if (!appStore.network) return

		appStore.syncNetworkStatus()

		// Re-fetch accounts for the new chain, and auto-create a default if
		// the chain has NO accounts yet. The earlier comment here said
		// auto-create lives ONLY in `initAccount()` to avoid a duplicate-
		// account race during initial profile load. The empty-list guard
		// below preserves that property: when `initAccount()` already
		// created the default for the current chain, `getAccounts()` returns
		// non-empty and we skip the second `ensureDefaultAccount` call.
		// When the user switches to a chain with no prior accounts (which
		// is the common case for the freshly-deployed Local Network in
		// e2e), `getAccounts` returns empty and we deterministically derive
		// + persist a default. Without this, the popup is stranded with
		// `account = undefined` indefinitely on freshly-switched chains
		// and every reader of `appStore.account.address` (NewTokenPopup,
		// NewContactPopup, EditContactPopup, etc.) silently fails.
		managers.account?.disconnect()
		managers.account = new AccountServiceClient()
		appStore.accounts = await managers.account.getAccounts(appStore.profile.id, appStore.network.chainId, true)
		if (appStore.accounts.length === 0) {
			await managers.account.ensureDefaultAccount(appStore.profile.id, appStore.network.chainId, AccountType.Nulo_v1, "Account")
			appStore.accounts = await managers.account.getAccounts(appStore.profile.id, appStore.network.chainId, true)
		}
		await appStore.setupActiveAccount()
		await appStore.syncTransactions()
	},
)

const onActiveProfileChanged = async (profile) => {
	if (profile) {
		await bootstrapActiveProfile(profile)
	} else {
		popupStore.closeAll()
		appStore.isLogined = false
		appStore.profiles = await managers.profile.getProfiles()
		router.push(appStore.profiles.length ? "/popup/auth" : "/popup/register")
	}
}

const loadProfile = async () => {
	managers.profile.onActiveProfileChanged.add(onActiveProfileChanged)

	appStore.profiles = await managers.profile.getProfiles()
	const activeProfile = await managers.profile.getActiveProfile()
	if (activeProfile) {
		await bootstrapActiveProfile(activeProfile)
		appStore.isSessionChecked = true

		if (["popup-register", "popup-auth"].includes(route.name)) router.push("/popup/general")

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
