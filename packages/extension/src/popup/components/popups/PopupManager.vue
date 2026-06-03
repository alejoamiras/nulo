<script setup>
/** Components */
import AccountsPopup from "./AccountsPopup.vue"
import ChangeAuthwitsRegistryPopup from "./ChangeAuthwitsRegistryPopup.vue"
import ConfirmPopup from "./ConfirmPopup.vue"
import DataViewerPopup from "./DataViewerPopup.vue"
import EditAccountPopup from "./EditAccountPopup.vue"
import EditContactPopup from "./EditContactPopup.vue"
import EditFpcPopup from "./EditFpcPopup.vue"
import EditEndpointPopup from "./EditEndpointPopup.vue"
import EditNetworkPopup from "./EditNetworkPopup.vue"
import EditProfilePopup from "./EditProfilePopup.vue"
import ForgotPasswordPopup from "./ForgotPasswordPopup.vue"
import ImportContactsPopup from "./ImportContactsPopup.vue"
import IncomingTrustPopup from "./IncomingTrustPopup.vue"
import NewAccountPopup from "./NewAccountPopup.vue"
import NewContactPopup from "./NewContactPopup.vue"
import NewFpcPopup from "./NewFpcPopup.vue"
import NewEndpointPopup from "./NewEndpointPopup.vue"
import NewNetworkPopup from "./NewNetworkPopup.vue"
import NewSenderPopup from "./NewSenderPopup.vue"
import NewTokenPopup from "./NewTokenPopup.vue"
import ReceivePopup from "./ReceivePopup.vue"
import RevokeAuthwitsPopup from "./RevokeAuthwitsPopup.vue"
import SelectBalanceTypePopup from "./SelectBalanceTypePopup.vue"
import SelectFpcPopup from "./SelectFpcPopup.vue"
import SelectNetworksPopup from "./SelectNetworksPopup.vue"
import SelectProfilePopup from "./SelectProfilePopup.vue"
import SelectTokenPopup from "./SelectTokenPopup.vue"
import TokenMetadataPopup from "./TokenMetadataPopup.vue"

/** Services */
import { IncomingTransferServiceClient } from "@/wallet/services/incoming-transfer/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store.ts"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

// First-receive friction subscriber. PopupManager is always mounted in
// the popup app, so this is the canonical place to open the trust prompt
// when IncomingTransferService discovers a note from an unknown contract.
//
// Multi-contract queue: the service can emit-storm a batch of Pending
// events (e.g. `replayPendingPrompts` on (re)connect for N pending
// contracts), but the popup can only show one at a time. We queue them
// here, deduping by `(profileId, networkId, contract)` triple — codex
// post-impl audit M3 + opus C3: bare-contract dedup mis-handles the same
// token address that legitimately exists on multiple networks (e.g. a
// USDC twin). The dedup check covers BOTH (a) entries already in the
// queue and (b) the currently-open popup's payload (codex final-review
// L) so a replay-while-open doesn't enqueue a duplicate.
const incomingTransferService = new IncomingTransferServiceClient()
const pendingTrustQueue = []

function tripleKeyOf(payload) {
	return `${payload.profileId}|${payload.networkId}|${payload.contract}`
}

function activePopupKey() {
	const t = cacheStore.incomingTrust
	if (!t || !t.contract) return null
	return `${t.profileId ?? ""}|${t.networkId ?? ""}|${t.contract}`
}

function enqueueIfNew(payload) {
	const key = tripleKeyOf(payload)
	if (popupStore.isOpened("incoming_trust") && activePopupKey() === key) return false
	if (pendingTrustQueue.some((p) => tripleKeyOf(p) === key)) return false
	pendingTrustQueue.push(payload)
	return true
}

function dequeueNextPendingTrust() {
	if (popupStore.isOpened("incoming_trust")) return
	const next = pendingTrustQueue.shift()
	if (!next) return
	cacheStore.incomingTrust = {
		tokenSymbol: next.tokenSymbol,
		tokenDecimals: next.tokenDecimals,
		amountRaw: next.amountRaw,
		contract: next.contract,
		profileId: next.profileId,
		networkId: next.networkId,
		allow: () => incomingTransferService.setTrustAllow(next.profileId, next.networkId, next.contract),
		reject: () => incomingTransferService.setTrustReject(next.profileId, next.networkId, next.contract),
	}
	popupStore.open("incoming_trust")
}

function onIncomingTransferPending(payload) {
	if (!enqueueIfNew(payload)) return
	dequeueNextPendingTrust()
}
incomingTransferService.onIncomingTransferPending.add(onIncomingTransferPending)

