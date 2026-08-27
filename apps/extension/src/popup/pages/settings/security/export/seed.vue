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

// F-14 scrub + honest copy toast live in useSecretClipboardCopy (shared with
// the key page — the block was previously duplicated word for word here).
const { isCopied, copySecret } = useSecretClipboardCopy({ toastLabel: "Recovery phrase copied", openToast })
const handleCopy = () => {
	copySecret(phrase.value)
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
	// The scrub timer deliberately survives unmount — see useSecretClipboardCopy's
	// F-14 rationale. This page owns only its secret-nulling + listener cleanup.
	phrase.value = null
	document.removeEventListener("keydown", onKeydown)
})
</script>

<template>
	<SecretExportLayout
		heroMain="Recovery"
		heroSub="Phrase"
		collapsingLabel="Recovery Phrase"
		backTo="/popup/settings/security/export"
	>
		<!-- Agreement gate -->
		<template v-if="!isStarted">
			<div class="export_section">
				<span class="export_section_label">Before you continue</span>
				<Flex direction="column" gap="8">
					<Text size="13" height="150" color="body">
						Your recovery phrase is direct and full access to your entire profile, once you lose it you will not
						be able to regain access to your profile.
					</Text>
					<Text size="13" height="150" color="body">
						Ensure that your recovery phrase is securely stored.
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
				<span class="export_section_label">Your recovery phrase</span>
				<SecretRevealCard
					:value="phrase"
					label="Recovery Phrase"
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
							Some applications on your PC can have access to your clipboard and read a recovery phrase
						</Text>
					</Flex>

					<Flex gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							Storing a text file with sensitive information like a recovery phrase can be dangerous
						</Text>
					</Flex>

					<Flex gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							Storing a recovery phrase in your notebook or in any other physical form can be considered one of
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
				Retrieve Recovery Phrase
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
