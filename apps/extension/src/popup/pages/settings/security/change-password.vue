<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"hideHeader": true,
		"showBottomNav": false,
		"requirePasswordProfile": true
	}
}
</route>

<script setup>
/** Services */
import { ProfileServiceClient } from "@/wallet/services/profile/client"

/** Composables */
import { useToast } from "@/composables/toast"
import { isPopupSubmitKey, refuseRepeatEnter } from "@/composables/usePopupEntity"
const { openToast } = useToast()

/** Components */
import CollapsingHeroLayout from "@/components/composite/CollapsingHeroLayout.vue"
import PasswordVisibilityToggle from "@/components/composite/PasswordVisibilityToggle.vue"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { errorMessageFromUnknown } from "@nulo/wallet-core/utils"
import { isNewPasswordValid, newPasswordHint } from "@/utils/password"
const appStore = useAppStore()

const router = useRouter()

let profileService = null

const currentPassword = ref("")
const newPassword = ref("")
const repeatedNewPassword = ref("")
const maxPasswordLength = 128
const isPasswordType = ref(true)

/**
 * Split error state: `isWrongCurrentPassword` drives the lock-screen
 * pattern (red underline + shake + below-input "Wrong current password")
 * for the EXPECTED `Error("Invalid profile old password")` thrown by
 * `profile/service.ts:433`. `unexpectedErrorMessage` surfaces any other
 * error verbatim — flattening every failure to "Wrong" would hide
 * unexpected service-side failures that the user needs to see.
 */
const isWrongCurrentPassword = ref(false)
const unexpectedErrorMessage = ref("")
const hasError = computed(() => isWrongCurrentPassword.value || !!unexpectedErrorMessage.value)

const handlePasswordInput = () => {
	isWrongCurrentPassword.value = false
	unexpectedErrorMessage.value = ""
}

const passwordHint = computed(() => newPasswordHint(newPassword.value ?? "", repeatedNewPassword.value ?? ""))

const isAllowedToChange = computed(
	() => !!currentPassword.value?.length && isNewPasswordValid(newPassword.value ?? "", repeatedNewPassword.value ?? ""),
)

const isLoading = ref(false)
const handleChangePassword = async () => {
	if (!isAllowedToChange.value) return

	isLoading.value = true
	try {
		await profileService.changeProfilePassword(appStore.profile.id, currentPassword.value, newPassword.value)
		openToast({ kind: "success", label: "Profile password changed" })
		router.back()
	} catch (err) {
		if (err instanceof Error && err.message === "Invalid profile old password") {
			isWrongCurrentPassword.value = true
		} else {
			unexpectedErrorMessage.value = errorMessageFromUnknown(err)
		}
	} finally {
		isLoading.value = false
	}
}

const onKeydown = (e) => {
	if (e.defaultPrevented || !isPopupSubmitKey(e)) return
	handleChangePassword()
}

onMounted(() => {
	profileService = new ProfileServiceClient()
})

onBeforeUnmount(() => {
	profileService?.disconnect()
	profileService = null
})
</script>

<template>
	<CollapsingHeroLayout
		heroMain="Change"
		heroSub="Password"
		collapsingLabel="Change Password"
		backTo="/popup/settings/profile"
		@keydown="onKeydown"
	>
		<!-- Profile -->
		<div :class="$style.section">
			<span :class="$style.section_label">Profile</span>
			<ItemsContainer flat>
				<SettingItem :title="appStore.profile?.name ?? ''" icon="user" raw />
			</ItemsContainer>
		</div>

		<!-- Current password -->
		<div :class="$style.section">
			<span :class="$style.section_label">Current password</span>
			<div :class="[isWrongCurrentPassword && $style.shake]">
				<Input
					v-model="currentPassword"
					:error="isWrongCurrentPassword"
					:ariaInvalid="isWrongCurrentPassword"
					:type="isPasswordType ? 'password' : 'text'"
					@input="handlePasswordInput"
					placeholder="Enter current password"
					autocomplete="current-password"
					autofocus
					data-testid="current-password-input"
				>
					<template #suffix>
						<PasswordVisibilityToggle
							:hidden="isPasswordType"
							data-testid="current-password-input-visibility-toggle"
							@toggle="isPasswordType = !isPasswordType"
						/>
					</template>
				</Input>
			</div>
			<Transition name="fade">
				<span
					v-if="isWrongCurrentPassword"
					:class="$style.error_text"
					role="alert"
					data-testid="error-text"
				>
					Wrong current password
				</span>
			</Transition>
		</div>

		<!-- New password -->
		<div :class="$style.section_last">
			<span :class="$style.section_label">New password</span>
			<Flex direction="column" gap="12">
				<Input
					v-model="newPassword"
					:type="isPasswordType ? 'password' : 'text'"
					@input="handlePasswordInput"
					:maxLength="maxPasswordLength"
					placeholder="Enter new password"
					autocomplete="new-password"
					data-testid="new-password-input"
				>
					<template #suffix>
						<PasswordVisibilityToggle
							:hidden="isPasswordType"
							data-testid="new-password-input-visibility-toggle"
							@toggle="isPasswordType = !isPasswordType"
						/>
					</template>
					<template #bottom>
						<Flex align="center" gap="6" :class="$style.hint_row">
							<MaterialIcon name="lock" :size="12" color="tertiary" />
							<Text size="12" weight="600" color="tertiary">{{ passwordHint }}</Text>
						</Flex>
					</template>
				</Input>
				<Input
					v-model="repeatedNewPassword"
					data-testid="new-password-repeat-input"
					:type="isPasswordType ? 'password' : 'text'"
					@input="handlePasswordInput"
					:maxLength="maxPasswordLength"
					placeholder="Repeat new password"
					autocomplete="new-password"
				/>
			</Flex>

			<Flex
				v-if="unexpectedErrorMessage"
				align="start"
				gap="6"
				style="margin-top: 12px"
				role="alert"
			>
				<Icon name="info" size="14" color="red" />
				<Text
					size="12"
					weight="600"
					height="120"
					color="red"
					data-testid="error-text-unexpected"
				>
					{{ unexpectedErrorMessage }}
				</Text>
			</Flex>
		</div>

		<template #bottom>
			<Button
				@click="handleChangePassword"
				@keydown.enter="refuseRepeatEnter"
				:disabled="!isAllowedToChange || hasError || isLoading"
				variant="cta"
				data-testid="change-password-submit-btn"
			>
				{{ isLoading ? "Changing…" : "Change Password" }}
			</Button>
		</template>
	</CollapsingHeroLayout>
</template>

<style module>

/* No section-level border-bottom: the Input's own .base { border-bottom }
 * already underlines the section's last child. Stacking both produced two
 * 1px lines ~20px apart that read as a "double divider". */
.section {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

.section_last {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	color: var(--nulo-secondary);
}

.hint_row {
	margin-top: 4px;
}

.error_text {
	font-family: var(--font-body);
	font-size: 12px;
	color: var(--red);
	margin-top: 4px;
	display: block;
}

.shake {
	composes: shake_password from "../../../../components/composite/shake.module.css";
}
</style>