// Replay pending prompts when the active appStore triple is ready (P8
// tactical C2 fix). The popup re-mounts on every open and `loadProfile`
// populates `appStore.profile/network/account` asynchronously. If
// `onConnected` fires BEFORE that cascade completes, the previous
// "early-return on missing triple" silently dropped the replay and
// the trust prompt never re-surfaced after a popup close/reopen.
//
// Fix: idempotency-key the replay by the triple itself. Both
// `onConnected` AND a granular watcher on the triple's id fields call
// `tryReplay`. The first one to see a ready triple wins; the other
// no-ops via `replayedForKey`. Subsequent profile switches re-key,
// so they re-fire replay for the new triple.
//
// Stale-resolve race under rapid profile switching (A→B→A) is documented
// residual: a B-replay resolving after the user returned to A enqueues
// stale payloads that get absorbed by the existing triple-key dedup
// (they don't match the active triple, so the popup ignores them).
// Full cancellation guards are deferred to the trust-state-machine arc.
let replayedForKey = null
async function tryReplayForTriple() {
	const pid = appStore.profile?.id
	const nid = appStore.network?.id
	const addr = appStore.account?.address
	if (!pid || !nid || !addr) return
	const key = `${pid}|${nid}|${addr}`
	if (replayedForKey === key) return
	replayedForKey = key
	try {
		await incomingTransferService.replayPendingPrompts(pid, nid, addr)
	} catch {
		// Transient port hiccup. Allow retry on the next triple change.
		replayedForKey = null
	}
}
incomingTransferService.onConnected.add(tryReplayForTriple)
const unwatchTriple = watch(
	() => [appStore.profile?.id, appStore.network?.id, appStore.account?.address],
	() => tryReplayForTriple(),
	{ immediate: false },
)

// Visibility-toggle gate: when `incomingTransfersVisible` flips false→true
// at runtime, the service's emit path is now silent on the OFF side
// (incoming-transfer/service.ts gates both `scanContract` Pending emits
// and `replayPendingPrompts` on the toggle). So a user who left contracts
// in pending state while toggled OFF gets no auto-prompt on toggle-on —
// PopupManager owns the false→true replay because it knows the active
// `(profile, network, account)` triple from `appStore`. The service can't
// reach that triple safely. Co-authored via codex post-impl audit H1.
const configService = new ConfigServiceClient()
let lastVisibility = true
// Init gate (P6, codex Med #1): the onUpdate handler must NOT process
// events until the seed `getValue` has resolved. Otherwise an OFF→ON
// flip arriving in the connect-vs-seed window reads the optimistic
// `true` default and misclassifies as no-op. Belt + suspenders alongside
// moving the listener registration into onMounted below.
let visibilityInitialized = false
function onConfigUpdate(prop) {
	if (!visibilityInitialized) return
	if (prop.key !== "incomingTransfersVisible") return
	const newValue = prop.value !== false
	const wasOff = lastVisibility === false
	lastVisibility = newValue
	if (!wasOff || !newValue) return
	if (!appStore.profile?.id || !appStore.network?.id || !appStore.account?.address) return
	incomingTransferService.replayPendingPrompts(appStore.profile.id, appStore.network.id, appStore.account.address).catch(() => {
		// Replay best-effort; transient port hiccups must not crash the popup.
	})
}

// ServiceClient doesn't auto-connect on listener registration — registers
// fire only after `connect()` or the first request. Explicit connect on
// mount so `onConnected` (replay path) and `onIncomingTransferPending`
// (live path) are both wired up immediately.
onMounted(async () => {
	try {
		await incomingTransferService.connect()
	} catch {
		// Connect is retried on the first method call; non-fatal here.
	}
	try {
		await configService.connect()
	} catch {
		// Non-fatal; toggle-flip replay just won't fire this session.
	}
	// Seed the "prior value" tracker so the first user-driven flip is
	// detected correctly. Without this, `lastVisibility` defaults to
	// `true` and an actual OFF→ON flip would be misread as no-op.
	try {
		lastVisibility = (await configService.getValue("incomingTransfersVisible")) !== false
	} catch {
		// Fail open — matches the service's own `isVisibilityEnabled` policy.
	}
	// Listener registration AFTER the seed completes (P6): the prior
	// module-top registration left a race window where a real OFF→ON
	// flip could be misclassified against the optimistic default. With
	// the registration inside onMounted, events fired before this point
	// are not delivered to this handler at all.
	configService.onUpdate.add(onConfigUpdate)
	visibilityInitialized = true
})

