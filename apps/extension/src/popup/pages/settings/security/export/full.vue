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
import { ACCOUNT_SERVICE_NAME, AccountServiceClient, IMPORTED_KEYS_SERVICE_NAME } from "@/wallet/services/account/client"
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
import { MAX_BACKUP_FILE_BYTES, assembleFullBackup } from "@/utils/full-backup-helpers"

/** Composables */
import { TOAST_DURATION, useToast } from "@/composables/toast.js"
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

// Sealed artifact strings, published only by a completed run — never a mutable
// draft object. `payloadPretty` is the plain download body, `payloadCompact`
// the encryption input (both derive from the SAME sealed snapshot inside
// `assembleFullBackup`, so the embedded checksum covers exactly these bytes).
let payloadPretty = null
let payloadCompact = null
let encryptedB64 = null

// Re-entry latch + currency fence (the export/account.vue idiom): `isBusy`
// closes synchronously before the first await so a double click / double
// Enter cannot start a second assembly; `generation` is bumped on unmount so
// a superseded run can neither publish state nor resurrect scrubbed secrets.
const isBusy = ref(false)
const isDownloading = ref(false)
let generation = 0
// The in-flight run's clients, for unmount teardown (per-run construction —
// see `buildBackupServices`).
let activeRunClients = null

// One bad disconnect must not block the remaining disconnects or the secret
// scrub that follows — teardown is best-effort per client, never throwing.
const disconnectAll = (clients) => {
	for (const { client } of clients) {
		try {
			client.disconnect()
		} catch (err) {
			console.error("[export/full] client disconnect failed:", err)
		}
	}
}

