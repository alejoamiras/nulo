<route lang="json">
{ "meta": { "title": "Accelerator" } }
</route>

<script setup lang="ts">
import { useAcceleratorStatus } from "@/onboarding/composables/useAcceleratorStatus"

const router = useRouter()
const { status, info, detect } = useAcceleratorStatus()

const acknowledgedSkip = ref(false)
const isContinueEnabled = computed(() => status.value === "active" || acknowledgedSkip.value)

// Soft-require: user must either successfully detect OR explicitly click Skip
// (locked decision). Auto-detect runs on mount; if it returns 'active', the
// gate is satisfied. Any other status keeps Continue disabled until the user
// clicks Skip.

const RELEASES_URL = "https://github.com/alejoamiras/aztec-accelerator/releases/latest"

const downloadLabel = computed(() => {
	const ua = typeof navigator !== "undefined" ? navigator.userAgent : ""
	if (/Mac/.test(ua)) return "Download for macOS"
	if (/Linux/.test(ua)) return "Download for Linux"
	if (/Windows/.test(ua)) return "Aztec Accelerator on Windows"
	return "Download Aztec Accelerator"
})

const isWindows = computed(() => typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent))

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
	<Flex direction="column" :class="$style.page">
		<header :class="$style.hero">
			<h1 :class="$style.title">Speed up proving</h1>
			<p :class="$style.subtitle">
				Aztec Accelerator runs proving outside the browser, on this device.
				It lives in your menu bar.
			</p>
		</header>

		<div :class="[$style.statusCard, $style[status]]" data-testid="onboarding-accelerator-status">
			<Flex align="center" gap="12">
				<span :class="$style.dot" />
				<div :class="$style.statusBody">
					<strong :class="$style.statusLabel">
						<template v-if="status === 'idle' || status === 'detecting'">Looking for Aztec Accelerator...</template>
						<template v-else-if="status === 'active'">Active.</template>
						<template v-else-if="status === 'no-bb'">Almost ready.</template>
						<template v-else>Not detected.</template>
					</strong>
					<p :class="$style.statusDetail">
						<template v-if="status === 'active'">
							Aztec runtime {{ info?.aztec_version || "" }}. Proofs will be generated natively.
						</template>
						<template v-else-if="status === 'no-bb'">
							Aztec Accelerator is still installing its proving binary. Open the menu-bar app and wait for setup to finish.
						</template>
						<template v-else-if="status === 'not-detected'">
							Proofs will run in your browser (slower).
						</template>
					</p>
				</div>
			</Flex>
		</div>

		<Flex direction="column" gap="8" :class="$style.actions">
			<button
				v-if="status === 'not-detected' && !isWindows"
				type="button"
				:class="$style.cta"
				data-testid="onboarding-accelerator-download"
				@click="openReleases"
			>
				{{ downloadLabel }}
			</button>
			<p v-if="status === 'not-detected' && isWindows" :class="$style.windowsNote">
				Aztec Accelerator isn't available on Windows yet.
			</p>
			<button
				v-if="status === 'not-detected' || status === 'no-bb' || status === 'active'"
				type="button"
				:class="[$style.cta, status === 'active' && $style.ctaOutline]"
				data-testid="onboarding-accelerator-test"
				@click="detect"
			>
				{{ status === "active" ? "Re-test" : "Test connection" }}
			</button>
		</Flex>

		<Flex direction="column" align="center" gap="10" :class="$style.continueRow">
			<button
				type="button"
				:class="$style.continue"
				:disabled="!isContinueEnabled"
				data-testid="onboarding-accelerator-continue"
				@click="goNext"
			>
				Continue
			</button>
			<button
				v-if="!acknowledgedSkip && status !== 'active'"
				type="button"
				:class="$style.skipLink"
				data-testid="onboarding-accelerator-skip"
				@click="handleSkip"
			>
				Skip — proving will run in your browser.
			</button>
		</Flex>
	</Flex>
</template>

<style module>
.page {
	max-width: 560px;
	width: 100%;
	margin: 48px auto 0;
	gap: 32px;
}

.hero {
	text-align: center;
}
.title {
	font-size: 32px;
	letter-spacing: -0.02em;
	font-weight: 600;
	margin: 0 0 8px;
	color: var(--app-text);
}
.subtitle {
	font-size: 15px;
	color: var(--text-secondary, #8a8a8a);
	margin: 0;
	line-height: 1.55;
}

.statusCard {
	background: var(--surface, #121212);
	border: 1px solid var(--border-color, #2a2a2a);
	border-radius: 12px;
	padding: 20px 24px;
}

.dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	flex-shrink: 0;
	background: var(--text-faint, #555);
	transition: background 200ms ease;
}
.idle .dot,
.detecting .dot {
	background: #8a8a8a;
	animation: pulse 1.4s ease-in-out infinite;
}
.active .dot {
	background: #6fc06f;
}
.no-bb .dot {
	background: #d9a85f;
}
.not-detected .dot {
	background: #e07070;
}
@keyframes pulse {
	0%, 100% { opacity: 0.5; }
	50% { opacity: 1; }
}

.statusBody {
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.statusLabel {
	font-size: 15px;
	font-weight: 600;
	color: var(--app-text);
}
.statusDetail {
	margin: 0;
	font-size: 13px;
	color: var(--text-secondary, #8a8a8a);
}

.actions {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.cta {
	padding: 12px 20px;
	border-radius: 8px;
	border: 1px solid var(--app-text);
	background: var(--app-text);
	color: var(--app-bg);
	font: inherit;
	font-weight: 500;
	font-size: 14px;
	cursor: pointer;
	transition: opacity 140ms ease;
}
.cta:hover {
	opacity: 0.85;
}
.ctaOutline {
	background: transparent;
	color: var(--app-text);
}

.windowsNote {
	font-size: 13px;
	color: var(--text-secondary, #8a8a8a);
	margin: 0;
	padding: 12px;
	background: var(--surface, #121212);
	border: 1px solid var(--border-color, #2a2a2a);
	border-radius: 8px;
}

.continueRow {
	margin-top: 8px;
}
.continue {
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
.continue:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
.continue:not(:disabled):hover {
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
