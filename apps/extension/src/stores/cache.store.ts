// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import { defineStore } from "pinia"

export const useCacheStore = defineStore("cache", () => {
	const confirm = reactive({})
	/** First-receive friction popup payload. Holds the closures that
	 *  IncomingTrustPopup invokes for Allow / Reject. Populated by the
	 *  PopupManager-level subscriber on `onIncomingTransferPending`. */
	const incomingTrust = reactive({})

	const networkToEditIdx = ref()
	/** Per-`Network` detail page → endpoint popups context. */
	const endpointEditNetworkId = ref<string | null>(null)
	const endpointEditId = ref<string | null>(null)
	const accountToEditIdx = ref()
	const contactToEditIdx = ref()
	const fpcToEditIdx = ref()

	const activeTokenIdx = ref()
	const preselectedBalanceType = ref("private")
	const preselectedTokenAddressToAdd = ref()
	const preselectedAuthwits = ref([])

	const proposedNetworks = ref([])
	const selectedNetwork = ref()
	const feePaymentMethods = ref([])

	const importType = ref("")

	const importContact = ref(null)
	const importContacts = ref([])
	const importPromise = ref(null)

	const failureLog = ref()

	const viewerData = ref()

	return {
		confirm,
		incomingTrust,
		networkToEditIdx,
		endpointEditNetworkId,
		endpointEditId,
		accountToEditIdx,
		contactToEditIdx,
		fpcToEditIdx,
		activeTokenIdx,
		proposedNetworks,
		selectedNetwork,
		preselectedBalanceType,
		preselectedTokenAddressToAdd,
		preselectedAuthwits,
		feePaymentMethods,
		importType,
		importContact,
		importContacts,
		importPromise,
		failureLog,
		viewerData,
	}
})
