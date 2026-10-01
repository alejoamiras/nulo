<script setup>
/** Components */
import { Skeleton } from "@nulo/design"

/** Composables */
import { isRepeatOrComposing } from "@/composables/usePopupEntity"

/** Store */
import { usePopupStore } from "@/stores/popup.store"
const popupStore = usePopupStore()

const emit = defineEmits(["retry"])
const props = defineProps({
	token: {
		type: Object,
	},
	/** The page's tokens are still loading: the card is inert until they arrive. */
	loading: {
		type: Boolean,
		default: false,
	},
	/** The page's last load was refused: the card offers a Retry in place of the empty state. */
	failed: {
		type: Boolean,
		default: false,
	},
})

/** A token handed in is always drawn: the page passes one only once its tokens have loaded. */
const isLoading = computed(() => props.loading && !props.token)
const state = computed(() => {
	if (props.token) return "ready"
	if (isLoading.value) return "loading"
	return props.failed ? "failed" : "empty"
})

const isTokenRestricted = computed(() => {
	if (!props.token) return
	return !props.token.hasPrivateTransfers || !props.token.hasPublicTransfers
})
const isTokenBlocked = computed(() => {
	return !props.token.hasPrivateTransfers && !props.token.hasPublicTransfers
})

/** A skeleton covers only a wait long enough to notice; a quick load shows an empty row. */
const SKELETON_DELAY_MS = 300
const skeletonShown = ref(false)
let skeletonTimer

const handleSelectToken = () => {
	if (isLoading.value) return
	if (props.token) {
		popupStore.open("select_token")
	} else if (props.failed) {
		emit("retry")
	} else {
		popupStore.open("new_token")
	}
}

/** A held key repeats its keydown, which would retry again as soon as a quick refusal lands. */
const handleKey = (e) => {
	if (!isRepeatOrComposing(e)) handleSelectToken()
}

watch(
	isLoading,
	(loading) => {
		clearTimeout(skeletonTimer)
		skeletonShown.value = false
		if (!loading) return
		skeletonTimer = setTimeout(() => {
			skeletonShown.value = true
		}, SKELETON_DELAY_MS)
	},
	{ immediate: true },
)

onBeforeUnmount(() => {
	clearTimeout(skeletonTimer)
})
</script>

<template>
	<Flex
		@click="handleSelectToken"
		@keydown.enter.prevent="handleKey"
		@keydown.space.prevent="handleKey"
		align="center"
		justify="between"
		:class="[$style.wrapper, isLoading && $style.wrapper_loading]"
		role="button"
		:tabindex="isLoading ? -1 : 0"
		:aria-busy="isLoading || undefined"
		:aria-disabled="isLoading || undefined"
		:aria-label="isLoading ? 'Loading tokens' : undefined"
		:data-state="state"
		data-testid="send-token-trigger"
	>
		<template v-if="token">
			<Flex align="center" gap="12">
				<Flex align="center" justify="center" :class="$style.token_icon_box">
					<span :class="$style.token_initial">{{ token.symbol?.charAt(0) }}</span>
					<Icon v-if="isTokenBlocked" name="warning" size="10" color="red" :class="$style.type_icon" />
				</Flex>

				<Flex direction="column" gap="2">
					<span :class="$style.token_symbol" data-testid="send-token-symbol">{{ token.symbol }}</span>
					<span :class="$style.token_name">{{ token.name }}</span>
				</Flex>
			</Flex>

			<MaterialIcon name="chevron_right" :size="20" color="primary" />
		</template>

		<Flex v-else-if="isLoading" align="center" gap="12" :class="$style.loading_row">
			<template v-if="skeletonShown">
				<Skeleton :width="36" :height="36" />
				<Flex direction="column" gap="6">
					<Skeleton :width="52" :height="14" />
					<Skeleton :width="84" :height="9" />
				</Flex>
			</template>
		</Flex>

		<Flex v-else-if="state === 'failed'" wide align="center" justify="between">
			<span :class="$style.empty_label">Couldn't load tokens</span>
			<span :class="$style.import_link">Retry</span>
		</Flex>

		<Flex v-else wide align="center" justify="between">
			<span :class="$style.empty_label">No available tokens</span>
			<span :class="$style.import_link">Import token</span>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	width: 100%;

	cursor: pointer;

	/* The parent `.section` already pads 14px top/bottom; keep this minimal so the
	 * two don't stack into the oversized gap the token row had. */
	padding: 4px 0;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: color-mix(in srgb, var(--nulo-surface-low) 50%, transparent);
	}
}

.wrapper_loading {
	cursor: default;

	&:hover {
		background: none;
	}
}

/* The token row's height, so the card does not jump when the token arrives. */
.loading_row {
	min-height: 36px;
}

.token_icon_box {
	position: relative;
	width: 36px;
	height: 36px;
	flex-shrink: 0;

	background: var(--nulo-accent);
}

.token_initial {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 16px;
	color: var(--txt-inverse);
}

.type_icon {
	position: absolute;
	top: -4px;
	right: -4px;

	box-sizing: content-box;
	background: var(--app-bg);
	padding: 1px;
}

.token_symbol {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 16px;
	color: var(--txt-primary);
}

.token_name {
	font-family: var(--font-mono);
	font-size: 10px;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_label {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.import_link {
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--nulo-accent);
}
</style>
