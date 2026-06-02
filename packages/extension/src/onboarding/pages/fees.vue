<route lang="json">
{ "meta": { "title": "Fees on Aztec" } }
</route>

<script setup lang="ts">
const router = useRouter()

const cards = [
	{
		number: "01",
		title: "Fee juice",
		body: "Every Aztec transaction pays a fee in fee juice — the network's native asset, like gas on Ethereum. You'll need some before you can send.",
	},
	{
		number: "02",
		title: "Private fee juice",
		body: "Hold your fee juice in your private balance and the fees you pay stay private too. Your account, your amount, your transaction — only you see them.",
	},
	{
		number: "03",
		title: "Sponsored fees",
		body: "Apps can pay your fees for you, or accept other tokens as payment. The wallet's fee settings handles all three modes.",
	},
]

// Continue routes onward into the accelerator detection. Skip lands at the
// same place — the explainer is short enough that "Skip" just means "I've
// read enough"; the user can revisit fee details from the wallet's fee
// settings panel later.
function goContinue() {
	router.push("/onboarding/accelerator")
}
function goSkip() {
	router.push("/onboarding/accelerator")
}
</script>

<template>
	<OnboardingPage :gap="40">
		<StepIndicator :current="3" />
		<Flex direction="column" gap="16" :class="$style.hero">
			<BrutalistTitle main="Fees on" sub="Aztec" />
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">
				Three things to know about paying for transactions on Aztec.
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
				data-testid="onboarding-fees-continue"
				@click="goContinue"
			>
				Continue
			</Button>
			<button
				type="button"
				:class="$style.skipLink"
				data-testid="onboarding-fees-skip"
				@click="goSkip"
			>
				Skip intro
			</button>
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

/* Stack when OnboardingPage's container shrinks below 540 px. Below that,
 * each card's usable text width (after 24 px side padding) drops under
 * ~130 px — too cramped for the existing card copy. Container query (not
 * viewport @media) because the shell adds 24+24 px horizontal padding,
 * which a viewport-based rule would have to subtract. */
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
