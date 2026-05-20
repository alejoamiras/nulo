<route lang="json">
{ "meta": { "title": "Create" } }
</route>

<script setup lang="ts">
/** Components — popup-shared passkey ceremony dialog (teleports to #popup
	which the onboarding shell declares too). */
import PasskeyCeremonyDialog from "@/popup/components/popups/PasskeyCeremonyDialog.vue"

/** Composables */
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"

/** Services */
import { managers, setSentinel } from "@/utils/core"

/** Utils */
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { ProfileIdConflictError, UserRejectedError } from "@nulo/extension-messaging/errors"

/** Stores */
import { useNotificationStore } from "@/stores/notification.store"

const router = useRouter()
const notificationStore = useNotificationStore()
const { bootstrapActiveProfile } = useProfileBootstrap()

const profileName = ref("")
const authMethod = ref<"password" | "passkey">("password")
const password = ref("")
const confirm = ref("")
const isCreating = ref(false)
const maxPasswordLength = 128

const trimmedName = computed(() => profileName.value.trim())

const passwordStrengthHint = computed(() => {
	if (authMethod.value === "passkey") return ""
	if (!password.value || password.value.length < 8) return "At least 8 characters"
	if (password.value !== confirm.value) return "Passwords don't match"
	if (password.value.length > 24) return "Long enough. Don't forget it."
	return "Strong password"
})

const isAllowedToContinue = computed(() => {
	if (!trimmedName.value || trimmedName.value.length < 1) return false
	if (trimmedName.value.length > 32) return false
	if (authMethod.value === "passkey") return true
	if (!password.value || password.value.length < 8) return false
	if (password.value !== confirm.value) return false
	return true
})

const submitLabel = computed(() => {
	if (isCreating.value) return "Creating..."
	return authMethod.value === "passkey" ? "Create with passkey" : "Create wallet"
})

const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

/** Mirrors profile/new.vue's retry loop. The pre-reserved id can be claimed
 * during the WebAuthn prompt; re-run the ceremony with a fresh id. */
async function createPasskeyProfileViaModal(name: string) {
	const MAX_RETRIES = 1
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const profileId = await managers.profile.generateProfileId()
		const credData = await runCeremony({ mode: "create", userHandle: profileId })
		try {
			return await managers.profile.createPasskeyProfile(name, credData)
		} catch (e) {
			if (e instanceof ProfileIdConflictError && attempt < MAX_RETRIES) {
				continue
			}
			throw e
		}
	}
	throw new Error("createPasskeyProfile retried beyond MAX_RETRIES")
}

async function handleSubmit() {
	if (!isAllowedToContinue.value || isCreating.value) return
	isCreating.value = true

	let profile
	try {
		profile =
			authMethod.value === "passkey"
				? await createPasskeyProfileViaModal(trimmedName.value)
				: await managers.profile.createProfile(trimmedName.value, password.value)
	} catch (e) {
		if (e instanceof UserRejectedError) {
			isCreating.value = false
			return
		}
		const description =
			authMethod.value === "passkey"
				? "An error occurred while creating the profile. This authenticator may not be supported or encountered an issue. Try again or use another one."
				: "An error occurred while creating the profile. Please try again."
		const note = authMethod.value === "passkey" ? "Windows Hello may not work correctly with some versions of Windows." : undefined

		notificationStore.create({
			type: "warning",
			payload: {
				title: "Wallet creation failed",
				description,
				note,
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
		console.error("Failed to create profile:", e)
		isCreating.value = false
		return
	}

	await bootstrapActiveProfile(profile)
	await setLastActiveProfileId(profile.id)
	await setSentinel()

	isCreating.value = false
	router.push("/onboarding/learn")
}

function onKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && isAllowedToContinue.value && !isCreating.value) handleSubmit()
}

onMounted(() => {
	document.addEventListener("keydown", onKeydown)
})

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
	// Defense-in-depth: zero out secret material on unmount.
	password.value = ""
	confirm.value = ""
})
</script>

<template>
	<Flex direction="column" gap="32" :class="$style.page">
		<StepIndicator :current="1" />
		<header :class="$style.hero">
			<h1 :class="$style.title_stack">
				<span :class="$style.title_main">Create</span>
				<span :class="$style.title_sub">Wallet</span>
			</h1>
			<div :class="$style.hero_bar" />
		</header>

		<form :class="$style.form" @submit.prevent="handleSubmit">
			<Flex direction="column" gap="8">
				<Text size="11" weight="700" color="secondary" :class="$style.section_label">Wallet name</Text>
				<Input
					v-model="profileName"
					type="text"
					placeholder="My Wallet"
					:maxLength="32"
					data-testid="onboarding-name-input"
				/>
			</Flex>

			<Flex direction="column" gap="12">
				<Text size="11" weight="700" color="secondary" :class="$style.section_label">Authentication method</Text>
				<Flex gap="0" :class="$style.tabs" role="group" aria-label="Authentication method">
					<button
						type="button"
						:aria-pressed="authMethod === 'password'"
						:class="[$style.tab, authMethod === 'password' && $style.tabActive]"
						data-testid="onboarding-method-password"
						@click="authMethod = 'password'"
					>
						Password
					</button>
					<button
						type="button"
						:aria-pressed="authMethod === 'passkey'"
						:class="[$style.tab, authMethod === 'passkey' && $style.tabActive]"
						data-testid="onboarding-method-passkey"
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
	</Flex>
</template>

<style module>
.page {
	max-width: 480px;
	width: 100%;
	margin: 16px auto 0;
}

.hero {
	padding: 8px 0 16px;
}

.title_stack {
	display: flex;
	flex-direction: column;
	line-height: 0.95;
	margin: 0;
	font-weight: 700;
}

.title_main {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.title_sub {
	font-family: var(--font-headline);
	font-size: 48px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
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
</style>
