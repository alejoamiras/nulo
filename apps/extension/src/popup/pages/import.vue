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
/** Composables */
import { completeImportWithRecovery } from "@/composables/completeImportWithRecovery"
import { useProfileBootstrap } from "@/composables/useProfileBootstrap"
import { useProfileImportFlow } from "@/composables/useProfileImportFlow"
import { useToast } from "@/composables/toast"
import { waitForProfileActive } from "@/composables/waitForProfileActive"

/** Services */
import { setSentinel } from "@/utils/core"

/** Utils */
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { redirectToOnboardingTabIfNeeded } from "@/wallet/utils/onboarding-tab"
import { resolveFullBackupEnterAction } from "./import-helpers"

/** Stores */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { useNotificationStore } from "@/stores/notification.store"
import { usePopupStore } from "@/stores/popup.store"

/** Components */
import ImportFullBackupForm from "@/components/composite/import/ImportFullBackupForm.vue"
import ImportMethodPicker from "@/components/composite/import/ImportMethodPicker.vue"
import ImportSecretForm from "@/components/composite/import/ImportSecretForm.vue"
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

const appStore = useAppStore()
const notificationStore = useNotificationStore()
const { openToast } = useToast()

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

// Popup activation is listener-based: profile activation in the SW fires
// `popup/app.vue`'s `onActiveProfileChanged`, which runs the bootstrap and flips
// `appStore.isLogined`. completeImport waits for that ONE bootstrapper (up to the
// 30s backstop — long enough for a legitimately slow bootstrap on a loaded runner).
// The wedge (P0-proven): an MV3 worker restart mid-import kills the in-process emit,
// so the listener never fires and the wait used to dead-end on a silent "Finishing…"
// screen, then blindly route to /popup/auth. The fix is recovery-on-timeout: once the
// wait times out the listener has genuinely given up (so there is no bootstrap left to
// race), and we re-run the SAME recovery a fresh popup would — `hydrateKnownProfile`
// wakes the SW via getActiveProfile() and bootstraps. A surviving session now lands on
// /popup/general instead of a forced re-auth; a genuinely-locked profile (strict mode +
// worker restart dropped the master) routes to /popup/auth to unlock. No dead-end.
// (An earlier attempt watched the SW connection to escape sub-timeout, but a transient
// reconnect is indistinguishable from the wedge at drop-time and racing the live
// listener regressed the healthy path — the timeout is the only race-free signal.)
const { hydrateKnownProfile } = useProfileBootstrap()
const completeImport = async (profile) => {
	await setLastActiveProfileId(profile.id)
	await setSentinel()
	const outcome = await completeImportWithRecovery({
		waitForActive: (ms) => waitForProfileActive(appStore, profile.id, ms),
		recover: async () => (await hydrateKnownProfile())?.id === profile.id && appStore.isLogined,
		timeoutMs: 30_000,
	})
	if (outcome === "active") {
		openToast({ label: "Profile imported", icon: "check-circle" })
		router.push("/popup/general")
	} else {
		openToast({ label: "Profile imported — unlock to continue", icon: "info" }, TOAST_DURATION.LONG)
		router.push("/popup/auth")
	}
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
	privateKey,
	publicKey,
	password,
	repeatedPassword,
	maxPasswordLength,
	error,
	isCopied,
	isAllowedToImportBySeedPhrase,
	isAllowedToImportByPrivateKey,
	isAllowedToImportByPublicKey,
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
	handleImportPrivateKey,
	handleImportPublicKey,
	handleImportPasskey,
	handlePasswordInput,
	handleSecretInput,
	handleCopyError,
	handleBack,
	dispose,
} = useProfileImportFlow({
	completeImport,
	// Popup error-log surface: open the data-viewer overlay.
	showErrorLog: (errors) => {
		const cacheStore = useCacheStore()
		const popupStore = usePopupStore()
		cacheStore.viewerData = errors
		popupStore.open("data_viewer")
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

/** Listeners — popup-only full-backup Enter shortcut. */
const onKeydown = (e) => {
	if (e.key !== "Enter") return
	const action = resolveFullBackupEnterAction({
		selectedBackup: selectedBackup.value,
		restoreStatus: restoreStatus.value,
		isRestoreHasErrors: isRestoreHasErrors.value,
	})
	if (action === "decrypt") decryptBackup()
	else if (action === "restore") restoreBackup()
	else if (action === "continue") completeImport(importedProfile.value)
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
	dispose()
	document.removeEventListener("keydown", onKeydown)
	scrollEl?.removeEventListener("scroll", handleScroll)
	scrollEl = null
})
</script>

<template>
	<Flex direction="column" :class="$style.page" :data-restore-stage="restoreStage">
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
						data-testid="import-full-backup-continue-btn"
						variant="cta"
					>
						Continue
					</Button>
					<Button
						v-if="restoreStatus === 'finished' && isRestoreHasErrors"
						@click="showRestoreErrorLog"
						data-testid="import-full-backup-view-errors-btn"
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
