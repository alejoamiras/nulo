<script setup>
/** Utils */
import { managers } from "@/utils/core"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.new_network?.order
})

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

/** All endpoint URLs across all networks in this profile — used for UI hint
 *  "already exists." The service still rejects same-Network URL collisions
 *  (and DUPLICATE_CHAIN at the chain level); the UI hint is just early
 *  feedback. */
const notAllowedNetworkUrls = computed(() => appStore.networks.flatMap((n) => n.endpoints.map((e) => e.rpcUrl)))

const form = useFormState({
	name: {
		initial: "",
		validate: (v) => {
			if (!v.length) return null
			if (appStore.networks.some((n) => n.name === v)) return "Already exists"
			return null
		},
	},
	url: {
		initial: "https://rpc.sandbox.nulo.sh/",
		validate: (v) => {
			if (!v.length) return null
			const stripped = v.endsWith("/") ? v.slice(0, -1) : v
			if (notAllowedNetworkUrls.value.includes(stripped)) return "Already exists"
			return null
		},
	},
})

const nameTerm = form.fields.name.value
const urlTerm = form.fields.url.value

const isUrlHasError = ref(false)
const isNameAlreadyExist = computed(() => form.fields.name.error.value === "Already exists")
const isUrlAlreadyExist = computed(() => form.fields.url.error.value === "Already exists")

const isAvailableToCreateNetwork = computed(() => {
	if (!nameTerm.value.length) return false
	if (!urlTerm.value.length) return false
	if (urlTerm.value.length < 5) return false
	if (form.fields.name.error.value || form.fields.url.error.value) return false
	return true
})

const isCreating = ref(false)
const handleCreateNetwork = async () => {
	if (!isAvailableToCreateNetwork.value) return
	// Creating a network ACTIVATES it, so it moves the scope a send is building
	// against. Checked up front to avoid creating one we then refuse to switch
	// to, and again at the switch itself — a send can start during the create.
	if (appStore.hasInFlightSend) {
		openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
		return
	}

	try {
		isCreating.value = true
		const network = await managers.network.addNetwork(nameTerm.value, urlTerm.value)
		isCreating.value = false

		await managers.network.setActiveNetwork(network.id)
		const activated = await appStore.commitScopeChange(() => {
			appStore.network = network
		})
		if (!activated) {
			openToast({ label: "Network added. Finish or cancel your pending transaction to switch to it", icon: "info" }, 4_000)
			appStore.networks = await managers.network.getNetworks()
			emit("onClose")
			return
		}
		appStore.networks = await managers.network.getNetworks()

		emit("onClose")

		openToast({ label: "Network is created" })
	} catch (error) {
		isCreating.value = false

		const msg = error instanceof Error ? error.message : String(error)
		if (msg.startsWith("DUPLICATE_CHAIN")) {
			// Smart-add: chain already exists in profile. Surface this clearly
			// so the user knows to use Settings → Networks → [chain] → Add endpoint.
			openToast(
				{ label: "A network for this chain already exists. Add it as an endpoint instead.", icon: "warning" },
				TOAST_DURATION.LONG,
			)
		} else if (msg === "Failed to fetch node info" || msg === "Failed to fetch network info") {
			isUrlHasError.value = true
		} else {
			openToast({ label: "Something went wrong", icon: "warning" }, TOAST_DURATION.LONG)
		}
	}
}

usePopupEntity(() => props.show, {
	submit: handleCreateNetwork,
	onHide: () => form.reset(),
})
</script>

<template>
	<FormPopup
		:show="show"
		@onClose="emit('onClose')"
		:displaceIdx="popupStore.popups.new_network?.order"
		title="New network"
		submitLabel="Create"
		:submitDisabled="!isAvailableToCreateNetwork"
		:submitLoading="isCreating"
		submitTestId="new-network-submit"
		@submit="handleCreateNetwork"
	>
		<Input
			label="Name"
			placeholder="My network"
			autofocus
			sanitize
			:maxLength="25"
			v-model="nameTerm"
			data-testid="network-name-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isNameAlreadyExist" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Already exists </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<Input
			label="RPC Link"
			placeholder="http://localhost:8080"
			v-model="urlTerm"
			@click="isUrlHasError = false"
			data-testid="network-rpc-input"
		>
			<template #right>
				<Transition name="fade">
					<Flex v-if="isUrlHasError" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Failed to fetch network info </Text>
					</Flex>
					<Flex v-else-if="isUrlAlreadyExist" align="center" gap="6">
						<Icon name="warning" size="12" color="red" />
						<Text size="12" weight="600" color="primary"> Already exists </Text>
					</Flex>
				</Transition>
			</template>
		</Input>

		<template #belowSubmit>
			<Text size="12" weight="500" color="tertiary" height="140" align="center" style="padding: 0 20px">
				We will check the availability of the specified RPC before adding it
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
