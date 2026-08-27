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

/** The picker (and the preselect validation) only ever offers CURRENT-chain rows: during a
 *  network switch `appStore.accounts` can transiently hold the previous chain's rows, and an
 *  export must never bind an address to the wrong chainId. */
const accounts = computed(() => (appStore.accounts ?? []).filter((a) => a.chainId === appStore.network?.chainId))

const selectedAddress = ref("")
const isAgreed = ref(false)
const password = ref()
const isWrongPassword = ref(false)
const isBusy = ref(false)
const isDownloading = ref(false)

/** "" | "ready" | "protected" — the file stages, mirroring Full Backup's status machine. */
const fileStatus = ref("")
const payload = ref("")

/** Async-result fence: bumped by every flow reset and by unmount, so an export RPC that resolves
 *  late can neither write a payload back after the scrub nor land in a different account's flow. */
let generation = 0

const resetFlow = () => {
	generation++
	selectedAddress.value = ""
	isAgreed.value = false
	password.value = null
	isWrongPassword.value = false
	isBusy.value = false
	isDownloading.value = false
	fileStatus.value = ""
	payload.value = ""
}

/** Preselect via the Manage Accounts deep-link (`?address=`); the picker is skipped when the
 *  address belongs to this profile's CURRENT chain. Watched, not read once: a query-only
 *  navigation reuses this component instance, so entering with a different (or no) address must
 *  scrub the previous flow's stage and payload rather than inherit them. */
const applyQueryPreselect = () => {
	const queryAddress = typeof route.query.address === "string" ? route.query.address : ""
	if (queryAddress && accounts.value.some((a) => a.address === queryAddress)) {
		selectedAddress.value = queryAddress
	}
}
applyQueryPreselect()
watch(
	() => route.query.address,
	() => {
		if (route.path !== "/popup/settings/security/export/account") return
		resetFlow()
		applyQueryPreselect()
	},
)
// A deep-link can land while the activation bootstrap is still refilling the store (a fresh
// unlock re-runs it): at setup the account list is momentarily empty, so the one-shot preselect
// above finds nothing and the page strands on the picker. Re-apply when the rows arrive — only
// while nothing is selected, so a manual pick is never overridden.
watch(accounts, () => {
	if (route.path !== "/popup/settings/security/export/account") return
	if (selectedAddress.value) return
	applyQueryPreselect()
})

const selectedAccount = computed(() => accounts.value.find((a) => a.address === selectedAddress.value))

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
	const gen = generation
	try {
		const body = await managers.account.exportAccount(
			appStore.profile.id,
			appStore.network.chainId,
			selectedAddress.value,
			password.value,
			false,
		)
		if (gen !== generation) return
		payload.value = body
		fileStatus.value = "ready"
	} catch (error) {
		if (gen !== generation) return
		// Only an authentication failure belongs on the password field; anything else (a deleted
		// account, a disconnect) shaking the input as "Wrong password" would send the user
		// retyping a password that was never the problem.
		if (/password/i.test(error?.message ?? "")) {
			isWrongPassword.value = true
		} else {
			console.error("[export/account] create failed:", error)
			openToast({ label: "Failed to create the file", icon: "warning" }, 4_000)
		}
	} finally {
		if (gen === generation) isBusy.value = false
	}
}

const handleProtect = async () => {
	if (isBusy.value || isDownloading.value) return
	isBusy.value = true
	const gen = generation
	try {
		const body = await managers.account.exportAccount(
			appStore.profile.id,
			appStore.network.chainId,
			selectedAddress.value,
			password.value,
			true,
		)
		if (gen !== generation) return
		payload.value = body
		fileStatus.value = "protected"
		// The password's job is done once the protected payload exists.
		password.value = null
	} catch (error) {
		if (gen !== generation) return
		openToast({ label: "Failed to protect the file", icon: "warning" }, 4_000)
	} finally {
		if (gen === generation) isBusy.value = false
	}
}

const fileName = computed(() => {
	// The profile name is user-typed: strip path separators and anything else
	// `chrome.downloads.download` can reject or misroute (a "foo/bar" name would create a
	// subdirectory; "../" is refused outright).
	const profile = (appStore.profile?.name ?? "profile").replace(/[^\p{L}\p{N}_-]+/gu, "_") || "profile"
	const addr = selectedAddress.value.slice(0, 10)
	return fileStatus.value === "protected" ? `NuloEncryptedAccount_${profile}_${addr}.txt` : `NuloAccount_${profile}_${addr}.json`
})

const handleDownload = async () => {
	if (isDownloading.value || isBusy.value) return
	isDownloading.value = true
	const gen = generation
	try {
		await downloadFile({ data: payload.value, filename: fileName.value })
		if (gen !== generation) return
		openToast({ label: "Account file downloaded", icon: "download" }, 2_000)
	} catch (err) {
		if (gen !== generation) return
		console.error("Download failed:", err?.message || err)
		openToast({ label: "Failed to download the file", icon: "warning" }, 4_000)
	} finally {
		if (gen === generation) isDownloading.value = false
	}
}

/** Enter advances the active stage, matching the flow's CTA (the popup this page replaced
 *  submitted on Enter). Download stages stay click-only: Enter re-firing a download is noise. */
const onKeydown = (e) => {
	if (e.key !== "Enter" || e.defaultPrevented) return
	if (!selectedAddress.value || fileStatus.value) return
	if (!isAgreed.value) handleAgree()
	else handleCreate()
}
onMounted(() => document.addEventListener("keydown", onKeydown))

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
	// The plain payload is spendable material; drop both secrets with the page and fence out any
	// export RPC still in flight.
	generation++
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

					<Flex v-if="selectedAccount?.type === AccountType.Imported" gap="8">
						<Icon name="warning" size="12" color="tertiary" style="height: 18px; flex-shrink: 0" />
						<Text size="12" weight="500" height="150" color="tertiary">
							This account is not covered by your recovery phrase. This file is its only backup.
						</Text>
					</Flex>
				</Flex>
			</div>
		</template>

		<!-- Bottom CTA per stage. CONDITIONAL template: the picker stage has no CTA, and an empty
		     slot would still make the layout render its bottom container as a bare border. -->
		<template v-if="selectedAddress" #bottom>
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
				<Button @click="handleProtect" :disabled="isBusy || isDownloading" variant="cta" data-testid="account-protect-btn">
					{{ isBusy ? "Protecting" : "Protect with Password" }}
				</Button>
				<Button @click="handleDownload" :disabled="isBusy || isDownloading" variant="cta_outline" data-testid="account-download-btn"> Download File </Button>
			</Flex>

			<Button v-else-if="fileStatus === 'protected'" @click="handleDownload" :disabled="isDownloading" variant="cta" data-testid="account-download-btn">
				Download File
			</Button>
		</template>
	</SecretExportLayout>
</template>
