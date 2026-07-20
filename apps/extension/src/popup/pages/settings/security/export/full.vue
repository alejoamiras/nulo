<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"hideHeader": true,
		"showBottomNav": false
	}
}
</route>

<script setup>
/** Components */
import SecretExportLayout from "@/components/composite/SecretExportLayout.vue"
import SecretUnlockSection from "@/components/composite/SecretUnlockSection.vue"
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

/** Services */
import { managers } from "@/utils/core"
import { ACCOUNT_SERVICE_NAME, AccountServiceClient } from "@/wallet/services/account/client"
import { ACCOUNT_STATE_SERVICE_NAME, AccountStateServiceClient } from "@/wallet/services/account-state/client"
import { AUTH_REGISTRY_SERVICE_NAME, AuthRegistryServiceClient } from "@/wallet/services/auth-registry/client"
import { CONFIG_SERVICE_NAME, ConfigServiceClient } from "@/wallet/services/config/client"
import { CONTACT_SERVICE_NAME, ContactServiceClient } from "@/wallet/services/contact/client"
import { FPC_SERVICE_NAME, FpcServiceClient } from "@/wallet/services/fpc/client"
import { NETWORK_SERVICE_NAME, NetworkServiceClient } from "@/wallet/services/network/client"
import { PROFILE_SERVICE_NAME, ProfileServiceClient } from "@/wallet/services/profile/client"
import { TOKEN_SERVICE_NAME, TokenServiceClient } from "@/wallet/services/token/client"
import { TOKEN_BALANCE_SERVICE_NAME, TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import { TRANSACTION_SERVICE_NAME, TransactionServiceClient } from "@/wallet/services/transaction/client"
import { BACKUP_SCHEMA_VERSION_FIELD, COMPAT_EPOCH_FIELD, CURRENT_COMPAT_EPOCH } from "@/wallet/services/backup/backup-migration-registry"
import { CURRENT_BACKUP_SCHEMA_VERSION } from "@/wallet/services/backup/backup-migrator"
import { EncryptionKey } from "@nulo/wallet-crypto"

/** Errors */
import { UserRejectedError } from "@nulo/extension-messaging/errors"

/** Utils */
import { downloadFile } from "@/utils"

/** Composables */
import { useToast } from "@/composables/toast.js"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
const { openToast } = useToast()

// Path A passkey ceremony — replaces the prior SW-driven popup window for
// passkey profile backup-export. Mounted as `<PasskeyCeremonyDialog>` in
// the template; driven imperatively from `handleBackup` below.
const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

const backupHelpUrl = "https://nulo.sh/help/wallet-setup/backup-methods"

let backup = {}
// Slice keys are the services' OWN name constants — the import path's slice
// registry rejects anything else. (Client instances expose no `name` field:
// the old `s.name?.replace("-client", "")` keying read `undefined` and
// silently collapsed every slice onto one bogus key.)
const backupServices = [
	{ name: PROFILE_SERVICE_NAME, client: new ProfileServiceClient() },
	{ name: NETWORK_SERVICE_NAME, client: new NetworkServiceClient() },
	{ name: ACCOUNT_SERVICE_NAME, client: new AccountServiceClient() },
	{ name: TRANSACTION_SERVICE_NAME, client: new TransactionServiceClient() },
	{ name: TOKEN_SERVICE_NAME, client: new TokenServiceClient() },
	{ name: TOKEN_BALANCE_SERVICE_NAME, client: new TokenBalanceServiceClient() },
	{ name: ACCOUNT_STATE_SERVICE_NAME, client: new AccountStateServiceClient() },
	{ name: AUTH_REGISTRY_SERVICE_NAME, client: new AuthRegistryServiceClient() },
	{ name: FPC_SERVICE_NAME, client: new FpcServiceClient() },
	{ name: CONTACT_SERVICE_NAME, client: new ContactServiceClient() },
	{ name: CONFIG_SERVICE_NAME, client: new ConfigServiceClient() },
]
const version = __VERSION__
const aztecVersion = __AZTEC_VERSION__

const isPasskeyProfile = computed(() => appStore.profile.type === "passkey")
const password = ref()
const repeatedPassword = ref()
const isWrongPassword = ref(false)
const isPasswordMismatch = ref(false)

const showRecommendation = ref(false)

const isAgreed = ref(false)
const handleAgree = () => {
	isAgreed.value = true
	if (isPasskeyProfile.value) handleBackup()
}

const backupStatus = ref("")

async function handleBackup() {
	let key = ""
	let credentialData
	if (isPasskeyProfile.value) {
		try {
			// Path A: collect the WebAuthn credential via the in-page modal
			// BEFORE calling the service. Targeted `get` against this profile's
			// stored credentialId so the OS prompt is bound to the right key.
			const credentialId = await managers.profile.getPasskeyCredentialId(appStore.profile.id)
			credentialData = await runCeremony({ mode: "get", credentialId })
		} catch (err) {
			// Silent cancel matches the rest of the wallet (auth.vue, profile/
			// new.vue, import.vue). Reset the agreement gate so the user can
			// re-confirm or back out without bouncing them off the page —
			// passkey export auto-fires on agree (no "Create Backup" CTA),
			// so without this reset they'd be stuck on a dead form.
			if (err instanceof UserRejectedError) {
				isAgreed.value = false
				return
			}
			openToast({ label: "Failed to authenticate by passkey", icon: "warning" }, TOAST_DURATION.LONG)
			router.go(-1)
			return
		}
	}

	try {
		key = await managers.profile.exportPlain(appStore.profile.id, password.value, credentialData)
	} catch (error) {
		if (!isPasskeyProfile.value) {
			isWrongPassword.value = true
		} else {
			openToast({ label: "Failed to authenticate by passkey", icon: "warning" }, TOAST_DURATION.LONG)
			router.go(-1)
		}
		return
	}

	backupStatus.value = "progress"
	// Two orthogonal version fields replace the legacy conflated
	// `schema-version: 2`: the NON-migratable account-contract epoch and the
	// MIGRATABLE storage schema version the import path migrates forward from.
	// Constants are single-sourced with the import gates.
	backup = {
		"wallet-version": version,
		"aztec-version": aztecVersion,
		[COMPAT_EPOCH_FIELD]: CURRENT_COMPAT_EPOCH,
		[BACKUP_SCHEMA_VERSION_FIELD]: CURRENT_BACKUP_SCHEMA_VERSION,
		"master-key": key,
		data: {},
	}

	for (const { name, client } of backupServices) {
		const data = await client.backup()
		client.disconnect()
		if (data === null || data === undefined) continue
		backup.data[name] = data
	}

	backup.checksum = await EncryptionKey.getHashHex(JSON.stringify(backup))
	backupStatus.value = "finished"
	showRecommendation.value = true
}

async function handleEncrypt() {
	if (isPasskeyProfile.value) {
		showRecommendation.value = false
		if (!password.value) return
		if (password.value !== repeatedPassword.value) {
			isPasswordMismatch.value = true
			return
		}
	}

	backupStatus.value = "encrypting"
	showRecommendation.value = false

	try {
		const passhash = await EncryptionKey.getPasshash(password.value)
		const key = await EncryptionKey.fromPasshash(passhash)
		backup = Buffer(await key.encrypt(new TextEncoder().encode(JSON.stringify(backup)))).toString("base64")
		backupStatus.value = "encrypted"
	} catch (error) {
		console.error("Failed to encrypt the backup", error)
		openToast({ label: "Failed to encrypt the backup", icon: "warning" }, TOAST_DURATION.LONG)
		backupStatus.value = "finished"
	}
}

async function handleDownloadBackup() {
	const isEncrypted = backupStatus.value === "encrypted"
	let filename = `_${appStore.profile.name.replace(" ", "_")}_${Math.floor(Date.now() / 1000)}`
	filename = isEncrypted ? `NuloEncryptedBackup${filename}.txt` : `NuloBackup${filename}.json`
	const fileContent = isEncrypted ? backup : JSON.stringify(backup, null, 2)

	try {
		await downloadFile({ data: fileContent, filename, compressionFormat: "gzip" })
		openToast({ label: "Backup downloaded successfully", icon: "download" })
	} catch (err) {
		console.error("Download failed:", err.message || err)
		openToast({ label: "Failed to download backup", icon: "warning" }, TOAST_DURATION.LONG)
	}
}

const onKeydown = (e) => {
	if (!isAgreed.value) return
	if (e.key !== "Enter") return
	switch (backupStatus.value) {
		case "finished":
			handleEncrypt()
			break
		case "encrypted":
			handleDownloadBackup()
			break
		default:
			handleBackup()
			break
	}
}

onMounted(() => {
	document.addEventListener("keydown", onKeydown)
})
onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
})
</script>

