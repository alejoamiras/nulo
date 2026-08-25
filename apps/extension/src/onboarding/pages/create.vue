<route lang="json">
{ "meta": { "title": "Create" } }
</route>

<script setup lang="ts">
/** Composables */
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"
import { useProfileCreateFlow } from "@/composables/useProfileCreateFlow"

/** Services */
import type { ProfileInfo } from "@/wallet/services/profile/spec"

/** Utils */
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"

/** Stores */
import { useNotificationStore } from "@/stores/notification.store"

/** Components — shared passkey ceremony dialog (teleports to #popup, which the
	onboarding shell declares too). */
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

const router = useRouter()
const notificationStore = useNotificationStore()
const { bootstrapActiveProfile } = useProfileBootstrap()

const maxPasswordLength = 128

const {
	profileName,
	nameError,
	shakeName,
	nameInputRef,
	handleNameInput,
	ceremonyRequest,
	onCeremonyResolve,
	onCeremonyReject,
	authMethod,
	password,
	repeatedPassword: confirm,
	isCreating,
	strengthHint: passwordStrengthHint,
	isAllowedToContinue,
	handleCreate: handleSubmit,
	dispose,
} = useProfileCreateFlow({
	// Onboarding has no popup app.vue listener, so it bootstraps the freshly
	// created profile itself, then routes.
	onCreated: async (profile) => {
		await bootstrapActiveProfile(profile as ProfileInfo)
		await setLastActiveProfileId((profile as ProfileInfo).id)
		router.push("/onboarding/learn")
	},
	notifyCreateFailed: (isPasskey) => {
		notificationStore.create({
			type: "warning",
			payload: {
				title: "Profile creation failed",
				description: isPasskey
					? "An error occurred while creating the profile. This authenticator may not be supported or encountered an issue. Try again or use another one."
					: "An error occurred while creating the profile. Please try again.",
				note: isPasskey ? "Windows Hello may not work correctly with some versions of Windows." : undefined,
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
	},
})

const submitLabel = computed(() => {
	if (isCreating.value) return "Creating..."
	return authMethod.value === "passkey" ? "Create with passkey" : "Create profile"
})

// Roving tablist for the method toggle: only the active tab is in the Tab order,
// so Tab flows name → method (ONE stop) → password; ←/→ switch the method.
const passwordTabRef = ref<HTMLButtonElement>()
const passkeyTabRef = ref<HTMLButtonElement>()
const onMethodKeydown = (e: KeyboardEvent) => {
	if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
	e.preventDefault()
	authMethod.value = authMethod.value === "password" ? "passkey" : "password"
	nextTick(() => (authMethod.value === "password" ? passwordTabRef.value : passkeyTabRef.value)?.focus())
}

// Onboarding keeps its own document-level Enter handler alongside the
// `<form @submit.prevent>`; both are latch-protected by `isCreating`.
function onKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !isCreating.value) handleSubmit()
}

onMounted(() => {
	document.addEventListener("keydown", onKeydown)
})

onBeforeUnmount(() => {
	dispose()
	document.removeEventListener("keydown", onKeydown)
	// Defense-in-depth: zero out secret material on unmount.
	password.value = ""
	confirm.value = ""
})
</script>

<template>
	<OnboardingPage>
		<button
			type="button"
			:class="$style.back"
			data-testid="onboarding-create-back"
			@click="router.push('/onboarding/welcome')"
		>
			<MaterialIcon name="chevron_left" :size="14" />
			<span>Back</span>
		</button>
		<StepIndicator :current="1" />
		<header :class="$style.hero">
			<BrutalistTitle main="Create" sub="Profile" />
			<div :class="$style.hero_bar" />
		</header>

		<form :class="$style.form" @submit.prevent="handleSubmit">
			<Flex direction="column" gap="8">
				<Text size="11" weight="700" color="secondary" :class="$style.section_label">Profile name</Text>
				<div :class="[shakeName && $style.shake]">
					<Input
						ref="nameInputRef"
						v-model="profileName"
						type="text"
						placeholder="My Profile"
						:maxLength="32"
						:error="!!nameError"
						:ariaInvalid="!!nameError"
						sanitize
						data-testid="onboarding-name-input"
						@input="handleNameInput"
					/>
				</div>
				<Text v-if="nameError" size="12" color="red" height="150" role="alert">
					{{ nameError }}
				</Text>
			</Flex>

			<Flex direction="column" gap="12">
				<Text size="11" weight="700" color="secondary" :class="$style.section_label">Authentication method</Text>
				<Flex :class="$style.tabs" role="tablist" aria-label="Authentication method" @keydown="onMethodKeydown">
					<button
						ref="passwordTabRef"
						type="button"
						role="tab"
						:aria-selected="authMethod === 'password'"
						:tabindex="authMethod === 'password' ? 0 : -1"
						:class="[$style.tab, authMethod === 'password' && $style.tabActive]"
						data-testid="onboarding-method-password"
						@click="authMethod = 'password'"
					>
						Password
					</button>
					<button
						ref="passkeyTabRef"
						type="button"
						role="tab"
						:aria-selected="authMethod === 'passkey'"
						:tabindex="authMethod === 'passkey' ? 0 : -1"
						data-testid="onboarding-method-passkey"
						:class="[$style.tab, authMethod === 'passkey' && $style.tabActive]"
						@click="authMethod = 'passkey'"
					>
						Passkey
					</button>
				</Flex>
			</Flex>

			<Flex v-if="authMethod === 'password'" direction="column" gap="12">
				<Flex direction="column" gap="8">
					<Text size="11" weight="700" color="secondary" :class="$style.section_label">Password</Text>
					<Input
						v-model="password"
						type="password"
						placeholder="Strong password"
						:maxLength="maxPasswordLength"
						data-testid="onboarding-password-input"
					/>
				</Flex>
				<Flex direction="column" gap="8">
					<Text size="11" weight="700" color="secondary" :class="$style.section_label">Confirm password</Text>
					<Input
						v-model="confirm"
						type="password"
						placeholder="Repeat password"
						:maxLength="maxPasswordLength"
						data-testid="onboarding-password-confirm"
					/>
				</Flex>
				<Text v-if="passwordStrengthHint" size="12" color="secondary" height="150">
					{{ passwordStrengthHint }}
				</Text>
			</Flex>

			<div v-else :class="$style.passkeyInfo">
				<Text size="13" color="secondary" height="150">
					Your passkey replaces a password. Touch ID, Windows Hello, or
					a hardware key, whichever your device supports.
				</Text>
			</div>

			<Button
				variant="cta"
				size="large"
				:disabled="!isAllowedToContinue || isCreating"
				:loading="isCreating"
				data-testid="onboarding-submit-create"
				@click="handleSubmit"
			>
				{{ submitLabel }}
			</Button>
		</form>

		<PasskeyCeremonyDialog
			v-if="ceremonyRequest"
			:request="ceremonyRequest"
			@resolve="onCeremonyResolve"
			@reject="onCeremonyReject"
		/>
	</OnboardingPage>
</template>

<style module>
.back {
	align-self: flex-start;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font-family: var(--font-mono);
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	cursor: pointer;
	padding: 4px 8px 4px 0;
	transition: color 0.15s var(--bezier);
}
.back:hover {
	color: var(--txt-primary);
}
.back:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
	color: var(--txt-primary);
}

