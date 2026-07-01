<script setup>
/** Services */
import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY } from "@/wallet/storage/migrations"

/** 6. Reactive state */
// Raw chrome.storage reads ON PURPOSE (allowlisted in storage-facade-ban):
// the facade awaits `running` clearing, but this component's whole job is to
// OBSERVE that state — going through the facade would deadlock. It only ever
// touches reserved `nulo:schema:*` keys, never user data.
const running = ref(false)
const blocked = ref(null)
const degraded = ref(null)

const state = computed(() => {
	if (blocked.value) return "blocked"
	if (running.value) return "updating"
	if (degraded.value) return "degraded"
	return "idle"
})
const blockedCopy = computed(() => {
	if (!blocked.value) return null
	return blocked.value.terminal
		? {
				title: "UPDATE FAILED",
				sub: "Your funds are safe — your secret phrase still recovers your accounts. Reinstall the extension to start clean.",
			}
		: {
				title: "UPDATE INTERRUPTED",
				sub: "Your funds are safe. Close and reopen the extension to retry the update.",
			}
})

/** 8. Handlers */
async function refresh() {
	const res = await chrome.storage.local.get([SCHEMA_RUNNING_KEY, SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY])
	running.value = SCHEMA_RUNNING_KEY in res
	blocked.value = res[SCHEMA_BLOCKED_KEY] ?? null
	degraded.value = res[SCHEMA_DEGRADED_KEY] ?? null
}
function onStorageChanged(changes, area) {
	if (area !== "local") return
	if (SCHEMA_RUNNING_KEY in changes) running.value = changes[SCHEMA_RUNNING_KEY].newValue !== undefined
	if (SCHEMA_BLOCKED_KEY in changes) blocked.value = changes[SCHEMA_BLOCKED_KEY].newValue ?? null
	if (SCHEMA_DEGRADED_KEY in changes) degraded.value = changes[SCHEMA_DEGRADED_KEY].newValue ?? null
}
function dismissDegraded() {
	degraded.value = null
}

/** 10. Lifecycle */
chrome.storage.onChanged.addListener(onStorageChanged)
void refresh()
onBeforeUnmount(() => {
	chrome.storage.onChanged.removeListener(onStorageChanged)
})
</script>

<template>
	<Teleport to="body">
		<div v-if="state === 'blocked'" :class="$style.wrapper" data-testid="migration-blocked">
			<div :class="$style.card">
				<MaterialIcon name="warning" size="24" color="--red" />
				<span :class="$style.title">{{ blockedCopy.title }}</span>
				<span :class="$style.sub">{{ blockedCopy.sub }}</span>
				<span :class="$style.detail" data-testid="migration-blocked-detail">{{ blocked.detail }}</span>
			</div>
		</div>

		<div v-else-if="state === 'updating'" :class="$style.wrapper" data-testid="migration-updating">
			<div :class="$style.card">
				<Spinner size="24" color="--txt-primary" />
				<span :class="$style.title">UPDATING</span>
				<span :class="$style.sub">Adapting your saved data to the new version</span>
			</div>
		</div>

		<div v-else-if="state === 'degraded'" :class="$style.banner" data-testid="migration-degraded">
			<span :class="$style.bannerText">Part of the last update didn't apply — some data may look outdated.</span>
			<button type="button" :class="$style.bannerDismiss" data-testid="migration-degraded-dismiss" @click="dismissDegraded">✕</button>
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

.banner {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;

	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;

	padding: 6px 10px;
	background-color: var(--yellow, #b45309);
	z-index: 10000;
}

.bannerText {
	font-size: 11px;
	color: var(--txt-primary);
}

.bannerDismiss {
	border: none;
	background: none;
	color: var(--txt-primary);
	cursor: pointer;
	font-size: 11px;
}
</style>
