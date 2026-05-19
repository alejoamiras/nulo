<route lang="json">
{ "meta": { "title": "Create" } }
</route>

<script setup lang="ts">
/** Components — popup-shared passkey ceremony dialog (teleports to #popup which
	 the onboarding shell declares too). */
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
				title: "Profile Creation Failed",
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
	// Defense-in-depth: zero out secret material on unmount even though Vue's
	// ref refs are GCed anyway.
	password.value = ""
	confirm.value = ""
})
</script>

<template>
	<Flex direction="column" :class="$style.page">
		<header :class="$style.hero">
			<h1 :class="$style.title">Set up your wallet</h1>
			<p :class="$style.subtitle">Name it, choose how to unlock it, and you're in.</p>
		</header>

		<form :class="$style.form" @submit.prevent="handleSubmit">
			<label :class="$style.field">
				<span :class="$style.label">Wallet name</span>
				<input
					v-model="profileName"
					type="text"
					placeholder="My Wallet"
					maxlength="32"
					required
					data-testid="onboarding-name-input"
					:class="$style.input"
				/>
			</label>

			<div :class="$style.methodTabs" role="tablist">
				<button
					type="button"
					role="tab"
					:aria-selected="authMethod === 'password'"
					:class="[$style.methodTab, authMethod === 'password' && $style.methodTabActive]"
					data-testid="onboarding-method-password"
					@click="authMethod = 'password'"
				>
					Password
				</button>
				<button
					type="button"
					role="tab"
					:aria-selected="authMethod === 'passkey'"
					:class="[$style.methodTab, authMethod === 'passkey' && $style.methodTabActive]"
					data-testid="onboarding-method-passkey"
					@click="authMethod = 'passkey'"
				>
					Passkey
				</button>
			</div>

			<div v-if="authMethod === 'password'" :class="$style.fields">
				<label :class="$style.field">
					<span :class="$style.label">Password</span>
					<input
						v-model="password"
						type="password"
						:maxlength="maxPasswordLength"
						placeholder="At least 8 characters"
						required
						data-testid="onboarding-password-input"
						:class="$style.input"
					/>
				</label>
				<label :class="$style.field">
					<span :class="$style.label">Confirm password</span>
					<input
						v-model="confirm"
						type="password"
						:maxlength="maxPasswordLength"
						required
						data-testid="onboarding-password-confirm"
						:class="$style.input"
					/>
				</label>
				<p v-if="passwordStrengthHint" :class="$style.hint">{{ passwordStrengthHint }}</p>
			</div>

			<div v-else :class="$style.passkeyInfo">
				<p>
					Your passkey replaces a password. Touch ID, Windows Hello, or a
					hardware key — whichever your device supports.
				</p>
			</div>

			<button
				type="submit"
				:disabled="!isAllowedToContinue || isCreating"
				:class="$style.submit"
				data-testid="onboarding-submit-create"
			>
				{{ submitLabel }}
			</button>
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
	margin: 64px auto 0;
	gap: 40px;
}

.hero {
	text-align: center;
}
.title {
	font-size: 32px;
	letter-spacing: -0.02em;
	font-weight: 600;
	margin: 0 0 8px;
	color: var(--app-text);
}
.subtitle {
	font-size: 15px;
	color: var(--text-secondary, #8a8a8a);
	margin: 0;
}

.form {
	display: flex;
	flex-direction: column;
	gap: 16px;
	width: 100%;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.label {
	font-size: 12px;
	color: var(--text-secondary, #8a8a8a);
	text-transform: uppercase;
	letter-spacing: 0.06em;
}
.input {
	padding: 12px 14px;
	border-radius: 8px;
	border: 1px solid var(--border-color, #2a2a2a);
	background: var(--surface, #121212);
	color: var(--app-text);
	font: inherit;
	font-size: 15px;
	outline: none;
	transition: border-color 140ms ease;
}
.input:focus {
	border-color: var(--app-text);
}

.methodTabs {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 4px;
	padding: 4px;
	background: var(--surface, #121212);
	border: 1px solid var(--border-color, #2a2a2a);
	border-radius: 10px;
}
.methodTab {
	padding: 10px;
	background: transparent;
	border: none;
	color: var(--text-secondary, #8a8a8a);
	font: inherit;
	font-size: 14px;
	font-weight: 500;
	cursor: pointer;
	border-radius: 8px;
	transition: background 140ms ease, color 140ms ease;
}
.methodTab:hover {
	color: var(--app-text);
}
.methodTabActive {
	background: var(--app-text);
	color: var(--app-bg);
}

.fields {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.hint {
	font-size: 12px;
	color: var(--text-secondary, #8a8a8a);
	margin: 0;
}

.passkeyInfo {
	font-size: 14px;
	color: var(--text-secondary, #c0c0c0);
	background: var(--surface, #121212);
	border: 1px solid var(--border-color, #2a2a2a);
	border-radius: 10px;
	padding: 16px;
	line-height: 1.5;
}
.passkeyInfo p {
	margin: 0;
}

.submit {
	margin-top: 8px;
	padding: 14px 20px;
	border-radius: 10px;
	border: 1px solid var(--app-text);
	background: var(--app-text);
	color: var(--app-bg);
	font: inherit;
	font-weight: 600;
	font-size: 15px;
	cursor: pointer;
	transition: opacity 140ms ease;
}
.submit:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
.submit:not(:disabled):hover {
	opacity: 0.85;
}
</style>
