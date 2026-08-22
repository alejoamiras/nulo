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
const accountName = ref("")
const previewAddress = ref("")
const error = ref("")
const isBusy = ref(false)

/** Async-result fence. Every edit AND the unmount bump it; a preview or file read that resolves
 *  under a stale generation is dropped, so an in-flight RPC can neither repopulate a preview the
 *  user just invalidated by editing, nor write secrets back after the page scrubbed them. */
let generation = 0

/** A plain account file is a JSON envelope; anything else is the protected base64 blob and
 *  needs the password it was exported with. */
const isProtectedFile = computed(() => fileBody.value.trim().length > 0 && !fileBody.value.trim().startsWith("{"))
const needsConfirm = computed(() => previewAddress.value.length > 0)

const handlePickFile = async () => {
	const gen = generation
	try {
		const picked = await pickFile()
		if (!picked) return
		const text = (await picked.text()).trim()
		if (gen !== generation) return
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
	if (!needsConfirm.value || !accountName.value.trim() || isBusy.value) return
	isBusy.value = true
	error.value = ""
	const gen = generation
	// Scope snapshot: the RPC imports into THESE ids, so the UI write-back below must only touch
	// a store still showing them (a background profile/chain change can land without unmounting).
	const profileId = appStore.profile.id
	const chainId = appStore.network.chainId
	const isStale = () => gen !== generation || appStore.profile?.id !== profileId || appStore.network?.chainId !== chainId
	try {
		const account = await managers.account.importAccount(
			profileId,
			chainId,
			fileBody.value.trim(),
			previewAddress.value,
			password.value,
			accountName.value.trim(),
		)
		// The import itself is committed service-side; the fences only guard the UI-scope writes.
		// A confirm resolving after the page died (or after the scope moved) must not push an old
		// scope's account into whatever store is current, flip the active pointer, or toast+route
		// from beyond the grave. Re-checked after EVERY await: the scope can also move while the
		// active-pointer persist is in flight.
		if (isStale()) return
		appStore.accounts.push(account)
		await storageLocalSet({ "nulo:ui:activeAccount": account.address })
		if (isStale()) return
		openToast({ label: "Account imported", icon: "check-circle" }, 2_000)
		// History-aware return (the SubPageHeader back arrow is history-first): a push would leave
		// this page one Back away from the account list it just finished with.
		if (window.history.length > 1) router.back()
		else router.replace("/popup/settings/accounts")
	} catch (err) {
		if (isStale()) return
		error.value = err instanceof Error ? err.message : String(err)
	} finally {
		isBusy.value = false
	}
}

// A confirmed address is only valid for the exact body+password it was previewed from. Any edit
// invalidates it — including a preview RPC still in flight (generation bump) — so the user must
// re-preview (the service also recomputes and rejects a stale confirmation, but this keeps the UI
// honest).
watch([fileBody, password], () => {
	generation++
	previewAddress.value = ""
})

// Flipping from a protected body to a plain one orphans the file password; drop it so it cannot
// silently ride along into a later preview.
watch(isProtectedFile, (nowProtected) => {
	if (!nowProtected) password.value = ""
})

/** Enter submits the active step, matching the popup this page replaced. Controls that handle
 *  Enter themselves (the file row) call preventDefault, so deferring to `defaultPrevented`
 *  keeps one keypress from opening the picker AND previewing at once. */
const onKeydown = (e) => {
	if (e.key !== "Enter" || e.defaultPrevented) return
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

const collapsingLabel = "Import Account"
</script>

<template>
	<SecretExportLayout heroMain="Import" heroSub="Account" :collapsingLabel="collapsingLabel" backTo="/popup/settings/accounts">
		<!-- Step 1: the file (the full-backup restore's picker pattern). The section divider only
		     exists when the password section actually follows — `export_section`'s border-bottom
		     separates it from a NEXT section, and a plain file has none. -->
		<template v-if="!needsConfirm">
			<div :class="isProtectedFile ? 'export_section' : 'export_section_last'">
				<span class="export_section_label">Account file</span>
				<ItemsContainer flat>
					<SettingItem
						@click="handlePickFile"
						@keydown.enter.prevent="handlePickFile"
						@keydown.space.prevent="handlePickFile"
						title="Choose an account file"
						:description="fileName || 'Select a .json or .txt file'"
						icon="key"
						:iconBgColor="error ? 'red' : fileBody ? 'blue' : 'gray'"
						chevron
						:disabled="isBusy"
						data-testid="import-account-pick-file"
					/>
				</ItemsContainer>
				<Flex v-if="error" align="center" gap="6" data-testid="import-account-error">
					<Icon name="warning" size="12" color="red" />
					<Text size="12" weight="600" color="red" height="140">{{ error }}</Text>
				</Flex>
			</div>

			<!-- Step 2 (protected files only): the file password -->
			<div v-if="isProtectedFile" class="export_section_last">
				<span class="export_section_label">Protected file</span>
				<Input
					label="File password"
					type="password"
					placeholder="Password used when exporting"
					data-testid="import-account-password-input"
					v-model="password"
				/>
			</div>
		</template>

		<!-- Step 3: preview + confirm -->
		<template v-else>
			<div class="export_section">
				<span class="export_section_label">You are importing</span>
				<ItemsContainer flat>
					<SettingItem
						size="large"
						:title="accountName.trim() || 'Account'"
						:description="trimAddress(previewAddress, 8, 6, '...')"
						icon="user"
						raw
						data-testid="import-account-preview"
						:data-account-address="previewAddress"
					/>
				</ItemsContainer>
			</div>

			<div class="export_section_last">
				<span class="export_section_label">Account name</span>
				<Input
					label="Name"
					placeholder="Name this account"
					:maxLength="40"
					:disabled="isBusy"
					data-testid="import-account-name-input"
					v-model="accountName"
				/>
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

			<Button
				v-else
				@click="handleConfirmImport"
				:disabled="!accountName.trim() || isBusy"
				variant="cta"
				data-testid="import-account-submit"
			>
				Import Account
			</Button>
		</template>
	</SecretExportLayout>
</template>
