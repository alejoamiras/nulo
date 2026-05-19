<route lang="json">
{ "meta": { "title": "Meet Aztec" } }
</route>

<script setup lang="ts">
const router = useRouter()

const cards = [
	{
		title: "Programmable privacy",
		body: "Aztec runs private smart contracts. Your balances, transfers, and calls stay encrypted — visible only to you.",
	},
	{
		title: "Proofs run on your machine",
		body: "Every transaction generates a zero-knowledge proof on your machine. The network only sees the proof — never your inputs.",
	},
	{
		title: "Proofs take time",
		body: "In the browser, a simple transfer can take 10–30 seconds. The next screen explains how to speed this up.",
	},
]

function goNext() {
	router.push("/onboarding/accelerator")
}
</script>

<template>
	<Flex direction="column" align="center" :class="$style.page">
		<header :class="$style.hero">
			<h1 :class="$style.title">Meet Aztec</h1>
		</header>

		<div :class="$style.grid">
			<div v-for="card in cards" :key="card.title" :class="$style.card">
				<h2 :class="$style.cardTitle">{{ card.title }}</h2>
				<p :class="$style.cardBody">{{ card.body }}</p>
			</div>
		</div>

		<Flex direction="column" align="center" gap="12" :class="$style.actions">
			<button
				type="button"
				:class="$style.cta"
				data-testid="onboarding-learn-continue"
				@click="goNext"
			>
				Continue
			</button>
			<!-- Skip-intro routes to /accelerator, NOT /done — the accelerator
				step still gates progression (Codex v2 critique). -->
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
	max-width: 960px;
	width: 100%;
	margin: 48px auto 0;
	gap: 40px;
}

.hero {
	text-align: center;
}
.title {
	font-size: 32px;
	letter-spacing: -0.02em;
	font-weight: 600;
	margin: 0;
	color: var(--app-text);
}

.grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
	width: 100%;
}
@media (max-width: 720px) {
	.grid {
		grid-template-columns: 1fr;
	}
}

.card {
	background: var(--surface, #121212);
	border: 1px solid var(--border-color, #2a2a2a);
	border-radius: 12px;
	padding: 24px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}
.cardTitle {
	font-size: 18px;
	font-weight: 600;
	margin: 0;
	color: var(--app-text);
}
.cardBody {
	font-size: 14px;
	color: var(--text-secondary, #c0c0c0);
	margin: 0;
	line-height: 1.55;
}

.actions {
	margin-top: 8px;
}
.cta {
	min-width: 240px;
	padding: 14px 32px;
	border-radius: 10px;
	border: 1px solid var(--app-text);
	background: var(--app-text);
	color: var(--app-bg);
	font: inherit;
	font-weight: 600;
	font-size: 15px;
	cursor: pointer;
	transition: opacity 140ms ease;
}
.cta:hover {
	opacity: 0.85;
}

.skipLink {
	background: transparent;
	border: none;
	color: var(--text-secondary, #8a8a8a);
	font: inherit;
	font-size: 13px;
	text-decoration: underline;
	cursor: pointer;
	padding: 4px 8px;
}
.skipLink:hover {
	color: var(--app-text);
}
</style>
