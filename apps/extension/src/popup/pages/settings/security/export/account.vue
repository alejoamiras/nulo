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
import SecretUnlockSection from "@/components/composite/SecretUnlockSection.vue"

/** Services */
import { managers } from "@/utils/core"

/** Utils */
import { downloadFile } from "@/utils"
import { trimAddress } from "@/utils/string"

/** Composables */
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
import { AccountType } from "@/wallet/services/account/client"
const appStore = useAppStore()

const route = useRoute()
const router = useRouter()

/** The service gates this export on the profile password; passkey profiles have no password, so
 *  the whole mode is hidden for them (export/index.vue) and this page bounces them back. */
if (appStore.profile?.type === "passkey") {
	router.replace("/popup/settings/security/export")
}

const accounts = computed(() => appStore.accounts ?? [])

/** Preselected via the Manage Accounts deep-link (`?address=`); the picker is skipped when the
 *  address belongs to this profile's current chain. */
const selectedAddress = ref("")
const queryAddress = typeof route.query.address === "string" ? route.query.address : ""
if (queryAddress && (appStore.accounts ?? []).some((a) => a.address === queryAddress)) {
	selectedAddress.value = queryAddress
}
const selectedAccount = computed(() => accounts.value.find((a) => a.address === selectedAddress.value))

const isAgreed = ref(false)
const password = ref()
const isWrongPassword = ref(false)
const isBusy = ref(false)

/** "" | "ready" | "protected" — the file stages, mirroring Full Backup's status machine. */
const fileStatus = ref("")
const payload = ref("")

const collapsingLabel = computed(() => {
	if (!selectedAddress.value) return "Account"
	return selectedAccount.value?.name ?? "Account"
})

const handleSelect = (account) => {
	selectedAddress.value = account.address
}

const handleAgree = () => {
	isAgreed.value = true
}

const handleCreate = async () => {
	if (!password.value || isBusy.value) return
	isBusy.value = true
	try {
		payload.value = await managers.account.exportAccount(
			appStore.profile.id,
			appStore.network.chainId,
			selectedAddress.value,
			password.value,
			false,
		)
		fileStatus.value = "ready"
	} catch (error) {
		isWrongPassword.value = true
	} finally {
		isBusy.value = false
	}
}

const handleProtect = async () => {
	if (isBusy.value) return
	isBusy.value = true
	try {
		payload.value = await managers.account.exportAccount(
			appStore.profile.id,
			appStore.network.chainId,
			selectedAddress.value,
			password.value,
			true,
		)
		fileStatus.value = "protected"
		// The password's job is done once the protected payload exists.
		password.value = null
	} catch (error) {
		openToast({ label: "Failed to protect the file", icon: "warning" }, 4_000)
	} finally {
		isBusy.value = false
	}
}

const fileName = computed(() => {
	const profile = (appStore.profile?.name ?? "profile").replace(/\s+/g, "_")
	const addr = selectedAddress.value.slice(0, 10)
	return fileStatus.value === "protected" ? `NuloEncryptedAccount_${profile}_${addr}.txt` : `NuloAccount_${profile}_${addr}.json`
})

const handleDownload = async () => {
	try {
		await downloadFile({ data: payload.value, filename: fileName.value })
		openToast({ label: "Account file downloaded", icon: "download" }, 2_000)
	} catch (err) {
		console.error("Download failed:", err?.message || err)
		openToast({ label: "Failed to download the file", icon: "warning" }, 4_000)
	}
}

onBeforeUnmount(() => {
	// The plain payload is spendable material; drop both secrets with the page.
	payload.value = ""
	password.value = null
})
</script>

