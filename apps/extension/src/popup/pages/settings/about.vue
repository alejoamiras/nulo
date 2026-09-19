<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */

/** Composables */
import { useToast } from "@/composables/toast"
import { useLegalAcceptance } from "@/composables/useLegalAcceptance"
const { openToast } = useToast()

/** Utils */
import { currentVersion } from "@nulo/legal"
import { copyWithToast } from "@/utils/clipboard"
import { managers } from "@/utils/core"
import { legalAboutRow } from "@/utils/legal-about"
import { openLegalDocument } from "@/utils/legal-links"
import { LEGAL_DISMISSED_KEY } from "@/utils/legal-sheet"

const version = __VERSION__
const aztecVersion = __AZTEC_VERSION__

const handleCopy = (target) => {
	void copyWithToast(target, openToast, "Version is copied")
}

/** Terms acceptance. The shared client stays connected for the shell; only the composable is ours. */
const router = useRouter()
const legal = useLegalAcceptance(managers.legal)
const legalRecord = ref(null)
const legalRow = computed(() => legalAboutRow(legal.status.value, legalRecord.value))
const privacyVersion = currentVersion("privacy").version

const loadLegalRecord = async () => {
	legalRecord.value = await managers.legal.getRecord().catch(() => null)
}

/** Clearing the dismissal reopens the shell's sheet, on a wallet page it is allowed to cover. */
const handleReview = async () => {
	await chrome.storage.session.remove(LEGAL_DISMISSED_KEY)
	await router.push("/popup/general")
}

watch(() => legal.status.value, loadLegalRecord)

onBeforeMount(() => legal.refresh())

onBeforeUnmount(() => legal.dispose())
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="About Nulo" :backTo="'/popup/settings'" />
		<Flex direction="column" gap="24" align="center" :class="$style.content">
			<Flex wide align="start" direction="column" gap="8">
				<Text size="13" weight="600" color="primary"> Nulo </Text>
				<Flex align="start" direction="column" gap="4" wide>
					<Text @click="handleCopy(version)" size="12" weight="500" color="support" class="copyable">
						Wallet version - {{ version }} - Alpha Testing
					</Text>
					<Text @click="handleCopy(aztecVersion)" size="12" weight="500" color="support" class="copyable">
						Aztec version - {{ aztecVersion }}
					</Text>
					<Text size="12" weight="500" color="support" data-testid="coingecko-attribution">
						Token prices by CoinGecko
					</Text>
				</Flex>
			</Flex>

			<ItemsContainer wide>
				<SettingItem
					to="https://nulo.sh"
					title="Nulo Website"
					icon="globe"
					iconBgColor="blue"
					external
				/>
			</ItemsContainer>

			<ItemsContainer title="Contact us" wide>
				<SettingItem
					to="mailto:hello@nulo.sh?subject=Nulo%20feedback"
					size="large"
					title="Feedback"
					description="Suggest an idea"
					icon="face"
					external
				/>
				<SettingItem
					to="mailto:hello@nulo.sh?subject=Nulo%20bug%20report"
					size="large"
					title="Report Issue"
					description="If you're facing a bug"
					icon="bug"
					external
				/>
				<SettingItem
					to="mailto:hello@nulo.sh?subject=Nulo%20scam%20report"
					size="large"
					title="Report Scam"
					description="Tell us about the scammers"
					icon="warning"
					external
				/>
			</ItemsContainer>

			<ItemsContainer title="Legal" wide data-testid="legal-about-group">
				<SettingItem @click="openLegalDocument('terms')" size="small" title="Terms of Use" chevron data-testid="legal-about-terms" />
				<SettingItem
					@click="openLegalDocument('privacy')"
					size="small"
					:title="`Privacy Policy v${privacyVersion}`"
					:description="legalRow.privacyUpdated ? 'Privacy Policy updated' : undefined"
					chevron
					data-testid="legal-about-privacy"
				/>
				<SettingItem
					v-if="legalRow.accepted"
					size="large"
					:title="legalRow.title"
					:description="legalRow.description"
					data-testid="legal-about-accepted"
				/>
				<SettingItem
					v-else
					@click="handleReview"
					size="large"
					:title="legalRow.title"
					:description="legalRow.description"
					chevron
					data-testid="legal-about-not-accepted"
				/>
			</ItemsContainer>
			<Text size="11" color="support" height="150" data-testid="legal-about-note">
				Kept on this device. Never sent anywhere, and not part of a backup.
			</Text>
		</Flex>

	</Flex>
</template>

<style module>
.wrapper {
	composes: wrapper from "../../../components/composite/settings-page.module.css";
}

.content {
	composes: content from "../../../components/composite/settings-page.module.css";
}
</style>
