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

/** Async-result fence. Every edit AND the unmount bump it; a preview or file read that resolves
 *  under a stale generation is dropped, so an in-flight RPC can neither repopulate a preview the
 *  user just invalidated by editing, nor write secrets back after the page scrubbed them. */
let generation = 0

/** A plain account file is a JSON envelope; anything else is the protected base64 blob and
 *  needs the password it was exported with. */
const isProtectedFile = computed(() => fileBody.value.trim().length > 0 && !fileBody.value.trim().startsWith("{"))
const needsConfirm = computed(() => previewAddress.value.length > 0)

/** The fileBody watcher clears the chip name on PASTED edits; a pick sets both together, and the
 *  (async-flushed) watcher must not erase the name it just set. */
let bodySetByPick = false

const handlePickFile = async () => {
	const gen = generation
	try {
		const picked = await pickFile()
		if (!picked) return
		const text = (await picked.text()).trim()
		if (gen !== generation) return
		bodySetByPick = true
		fileBody.value = text
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
	const gen = generation
	try {
		const address = await managers.account.previewImportAccount(fileBody.value.trim(), password.value)
		if (gen !== generation) return
		previewAddress.value = address
	} catch (err) {
		if (gen !== generation) return
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
// invalidates it — including a preview RPC still in flight (generation bump) — so the user must
// re-preview (the service also recomputes and rejects a stale confirmation, but this keeps the UI
// honest). A pasted edit also unbinds the chip from the previously picked file's name.
watch([fileBody, password], ([newBody], [oldBody]) => {
	generation++
	previewAddress.value = ""
	if (newBody !== oldBody && fileName.value && !bodySetByPick) fileName.value = ""
	bodySetByPick = false
})

// Flipping from a protected body to a plain one orphans the file password; drop it so it cannot
// silently ride along into a later preview.
watch(isProtectedFile, (nowProtected) => {
	if (!nowProtected) password.value = ""
})

/** Enter submits the active step, matching the popup this page replaced. */
const onKeydown = (e) => {
	if (e.key !== "Enter") return
	if (needsConfirm.value) handleConfirmImport()
	else handlePreview()
}
onMounted(() => document.addEventListener("keydown", onKeydown))

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
	// The body is spendable material (a plain file carries the signing key); scrub with the page
	// and fence out any RPC or file read still in flight.
	generation++
	fileBody.value = ""
	password.value = ""
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
