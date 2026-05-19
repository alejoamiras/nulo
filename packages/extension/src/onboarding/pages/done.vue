<route lang="json">
{ "meta": { "title": "Done" } }
</route>

<script setup lang="ts">
import { clearOnboardingTabTracking } from "@/wallet/utils/onboarding-tab"

const appStore = useAppStore()

async function openWallet() {
	await appStore.setOnboardingCompleted(true)
	await clearOnboardingTabTracking()
	// Done CTA always opens a popup-shaped window directly. We avoid
	// chrome.action.openPopup because it requires the extension to already
	// be pinned to the toolbar — contradicts the pin-tip on this same screen,
	// and behavior varies pre-Chrome-127 (Codex review).
	await chrome.windows.create({
		url: chrome.runtime.getURL("src/popup/index.html"),
		type: "popup",
		width: 380,
		height: 620,
	})
	window.close()
}
</script>

<template>
	<Flex direction="column" align="center" :class="$style.page">
		<header :class="$style.hero">
			<h1 :class="$style.title">You're all set.</h1>
			<p :class="$style.subtitle">Your wallet is ready.</p>
		</header>

		<div :class="$style.pinTip" data-testid="onboarding-pin-tip">
			<span :class="$style.pinTipLabel">Tip</span>
			<p :class="$style.pinTipBody">
				Click the puzzle icon in your Chrome toolbar, then pin Nulo for
				quick access.
			</p>
		</div>

		<button
			type="button"
			:class="$style.cta"
			data-testid="onboarding-done-open"
			@click="openWallet"
		>
			Open wallet
		</button>
	</Flex>
</template>

<style module>
.page {
	max-width: 480px;
	width: 100%;
	margin: 96px auto 0;
	gap: 40px;
}

.hero {
	text-align: center;
}

.title {
	font-size: 36px;
	letter-spacing: -0.02em;
	font-weight: 600;
	margin: 0 0 8px;
	color: var(--app-text);
}

.subtitle {
	font-size: 17px;
	color: var(--text-secondary, #8a8a8a);
	margin: 0;
}

.pinTip {
	background: var(--surface, #121212);
	border: 1px solid var(--border-color, #2a2a2a);
	border-radius: 10px;
	padding: 16px 20px;
	width: 100%;
	box-sizing: border-box;
}
.pinTipLabel {
	display: block;
	font-size: 11px;
	color: var(--text-faint, #555);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	margin-bottom: 6px;
}
.pinTipBody {
	margin: 0;
	font-size: 14px;
	color: var(--text-secondary, #c0c0c0);
	line-height: 1.5;
}

.cta {
	width: 100%;
	padding: 16px 24px;
	border-radius: 10px;
	border: 1px solid var(--app-text);
	background: var(--app-text);
	color: var(--app-bg);
	font: inherit;
	font-weight: 600;
	font-size: 16px;
	cursor: pointer;
	transition: opacity 140ms ease;
}
.cta:hover {
	opacity: 0.85;
}
.cta:active {
	opacity: 0.7;
}
</style>
