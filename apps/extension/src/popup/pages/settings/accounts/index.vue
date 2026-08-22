<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */

/** Services */
import { AccountType } from "@/wallet/services/account/client"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store"
import { useCacheStore } from "@/stores/cache.store"
import { copyToClipboard } from "@/utils/clipboard"
const appStore = useAppStore()
const popupStore = usePopupStore()
const cacheStore = useCacheStore()

const router = useRouter()

/** Account export is password-gated in the service, so passkey profiles get no export entry. */
const canExportAccounts = computed(() => appStore.profile?.type !== "passkey")

const accounts = computed(() => appStore.accounts.filter((a) => a.visible).sort((a, b) => a.index - b.index))
const hiddenAccounts = computed(() => appStore.accounts.filter((a) => !a.visible))

const handleSelectAccount = async (acc) => {
	// Same guard as the accounts popup: a send in flight is still reading the
	// active account as it builds, so switching now would let it finish as the
	// wrong one. Without this, the popup's guard is just a detour.
	if (!(await appStore.commitScopeChange(() => appStore.selectAccount(acc)))) {
		openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
	}
}

const handleEditAccount = (target) => {
	cacheStore.accountToEditIdx = target.address
	popupStore.open("edit_account")
}

const handleExportAccount = (target) => {
	// Deep-link into the Account backup page with this account preselected (the page skips its
	// picker). The flow lives with the other backup modes; this icon is the shortcut.
	router.push(`/popup/settings/security/export/account?address=${target.address}`)
}

const handleHideAccount = async (acc) => {
	if (accounts.value.length === 1) return
	// Hiding ANY account reassigns the active one to the first visible account,
	// so it changes the signing scope exactly like an explicit switch does.
	if (!(await appStore.changeAccountVisibility(acc, false))) {
		openToast({ label: "Finish or cancel your pending transaction first", icon: "info" }, 3_000)
		return
	}
	openToast({ label: "Account successfully hidden" })
}

const handleShowAccount = (acc) => {
	appStore.changeAccountVisibility(acc, true)
	openToast({ label: "Account visible again" })
}

const handleCopyAddress = (target) => {
	void copyToClipboard(target, openToast, {
		success: { label: "Address is copied" },
		failure: { label: "Couldn't copy", icon: "warning", duration: 3_000 },
	})
}
</script>

<template>
	<Flex direction="column" :class="$style.wrapper" data-testid="manage-accounts-page">
		<SubPageHeader title="Manage Accounts" :backTo="'/popup/settings'" />

		<Flex direction="column" gap="40" :class="$style.content">
			<Flex direction="column" gap="16">
				<SectionLabel label="Accounts" :count="appStore.accounts.length" />

				<ItemsContainer>
					<SettingItem
						v-for="account in accounts"
						@click="handleSelectAccount(account)"
						:title="account.name"
						:icon="account?.address === appStore.account?.address ? 'check-circle' : 'circle'"
						:iconFillColor="account?.address === appStore.account?.address ? 'primary' : 'tertiary'"
						data-testid="manage-accounts-row"
						:data-account-name="account.name"
					>
						<!-- Imported marker on the DESCRIPTION line in the address's own mono voice (owner
						     pick: option B + V4). Exactly ONE truncation mechanism: the address's head span
						     clips with a CSS ellipsis while the marker and the 4-char tail never shrink, so
						     the line adapts to whatever width the action icons leave instead of a guessed
						     trim length fighting the wrapper's own ellipsis. -->
						<template #description>
							<Text size="11" weight="500" color="tertiary" mono :class="$style.desc_line">
								<template v-if="account.type === AccountType.Imported">
									<span data-testid="account-imported-badge" :class="$style.desc_fixed">imported</span>
									<span :class="$style.desc_fixed">&nbsp;&#183;&nbsp;</span>
								</template>
								<span :class="$style.addr_head">{{ account.address.slice(0, -4) }}</span>
								<span :class="$style.desc_fixed">{{ account.address.slice(-4) }}</span>
							</Text>
						</template>
						<template #right>
							<Flex align="center" gap="8">
								<Tooltip position="end" delay="350">
									<Icon
										@click.stop="handleCopyAddress(account.address)"
										name="copy"
										size="14"
										color="tertiary"
										hoverColor="primary"
										:class="$style.icon_btn"
									/>

									<template #content>Copy account address</template>
								</Tooltip>

								<Tooltip v-if="canExportAccounts" position="end" delay="350">
									<Icon
										@click.stop="handleExportAccount(account)"
										name="upload-outline"
										size="14"
										color="tertiary"
										hoverColor="primary"
										:class="$style.icon_btn"
										data-testid="account-export-btn"
									/>

									<template #content>Export account</template>
								</Tooltip>

								<Tooltip position="end" delay="350">
									<Icon
										@click.stop="handleEditAccount(account)"
										name="edit"
										size="14"
										color="tertiary"
										:class="$style.icon_btn"
										data-testid="account-edit-btn"
									/>

									<template #content>Edit account</template>
								</Tooltip>

								<Tooltip position="end" delay="350">
									<div data-testid="account-hide" @click.stop="handleHideAccount(account)">
										<Icon
											name="close-circle"
											size="14"
											color="tertiary"
											:class="[$style.icon_btn, accounts.length === 1 && $style.disabled]"
										/>
									</div>

									<template #content> Hide account </template>
								</Tooltip>
							</Flex>
						</template>
					</SettingItem>
				</ItemsContainer>

				<Flex gap="10">
					<Button
						@click="popupStore.open('new_account')"
						wide
						variant="primary"
						size="large"
						data-testid="accounts-new-btn"
					>
						Add account
					</Button>
					<Button
						@click="router.push('/popup/settings/accounts/import')"
						wide
						variant="primary_outline"
						size="large"
						data-testid="accounts-import-btn"
					>
						Import account
					</Button>
				</Flex>
			</Flex>

			<Flex v-if="hiddenAccounts.length" direction="column" gap="12">
				<Flex align="center" justify="between">
					<Text size="13" weight="600" color="body"> Hidden accounts </Text>

					<Text size="13" weight="600" color="secondary">
						{{ hiddenAccounts.length }}
					</Text>
				</Flex>

				<ItemsContainer description="Click on an account you want to make visible">
					<SettingItem
						v-for="account in hiddenAccounts"
						@click="handleShowAccount(account)"
						:title="account.name"
						:description="account.address"
						data-testid="manage-accounts-hidden-row"
						:data-account-name="account.name"
					>
						<template #icon>
							<AccountAvatar :name="account.name" :address="account.address" :size="20" />
						</template>
						<template #right>
							<Icon name="arrow-back-up" size="14" color="secondary" />
						</template>
					</SettingItem>
				</ItemsContainer>
			</Flex>
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

.desc_line {
	display: flex;
	max-width: 100%;
}

.desc_fixed {
	flex-shrink: 0;
}

/* Shrink-only (no grow), so on wide rows the tail sits flush against the head. */
.addr_head {
	flex: 0 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.icon_btn {
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}

	&.disabled {
		pointer-events: none;
		opacity: 0.3;
	}
}
</style>
