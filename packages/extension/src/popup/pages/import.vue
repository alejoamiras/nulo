<route lang="json">
{
	"meta": {
		"isAuthRequired": false,
		"hideHeader": true,
		"showBottomNav": false
	}
}
</route>

<script setup>
/** Services */
import { managers, setSentinel } from "@/utils/core"

/** Utils */
import { pickFile } from "@/utils"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { redirectToOnboardingTabIfNeeded } from "@/wallet/utils/onboarding-tab"

/** Composables */
import { useToast } from "@/composables/toast"
import { useFullBackupImport } from "@/composables/useFullBackupImport"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileNameField } from "@/composables/useProfileNameField"
import { waitForProfileActive } from "@/composables/waitForProfileActive"

/** Stores */
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"

/** Components */
import ImportFullBackupForm from "@/components/composite/import/ImportFullBackupForm.vue"
import ImportMethodPicker from "@/components/composite/import/ImportMethodPicker.vue"
import ImportSecretForm from "@/components/composite/import/ImportSecretForm.vue"
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

/** Errors */
import { UserRejectedError } from "@nulo/extension-messaging/errors"

const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"
const appStore = useAppStore()
const notificationStore = useNotificationStore()

/** Router */
const route = useRoute()
const router = useRouter()

const type = computed(() => (route.query.type === "recovery" ? "recovery" : "import"))
const backTo = computed(() => String(route.query.from || "/popup/register"))

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

// First-time install / deep-link bypass: redirect to onboarding tab when
// no profile exists AND onboarding hasn't been completed. Shared helper at
// @/wallet/utils/onboarding-tab; same predicate as register + profile/new.
onBeforeMount(() => redirectToOnboardingTabIfNeeded(appStore))

/** Reactive state */
const selectedImportOption = ref(null)

const seedPhrase = ref()
const privateKey = ref()
const publicKey = ref()

// Profile name is required across every import path (including passkey
// discovery, which has no other visible field to anchor the error).
// Validated at submit time so an empty name shakes the input + shows inline
// error instead of silently disabling the button. Full-backup path prefills
// from the parsed backup name via a guarded watch (only when input is
// empty — protects mid-typing from being clobbered by a delayed parse).
const {
	profileName,
	trimmedName,
	nameError,
	shakeName,
	nameInputRef,
	validate: validateName,
	handleInput: handleNameInput,
	dispose: disposeNameField,
} = useProfileNameField()

const password = ref("")
const repeatedPassword = ref("")
const maxPasswordLength = 128

const error = ref({ type: "", title: "", tooltip: "" })
const fillError = (errType, title, tooltip) => {
	if (!title) {
		error.value = { type: "", title: "", tooltip: "" }
		return
	}
	error.value = { type: errType, title, tooltip }
}
const clearError = () => fillError()

const isCopied = ref(false)
function handleCopyError() {
	isCopied.value = true
	window.navigator.clipboard.writeText(`${error.value.title}${error.value.tooltip ? `: ${error.value.tooltip}` : ""}`)
	openToast({ label: "Error is copied", icon: "copy" })
	setTimeout(() => {
		isCopied.value = false
	}, 1_500)
}

const handlePasswordInput = () => {
	if (error.value.type === "password") fillError()
}

const handleSecretInput = () => {
	if (error.value.type === "secret") fillError()
}

