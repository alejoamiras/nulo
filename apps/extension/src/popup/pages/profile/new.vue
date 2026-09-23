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
import { activateCreatedProfile, makeCreateKeydownHandler } from "./new-profile-helpers"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useNotificationStore } from "@/stores/notification.store"

/** Components */
import CollapsingHeroLayout from "@/components/composite/CollapsingHeroLayout.vue"
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
const onKeydown = makeCreateKeydownHandler(handleCreate)

onMounted(() => {
	document.addEventListener("keydown", onKeydown)
})

onBeforeUnmount(() => {
	dispose()
	document.removeEventListener("keydown", onKeydown)
})
</script>

<template>
	<CollapsingHeroLayout heroMain="Create" heroSub="Profile" collapsingLabel="Create Profile" :backTo="backTo">
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

		<template #bottom>
			<Button
				@click="handleCreate"
				:disabled="!isAllowedToContinue || isCreating"
				variant="cta"
				data-testid="register-submit-btn"
			>
				{{ isCreating ? "Creating…" : `Create with ${capitalize(type)}` }}
			</Button>
		</template>

		<template #overlay>
			<!-- Path A: in-page passkey ceremony for create flow. -->
			<PasskeyCeremonyDialog
				v-if="ceremonyRequest"
				:request="ceremonyRequest"
				@resolve="onCeremonyResolve"
				@reject="onCeremonyReject"
			/>
		</template>
	</CollapsingHeroLayout>
</template>

<style module>

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
