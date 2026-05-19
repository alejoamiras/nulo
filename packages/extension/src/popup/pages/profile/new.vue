<route lang="json">
{
	"meta": {
		"isAuthRequired": false,
		"hideHeader": true,
		"showBottomNav": false
	}
}
</route>

<script setup>
/** Components */
import NewProfileCredentials from "@/popup/components/modules/settings/new-profile/NewProfileCredentials.vue"
import NewProfileMethodTabs from "@/popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue"
import PasskeyCeremonyDialog from "@/popup/components/popups/PasskeyCeremonyDialog.vue"

/** Composables */
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"

/** Services */
import { AccountServiceClient } from "@/wallet/services/account/client"

/** Utils */
import { managers, setSentinel, initTransactionService } from "@/utils/core"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { capitalize } from "@/utils/string"
import { sleep } from "@/wallet/utils"
import { ProfileIdConflictError, UserRejectedError } from "@nulo/extension-messaging/errors"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"
const appStore = useAppStore()
const notificationStore = useNotificationStore()

const route = useRoute()
const router = useRouter()

const backTo = computed(() => String(route.query.from || "/popup/register"))

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

const type = ref("password")
const password = ref("")
const repeatedPassword = ref("")
const maxPasswordLength = 128

const isAllowedToContinue = computed(() => {
	if (type.value === "passkey") return true
	if (!password.value.length || password.value.length < 8) return false
	if (!repeatedPassword.value || password.value !== repeatedPassword.value) return false
	return true
})

const strengthHint = computed(() => {
	if (type.value === "passkey") return ""
	if (!password.value || password.value.length < 8) return "At least 8 characters"
	if (password.value !== repeatedPassword.value) return "Passwords don't match"
	if (password.value.length > 24) return "Long enough. Don't forget it."
	return "Strong password"
})

// Path A: in-page passkey ceremony for create flow.
const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

/** Run the passkey-create ceremony in-page, then call the SW with the
 *  collected credential. Retries ONCE on `ProfileIdConflictError` —
 *  the pre-reserved id was claimed during the WebAuthn prompt; we
 *  re-run the entire ceremony with a fresh id (and a fresh credential)
 *  to keep the credential's userHandle in sync with the persisted
 *  profile id. */
async function createPasskeyProfileViaModal(name) {
	const MAX_RETRIES = 1
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const profileId = await managers.profile.generateProfileId()
		const credData = await runCeremony({ mode: "create", userHandle: profileId })
		try {
			return await managers.profile.createPasskeyProfile(name, credData)
		} catch (e) {
			if (e instanceof ProfileIdConflictError && attempt < MAX_RETRIES) {
				// Loop and try again with a fresh id + fresh ceremony.
				continue
			}
			throw e
		}
	}
	throw new Error("createPasskeyProfile retried beyond MAX_RETRIES")
}

const isCreating = ref(false)
const handleCreate = async () => {
	if (!isAllowedToContinue.value || isCreating.value) return

	isCreating.value = true

	const profiles = await managers.profile.getProfiles()
	const name = `Profile ${profiles.length + 1}`
	let profile
	try {
		profile =
			type.value === "passkey" ? await createPasskeyProfileViaModal(name) : await managers.profile.createProfile(name, password.value)
	} catch (e) {
		// Path A user cancel: silent return (matches prior behavior of
		// skipping the warning toast for "user closed" / "timed out or not
		// allowed" — now via typed boundary instead of string-matching).
		if (e instanceof UserRejectedError) {
			isCreating.value = false
			return
		}
		const description =
			type.value === "passkey"
				? "An error occurred while creating the profile. This authenticator may not be supported or encountered an issue. Try again or use another one."
				: "An error occurred while creating the profile. Please try again."
		const note = type.value === "passkey" ? "Windows Hello may not work correctly with some versions of Windows." : undefined

		notificationStore.create({
			type: "warning",
			payload: {
				title: "Profile Creation Failed",
				description,
				note,
				confirmText: "OK",
				onConfirm: () => {},
			},
		})

		console.error("Failed to create profile:", e)
		isCreating.value = false
		return
	}

	while (!appStore.isLogined) {
		await sleep(100)
	}

	managers.account = new AccountServiceClient()

	appStore.profile = profile
	await setLastActiveProfileId(profile.id)
	if (!appStore.network) throw new Error("Network not set")
	appStore.accounts = await managers.account.getAccounts(profile.id, appStore.network.chainId, true)

	initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)

	await chrome.storage.local.set({
		"nulo:ui:activeAccount": appStore.account?.address,
	})

	await setSentinel()

	isCreating.value = false

	router.push("/popup/general")
}

