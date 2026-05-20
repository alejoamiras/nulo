<route lang="json">
{ "meta": { "title": "Done" } }
</route>

<script setup lang="ts">
import { clearOnboardingTabTracking } from "@/wallet/utils/onboarding-tab"

const appStore = useAppStore()

// Detected on mount so the pin-tip only shows for users who actually need
// it. chrome.action.getUserSettings exists from Chrome 91+; we fall back
// to "not pinned" if the API is missing or rejects.
const isPinned = ref(false)
onMounted(async () => {
	try {
		const settings = await chrome.action.getUserSettings()
		isPinned.value = settings.isOnToolbar === true
	} catch {
		isPinned.value = false
	}
})

async function openWallet() {
	await appStore.setOnboardingCompleted(true)
	await clearOnboardingTabTracking()

	// Ask the SW to open the toolbar popup AFTER we close ourselves. We
	// can't call chrome.action.openPopup from this tab and then close it
	// in the same handler — the popup is anchored to the focused window's
	// toolbar, and the close-this-tab event causes the popup to dismiss
	// immediately (focus loss + window state churn). Routing through the
	// SW decouples the popup lifecycle from the tab's; the SW survives
	// our window.close() and can open the popup against the now-focused
	// remaining tab.
	let messaged = false
	try {
		const currentWindow = await chrome.windows.getCurrent()
		const windowId = typeof currentWindow.id === "number" ? currentWindow.id : undefined
		await chrome.runtime.sendMessage({
			type: "nulo:open-toolbar-popup",
			windowId,
		})
		messaged = true
	} catch (error) {
		console.error("Failed to message SW for openPopup; falling back to window:", error)
	}

	if (messaged) {
		// Give the SW one task to receive + start processing the message,
		// then tear down. Without the gap, the SW message handler hasn't
		// fired yet when we close, and Chrome can drop the pending call.
		setTimeout(() => window.close(), 50)
		return
	}

	// Fallback when messaging the SW isn't possible. Left-positioned
	// popup-shaped window.
	await chrome.windows.create({
		url: chrome.runtime.getURL("src/popup/index.html"),
		type: "popup",
		width: 380,
		height: 660,
		left: 24,
		top: 80,
	})
	window.close()
}
</script>

<template>
	<Flex direction="column" align="center" gap="40" :class="$style.page">
		<StepIndicator :current="4" />
		<Flex direction="column" align="center" gap="16" :class="$style.hero">
			<BrutalistTitle main="You're" sub="In" align="center" />
			<div :class="$style.hero_bar" />
			<Text size="15" color="secondary" height="150" align="center" :class="$style.subhead">
				Access the private coordination internet layer.
			</Text>
			<Text size="13" color="secondary" height="150" align="center" mono :class="$style.tagline">
				Private by default. Sovereign by design.
			</Text>
		</Flex>

		<Flex
			v-if="!isPinned"
			direction="column"
			gap="12"
			:class="$style.tip"
			data-testid="onboarding-pin-tip"
		>
			<Flex align="center" gap="8">
				<MaterialIcon name="extension" :size="16" color="secondary" />
				<Text size="11" weight="700" color="secondary" :class="$style.tip_label">Pro tip</Text>
			</Flex>
			<Text size="13" color="secondary" height="150">
				Click the puzzle icon in your Chrome toolbar, then pin Nulo for
				quick access. That's how you'll open the wallet from now on.
			</Text>
		</Flex>

		<Button
			variant="cta"
			size="large"
			data-testid="onboarding-done-open"
			@click="openWallet"
		>
			Open wallet
		</Button>
	</Flex>
</template>

<style module>
.page {
	max-width: 440px;
	width: 100%;
	margin: 48px auto 0;
}

.hero {
	padding: 24px 0;
}

.hero_bar {
	width: 56px;
	height: 2px;
	background: var(--nulo-accent);
}

.subhead {
	max-width: 380px;
}

.tagline {
	letter-spacing: 0.06em;
	text-transform: uppercase;
	opacity: 0.65;
}

.tip {
	width: 100%;
	padding: 16px 20px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
	border-left: 2px solid var(--nulo-outline);
}

.tip_label {
	font-family: var(--font-headline);
	text-transform: uppercase;
	letter-spacing: 0.18em;
}
</style>
