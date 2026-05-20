<route lang="json">
{ "meta": { "title": "Welcome" } }
</route>

<script setup lang="ts">
const router = useRouter()
</script>

<template>
	<Flex direction="column" align="center" :class="$style.page">
		<Flex direction="column" align="center" gap="16" :class="$style.hero">
			<div :class="$style.title_stack">
				<span :class="$style.title_main">Welcome</span>
				<span :class="$style.title_sub">to Nulo</span>
			</div>
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150" align="center">
				A private wallet for Aztec.
			</Text>
		</Flex>

		<Flex direction="column" gap="12" :class="$style.actions">
			<Button
				variant="cta"
				size="large"
				data-testid="onboarding-welcome-create"
				@click="router.push('/onboarding/create')"
			>
				Create a new wallet
			</Button>
			<Button
				variant="cta_outline"
				size="large"
				data-testid="onboarding-welcome-import"
				@click="router.push('/onboarding/import')"
			>
				Import an existing wallet
			</Button>
		</Flex>

		<Text size="11" color="tertiary" align="center" mono :class="$style.footer">
			BY CONTINUING, YOU ACCEPT NULO'S TERMS &amp; PRIVACY POLICY
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
}
</style>
