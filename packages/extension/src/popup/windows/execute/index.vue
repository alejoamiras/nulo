<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"

/** Components */
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"
import OperationCard from "./OperationCard.vue"
import SignerIdentityStrip from "./SignerIdentityStrip.vue"

/** Utils */
import { getErrorData, getErrorMessage } from "@nulo/wallet-core/utils"

/** Local utilities */
import { humanizeOperationKind } from "./humanize"
import { uniqueSignerAccounts, uniqueSignerNetworks } from "./signers"
import { assertExecutableOperation, requiresFeeSelection } from "./operation-validation"
import type { DraftUIOperation } from "./types"

/** Services */
import { type ProfileInfo, ProfileServiceClient } from "@/wallet/services/profile/client"
import { type Network, NetworkServiceClient } from "@/wallet/services/network/client"
import { type Account, AccountServiceClient } from "@/wallet/services/account/client"
import { ExecutionServiceClient, type FeeSettings, type Operation } from "@/wallet/services/execution/client"
import {
	type CaipAccount,
	type CaipChain,
	DappInteractionServiceClient,
	type ExecutionPayload,
} from "@/wallet/services/dapp-interaction/client"
import type { DappMetadata } from "@/wallet/services/dapp-session/client"
import { OriginType } from "@/wallet/services/transaction/client"
import { parseCaipAccount, parseCaipChain, resolveNetworkByChainId } from "@/wallet/utils/caip"

/** Composables */
import { useDappInteractionPayload } from "@/composables/useDappInteractionPayload"
import { useDappHostname } from "@/composables/useDappHostname"
import { useFeeEstimationMap } from "@/composables/useFeeEstimationMap"
import { useToast, TOAST_DURATION } from "@/composables/toast"

const { openToast } = useToast()

// Local alias — kept for diff minimality. The honest type lives in `./types.ts`
// (DraftUIOperation) so send-like `feeSettings` is optional during user editing.
type UIOperation = DraftUIOperation

type UIDappMetadata = DappMetadata & {
	loadingLogo?: boolean
	logoBlobUrl?: string
}

type UIError = { title: string; tooltip: string; type: string }

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const profile = ref<ProfileInfo>()

const router = useRouter()

const session = ref()
const operations = ref<UIOperation[]>([])
const accounts = ref<Account[]>([])

const isLoading = ref(false)
const isWrongProfile = ref(false)
const processingError = ref<UIError>()

const executionService = new ExecutionServiceClient()
const interactionService = new DappInteractionServiceClient()

const {
	requestId,
	payload,
	dapp,
	isCancelled: isInteractionCancelled,
	load: loadInteractionPayload,
	reject: rejectViaInteractionService,
} = useDappInteractionPayload<ExecutionPayload>({
	interactionService,
	getRequestId: () => router.currentRoute.value.query.requestId?.toString(),
	dappOf: (p) => p.session.dappMetadata as UIDappMetadata,
})

const { hostname: dappHostname, isSuspicious: hostnameHasNonAscii } = useDappHostname(dapp)

const {
	results: feeEstimates,
	estimating: estimatingOps,
	estimate: scheduleFeeEstimate,
} = useFeeEstimationMap<number, { op: UIOperation; feeSettings: FeeSettings }, unknown>({
	// Cast op → Operation (strict): the estimate is only scheduled AFTER the
	// user picks a fee, so feeSettings is set on the op by the time we get here.
	// The wallet-bridge Operation type carries a slightly different AztecAddress/
	// Fr surface than the popup-resolved DraftUIOperation; the cast bridges that
	// pre-existing mismatch.
	estimate: ({ op, feeSettings }) => executionService.estimateOperationFee(op as unknown as Operation, feeSettings),
	debounceMs: 500,
	onError: (key, err) => {
		console.error(`[Execute] Fee estimation failed for op ${key}:`, getErrorMessage(err), getErrorData(err))
		openToast({ label: "Couldn't estimate fee — retry.", icon: "warning", color: "red" }, TOAST_DURATION.LONG)
	},
})