// Excludes the name check on purpose — name is validated at submit time so
// an empty name shakes instead of leaving the import buttons silently disabled.
const isAllowedToContinue = computed(() => {
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

/** Handlers */

// In-flight latch for seed/private-key/public-key/passkey paths. The full-
// backup path has its own `restoreStatus` gate inside `useFullBackupImport`.
// Set BEFORE the async `getProfiles()` fetch so two rapid clicks can't both
// pass the pre-check before the lock is set.
const isImporting = ref(false)

const completeImport = async (profile) => {
	await setLastActiveProfileId(profile.id)
	await setSentinel()
	try {
		// The session is opened by `profileService.finalizeRestore` inside
		// `useFullBackupImport.restoreBackup`, before this runs (or by the
		// seed/key import helpers, which also auto-unlock). 30s covers any
		// reasonable SW init + PXE state load; a longer hang means something
		// is wedged, so escape to /popup/auth and let the user retry.
		await waitForProfileActive(appStore, profile.id, 30_000)
		openToast({ label: "Profile imported", icon: "check-circle" })
		router.push("/popup/general")
	} catch {
		// Worst case: profile IS in storage; user just needs to unlock.
		openToast({ label: "Profile imported — unlock to continue", icon: "info" }, TOAST_DURATION.LONG)
		router.push("/popup/auth")
	}
}

const handleImportSeed = async () => {
	if (!isAllowedToImportBySeedPhrase.value || isImporting.value) return
	isImporting.value = true
	try {
		const existingNames = (await managers.profile.getProfiles()).map((p) => p.name)
		if (!validateName({ existingNames })) {
			isImporting.value = false
			return
		}
		const profile = await managers.profile.importMnemonic(trimmedName.value, seedPhrase.value.split(" "), password.value)
		await completeImport(profile)
	} catch (err) {
		fillError("unknown", err)
	} finally {
		isImporting.value = false
	}
}

const handleImportPrivateKey = async () => {
	if (!isAllowedToImportByPrivateKey.value || isImporting.value) return
	isImporting.value = true
	try {
		const existingNames = (await managers.profile.getProfiles()).map((p) => p.name)
		if (!validateName({ existingNames })) {
			isImporting.value = false
			return
		}
		const profile = await managers.profile.importPlain(trimmedName.value, privateKey.value, password.value)
		await completeImport(profile)
	} catch (err) {
		// `profile/service.ts` throws `new Error("Invalid secret length")` —
		// arrives as an Error instance across the RPC boundary, not a string.
		// The prior `err === "Invalid secret length"` comparison never matched
		// so the field-level "secret" error never surfaced.
		if (err instanceof Error && err.message === "Invalid secret length") {
			fillError("secret", "Invalid key length")
		} else {
			fillError("unknown", err)
		}
	} finally {
		isImporting.value = false
	}
}

const handleImportPublicKey = async () => {
	if (!isAllowedToImportByPublicKey.value || isImporting.value) return
	isImporting.value = true
	try {
		const existingNames = (await managers.profile.getProfiles()).map((p) => p.name)
		if (!validateName({ existingNames })) {
			isImporting.value = false
			return
		}
		const profile = await managers.profile.importEncrypted(trimmedName.value, publicKey.value, password.value)
		await completeImport(profile)
	} catch (err) {
		// `profile/service.ts:575` throws `new Error("Invalid password")` for
		// the wrong-decryption-password case. Surface it under the password
		// input via `error.type === "password"`, matching the lock-screen
		// pattern. The prior code routed this to the generic "unknown" tag.
		if (err instanceof Error && err.message === "Invalid password") {
			fillError("password", "Wrong password")
		} else if (err instanceof Error && err.message === "Invalid secret length") {
			fillError("secret", "Invalid encrypted key")
		} else {
			fillError("unknown", err)
		}
	} finally {
		isImporting.value = false
	}
}

// Path A: in-page passkey ceremony for import flow.
const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

const handleImportPasskey = async () => {
	if (isImporting.value) return
	isImporting.value = true
	try {
		const existingNames = (await managers.profile.getProfiles()).map((p) => p.name)
		if (!validateName({ existingNames })) {
			isImporting.value = false
			return
		}
		// Discovery `get` — no allowedCredentials; user picks from their
		// available passkeys.
		const credData = await runCeremony({ mode: "get" })
		const profile = await managers.profile.importPasskey(trimmedName.value, credData)
		await completeImport(profile)
	} catch (err) {
		// Path A user cancel: silent return (matches prior behavior — no
		// warning toast on Escape / "user closed" / "timed out or not allowed").
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
	} finally {
		isImporting.value = false
	}
}

/** Full backup composable */
const {
	selectedBackup,
	decryptionPassword,
	restoreStatus,
	importedProfile,
	isAllowedToImportBackup,
	isRestoreHasErrors,
	parsedBackupName,
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
	// Path A: thread the page-local passkey-ceremony driver through the
	// composable so passkey backups can run the modal before
	// `profileService.restore` (which requires `credentialData` for
	// passkey type — no SW-window fallback).
	runCeremony,
	// F3: typed name overrides the backup-embedded name when non-empty
	// after trim. Composable spread-clones before passing to restore() so
	// the parsed backup data isn't mutated in place.
	profileName,
	// Popup-specific error-log surface: open the data-viewer overlay.
	showErrorLog: (errors) => {
		const cacheStore = useCacheStore()
		const popupStore = usePopupStore()
		cacheStore.viewerData = errors
		popupStore.open("data_viewer")
	},
})

// Guarded prefill: when a backup is parsed, fill the Profile-name input —
// but only when the user hasn't typed anything yet. Protects mid-typing
// from being clobbered if a heavy file's parse completes after the user
// starts typing in the name field.
watch(parsedBackupName, (newName) => {
	if (newName && !profileName.value.trim()) profileName.value = newName
})

// Keep `profileName` across import-method switches so the user doesn't have
// to retype it when they hit Back. Matches the onboarding flow's behavior.
function clearFormState() {
	selectedImportOption.value = null
	privateKey.value = null
	publicKey.value = null
	seedPhrase.value = null
	password.value = ""
	repeatedPassword.value = ""
	resetBackupState()
	clearError()
}

const handleBack = () => {
	clearFormState()
}

/** Listeners */
const onKeydown = (e) => {
	if (e.key === "Enter") {
		if (selectedBackup.value?.type === "encrypted" && !selectedBackup.value?.profileType) {
			decryptBackup()
		} else if (selectedBackup.value?.profileType && restoreStatus.value !== "finished") {
			restoreBackup()
		} else if (restoreStatus.value === "finished" && isRestoreHasErrors.value) {
			completeImport(importedProfile.value)
		}
	}
}

const handleScroll = () => {
	if (!scrollEl) return
	heroVisible.value = scrollEl.scrollTop < 40
}

/** Lifecycle */
onMounted(async () => {
	document.addEventListener("keydown", onKeydown)
	await nextTick()
	scrollEl = wrapperRef.value?.wrapper
	if (!scrollEl) return
	scrollEl.addEventListener("scroll", handleScroll, { passive: true })
	handleScroll()
})

onBeforeUnmount(() => {
	disposeNameField()
	document.removeEventListener("keydown", onKeydown)
	scrollEl?.removeEventListener("scroll", handleScroll)
	scrollEl = null
})
</script>

<template>
	<Flex direction="column" :class="$style.page">
		<Flex ref="wrapperRef" direction="column" :class="$style.wrapper">
			<SubPageHeader :backTo="backTo">
				<template #title>
					<span :class="[$style.collapsing_label, !heroVisible && $style.collapsing_label_visible]">
						{{ type === "recovery" ? "Recover Profile" : "Import Profile" }}
					</span>
				</template>
			</SubPageHeader>

			<div :class="$style.content">
				<!-- Hero -->
				<div :class="$style.hero">
					<div :class="$style.title_stack">
						<span :class="$style.title_main">{{ type === "recovery" ? "Recover" : "Import" }}</span>
						<span :class="$style.title_sub">Profile</span>
					</div>
					<div :class="$style.hero_bar" />
				</div>

				<div :class="$style.name_section">
					<span :class="$style.section_label">Profile name</span>
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
							data-testid="import-name-input"
							@input="handleNameInput"
						/>
					</div>
					<Text v-if="nameError" size="12" color="red" height="150" role="alert">
						{{ nameError }}
					</Text>
				</div>

				<ImportMethodPicker
					v-if="!selectedImportOption"
					:type="type"
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
			</div>
		</Flex>

		<div v-if="selectedImportOption" :class="$style.bottom">
			<Flex direction="column" gap="8">
				<!-- Full backup CTAs -->
				<template v-if="selectedImportOption === 'full_backup'">
					<Button
						v-if="selectedBackup?.type === 'encrypted' && !selectedBackup?.profileType"
						@click="decryptBackup"
						:disabled="!decryptionPassword"
						data-testid="import-full-backup-decrypt-btn"
						variant="cta"
					>
						Decrypt Backup
					</Button>
					<Button
						v-if="selectedBackup?.profileType && restoreStatus !== 'finished'"
						@click="restoreBackup"
						:disabled="!isAllowedToImportBackup || restoreStatus === 'failed' || restoreStatus === 'progress'"
						data-testid="import-full-backup-submit-btn"
						variant="cta"
					>
						{{ restoreStatus === "progress" ? "Importing…" : `Import ${selectedBackup?.backup?.data?.profile?.name ?? "Profile"}` }}
					</Button>
					<!--
					Finishing window: restore finished cleanly but `completeImport` is
					awaiting the SW handshake (`waitForProfileActive`). Without this
					branch the user would see a button-less form for ~1s.
					-->
					<Button
						v-if="restoreStatus === 'finished' && !isRestoreHasErrors"
						:loading="true"
						:disabled="true"
						variant="cta"
					>
						Finishing import…
					</Button>
					<Button
						v-if="restoreStatus === 'finished' && isRestoreHasErrors"
						@click="completeImport(importedProfile)"
						variant="cta"
					>
						Continue
					</Button>
					<Button
						v-if="restoreStatus === 'finished' && isRestoreHasErrors"
						@click="showRestoreErrorLog"
						variant="cta_outline"
					>
						View Errors
					</Button>
				</template>

				<!-- Seed / key CTAs -->
				<Button
					v-if="selectedImportOption === 'seed'"
					@click="handleImportSeed"
					data-testid="import-seed-submit-btn"
					:disabled="!isAllowedToImportBySeedPhrase"
					variant="cta"
				>
					Use Seed Phrase
				</Button>
				<Button
					v-if="selectedImportOption === 'private_key'"
					@click="handleImportPrivateKey"
					data-testid="import-private-key-submit-btn"
					:disabled="!isAllowedToImportByPrivateKey"
					variant="cta"
				>
					Use Plain Key
				</Button>
				<Button
					v-if="selectedImportOption === 'public_key'"
					@click="handleImportPublicKey"
					data-testid="import-public-key-submit-btn"
					:disabled="!isAllowedToImportByPublicKey"
					variant="cta"
				>
					Use Encrypted Key
				</Button>

				<Button @click="handleBack" :disabled="restoreStatus === 'progress'" variant="cta_outline">Back</Button>
			</Flex>
		</div>

		<!-- Path A: in-page passkey ceremony for import flow. -->
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
	display: flex;
	flex-direction: column;
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

.bottom {
	flex-shrink: 0;
	padding: 20px 24px;
	background: var(--app-bg);
	border-top: 1px solid var(--nulo-border);
}

.name_section {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-bottom: 12px;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	color: var(--nulo-secondary);
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