<template>
	<SecretExportLayout
		heroMain="Full"
		heroSub="Backup"
		collapsingLabel="Full Backup"
		backTo="/popup/settings/security/export"
	>
		<!-- Agreement gate -->
		<template v-if="!isAgreed">
			<div class="export_section_last">
				<span class="export_section_label">Before you continue</span>
				<Flex direction="column" gap="8">
					<Text size="13" height="150" color="body">
						Backup provides direct, unrestricted access to your entire profile.
					</Text>
					<Text size="13" height="150" color="body">
						Ensure that your backup is stored securely and never shared with anyone.
					</Text>
					<Text size="13" height="150" color="body">
						By continuing you agree to all risks and responsibilities.
					</Text>
				</Flex>
				<a :href="backupHelpUrl" target="_blank" rel="noopener noreferrer" class="export_learn_link">
					Read more about backups
				</a>
			</div>
		</template>

		<!-- Password-profile unlock gate -->
		<template v-else-if="isAgreed">
			<SecretUnlockSection
				v-if="!isPasskeyProfile && !backupStatus"
				v-model="password"
				:error="isWrongPassword"
				@clearError="isWrongPassword = false"
			/>

			<!--
			Passkey-profile waiting state is now owned by the in-page modal
			(`PasskeyCeremonyDialog`, mounted below). No bespoke inline UI
			needed — the modal renders the spinner + "Waiting for passkey…"
			and dismisses itself when WebAuthn resolves.
			-->

			<template v-else-if="backupStatus">
				<!--
				Working states (progress = bundling the backup, encrypting =
				sealing it with a password). Previously this block rendered
				nothing while the button below ticked through "Creating
				Backup…" / "Encrypting…" — the page looked empty for ~1-3s.
				This inline status card mirrors the in-page-modal vibe
				without hijacking the screen (the modal is reserved for
				user-driven waits like the passkey ceremony).

				Wrapped in `export_section_last` so it participates in the
				page's existing 20px vertical rhythm (matches the agreement
				gate's section frame above).

				A11y: the wrapper is announced via `role="status"` +
				`aria-live="polite"` (same pattern as
				TransactionAwaitingCard.vue:37), the spinner is decorative
				(`aria-hidden`), and the heading is left as a plain span so
				the page's existing heading hierarchy isn't fractured
				(SecretExportLayout.vue:63 uses spans for the hero, no h1).
				-->
				<div
					v-if="backupStatus === 'progress' || backupStatus === 'encrypting'"
					class="export_section_last"
				>
					<div
						:class="$style.status_card"
						data-testid="backup-status-card"
						role="status"
						aria-live="polite"
						aria-atomic="true"
					>
						<Spinner size="28" color="--nulo-accent" aria-hidden="true" />
						<span :class="$style.status_title">
							{{ backupStatus === "encrypting" ? "Encrypting your backup" : "Creating your backup" }}
						</span>
						<p :class="$style.status_subtitle">
							{{
								backupStatus === "encrypting"
									? "Sealing the file with your password — only you can open it."
									: "Gathering your wallet data into your backup file."
							}}
						</p>
					</div>
				</div>

				<div v-else class="export_section">
					<span class="export_section_label">Backup</span>
					<Banner v-if="showRecommendation" variant="info" direction="vertical">
						<template #title> Backup is ready </template>
						<template #description>
							<Text height="140">
								You can download it right now, but we strongly recommend to encrypt it before downloading.
							</Text>
						</template>
					</Banner>

					<Banner v-if="backupStatus === 'encrypted'" variant="done" direction="vertical">
						<template #title> Backup is successfully encrypted </template>
						<template #description>
							<Text color="secondary" height="140">
								Don't forget your
								<Text v-if="!isPasskeyProfile" color="primary">profile</Text>
								password, as it will be required to restore your backup.
							</Text>
						</template>
					</Banner>
				</div>

				<!-- Encryption password fields (passkey profiles) -->
				<div
					v-if="!showRecommendation && isPasskeyProfile && backupStatus === 'finished'"
					class="export_section_last"
				>
					<span class="export_section_label">Encrypt with password</span>
					<Flex direction="column" gap="12">
						<div :class="[isPasswordMismatch && $style.shake]">
							<Input
								v-model="password"
								:error="isPasswordMismatch"
								:ariaInvalid="isPasswordMismatch"
								@click="isPasswordMismatch = false"
								@input="isPasswordMismatch = false"
								type="password"
								label="Password"
								placeholder="Enter password"
								autofocus
								:disabled="backupStatus === 'encrypting'"
								data-testid="backup-encrypt-password-input"
							/>
						</div>
						<Input
							v-model="repeatedPassword"
							:error="isPasswordMismatch"
							:ariaInvalid="isPasswordMismatch"
							@click="isPasswordMismatch = false"
							@input="isPasswordMismatch = false"
							type="password"
							placeholder="Repeat password"
							:disabled="backupStatus === 'encrypting'"
							data-testid="backup-encrypt-password-confirm-input"
						/>
						<Transition name="fade">
							<span
								v-if="isPasswordMismatch"
								:class="$style.error_text"
								role="alert"
								data-testid="backup-encrypt-error-text"
							>
								Passwords don't match
							</span>
						</Transition>
					</Flex>
				</div>
			</template>
		</template>

		<!-- Bottom CTAs -->
		<template #bottom>
			<Button v-if="!isAgreed" @click="handleAgree" variant="cta" data-testid="agree-continue-btn">
				Agree &amp; Continue
			</Button>

			<Button
				v-else-if="isAgreed && !isPasskeyProfile && !backupStatus"
				@click="handleBackup"
				:disabled="!password || isWrongPassword"
				variant="cta"
				data-testid="unlock-submit-btn"
			>
				Create Backup
			</Button>

			<Flex
				v-else-if="backupStatus"
				direction="column"
				gap="8"
			>
				<Button
					v-if="backupStatus === 'finished' || backupStatus === 'encrypting'"
					@click="handleEncrypt()"
					:disabled="backupStatus === 'encrypting'"
					variant="cta"
					data-testid="protect-password-btn"
				>
					{{ backupStatus === 'encrypting' ? 'Encrypting…' : 'Protect with Password' }}
				</Button>
				<Button
					@click="handleDownloadBackup"
					:disabled="!backupStatus || backupStatus === 'progress' || backupStatus === 'encrypting'"
					:variant="backupStatus !== 'encrypted' ? 'cta_outline' : 'cta'"
					data-testid="download-backup-btn"
				>
					{{ backupStatus === 'progress' ? 'Creating Backup…' : 'Download Backup' }}
				</Button>
			</Flex>
		</template>
	</SecretExportLayout>

	<!-- Path A: in-page passkey ceremony for backup-export. Mounts only
	     while a ceremony is in flight; emits resolve/reject back through
	     `usePasskeyCeremony`. Cancel resets `isAgreed` so the user can
	     re-confirm without bouncing off the page. -->
	<PasskeyCeremonyDialog
		v-if="ceremonyRequest"
		:request="ceremonyRequest"
		@resolve="onCeremonyResolve"
		@reject="onCeremonyReject"
	/>
</template>

<style module>
/* In-page status card for the working states (progress / encrypting).
   Visual language echoes PasskeyCeremonyDialog (centered, padded, light
   border, spinner + title + subtitle) so the wallet feels cohesive
   across waiting moments — but inline, not as a screen-blocking modal.

   Outer spacing intentionally NOT defined here — the `export_section_last`
   wrapper class supplies the page's standard 20px vertical rhythm. We
   only style the card interior (centered column, padded surface, border). */
.status_card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 14px;

	padding: 32px 24px;

	border: 1px solid var(--nulo-border);
	background: var(--nulo-surface-low);

	text-align: center;
}

.status_title {
	font-family: var(--font-headline);
	font-size: 16px;
	font-weight: 700;
	letter-spacing: -0.01em;
	color: var(--txt-primary);
}

.status_subtitle {
	font-family: var(--font-body);
	font-size: 13px;
	line-height: 1.5;
	color: var(--nulo-secondary);
	margin: 0;
	max-width: 280px;
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
</style>
