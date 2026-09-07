<script setup>
defineProps({
	step: { type: Number, required: true },
	titleMain: { type: String, required: true },
	titleSub: { type: String, required: true },
	lede: { type: String, required: true },
	/** `{ number, title, body }` per card, rendered in order. */
	cards: { type: Array, required: true },
	continueTestid: { type: String, required: true },
	skipTestid: { type: String, required: true },
})
const emit = defineEmits(["continue", "skip"])
</script>

<template>
	<OnboardingPage :gap="40">
		<StepIndicator :current="step" />
		<Flex direction="column" gap="16" :class="$style.hero">
			<BrutalistTitle :main="titleMain" :sub="titleSub" />
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">
				{{ lede }}
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
			<Button variant="cta" size="large" :data-testid="continueTestid" @click="emit('continue')">
				Continue
			</Button>
			<OnboardingSkipLink :testid="skipTestid" @click="emit('skip')">Skip intro</OnboardingSkipLink>
		</Flex>
	</OnboardingPage>
</template>

<style module>
.hero {
	padding: 8px 0 8px;
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

/* Container query, not viewport: OnboardingPage adds 24+24 px of side padding, and under 540 px of
 * container width three columns leave the card copy ~130 px. */
@container onboarding-page (max-width: 540px) {
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
</style>
