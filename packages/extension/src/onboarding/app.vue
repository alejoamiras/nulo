<script setup lang="ts">
/** Services */
import { managers } from "@/utils/core"

/** Composables */
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"

/** Utils */
import { isPrefersDarkScheme } from "@/utils/general"
import { Config } from "@/wallet/config"

/** Store */
import { useAppStore } from "@/stores/app.store"

const appStore = useAppStore()
const router = useRouter()
const { hydrateKnownProfile } = useProfileBootstrap()

/** Theme bootstrap — mirror popup/app.vue's behavior so onboarding respects
 * the same light/dark/system preference. Reads from Config (chrome.storage). */
const root = document.querySelector("html")
type Theme = "dark" | "light" | "system"
const theme = ref<Theme>(new Config().theme as Theme)
function applyTheme(value: Theme) {
	theme.value = value
	if (value === "system") {
		root?.setAttribute("theme", isPrefersDarkScheme() ? "dark" : "light")
	} else {
		root?.setAttribute("theme", value)
	}
}
applyTheme(theme.value)
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if (theme.value === "system") root?.setAttribute("theme", isPrefersDarkScheme() ? "dark" : "light")
})

const POPUP_URL = chrome.runtime.getURL("src/popup/index.html")
const ONBOARDING_TAB_ID_KEY = "nulo:onboarding:tab-id"

async function openPopupWindowAndClose() {
	await chrome.windows.create({
		url: POPUP_URL,
		type: "popup",
		width: 380,
		height: 620,
	})
	await chrome.storage.session.remove(ONBOARDING_TAB_ID_KEY)
	window.close()
}

onMounted(async () => {
	await appStore.loadOnboardingCompleted()

	if (appStore.onboardingCompleted) {
		await openPopupWindowAndClose()
		return
	}

	const active = await hydrateKnownProfile()
	if (active) {
		router.replace("/onboarding/learn")
		return
	}

	const profiles = await managers.profile.getProfiles()
	if (profiles.length === 0) {
		return
	}

	await openPopupWindowAndClose()
})
</script>

<template>
	<main :class="$style.shell">
		<!-- Passkey ceremony dialog teleports to #popup. The popup app.vue
			declares this anchor too; onboarding mirrors it. -->
		<div id="popup" />
		<div id="tooltip" />
		<div id="dropdown" />
		<div id="popover" />
		<div id="toast" />

		<PopupManager />
		<ToastManager />
		<NotificationManager />
		<GlobalLoader />

		<!-- Brand signature: lock icon + NULO wordmark — same as popup
			register page, so the onboarding tab feels like Nulo from the
			very first paint. -->
		<Flex tag="header" align="center" justify="center" gap="8" :class="$style.brand">
			<MaterialIcon name="lock" :size="18" color="primary" />
			<span :class="$style.wordmark">NULO</span>
		</Flex>

		<RouterView v-slot="{ Component }">
			<component :is="Component" />
		</RouterView>
	</main>
</template>

<style module>
.shell {
	display: flex;
	flex-direction: column;
	min-height: 100vh;
	width: 100%;
	background: var(--app-bg);
	color: var(--txt-primary);
	padding: 24px 24px 64px;
	box-sizing: border-box;
}

.brand {
	padding: 8px 0 24px;
}

.wordmark {
	font-family: var(--font-headline);
	font-size: 20px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--txt-primary);
}
</style>
