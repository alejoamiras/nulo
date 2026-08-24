<script setup>
/** Utils */
import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY, SCHEMA_RETRY_REQUESTED_KEY } from "@/wallet/storage/migrations"

/** Reactive state */
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
				sub: "Your funds are safe. Tap Retry update — the wallet restarts and retries.",
			}
})
const retryRequested = ref(false)

/** Handlers */
// `refresh()`'s get-snapshot and `onChanged` events ride different IPC
// channels with no cross-channel ordering guarantee: a stale snapshot
// resolving AFTER an event could resurrect an already-cleared state (a
// permanent "UPDATING" overlay). Events win — the snapshot only fills keys
// no event has touched yet.
const eventTouched = new Set()
async function refresh() {
	const res = await chrome.storage.local.get([SCHEMA_RUNNING_KEY, SCHEMA_BLOCKED_KEY, SCHEMA_DEGRADED_KEY])
	if (!eventTouched.has(SCHEMA_RUNNING_KEY)) running.value = SCHEMA_RUNNING_KEY in res
	if (!eventTouched.has(SCHEMA_BLOCKED_KEY)) blocked.value = res[SCHEMA_BLOCKED_KEY] ?? null
	if (!eventTouched.has(SCHEMA_DEGRADED_KEY)) degraded.value = res[SCHEMA_DEGRADED_KEY] ?? null
}
function onStorageChanged(changes, area) {
	if (area !== "local") return
	if (SCHEMA_RUNNING_KEY in changes) {
		eventTouched.add(SCHEMA_RUNNING_KEY)
		running.value = changes[SCHEMA_RUNNING_KEY].newValue !== undefined
	}
	if (SCHEMA_BLOCKED_KEY in changes) {
		eventTouched.add(SCHEMA_BLOCKED_KEY)
		blocked.value = changes[SCHEMA_BLOCKED_KEY].newValue ?? null
	}
	if (SCHEMA_DEGRADED_KEY in changes) {
		eventTouched.add(SCHEMA_DEGRADED_KEY)
		degraded.value = changes[SCHEMA_DEGRADED_KEY].newValue ?? null
	}
}
// Per-mount dismiss ON PURPOSE: the degraded status persists in storage until
// the next healthy boot clears it, so the banner returns on a fresh popup —
// a degraded wallet should keep saying so, without nagging within a session.
function dismissDegraded() {
	degraded.value = null
}
// Same allowlisted raw-storage channel as the reads above, plus a
// DETERMINISTIC restart: closing the popup does not kill the service worker
// (its rejected single-flight memo is sticky for the lifetime), so the only
// honest "retry" is writing the one-shot gesture token and reloading the
// extension — the fresh boot's gate consumes the token and runs the engine.
async function requestRetry() {
	if (retryRequested.value) return
	retryRequested.value = true
	try {
		await chrome.storage.local.set({ [SCHEMA_RETRY_REQUESTED_KEY]: { requestedAt: Date.now() } })
		chrome.runtime.reload()
	} catch {
		// The write failed — nothing was requested; let the user tap again.
		retryRequested.value = false
	}
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
		<div v-if="state === 'blocked'" :class="$style.wrapper" data-testid="migration-blocked">
			<div :class="$style.card">
				<MaterialIcon name="warning" size="24" color="--red" />
				<span :class="$style.title">{{ blockedCopy.title }}</span>
				<span :class="$style.sub">{{ blockedCopy.sub }}</span>
				<span :class="$style.detail" data-testid="migration-blocked-detail">{{ blocked.detail }}</span>
				<button
					v-if="!blocked.terminal"
					type="button"
					:class="$style.retryBtn"
					:disabled="retryRequested"
					data-testid="migration-retry-btn"
					@click="requestRetry"
				>
					{{ retryRequested ? "Restarting…" : "Retry update" }}
				</button>
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
	background-color: var(--yellow);
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

.retryBtn {
	margin-top: 8px;
	padding: 8px 16px;

	border: 1px solid var(--nulo-border);
	background-color: var(--nulo-surface-low);
	color: var(--txt-primary);

	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 12px;
	cursor: pointer;
}

.retryBtn:disabled {
	opacity: 0.6;
	cursor: default;
}
</style>
