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
/** Composables */
import { useProfileCreateFlow } from "@/composables/useProfileCreateFlow"

/** Utils */
import { capitalize } from "@/utils/string"
import { redirectToOnboardingTabIfNeeded } from "@/wallet/utils/onboarding-tab"
import { activateCreatedProfile, shouldHandleEnter } from "./new-profile-helpers"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"

/** Components */
import NewProfileCredentials from "@/popup/components/modules/settings/new-profile/NewProfileCredentials.vue"
import NewProfileMethodTabs from "@/popup/components/modules/settings/new-profile/NewProfileMethodTabs.vue"
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

const appStore = useAppStore()
const notificationStore = useNotificationStore()

const route = useRoute()
const router = useRouter()

// Deep-link bypass: redirect to onboarding tab when no profile exists AND
// onboarding hasn't been completed. Same predicate as register + import.
onBeforeMount(() => redirectToOnboardingTabIfNeeded(appStore))

const backTo = computed(() => String(route.query.from || "/popup/register"))

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

const maxPasswordLength = 128

const {
	profileName,
	nameError,
	shakeName,
	nameInputRef,
	handleNameInput,
	ceremonyRequest,
	onCeremonyResolve,
	onCeremonyReject,
	authMethod: type,
	password,
	repeatedPassword,
	isCreating,
	strengthHint,
	isAllowedToContinue,
	handleCreate,
	dispose,
} = useProfileCreateFlow({
	// Popup activation is listener-based (app.vue's onActiveProfileChanged runs
	// the bootstrap); this manual tail waits for it, loads accounts, persists
	// the active account, and routes. Extracted to a testable page helper.
	onCreated: (profile) => activateCreatedProfile(profile, { appStore, router }),
	notifyCreateFailed: (isPasskey) => {
		notificationStore.create({
			type: "warning",
			payload: {
				title: "Profile creation failed",
				description: isPasskey
					? "An error occurred while creating the profile. This authenticator may not be supported or encountered an issue. Try again or use another one."
					: "An error occurred while creating the profile. Please try again.",
				note: isPasskey ? "Windows Hello may not work correctly with some versions of Windows." : undefined,
				confirmText: "OK",
				onConfirm: () => {},
			},
		})
	},
})

// Quirk 2: only submit on Enter from a text field, so Enter on a focused
// button doesn't double-fire alongside its native click.
const onKeydown = (e) => {
	if (shouldHandleEnter(e)) handleCreate()
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
	dispose()
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
