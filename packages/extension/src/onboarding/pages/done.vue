<route lang="json">
{ "meta": { "title": "Done" } }
</route>

<script setup lang="ts">
import { clearOnboardingTabTracking } from "@/wallet/utils/onboarding-tab"

const appStore = useAppStore()

async function openWallet() {
	await appStore.setOnboardingCompleted(true)
	await clearOnboardingTabTracking()
	// Use chrome.windows.create directly, not chrome.action.openPopup —
	// the latter requires the extension already pinned to the toolbar
	// (which contradicts our pin-tip on this same screen).
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
	<Flex direction="column" align="center" gap="40" :class="$style.page">
		<Flex direction="column" align="center" gap="16" :class="$style.hero">
			<h1 :class="$style.title_stack">
				<span :class="$style.title_main">You're</span>
				<span :class="$style.title_sub">All Set</span>
			</h1>
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150" align="center">
				Your wallet is ready.
			</Text>
		</Flex>

		<Flex direction="column" gap="12" :class="$style.tip" data-testid="onboarding-pin-tip">
			<Flex align="center" gap="8">
				<MaterialIcon name="extension" :size="16" color="secondary" />
				<Text size="11" weight="700" color="secondary" :class="$style.tip_label">Pro tip</Text>
			</Flex>
			<Text size="13" color="secondary" height="150">
				Click the puzzle icon in your Chrome toolbar, then pin Nulo for
				quick access — that's how you'll open the wallet from now on.
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
