<script setup lang="ts">
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { computed, onBeforeUnmount } from "vue"
import { type DripTarget, useFaucetDrip } from "@/composables/useFaucetDrip"
import { useTokenBalance } from "@/composables/useTokenBalance"
import { useToast } from "@/composables/useToast"
import type { FaucetToken } from "@/constants/tokens"
import { explorerTxUrl } from "@/lib/explorer"
import { TESTIDS } from "@/lib/testids"
import Card from "./ui/Card.vue"
import BalanceRow from "./composite/BalanceRow.vue"
import DisclaimerTag from "./composite/DisclaimerTag.vue"
import DripButton from "./composite/DripButton.vue"

const props = defineProps<{
	token: FaucetToken
	tokenAddress: AztecAddress
	wallet: Wallet
	account: AztecAddress
}>()

const balance = useTokenBalance(props.wallet, props.tokenAddress, props.account)
const drip = useFaucetDrip(props.wallet, props.account)
const { push } = useToast()

onBeforeUnmount(() => {
	balance.dispose()
})

const publicDripping = computed(() => drip.isActive(props.token.symbol, "public"))
const privateDripping = computed(() => drip.isActive(props.token.symbol, "private"))
const buttonsDisabled = computed(() => drip.inflight.value !== null)

const publicLast = computed(() => drip.last[`${props.token.symbol}:public`] ?? null)
const privateLast = computed(() => drip.last[`${props.token.symbol}:private`] ?? null)

const cardDripState = computed<"idle" | "dripping" | "ok" | "error">(() => {
	if (publicDripping.value || privateDripping.value) return "dripping"
	const latest = publicLast.value ?? privateLast.value
	if (!latest) return "idle"
	return latest.kind === "txHash" ? "ok" : "error"
})

function dripStateFor(target: DripTarget) {
	const isActive = target === "public" ? publicDripping.value : privateDripping.value
	if (isActive) return "dripping" as const
	const last = target === "public" ? publicLast.value : privateLast.value
	if (!last) return "idle" as const
	return last.kind === "txHash" ? ("ok" as const) : ("error" as const)
}

async function handleDrip(target: DripTarget) {
	const result = await drip.drip(props.token, props.tokenAddress, target)
	if (result.kind === "txHash") {
		const txUrl = explorerTxUrl(result.value)
		push({
			kind: "ok",
			text: `Dripped ${props.token.displayAmount} ${props.token.symbol} to ${target}`,
			link: txUrl ? { label: "view tx", href: txUrl } : undefined,
		})
		await balance.refresh()
	} else {
		push({ kind: "error", text: result.value })
	}
}
</script>

<template>
	<Card :data-testid="TESTIDS.tokenCard" :data-symbol="token.symbol">
		<header class="head">
			<h3 class="symbol">{{ token.symbol }}</h3>
			<p class="sub">Fixed drip: {{ token.displayAmount }} {{ token.symbol }}</p>
		</header>
		<BalanceRow
			:public-balance="balance.publicBalance.value"
			:private-balance="balance.privateBalance.value"
			:decimals="token.decimals"
			:loading="balance.loading.value"
		/>
		<div class="actions">
			<DripButton
				:state="dripStateFor('public')"
				:disabled="buttonsDisabled && !publicDripping"
				:label="`Drip ${token.displayAmount} ${token.symbol} to public`"
				:data-testid="TESTIDS.btnDripPublic"
				@click="handleDrip('public')"
			/>
			<DripButton
				:state="dripStateFor('private')"
				:disabled="buttonsDisabled && !privateDripping"
				:label="`Drip ${token.displayAmount} ${token.symbol} to private`"
				:data-testid="TESTIDS.btnDripPrivate"
				@click="handleDrip('private')"
			/>
		</div>
		<p v-if="privateDripping" class="hint">Private drips take 30–90 seconds.</p>
		<footer class="foot">
			<DisclaimerTag />
			<span class="status" :data-testid="TESTIDS.dripStatus" :data-drip-status="cardDripState">
				{{ cardDripState }}
			</span>
		</footer>
	</Card>
</template>

<style scoped>
.head {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.symbol {
	font-family: var(--font-mono);
	font-size: 24px;
	font-weight: 600;
	color: var(--txt-primary);
	letter-spacing: -0.01em;
}

.sub {
	color: var(--txt-secondary);
	font-size: 13px;
	font-family: var(--font-mono);
}

.actions {
	display: flex;
	gap: 12px;
	flex-wrap: wrap;
}

.hint {
	color: var(--txt-secondary);
	font-size: 12px;
	font-family: var(--font-mono);
}

.foot {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.status {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
}

.status[data-drip-status="ok"] { color: var(--mint); }
.status[data-drip-status="error"] { color: var(--red); }
.status[data-drip-status="dripping"] { color: var(--yellow); }
</style>