function setError(title: string, tooltip: string = title, type: string = "error") {
	processingError.value = { title, tooltip, type }
}

function clearError() {
	processingError.value = undefined
}

const init = async () => {
	try {
		profile.value = await profileService.getActiveProfile()
		await loadInteractionPayload()
		if (!payload.value) return

		if (profile.value?.id !== payload.value.session.profileId) {
			// TODO: redirect to sign in page with preconfigured profile id
			isWrongProfile.value = true
			throw new Error("Sign in with another profile")
		}

		const accountService = new AccountServiceClient()
		const networkService = new NetworkServiceClient()

		const getNetwork = async (caipChain: CaipChain): Promise<Network> => {
			const { chainId } = parseCaipChain(caipChain)
			return resolveNetworkByChainId(networkService, chainId)
		}

		const getNetworkAndAccount = async (caipAccount: CaipAccount): Promise<[Network, Account]> => {
			const { chainId, address } = parseCaipAccount(caipAccount)
			const network = await resolveNetworkByChainId(networkService, chainId)
			const account = await accountService.getAccount(profile.value!.id, network.chainId, address)
			if (!account) throw new Error("Account no longer exists")
			return [network, account]
		}

		const _accounts: Account[] = []
		const _operations: UIOperation[] = []
		for (const op of payload.value.params.operations) {
			switch (op.kind) {
				case "register_contract":
				case "register_sender":
				case "aztec_getContractClassMetadata":
				case "aztec_getContractMetadata":
				case "aztec_getChainInfo":
				case "aztec_registerSender":
				case "aztec_getAddressBook":
				case "aztec_registerContract":
				case "aztec_getPrivateEvents": {
					const network = await getNetwork(op.chain)
					_operations.push({ ...op, network, networkId: network.id })
					break
				}
				case "get_complete_address":
				case "register_token":
				case "simulate_transaction":
				case "simulate_utility":
				case "simulate_views":
				case "aztec_simulateTx":
				case "aztec_executeUtility":
				case "aztec_profileTx":
				case "aztec_createAuthWit": {
					const [network, account] = await getNetworkAndAccount(op.account)
					_operations.push({
						...op,
						network,
						networkId: network.id,
						account,
						accountAddress: account.address,
					})
					if (!_accounts.find((x) => x.address === account.address && x.chainId === account.chainId)) {
						_accounts.push(account)
					}
					break
				}
				case "aztec_sendTx": {
					const [network, account] = await getNetworkAndAccount(op.account)
					const isNoFrom = op.executionMode === "default_entrypoint"
					// `default_entrypoint` and explicit `exec.feePayer` are dApp-supplied
					// fee paths (dApp handles fee payment via its own entrypoint).
					// Pre-fill embedded so the FeeSettingsCard is suppressed; otherwise
					// leave feeSettings undefined and rely on the user to pick a method.
					// The `requiresFeeSelection` predicate at approve() gates undefined.
					_operations.push({
						...op,
						network,
						networkId: network.id,
						account,
						accountAddress: account.address,
						feeSettings: isNoFrom || op.exec.feePayer !== undefined ? { paymentMethod: { kind: "embedded" } } : undefined,
					})
					if (!_accounts.find((x) => x.address === account.address && x.chainId === account.chainId)) {
						_accounts.push(account)
					}
					break
				}
				case "send_transaction": {
					const [network, account] = await getNetworkAndAccount(op.account)
					// dApp may embed the fee payment via op.fee.embeddedFeePayment; in
					// that case pre-fill embedded so the FeeSettingsCard is suppressed.
					// Otherwise leave feeSettings undefined for user selection;
					// `requiresFeeSelection` at approve() gates undefined.
					_operations.push({
						...op,
						network,
						networkId: network.id,
						account,
						accountAddress: account.address,
						feeSettings: op.fee?.embeddedFeePayment !== undefined ? { paymentMethod: { kind: "embedded" } } : undefined,
					})
					if (!_accounts.find((x) => x.address === account.address && x.chainId === account.chainId)) {
						_accounts.push(account)
					}
					break
				}
				default:
					throw new Error("Invalid operation kind")
			}
		}
		session.value = payload.value.session
		operations.value = _operations
		accounts.value = _accounts
		accountService.disconnect()
		networkService.disconnect()
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	}
}

