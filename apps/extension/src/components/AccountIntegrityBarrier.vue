<script setup>
/** Utils */
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT, AccountIntegrityBlockedSchema } from "@/wallet/services/account-integrity/types"

/** Store + route (router-aware: `route.name` normalizes trailing slashes + query params that a
 *  raw-hash substring/equality test would get wrong). */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()
const route = useRoute()

/** Reactive state */
// Raw chrome.storage reads ON PURPOSE (allowlisted in storage-facade-ban, same as
// MigrationBarrier): this component OBSERVES the background coordinator's durable blocking records.
const blockedRecords = ref([])

// The auth + register screens are pre-session heal/retry vectors — never overlay them.
const isPreAuthRoute = computed(() => route.name === "popup-auth" || route.name === "popup-register")
// GROUND TRUTH for "which profile is on screen" — the app store, not the `lastActiveProfile`
// storage pointer (which can be stale/missing while the app presents a fallback profile).
const presentedProfileId = computed(() => appStore.profile?.id ?? null)

const isBlocked = computed(() => {
	if (isPreAuthRoute.value) return false
	if (blockedRecords.value.length === 0) return false
	// FAIL CLOSED: a corrupt record (unknown profile) always blocks; a record for the presented
	// profile blocks; and if a block EXISTS but the presented profile can't be resolved yet, block
	// rather than expose a possibly-mismatched profile.
	if (presentedProfileId.value === null) return true
	return blockedRecords.value.some((r) => r.profileId === null || r.profileId === presentedProfileId.value)
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
		<BarrierOverlay v-if="isBlocked" testid="account-integrity-blocked" subTestid="account-integrity-blocked-copy">
			<template #title>ACCOUNT VERIFICATION FAILED</template>
			<template #sub>
				This version of the wallet derives a different address than this profile's accounts were
				created with, so the profile has been locked. Your recovery phrase still derives your accounts
				on a compatible version of Nulo. Never enter your recovery phrase anywhere in response to this
				message — no legitimate screen will ask for it.
			</template>
			<template #detail>
				Install a compatible wallet version, then unlock from the lock screen to re-run
				verification. Your data on this device is untouched.
			</template>
		</BarrierOverlay>
	</Teleport>
</template>
