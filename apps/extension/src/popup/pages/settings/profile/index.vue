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
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const popupStore = usePopupStore()

const router = useRouter()
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Profile" :backTo="'/popup/settings'" />

		<Flex direction="column" gap="24" :class="$style.content">
			<ItemsContainer v-if="appStore.profile" title="Identity">
				<SettingField
					@click="popupStore.open('edit_profile')"
					label="Name"
					:value="appStore.profile?.name"
					icon="edit"
					data-testid="identity-name-row"
				/>
				<Flex direction="column" gap="6" :class="$style.id_row" data-testid="identity-id-row">
					<Text size="12" weight="600" color="secondary">ID</Text>
					<Text size="12" weight="500" color="tertiary" :class="$style.id_value">
						{{ appStore.profile?.id }}
					</Text>
				</Flex>
			</ItemsContainer>

			<ItemsContainer title="Security">
				<SettingItem to="/popup/settings/security/export" title="Backup profile" icon="key-square" chevron data-testid="backup-link-btn" />
				<SettingItem
					@click="router.push('/popup/settings/security/change-password')"
					title="Change password"
					icon="profile-password"
					:disabled="appStore.profile?.type === 'passkey'"
					chevron
					data-testid="change-password-link-btn"
				/>
			</ItemsContainer>

			<ItemsContainer>
				<SettingItem
					@click="router.push('/popup/settings/security/reset')"
					title="Delete profile"
					icon="trash"
					iconBgColor="red"
					chevron
					data-testid="delete-profile-link-btn"
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

.id_row {
	position: relative;
	padding: 14px 16px;
}

.id_value {
	font-family: var(--font-mono);
	word-break: break-all;
}
</style>
