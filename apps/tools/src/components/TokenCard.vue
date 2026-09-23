<script setup lang="ts">
import type { AztecAddress } from "@aztec/aztec.js/addresses"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { computed, onBeforeUnmount, ref } from "vue"
import { type DripTarget, useDrip } from "@/composables/useDrip"
import { useAddDripToken } from "@/composables/useAddDripToken"
import { useTokenBalance, type UseTokenBalanceHandle } from "@/composables/useTokenBalance"
import { useToast } from "@/composables/useToast"
import type { DripToken } from "@/constants/tokens"
import { explorerTxUrl } from "@/lib/explorer"
import { formatBigInt } from "@/lib/format"
import { TESTIDS } from "@/lib/testids"
import { BalanceRow, Card, DisclaimerTag, DripButton } from "@nulo/design"

const props = defineProps<{
	token: DripToken
	tokenAddress: AztecAddress
	wallet?: Wallet
	account?: AztecAddress
}>()

// The card is always visible. Composables only activate when both wallet
// and account are present - keys the parent component on connection
// state so the card re-mounts cleanly on connect/disconnect.
const connected = !!(props.wallet && props.account)
const balance: UseTokenBalanceHandle | null =
	connected && props.wallet && props.account ? useTokenBalance(props.wallet, props.tokenAddress, props.account) : null
const drip = connected && props.wallet && props.account ? useDrip(props.wallet, props.account) : null
const addToken = useAddDripToken()
const { push, dismiss } = useToast()

// Hidden once the wallet reports this token registered (fail-open: failures show the button).
const registered = ref(false)
if (connected && props.wallet && props.account) {
	void addToken.isRegistered(props.wallet, props.tokenAddress).then((r) => {
		registered.value = r
	})
}

// Balance display strings. The presentational BalanceRow takes formatted text
// + testids; this card owns the bigint formatting + loading state.
const balanceLoading = computed(() => balance?.loading.value ?? false)
function renderBalance(value: bigint | null): string {
	if (value === null) return balanceLoading.value ? "…" : "-"
	return formatBigInt(value, props.token.decimals)
}
const publicText = computed(() => renderBalance(balance?.publicBalance.value ?? null))
const privateText = computed(() => renderBalance(balance?.privateBalance.value ?? null))

// Per-card "last drip" - single source of recency. Without this, a
// global-keyed lookup like `publicLast ?? privateLast` permanently
// prefers public over private and shows the wrong outcome after a
// later private drip.
interface CardDripState {
	readonly target: DripTarget
	readonly kind: "txHash" | "error"
	readonly value: string
	readonly txUrl: string
	readonly at: number
}
const lastDrip = ref<CardDripState | null>(null)
const emphasized = ref(false)
// The card pushes a toast with a "view tx" link on every successful drip.
// We track its id so that if the user re-drips before the toast TTL, we
// dismiss the prior toast - otherwise its (now-stale) link is still
// clickable during the new inflight state. Closes the toast-path mirror
// of the inline-row stale-link bug.
let lastTxToastId: number | null = null

const publicDripping = computed(() => (drip ? drip.isActive(props.token.symbol, "public") : false))
const privateDripping = computed(() => (drip ? drip.isActive(props.token.symbol, "private") : false))
const dripping = computed(() => publicDripping.value || privateDripping.value)
const buttonsDisabled = computed(() => !connected || (drip?.inflight.value ?? null) !== null)

const statusKind = computed<"idle" | "dripping" | "ok" | "error">(() => {
	if (dripping.value) return "dripping"
	const last = lastDrip.value
	if (!last) return "idle"
	return last.kind === "txHash" ? "ok" : "error"
})

const statusEmphasized = computed(() => emphasized.value && statusKind.value !== "idle")

const statusLabel = computed(() => {
	switch (statusKind.value) {
		case "dripping":
			return privateDripping.value ? "Proving private…" : "Submitting…"
		case "ok": {
			const last = lastDrip.value
			if (!last) return ""
			return `Sent ${props.token.displayAmount} ${props.token.symbol} to ${last.target}`
		}
		case "error":
			return lastDrip.value?.value ?? "Failed"
		default:
			return ""
	}
})

