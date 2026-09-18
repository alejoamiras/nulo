<script setup lang="ts">
/** Utils */
import { CONSENT_LABEL, CONTINUE_LABEL, type RiskPoint } from "@nulo/legal"

const emit = defineEmits<{ accept: []; open: [doc: "terms" | "privacy"] }>()
const props = defineProps<{
	/** What the person is told before agreeing. Omitted on a re-acceptance, where `changes` says what moved. */
	points?: readonly RiskPoint[]
	changes?: readonly string[]
	termsVersion: string
	busy?: boolean
	/** Leads only, for the popup: the sentence under each one is a click away in the Terms. */
	compact?: boolean
}>()

/** Never seeded from a prop or storage: Terms § 3 promises a control that starts unchecked. */
const agreed = ref(false)

const LINKED = "Terms of Use"
const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six"]

/** The label is the package constant, split only so its last words can be the link. */
const agreeText = CONSENT_LABEL.slice(0, -LINKED.length)
const lead = computed(() => {
	const count = props.points?.length ?? 0
	if (count === 0) return agreeText
	return `I understand the ${COUNT_WORDS[count] ?? count} points above, and ${agreeText}`
})
/** A re-acceptance names the version in the sentence itself: it is the only thing that changed. */
const tail = computed(() => (props.points?.length ? "." : `, version ${props.termsVersion}.`))
const hint = computed(() => (agreed.value ? `Recorded on this device only · v${props.termsVersion}` : "Tick the box to continue"))

const toggle = () => {
	if (!props.busy) agreed.value = !agreed.value
}
const accept = () => {
	if (agreed.value && !props.busy) emit("accept")
}
</script>

<template>
	<Flex direction="column" gap="20" wide :class="$style.consent" data-testid="legal-consent">
		<Flex v-if="points?.length" direction="column" :class="$style.card" data-testid="legal-points">
			<Flex v-for="(point, index) in points" :key="point.lead" gap="12" align="start" :class="$style.point" data-testid="legal-point">
				<Text size="11" color="primary" mono :class="$style.ordinal">{{ String(index + 1).padStart(2, "0") }}</Text>
				<Text size="14" color="secondary" height="150">
					<Text size="14" color="primary" weight="600">{{ point.lead }}</Text>
					<template v-if="!compact"> {{ point.body }}</template>
				</Text>
			</Flex>
		</Flex>

		<Flex v-if="changes?.length" direction="column" gap="8" :class="$style.card" data-testid="legal-changes">
			<Text v-for="change in changes" :key="change" size="13" color="secondary" height="150" data-testid="legal-change">
				{{ change }}
			</Text>
		</Flex>

		<Flex
			gap="12"
			align="start"
			:class="[$style.agree, agreed && $style.agreed]"
			role="checkbox"
			:aria-checked="agreed"
			:aria-disabled="busy || undefined"
			tabindex="0"
			data-testid="legal-consent-checkbox"
			@click="toggle"
			@keydown.enter.prevent="toggle"
			@keydown.space.prevent="toggle"
		>
			<Flex align="center" justify="center" :class="[$style.box, agreed && $style.box_on]">
				<Icon v-if="agreed" name="check" size="14" color="inverse" />
			</Flex>
			<Flex direction="column" gap="6">
				<Text size="13" color="primary" height="160" data-testid="legal-consent-label">
					{{ lead
					}}<a :class="$style.link" tabindex="-1" data-testid="legal-terms-link" @click.stop.prevent="emit('open', 'terms')">{{
						LINKED
					}}</a
					>{{ tail }}
				</Text>
				<Text size="12" color="secondary" height="150">
					The
					<a :class="$style.link" tabindex="-1" data-testid="legal-privacy-link" @click.stop.prevent="emit('open', 'privacy')">Privacy Policy</a>
					explains what leaves your device.
				</Text>
			</Flex>
		</Flex>

		<Flex direction="column" align="center" gap="10" :class="$style.actions">
			<Button variant="primary" size="large" wide :disabled="!agreed || busy" data-testid="legal-continue" @click="accept">
				{{ CONTINUE_LABEL }}
			</Button>
			<Text size="10" color="secondary" mono align="center" :class="$style.hint" data-testid="legal-consent-hint">{{ hint }}</Text>
		</Flex>
	</Flex>
</template>

<style module>
.consent {
	width: 100%;
}

.card {
	width: 100%;
	padding: 4px 20px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
}

.point {
	padding: 14px 0;
}

.point + .point {
	border-top: 1px solid var(--nulo-border);
}

.ordinal {
	flex-shrink: 0;
	padding-top: 3px;
}

.agree {
	width: 100%;
	padding: 16px 18px;
	border: 1px solid var(--nulo-border);
	cursor: pointer;
}

.agree.agreed {
	border-color: var(--txt-primary);
}

.agree:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
}

.box {
	flex-shrink: 0;
	width: 18px;
	height: 18px;
	margin-top: 2px;
	border: 1.5px solid var(--nulo-border);
}

.box_on {
	background: var(--txt-primary);
	border-color: var(--txt-primary);
}

.link {
	color: var(--txt-primary);
	cursor: pointer;
	border-bottom: 1px solid var(--nulo-border);
}

.actions {
	width: 100%;
}

.hint {
	letter-spacing: 0.08em;
}
</style>
