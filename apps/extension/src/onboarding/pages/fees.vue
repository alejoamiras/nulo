<route lang="json">
{ "meta": { "title": "Fees on Aztec" } }
</route>

<script setup lang="ts">
const router = useRouter()

const cards = [
	{
		number: "01",
		title: "Fee juice",
		body: "Every Aztec transaction pays a fee in fee juice, the L2 gas asset. On this testnet, fee juice comes from a free test token on Sepolia, Ethereum's test network, bridged over to Aztec. Fee juice is not transferable.",
	},
	{
		number: "02",
		title: "Private fee juice",
		body: "Private fee juice is a separate asset from regular (public) fee juice. Hold private fee juice and the fees you pay stay private too: your account, your amount, your transaction, only you see them. Private fee juice is also not transferable.",
	},
	{
		number: "03",
		title: "Sponsored fees",
		body: "Apps can pay your fees for you, or accept other tokens as payment. The wallet's fee settings handles all three modes.",
	},
]

// Continue routes onward into the Presto detection. Skip lands at the same
// place; the explainer is short enough that "Skip" just means "I've read
// enough", and the user can revisit fee details from the wallet's fee
// settings panel later.
function goContinue() {
	router.push("/onboarding/presto")
}
function goSkip() {
	router.push("/onboarding/presto")
}
</script>

<template>
	<OnboardingExplainer
		:step="4"
		titleMain="Fees on"
		titleSub="Aztec"
		lede="Three things to know about paying for transactions on Aztec."
		:cards="cards"
		continueTestid="onboarding-fees-continue"
		skipTestid="onboarding-fees-skip"
		@continue="goContinue"
		@skip="goSkip"
	/>
</template>
