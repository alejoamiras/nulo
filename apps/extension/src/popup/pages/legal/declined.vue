<route lang="json">
{
	"meta": {
		"isAuthRequired": true,
		"title": "Terms not accepted"
	}
}
</route>

<script setup lang="ts">
/** Utils */
import { currentVersion } from "@nulo/legal"
import { LEGAL_DISMISSED_KEY } from "@/utils/legal-sheet"

const router = useRouter()

const termsVersion = currentVersion("terms").version

const STILL_YOURS = ["See your balances and history", "Export your recovery material", "Export a full backup"]
const PAUSED = ["Send, or approve an app request"]

/** Clearing the dismissal is what reopens the sheet, on the wallet page it is allowed to cover. */
const handleReview = async () => {
	await chrome.storage.session.remove(LEGAL_DISMISSED_KEY)
	await router.push("/popup/general")
}
</script>

<template>
	<Flex direction="column" gap="20" wide :class="$style.page" data-testid="legal-declined">
		<Flex direction="column" gap="8">
			<Text size="10" color="secondary" mono :class="$style.eyebrow" data-testid="legal-declined-version">
				Terms v{{ termsVersion }} not accepted
			</Text>
			<Text size="20" color="primary" weight="700" :class="$style.title">Your keys are still yours</Text>
			<Text size="13" color="secondary" height="150">
				Declining new Terms never locks you out of your own wallet. Here is exactly what changes.
			</Text>
		</Flex>

		<Flex direction="column" :class="$style.card">
			<Flex v-for="line in STILL_YOURS" :key="line" gap="10" align="center" :class="$style.row" data-testid="legal-declined-kept">
				<MaterialIcon name="check" :size="16" color="green" />
				<Text size="13" color="primary">{{ line }}</Text>
			</Flex>
			<Flex v-for="line in PAUSED" :key="line" gap="10" align="center" :class="$style.row" data-testid="legal-declined-paused">
				<MaterialIcon name="close" :size="16" color="red" />
				<Text size="13" color="secondary">{{ line }}</Text>
			</Flex>
		</Flex>

		<Text size="12" color="secondary" height="150">
			Only the actions that need an agreement are paused. Everything that is simply yours stays available.
		</Text>

		<Flex direction="column" gap="8" :class="$style.actions">
			<Button variant="primary" size="large" wide data-testid="legal-declined-review" @click="handleReview">Review the new Terms</Button>
			<Button variant="primary_outline" size="large" wide data-testid="legal-declined-export" link="/popup/settings/security/export">
				Export a backup
			</Button>
		</Flex>
	</Flex>
</template>

<style module>
.page {
	flex: 1;
	padding: 20px 16px;
	overflow-y: auto;
}

.eyebrow {
	letter-spacing: 0.16em;
	text-transform: uppercase;
}

.title {
	font-family: var(--font-headline);
	letter-spacing: -0.02em;
	text-transform: uppercase;
}

.card {
	padding: 4px 16px;
	background: var(--card-bg);
	border: 1px solid var(--nulo-border);
}

.row {
	padding: 12px 0;
}

.row + .row {
	border-top: 1px solid var(--nulo-border);
}

.actions {
	margin-top: auto;
}
</style>
