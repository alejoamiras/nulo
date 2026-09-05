<script setup lang="ts">
/** Components */
import ActivityDock from "./components/ActivityDock.vue"
import ActivityView from "./views/ActivityView.vue"
import AppToastRegion from "./components/AppToastRegion.vue"
import AztecWalletPanel from "./components/AztecWalletPanel.vue"
import BridgeFooter from "./components/BridgeFooter.vue"
import ChooseAccountModal from "./components/ChooseAccountModal.vue"
import ConnectionErrorStrip from "./components/ConnectionErrorStrip.vue"
import DripView from "./views/DripView.vue"
import Footer from "./components/Footer.vue"
import L1WalletPanel from "./components/L1WalletPanel.vue"
import RailNav from "./components/RailNav.vue"
import SectionHeader from "./components/SectionHeader.vue"
import SendView from "./views/SendView.vue"
import ThemeToggle from "./components/ThemeToggle.vue"
import WalletPickerModal from "./components/WalletPickerModal.vue"

/** Composables */
import { useActivityFeed } from "@/composables/useActivityFeed"
import { useCompletionToasts } from "@/composables/useCompletionToasts"
import { useShell } from "@/composables/useShell"

/** Utils */
import { computed } from "vue"
import { IS_PLACEHOLDER } from "@/contracts/bridge-generation"
import { TESTIDS } from "@/lib/testids"

const shell = useShell()
const section = shell.section

// The one place completion toasts come from, whichever section is visible. A network with no
// bridge generation instantiates none of the journal machinery, here or anywhere: the feed is
// built once and handed to the dock, and its absence is what keeps the dock out of the tree.
if (!IS_PLACEHOLDER) useCompletionToasts()
const feed = IS_PLACEHOLDER ? null : useActivityFeed()
const activityCount = computed(() => feed?.count.value ?? 0)

/** States with a dedicated in-panel UI never go to the strip: capability denial has the red morph
 *  everywhere; no-wallet has the install CTA on the faucet only (the others have no CTA, so it shows here). */
const stripExclude = computed(() => (section.value === "drip" ? ["no-wallet", "capability-rejected"] : ["capability-rejected"]))

const HEADERS = {
	send: { title: "Send", subline: "Any ERC-20 · Ethereum ↔ Aztec · public or private · arrive with gas" },
	drip: { title: "Faucet", subline: "Alpha-testnet only · fixed amounts · permissionless dripper · no rate limit" },
	activity: { title: "Activity", subline: "Every bridge this browser started or restored, with its next step" },
} as const
const header = computed(() => HEADERS[section.value])
</script>

<template>
	<main class="shell" :data-testid="TESTIDS.app" :data-section="section">
		<aside class="rail">
			<div class="brand"><span class="mark" aria-hidden="true" /><span>Nulo <em>tools</em></span></div>
			<RailNav :activity-count="activityCount" />
			<div class="rail-foot">
				<ThemeToggle />
			</div>
		</aside>

		<div class="main">
			<SectionHeader :title="header.title" :subline="header.subline">
				<template #wallets>
					<template v-if="section === 'drip'">
						<AztecWalletPanel variant="faucet" />
					</template>
					<template v-else>
						<L1WalletPanel />
						<AztecWalletPanel variant="bridge" />
					</template>
				</template>
			</SectionHeader>

			<div class="body">
				<!-- ONE strip for the shared session, above whichever view is active — the views stay
				     mounted (v-show), so per-view strips would render duplicate alerts/testids with
				     diverging dismissal state. -->
				<ConnectionErrorStrip class="strip-slot" :exclude="stripExclude" />

				<!-- v-show (not v-if): Send and Faucet keep their local state across switches; both read
				     the ONE wallet session singleton. Activity has no local state of its own. -->
				<DripView v-show="section === 'drip'" />
				<SendView v-show="section === 'send'" />
				<ActivityView v-if="section === 'activity'" />
			</div>

			<Footer v-if="section === 'drip'" />
			<BridgeFooter v-else />
		</div>

		<!-- On Activity the page IS the dock, so it is unmounted there, not merely hidden. -->
		<ActivityDock v-if="feed && section !== 'activity'" :feed="feed" />

		<AppToastRegion />
		<!-- ONE picker for the shared session — the panels only trigger connect(). -->
		<WalletPickerModal />
		<ChooseAccountModal />
	</main>
</template>

<style scoped>
.shell {
	display: grid;
	grid-template-columns: 200px minmax(0, 1fr) auto;
	min-height: 100vh;
	color: var(--txt-primary);
}

.rail {
	display: flex;
	flex-direction: column;
	padding: 18px 12px 20px;
	border-right: 1px solid var(--nulo-outline);
}

.brand {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 10px 24px;
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: -0.01em;
}

.brand em {
	font-style: normal;
	font-weight: 500;
	color: var(--txt-secondary);
}

.mark {
	position: relative;
	flex: none;
	width: 18px;
	height: 18px;
	border: 2px solid var(--txt-primary);
	border-radius: 50%;
}

.mark::after {
	content: "";
	position: absolute;
	inset: 4px;
	border-radius: 50%;
	background: var(--txt-primary);
}

.rail-foot {
	margin-top: auto;
	padding: 0 2px;
}

.main {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.body {
	display: flex;
	flex-direction: column;
	gap: 24px;
	flex: 1;
	padding: 28px 36px 40px;
}

.strip-slot:empty {
	display: none;
}

@media (max-width: 760px) {
	.shell {
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto minmax(0, 1fr);
	}

	.rail {
		grid-column: 1 / -1;
		flex-direction: row;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-right: 0;
		border-bottom: 1px solid var(--nulo-outline);
	}

	.brand {
		padding: 0 6px 0 0;
	}

	.rail-foot {
		margin-top: 0;
		margin-left: auto;
	}

	.body {
		padding: 20px 16px 32px;
	}
}
</style>
