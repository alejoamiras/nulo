<route lang="json">
{ "meta": { "title": "Accelerator" } }
</route>

<script setup lang="ts">
import { useAcceleratorStatus } from "@/onboarding/composables/useAcceleratorStatus"

const router = useRouter()
const { status, info, detect } = useAcceleratorStatus()

const acknowledgedSkip = ref(false)
const isContinueEnabled = computed(() => status.value === "active" || acknowledgedSkip.value)

const RELEASES_URL = "https://github.com/alejoamiras/aztec-accelerator/releases/latest"

const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""
const isWindows = computed(() => /Windows/.test(userAgent))
const downloadLabel = computed(() => {
	if (/Mac/.test(userAgent)) return "Download for macOS"
	if (/Linux/.test(userAgent)) return "Download for Linux"
	return "Download Aztec Accelerator"
})

const statusTitle = computed(() => {
	switch (status.value) {
		case "active": return "Active"
		case "no-bb": return "Almost ready"
		case "not-detected": return "Not detected"
		default: return "Looking..."
	}
})

const statusDetail = computed(() => {
	switch (status.value) {
		case "active":
			return info.value?.aztec_version ? `Aztec runtime ${info.value.aztec_version}.` : "Proofs will be generated natively."
		case "no-bb":
			return "Open Aztec Accelerator from your menu bar and wait for setup to finish."
		case "not-detected":
			return "Proofs will run in your browser (slower)."
		default:
			return ""
	}
})

function openReleases() {
	window.open(RELEASES_URL, "_blank", "noopener,noreferrer")
}

function handleSkip() {
	acknowledgedSkip.value = true
}

function goNext() {
	router.push("/onboarding/done")
}
</script>

<template>
	<Flex direction="column" gap="32" :class="$style.page">
		<Flex direction="column" gap="16" :class="$style.hero">
			<div :class="$style.title_stack">
				<span :class="$style.title_main">Speed up</span>
				<span :class="$style.title_sub">Proving</span>
			</div>
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">
				Aztec Accelerator runs proving outside the browser, on this device.
				It lives in your menu bar.
			</Text>
		</Flex>

		<div
			:class="[$style.statusCard, $style[status]]"
			:data-status="status"
			data-testid="onboarding-accelerator-status"
		>
			<Flex align="center" gap="16">
				<span :class="$style.dot" />
				<Flex direction="column" gap="4" :class="$style.statusBody">
					<Text size="15" weight="700" color="primary" :class="$style.statusTitle">
						{{ statusTitle }}
					</Text>
					<Text v-if="statusDetail" size="13" color="body" height="150">
						{{ statusDetail }}
					</Text>
				</Flex>
			</Flex>
		</div>

		<Flex direction="column" gap="10" :class="$style.actions">
			<Button
				v-if="(status === 'not-detected' || status === 'no-bb') && !isWindows"
				variant="primary"
				size="large"
				wide
				data-testid="onboarding-accelerator-download"
				@click="openReleases"
			>
				{{ downloadLabel }}
			</Button>
			<div v-if="status === 'not-detected' && isWindows" :class="$style.windowsNote">
				<Text size="13" color="body" height="150">
					Aztec Accelerator isn't available on Windows yet. Proofs will run in your browser.
				</Text>
			</div>
			<Button
				v-if="status === 'not-detected' || status === 'no-bb' || status === 'active'"
				:variant="status === 'active' ? 'primary_outline' : 'primary_outline'"
				size="large"
				wide
				data-testid="onboarding-accelerator-test"
				@click="detect"
			>
				{{ status === "active" ? "Re-test" : "Test connection" }}
			</Button>
		</Flex>

		<Flex direction="column" align="center" gap="12" :class="$style.continueRow">
			<Button
				variant="cta"
				size="large"
				:disabled="!isContinueEnabled"
				data-testid="onboarding-accelerator-continue"
				@click="goNext"
			>
				Continue
			</Button>
			<button
				v-if="!acknowledgedSkip && status !== 'active'"
				type="button"
				:class="$style.skipLink"
				data-testid="onboarding-accelerator-skip"
				@click="handleSkip"
			>
				Skip — proving will run in your browser
			</button>
		</Flex>
	</Flex>
</template>

<style module>
.page {
	max-width: 560px;
	width: 100%;
	margin: 16px auto 0;
}

.hero {
	padding: 8px 0;
}

.title_stack {
	display: flex;
	flex-direction: column;
	line-height: 0.95;
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

.statusCard {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
	padding: 20px 24px;
	transition: border-color 0.2s var(--bezier);
}

.statusCard.active {
	border-color: var(--green);
}

.statusCard.no-bb {
	border-color: var(--yellow);
}

.statusCard.not-detected {
	border-color: var(--nulo-outline);
}

.dot {
	width: 10px;
	height: 10px;
	flex-shrink: 0;
	background: var(--nulo-secondary);
	transition: background 0.2s var(--bezier);
}

.idle .dot,
.detecting .dot {
	background: var(--nulo-secondary);
	animation: pulse 1.4s ease-in-out infinite;
}

.active .dot {
	background: var(--green);
}

.no-bb .dot {
	background: var(--yellow);
}

.not-detected .dot {
	background: var(--red);
}

@keyframes pulse {
	0%, 100% { opacity: 0.45; }
	50% { opacity: 1; }
}

.statusBody {
	flex: 1;
}

.statusTitle {
	font-family: var(--font-headline);
}

.actions {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.windowsNote {
	padding: 14px 16px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
}

.continueRow {
	margin-top: 8px;
}

.skipLink {
	background: transparent;
	border: none;
	color: var(--txt-tertiary);
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
</style>