const onActiveProfileChanged = (_profile?: ProfileInfo) => {
	if (!_profile || _profile.id !== profile.value?.id) reject()
}

const handleFeeUpdate = (index: number, value: FeeSettings | undefined) => {
	const op = operations.value[index]
	// `feeSettings` only exists on send-like draft kinds. Discriminant guard
	// + targeted cast for the assignment: TS's union narrowing here is
	// confused by a pre-existing AztecAddress/Fr structural mismatch
	// between popup-resolved Operation and wallet-bridge's, so we cast to
	// the draft shape explicitly. Runtime safety is in the kind check.
	if (op.kind !== "send_transaction" && op.kind !== "aztec_sendTx") return
	;(op as { feeSettings?: FeeSettings }).feeSettings = value
	clearError()
	if (value) scheduleFeeEstimate(index, { op: op as unknown as UIOperation, feeSettings: value })
}

const approve = async () => {
	if (isInteractionCancelled.value || isLoading.value) return
	// UX gate: any send-like op still missing user-picked fee?
	// Cast to DraftOperation works around a pre-existing AztecAddress/Fr
	// structural mismatch between popup-resolved Operation and wallet-bridge's
	// — runtime semantics are unaffected (discriminant + feeSettings checks).
	if (operations.value.some((op) => requiresFeeSelection(op as unknown as import("./types").DraftOperation))) {
		setError("Validation error", "Select a fee payment method for each transaction", "warning")
		return
	}
	try {
		isLoading.value = true
		// Narrow Draft → executable Operation via TS assertion. After the
		// `requiresFeeSelection` gate above, all rows are ready; the assertion
		// makes that promise compile-time-enforced (and validates at runtime
		// as a safety net against any popup-side regression).
		const executable: Operation[] = operations.value.map(({ network: _n, account: _a, ...rest }) => {
			const draft = rest as unknown as import("./types").DraftOperation
			assertExecutableOperation(draft)
			return draft
		})
		await interactionService.approveInteraction(requestId.value!, executable, {
			type: OriginType.DAPP,
			name: dapp.value?.name ?? "Unknown app",
		})
		closeWindow(true)
	} catch (error) {
		setError("Processing error.", getErrorMessage(error))
	} finally {
		isLoading.value = false
	}
}

const reject = async () => {
	if (isInteractionCancelled.value || !requestId.value) return
	rejectViaInteractionService("User rejected")
	closeWindow(true)
}

const closeWindow = (interactionCompleted?: boolean) => {
	if (interactionCompleted) window.removeEventListener("beforeunload", reject)
	chrome.windows.getCurrent(undefined, (window) => {
		if (window.id) chrome.windows.remove(window.id)
	})
}

const signerAccounts = computed(() => uniqueSignerAccounts(operations.value))
const signerNetworks = computed(() => uniqueSignerNetworks(operations.value))
const stripStatus = computed<"ready" | "loading" | "cancelled">(() => {
	if (isInteractionCancelled.value) return "cancelled"
	if (isLoading.value) return "loading"
	return "ready"
})

const showJson = () => {
	if (!requestId.value) return
	const url = new URL(chrome.runtime.getURL("src/popup/index.html#/windows/json"))
	url.searchParams.set("requestId", requestId.value)
	chrome.windows.create({ type: "popup", url: url.toString(), height: 700, width: 900 })
}

const profileService = new ProfileServiceClient()
profileService.onActiveProfileChanged.add(onActiveProfileChanged)

