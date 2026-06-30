<script setup>
/**
 * Top identity strip for dApp interaction windows (discover,
 * capabilities, execute). Renders the active account + network +
 * status dot and the brand mark on the right.
 *
 * The status dot color is driven by `status`:
 * - `ready`   → green (idle)
 * - `loading` → orange (request in flight)
 * - `cancelled` → red (interaction cancelled by the dApp)
 */
defineProps({
	accountName: { type: String, default: "" },
	networkName: { type: String, default: "" },
	status: { type: String, default: "ready" },
})
</script>

<template>
	<Flex align="center" justify="between" gap="12" :class="$style.identity_strip">
		<Flex align="center" gap="8">
			<span :class="[$style.status_dot, $style[`status_${status}`]]" />
			<span :class="$style.identity_account">{{ accountName || "No account" }}</span>
			<span :class="$style.identity_sep">·</span>
			<span :class="$style.identity_network">{{ networkName }}</span>
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

.status_ready {
	background: var(--green);
}
.status_loading {
	background: var(--orange);
}
.status_cancelled {
	background: var(--red);
}

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

.identity_brand {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	color: var(--nulo-outline);
}
</style>
