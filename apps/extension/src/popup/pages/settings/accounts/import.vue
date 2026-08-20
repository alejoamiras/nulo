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

/** Services */
import { managers } from "@/utils/core"

/** Utils */
import { pickFile } from "@/utils"
import { trimAddress } from "@/utils/string"
import { storageLocalSet } from "@/utils/storage"

/** Composables */
import { useToast } from "@/composables/toast.js"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

const fileBody = ref("")
const fileName = ref("")
const password = ref("")
const previewAddress = ref("")
const error = ref("")
const isBusy = ref(false)
const showPaste = ref(false)

/** A plain account file is a JSON envelope; anything else is the protected base64 blob and
 *  needs the password it was exported with. */
const isProtectedFile = computed(() => fileBody.value.trim().length > 0 && !fileBody.value.trim().startsWith("{"))
const needsConfirm = computed(() => previewAddress.value.length > 0)

const handlePickFile = async () => {
	try {
		const picked = await pickFile()
		if (!picked) return
		fileBody.value = (await picked.text()).trim()
		fileName.value = picked.name ?? ""
		error.value = ""
	} catch {
		// Cancelled picker: leave the form as-is.
	}
}

/** Decode + recompute the address SW-side, then show it for the user to confirm. */
const handlePreview = async () => {
	if (!fileBody.value.trim() || isBusy.value) return
	if (isProtectedFile.value && !password.value) return
	isBusy.value = true
	error.value = ""
	try {
		previewAddress.value = await managers.account.previewImportAccount(fileBody.value.trim(), password.value)
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err)
	} finally {
		isBusy.value = false
	}
}

/** The user confirmed the previewed address; write the account and return to the list. */
const handleConfirmImport = async () => {
	if (!needsConfirm.value || isBusy.value) return
	isBusy.value = true
	error.value = ""
	try {
		const account = await managers.account.importAccount(
			appStore.profile.id,
			appStore.network.chainId,
			fileBody.value.trim(),
			previewAddress.value,
			password.value,
		)
		appStore.accounts.push(account)
		await storageLocalSet({ "nulo:ui:activeAccount": account.address })
		openToast({ label: "Account imported", icon: "check-circle" }, 2_000)
		router.push("/popup/settings/accounts")
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err)
	} finally {
		isBusy.value = false
	}
}

// A confirmed address is only valid for the exact body+password it was previewed from. Any edit
// invalidates it so the user must re-preview (the service also recomputes and rejects a stale
// confirmation, but this keeps the UI honest).
watch([fileBody, password], () => {
	previewAddress.value = ""
})

const collapsingLabel = computed(() => (needsConfirm.value ? "Confirm" : "Import"))
</script>

<template>
	<SecretExportLayout heroMain="Import" heroSub="Account" :collapsingLabel="collapsingLabel" backTo="/popup/settings/accounts">
		<!-- Step 1: the file -->
		<template v-if="!needsConfirm">
			<div class="export_section">
				<span class="export_section_label">Account file</span>
				<Flex direction="column" gap="10">
					<Flex
						@click="handlePickFile"
						align="center"
						gap="10"
						:class="$style.file_chip"
						role="button"
						tabindex="0"
						@keydown.enter.prevent="handlePickFile"
						@keydown.space.prevent="handlePickFile"
						data-testid="import-account-pick-file"
					>
						<Icon :name="isProtectedFile ? 'lock' : 'brackets'" size="16" color="secondary" />
						<Text size="12" weight="600" :color="fileName || fileBody ? 'primary' : 'tertiary'" mono :class="$style.file_name">
							{{ fileName || (fileBody ? "Pasted file contents" : "Choose a file") }}
						</Text>
					</Flex>

					<Text
						v-if="!showPaste"
						@click="showPaste = true"
						size="12"
						weight="600"
						color="tertiary"
						align="center"
						:class="$style.paste_link"
						role="button"
						tabindex="0"
						@keydown.enter.prevent="showPaste = true"
						data-testid="import-account-paste-toggle"
					>
						or paste the file contents
					</Text>

					<Input
						v-if="showPaste"
						label="File contents"
						placeholder="Paste the account file contents"
						data-testid="import-account-body-input"
						v-model="fileBody"
					/>
				</Flex>
			</div>

			<!-- Step 2 (protected files only): the file password -->
			<div v-if="isProtectedFile" class="export_section">
				<span class="export_section_label">Protected file</span>
				<Input
					label="File password"
					type="password"
					placeholder="Password used when exporting"
					data-testid="import-account-password-input"
					v-model="password"
				/>
			</div>

			<div class="export_section_last">
				<Flex v-if="error" align="center" gap="6" data-testid="import-account-error">
					<Icon name="warning" size="12" color="red" />
					<Text size="12" weight="600" color="red" height="140">{{ error }}</Text>
				</Flex>
			</div>
		</template>

		<!-- Step 3: preview + confirm -->
		<template v-else>
			<div class="export_section">
				<span class="export_section_label">You are importing</span>
				<ItemsContainer flat>
					<SettingItem
						size="large"
						title="Imported account"
						:description="trimAddress(previewAddress, 8, 6, '...')"
						icon="user"
						raw
						data-testid="import-account-preview"
					/>
				</ItemsContainer>
				<Text size="11" color="tertiary" mono :class="$style.full_address" data-testid="import-account-preview-address">
					{{ previewAddress }}
				</Text>
			</div>

			<div class="export_section_last">
				<Flex direction="column" gap="8">
					<Text size="12" weight="500" height="150" color="tertiary">
						The address is recomputed from the file. Confirm it matches the account you expect.
					</Text>
					<Text size="12" weight="500" height="150" color="tertiary">
						This account is not covered by your recovery phrase. Keep its file safe.
					</Text>
				</Flex>
				<Flex v-if="error" align="center" gap="6" data-testid="import-account-error">
					<Icon name="warning" size="12" color="red" />
					<Text size="12" weight="600" color="red" height="140">{{ error }}</Text>
				</Flex>
			</div>
		</template>

		<!-- Bottom CTA -->
		<template #bottom>
			<Button
				v-if="!needsConfirm"
				@click="handlePreview"
				:disabled="!fileBody.trim() || (isProtectedFile && !password) || isBusy"
				variant="cta"
				data-testid="import-account-submit"
			>
				{{ isProtectedFile ? "Unlock File" : "Continue" }}
			</Button>

			<Button v-else @click="handleConfirmImport" :disabled="isBusy" variant="cta" data-testid="import-account-submit">
				Import Account
			</Button>
		</template>
	</SecretExportLayout>
</template>

<style module>
.file_chip {
	background: var(--card-bg);
	border: 1px dashed var(--nulo-outline);
	border-radius: 12px;
	padding: 14px 12px;
	cursor: pointer;
	transition: border-color 0.2s var(--bezier);
}

.file_chip:hover {
	border-color: var(--nulo-secondary);
}

.file_name {
	overflow-wrap: anywhere;
}

.paste_link {
	cursor: pointer;
}

.paste_link:hover {
	text-decoration: underline;
}

.full_address {
	overflow-wrap: anywhere;
	padding: 0 4px;
}
</style>
