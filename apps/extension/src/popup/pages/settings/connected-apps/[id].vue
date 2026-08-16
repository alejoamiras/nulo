<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */
import { Dropdown } from "@/components/ui/Dropdown"
import DappSessionVerification from "@/popup/components/modules/settings/connected-apps/DappSessionVerification.vue"
import GrantedCapabilitiesList from "@/popup/components/modules/settings/connected-apps/GrantedCapabilitiesList.vue"
import { getChainName } from "@/components/ui/utils.js"

/** Vendor */
import { hashToEmoji } from "@aztec/wallet-sdk/crypto"

/** Services */
import { AccountServiceClient } from "@/wallet/services/account/client"
import { DappSessionServiceClient } from "@/wallet/services/dapp-session/client"
import { NetworkServiceClient } from "@/wallet/services/network/client"
import { formatCaipAccount, parseCaipAccount } from "@/wallet/utils/caip"

/** Composables */
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Helpers */
import { formatSessionExpiry, parseSessionParams } from "@/popup/components/modules/settings/connected-apps/connected-app-helpers"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
import { trimAddress } from "@/utils/string"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const route = useRoute()
const router = useRouter()

const session = ref()
const accounts = ref([])

const sessionParams = computed(() => parseSessionParams(session.value?.permissions))
const methods = computed(() => sessionParams.value.methods)
const events = computed(() => sessionParams.value.events)
// Chain scoping lives on the parent session. Display the single
// `session.chainId` rather than flattening per-permission `chains`
// arrays (which no longer exist on `DappPermissions`).
const sessionChainName = computed(() => {
	const cid = session.value?.chainId
	if (cid === undefined || cid === null) return ""
	return getChainName(Number(cid))
})

const verificationEmojis = computed(() => (session.value?.verificationHash ? hashToEmoji(session.value.verificationHash) : ""))

const expiryFormatted = computed(() => formatSessionExpiry(session.value?.expiry))

const hasSessionAllowances = computed(() => methods.value.length > 0 || events.value.length > 0)

const grantedCapabilities = computed(() => session.value?.capabilityGrants ?? [])

const isTrusted = computed(() => session.value?.trustedVerification ?? false)

const fetchSession = async () => {
	try {
		session.value = await dappSessionService.getDappSession(route.params.id)
	} catch {
		// Session missing / expired — the service throws instead of returning null
		router.push("/popup/settings/connected-apps")
		return
	}

	if (!session.value) {
		router.push("/popup/settings/connected-apps")
		return
	}

	if (session.value.dappMetadata.logo) {
		session.value.dappMetadata.logoBlobUrl = session.value.dappMetadata.logo
	}
}

async function fetchAccounts() {
	const networkServiceClient = new NetworkServiceClient()
	const accMap = new Map()

	for (const account of session.value.accounts) {
		let parsed
		try {
			parsed = parseCaipAccount(account)
		} catch {
			continue
		}
		if (!accMap[parsed.chainId]) {
			accMap[parsed.chainId] = []
		}
		accMap[parsed.chainId].push(parsed.address)
	}

	for (const chainId of Object.keys(accMap)) {
		const networks = await networkServiceClient.getNetworks(+chainId)
		if (networks.length) {
			const network = networks[0]
			const accountServiceClient = new AccountServiceClient()

			for (const address of accMap[chainId]) {
				const account = await accountServiceClient.getAccount(appStore.profile.id, network.chainId, address)
				if (account) {
					accounts.value.push(account)
				}
			}
		}
	}
}

const handleDropSession = () => {
	if (!session.value) return
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.confirm_text = "Yes, disconnect"
	cacheStore.confirm.description = `Disconnect "${session.value.dappMetadata?.name ?? "this dApp"}"?`
	cacheStore.confirm.callback = async () => {
		await dappSessionService.deleteDappSession(session.value.id)
	}
	popupStore.open("confirm")
}

const handleCopyAddress = (target) => {
	window.navigator.clipboard.writeText(target)
	openToast({ label: "Address is copied", icon: "copy" })
}

const getAccountAlias = (acc) => {
	if (!session.value?.accountAliases) return acc.name
	const caip = formatCaipAccount(acc.chainId, acc.address)
	return session.value.accountAliases[caip] || acc.name
}

const toggleTrust = async () => {
	if (!session.value) return
	await dappSessionService.setTrustedVerification(session.value.id, !isTrusted.value)
}

const dappSessionService = new DappSessionServiceClient()
function onDappSessionUpdated(ds) {
	if (ds.id !== session.value?.id) return
	const prevBlob = session.value.dappMetadata?.logoBlobUrl
	session.value = ds
	if (prevBlob && session.value.dappMetadata) {
		session.value.dappMetadata.logoBlobUrl = prevBlob
	}
}
function onDappSessionDeleted(ds) {
	if (ds.id !== session.value?.id) return
	openToast({ label: "The session was interrupted" })
	router.go(-1)
}
dappSessionService.onDappSessionUpdated.add(onDappSessionUpdated)
dappSessionService.onDappSessionDeleted.add(onDappSessionDeleted)

