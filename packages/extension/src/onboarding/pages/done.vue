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

	// Always try chrome.action.openPopup() first — it opens the NATIVE
	// toolbar action popup, anchored to where Chrome decides (toolbar icon
	// if pinned, action overflow otherwise). Pinning is a UI hint, NOT an
	// API precondition (per codex audit + Chrome docs). The previous
	// implementation incorrectly gated this on isPinned, which made every
	// unpinned user fall through to the windowed fallback.
	//
	// Pass windowId explicitly so Chrome targets the onboarding tab's
	// window. Without it, the API can reject if the current window isn't
	// resolvable as the active normal window.
	try {
		const currentWindow = await chrome.windows.getCurrent()
		if (typeof currentWindow.id !== "number") throw new Error("No current Chrome window id")
		await chrome.action.openPopup({ windowId: currentWindow.id })
		// Let Chrome finish surfacing the popup before the tab tears down.
		setTimeout(() => window.close(), 0)
		return
	} catch (error) {
		// Log instead of swallow so we can see WHY this fails in devtools.
		// Real failure modes documented by Chromium:
		//   - No active browser window / focused window
		//   - Extension has no popup on the active tab (e.g. action.disable was called)
		//   - Browser window has no toolbar (devtools window, etc.)
		console.error("chrome.action.openPopup failed", error)
	}

	// Fallback: open a popup-shaped window. Left-positioned, slightly less
	// tall than the native toolbar popup so it's visually distinct.
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
			<h1 :class="$style.title_stack">
				<span :class="$style.title_main">You're</span>
				<span :class="$style.title_sub">In</span>
			</h1>
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

.title_stack {
	display: flex;
	flex-direction: column;
	align-items: center;
	line-height: 0.95;
	gap: 4px;
	margin: 0;
	font-weight: 700;
}

.title_main {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.title_sub {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
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