.hero {
	padding: 8px 0 16px;
}

.hero_bar {
	width: 40px;
	height: 2px;
	background: var(--nulo-accent);
	margin-top: 12px;
}

.form {
	display: flex;
	flex-direction: column;
	gap: 24px;
}

.section_label {
	text-transform: uppercase;
	letter-spacing: 0.18em;
	font-family: var(--font-headline);
}

.tabs {
	border: 1px solid var(--nulo-outline);
	background: var(--nulo-surface);
	width: fit-content;
}

.tab {
	background: transparent;
	border: none;
	color: var(--txt-secondary);
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.12em;
	padding: 10px 20px;
	cursor: pointer;
	transition: background 0.15s var(--bezier), color 0.15s var(--bezier);
}

.tab:hover {
	color: var(--txt-primary);
}

.tab:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: -2px;
}

.tabActive {
	background: var(--nulo-accent);
	color: var(--app-bg);
}

.tabActive:hover {
	color: var(--app-bg);
}

.passkeyInfo {
	padding: 16px;
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
}

@keyframes shakeInput {
	0% { transform: translateX(0); }
	20% { transform: translateX(-4px); }
	40% { transform: translateX(4px); }
	60% { transform: translateX(-3px); }
	80% { transform: translateX(2px); }
	100% { transform: translateX(0); }
}

.shake {
	animation: shakeInput 0.4s ease;
}
</style>
