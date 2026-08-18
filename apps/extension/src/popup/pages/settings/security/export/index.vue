<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Backup" :backTo="'/popup/settings/security'" />

		<Flex direction="column" gap="24" :class="$style.content">
			<!-- Passkey profile -->
			<template v-if="appStore.profile.type === 'passkey'">
				<ItemsContainer title="Profile">
					<SettingItem :title="appStore.profile.name" icon="user" raw />
				</ItemsContainer>

				<Flex direction="column" gap="12" style="padding: 0 8px;">
					<Text size="13" weight="500" height="150" color="tertiary">
						To access your profile on a new device, the Passkey must be <Text weight="600" color="secondary">synced</Text> with
						it or <Text weight="600" color="secondary">available on another device</Text> you own.
					</Text>
				</Flex>

				<ItemsContainer title="Choose backup mode">
					<SettingItem title="Full Backup" icon="package" iconBgColor="blue" to="/popup/settings/security/export/full" data-testid="full-backup-link-btn" />
				</ItemsContainer>
			</template>

			<!-- Password profile -->
			<template v-else>
				<ItemsContainer title="Profile to backup">
					<SettingItem :title="appStore.profile.name" icon="user" raw />
				</ItemsContainer>

				<ItemsContainer title="Choose backup mode">
					<SettingItem title="Full Backup" icon="package" iconBgColor="blue" to="/popup/settings/security/export/full" data-testid="full-backup-link-btn" />
					<SettingItem title="Recovery Phrase" icon="text" iconBgColor="blue" to="/popup/settings/security/export/seed" data-testid="seed-phrase-link-btn" />
				</ItemsContainer>
			</template>

			<ItemsContainer
				description="Explore credentials management capabilities and options for resolving potential issues"
			>
				<SettingItem
					title="Frequently Asked Questions"
					icon="help"
					to="/popup/settings/security/export/faq"
					external
					disabled
				/>
			</ItemsContainer>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}
</style>
