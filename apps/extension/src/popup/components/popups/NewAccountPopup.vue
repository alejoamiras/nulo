<script setup>
/** Utils */
import { AccountType } from "@/wallet/services/account/client"
import { managers } from "@/utils/core"
import { storageLocalSet } from "@/utils/storage"

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
	if (!name.value.length) return false
	if (form.fields.name.error.value) return false
	return true
})

const handleCreateAccount = async () => {
	if (!isAvailableToCreateAccount.value) return

	const account = await managers.account.createAccount(
		appStore.profile.id,
		appStore.network.chainId,
		AccountType.Nulo_v1,
		name.value.trim(),
	)

	appStore.account = account
	appStore.accounts.push(account)

	await storageLocalSet({
		"nulo:ui:activeAccount": account.address,
	})

	emit("onClose")
}

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			document.removeEventListener("keydown", onKeydown)

			form.reset()
		} else {
			document.addEventListener("keydown", onKeydown)

			// Can't use account.index for naming - indexes are per account type, not global
			let n = 1
			while (appStore.accounts.some((a) => a.name === `Account ${n}`)) n++
			name.value = `Account ${n}`

			await nextTick()
			inputEl.value.inputEl.focus()
		}
	},
)

const onKeydown = (e) => {
	if (e.key !== "Enter") return
	const target = e.target
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
	handleCreateAccount()
}
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_account?.order"
		title="New account"
		submitLabel="Create"
		:submitDisabled="!isAvailableToCreateAccount"
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

<style module>
.network {
	border-radius: 0;
	cursor: pointer;
	border: 1px solid var(--nulo-border);

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);

		& .icons {
			opacity: 1;
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.icons {
	opacity: 0;

	transition: all 0.2s var(--bezier);
}

.item {
	height: 30px;

	border-radius: 8px;
	border: 2px solid var(--nulo-border);
	cursor: pointer;

	padding: 0 16px;

	transition: all 0.2s var(--bezier);

	&:hover {
		border: 2px solid var(--nulo-outline);
	}

	&:active {
		background: var(--nulo-surface-high);
	}

	&.selected {
		background: var(--green);
	}

	&.disabled {
		opacity: 0.5;
		pointer-events: none;
	}
}
</style>
