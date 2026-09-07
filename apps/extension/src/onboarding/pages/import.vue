<route lang="json">
{ "meta": { "title": "Import" } }
</route>

<script setup lang="ts">
/** Composables */
import { completeImportWithRecovery } from "@/composables/completeImportWithRecovery"
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"
import { useProfileImportFlow } from "@/composables/useProfileImportFlow"
import { useToast } from "@/composables/toast"

/** Utils */
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"

/** Stores */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"

/** Components — L3 (composite) import forms + shared passkey dialog. */
import ImportFullBackupForm from "@/components/composite/import/ImportFullBackupForm.vue"
import ImportMethodPicker from "@/components/composite/import/ImportMethodPicker.vue"
import ImportSecretForm from "@/components/composite/import/ImportSecretForm.vue"
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

const router = useRouter()
const appStore = useAppStore()
const notificationStore = useNotificationStore()
const { openToast } = useToast()
const { bootstrapActiveProfile, hydrateKnownProfile } = useProfileBootstrap()

// Onboarding has no popup app.vue `onActiveProfileChanged` listener, so it
// bootstraps the freshly activated profile itself — its "wait for active" IS the
// direct bootstrap. If that bootstrap doesn't activate (an MV3 worker restart
// mid-import, so the session couldn't be confirmed), the recovery re-reads the
// active profile and bootstraps again, matching the popup path. Onboarding routes
// to /onboarding/learn regardless (that screen gates on unlock); only the toast
// copy reflects the outcome.
async function completeImport(profile: unknown) {
	const p = profile as { id: string; name: string; type: "password" | "passkey" }
	await setLastActiveProfileId(p.id)
	const outcome = await completeImportWithRecovery({
		waitForActive: async () => {
			if (!(await bootstrapActiveProfile(p))) throw new Error("bootstrap did not activate")
		},
		recover: async () => (await hydrateKnownProfile())?.id === p.id && appStore.isLogined,
	})
	openToast(
		outcome === "active" ? { label: "Profile imported", icon: "check-circle" } : { label: "Profile imported. Unlock to continue." },
	)
	router.push("/onboarding/learn")
}

const {
	profileName,
	nameError,
	shakeName,
	nameInputRef,
	handleNameInput,
	ceremonyRequest,
	onCeremonyResolve,
	onCeremonyReject,
	selectedImportOption,
	seedPhrase,
	password,
	repeatedPassword,
	maxPasswordLength,
	isImporting,
	error,
	isCopied,
	isAllowedToImportBySeedPhrase,
	selectedBackup,
	decryptionPassword,
	restoreStatus,
	restoreStage,
	importedProfile,
	isAllowedToImportBackup,
	isRestoreHasErrors,
	pickBackupFile,
	decryptBackup,
	restoreBackup,
	showRestoreErrorLog,
	handleImportSeed,
	handleImportPasskey,
	handlePasswordInput,
	handleSecretInput,
	handleCopyError,
	handleBack,
	dispose,
} = useProfileImportFlow({
	completeImport,
	// Onboarding error-log surface: notify-based, not a popup dialog.
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
	notifyImportFailed: () => {
		notificationStore.create({
			type: "warning",
			payload: {
				title: "Profile import failed",
				description:
					"An error occurred while importing the profile. This authenticator may not be supported or encountered an issue. Try again or use another one.",
				note: "Windows Hello may not work correctly with some versions of Windows.",
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
	},
	openToast,
})

onBeforeUnmount(() => {
	dispose()
	// Defense-in-depth: zero out secret material on unmount.
	password.value = ""
	repeatedPassword.value = ""
	seedPhrase.value = undefined
})
</script>

<template>
	<OnboardingPage :gap="24" :data-restore-stage="restoreStage">
		<OnboardingBackLink testid="onboarding-import-back" />
		<StepIndicator :current="1" />
		<header :class="$style.hero">
			<BrutalistTitle main="Import" sub="Profile" />
			<div :class="$style.hero_bar" />
			<Text size="14" color="secondary" height="150">Restore from a recovery phrase, passkey, or full backup.</Text>
		</header>

		<OnboardingProfileNameField
			ref="nameInputRef"
			v-model="profileName"
			:error="nameError"
			:shake="shakeName"
			@input="handleNameInput"
		/>

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
			v-if="selectedImportOption === 'seed'"
			v-model:seedPhrase="seedPhrase"
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
					{{ restoreStatus === "progress" ? "Importing..." : "Import profile" }}
				</Button>
				<Button
					v-if="restoreStatus === 'finished' && isRestoreHasErrors"
					variant="cta"
					size="large"
					data-testid="import-full-backup-continue-btn"
					@click="importedProfile && completeImport(importedProfile as { id: string })"
				>
					Continue
				</Button>
				<Button
					v-if="restoreStatus === 'finished' && isRestoreHasErrors"
					variant="cta_outline"
					size="large"
					data-testid="import-full-backup-view-errors-btn"
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
				Import profile
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
	</OnboardingPage>
</template>

<style module>
.hero {
	padding: 8px 0 16px;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.hero_bar {
	width: 40px;
	height: 2px;
	background: var(--nulo-accent);
}

.ctas {
	margin-top: 8px;
}

</style>
