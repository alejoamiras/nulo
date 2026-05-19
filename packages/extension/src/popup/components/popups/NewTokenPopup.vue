<script setup>
/** Services */
import { TaskServiceClient } from "@/wallet/services/task/client"
import { ContentKind } from "@/wallet/services/task/spec"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Utils */
import { isValidHex } from "@/utils/string"

/** Composables */
import { useToast } from "@/composables/toast"
import { useFormState } from "@/composables/useFormState"
const { openToast, TOAST_DURATION } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const props = defineProps({
	show: Boolean,
})

const emit = defineEmits(["onClose"])

const tokenService = new TokenServiceClient()
const tokenBalanceService = new TokenBalanceServiceClient()
const taskService = new TaskServiceClient()

const tokens = ref([])

const form = useFormState({
	contract: {
		initial: "",
		validate: (v) => {
			if (!v?.length) return null
			if (!isValidHex(v)) return "Invalid address"
			if (tokens.value.some((t) => t.contract === v)) return "Already exist"
			return null
		},
	},
})

const contractTerm = form.fields.contract.value

const isAlreadyExist = computed(() => form.fields.contract.error.value === "Already exist")
const isInvalidAddress = computed(() => form.fields.contract.error.value === "Invalid address")
const isAvailableToCreateToken = computed(() => {
	if (!contractTerm.value?.length) return false
	if (form.fields.contract.error.value) return false
	// Belt + suspenders for the network-switch race: keep the submit button
	// disabled until we have a real (profile, network, account) tuple. The
	// click handler also re-checks; this gate keeps the UI honest.
	if (!appStore.profile || !appStore.network || !appStore.account?.address) return false
	return true
})

// 'idle' → 'adding' (parsing + addToken in flight)
//        → 'loading-balance' (waiting for the active account's first projector run)
const phase = ref("idle")
const error = ref()

const isBusy = computed(() => phase.value !== "idle")

const submitLabel = computed(() => {
	if (phase.value === "adding") return "Adding token…"
	if (phase.value === "loading-balance") return "Loading balance…"
	return "Import new token"
})

const BALANCE_WAIT_TIMEOUT_MS = 30_000

// Holds the active wait so popup-close can abort it.
let activeBalanceWait = null

/**
 * Subscribe to the two service streams BEFORE addToken is called, so we
 * cannot miss the events that fire while addToken's bg handlers are
 * still running. The wait resolves with one of:
 *   "success"  — BalanceUpdate task finished without error
 *   "error"    — BalanceUpdate task finished with task.error set
 *   "timeout"  — no terminal event in BALANCE_WAIT_TIMEOUT_MS
 *   "aborted"  — popup was dismissed mid-wait
 */
function createBalanceWait(submittingAccount) {
	let expectedTokenId = null
	let pendingTbId = null
	let timer = null
	let resolveOutcome = null

	const promise = new Promise((resolve) => {
		resolveOutcome = (outcome) => {
			if (!resolveOutcome) return
			resolveOutcome = null
			cleanup()
			resolve(outcome)
		}
	})

	const startTimer = () => {
		if (timer !== null) return
		timer = setTimeout(() => resolveOutcome?.("timeout"), BALANCE_WAIT_TIMEOUT_MS)
	}

	const onBalanceAdded = (tb) => {
		if (pendingTbId !== null) return
		if (expectedTokenId !== null && tb?.token?.id !== expectedTokenId) return
		if (tb?.account !== submittingAccount) return
		pendingTbId = tb.id
		startTimer()
	}

	const onTaskUpdated = (task) => {
		if (task?.content?.kind !== ContentKind.BalanceUpdate) return
		if (pendingTbId === null || task.content.tbId !== pendingTbId) return
		if (!task.finishedAt) return
		resolveOutcome?.(task.error ? "error" : "success")
	}

	const cleanup = () => {
		tokenBalanceService.onTokenBalanceAdded.remove(onBalanceAdded)
		taskService.onTaskUpdated.remove(onTaskUpdated)
		if (timer !== null) {
			clearTimeout(timer)
			timer = null
		}
	}

	tokenBalanceService.onTokenBalanceAdded.add(onBalanceAdded)
	taskService.onTaskUpdated.add(onTaskUpdated)

	return {
		promise,
		setExpectedToken(tokenId) {
			expectedTokenId = tokenId
		},
		seedPending(tbId, tokenId) {
			expectedTokenId = tokenId
			pendingTbId = tbId
			startTimer()
		},
		abort() {
			resolveOutcome?.("aborted")
		},
	}
}

