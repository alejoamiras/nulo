<route lang="json">
{
	"meta": {
		"isAuthRequired": false
	}
}
</route>

<script setup>
/** Components */
import AuthProfilePill from "@/popup/components/modules/auth/AuthProfilePill.vue"
import PasskeyCeremonyDialog from "@/components/passkey/PasskeyCeremonyDialog.vue"

/** Composables */
import { awaitProfileActivation, BootstrapFailedError, UnlockTimeoutError } from "@/composables/unlockWait"
import { TOAST_DURATION, useToast } from "@/composables/toast"
import { usePasskeyCeremony } from "@/composables/usePasskeyCeremony"

/** Utils */
import { AccountServiceClient } from "@/wallet/services/account/client"
import { InvalidPasswordError, RestoreTornError, UserRejectedError } from "@nulo/extension-messaging/errors"
import { getLastActiveProfileId, setLastActiveProfileId } from "@/utils/lastActiveProfile"
import { initTransactionService, managers, refreshBalances } from "@/utils/core"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { usePopupStore } from "@/stores/popup.store.ts"
const appStore = useAppStore()
const popupStore = usePopupStore()

const { openToast } = useToast()

const router = useRouter()

// 30 s matches the e2e suite's dominant post-unlock envelope; the transport
// RPC bound is 60 s and the analogous import handshake allows 30 s.
const UNLOCK_WAIT_MS = 30_000

if (appStore.isLogined) {
	router.go(-1)
}

const passwordInput = ref(null)
const password = ref("")
const isWrongPassword = ref(false)
// The profile's backup import never finished (typed RestoreTornError from the
// unlock chokepoint): unlock is withheld — explain, and point at the existing
// delete + re-import path on this screen. Cleared on profile switch.
const isTornImport = ref(false)
const isPasswordType = ref(true)
const isAwaitingResponse = ref(false)

const isPasskeyProfile = computed(() => appStore.profile?.type === "passkey")

// Path A: in-page passkey ceremony. The dialog is mounted via `v-if="ceremonyRequest"`
// in the template; we drive it imperatively via `runCeremony` to keep the
// existing handleUnlockWallet flow shape intact.
const { request: ceremonyRequest, runCeremony, onResolve: onCeremonyResolve, onReject: onCeremonyReject } = usePasskeyCeremony()

const handlePasswordInput = () => {
	if (isWrongPassword.value) isWrongPassword.value = false
}

const isAllowedToContinue = computed(() => {
	if (isPasskeyProfile.value) return true
	if (!password.value.length) return false
	if (isWrongPassword.value) return false
	return true
})

/** The single post-unlock advance. Two sites want to leave this screen — the submit handler
 *  when its isLogined poll releases, and the isLogined watcher (which also covers unlocks this
 *  handler never sees, e.g. a silent restore landing here) — and both used to push blindly:
 *  the loser's late push yanked the user from wherever they had navigated to in the gap. The
 *  claim flag elects one winner atomically (a hash comparison alone cannot — the winner's
 *  navigation moves the hash only after async route resolution). The exact-path check keeps
 *  the advance on THIS screen only: a substring test also matched off-screen routes carrying
 *  `?from=/popup/auth` (profile import / new-profile from the select-profile popup). A failed
 *  navigation releases the claim so a later attempt isn't locked out. */
