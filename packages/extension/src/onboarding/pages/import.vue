<route lang="json">
{ "meta": { "title": "Import" } }
</route>

<script setup lang="ts">
/** Components — L3 (composite) import forms + popup-shared passkey dialog. */
import ImportFullBackupForm from "@/components/composite/import/ImportFullBackupForm.vue"
import ImportMethodPicker from "@/components/composite/import/ImportMethodPicker.vue"
import ImportSecretForm from "@/components/composite/import/ImportSecretForm.vue"
import PasskeyCeremonyDialog from "@/popup/components/popups/PasskeyCeremonyDialog.vue"

/** Composables */
import { useToast } from "@/composables/toast"
import { useFullBackupImport } from "@/composables/useFullBackupImport"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"

/** Services */
import { managers, setSentinel } from "@/utils/core"

/** Utils */
import { pickFile } from "@/utils"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { UserRejectedError } from "@nulo/extension-messaging/errors"

/** Stores */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"

const router = useRouter()
const { openToast } = useToast()
const appStore = useAppStore()
const notificationStore = useNotificationStore()
const { bootstrapActiveProfile } = useProfileBootstrap()

const selectedImportOption = ref<string | null>(null)
const profileName = ref("")
const seedPhrase = ref<string | undefined>(undefined)
const privateKey = ref<string | undefined>(undefined)
const publicKey = ref<string | undefined>(undefined)
const password = ref("")
const repeatedPassword = ref("")
const maxPasswordLength = 128
const isImporting = ref(false)

const error = ref({ type: "", title: "", tooltip: "" })
function fillError(errType?: string, title?: string, tooltip?: string) {
	if (!title) {
		error.value = { type: "", title: "", tooltip: "" }
		return
	}
	error.value = { type: errType ?? "unknown", title, tooltip: tooltip ?? "" }
}
function clearError() {
	fillError()
}

const isCopied = ref(false)
function handleCopyError() {
	isCopied.value = true
	window.navigator.clipboard.writeText(`${error.value.title}${error.value.tooltip ? `: ${error.value.tooltip}` : ""}`)
	openToast({ label: "Error is copied", icon: "copy" })
	setTimeout(() => {
		isCopied.value = false
	}, 1_500)
}
function handlePasswordInput() {
	if (error.value.type === "password") fillError()
}
function handleSecretInput() {
	if (error.value.type === "secret") fillError()
}

const trimmedName = computed(() => profileName.value.trim())

const isNameValid = computed(() => {
	const n = trimmedName.value
	return n.length >= 1 && n.length <= 32
})

const isAllowedToContinue = computed(() => {
	if (!isNameValid.value) return false
	if (!password.value || password.value.length < 8) return false
	if (selectedImportOption.value !== "public_key" && (!repeatedPassword.value || password.value !== repeatedPassword.value)) return false
	return true
})
const isAllowedToImportBySeedPhrase = computed(() => {
	if (!isAllowedToContinue.value) return false
	return seedPhrase.value?.split(" ").length === 24 && password.value?.length >= 8
})
const isAllowedToImportByPrivateKey = computed(() => {
	if (!isAllowedToContinue.value) return false
	return !!privateKey.value
})
const isAllowedToImportByPublicKey = computed(() => {
	if (!isAllowedToContinue.value) return false
	return !!publicKey.value
})

function waitForProfileActive(expectedId: string, timeoutMs: number) {
	return new Promise<void>((resolve, reject) => {
		if (appStore.isLogined && appStore.profile?.id === expectedId) return resolve()
		const t = setTimeout(() => {
			stop()
			reject(new Error("Profile activation timeout"))
		}, timeoutMs)
		const stop = watch([() => appStore.isLogined, () => appStore.profile?.id], ([logged, id]) => {
			if (logged && id === expectedId) {
				clearTimeout(t)
				stop()
				resolve()
			}
		})
	})
}

async function completeImport(profile: unknown) {
	const p = profile as { id: string }
	await setLastActiveProfileId(p.id)
	await setSentinel()
	try {
		await waitForProfileActive(p.id, 30_000)
		openToast({ label: "Profile imported", icon: "check-circle" })
		router.push("/onboarding/learn")
	} catch {
		openToast({ label: "Profile imported — unlock to continue" })
		router.push("/onboarding/learn")
	}
}

