<script setup lang="ts">
/**
 * Identity strip for the execute window. Different from
 * `DappStatusStrip` because the execute payload may target multiple
 * accounts / chains; in that case the strip shows
 * "{N} accounts · MIXED" so the user knows the request will signed
 * across more than one account before they hit Confirm.
 */
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"

defineProps<{
	signerAccounts: Account[]
	signerNetworks: Network[]
	status: "ready" | "loading" | "cancelled"
}>()
</script>

<template>
	<Flex align="center" justify="between" gap="12" :class="$style.identity_strip">
		<Flex align="center" gap="8">
			<span :class="[$style.status_dot, $style[`status_${status}`]]" />
			<template v-if="signerAccounts.length === 1">
				<span :class="$style.identity_account">{{ signerAccounts[0].name }}</span>
				<span :class="$style.identity_sep">·</span>
				<span :class="$style.identity_network">{{ signerNetworks[0]?.name ?? "" }}</span>
			</template>
			<template v-else-if="signerAccounts.length > 1">
				<span :class="$style.identity_account">{{ signerAccounts.length }} accounts</span>
				<span :class="$style.identity_sep">·</span>
				<span :class="[$style.identity_network, $style.identity_warn]">MIXED</span>
			</template>
			<template v-else>
				<span :class="$style.identity_account">No signer</span>
			</template>
		</Flex>
		<span :class="$style.identity_brand">NULO</span>
	</Flex>
</template>

<style module>
.identity_strip {
	flex-shrink: 0;

	padding: 10px 16px;
	background: var(--nulo-surface);
	border-bottom: 1px solid var(--nulo-border);
}

.status_dot {
	display: inline-block;
	width: 6px;
	height: 6px;
	flex-shrink: 0;
}

.status_ready { background: var(--green); }
.status_loading { background: var(--orange); }
.status_cancelled { background: var(--red); }

.identity_account {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--txt-primary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 140px;
}

.identity_sep {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);
}

.identity_network {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 80px;
}

.identity_warn {
	color: var(--orange);
	font-weight: 700;
}

.identity_brand {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	color: var(--nulo-outline);
}
</style>
