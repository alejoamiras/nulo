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
import SecretRevealCard from "@/components/composite/SecretRevealCard.vue"
import SecretCountdownClose from "@/components/composite/SecretCountdownClose.vue"
import SecretUnlockSection from "@/components/composite/SecretUnlockSection.vue"

/** Services */
import { managers } from "@/utils/core"

/** Composables */
import { useToast } from "@/composables/toast.js"
import { useSecretCountdown } from "@/composables/useSecretCountdown"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

const backupHelpUrl = "https://nulo.sh/help/wallet-setup/backup-methods"
const AUTO_CLOSE_MS = 60_000 * 2

const isStarted = ref(false)
const isUnlocked = ref(false)
const password = ref()
const isWrongPassword = ref(false)

const publicKey = ref()
const privateKey = ref()
const selectedKey = ref()

const handleClose = () => {
	privateKey.value = null
	publicKey.value = null
	router.push("/popup/settings/security/export")
}

const countdown = useSecretCountdown({ autoCloseMs: AUTO_CLOSE_MS, onTimeout: handleClose })

watch(
	() => selectedKey.value,
	async () => {
		if (selectedKey.value === "public") {
			try {
				publicKey.value = await managers.profile.exportEncrypted(appStore.profile.id)
			} catch (error) {}
		}
	},
)

const handleUnlock = async () => {
	if (!password.value) return

	try {
		privateKey.value = await managers.profile.exportPlain(appStore.profile.id, password.value)
		password.value = null
		isUnlocked.value = true
		countdown.start()
	} catch (error) {
		isWrongPassword.value = true
	}
}

// F-14: best-effort clipboard scrub a while after copy. Extension popups may
// deny clipboard writes without a transient user gesture, so this is a bonus
// layer — the on-page warning is the reliable mitigation. We deliberately do
// NOT add a clipboardRead permission (it would only widen the wallet's
// clipboard-read surface); the scrub is therefore unconditional, not
// equals-checked.
const CLIPBOARD_CLEAR_MS = 60_000
let clipboardClearTimer
const isCopied = ref(false)
const handleCopy = (key) => {
	isCopied.value = true
	window.navigator.clipboard.writeText(key === "private" ? privateKey.value : publicKey.value)
	openToast({ label: "Key is copied", icon: "copy" })
	clearTimeout(clipboardClearTimer)
	clipboardClearTimer = setTimeout(() => {
		void window.navigator.clipboard.writeText("").catch(() => {})
	}, CLIPBOARD_CLEAR_MS)
	setTimeout(() => {
		isCopied.value = false
	}, 2500)
}

const onKeydown = (e) => {
	if (e.key === "Enter") handleUnlock()
}

watch(
	() => isStarted.value,
	() => {
		if (isStarted.value && selectedKey.value === "private") document.addEventListener("keydown", onKeydown)
	},
)

onBeforeUnmount(() => {
	clearTimeout(clipboardClearTimer)
	privateKey.value = null
	publicKey.value = null
	document.removeEventListener("keydown", onKeydown)
})

const collapsingLabel = computed(() => {
	if (!selectedKey.value) return "Secret Key"
	if (selectedKey.value === "private") return "Plain Key"
	return "Encrypted Key"
})

const heroMain = computed(() => {
	if (!selectedKey.value) return "Secret"
	if (selectedKey.value === "private") return "Plain"
	return "Encrypted"
})
</script>

<template>
	<SecretExportLayout
		:heroMain="heroMain"
		heroSub="Key"
		:collapsingLabel="collapsingLabel"
		backTo="/popup/settings/security/export"
	>
		<!-- Variant picker -->
		<template v-if="!selectedKey">
			<div class="export_section_last">
				<span class="export_section_label">Select type</span>
				<ItemsContainer flat>
					<SettingItem
						@click="selectedKey = 'public'"
						size="large"
						title="Encrypted"
						description="Password is required to use"
						icon="lock"
						chevron
						data-testid="key-variant-encrypted-btn"
					/>
					<SettingItem
						@click="selectedKey = 'private'"
						size="large"
						title="Plain"
						description="Password is required to receive"
						icon="eye"
						chevron
						data-testid="key-variant-plain-btn"
					/>
				</ItemsContainer>
			</div>
		</template>

		<!-- Private / Plain key flow -->
		<template v-if="selectedKey === 'private'">
			<template v-if="!isStarted">
				<div class="export_section_last">
					<span class="export_section_label">Before you continue</span>
					<Flex direction="column" gap="8">
						<Text size="13" height="150" color="body">
							Plain key is direct and full access to your entire profile, once you lose it you will not
							be able to regain access to your profile.
						</Text>
						<Text size="13" height="150" color="body">
							Ensure that plain key is securely stored.
						</Text>
						<Text size="13" height="150" color="body">
							By continuing you agree to all risks and responsibilities.
						</Text>
					</Flex>
					<a
						:href="backupHelpUrl"
						target="_blank"
						rel="noopener noreferrer"
						class="export_learn_link"
					>
						Read more about backups
					</a>
				</div>
			</template>
			<SecretUnlockSection
				v-else-if="isStarted && !isUnlocked"
				v-model="password"
				:error="isWrongPassword"
				@clearError="isWrongPassword = false"
			/>
			<template v-else>
				<div class="export_section">
					<span class="export_section_label">Your plain key</span>
					<SecretRevealCard
						:value="privateKey"
						label="Plain Key"
						testId="reveal-content"
						:isCopied="isCopied"
						@copy="handleCopy('private')"
					/>
				</div>

				<div class="export_section_last">
					<Flex direction="column" gap="10">
						<Flex gap="8">
							<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
							<Text size="12" weight="500" height="150" color="tertiary">
								Some applications on your PC can have access to your clipboard and read a private key
							</Text>
						</Flex>
						<Text size="12" weight="500" height="150" color="tertiary">
							Recovery with this key is instant, without a password
						</Text>
					</Flex>
				</div>
			</template>
		</template>

		<!-- Public / Encrypted key flow -->
		<template v-if="selectedKey === 'public'">
			<div class="export_section">
				<span class="export_section_label">Your encrypted key</span>
				<SecretRevealCard
					:value="publicKey"
					label="Encrypted Key"
					testId="reveal-content"
					:isCopied="isCopied"
					@copy="handleCopy('public')"
				/>
			</div>

			<div class="export_section_last">
				<Text size="12" weight="500" height="150" color="tertiary">
					To use this key to restore your profile - you will need to enter your current password
				</Text>
			</div>
		</template>

		<!-- Bottom CTA -->
		<template #bottom>
			<Button
				v-if="selectedKey === 'private' && !isStarted"
				@click="isStarted = true"
				variant="cta"
				data-testid="agree-continue-btn"
			>
				Agree &amp; Continue
			</Button>

			<Button
				v-else-if="selectedKey === 'private' && isStarted && !isUnlocked"
				@click="handleUnlock"
				:disabled="!password"
				variant="cta"
				data-testid="unlock-submit-btn"
			>
				Retrieve Secret Key
			</Button>

			<SecretCountdownClose
				v-else-if="selectedKey === 'private' && isUnlocked"
				:countdownLabel="countdown.countdownLabel.value"
				:autoCloseDisabled="countdown.isAutoCloseDisabled.value"
				:progressDurationMs="AUTO_CLOSE_MS"
				@close="handleClose"
				@disableAutoClose="countdown.disable"
			/>

			<Button
				v-else-if="selectedKey === 'public'"
				@click="handleClose"
				variant="cta_outline"
				data-testid="close-btn"
			>
				Close
			</Button>
		</template>
	</SecretExportLayout>
</template>
