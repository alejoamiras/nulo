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
const incomingTransferService = new IncomingTransferServiceClient()
function onIncomingTransferPending(payload) {
	// Coalesce: if a trust popup is already open for this contract, no-op.
	// (The service emits pending ONLY on the unknown→pending transition,
	// so subsequent notes from the same pending contract don't re-emit.
	// This guard handles the edge case where the user closed the popup
	// without resolving and a fresh note arrived.)
	if (popupStore.isOpened("incoming_trust") && cacheStore.incomingTrust?.contract === payload.contract) return
	cacheStore.incomingTrust = {
		tokenSymbol: payload.tokenSymbol,
		tokenDecimals: payload.tokenDecimals,
		amountRaw: payload.amountRaw,
		contract: payload.contract,
		allow: () => incomingTransferService.setTrustAllow(payload.profileId, payload.networkId, payload.contract),
		reject: () => incomingTransferService.setTrustReject(payload.profileId, payload.networkId, payload.contract),
	}
	popupStore.open("incoming_trust")
}
incomingTransferService.onIncomingTransferPending.add(onIncomingTransferPending)

// Replay pending prompts on (re)connect so a user who closed the popup
// without resolving doesn't get stranded. The service only emits Pending
// on the unknown→pending transition (one-shot); without this, subsequent
// popup loads would silently keep records hidden forever.
incomingTransferService.onConnected.add(async () => {
	if (!appStore.profile?.id || !appStore.network?.id || !appStore.account?.address) return
	try {
		await incomingTransferService.replayPendingPrompts(appStore.profile.id, appStore.network.id, appStore.account.address)
	} catch {
		// Replay is best-effort — a transient port hiccup shouldn't error out.
	}
})

onBeforeUnmount(() => {
	incomingTransferService.disconnect()
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