const handleImportSeed = async () => {
	if (!isAllowedToImportBySeedPhrase.value || isImporting.value) return
	isImporting.value = true
	try {
		const seedArr = (seedPhrase.value ?? "").split(" ")
		const profile = await managers.profile.importMnemonic(trimmedName.value, seedArr, password.value)
		await bootstrapActiveProfile(profile)
		await completeImport(profile)
	} catch (err) {
		fillError("unknown", "Import failed", err instanceof Error ? err.message : String(err))
	} finally {
		isImporting.value = false
	}
}

const handleImportPrivateKey = async () => {
	if (!isAllowedToImportByPrivateKey.value || isImporting.value) return
	isImporting.value = true
	try {
		const profile = await managers.profile.importPlain(trimmedName.value, privateKey.value as string, password.value)
		await bootstrapActiveProfile(profile)
		await completeImport(profile)
	} catch (err) {
		if (err instanceof Error && err.message === "Invalid secret length") {
			fillError("secret", "Invalid key length")
		} else {
			fillError("unknown", "Import failed", err instanceof Error ? err.message : String(err))
		}
	} finally {
		isImporting.value = false
	}
}

const handleImportPublicKey = async () => {
	if (!isAllowedToImportByPublicKey.value || isImporting.value) return
	isImporting.value = true
	try {
		const profile = await managers.profile.importEncrypted(trimmedName.value, publicKey.value as string, password.value)
		await bootstrapActiveProfile(profile)
		await completeImport(profile)
	} catch (err) {
		if (err instanceof Error && err.message === "Invalid password") {
			fillError("password", "Wrong password")
		} else if (err instanceof Error && err.message === "Invalid secret length") {
			fillError("secret", "Invalid encrypted key")
		} else {
			fillError("unknown", "Import failed", err instanceof Error ? err.message : String(err))
		}
	} finally {
		isImporting.value = false
	}
}

const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