// Slice keys are the services' OWN name constants — the import path's slice
// registry rejects anything else. (Client instances expose no `name` field:
// the old `s.name?.replace("-client", "")` keying read `undefined` and
// silently collapsed every slice onto one bogus key.)
// Constructed PER RUN so two runs can never share a client and an aborted
// run's teardown cannot touch a later run's connections.
const buildBackupServices = () => {
	const importedKeysBackupClient = new AccountServiceClient()
	return [
		{ name: PROFILE_SERVICE_NAME, client: new ProfileServiceClient() },
		{ name: NETWORK_SERVICE_NAME, client: new NetworkServiceClient() },
		{ name: ACCOUNT_SERVICE_NAME, client: new AccountServiceClient() },
		// The imported-keys slice shares AccountService but has its OWN backup name/root — a thin
		// adapter routes `.backup()` to `backupImportedKeys()`.
		{
			name: IMPORTED_KEYS_SERVICE_NAME,
			client: {
				backup: () => importedKeysBackupClient.backupImportedKeys(),
				disconnect: () => importedKeysBackupClient.disconnect(),
			},
		},
		{ name: TRANSACTION_SERVICE_NAME, client: new TransactionServiceClient() },
		{ name: TOKEN_SERVICE_NAME, client: new TokenServiceClient() },
		{ name: TOKEN_BALANCE_SERVICE_NAME, client: new TokenBalanceServiceClient() },
		{ name: ACCOUNT_STATE_SERVICE_NAME, client: new AccountStateServiceClient() },
		{ name: AUTH_REGISTRY_SERVICE_NAME, client: new AuthRegistryServiceClient() },
		{ name: FPC_SERVICE_NAME, client: new FpcServiceClient() },
		{ name: CONTACT_SERVICE_NAME, client: new ContactServiceClient() },
		{ name: CONFIG_SERVICE_NAME, client: new ConfigServiceClient() },
	]
}
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
	// Re-entry latch: closes synchronously, BEFORE the ceremony/KDF awaits —
	// the empty-status window during PBKDF2 was where double-fires slipped in.
	if (isBusy.value) return
	isBusy.value = true
	const gen = generation
	backupStatus.value = "progress"
	let runClients = null
	try {
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
				if (gen !== generation) return
				backupStatus.value = ""
				// Silent cancel matches the rest of the wallet (auth.vue, profile/
				// new.vue, import.vue). Reset the agreement gate so the user can
				// re-confirm or back out without bouncing them off the page —
				// passkey export auto-fires on agree (no "Create Backup" CTA),
				// so without this reset they'd be stuck on a dead form.
				if (err instanceof UserRejectedError) {
					isAgreed.value = false
					return
				}
				// User-facing copy stays generic; the underlying error goes to the console so a failed
				// export is diagnosable (this catch and the exportPlain one below are otherwise
				// indistinguishable — same toast, same navigation).
				console.error("[export/full] passkey credential acquisition failed:", err)
				openToast({ label: "Failed to authenticate by passkey", icon: "warning" }, TOAST_DURATION.LONG)
				router.go(-1)
				return
			}
			if (gen !== generation) return
		}

		let entropyB64
		let dekB64
		let dekSealedB64
		try {
			if (isPasskeyProfile.value) {
				// Passkey blobs carry the credentialId as `master-key` and NEVER an entropy field —
				// the master re-derives from the passkey PRF at restore. The imported-keys DEK travels
				// as the SEALED row blob verbatim (the restore ceremony's wrap key opens it).
				key = await managers.profile.exportPlain(appStore.profile.id, password.value, credentialData)
				dekSealedB64 = await managers.profile.getProfileDekSealed(appStore.profile.id)
			} else {
				// Atomic discriminated export: master + recovery-phrase entropy + imported-keys DEK
				// from ONE authenticated pass, so the backup fields can never come from different
				// row states.
				const material = await managers.profile.exportBackupMaterial(appStore.profile.id, password.value)
				key = material.masterKey
				entropyB64 = material.entropy
				dekB64 = material.importedKeysDek
			}
		} catch (error) {
			if (gen !== generation) return
			backupStatus.value = ""
			if (!isPasskeyProfile.value) {
				isWrongPassword.value = true
			} else {
				// See the acquisition catch above — stage-tagged so the two failure points are
				// distinguishable in the console while the user-facing copy stays generic.
				console.error("[export/full] passkey exportPlain failed:", error)
				openToast({ label: "Failed to authenticate by passkey", icon: "warning" }, TOAST_DURATION.LONG)
				router.go(-1)
			}
			return
		}
		if (gen !== generation) return

		// Two orthogonal version fields replace the legacy conflated
		// `schema-version: 2`: the NON-migratable account-contract epoch and the
		// MIGRATABLE storage schema version the import path migrates forward from.
		// Constants are single-sourced with the import gates. `data` and
		// `checksum` are the assembler's to add — in that order, so the sealed
		// key order matches what the import side re-serializes.
		const envelope = {
			"wallet-version": version,
			"aztec-version": aztecVersion,
			[COMPAT_EPOCH_FIELD]: CURRENT_COMPAT_EPOCH,
			[BACKUP_SCHEMA_VERSION_FIELD]: CURRENT_BACKUP_SCHEMA_VERSION,
			"master-key": key,
			// Password blobs REQUIRE this; passkey blobs must NOT carry it (`undefined` is dropped
			// by JSON.stringify). Restore verifies PBKDF2(words(entropy)) == master-key before
			// sealing either.
			entropy: entropyB64,
			// Imported-keys DEK carriers (epoch-4 REQUIRED, per profile type; the other stays
			// undefined → dropped): plaintext beside the plaintext master for password blobs — the
			// same trust envelope — and the sealed row blob for passkey blobs. Restore feeds it
			// ONLY into the rewrap context (the restored row mints a FRESH dek — clone divergence).
			"imported-keys-dek": dekB64,
			"imported-keys-dek-sealed": dekSealedB64,
			// Item 1b: preserve the user's ACTIVE-network selection (a top-level raw network id, like
			// `master-key` — NOT a slice). Restore resolves it against the restored rows; absent (older
			// backups / no active network) → the import falls back to the primary network. `undefined`
			// is dropped by JSON.stringify, so the field is simply absent when there's no active network.
			"active-network-id": appStore.network?.id,
		}

		runClients = buildBackupServices()
		activeRunClients = runClients
		const sources = runClients.map(({ name, client }) => ({ name, backup: () => client.backup() }))
		const result = await assembleFullBackup(envelope, sources, () => gen === generation)
		if (gen !== generation) return

		// Export-side half of the shared size invariant: never ship a file the
		// import gate would reject — fail loud here instead of silently at
		// restore time.
		if (result.pretty.length > MAX_BACKUP_FILE_BYTES) {
			backupStatus.value = ""
			if (isPasskeyProfile.value) isAgreed.value = false
			openToast({ label: "Backup is too large to create", icon: "warning" }, TOAST_DURATION.LONG)
			return
		}

		payloadCompact = result.compact
		payloadPretty = result.pretty
		backupStatus.value = "finished"
		showRecommendation.value = true
	} catch (err) {
		// A superseded run (unmount bumped the fence, or the assembler's probe
		// aborted) stays silent — the page that could show the error is gone.
		if (gen !== generation) return
		backupStatus.value = ""
		if (isPasskeyProfile.value) isAgreed.value = false
		console.error("[export/full] backup assembly failed:", err)
		openToast({ label: "Failed to create the backup", icon: "warning" }, TOAST_DURATION.LONG)
	} finally {
		if (runClients) {
			disconnectAll(runClients)
			if (activeRunClients === runClients) activeRunClients = null
		}
		if (gen === generation) isBusy.value = false
	}
}

