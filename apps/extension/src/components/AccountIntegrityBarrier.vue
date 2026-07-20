<script setup>
/** Utils */
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT, AccountIntegrityBlockedSchema } from "@/wallet/services/account-integrity/types"

/** Reactive state */
// Raw chrome.storage reads ON PURPOSE (allowlisted in storage-facade-ban, same as
// MigrationBarrier): this component OBSERVES the background coordinator's durable blocking
// records. Scope rules:
//  - A record for the LAST-ACTIVE profile (the one this popup presents) raises the barrier.
//    Records for other profiles don't brick the whole wallet — their profiles simply refuse to
//    unlock, and they can be deleted from a healthy profile's settings.
//  - A CORRUPT record (unparseable, so its profile is unknown) blocks regardless — fail-closed.
//  - The barrier YIELDS on the pre-auth routes (auth/register): unlock is the safe retry vector —
//    a compatible build's verification heals the record; an incompatible one re-withholds the
//    session. Both screens are pre-session and never expose account data.
const blockedRecords = ref([])
const lastActiveProfileId = ref(null)
const routeHash = ref(window.location.hash)

// Exact PATH comparison, not substring: a protected route can carry an auth path in a query
// param (e.g. `#/popup/general?return=/popup/auth`), which a substring test would wrongly treat
// as pre-auth and suppress the barrier. Strip the leading `#` and any query/hash tail.
const routePath = computed(() => routeHash.value.replace(/^#/, "").split(/[?#]/)[0])
const isPreAuthRoute = computed(() => routePath.value === "/popup/auth" || routePath.value === "/popup/register")

const isBlocked = computed(() => {
	if (isPreAuthRoute.value) return false
	if (blockedRecords.value.length === 0) return false
	// FAIL CLOSED: a corrupt record (unknown profile) always blocks; a record for the presented
	// (last-active) profile blocks; and if a block EXISTS but the presented-profile identity can't
	// be resolved (missing/stale `lastActiveProfile` while the app fell back to profiles[0]), block
	// rather than silently expose a possibly-mismatched profile.
	if (lastActiveProfileId.value === null) return true
	return blockedRecords.value.some((r) => r.profileId === null || r.profileId === lastActiveProfileId.value)
})

/** Handlers */
const prefix = `${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@`
// Monotonic guard: two onChanged-driven refreshes can resolve out of order; only the newest
// snapshot may commit, so a stale no-block read can't overwrite a fresh blocking read.
let refreshGeneration = 0
async function refresh() {
	const generation = ++refreshGeneration
	const all = await chrome.storage.local.get(null)
	if (generation !== refreshGeneration) return
	lastActiveProfileId.value = all["nulo:ui:lastActiveProfile"] ?? null
	blockedRecords.value = Object.entries(all)
		.filter(([k]) => k.startsWith(prefix))
		.map(([, v]) => {
			try {
				const parsed = AccountIntegrityBlockedSchema.safeParse(JSON.parse(v))
				return { profileId: parsed.success ? parsed.data.profileId : null }
			} catch {
				return { profileId: null }
			}
		})
}
function onStorageChanged(changes, area) {
	if (area !== "local") return
	if (Object.keys(changes).some((k) => k.startsWith(prefix) || k === "nulo:ui:lastActiveProfile")) void refresh()
}
function onHashChange() {
	routeHash.value = window.location.hash
}

/** Service subscriptions (before the initial read, so no change is missed) */
chrome.storage.onChanged.addListener(onStorageChanged)
window.addEventListener("hashchange", onHashChange)
void refresh()

/** Lifecycle */
onBeforeUnmount(() => {
	chrome.storage.onChanged.removeListener(onStorageChanged)
	window.removeEventListener("hashchange", onHashChange)
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
					Install a compatible wallet version, then unlock from the lock screen to re-run
					verification. Your data on this device is untouched.
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
