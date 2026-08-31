<script setup lang="ts">
/** Vendor */
import { onMounted, onUnmounted } from "vue"
import { JobCancelledError } from "@nulo/extension-messaging/errors"

/** Components */
import DappIdentityBlock from "@/components/composite/DappIdentityBlock.vue"
import DappCancelledOverlay from "@/components/composite/DappCancelledOverlay.vue"
import DappApprovalFooter from "@/components/composite/DappApprovalFooter.vue"
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
import { TokenServiceClient, type TokenInterface } from "@/wallet/services/token/client"
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
import { useDappApprovalWindow } from "@/composables/useDappApprovalWindow"
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

/**
 * True once `init()` has finished materializing the operations list. The
 * footer (Reject/Confirm) renders unconditionally in the template, so without
 * this gate a fast click before init() resolves would call `approve()` with
 * `operations.value === []` — `approveInteraction()` happily detaches and
 * executes the empty list, and downstream code unwraps `results[0]` of
 * nothing. Flip to true at the end of init() once we have at least one
 * operation; refuse approval until then.
 */
const initComplete = ref(false)

const executionService = new ExecutionServiceClient()
const interactionService = new DappInteractionServiceClient()
const tokenService = new TokenServiceClient()

/**
 * Pre-fetched metadata for `register_token` operations, keyed by contract
 * address. Resolved by parseTokenInterface + fetchTokenMetadata in init() so
 * the OperationCard renders name + symbol + decimals alongside the address
 * BEFORE the user clicks Allow. The pre-fetch is the only anti-phishing
 * surface the user has — the popup must not be approvable while it's loading.
 */
const tokenMetadata = ref<Map<string, { name: string; symbol: string; decimals: number }>>(new Map())
/**
 * Parallel map carrying the parsed `TokenInterface` from the same
 * `previewTokenMetadata` call that populates `tokenMetadata`. Used by the
 * approve mapper to thread the interface into `register_token` ops as
 * `previewedInterface`, letting `executeRegisterToken` skip a redundant
 * `parseTokenInterface` round-trip after Allow. Populated alongside
 * `tokenMetadata.set(...)` during the prefetch loop in `init()`.
 *
 * Race-safety: the Confirm button is gated on `tokenMetadataLoading` (see
 * line :312 and disabled-state at :481), so by the time `approveInteraction`
 * runs, this map has been fully populated (or the user can't approve).
 */
const tokenInterfaces = ref<Map<string, TokenInterface>>(new Map())
const tokenMetadataLoading = ref(false)
const tokenMetadataError = ref<Map<string, string>>(new Map())

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
	handoffAll: handoffFeeEstimates,
	rearm: rearmFeeEstimates,
	cancelAll: cancelAllFeeEstimates,
} = useFeeEstimationMap<number, { op: UIOperation; feeSettings: FeeSettings }, unknown>({
	// Cast op → Operation (strict): the estimate is only scheduled AFTER the
	// user picks a fee, so feeSettings is set on the op by the time we get here.
	// The wallet-bridge Operation type carries a slightly different AztecAddress/
	// Fr surface than the popup-resolved DraftUIOperation; the cast bridges that
	// pre-existing mismatch.
	estimate: ({ op, feeSettings }, estimateToken, flowKey) =>
		executionService.estimateOperationFee(op as unknown as Operation, feeSettings, estimateToken, flowKey),
	cancelRemote: (estimateToken) => {
		executionService.cancelEstimate(estimateToken).catch(() => {})
	},
	debounceMs: 500,
	onError: (key, err) => {
		console.error(`[Execute] Fee estimation failed for op ${key}:`, getErrorMessage(err), getErrorData(err))
		openToast({ label: "Couldn't estimate fee — retry.", icon: "warning", color: "red" }, TOAST_DURATION.LONG)
	},
})

