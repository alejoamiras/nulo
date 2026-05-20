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

/** Composables */
import { useToast } from "@/composables/toast"
import { useFullBackupImport } from "@/composables/useFullBackupImport"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { waitForProfileActive } from "@/composables/waitForProfileActive"

/** Stores */
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"

/** Components */
import ImportFullBackupForm from "@/components/composite/import/ImportFullBackupForm.vue"
import ImportMethodPicker from "@/components/composite/import/ImportMethodPicker.vue"
import ImportSecretForm from "@/components/composite/import/ImportSecretForm.vue"
import PasskeyCeremonyDialog from "@/popup/components/popups/PasskeyCeremonyDialog.vue"

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
// no profile exists AND onboarding hasn't been completed. Add-another-
// profile case (profiles.length > 0) keeps using the popup flow normally.
onBeforeMount(async () => {
	await appStore.loadOnboardingCompleted()
	if (appStore.onboardingCompleted) return
	if (appStore.profiles.length > 0) return
	const { openOrFocusOnboardingTab } = await import("@/wallet/utils/onboarding-tab")
	await openOrFocusOnboardingTab()
	window.close()
})

/** Reactive state */
const selectedImportOption = ref(null)

const seedPhrase = ref()
const privateKey = ref()
const publicKey = ref()

const profileName = ref("My Profile")

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

const isAllowedToContinue = computed(() => {
	if (!profileName.value || profileName.value.length < 2) return false
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
	if (!isAllowedToImportBySeedPhrase.value) return
	try {
		const profile = await managers.profile.importMnemonic(profileName.value.trim(), seedPhrase.value.split(" "), password.value)
		await completeImport(profile)
	} catch (err) {
		fillError("unknown", err)
	}
}

const handleImportPrivateKey = async () => {
	if (!isAllowedToImportByPrivateKey.value) return
	try {
		const profile = await managers.profile.importPlain(profileName.value.trim(), privateKey.value, password.value)
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
	}
}

const handleImportPublicKey = async () => {
	if (!isAllowedToImportByPublicKey.value) return
	try {
		const profile = await managers.profile.importEncrypted(profileName.value.trim(), publicKey.value, password.value)
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
	}
}

// Path A: in-page passkey ceremony for import flow.
const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

const handleImportPasskey = async () => {
	try {
		// Discovery `get` — no allowedCredentials; user picks from their
		// available passkeys.
		const credData = await runCeremony({ mode: "get" })
		const profile = await managers.profile.importPasskey(profileName.value.trim(), credData)
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
	// Popup-specific error-log surface: open the data-viewer overlay.
	showErrorLog: (errors) => {
		const cacheStore = useCacheStore()
		const popupStore = usePopupStore()
		cacheStore.viewerData = errors
		popupStore.open("data_viewer")
	},
})

function clearFormState() {
	selectedImportOption.value = null
	profileName.value = ""
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
	const profiles = await managers.profile.getProfiles()
	profileName.value = `My Profile${profiles?.length ? ` ${profiles.length}` : ""}`
	document.addEventListener("keydown", onKeydown)
	await nextTick()
	scrollEl = wrapperRef.value?.wrapper
	if (!scrollEl) return
	scrollEl.addEventListener("scroll", handleScroll, { passive: true })
	handleScroll()
})

onBeforeUnmount(() => {
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
</style>
