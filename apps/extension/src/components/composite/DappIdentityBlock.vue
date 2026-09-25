<script setup>
/**
 * The `name` field is dApp-controlled metadata from the discovery payload. Route through
 * sanitizeWireString to strip bidi overrides, zero-width chars, etc. so a phishing dApp can't
 * impersonate a familiar name via Unicode tricks.
 */
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"

const props = defineProps({
	/** From useDappInteractionPayload.dapp; reads `loadingLogo`,
	 *  `logoBlobUrl`, and `name` keys. */
	dapp: { type: Object, default: null },
	/** Pre-normalized hostname (parent computes from `dapp.url`). */
	hostname: { type: String, default: "" },
	/** Anti-phishing flag — shows the homograph warning line under the hostname. */
	hostnameSuspicious: { type: Boolean, default: false },
	/** Per-window verb (e.g. "wants to connect to your wallet"). */
	actionLabel: { type: String, required: true },
	/** Forwarded to the hostname `<span>` so e2e selectors stay scoped
	 *  per window (e.g. "discover-hostname", "capabilities-hostname"). */
	hostnameTestId: { type: String, default: undefined },
	nameTestId: { type: String, default: undefined },
})

const sanitizedName = computed(() => (props.dapp?.name ? sanitizeWireString(props.dapp.name, 64) : ""))
</script>

<template>
	<Flex :align="hostnameSuspicious ? 'start' : 'center'" gap="12" :class="$style.dapp_block">
		<div :class="$style.dapp_logo_wrapper">
			<Icon v-if="dapp?.loadingLogo" :loading="true" name="dapp" size="24" color="tertiary" />
			<img v-else-if="dapp?.logoBlobUrl" :src="dapp?.logoBlobUrl" :class="$style.dapp_logo" alt="" />
			<Icon v-else name="dapp" size="24" color="tertiary" />
		</div>

		<Flex direction="column" gap="4" wide :class="$style.dapp_info">
			<Flex align="center" gap="6">
				<span :data-testid="hostnameTestId" :class="$style.dapp_hostname">{{ hostname }}</span>
			</Flex>
			<Flex v-if="hostnameSuspicious" align="start" gap="6" data-testid="dapp-hostname-warning">
				<Icon name="warning" size="12" color="orange" aria-hidden="true" :class="$style.warning_icon" />
				<span :class="$style.warning_text">
					This hostname contains non-ASCII or punycoded characters. Verify carefully — some characters can imitate Latin letters.
				</span>
			</Flex>
			<span v-if="sanitizedName" :data-testid="nameTestId" :class="$style.dapp_name">{{ sanitizedName }}</span>
			<span :class="$style.dapp_action">{{ actionLabel }}</span>
		</Flex>
	</Flex>
</template>

<style module>
.dapp_block {
	flex-shrink: 0;

	padding: 16px;
	border-bottom: 1px solid var(--nulo-border);
}

.dapp_logo_wrapper {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;

	width: 40px;
	height: 40px;

	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
}

.dapp_logo {
	width: 40px;
	height: 40px;
	object-fit: cover;
}

.dapp_info {
	min-width: 0;
}

.dapp_hostname {
	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.01em;
	color: var(--txt-primary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.warning_icon {
	margin-top: 1px;
}

.warning_text {
	font-size: 12px;
	font-weight: 500;
	line-height: 1.3;
	color: var(--orange);
}

.dapp_name {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.dapp_action {
	font-family: var(--font-body);
	font-size: 12px;
	color: var(--nulo-secondary);
}
</style>
