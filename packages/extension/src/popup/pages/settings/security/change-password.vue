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
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

let profileService = null

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

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

const passwordHint = computed(() => {
	if (!newPassword.value || newPassword.value.length < 8) return "At least 8 characters"
	if (newPassword.value !== repeatedNewPassword.value) return "Passwords don't match"
	if (newPassword.value.length > 24) return "Long enough. Don't forget it."
	return "Strong password"
})

const isAllowedToChange = computed(() => {
	if (!currentPassword.value?.length || !newPassword.value?.length || !repeatedNewPassword.value?.length) return false
	if (newPassword.value.length < 8) return false
	if (newPassword.value !== repeatedNewPassword.value) return false
	return true
})

const isLoading = ref(false)
const handleChangePassword = async () => {
	if (!isAllowedToChange.value) return

	isLoading.value = true
	try {
		await profileService.changeProfilePassword(appStore.profile.id, currentPassword.value, newPassword.value)
		openToast({ label: "Profile password changed" })
		router.back()
	} catch (err) {
		if (err instanceof Error && err.message === "Invalid profile old password") {
			isWrongCurrentPassword.value = true
		} else {
			unexpectedErrorMessage.value = err instanceof Error ? err.message : String(err)
		}
	} finally {
		isLoading.value = false
	}
}

const onKeydown = (e) => {
	if (e.key === "Enter") handleChangePassword()
}

const handleScroll = () => {
	if (!scrollEl) return
	heroVisible.value = scrollEl.scrollTop < 40
}

onMounted(async () => {
	profileService = new ProfileServiceClient()
	document.addEventListener("keydown", onKeydown)
	await nextTick()
	scrollEl = wrapperRef.value?.wrapper
	if (!scrollEl) return
	scrollEl.addEventListener("scroll", handleScroll, { passive: true })
	handleScroll()
})

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
	profileService?.disconnect()
	profileService = null
	scrollEl?.removeEventListener("scroll", handleScroll)
	scrollEl = null
})
</script>

<template>
	<Flex direction="column" :class="$style.page">
		<Flex ref="wrapperRef" direction="column" :class="$style.wrapper">
			<SubPageHeader :backTo="'/popup/settings/profile'">
				<template #title>
					<span :class="[$style.collapsing_label, !heroVisible && $style.collapsing_label_visible]">Change Password</span>
				</template>
			</SubPageHeader>

			<Flex direction="column" :class="$style.content">
				<!-- Hero -->
				<div :class="$style.hero">
					<div :class="$style.title_stack">
						<span :class="$style.title_main">Change</span>
						<span :class="$style.title_sub">Password</span>
					</div>
					<div :class="$style.hero_bar" />
				</div>

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
							autofocus
							data-testid="current-password-input"
						>
							<template #suffix>
								<button
									type="button"
									@click="isPasswordType = !isPasswordType"
									:class="$style.visibility_btn"
									:aria-label="isPasswordType ? 'Show password' : 'Hide password'"
								>
									<MaterialIcon
										:name="isPasswordType ? 'visibility' : 'visibility_off'"
										:size="18"
										color="secondary"
									/>
								</button>
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
							data-testid="new-password-input"
						>
							<template #suffix>
								<button
									type="button"
									@click="isPasswordType = !isPasswordType"
									:class="$style.visibility_btn"
									:aria-label="isPasswordType ? 'Show password' : 'Hide password'"
								>
									<MaterialIcon
										:name="isPasswordType ? 'visibility' : 'visibility_off'"
										:size="18"
										color="secondary"
									/>
								</button>
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
			</Flex>
		</Flex>

		<div :class="$style.bottom">
			<Button
				@click="handleChangePassword"
				:disabled="!isAllowedToChange || hasError || isLoading"
				variant="cta"
				data-testid="change-password-submit-btn"
			>
				{{ isLoading ? "Changing…" : "Change Password" }}
			</Button>
		</div>
	</Flex>
</template>

<style module>
.page {
	flex: 1;
	min-height: 0;
	background: var(--app-bg);
}

.wrapper {
	flex: 1;
	min-height: 0;
	overflow: auto;
	scrollbar-gutter: stable;
}

.collapsing_label {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-primary);

	text-decoration: underline;
	text-decoration-color: var(--nulo-accent);
	text-decoration-thickness: 2px;
	text-underline-offset: 4px;

	opacity: 0;
	pointer-events: none;

	transition: opacity 0.18s cubic-bezier(0.4, 0, 1, 1);
}

.collapsing_label_visible {
	opacity: 1;
	pointer-events: auto;
}

.content {
	flex: 1;
	padding: 0 24px;
}

.hero {
	padding: 20px 0;
}

.title_stack {
	display: flex;
	flex-direction: column;
	line-height: 1.02;
}

.title_main {
	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.title_sub {
	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.hero_bar {
	width: 32px;
	height: 2px;
	background: var(--nulo-accent);
	margin-top: 10px;
}

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

.visibility_btn {
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: none;
	cursor: pointer;
	padding: 4px 0 4px 8px;
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

@keyframes shakeInput {
	0% { transform: translateX(0); }
	20% { transform: translateX(-4px); }
	40% { transform: translateX(4px); }
	60% { transform: translateX(-3px); }
	80% { transform: translateX(2px); }
	100% { transform: translateX(0); }
}

.shake { animation: shakeInput 0.3s ease; }

.bottom {
	flex-shrink: 0;
	padding: 20px 24px;
	background: var(--app-bg);
	border-top: 1px solid var(--nulo-border);
}

.cta {
	width: 100%;
	border: none;

	background: var(--nulo-accent);
	color: #0a0908;

	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: 0.2em;
	text-transform: uppercase;

	padding: 20px 0;
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: #fff;
	}

	&:active {
		background: var(--txt-primary);
		color: var(--app-bg);
		transition: none;
	}

	&:disabled {
		opacity: 0.3;
		pointer-events: none;
	}

	&:focus-visible {
		outline: 2px dotted var(--nulo-accent);
		outline-offset: 2px;
	}
}
</style>
