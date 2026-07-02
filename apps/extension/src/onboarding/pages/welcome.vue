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
	<OnboardingPage align="center" :gap="56">
		<Flex direction="column" align="center" gap="16" :class="$style.hero">
			<BrutalistTitle main="Welcome" sub="to Nulo" align="center" size="hero" />
			<div :class="$style.hero_bar" />
			<Text size="15" color="secondary" height="150" align="center" :class="$style.subhead">
				Access the internet-native coordination layer.
			</Text>
			<Text size="13" color="secondary" height="150" align="center" mono :class="$style.tagline">
				Private by default. Sovereign by design.
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
				Create profile
			</Button>
			<Button
				variant="primary_outline"
				size="large"
				wide
				data-testid="onboarding-welcome-import"
				@click="router.push('/onboarding/import')"
			>
				Import profile
			</Button>
		</Flex>

		<Text size="11" color="secondary" align="center" mono :class="$style.footer">
			By continuing, you are confirming that you read and agree to
			<span @click="handleOpen('terms')" :class="$style.link">Terms of Use</span>
			and
			<span @click="handleOpen('privacy')" :class="$style.link">Privacy Policy</span>
		</Text>
	</OnboardingPage>
</template>

<style module>
.hero {
	padding: 24px 0;
}

.hero_bar {
	width: 56px;
	height: 2px;
	background: var(--nulo-accent);
}

.subhead {
	max-width: 360px;
}

.tagline {
	letter-spacing: 0.06em;
	text-transform: uppercase;
	opacity: 0.65;
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
