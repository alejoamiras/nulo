<script setup>
/** Utils */
import { AccountType } from "@/wallet/services/account/client"
import { managers } from "@/utils/core"
import { storageLocalSet } from "@/utils/storage"

/** Composables */
import { useToast } from "@/composables/toast"
import { useFormState } from "@/composables/useFormState"
import { usePopupEntity } from "@/composables/usePopupEntity"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.new_account?.order
})

const inputEl = useTemplateRef("inputEl")

const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v.length) return null
			if (appStore.accounts.find((a) => a.name === v)) return "Already exist"
			return null
		},
	},
})

const name = form.fields.name.value

const isAlreadyExist = computed(() => form.fields.name.error.value === "Already exist")
const isAvailableToCreateAccount = computed(() => {
	// Full-lifetime submit latch: a running create closes the form on EVERY
	// route (button, Enter, future callers) — the name-uniqueness check below
	// is synchronous against a post-await push, so two concurrent invocations
	// could otherwise both pass it and create two same-named accounts.
	if (isCreatingAccount.value) return false
	if (!name.value.length) return false
	if (form.fields.name.error.value) return false
	return true
})

const isCreatingAccount = ref(false)
const handleCreateAccount = async () => {
	if (!isAvailableToCreateAccount.value) return

	// Creating an account SELECTS it, so it changes the active account exactly
	// like a switch does — and a send in flight is still reading that.
	if (appStore.hasInFlightSend) {
		openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
		return
	}

	isCreatingAccount.value = true
	try {
		const account = await managers.account.createAccount(
			appStore.profile.id,
			appStore.network.chainId,
			AccountType.Nulo_v1,
			name.value.trim(),
		)

		// The account is created either way; only SELECTING it moves the scope, so
		// that part is re-checked after the creation RPC.
		appStore.accounts.push(account)
		const selected = await appStore.commitScopeChange(() => {
			appStore.account = account
		})
		if (!selected) {
			openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
			emit("onClose")
			return
		}

		await storageLocalSet({
			"nulo:ui:activeAccount": account.address,
		})

		emit("onClose")
	} finally {
		isCreatingAccount.value = false
	}
}

usePopupEntity(() => props.show, {
	submit: handleCreateAccount,
	onHide: () => form.reset(),
	onShow: async () => {
		// Can't use account.index for naming - indexes are per account type, not global
		let n = 1
		while (appStore.accounts.some((a) => a.name === `Account ${n}`)) n++
		name.value = `Account ${n}`

		await nextTick()
		inputEl.value.inputEl.focus()
	},
})
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_account?.order"
		title="New account"
		submitLabel="Create"
		:submitDisabled="!isAvailableToCreateAccount"
		:submitLoading="isCreatingAccount"
		submitTestId="new-account-submit"
		@submit="handleCreateAccount"
	>
		<Input
			ref="inputEl"
			label="Account name"
			placeholder="My Account"
			sanitize
			:maxLength="25"
			data-testid="account-name-input"
			v-model="name"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isAlreadyExist" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Already exist </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<template #belowSubmit>
			<Text size="12" weight="500" color="tertiary" height="140" align="center" style="padding: 0 20px">
				New accounts do not require the creation of a new seed phrase
			</Text>
		</template>
	</FormPopup>
</template>

