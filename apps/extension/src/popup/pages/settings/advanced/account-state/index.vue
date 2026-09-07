<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */
</script>

<template>
	<SettingsPageShell title="Account State" :backTo="'/popup/settings/advanced'" gap="20">
		<ItemsContainer>
			<SettingItem
				size="large"
				to="/popup/settings/advanced/account-state/notes"
				title="Notes"
				description="View all notes"
				materialIcon="note_alt"
				chevron
				data-testid="setting-nav-advanced-account-state-notes"
			/>
			<SettingItem
				size="large"
				to="/popup/settings/advanced/account-state/authwits"
				title="Authwits"
				description="View all authwits"
				materialIcon="verified_user"
				chevron
				data-testid="setting-nav-advanced-account-state-authwits"
			/>
			<SettingItem
				size="large"
				to="/popup/settings/advanced/account-state/contracts"
				title="Contracts"
				description="View all contracts"
				materialIcon="receipt_long"
				chevron
				data-testid="setting-nav-advanced-account-state-contracts"
			/>
			<SettingItem
				size="large"
				to="/popup/settings/advanced/account-state/senders"
				title="Senders"
				description="View all senders"
				materialIcon="inbox"
				chevron
				data-testid="setting-nav-advanced-account-state-senders"
			/>
		</ItemsContainer>
	</SettingsPageShell>
</template>

