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
// Prefill the wallet-name field so the passkey discovery path (which has no
// secret to fill in) can't fail validation on a blank name — and so users
// generally never see an "enter a name" error. Mirrors popup/pages/import.vue.
const profileName = ref("My Wallet")
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
		openToast({ label: "Profile imported. Unlock to continue." })
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
		fillError("name", "Wallet name required", "Enter a name before importing.")
		// Surface the error inline AND as a notification — passkey path has
		// no other visible field to anchor the error message.
		notificationStore.create({
			type: "warning",
			payload: {
				title: "Wallet name required",
				description: "Enter a name above before importing with a passkey.",
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
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
				title: "Wallet import failed",
				description:
					"An error occurred while importing the wallet. This authenticator may not be supported or encountered an issue. Try again or use another one.",
				note: "Windows Hello may not work correctly with some versions of Windows.",
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
		console.error("Failed to import wallet:", err)
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
				description: "Some entries from the backup couldn't be restored. Check the developer console for details.",
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
	// Keep profileName so the user doesn't have to retype it after switching
	// import methods.
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
	<Flex direction="column" gap="24" :class="$style.page">
		<StepIndicator :current="1" />
		<header :class="$style.hero">
			<h1 :class="$style.title_stack">
				<span :class="$style.title_main">Import</span>
				<span :class="$style.title_sub">Wallet</span>
			</h1>
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">Restore from a seed, key, or backup.</Text>
		</header>

		<Flex direction="column" gap="8">
			<Text size="11" weight="700" color="secondary" :class="$style.section_label">Wallet name</Text>
			<Input
				v-model="profileName"
				type="text"
				placeholder="My Wallet"
				:maxLength="32"
				:error="error.type === 'name'"
				data-testid="onboarding-name-input"
			/>
			<Text v-if="error.type === 'name'" size="12" color="red" role="alert">
				{{ error.title }}{{ error.tooltip ? `. ${error.tooltip}` : "" }}
			</Text>
		</Flex>

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

		<Flex v-if="selectedImportOption" direction="column" gap="10" :class="$style.ctas">
			<template v-if="selectedImportOption === 'full_backup'">
				<Button
					v-if="selectedBackup?.type === 'encrypted' && !selectedBackup?.profileType"
					variant="cta"
					size="large"
					:disabled="!decryptionPassword"
					data-testid="onboarding-submit-import"
					@click="decryptBackup"
				>
					Decrypt backup
				</Button>
				<Button
					v-if="selectedBackup?.profileType && restoreStatus !== 'finished'"
					variant="cta"
					size="large"
					:disabled="!isAllowedToImportBackup || restoreStatus === 'failed' || restoreStatus === 'progress'"
					:loading="restoreStatus === 'progress'"
					data-testid="onboarding-submit-import"
					@click="restoreBackup"
				>
					{{ restoreStatus === "progress" ? "Importing..." : "Import wallet" }}
				</Button>
				<Button
					v-if="restoreStatus === 'finished' && isRestoreHasErrors"
					variant="cta"
					size="large"
					@click="importedProfile && completeImport(importedProfile as { id: string })"
				>
					Continue
				</Button>
				<Button
					v-if="restoreStatus === 'finished' && isRestoreHasErrors"
					variant="cta_outline"
					size="large"
					@click="showRestoreErrorLog"
				>
					View errors
				</Button>
			</template>

			<Button
				v-if="selectedImportOption === 'seed'"
				variant="cta"
				size="large"
				:disabled="!isAllowedToImportBySeedPhrase || isImporting"
				:loading="isImporting"
				data-testid="onboarding-submit-import"
				@click="handleImportSeed"
			>
				Import wallet
			</Button>
			<Button
				v-if="selectedImportOption === 'private_key'"
				variant="cta"
				size="large"
				:disabled="!isAllowedToImportByPrivateKey || isImporting"
				:loading="isImporting"
				data-testid="onboarding-submit-import"
				@click="handleImportPrivateKey"
			>
				Import wallet
			</Button>
			<Button
				v-if="selectedImportOption === 'public_key'"
				variant="cta"
				size="large"
				:disabled="!isAllowedToImportByPublicKey || isImporting"
				:loading="isImporting"
				data-testid="onboarding-submit-import"
				@click="handleImportPublicKey"
			>
				Import wallet
			</Button>

			<Button
				variant="cta_outline"
				size="large"
				:disabled="restoreStatus === 'progress'"
				@click="handleBack"
			>
				Back to methods
			</Button>
		</Flex>

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
	margin: 16px auto 0;
}

.hero {
	padding: 8px 0 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;
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
}

.section_label {
	font-family: var(--font-headline);
	text-transform: uppercase;
	letter-spacing: 0.18em;
}

.ctas {
	margin-top: 8px;
}
</style>