const onKeydown = (e) => {
	if (e.key === "Enter") handleCreate()
}

const handleScroll = () => {
	if (!scrollEl) return
	heroVisible.value = scrollEl.scrollTop < 40
}

onMounted(async () => {
	document.addEventListener("keydown", onKeydown)
	await nextTick()
	scrollEl = wrapperRef.value?.wrapper
	if (!scrollEl) return
	scrollEl.addEventListener("scroll", handleScroll, { passive: true })
	handleScroll()
})

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown)
	scrollEl?.removeEventListener("scroll", handleScroll)
	scrollEl = null
})
</script>

<template>
	<Flex direction="column" :class="$style.page">
		<Flex ref="wrapperRef" direction="column" :class="$style.wrapper">
			<SubPageHeader :backTo="backTo">
				<template #title>
					<span :class="[$style.collapsing_label, !heroVisible && $style.collapsing_label_visible]">Create Profile</span>
				</template>
			</SubPageHeader>

			<Flex direction="column" :class="$style.content">
				<!-- Hero -->
				<div :class="$style.hero">
					<div :class="$style.title_stack">
						<span :class="$style.title_main">Create</span>
						<span :class="$style.title_sub">Profile</span>
					</div>
					<div :class="$style.hero_bar" />
				</div>

				<NewProfileMethodTabs v-model:type="type" />

				<NewProfileCredentials
					v-if="type === 'password'"
					v-model:password="password"
					v-model:repeatedPassword="repeatedPassword"
					:maxPasswordLength="maxPasswordLength"
					:strengthHint="strengthHint"
				/>

				<!-- Passkey info -->
				<div v-else :class="$style.section_last">
					<span :class="$style.section_label">Passkey</span>
					<Text size="13" height="150" color="body">
						No password required. Your new profile will be linked to your passkey, so you can sign in securely and effortlessly — no memorizing, no typing, just one tap.
					</Text>
				</div>
			</Flex>
		</Flex>

		<div :class="$style.bottom">
			<Button
				@click="handleCreate"
				:disabled="!isAllowedToContinue || isCreating"
				variant="cta"
				data-testid="register-submit-btn"
			>
				{{ isCreating ? "Creating…" : `Create with ${capitalize(type)}` }}
			</Button>
		</div>

		<!-- Path A: in-page passkey ceremony for create flow. -->
		<PasskeyCeremonyDialog
			v-if="ceremonyRequest"
			:request="ceremonyRequest"
			@resolve="onCeremonyResolve"
			@reject="onCeremonyReject"
		/>
	</Flex>
</template>

<style module>
.page {
	flex: 1;
	min-height: 0;
	background: var(--app-bg);
}

.wrapper {
	flex: 1;
	min-height: 0;
	overflow: auto;
	scrollbar-gutter: stable;
}

.collapsing_label {
	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-primary);

	text-decoration: underline;
	text-decoration-color: var(--nulo-accent);
	text-decoration-thickness: 2px;
	text-underline-offset: 4px;

	opacity: 0;
	pointer-events: none;

	transition: opacity 0.18s cubic-bezier(0.4, 0, 1, 1);
}

.collapsing_label_visible {
	opacity: 1;
	pointer-events: auto;
}

.content {
	flex: 1;
	padding: 0 24px;
}

.hero {
	padding: 20px 0;
}

.title_stack {
	display: flex;
	flex-direction: column;
	line-height: 1.02;
}

.title_main {
	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-accent);
}

.title_sub {
	font-family: var(--font-headline);
	font-size: 40px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.hero_bar {
	width: 32px;
	height: 2px;
	background: var(--nulo-accent);
	margin-top: 10px;
}

.section_last {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
}

.section_label {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.18em;
	color: var(--nulo-secondary);
}

.bottom {
	flex-shrink: 0;
	padding: 20px 24px;
	background: var(--app-bg);
	border-top: 1px solid var(--nulo-border);
}
</style>