async function handleDrip(target: DripTarget) {
	if (!drip || !balance) return
	// Dismiss any still-visible toast from a prior drip so its (now-stale)
	// "view tx" link doesn't sit clickable during this new inflight cycle.
	if (lastTxToastId !== null) {
		dismiss(lastTxToastId)
		lastTxToastId = null
	}
	const result = await drip.drip(props.token, props.tokenAddress, target)
	const txUrl = result.kind === "txHash" ? explorerTxUrl(result.value) : ""
	lastDrip.value = {
		target,
		kind: result.kind,
		value: result.value,
		txUrl,
		at: Date.now(),
	}
	// Emphasis persists for BOTH success and error until the next drip
	// click clears it. Earlier behaviour decayed success after 3s, which
	// users missed entirely (friends-QA feedback). The next click resets
	// state at the top of this handler.
	emphasized.value = true

	if (result.kind === "txHash") {
		lastTxToastId = push({
			kind: "ok",
			text: `Dripped ${props.token.displayAmount} ${props.token.symbol} to ${target}`,
			link: txUrl ? { label: "view tx", href: txUrl } : undefined,
		})
		await balance.refresh()
	} else {
		push({ kind: "error", text: result.value })
	}
}

// Single tracked reset timer. Without this, rapid clicks (button only
// disabled during `submitting`) stack untracked setTimeouts - an older
// timer can fire DURING a newer submission and flip the composable back
// to `idle`, defeating the re-entrancy guard in `useAddDripToken`.
// Track + clear before re-setting.
let addTokenResetTimer: ReturnType<typeof setTimeout> | null = null
function scheduleAddTokenReset() {
	if (addTokenResetTimer !== null) clearTimeout(addTokenResetTimer)
	addTokenResetTimer = setTimeout(() => {
		addTokenResetTimer = null
		addToken.reset()
	}, 3_000)
}

async function handleAddToWallet() {
	if (!props.wallet || !props.account) return
	// Cancel any pending reset from a prior cycle so a stale timer can't
	// flip status back to `idle` mid-submission.
	if (addTokenResetTimer !== null) {
		clearTimeout(addTokenResetTimer)
		addTokenResetTimer = null
	}
	await addToken.addToken(props.wallet, props.account.toString(), props.tokenAddress)
	const final = addToken.status.value
	if (final.kind === "ok") {
		registered.value = true
		push({ kind: "ok", text: `${props.token.symbol} added to your wallet.` })
	} else if (final.kind === "error") {
		push({ kind: "error", text: final.error.message })
	} else if (final.kind === "unsupported") {
		push({ kind: "error", text: "Your wallet doesn't support adding tokens. Update Nulo and reload." })
	}
	// `rejected` is silent per the wallet-bridge cancel recipe - no toast.

	// Schedule the auto-reset so the button label returns to "Add to wallet".
	scheduleAddTokenReset()
}

onBeforeUnmount(() => {
	if (addTokenResetTimer !== null) {
		clearTimeout(addTokenResetTimer)
		addTokenResetTimer = null
	}
	balance?.dispose()
})
</script>

