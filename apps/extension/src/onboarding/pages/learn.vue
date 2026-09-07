<route lang="json">
{ "meta": { "title": "Meet Aztec" } }
</route>

<script setup lang="ts">
const router = useRouter()

const cards = [
	{
		number: "01",
		title: "Public and private state",
		body: "Aztec runs smart contracts with both public state and private state. You decide what's shared. The rest stays encrypted, visible only to you.",
	},
	{
		number: "02",
		title: "Proofs on your machine",
		body: "Private state only stays private if you generate the proof yourself. Every Aztec transaction builds its zero-knowledge proof on your machine, before anything leaves it. The network only ever sees the proof.",
	},
	{
		number: "03",
		title: "Proofs take time",
		body: "Generating proofs is computationally heavy. In the browser, a single transfer can take 10 to 30 seconds. Running the prover natively cuts that to a fraction.",
	},
]

// Continue advances into the fee-juice explainer step. Skip is intentionally a
// SEPARATE handler that goes straight to /accelerator — the accelerator gate
// still applies, same constraint that pre-dated the fees step.
function goContinue() {
	router.push("/onboarding/fees")
}
function goSkip() {
	router.push("/onboarding/accelerator")
}
</script>

<template>
	<OnboardingExplainer
		:step="2"
		titleMain="Meet"
		titleSub="Aztec"
		lede="Three things to know before your first transaction."
		:cards="cards"
		continueTestid="onboarding-learn-continue"
		skipTestid="onboarding-learn-skip"
		@continue="goContinue"
		@skip="goSkip"
	/>
</template>
