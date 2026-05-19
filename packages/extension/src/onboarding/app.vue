<script setup lang="ts">
/** Services */
import { managers } from "@/utils/core"

/** Composables */
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"

/** Store */
import { useAppStore } from "@/stores/app.store"

const appStore = useAppStore()
const router = useRouter()
const { hydrateKnownProfile } = useProfileBootstrap()

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
		// Landed on onboarding URL after completion — punt back to popup.
		await openPopupWindowAndClose()
		return
	}

	// Try to hydrate an existing active profile. Returns the profile if one
	// is active (session unlocked); null if no profile OR profile is locked.
	const active = await hydrateKnownProfile()
	if (active) {
		// Profile + session live → user is mid-onboarding; resume at /learn.
		router.replace("/onboarding/learn")
		return
	}

	// No active profile. Check whether profiles exist (locked) or not at all.
	const profiles = await managers.profile.getProfiles()
	if (profiles.length === 0) {
		// Fresh setup — stay on /onboarding/welcome (default route).
		return
	}

	// Profile exists but session is locked. Bounce to popup auth window.
	// After unlock, popup's register/import redirect re-opens this tab.
	await openPopupWindowAndClose()
})
</script>

<template>
	<main :class="$style.shell">
		<!-- Passkey ceremony dialog teleports to #popup. The popup app.vue
			declares this anchor too; the onboarding shell must mirror it
			or PasskeyCeremonyDialog silently fails to render. -->
		<div id="popup" />
		<div id="tooltip" />
		<div id="dropdown" />
		<div id="popover" />
		<div id="toast" />

		<NotificationManager />
		<GlobalLoader />

		<RouterView v-slot="{ Component }">
			<transition name="onboarding-fade" mode="out-in">
				<component :is="Component" />
			</transition>
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
	color: var(--app-text);
	padding: 32px 24px 64px;
	box-sizing: border-box;
}
</style>

<style>
/* Page transition. Defined globally (not :module) so it works across SFC
 * boundaries — the <transition> wraps the router view's component, not
 * the .shell. */
.onboarding-fade-enter-active,
.onboarding-fade-leave-active {
	transition: opacity 180ms ease;
}
.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
	opacity: 0;
}
</style>