let postAuthNavClaimed = false
const advancePastAuth = async () => {
	if (postAuthNavClaimed) return
	if (window.location.hash.split("?")[0] !== "#/popup/auth") return
	postAuthNavClaimed = true
	const failure = await router.push(appStore.pageAwaitingAuth || "/popup/general")
	if (failure) postAuthNavClaimed = false
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 28) — refactor when touched, never raise
const handleUnlockWallet = async () => {
	if (!isAllowedToContinue.value) return
	// Reentry guard: two programmatic submits while the first unlock awaits
	// must not mint duplicate same-profile continuations.
	if (isAwaitingResponse.value) return

	try {
		let activeProfile
		try {
			isAwaitingResponse.value = true
			// A stale failure record from a PRIOR attempt must not insta-reject
			// this attempt's activation wait.
			appStore.bootstrapFailure = null
			if (isPasskeyProfile.value) {
				// Path A: pull credentialId so the ceremony targets THIS
				// profile's credential (not a discovery picker that would
				// let the user choose any of their passkeys).
				const credentialId = await managers.profile.getPasskeyCredentialId(appStore.profile.id)
				const credData = await runCeremony({ mode: "get", credentialId })
				activeProfile = await managers.profile.unlockPasskeyProfile(appStore.profile.id, credData)
			} else {
				activeProfile = await managers.profile.unlockProfile(appStore.profile.id, password.value)
			}
			if (!activeProfile?.id) return
			// Bounded, identity-aware, failure-joined wait — replaces an
			// unbounded isLogined poll whose finally was unreachable when
			// bootstrap starved it (bricked spinner). 30 s matches the e2e
			// suite's dominant post-unlock envelope (transport bound is 60 s;
			// the analogous import handshake allows 30 s).
			await awaitProfileActivation(appStore, activeProfile.id, UNLOCK_WAIT_MS)
		} catch (error) {
			// Service throws `InvalidPasswordError` (a WalletError subclass).
			// Client reconstructs the instance across the RPC boundary so the
			// instanceof check holds. Legacy-message fallback covers the
			// short window where the service has been redeployed but the
			// popup hasn't reloaded yet.
			const isInvalid =
				error instanceof InvalidPasswordError || (error instanceof Error && error.message === InvalidPasswordError.LEGACY_MESSAGE)
			if (isInvalid) isWrongPassword.value = true
			if (error instanceof RestoreTornError) {
				isTornImport.value = true
				return
			}
			// Path A user cancel surfaces here; silent return matches the
			// existing profile/new.vue behavior (no error toast on Escape /
			// "user closed").
			if (error instanceof UserRejectedError) return
			if (error instanceof UnlockTimeoutError) {
				// Silent yield when a DIFFERENT profile won the race — its UI is
				// live and a "try again" toast would race a successful
				// navigation. Otherwise the wait genuinely expired: say so.
				if (appStore.isLogined && appStore.profile?.id !== activeProfile?.id) return
				openToast({ label: "Unlock timed out — please try again", icon: "warning" }, TOAST_DURATION.LONG)
				return
			}
			if (error instanceof BootstrapFailedError) {
				// The shell already toasted the failure (with stale-suppression);
				// the join's job here is only to release the spinner immediately.
				return
			}
			return
		} finally {
			isAwaitingResponse.value = false
		}

		// IMMEDIATE post-wait identity check — the wait can resolve for this
		// profile and a different unlock can win before this continuation runs;
		// a stale continuation must have nothing to write (the redundant
		// `appStore.profile = activeProfile` assignment is gone for the same
		// reason: bootstrap already established identity).
		if (!appStore.isLogined || appStore.profile?.id !== activeProfile.id) return

		password.value = ""

		await setLastActiveProfileId(activeProfile.id)
		// Second identity check: the await above is its own drift window — a
		// resumed continuation must not replace the winner's managers.
		if (!appStore.isLogined || appStore.profile?.id !== activeProfile.id) return
		managers.account = new AccountServiceClient()

		initTransactionService(appStore.onTxAdded, appStore.onTxUpdated)

		void advancePastAuth()

		void appStore.syncTransactions().catch((err) => console.error(err))
		void refreshBalances(10, appStore.accounts).catch((err) => console.error(err))
	} catch (err) {
		console.error(err)
	}
}