<template>
	<Card :data-testid="TESTIDS.tokenCard" :data-symbol="token.symbol" :data-connected="connected || undefined">
		<Flex tag="header" direction="column" gap="4">
			<h3 class="symbol">{{ token.symbol }}</h3>
			<p class="sub">Fixed drip: {{ token.displayAmount }} {{ token.symbol }}</p>
		</Flex>
		<BalanceRow
			:public-text="publicText"
			:private-text="privateText"
			:public-test-id="TESTIDS.balancePublic"
			:private-test-id="TESTIDS.balancePrivate"
		/>
		<Flex gap="12" wrap="wrap">
			<!-- Order matches the wallet popup convention: private first, public second. -->
			<DripButton
				:loading="privateDripping"
				:disabled="buttonsDisabled && !privateDripping"
				:label="`Get ${token.symbol} (private)`"
				:aria-label="`Get ${token.displayAmount} ${token.symbol} into your private balance`"
				:data-testid="TESTIDS.btnDripPrivate"
				@click="handleDrip('private')"
			/>
			<DripButton
				:loading="publicDripping"
				:disabled="buttonsDisabled && !publicDripping"
				:label="`Get ${token.symbol} (public)`"
				:aria-label="`Get ${token.displayAmount} ${token.symbol} into your public balance`"
				:data-testid="TESTIDS.btnDripPublic"
				@click="handleDrip('public')"
			/>
		</Flex>
		<div v-if="connected && !registered" class="add-to-wallet">
			<button
				type="button"
				class="add-to-wallet-btn"
				:disabled="addToken.status.value.kind === 'submitting'"
				:data-testid="TESTIDS.btnAddToWallet"
				:data-add-status="addToken.status.value.kind"
				:aria-label="`Add ${token.symbol} to your wallet`"
				@click="handleAddToWallet"
			>
				<template v-if="addToken.status.value.kind === 'submitting'">Adding…</template>
				<template v-else-if="addToken.status.value.kind === 'ok'">Added ✓</template>
				<template v-else>Add {{ token.symbol }} to wallet</template>
			</button>
		</div>
		<footer class="foot">
			<DisclaimerTag />
		</footer>
		<!--
		Status row sits BELOW the disclaimer so the disclaimer keeps a
		stable vertical position regardless of drip state. The card grows
		downward when the status appears instead of pushing existing
		layout around.
		-->
		<p v-if="!connected" class="hint">Connect a wallet to drip.</p>
		<div
			v-else-if="statusKind !== 'idle'"
			class="status-row"
			:data-testid="TESTIDS.dripStatus"
			:data-drip-status="statusKind"
			:data-emphasized="statusEmphasized || undefined"
		>
			<span class="status-text">{{ statusLabel }}</span>
			<a
				v-if="lastDrip?.txUrl && statusKind === 'ok'"
				class="status-link"
				:href="lastDrip.txUrl"
				target="_blank"
				rel="noopener noreferrer"
			>view tx →</a>
		</div>
	</Card>
</template>

<style scoped>
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

.add-to-wallet {
	display: flex;
}

.add-to-wallet-btn {
	flex: 1;
	padding: 8px 12px;
	background: transparent;
	border: 1px dashed var(--nulo-outline);
	color: var(--txt-secondary);
	font: 500 12px/1.3 var(--font-mono);
	letter-spacing: 0.04em;
	text-transform: uppercase;
	cursor: pointer;
	transition: border-color 0.15s ease, color 0.15s ease;
}

.add-to-wallet-btn:hover:not(:disabled) {
	border-color: var(--nulo-accent);
	color: var(--nulo-accent);
}

.add-to-wallet-btn:disabled {
	cursor: not-allowed;
	opacity: 0.6;
}

.add-to-wallet-btn[data-add-status="ok"] {
	border-color: var(--mint);
	color: var(--mint);
}

.hint {
	color: var(--txt-tertiary);
	font: 500 12px/1.3 var(--font-mono);
	letter-spacing: 0.02em;
}

.status-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 12px;
	border: 1px solid var(--nulo-outline);
	background: var(--nulo-surface-low);
	font: 500 12px/1.3 var(--font-mono);
	letter-spacing: 0.02em;
}

.status-text {
	color: var(--txt-tertiary);
}

.status-link {
	color: var(--txt-secondary);
	text-decoration: underline;
	text-underline-offset: 3px;
	font-size: 11px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	white-space: nowrap;
}

.status-link:hover {
	color: var(--nulo-accent);
}

.status-row[data-drip-status="dripping"] .status-text { color: var(--yellow); }
.status-row[data-drip-status="ok"][data-emphasized] .status-text { color: var(--mint); }
.status-row[data-drip-status="ok"][data-emphasized] .status-link { color: var(--mint); }
.status-row[data-drip-status="error"][data-emphasized] .status-text { color: var(--red); }
.status-row[data-drip-status="error"][data-emphasized] .status-link { color: var(--red); }

.foot {
	display: flex;
	justify-content: flex-start;
}
</style>
