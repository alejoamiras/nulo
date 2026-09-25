<route lang="json">
{ "meta": { "title": "Presto" } }
</route>

<script setup lang="ts">
import "@alejoamiras/presto-banners/register"
import { BANNER_EVENTS, clearDismissal } from "@alejoamiras/presto-banners"

/** Services */
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Composables */
import { vSnackFooter } from "@/composables/snackInset"
import { usePrestoCheck } from "@/composables/usePrestoCheck"

/** Utils */
import { PRESTO_SITE_URL } from "@/presto/config"
import { copyFor, isPitchKind } from "@/utils/presto-ui-state"

/** The card pitch's dismissal record: `persist-key`:variant:state (`PrestoBanner.persistKey`). */
const PITCH_DISMISSAL_KEY = "presto:banner:card:offline"

const router = useRouter()
const configService = new ConfigServiceClient()
const { state, start, check, dispose } = usePrestoCheck(configService)

const copy = computed(() => copyFor(state.value))
const isPitch = computed(() => isPitchKind(state.value.kind))
const isProbing = computed(() => state.value.kind === "detecting")
const canContinue = computed(() => state.value.kind === "available" || state.value.kind === "downloading")
const diagnosis = computed(() => (state.value.kind === "secure-connection-unavailable" ? state.value.diagnosis : undefined))
// app.vue resolves the config's theme (system → light/dark) onto `<html theme>` before any page mounts.
const bannerTheme = document.documentElement.getAttribute("theme") === "light" ? "light" : "dark"

const pitchRef = useTemplateRef<HTMLDivElement>("pitchRef")

function retry() {
	void check()
}

function skip() {
	router.push("/onboarding/done")
}

function goNext() {
	router.push("/onboarding/done")
}

onBeforeMount(() => {
	// A reset clears chrome.storage, not this page's localStorage: a pitch dismissed during an
	// earlier onboarding must not stay hidden from a re-onboarding user. The banner checks the
	// record when it connects and a later clear triggers no redraw, so this runs before first render.
	clearDismissal(PITCH_DISMISSAL_KEY)
	void start()
})

onMounted(() => {
	pitchRef.value?.addEventListener(BANNER_EVENTS.retry, retry)
	pitchRef.value?.addEventListener(BANNER_EVENTS.dismiss, skip)
})

onBeforeUnmount(() => {
	pitchRef.value?.removeEventListener(BANNER_EVENTS.retry, retry)
	pitchRef.value?.removeEventListener(BANNER_EVENTS.dismiss, skip)
	configService.disconnect()
	dispose()
})
</script>

<template>
	<OnboardingPage>
		<StepIndicator :current="5" />
		<Flex direction="column" gap="16" :class="$style.hero">
			<BrutalistTitle main="Speed up" sub="Proving" />
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">
				Proofs in your browser take about 30 seconds. With Presto they take a few.
				Optional, but strongly recommended.
			</Text>
		</Flex>

		<Flex v-show="isPitch" direction="column" gap="10">
			<SectionLabel label="01 · Get it" />
			<!-- The wrapper stays mounted so the banner's bubbling events have one stable listener.
				`variant`, `href` and `state` are read from attributes, and `variant`/`href` are getter-only
				properties, so a plain binding would be dropped; `.attr` writes the attribute. The state is
				pinned to the pitch: this card sells Presto and never reports a probe. -->
			<div ref="pitchRef" :class="$style.pitch" data-testid="onboarding-presto-pitch">
				<presto-banner
					v-if="isPitch"
					:variant.attr="'card'"
					:state.attr="'offline'"
					:href.attr="PRESTO_SITE_URL"
					fonts="none"
					:theme="bannerTheme"
				/>
			</div>
		</Flex>

		<Flex direction="column" gap="10">
			<SectionLabel v-if="isPitch" label="02 · Connect it" />
			<PrestoStatusCard
				:copy="copy"
				:status="state.kind"
				:diagnosis="diagnosis"
				testid="onboarding-presto-status"
				retryTestid="onboarding-presto-retry"
				@retry="retry"
			/>
		</Flex>
		<Text v-if="state.kind === 'available'" size="12" color="support" height="150">
			Presto will ask you to allow Nulo the first time you send.
		</Text>

		<!-- A Continue-sized slot, so Skip sits where Continue would and the page never jumps. -->
		<div :class="$style.ctaSlot">
			<Button v-if="canContinue" v-snack-footer variant="cta" size="large" data-testid="onboarding-presto-continue" @click="goNext">
				Continue
			</Button>
			<OnboardingSkipLink v-else-if="!isProbing" v-snack-footer testid="onboarding-presto-skip" @click="skip">
				Skip. Proving will run in your browser.
			</OnboardingSkipLink>
		</div>
	</OnboardingPage>
</template>

<style module>
.hero {
	padding: 8px 0;
}

.hero_bar {
	width: 40px;
	height: 2px;
	background: var(--nulo-accent);
	margin-top: 12px;
}

.pitch {
	display: flex;
	justify-content: center;
}

/* The banner's tokens follow Nulo's, so the card reads as part of the page in both themes. The
   variables sit on the element itself: a rule on the host beats the shadow sheet's `:host`
   defaults, whereas an inherited value from a wrapper does not. */
.pitch presto-banner {
	display: block;
	width: 100%;
	--pb-bg: var(--app-bg);
	--pb-surface: var(--nulo-surface);
	--pb-wash: var(--nulo-surface-low);
	--pb-border: var(--nulo-border);
	--pb-text: var(--txt-primary);
	--pb-muted: var(--txt-secondary);
	--pb-accent: var(--nulo-accent);
	--pb-accent-dim: var(--txt-primary);
	--pb-accent-on: var(--txt-inverse);
	--pb-gold: var(--yellow);
	--pb-gold-text: var(--yellow);
	--pb-go: var(--green);
	--pb-go-text: var(--green);
	--pb-shadow: none;
	--pb-shadow-big: none;
	--pb-font-body: var(--font-body);
	--pb-font-display: var(--font-headline);
}

.ctaSlot {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 48px;
	margin-top: 8px;
}
</style>
