<route lang="json">
{ "meta": { "title": "Meet Aztec" } }
</route>

<script setup lang="ts">
const router = useRouter()

const cards = [
	{
		number: "01",
		title: "Programmable privacy",
		body: "Aztec runs private smart contracts. Your balances, transfers, and calls stay encrypted — visible only to you.",
	},
	{
		number: "02",
		title: "Proofs on your machine",
		body: "Every transaction generates a zero-knowledge proof on your machine. The network only sees the proof — never your inputs.",
	},
	{
		number: "03",
		title: "Proofs take time",
		body: "In the browser, a simple transfer can take 10–30 seconds. The next screen explains how to speed this up.",
	},
]

function goNext() {
	router.push("/onboarding/accelerator")
}
</script>

<template>
	<Flex direction="column" gap="40" :class="$style.page">
		<Flex direction="column" gap="16" :class="$style.hero">
			<h1 :class="$style.title_stack">
				<span :class="$style.title_main">Meet</span>
				<span :class="$style.title_sub">Aztec</span>
			</h1>
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">
				Three things to know before your first transaction.
			</Text>
		</Flex>

		<div :class="$style.grid">
			<article v-for="card in cards" :key="card.title" :class="$style.card">
				<Text size="11" mono color="secondary" :class="$style.card_num">{{ card.number }}</Text>
				<Text size="16" weight="700" color="primary" :class="$style.card_title">{{ card.title }}</Text>
				<Text size="13" color="secondary" height="150">{{ card.body }}</Text>
			</article>
		</div>

		<Flex direction="column" align="center" gap="12" :class="$style.actions">
			<Button
				variant="cta"
				size="large"
				data-testid="onboarding-learn-continue"
				@click="goNext"
			>
				Continue
			</Button>
			<!-- Skip intro routes to /accelerator, NOT /done — the accelerator
				gate still applies (Codex v2 critique). -->
			<button
				type="button"
				:class="$style.skipLink"
				data-testid="onboarding-learn-skip"
				@click="goNext"
			>
				Skip intro
			</button>
		</Flex>
	</Flex>
</template>

<style module>
.page {
	max-width: 880px;
	width: 100%;
	margin: 16px auto 0;
}

.hero {
	padding: 8px 0 8px;
}

.title_stack {
	display: flex;
	flex-direction: column;
	line-height: 0.95;
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
	width: 40px;
	height: 2px;
	background: var(--nulo-accent);
	margin-top: 12px;
}

.grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 1px;
	background: var(--nulo-border);
	border: 1px solid var(--nulo-border);
}

@media (max-width: 720px) {
	.grid {
		grid-template-columns: 1fr;
	}
}

.card {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 24px;
	background: var(--card-bg);
}

.card_num {
	letter-spacing: 0.12em;
	font-weight: 600;
}

.card_title {
	font-family: var(--font-headline);
}

.actions {
	margin-top: 8px;
}

.skipLink {
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font-family: var(--font-mono);
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	cursor: pointer;
	padding: 6px 12px;
	transition: color 0.15s var(--bezier);
}

.skipLink:hover {
	color: var(--txt-primary);
}

.skipLink:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
	color: var(--txt-primary);
}
</style>