const handleImportPasskey = async () => {
	if (!isNameValid.value) {
		fillError("name", "Wallet name required", "Enter a name before importing")
		return
	}
	try {
		const credData = await runCeremony({ mode: "get" })
		const profile = await managers.profile.importPasskey(trimmedName.value, credData)
		await bootstrapActiveProfile(profile)
		await completeImport(profile)
	} catch (err) {
		if (err instanceof UserRejectedError) return
		notificationStore.create({
			type: "warning",
			payload: {
				title: "Profile Import Failed",
				description:
					"An error occurred while importing the profile. This authenticator may not be supported or encountered an issue. Try again or use another one.",
				note: "Windows Hello may not work correctly with some versions of Windows.",
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
		console.error("Failed to import profile:", err)
	}
}

const {
	selectedBackup,
	decryptionPassword,
	restoreStatus,
	importedProfile,
	isAllowedToImportBackup,
	isRestoreHasErrors,
	pickBackupFile,
	decryptBackup,
	restoreBackup,
	showRestoreErrorLog,
	resetBackupState,
} = useFullBackupImport({
	password,
	repeatedPassword,
	fillError,
	clearError,
	pickFile,
	completeImport,
	runCeremony,
	// Onboarding-specific error-log surface: notify-based, not a popup dialog.
	showErrorLog: (errors) => {
		notificationStore.create({
			type: "warning",
			payload: {
				title: "Import completed with errors",
				description:
					"Some entries from the backup couldn't be restored. Check the developer console for details.",
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
		console.error("Restore errors:", errors)
	},
})

function clearFormState() {
	selectedImportOption.value = null
	privateKey.value = undefined
	publicKey.value = undefined
	seedPhrase.value = undefined
	password.value = ""
	repeatedPassword.value = ""
	resetBackupState()
	clearError()
}

const handleBack = () => clearFormState()

onBeforeUnmount(() => {
	password.value = ""
	repeatedPassword.value = ""
	seedPhrase.value = undefined
	privateKey.value = undefined
	publicKey.value = undefined
})
</script>

<template>
	<Flex direction="column" :class="$style.page">
		<header :class="$style.hero">
			<h1 :class="$style.title">Import your wallet</h1>
			<p :class="$style.subtitle">Restore from a seed, key, or backup.</p>
		</header>

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

		<ImportMethodPicker
			v-if="!selectedImportOption"
			type="import"
			@select="selectedImportOption = $event"
			@passkey="handleImportPasskey"
		/>

		<ImportFullBackupForm
			v-if="selectedImportOption === 'full_backup'"
			v-model:decryptionPassword="decryptionPassword"
			v-model:password="password"
			v-model:repeatedPassword="repeatedPassword"
			:selectedBackup="selectedBackup"
			:restoreStatus="restoreStatus"
			:isRestoreHasErrors="isRestoreHasErrors"
			:error="error"
			:isCopied="isCopied"
			:maxPasswordLength="maxPasswordLength"
			@pickFile="pickBackupFile"
			@copyError="handleCopyError"
			@passwordInput="handlePasswordInput"
		/>

		<ImportSecretForm
			v-if="selectedImportOption === 'seed' || selectedImportOption === 'private_key' || selectedImportOption === 'public_key'"
			v-model:seedPhrase="seedPhrase"
			v-model:privateKey="privateKey"
			v-model:publicKey="publicKey"
			v-model:password="password"
			v-model:repeatedPassword="repeatedPassword"
			:method="selectedImportOption"
			:error="error"
			:maxPasswordLength="maxPasswordLength"
			@secretInput="handleSecretInput"
			@passwordInput="handlePasswordInput"
		/>

		<div v-if="selectedImportOption" :class="$style.ctas">
			<template v-if="selectedImportOption === 'full_backup'">
				<button
					v-if="selectedBackup?.type === 'encrypted' && !selectedBackup?.profileType"
					type="button"
					:class="$style.cta"
					:disabled="!decryptionPassword"
					data-testid="onboarding-submit-import"
					@click="decryptBackup"
				>
					Decrypt backup
				</button>
				<button
					v-if="selectedBackup?.profileType && restoreStatus !== 'finished'"
					type="button"
					:class="$style.cta"
					:disabled="!isAllowedToImportBackup || restoreStatus === 'failed' || restoreStatus === 'progress'"
					data-testid="onboarding-submit-import"
					@click="restoreBackup"
				>
					{{ restoreStatus === "progress" ? "Importing..." : "Import wallet" }}
				</button>
				<button
					v-if="restoreStatus === 'finished' && isRestoreHasErrors"
					type="button"
					:class="$style.cta"
					@click="importedProfile && completeImport(importedProfile as { id: string })"
				>
					Continue
				</button>
				<button
					v-if="restoreStatus === 'finished' && isRestoreHasErrors"
					type="button"
					:class="[$style.cta, $style.ctaOutline]"
					@click="showRestoreErrorLog"
				>
					View errors
				</button>
			</template>

			<button
				v-if="selectedImportOption === 'seed'"
				type="button"
				:class="$style.cta"
				:disabled="!isAllowedToImportBySeedPhrase || isImporting"
				data-testid="onboarding-submit-import"
				@click="handleImportSeed"
			>
				Import wallet
			</button>
			<button
				v-if="selectedImportOption === 'private_key'"
				type="button"
				:class="$style.cta"
				:disabled="!isAllowedToImportByPrivateKey || isImporting"
				data-testid="onboarding-submit-import"
				@click="handleImportPrivateKey"
			>
				Import wallet
			</button>
			<button
				v-if="selectedImportOption === 'public_key'"
				type="button"
				:class="$style.cta"
				:disabled="!isAllowedToImportByPublicKey || isImporting"
				data-testid="onboarding-submit-import"
				@click="handleImportPublicKey"
			>
				Import wallet
			</button>

			<button
				type="button"
				:class="[$style.cta, $style.ctaOutline]"
				:disabled="restoreStatus === 'progress'"
				@click="handleBack"
			>
				Back to methods
			</button>
		</div>

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
	max-width: 560px;
	width: 100%;
	margin: 48px auto 0;
	gap: 24px;
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

.ctas {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 8px;
}
.cta {
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
.cta:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
.cta:not(:disabled):hover {
	opacity: 0.85;
}
.ctaOutline {
	background: transparent;
	color: var(--app-text);
}
</style>
