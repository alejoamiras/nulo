<route lang="json">
{ "meta": { "title": "Before you start" } }
</route>

<script setup lang="ts">
/** Services */
import { managers } from "@/utils/core"

/** Composables */
import { useToast } from "@/composables/toast"

/** Utils */
import { type LegalDocument, RISK_POINTS, currentVersion } from "@nulo/legal"
import { openLegalDocument } from "@/utils/legal-links"
import { parseNext } from "../legal-guard"

const { openToast } = useToast()

const route = useRoute()
const router = useRouter()

const busy = ref(false)
const termsVersion = currentVersion("terms").version

const handleOpen = (doc: LegalDocument) => openLegalDocument(doc, "tab")

const handleAccept = async () => {
	busy.value = true
	try {
		// The write is awaited: the next route's guard reads the record this call stores.
		await managers.legal.accept("onboarding")
		await router.push(`/onboarding/${parseNext(route.query.next)}`)
	} catch {
		openToast({ label: "Could not record your acceptance. Try again.", icon: "warning", color: "red" }, 4_000)
	} finally {
		busy.value = false
	}
}
</script>

<template>
	<OnboardingPage align="center" :gap="28">
		<OnboardingBackLink testid="legal-terms-back" />

		<Flex direction="column" align="center" gap="16" data-testid="legal-terms-page">
			<BrutalistTitle main="Before" sub="you start" align="center" size="hero" />
			<div :class="$style.bar" />
		</Flex>

		<LegalConsent
			:points="RISK_POINTS"
			:terms-version="termsVersion"
			:busy="busy"
			@accept="handleAccept"
			@open="handleOpen"
		/>
	</OnboardingPage>
</template>

<style module>
.bar {
	width: 56px;
	height: 2px;
	background: var(--nulo-accent);
}
</style>