onMounted(async () => {
	await fetchSession()
	if (!session.value) return
	await fetchAccounts()
})

onBeforeUnmount(() => {
	dappSessionService.disconnect()
})
</script>

<template>
	<Flex v-if="session" direction="column" :class="$style.wrapper">
		<SubPageHeader title="Connected App" :backTo="'/popup/settings/connected-apps'">
			<template #trailing>
				<Dropdown>
					<button type="button" :class="$style.icon_btn" aria-label="Session actions">
						<MaterialIcon name="more_vert" :size="18" color="secondary" />
					</button>

					<template #popup>
						<DropdownItem @click="handleDropSession">
							<Flex align="center" gap="8">
								<Icon name="log-out" size="14" color="secondary" />
								Disconnect session
							</Flex>
						</DropdownItem>
					</template>
				</Dropdown>
			</template>
		</SubPageHeader>

		<Flex direction="column" gap="24" :class="$style.content">
			<!-- Identity block -->
			<Flex align="center" gap="12" wide>
				<Icon v-if="session.loadingLogo" :loading="true" name="dapp" size="40" color="tertiary" />
				<img
					v-else-if="session.dappMetadata.logoBlobUrl"
					:src="session.dappMetadata.logoBlobUrl"
					:class="$style.logo"
					alt=""
				/>
				<Icon v-else name="dapp" size="40" color="tertiary" />

				<Flex direction="column" gap="4" wide>
					<Text size="14" weight="600" color="primary">
						{{ session.dappMetadata.name ?? "Unknown dapp" }}
					</Text>
					<Text size="12" weight="500" color="tertiary" selectable>
						{{ session.dappMetadata.url }}
					</Text>
					<Text v-if="expiryFormatted" size="11" color="tertiary">
						Expires {{ expiryFormatted }}
					</Text>
				</Flex>
			</Flex>

			<!-- Shared accounts -->
			<Flex direction="column" gap="10" wide>
				<SectionLabel label="Shared accounts" :count="accounts.length" />

				<ItemsContainer v-if="accounts.length">
					<SettingItem
						v-for="acc in accounts"
						:key="`${acc.chainId}:${acc.address}`"
						materialIcon="account_balance_wallet"
						:title="getAccountAlias(acc)"
						:description="`${getChainName(acc.chainId).toUpperCase()} · ${trimAddress(acc.address, 6, 4, '...')}`"
						raw
					>
						<template #right>
							<Tooltip position="end" delay="350">
								<Icon
									@click.stop="handleCopyAddress(acc.address)"
									name="copy"
									size="14"
									color="tertiary"
									:class="$style.action_icon"
								/>
								<template #content>Copy address</template>
							</Tooltip>
						</template>
					</SettingItem>
				</ItemsContainer>
			</Flex>

			<!-- Session allowances -->
			<Flex v-if="hasSessionAllowances" direction="column" gap="10" wide>
				<SectionLabel label="Session allowances" />

				<Flex v-if="sessionChainName" align="start" gap="4">
					<Text size="13" weight="600" color="secondary">Network:</Text>
					<Text size="13" color="secondary" :style="{ lineHeight: '1.2' }">
						{{ sessionChainName }}
					</Text>
				</Flex>

				<Flex align="start" gap="4">
					<Text size="13" weight="600" color="secondary">Methods:</Text>
					<Text size="13" color="secondary" :style="{ lineHeight: '1.2' }">{{ methods.join(", ") }}</Text>
				</Flex>

				<Flex align="start" gap="4">
					<Text size="13" weight="600" color="secondary">Events:</Text>
					<Text v-if="events.length" size="13" color="secondary" :style="{ lineHeight: '1.2' }">
						{{ events.join(", ") }}
					</Text>
					<Text v-else size="13" color="tertiary" :style="{ lineHeight: '1.2' }">no allowances given</Text>
				</Flex>
			</Flex>

			<!-- Confirmation policy -->
			<Flex direction="column" gap="10" wide>
				<SectionLabel label="Confirmation policy" />
				<Text size="13" color="secondary" :style="{ lineHeight: '1.4' }">
					{{
						confirmationPolicies.find((x) => x.confirmationLevel === session?.confirmationLevel)?.description ?? "Unknown"
					}}
				</Text>
			</Flex>

			<!-- Granted permissions -->
			<Flex v-if="grantedCapabilities.length" direction="column" gap="10" wide>
				<SectionLabel label="Granted permissions" :count="grantedCapabilities.length" />
				<GrantedCapabilitiesList :grants="grantedCapabilities" />
			</Flex>

			<!-- Connection verification -->
			<DappSessionVerification
				v-if="verificationEmojis"
				:emojis="verificationEmojis"
				:isTrusted="isTrusted"
				@toggleTrust="toggleTrust"
			/>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}

.logo {
	width: 40px;
	height: 40px;
	object-fit: cover;
	flex-shrink: 0;
}

.icon_btn {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 32px;
	height: 32px;

	background: transparent;
	border: none;
	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: color-mix(in srgb, var(--nulo-accent) 8%, transparent);
	}
}

.action_icon {
	cursor: pointer;
	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}
</style>