async function handleEncrypt() {
	// Same latch + fence discipline as creation: `isBusy` blocks a double
	// start before Vue re-renders the disabled CTA; the fence suppresses any
	// stale success/error write after unmount scrubbed the payloads.
	if (isBusy.value) return
	if (isPasskeyProfile.value) {
		showRecommendation.value = false
		if (!password.value) return
		if (password.value !== repeatedPassword.value) {
			isPasswordMismatch.value = true
			return
		}
	}
	isBusy.value = true
	const gen = generation
	const plaintext = payloadCompact

	backupStatus.value = "encrypting"
	showRecommendation.value = false

	try {
		const passhash = await EncryptionKey.getPasshash(password.value)
		const key = await EncryptionKey.fromPasshash(passhash)
		const sealed = Buffer(await key.encrypt(new TextEncoder().encode(plaintext))).toString("base64")
		if (gen !== generation) return
		// Encrypted-side half of the shared size invariant (base64 + AES-GCM
		// overhead could in principle cross the line a plain file sits under).
		if (sealed.length > MAX_BACKUP_FILE_BYTES) {
			backupStatus.value = "finished"
			openToast({ label: "Backup is too large to create", icon: "warning" }, TOAST_DURATION.LONG)
			return
		}
		encryptedB64 = sealed
		backupStatus.value = "encrypted"
	} catch (error) {
		if (gen !== generation) return
		console.error("Failed to encrypt the backup", error)
		openToast({ label: "Failed to encrypt the backup", icon: "warning" }, TOAST_DURATION.LONG)
		backupStatus.value = "finished"
	} finally {
		if (gen === generation) isBusy.value = false
	}
}

async function handleDownloadBackup() {
	if (isDownloading.value) return
	isDownloading.value = true
	const gen = generation
	const isEncrypted = backupStatus.value === "encrypted"
	let filename = `_${appStore.profile.name.replace(" ", "_")}_${Math.floor(Date.now() / 1000)}`
	filename = isEncrypted ? `NuloEncryptedBackup${filename}.txt` : `NuloBackup${filename}.json`
	const fileContent = isEncrypted ? encryptedB64 : payloadPretty

	try {
		await downloadFile({ data: fileContent, filename, compressionFormat: "gzip" })
		if (gen !== generation) return
		openToast({ label: "Backup downloaded successfully", icon: "download" })
	} catch (err) {
		if (gen !== generation) return
		console.error("Download failed:", err.message || err)
		openToast({ label: "Failed to download backup", icon: "warning" }, TOAST_DURATION.LONG)
	} finally {
		if (gen === generation) isDownloading.value = false
	}
}

const onKeydown = (e) => {
	if (!isAgreed.value) return
	if (e.key !== "Enter") return
	switch (backupStatus.value) {
		case "":
			handleBackup()
			break
		case "finished":
			handleEncrypt()
			break
		case "encrypted":
			handleDownloadBackup()
			break
		default:
			// "progress" / "encrypting": a run is in flight — Enter is a no-op.
			// (The old catch-all default re-invoked handleBackup here, which was
			// the double-assembly vector; the handler latches too, as a belt.)
			break
	}
}

onMounted(() => {
	document.addEventListener("keydown", onKeydown)
})
onBeforeUnmount(() => {
	// Fence first so no in-flight continuation can publish or resurrect state;
	// then services (cleanup-order rule), then the secret scrub — the payload
	// strings hold the plaintext master/entropy/DEK and must not outlive the
	// page (best-effort: references cleared; in-flight closures die with the
	// aborted run).
	generation++
	if (activeRunClients) {
		disconnectAll(activeRunClients)
		activeRunClients = null
	}
	payloadPretty = null
	payloadCompact = null
	encryptedB64 = null
	password.value = null
	repeatedPassword.value = null
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
				:disabled="!password || isWrongPassword || isBusy"
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
					:disabled="!backupStatus || backupStatus === 'progress' || backupStatus === 'encrypting' || isDownloading"
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
