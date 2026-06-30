<script setup>
/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store.ts"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

/** Optional toggle row driven by a caller-owned ref:
 *  cacheStore.confirm.toggle = { label, description?, model: someRef }
 *  The popup binds v-model to `model` directly — Pinia's reactive
 *  deep-unwrap means accessing `model` on the store auto-unwraps the
 *  Ref to its primitive, and writes via v-model go back through the
 *  ref's setter. The caller's callback closure-captures `someRef`
 *  directly, so popup-clear (after submit) doesn't drop state
 *  mid-await. See contacts/index.vue:handleDeleteContact. */

const emit = defineEmits(["onClose"])
const props = defineProps({
	show: Boolean,
})

const displaceIdx = computed(() => {
	return popupStore.len - popupStore.popups.confirm?.order
})

const isDestructive = computed(() => cacheStore.confirm.confirm_color === "red")

const confirmationInputEl = useTemplateRef("confirmationInputEl")
const confirmationTerm = ref()
const isPasskeyConfirmed = ref(false)
const isConfirmed = computed(() => {
	return (
		(cacheStore.confirm.confirmation_text && cacheStore.confirm.confirmation_text === confirmationTerm.value) ||
		(cacheStore.confirm.passkeyConfirmation && isPasskeyConfirmed.value) ||
		(!cacheStore.confirm.confirmation_text && !cacheStore.confirm.passkeyConfirmation)
	)
})

async function handlePasskeyConfirmation() {
	if (isPasskeyConfirmed.value) {
		openToast({ label: "The operation is already confirmed", icon: "info" })
		return
	}

	try {
		const confirmation = await managers.profile.confirmProfileOperation(appStore.profile.id)
		if (confirmation) {
			isPasskeyConfirmed.value = true
			confirmationTerm.value = cacheStore.confirm.confirmation_text || ""
		}
	} catch (error) {}
}

const handleConfirm = () => {
	cacheStore.confirm.callback()
	emit("onClose")
}

watch(
	() => props.show,
	async () => {
		if (!props.show) {
			confirmationTerm.value = null
			isPasskeyConfirmed.value = false

			cacheStore.confirm = {}
		} else {
			if (cacheStore.confirm.confirmation_text) {
				await nextTick()
				confirmationInputEl.value.inputEl.focus()
			}
		}
	},
)
</script>

<template>
	<Popup :show @onClose="emit('onClose')" :displaceIdx="popupStore.popups.confirm?.order">
		<PopupCard :displaceIdx>
			<Flex direction="column" gap="32" :class="$style.wrapper" wide>
				<Flex direction="column" align="center" gap="12" :class="$style.header">
					<Icon name="warning" size="16" color="primary" />
					<span :class="$style.pre_title">
						{{ isDestructive ? 'Irreversible' : 'Action required' }}
					</span>
					<h2 :class="$style.title">
						{{ cacheStore.confirm.title ? cacheStore.confirm.title : "Are you sure?" }}
					</h2>
					<Text size="13" weight="500" color="body" height="150" align="center" :class="$style.description">
						{{ cacheStore.confirm.description }}
					</Text>
				</Flex>

				<Flex
					v-if="cacheStore.confirm.toggle"
					align="center"
					justify="between"
					gap="12"
					:class="$style.toggle_row"
				>
					<Flex direction="column" gap="2" :class="$style.toggle_text">
						<Text size="13" weight="600" color="primary">
							{{ cacheStore.confirm.toggle.label }}
						</Text>
						<Text v-if="cacheStore.confirm.toggle.description" size="11" weight="500" color="tertiary" height="140">
							{{ cacheStore.confirm.toggle.description }}
						</Text>
					</Flex>
					<Toggle
						v-model="cacheStore.confirm.toggle.model"
						data-testid="confirm-toggle"
					/>
				</Flex>

				<Flex v-if="cacheStore.confirm.confirmation_text || cacheStore.confirm.passkeyConfirmation" align="center" justify="between" gap="8" wide>
					<Input
						ref="confirmationInputEl"
						v-model="confirmationTerm"
						:placeholder="cacheStore.confirm.confirmation_text"
						wide
					/>

					<Button v-if="cacheStore.confirm.passkeyConfirmation" @click="handlePasskeyConfirmation" variant="ghost" size="medium">
						<Icon name="passkey" size="24" :color="isPasskeyConfirmed ? 'primary' : 'tertiary'" />
					</Button>
				</Flex>

				<Flex gap="12">
					<Button
						@click="emit('onClose')"
						wide
						variant="primary_outline"
						size="medium"
						data-testid="confirm-cancel"
					>
						Cancel
					</Button>

					<Button
						@click="handleConfirm"
						wide
						:type="cacheStore.confirm.confirm_color"
						:disabled="!isConfirmed"
						size="medium"
						data-testid="confirm-submit"
					>
						{{ cacheStore.confirm.confirm_text || "Confirm" }}
					</Button>
				</Flex>
			</Flex>
		</PopupCard>
	</Popup>
</template>

<style module>
.wrapper {
	padding: 0 20px 24px 20px;
}

.header {
	padding-top: 4px;
}

.pre_title {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;

	color: var(--nulo-secondary);
}

.toggle_row {
	padding: 12px 0;
	border-top: 1px solid var(--nulo-border);
	border-bottom: 1px solid var(--nulo-border);
}

.toggle_text {
	min-width: 0;
	flex: 1;
}

.title {
	font-family: var(--font-headline);
	font-size: 16px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	text-align: center;

	color: var(--txt-primary);
	margin: 0;

	max-width: 280px;
}

.description {
	max-width: 100%;
	word-wrap: break-word;
}

:global([theme="light"]) .pre_title {
	color: var(--txt-secondary);
}
</style>