// init/reject/services are referenced lazily (thunks): they are declared below
// and only invoked by start()/dispose()/the guard at runtime.
const {
	start: startWindow,
	dispose: disposeWindow,
	closeWindow,
	onActiveProfileChanged,
	stripStatus,
	processingError,
	setError,
	clearError,
} = useDappApprovalWindow({
	profile,
	isInteractionCancelled,
	isLoading,
	connectServices: () => {
		profileService.connect()
		interactionService.connect()
		tokenService.connect()
	},
	disconnectServices: () => {
		profileService.disconnect()
		interactionService.disconnect()
		executionService.disconnect()
		tokenService.disconnect()
	},
	init: () => init(),
	reject: () => reject(),
})

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (103 lines) — split when touched, never grow
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 25) — refactor when touched, never raise
const init = async () => {
	// B-30: disconnect the locally-constructed account/network clients on EVERY
	// exit path. They were disconnected only on the success path (after the ops
	// loop), so any throw in the loop — e.g. "Account no longer exists" — leaked
	// both live SW ports for the failed popup's lifetime.
	let accountService: AccountServiceClient | undefined
	let networkService: NetworkServiceClient | undefined
	try {
		profile.value = await profileService.getActiveProfile()
		await loadInteractionPayload()
		if (!payload.value) return

		if (profile.value?.id !== payload.value.session.profileId) {
			// TODO: redirect to sign in page with preconfigured profile id
			isWrongProfile.value = true
			throw new Error("Sign in with another profile")
		}

		accountService = new AccountServiceClient()
		networkService = new NetworkServiceClient()

		const getNetwork = async (caipChain: CaipChain): Promise<Network> => {
			const { chainId } = parseCaipChain(caipChain)
			return resolveNetworkByChainId(networkService!, chainId)
		}

		const getNetworkAndAccount = async (caipAccount: CaipAccount): Promise<[Network, Account]> => {
			const { chainId, address } = parseCaipAccount(caipAccount)
			const network = await resolveNetworkByChainId(networkService!, chainId)
			const account = await accountService!.getAccount(profile.value!.id, network.chainId, address)
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
				case "register_token":
				case "simulate_transaction":
				case "simulate_utility":
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
		// Only flip after operations are committed to state. If the popup
		// is dismissed mid-init (cancel from another window) we want the
		// approve gate to stay closed.
		initComplete.value = _operations.length > 0

		// Pre-fetch token metadata for any `register_token` ops so the
		// OperationCard renders name/symbol/decimals before Allow. The Allow
		// button is disabled while this is in flight (see template).
		const registerOps = _operations.filter((op): op is UIOperation & { kind: "register_token" } => op.kind === "register_token")
		if (registerOps.length > 0) {
			tokenMetadataLoading.value = true
			try {
				await Promise.all(
					registerOps.map(async (op) => {
						try {
							const meta = await tokenService.previewTokenMetadata(op.networkId, op.accountAddress, op.address)
							tokenMetadata.value.set(op.address, { name: meta.name, symbol: meta.symbol, decimals: meta.decimals })
							tokenInterfaces.value.set(op.address, meta.interface)
						} catch (err) {
							const msg = getErrorMessage(err)
							tokenMetadataError.value.set(op.address, msg)
							console.warn(`[Execute] previewTokenMetadata failed for ${op.address}: ${msg}`)
						}
					}),
				)
			} finally {
				tokenMetadataLoading.value = false
			}
		}
	} catch (error) {
		console.error(getErrorData(error))
		setError("Something went wrong")
	} finally {
		// Both are idle after the ops loop; disconnect on success, throw, or
		// early-return alike (undefined when init returned before constructing them).
		accountService?.disconnect()
		networkService?.disconnect()
	}
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
	// Block approval until init() has finished and at least one operation
	// exists. Without this guard, a fast click before payload materialization
	// would approve an empty operations list.
	if (!initComplete.value || operations.value.length === 0) return
	// Also block while the popup is pre-fetching token metadata for any
	// `register_token` op — D7 enforcement.
	if (tokenMetadataLoading.value) return
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
			// Approve-mapper threading: for `register_token` ops, attach the
			// `previewedInterface` from the popup's prefetched map so the
			// executor can skip a redundant `parseTokenInterface` round-trip.
			// Safe because by the time we get here `tokenMetadataLoading` is
			// false (Confirm button gated), so the map is fully populated.
			// Executor still validates `contract === op.address` + chainId.
			if (draft.kind === "register_token") {
				const previewed = tokenInterfaces.value.get(draft.address)
				if (previewed) {
					// Extension-local extended type; not part of the wire shape.
					return { ...draft, previewedInterface: previewed } as unknown as Operation
				}
			}
			return draft
		})
		// Ownership handoff: approval transfers the estimates to the execution
		// path — the window's unmount cleanup must NOT remote-cancel them, or
		// the eviction would race the fire-and-forget executeOperations out of
		// its reuse hits and needlessly abort still-running estimates.
		handoffFeeEstimates()
		// Estimate→confirm reuse ids, index-aligned with `executable`. Rides
		// this popup-privileged RPC as an envelope — never the shared
		// Operation wire shape, so a dApp payload can't forge one.
		const estimateIds = operations.value.map(
			(_op, index) => (feeEstimates.value[index] as { estimateId?: string } | null | undefined)?.estimateId,
		)
		await interactionService.approveInteraction(
			requestId.value!,
			executable,
			{
				type: OriginType.DAPP,
				name: dapp.value?.name ?? "Unknown app",
			},
			estimateIds,
		)
		closeWindow(true)
	} catch (error) {
		// The execution path never took ownership — re-arm so a later
		// reject/unmount can still cancel + evict the handed-off estimates.
		rearmFeeEstimates()
		if (error instanceof JobCancelledError) {
			// A raced approve refused service-side (the dApp cancelled first):
			// the refusal IS the cancelled state — render the overlay, never an
			// error banner. Covers the case where the cancel broadcast itself
			// was lost to this popup.
			isInteractionCancelled.value = true
		} else {
			setError("Processing error.", getErrorMessage(error))
		}
	} finally {
		isLoading.value = false
	}
}