// Multi-contract queue: when the user resolves (Allow/Reject) and the
// trust popup closes, pull the next pending payload off the local queue
// and reopen the popup for it. The queue is fed by:
//   - live `onIncomingTransferPending` events (first-receive transition),
//   - `replayPendingPrompts` on (re)connect (above), which fires Pending
//     events for every contract in pending trust state,
//   - `replayPendingPrompts` on visibility OFF→ON flip (below).
// All three paths converge on the same queue + triple-key dedup, so a
// burst of overlapping events surfaces every distinct contract once,
// in arrival order.
watch(
	() => popupStore.isOpened("incoming_trust"),
	(isOpen, wasOpen) => {
		if (!wasOpen || isOpen) return
		dequeueNextPendingTrust()
	},
)

onBeforeUnmount(() => {
	// Deregister the config update listener BEFORE disconnect so a stale
	// event firing during teardown can't write to a torn lastVisibility /
	// visibilityInitialized state. Closes opus H-6 (listener leak across
	// popup mount/unmount cycles).
	configService.onUpdate.remove(onConfigUpdate)
	unwatchTriple()
	incomingTransferService.disconnect()
	configService.disconnect()
})
</script>

<template>
	<ForgotPasswordPopup :show="popupStore.isOpened('forgot_password')" @onClose="popupStore.close('forgot_password')" />

	<ConfirmPopup :show="popupStore.isOpened('confirm')" @onClose="popupStore.close('confirm')" />
	<DataViewerPopup :show="popupStore.isOpened('data_viewer')" @onClose="popupStore.close('data_viewer')" />

	<EditProfilePopup :show="popupStore.isOpened('edit_profile')" @onClose="popupStore.close('edit_profile')" />
	<SelectProfilePopup :show="popupStore.isOpened('select_profile')" @onClose="popupStore.close('select_profile')" />

	<NewNetworkPopup :show="popupStore.isOpened('new_network')" @onClose="popupStore.close('new_network')" />
	<EditNetworkPopup :show="popupStore.isOpened('edit_network')" @onClose="popupStore.close('edit_network')" />
	<NewEndpointPopup :show="popupStore.isOpened('new_endpoint')" @onClose="popupStore.close('new_endpoint')" />
	<EditEndpointPopup :show="popupStore.isOpened('edit_endpoint')" @onClose="popupStore.close('edit_endpoint')" />
	<SelectNetworksPopup :show="popupStore.isOpened('select_network')" @onClose="popupStore.close('select_network')" />

	<AccountsPopup :show="popupStore.isOpened('accounts')" @onClose="popupStore.close('accounts')" />
	<NewAccountPopup :show="popupStore.isOpened('new_account')" @onClose="popupStore.close('new_account')" />
	<EditAccountPopup :show="popupStore.isOpened('edit_account')" @onClose="popupStore.close('edit_account')" />

	<TokenMetadataPopup :show="popupStore.isOpened('token_metadata')" @onClose="popupStore.close('token_metadata')" />
	<NewTokenPopup :show="popupStore.isOpened('new_token')" @onClose="popupStore.close('new_token')" />
	<SelectTokenPopup :show="popupStore.isOpened('select_token')" @onClose="popupStore.close('select_token')" />
	<SelectBalanceTypePopup :show="popupStore.isOpened('select_balance_type')" @onClose="popupStore.close('select_balance_type')" />


	<NewFpcPopup :show="popupStore.isOpened('new_fpc')" @onClose="popupStore.close('new_fpc')" />
	<EditFpcPopup :show="popupStore.isOpened('edit_fpc')" @onClose="popupStore.close('edit_fpc')" />
	<SelectFpcPopup :show="popupStore.isOpened('select_fpc')" :payload="popupStore.getPayload('select_fpc')" @onClose="popupStore.close('select_fpc')" />

	<NewSenderPopup :show="popupStore.isOpened('new_sender')" @onClose="popupStore.close('new_sender')" />
	<ChangeAuthwitsRegistryPopup :show="popupStore.isOpened('change_authwits_registry')" @onClose="popupStore.close('change_authwits_registry')" />
	<RevokeAuthwitsPopup :show="popupStore.isOpened('revoke_authwits')" @onClose="popupStore.close('revoke_authwits')" />

	<NewContactPopup :show="popupStore.isOpened('new_contact')" @onClose="popupStore.close('new_contact')" />
	<EditContactPopup :show="popupStore.isOpened('edit_contact')" @onClose="popupStore.close('edit_contact')" />
	<ImportContactsPopup :show="popupStore.isOpened('import_contacts')" @onClose="popupStore.close('import_contacts')" />

	<ReceivePopup :show="popupStore.isOpened('receive')" @onClose="popupStore.close('receive')" />

	<IncomingTrustPopup :show="popupStore.isOpened('incoming_trust')" @onClose="popupStore.close('incoming_trust')" />
</template>