const handleAddToken = async () => {
	if (!isAvailableToCreateToken.value || phase.value !== "idle") return

	// `appStore.account` can be transiently undefined immediately after a
	// network switch if the chain had no prior accounts and the auto-create
	// path is still in flight (see app.vue's network watcher). Surface a
	// clear error instead of throwing inside `addToken` — without this guard
	// the snapshot below crashes on `appStore.account.address` and the catch
	// silently swallows it, so the popup hangs on the "Adding…" spinner with
	// no toast.
	if (!appStore.account?.address || !appStore.network || !appStore.profile) {
		error.value = "Account is still loading. Please wait a moment and try again."
		return
	}

	error.value = null
	phase.value = "adding"

	// Snapshot identity at submit time — appStore is reactive and the user
	// could switch accounts / networks mid-wait.
	const submittingProfileId = appStore.profile.id
	const submittingNetworkId = appStore.network.id
	const submittingChainId = appStore.network.chainId
	const submittingAccount = appStore.account.address

	let balanceWait = null

	try {
		// Explicit connect — `EventHandler.add` does not open the port.
		// Without this, the new TaskServiceClient never receives events.
		await taskService.connect()

		// Subscribe BEFORE addToken so we can't miss the events fired by the
		// bg's onTokenAdded → createTokenBalance chain.
		balanceWait = createBalanceWait(submittingAccount)
		activeBalanceWait = balanceWait

		const parsingResult = await tokenService.parseTokenInterface(submittingNetworkId, contractTerm.value)

		// Registry-only path: ambiguous interfaces error out (the manual
		// candidate-picker UX was dropped). User should ask the contract
		// maintainer to standardize the interface or use the dApp registry
		// flow which can pass an explicit artifact.
		if (!parsingResult.isComplete) {
			error.value = "Couldn't auto-detect this token's interface. Try a contract whose ABI matches a known standard."
			balanceWait.abort()
			return
		}

		const newToken = await tokenService.addToken(submittingProfileId, submittingNetworkId, submittingAccount, parsingResult, {
			origin: "popup",
		})
		balanceWait.setExpectedToken(newToken.id)

		// Chain mismatch — no TB for this account will ever be created on this chain.
		if (newToken.chainId !== submittingChainId) {
			balanceWait.abort()
			openToast({ label: "Token added" })
			emit("onClose")
			return
		}

		// Re-import / already-synced shortcut. addToken is idempotent
		// (token/service.ts:120) and won't re-emit onTokenAdded for an
		// existing token, so there'd be no event to wait for.
		const existing = await tokenBalanceService.getTokenBalances(newToken.id, submittingAccount)
		if (existing.length > 0 && (existing[0].updatedAt ?? 0) > 0) {
			balanceWait.abort()
			openToast({ label: "Token added" })
			emit("onClose")
			return
		}

		// If a TB already exists (rare race), seed pendingTbId so the timer
		// can start immediately instead of waiting for an event that's already
		// past.
		if (existing.length > 0) {
			balanceWait.seedPending(existing[0].id, newToken.id)
		}

		phase.value = "loading-balance"
		const outcome = await balanceWait.promise

		switch (outcome) {
			case "success":
				openToast({ label: "Token added" })
				emit("onClose")
				break
			case "timeout":
				openToast({ label: "Token added — balance will appear in a moment" }, TOAST_DURATION.LONG)
				emit("onClose")
				break
			case "error":
				openToast(
					{ label: "Token added. Couldn't load balance — we'll retry automatically.", icon: "warning" },
					TOAST_DURATION.LONG,
				)
				emit("onClose")
				break
			case "aborted":
				// Popup was dismissed by the user mid-wait. Bg keeps refreshing.
				break
		}
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err)
		balanceWait?.abort()
	} finally {
		activeBalanceWait = null
		phase.value = "idle"
	}
}

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			activeBalanceWait?.abort()
			activeBalanceWait = null
			form.reset()
			error.value = null
			phase.value = "idle"
			document.removeEventListener("keydown", onKeydown)
			taskService.disconnect()
			tokenBalanceService.disconnect()
			tokenService.disconnect()
		} else {
			// Reset transient state on open. The close branch already clears
			// `error.value`, but the submit handler's catch block runs as a
			// microtask AFTER the close branch — so an in-flight RPC that
			// rejected with "Client disconnected" during the close cascade
			// can write to `error.value` after our null-reset and stick around
			// for the next open. Re-clearing here is the cheapest defense.
			error.value = null
			phase.value = "idle"
			tokens.value = await tokenService.getTokens(appStore.profile.id, appStore.network.chainId)
			if (cacheStore.preselectedTokenAddressToAdd) {
				contractTerm.value = cacheStore.preselectedTokenAddressToAdd
				cacheStore.preselectedTokenAddressToAdd = ""
			}
			document.addEventListener("keydown", onKeydown)
		}
	},
)

const onKeydown = (e) => {
	if (e.key !== "Enter") return
	const target = e.target
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
	handleAddToken()
}
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_token?.order"
		title="New token"
		:submitLabel="submitLabel"
		:submitDisabled="!isAvailableToCreateToken"
		:submitLoading="isBusy"
		submitTestId="import-token-button"
		@submit="handleAddToken"
	>
		<Input
			v-model="contractTerm"
			label="Contract address"
			placeholder="0x"
			data-testid="token-address-input"
			autofocus
			sanitize
			:disabled="isBusy"
		>
			<template #suffix>
				<Icon v-if="isAvailableToCreateToken" name="check-circle" size="14" color="green" />
			</template>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isAlreadyExist" align="center" gap="4" role="alert" data-testid="error-text">
						<Icon name="warning" size="12" color="orange" />
						<Text size="12" weight="600" color="primary"> Already exist </Text>
					</Flex>
					<Flex v-else-if="isInvalidAddress" align="center" gap="4" role="alert" data-testid="error-text">
						<Icon name="close-circle" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Invalid address </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<template v-if="error" #belowSubmit>
			<Flex align="center" gap="6" :class="$style.error_row">
				<Icon name="info" size="12" color="red" />
				<Text size="12" weight="500" color="secondary" :style="{ lineHeight: '1.4' }">
					{{ error }}
				</Text>
			</Flex>
		</template>
	</FormPopup>
</template>

<style module>
.error_row {
	padding: 8px 20px 0;
}
</style>
