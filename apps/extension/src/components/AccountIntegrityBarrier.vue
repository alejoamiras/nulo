<script setup>
/** Utils */
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT } from "@/wallet/services/account-integrity/types"

/** Reactive state */
// Raw chrome.storage reads ON PURPOSE (allowlisted in storage-facade-ban, same as
// MigrationBarrier): this component OBSERVES the background coordinator's durable blocking
// records. Presence of ANY key under the root means blocked — even a corrupt payload
// (fail-closed); the parsed record only enriches the copy.
const blockedKeys = ref([])
const isBlocked = computed(() => blockedKeys.value.length > 0)

/** Handlers */
const prefix = `${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@`
async function refresh() {
	const all = await chrome.storage.local.get(null)
	blockedKeys.value = Object.keys(all).filter((k) => k.startsWith(prefix))
}
function onStorageChanged(changes, area) {
	if (area !== "local") return
	if (Object.keys(changes).some((k) => k.startsWith(prefix))) void refresh()
}

/** Service subscriptions (before the initial read, so no change is missed) */
chrome.storage.onChanged.addListener(onStorageChanged)
void refresh()

/** Lifecycle */
onBeforeUnmount(() => {
	chrome.storage.onChanged.removeListener(onStorageChanged)
})
</script>

<template>
	<Teleport to="body">
		<!-- Deliberately: NO seed input, NO external links, NO delete CTA — deletion stays the
		     settings flow; this screen only explains and blocks. -->
		<div v-if="isBlocked" :class="$style.wrapper" data-testid="account-integrity-blocked">
			<div :class="$style.card">
				<MaterialIcon name="warning" size="24" color="--red" />
				<span :class="$style.title">ACCOUNT VERIFICATION FAILED</span>
				<span :class="$style.sub" data-testid="account-integrity-blocked-copy">
					This version of the wallet derives a different address than this profile's accounts were
					created with, so the profile has been locked. Your seed phrase still derives your accounts
					on a compatible version of Nulo. Never enter your seed phrase anywhere in response to this
					message — no legitimate screen will ask for it.
				</span>
				<span :class="$style.detail">
					Install a compatible wallet version to unlock this profile again. Your data on this device
					is untouched.
				</span>
			</div>
		</div>
	</Teleport>
</template>

<style module>
.wrapper {
	position: fixed;
	inset: 0;

	display: flex;
	justify-content: center;
	align-items: center;

	background-color: rgba(10, 9, 8, 0.92);
	z-index: 10000;
}

.card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;

	max-width: 280px;
	text-align: center;
}

.title {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	color: var(--txt-primary);
}

.sub {
	font-size: 12px;
	color: var(--txt-secondary);
}

.detail {
	font-size: 10px;
	color: var(--txt-tertiary);
	word-break: break-word;
}
</style>