<template>
	<SecretExportLayout heroMain="Account" heroSub="Backup" :collapsingLabel="collapsingLabel" backTo="/popup/settings/security/export">
		<!-- Step 1: account picker (skipped when deep-linked with a preselected address) -->
		<template v-if="!selectedAddress">
			<div class="export_section_last">
				<span class="export_section_label">Select account</span>
				<ItemsContainer flat>
					<SettingItem
						v-for="account in accounts"
						:key="account.address"
						@click="handleSelect(account)"
						size="large"
						:title="account.name"
						:description="trimAddress(account.address, 6, 4, '...')"
						icon="user"
						chevron
						data-testid="export-account-row"
						:data-account-address="account.address"
						:data-account-name="account.name"
					/>
				</ItemsContainer>
			</div>
		</template>

		<!-- Step 2: agree gate -->
		<template v-else-if="!isAgreed">
			<div class="export_section_last">
				<span class="export_section_label">Before you continue</span>
				<Flex direction="column" gap="8">
					<Text size="13" height="150" color="body"> This file gives full control of one account. </Text>
					<Text size="13" height="150" color="body">
						Anyone holding the plain file can spend from this account. Store it as carefully as your recovery phrase.
					</Text>
					<Text size="13" height="150" color="body"> By continuing you accept these risks. </Text>
				</Flex>
			</div>
		</template>

		<!-- Step 3: unlock -->
		<SecretUnlockSection
			v-else-if="!fileStatus"
			v-model="password"
			:error="isWrongPassword"
			@clearError="isWrongPassword = false"
		/>

		<!-- Steps 4/5: file ready / protected -->
		<template v-else>
			<div class="export_section_last">
				<span class="export_section_label">File</span>
				<Flex direction="column" gap="12">
					<Banner v-if="fileStatus === 'ready'" variant="info" direction="vertical" data-testid="account-file-ready-banner">
						<template #title> Account file is ready </template>
						<template #description>
							<Text height="140"> You can download it now. We strongly recommend protecting it with your password first. </Text>
						</template>
					</Banner>

					<Banner v-else variant="done" direction="vertical" data-testid="account-file-protected-banner">
						<template #title> Account file is protected </template>
						<template #description>
							<Text color="secondary" height="140"> Your profile password will be required to import this account. </Text>
						</template>
					</Banner>

					<Flex align="center" gap="10" :class="$style.file_chip" data-testid="account-file-chip">
						<Icon :name="fileStatus === 'protected' ? 'lock' : 'brackets'" size="16" color="secondary" />
						<Text size="12" weight="600" color="primary" mono :class="$style.file_name">{{ fileName }}</Text>
					</Flex>

					<Flex v-if="selectedAccount?.type === AccountType.Imported" gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							This account is not covered by your recovery phrase. This file is its only backup.
						</Text>
					</Flex>
				</Flex>
			</div>
		</template>

		<!-- Bottom CTA per stage -->
		<template #bottom>
			<Button v-if="selectedAddress && !isAgreed" @click="handleAgree" variant="cta" data-testid="agree-continue-btn">
				Agree &amp; Continue
			</Button>

			<Button
				v-else-if="selectedAddress && isAgreed && !fileStatus"
				@click="handleCreate"
				:disabled="!password || isBusy"
				variant="cta"
				data-testid="unlock-submit-btn"
			>
				{{ isBusy ? "Creating File" : "Create Account File" }}
			</Button>

			<Flex v-else-if="fileStatus === 'ready'" direction="column" gap="8" wide>
				<Button @click="handleProtect" :disabled="isBusy" variant="cta" data-testid="account-protect-btn">
					{{ isBusy ? "Protecting" : "Protect with Password" }}
				</Button>
				<Button @click="handleDownload" variant="cta_outline" data-testid="account-download-btn"> Download File </Button>
			</Flex>

			<Button v-else-if="fileStatus === 'protected'" @click="handleDownload" variant="cta" data-testid="account-download-btn">
				Download File
			</Button>
		</template>
	</SecretExportLayout>
</template>

<style module>
.file_chip {
	background: var(--card-bg);
	border: 1px dashed var(--nulo-outline);
	border-radius: 12px;
	padding: 12px;
}

.file_name {
	overflow-wrap: anywhere;
}
</style>
