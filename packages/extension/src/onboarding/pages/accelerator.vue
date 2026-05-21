<route lang="json">
{ "meta": { "title": "Accelerator" } }
</route>

<script setup lang="ts">
import { useAcceleratorStatus } from "@/onboarding/composables/useAcceleratorStatus"

const router = useRouter()
const { status, info, detect } = useAcceleratorStatus()

// Continue is only enabled once detection succeeds. Skip is a SEPARATE
// affordance below that immediately routes onward — no two-click gate.
const isContinueEnabled = computed(() => status.value === "active")

// Send users to the public landing rather than the raw GitHub releases page.
// The landing brands the download properly + handles OS detection.
const LANDING_URL = "https://aztec-accelerator.dev/"

const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : ""
const isWindows = computed(() => /Windows/.test(userAgent))
const downloadLabel = computed(() => {
	if (/Mac/.test(userAgent)) return "Download for macOS"
	if (/Linux/.test(userAgent)) return "Download for Linux"
	return "Download Aztec Accelerator"
})

const statusTitle = computed(() => {
	switch (status.value) {
		case "active":
			return "Active"
		case "no-bb":
			return "Almost ready"
		case "not-detected":
			return "Not detected"
		default:
			return "Looking..."
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
	window.open(LANDING_URL, "_blank", "noopener,noreferrer")
}

// Skip immediately routes to /done — no second click required. This is a
// "soft-require" but the friction was double-counted before (set local flag,
// then click Continue), which Codex flagged as fake skipping.
function handleSkip() {
	router.push("/onboarding/done")
}

function goNext() {
	router.push("/onboarding/done")
}
</script>

<template>
	<OnboardingPage>
		<StepIndicator :current="3" />
		<Flex direction="column" gap="16" :class="$style.hero">
			<BrutalistTitle main="Speed up" sub="Proving" />
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">
				A free menu-bar app that proves transactions natively, using every CPU core
				your machine has. Browser proofs that take 30 seconds drop to a few.
				Optional, but strongly recommended.
			</Text>
		</Flex>

		<div
			:class="[$style.statusCard, $style[status]]"
			:data-status="status"
			data-testid="onboarding-accelerator-status"
		>
			<Flex align="center" gap="16" :class="$style.statusInner">
				<span :class="$style.dot" />
				<Flex direction="column" gap="4" :class="$style.statusBody">
					<Text size="15" weight="700" color="primary" :class="$style.statusTitle">
						{{ statusTitle }}
					</Text>
					<Text v-if="statusDetail" size="13" color="secondary" height="150">
						{{ statusDetail }}
					</Text>
				</Flex>
				<!-- Re-test lives INSIDE the status card so its position doesn't
					shift relative to the Continue button below as the
					Download CTA shows/hides. -->
				<button
					v-if="status === 'not-detected' || status === 'no-bb' || status === 'active'"
					type="button"
					:class="$style.retest"
					data-testid="onboarding-accelerator-test"
					@click="detect"
				>
					{{ status === "active" ? "Re-test" : "Test" }}
				</button>
			</Flex>
		</div>

		<!-- Reserve vertical space so Continue / Skip stay in the same Y
			position regardless of whether Download is rendered. -->
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
				<Text size="13" color="secondary" height="150">
					Aztec Accelerator isn't available on Windows yet. Proofs will run in your browser.
				</Text>
			</div>
		</Flex>

		<!-- Bottom CTA slot. Conditionally renders Continue OR Skip, but
			the slot itself reserves a Continue-sized height so the visual
			position is stable across states. Skip is vertically centered
			inside the reserved slot. -->
		<div :class="$style.ctaSlot">
			<Button
				v-if="status === 'active'"
				variant="cta"
				size="large"
				:disabled="!isContinueEnabled"
				data-testid="onboarding-accelerator-continue"
				@click="goNext"
			>
				Continue
			</Button>
			<button
				v-else-if="status === 'not-detected' || status === 'no-bb'"
				type="button"
				:class="$style.skipLink"
				data-testid="onboarding-accelerator-skip"
				@click="handleSkip"
			>
				Skip. Proving will run in your browser.
			</button>
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

.statusCard {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
	padding: 20px 24px;
	transition: border-color 0.2s var(--bezier);
}

.statusInner {
	width: 100%;
}

.retest {
	margin-left: auto;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-secondary);
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	padding: 8px 14px;
	cursor: pointer;
	transition: background 0.15s var(--bezier), color 0.15s var(--bezier),
		border-color 0.15s var(--bezier);
	flex-shrink: 0;
}

.retest:hover {
	background: var(--nulo-surface-low);
	color: var(--txt-primary);
	border-color: var(--nulo-secondary);
}

.retest:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
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
	/* Reserve space for the Download CTA even when active, so Continue
	 * keeps the same vertical position regardless of status. */
	min-height: 48px;
}

.windowsNote {
	padding: 14px 16px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
}

.ctaSlot {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	/* Reserve a Continue-sized slot so Skip occupies the same vertical
	 * footprint as the Continue button would. Prevents the visual mass
	 * from shifting between active and not-detected states. */
	min-height: 48px;
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
