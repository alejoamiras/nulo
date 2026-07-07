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
const AUTO_CLOSE_MS = 60_000 * 5

const isStarted = ref(false)
const isUnlocked = ref(false)
const password = ref()
const isWrongPassword = ref(false)
const phrase = ref("Try harder")

const handleClose = () => {
	phrase.value = null
	router.push("/popup/settings/security/export")
}

const countdown = useSecretCountdown({ autoCloseMs: AUTO_CLOSE_MS, onTimeout: handleClose })

const handleStart = () => {
	isStarted.value = true
}

const handleUnlock = async () => {
	if (!password.value) return

	try {
		const mnemonic = await managers.profile.exportMnemonic(appStore.profile.id, password.value)
		phrase.value = mnemonic.join(" ")
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
const handleCopy = () => {
	isCopied.value = true
	window.navigator.clipboard.writeText(phrase.value)
	openToast({ label: "Seed phrase is copied", icon: "copy" })
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
		if (isStarted.value) document.addEventListener("keydown", onKeydown)
	},
)

onBeforeUnmount(() => {
	clearTimeout(clipboardClearTimer)
	phrase.value = null
	document.removeEventListener("keydown", onKeydown)
})
</script>

<template>
	<SecretExportLayout
		heroMain="Seed"
		heroSub="Phrase"
		collapsingLabel="Seed Phrase"
		backTo="/popup/settings/security/export"
	>
		<!-- Agreement gate -->
		<template v-if="!isStarted">
			<div class="export_section">
				<span class="export_section_label">Before you continue</span>
				<Flex direction="column" gap="8">
					<Text size="13" height="150" color="body">
						Seed phrase is direct and full access to your entire profile, once you lose it you will not
						be able to regain access to your profile.
					</Text>
					<Text size="13" height="150" color="body">
						Ensure that seed phrase is securely stored.
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

		<!-- Password gate -->
		<SecretUnlockSection
			v-else-if="isStarted && !isUnlocked"
			v-model="password"
			:error="isWrongPassword"
			@clearError="isWrongPassword = false"
		/>

		<!-- Revealed phrase -->
		<template v-else>
			<div class="export_section">
				<span class="export_section_label">Your seed phrase</span>
				<SecretRevealCard
					:value="phrase"
					label="Seed Phrase"
					testId="reveal-content"
					:isCopied="isCopied"
					@copy="handleCopy"
				/>
			</div>

			<div class="export_section_last">
				<span class="export_section_label">Keep in mind</span>
				<Flex direction="column" gap="10">
					<Flex gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							Some applications on your PC can have access to your clipboard and read a seed phrase
						</Text>
					</Flex>

					<Flex gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							Storing a text file with sensitive information like a seed phrase can be dangerous
						</Text>
					</Flex>

					<Flex gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							Storing a seed phrase in your notebook or in any other physical form can be considered one of
							the safest methods, but a paper can be easily lost or destroyed (by water or fire)
						</Text>
					</Flex>
				</Flex>
			</div>
		</template>

		<!-- Bottom CTA -->
		<template #bottom>
			<Button v-if="!isStarted" @click="handleStart" variant="cta" data-testid="agree-continue-btn">
				Agree &amp; Continue
			</Button>

			<Button
				v-else-if="isStarted && !isUnlocked"
				@click="handleUnlock"
				:disabled="!password"
				variant="cta"
				data-testid="unlock-submit-btn"
			>
				Retrieve Seed Phrase
			</Button>

			<SecretCountdownClose
				v-else
				:countdownLabel="countdown.countdownLabel.value"
				:autoCloseDisabled="countdown.isAutoCloseDisabled.value"
				:progressDurationMs="AUTO_CLOSE_MS"
				@close="handleClose"
				@disableAutoClose="countdown.disable"
			/>
		</template>
	</SecretExportLayout>
</template>