onMounted(async () => {
	profileService.connect()
	interactionService.connect()

	if (!appStore.isSessionChecked) {
		await new Promise<void>((resolve) => {
			const stop = watch(
				() => appStore.isSessionChecked,
				(checked) => {
					if (checked) {
						stop()
						resolve()
					}
				},
				{ immediate: true },
			)
		})
	}

	if (!appStore.isLogined) {
		appStore.pageAwaitingAuth = router.currentRoute.value.fullPath
		router.push({ path: "/popup/auth" })
		return
	}

	await init()
	window.addEventListener("beforeunload", reject)
})

onUnmounted(() => {
	profileService.disconnect()
	interactionService.disconnect()
	executionService.disconnect()
	window.removeEventListener("beforeunload", reject)
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper">
		<SignerIdentityStrip :signerAccounts="signerAccounts" :signerNetworks="signerNetworks" :status="stripStatus" />

		<Flex direction="column" :class="$style.scroll_area">
			<DappIdentityBlock
				:dapp="dapp ?? undefined"
				:hostname="dappHostname"
				:hostnameSuspicious="hostnameHasNonAscii"
				actionLabel="wants to execute the following"
			/>

			<Flex direction="column" gap="16" :class="$style.sections">
				<Flex v-if="operations.length" direction="column" gap="10" wide>
					<Flex wide justify="between" align="center">
						<SectionLabel label="Requested operations" :count="operations.length" />
						<Icon
							data-testid="execute-show-json-btn"
							@click="showJson"
							name="expand"
							size="16"
							color="tertiary"
							:class="$style.fullscreen_icon"
						/>
					</Flex>

					<OperationCard
						v-for="(op, i) in operations"
						:key="i"
						:op="op as UIOperation"
						:index="i"
						:profile="profile"
						:dapp="dapp ?? undefined"
						:feeEstimate="feeEstimates[i]"
						:isEstimating="!!estimatingOps[i]"
						@updateFeeSettings="handleFeeUpdate"
					/>
				</Flex>
			</Flex>
		</Flex>

		<Flex direction="column" gap="10" :class="$style.footer">
			<Tooltip v-if="processingError" side="top" position="start" :disabled="!processingError.tooltip">
				<Flex align="center" wide gap="6">
					<Icon name="info" size="14" :color="processingError.type === 'warning' ? 'orange' : 'red'" />
					<Text data-testid="error-text" role="alert" size="12" weight="600" color="secondary">{{ processingError.title }}</Text>
				</Flex>

				<template #content>
					<Text size="12" color="secondary">{{ processingError.tooltip }}</Text>
				</template>
			</Tooltip>

			<Flex align="center" justify="between" gap="12">
				<Button data-testid="execute-reject-btn" @click="reject" wide variant="primary_outline" size="medium" :disabled="isLoading">
					Reject
				</Button>

				<Button
					data-testid="execute-confirm-btn"
					@click="approve"
					wide
					variant="primary"
					size="medium"
					:loading="isLoading"
					:disabled="processingError?.type === 'error'"
				>
					<Text size="13" color="inverse">{{ isLoading ? "EXECUTING" : "Confirm" }}</Text>
				</Button>
			</Flex>
		</Flex>

		<DappCancelledOverlay
			v-if="isWrongProfile"
			message="You are signed in to a different profile. Please switch profiles and resend your request."
			@dismiss="closeWindow()"
		/>
		<DappCancelledOverlay
			v-else-if="isInteractionCancelled"
			message="The operation request was cancelled"
			@dismiss="closeWindow()"
		/>
	</Flex>
</template>

<style module>
.wrapper {
	overflow: hidden;
	flex: 1;

	display: flex;
	flex-direction: column;

	background: var(--app-bg);
	border-top: 2px solid var(--nulo-accent);
}

.scroll_area {
	flex: 1;
	min-height: 0;
	overflow: auto;
	scrollbar-gutter: stable;
}

.sections {
	padding: 16px;
}

.fullscreen_icon {
	cursor: pointer;
	padding: 4px;

	&:hover {
		background: var(--nulo-surface-high);
	}
}

.footer {
	flex-shrink: 0;

	padding: 16px;
	border-top: 1px solid var(--nulo-border);
	background: var(--nulo-surface);
}
</style>
