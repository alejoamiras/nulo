<route lang="json">
{ "meta": { "title": "Welcome" } }
</route>

<script setup lang="ts">
const router = useRouter()

// Open external legal pages in a popup-shaped window — matches the popup
// register page's `handleOpen` so terms / privacy actually work, not just
// look like they should.
const handleOpen = (target: "terms" | "privacy") => {
	chrome.windows.create({
		type: "popup",
		url: `https://nulo.sh/${target}`,
		width: 480,
		height: 720,
	})
}
</script>

<template>
	<Flex direction="column" align="center" :class="$style.page">
		<Flex direction="column" align="center" gap="16" :class="$style.hero">
			<h1 :class="$style.title_stack">
				<span :class="$style.title_main">Welcome</span>
				<span :class="$style.title_sub">to Nulo</span>
			</h1>
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150" align="center">
				A private wallet for Aztec.
			</Text>
		</Flex>

		<Flex direction="column" gap="8" :class="$style.actions">
			<Button
				variant="primary"
				size="large"
				wide
				data-testid="onboarding-welcome-create"
				@click="router.push('/onboarding/create')"
			>
				Create wallet
			</Button>
			<Button
				variant="primary_outline"
				size="large"
				wide
				data-testid="onboarding-welcome-import"
				@click="router.push('/onboarding/import')"
			>
				Import wallet
			</Button>
		</Flex>

		<Text size="11" color="secondary" align="center" mono :class="$style.footer">
			By continuing, you are confirming that you read and agree to
			<span @click="handleOpen('terms')" :class="$style.link">Terms of Use</span>
			and
			<span @click="handleOpen('privacy')" :class="$style.link">Privacy Policy</span>
		</Text>
	</Flex>
</template>

<style module>
.page {
	max-width: 480px;
	width: 100%;
	margin: 32px auto 0;
	gap: 56px;
	flex: 1;
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
	font-size: 56px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.title_sub {
	font-family: var(--font-headline);
	font-size: 56px;
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

.actions {
	width: 100%;
}

.footer {
	margin-top: auto;
	padding-top: 32px;
	letter-spacing: 0.08em;
	max-width: 360px;
	line-height: 1.6;
}

.link {
	color: var(--nulo-secondary);
	cursor: pointer;
	border-bottom: 1px solid var(--nulo-border);
	transition: color 0.2s var(--bezier);
}

.link:hover {
	color: var(--txt-primary);
}

.link:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
}
</style>