const reject = async () => {
	if (isInteractionCancelled.value || !requestId.value) return
	// Reject-time eviction: abort in-flight estimates and drop any stashed
	// signed requests NOW — window teardown alone isn't guaranteed to run
	// dispose before the window dies.
	cancelAllFeeEstimates()
	rejectViaInteractionService("User rejected")
	closeWindow(true)
}

const signerAccounts = computed(() => uniqueSignerAccounts(operations.value))
const signerNetworks = computed(() => uniqueSignerNetworks(operations.value))
// Mirrors the `requiresFeeSelection` early-return inside approve(): a send-like op
// with no chosen fee can't execute yet. Gating the Confirm button's disabled state
// on it (not just approve()'s guard) makes the button authoritative — a click while
// the fee is still auto-selecting can no longer no-op into the "select a fee"
// warning. e2e clicks wait for the button to enable, so this also removes the race
// where approval is clicked before the default fee resolves (slow PXE / cold start).
const needsFeeSelection = computed(() =>
	operations.value.some((op) => requiresFeeSelection(op as unknown as import("./types").DraftOperation)),
)

const showJson = () => {
	if (!requestId.value) return
	const url = new URL(chrome.runtime.getURL("src/popup/index.html#/windows/json"))
	url.searchParams.set("requestId", requestId.value)
	chrome.windows.create({ type: "popup", url: url.toString(), height: 700, width: 900 })
}

const profileService = new ProfileServiceClient()
profileService.onActiveProfileChanged.add(onActiveProfileChanged)

onMounted(startWindow)

onUnmounted(disposeWindow)
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
						:tokenMetadata="op.kind === 'register_token' ? tokenMetadata.get((op as { address: string }).address) : undefined"
						:tokenMetadataError="op.kind === 'register_token' ? tokenMetadataError.get((op as { address: string }).address) : undefined"
						:tokenMetadataLoading="op.kind === 'register_token' && tokenMetadataLoading"
						@updateFeeSettings="handleFeeUpdate"
					/>
				</Flex>
			</Flex>
		</Flex>

		<DappApprovalFooter
			:processing-error="processingError"
			reject-testid="execute-reject-btn"
			reject-label="Reject"
			:reject-disabled="isLoading || !requestId"
			confirm-testid="execute-confirm-btn"
			:confirm-label="isLoading ? 'EXECUTING' : 'Confirm'"
			:confirm-loading="isLoading"
			:confirm-disabled="
				processingError?.type === 'error' ||
				tokenMetadataLoading ||
				!initComplete ||
				operations.length === 0 ||
				needsFeeSelection ||
				isInteractionCancelled
			"
			@reject="reject"
			@approve="approve"
		/>

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

</style>
