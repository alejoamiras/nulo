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
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

/** Composables */
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"
import { useProfileNameField } from "@/composables/useProfileNameField"

/** Services */
import { AccountServiceClient } from "@/wallet/services/account/client"

/** Utils */
import { managers, setSentinel, initTransactionService } from "@/utils/core"
import { setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { capitalize } from "@/utils/string"
import { sleep } from "@/wallet/utils"
import { createPasskeyProfileWithRetry } from "@/wallet/utils/create-passkey-profile"
import { redirectToOnboardingTabIfNeeded } from "@/wallet/utils/onboarding-tab"
import { UserRejectedError } from "@nulo/extension-messaging/errors"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"
const appStore = useAppStore()
const notificationStore = useNotificationStore()

const route = useRoute()
const router = useRouter()

// Deep-link bypass: redirect to onboarding tab when no profile exists AND
// onboarding hasn't been completed. Same predicate as register + import,
// shared via @/wallet/utils/onboarding-tab.
onBeforeMount(() => redirectToOnboardingTabIfNeeded(appStore))

const backTo = computed(() => String(route.query.from || "/popup/register"))

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

const type = ref("password")
const password = ref("")
const repeatedPassword = ref("")
const maxPasswordLength = 128

// Profile name is required. Validated at submit time (not via :disabled) so
// the user gets a visible shake + inline error instead of a silently-disabled
// button. nameError clears on input.
const {
	profileName,
	trimmedName,
	nameError,
	shakeName,
	nameInputRef,
	validate: validateName,
	handleInput: handleNameInput,
	dispose: disposeNameField,
} = useProfileNameField()

const isAllowedToContinue = computed(() => {
	// Name validation runs at submit time (shake + inline error); excluded
	// here on purpose so an empty name doesn't silently disable the button.
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
 *  collected credential. Retries ONCE on ProfileIdConflictError via the
 *  shared helper at @/wallet/utils/create-passkey-profile. */
function createPasskeyProfileViaModal(name) {
	return createPasskeyProfileWithRetry(name, {
		runCeremony,
		generateProfileId: () => managers.profile.generateProfileId(),
		createPasskeyProfile: (n, c) => managers.profile.createPasskeyProfile(n, c),
	})
}

const isCreating = ref(false)
const handleCreate = async () => {
	if (!isAllowedToContinue.value || isCreating.value) return

	// Latch FIRST, before the async getProfiles() fetch: two rapid clicks
	// both hit the pre-check on the same tick, and without an early latch
	// they'd race past it and create two profiles.
	isCreating.value = true

	const existingNames = (await managers.profile.getProfiles()).map((p) => p.name)
	if (!validateName({ existingNames })) {
		isCreating.value = false
		return
	}
	const name = trimmedName.value

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
	disposeNameField()
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

				<div :class="$style.section_last">
					<span :class="$style.section_label">Profile name</span>
					<div :class="[shakeName && $style.shake]">
						<Input
							ref="nameInputRef"
							v-model="profileName"
							type="text"
							placeholder="My Profile"
							:maxLength="32"
							:error="!!nameError"
							:ariaInvalid="!!nameError"
							sanitize
							data-testid="register-name-input"
							@input="handleNameInput"
						/>
					</div>
					<Text v-if="nameError" size="12" color="red" height="150" role="alert">
						{{ nameError }}
					</Text>
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

@keyframes shakeInput {
	0% { transform: translateX(0); }
	20% { transform: translateX(-4px); }
	40% { transform: translateX(4px); }
	60% { transform: translateX(-3px); }
	80% { transform: translateX(2px); }
	100% { transform: translateX(0); }
}

.shake {
	animation: shakeInput 0.4s ease;
}
</style>