onMounted(async () => {
	if (!isPasskeyProfile.value) {
		passwordInput.value?.focus()
	}

	const lastActiveProfileId = await getLastActiveProfileId()
	if (lastActiveProfileId) {
		const profile = (await managers.profile.getProfiles())?.find((p) => p.id === lastActiveProfileId)
		if (profile) appStore.profile = profile
	}
})
watch(
	() => appStore.profile?.id,
	() => {
		isTornImport.value = false
	},
)
watch(
	() => appStore.isLogined,
	async () => {
		if (appStore.isLogined) await advancePastAuth()
	},
)
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<Flex align="center" justify="center" :class="$style.top_row">
			<span :class="$style.wordmark">NULO</span>
		</Flex>

		<Flex direction="column" align="center" gap="32" :class="$style.main">
			<MaterialIcon name="lock" :size="48" color="primary" :class="$style.lock_icon" />

			<AuthProfilePill :name="appStore.profile?.name ?? ''" @click="popupStore.open('select_profile')" />

			<Flex direction="column" align="center" gap="8">
				<h1 :class="$style.heading">
					{{ isPasskeyProfile ? 'Passkey required' : 'Password required' }}
				</h1>
				<p :class="$style.subheading">
					{{ isPasskeyProfile ? 'Use your passkey to continue' : 'Enter your profile password to continue' }}
				</p>
			</Flex>

			<form @submit.prevent="handleUnlockWallet" :class="$style.form">
				<template v-if="!isPasskeyProfile">
					<div :class="[isWrongPassword && $style.shake]">
						<Input
							ref="passwordInput"
							v-model="password"
							@input="handlePasswordInput"
							:type="isPasswordType ? 'password' : 'text'"
							:error="isWrongPassword"
							:ariaInvalid="isWrongPassword"
							placeholder="Enter password"
							data-testid="auth-password-input"
							autocomplete="current-password"
							autocapitalize="none"
							autocorrect="off"
						>
							<template #suffix>
								<button
									type="button"
									tabindex="-1"
									@click="isPasswordType = !isPasswordType"
									:class="$style.visibility_btn"
									:aria-label="isPasswordType ? 'Show password' : 'Hide password'"
								>
									<MaterialIcon
										:name="isPasswordType ? 'visibility' : 'visibility_off'"
										:size="18"
										color="secondary"
									/>
								</button>
							</template>
						</Input>
					</div>
					<Transition name="fade">
						<span v-if="isWrongPassword" :class="$style.error_text" role="alert" data-testid="error-text">
							Wrong password
						</span>
					</Transition>
				</template>

				<Transition name="fade">
					<span v-if="isTornImport" :class="$style.error_text" role="alert" data-testid="auth-restore-torn">
						This profile's import didn't finish — delete it below and re-import your backup.
					</span>
				</Transition>

				<Button
					type="submit"
					data-testid="auth-submit"
					variant="cta"
					wide
					:disabled="!isAllowedToContinue || isAwaitingResponse"
					:loading="isAwaitingResponse"
				>
					Continue
				</Button>
			</form>
		</Flex>

		<Flex justify="center" :class="$style.footer">
			<Tooltip side="top" position="center" textAlign="center" maxWidth="220px">
				<button
					@click="popupStore.open('forgot_password')"
					type="button"
					data-testid="auth-reset"
					:class="$style.reset_link"
				>
					Delete profile
				</button>
				<template #content>
					Forgot your password? Delete this profile and re-import it with your recovery phrase.
				</template>
			</Tooltip>
		</Flex>

		<!-- Path A: in-page passkey ceremony. Mounts only while a ceremony is in
		     flight; emits resolve/reject back through `usePasskeyCeremony`. -->
		<PasskeyCeremonyDialog
			v-if="ceremonyRequest"
			:request="ceremonyRequest"
			@resolve="onCeremonyResolve"
			@reject="onCeremonyReject"
		/>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	padding: 24px;
}

.top_row {
	margin-bottom: 24px;
}

.wordmark {
	font-family: var(--font-headline);
	font-size: 20px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--txt-primary);
}

.main {
	flex: 1;
	justify-content: center;
	padding: 0 8px;
}

.lock_icon {
	color: var(--txt-primary);
}

.heading {
	font-family: var(--font-headline);
	font-size: 24px;
	font-weight: 600;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
	margin: 0;
	line-height: 1.2;
}

.subheading {
	font-family: var(--font-body);
	font-size: 13px;
	color: var(--nulo-secondary);
	text-align: center;
	margin: 0;
	line-height: 1.4;
}

.form {
	display: flex;
	flex-direction: column;
	gap: 16px;
	width: 100%;
	max-width: 320px;
}

.visibility_btn {
	display: flex;
	align-items: center;
	justify-content: center;

	background: transparent;
	border: none;
	cursor: pointer;

	padding: 4px 0 4px 8px;
}

.error_text {
	font-family: var(--font-body);
	font-size: 12px;
	color: var(--red);
	margin-top: -8px;
}

.footer {
	margin-top: 24px;
	padding: 8px;
}

.reset_link {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--nulo-secondary);

	background: transparent;
	border: none;
	cursor: pointer;

	padding: 4px 0;
	border-bottom: 1px solid transparent;

	transition: all 0.2s var(--bezier);

	&:hover {
		color: var(--nulo-accent);
		border-bottom-color: var(--nulo-accent);
	}
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
	animation: shakeInput 0.3s ease;
}
</style>
