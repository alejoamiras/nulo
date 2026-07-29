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
/** Utils */
import { managers } from "@/utils/core"
import { storageLocalRemove } from "@/utils/storage"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

const router = useRouter()

const wrapperRef = useTemplateRef("wrapperRef")
const heroVisible = ref(true)
let scrollEl = null

const checks = reactive({
	permanent: false,
	undone: false,
	sure: false,
})

const confirmText = ref("")

const isReadyToReset = computed(() => checks.permanent && checks.undone && checks.sure && confirmText.value === appStore.profile?.name)

const isResetting = ref(false)

// The purge drains the profile's in-flight PXE work before erasing — a running
// proof legitimately holds that drain for up to ~30 minutes. Surface the wait
// once the delete has clearly outlived the quick path, so the disabled button
// reads as "working", not wedged.
const SLOW_DELETE_HINT_DELAY_MS = 10_000
const isSlowDelete = ref(false)
let slowDeleteTimer = null

const handleReset = async () => {
	if (!isReadyToReset.value || isResetting.value) return

	// Capture the id BEFORE awaiting — the delete emits onProfileDeleted, whose
	// handlers may null appStore.profile mid-await.
	const deletedId = appStore.profile.id

	// AWAIT the deletion: deleteProfile now drives the coordinator's full awaited
	// purge internally. If it REJECTS (e.g. the coordinator isn't ready, or a
	// purge failed and the tombstone was retained), we must NOT clear local state
	// or show success — the profile still exists and its data is mid-erase.
	isResetting.value = true
	slowDeleteTimer = setTimeout(() => {
		isSlowDelete.value = true
	}, SLOW_DELETE_HINT_DELAY_MS)
	try {
		await managers.profile.deleteProfile(deletedId)
	} catch (_err) {
		isResetting.value = false
		clearTimeout(slowDeleteTimer)
		isSlowDelete.value = false
		openToast({ label: "Couldn't delete profile — try again", icon: "warning" })
		return
	}
	isResetting.value = false
	clearTimeout(slowDeleteTimer)
	isSlowDelete.value = false

	appStore.profiles = appStore.profiles.filter((p) => p.id !== deletedId)
	appStore.profile = appStore.profiles.length && appStore.profiles[0]
	appStore.networks = []
	appStore.network = null
	appStore.accounts = []
	appStore.account = null
	appStore.clearActivity()
	storageLocalRemove("nulo:ui:feePaymentMethods")

	appStore.isLogined = false
	appStore.isSessionChecked = false

	// Note: onboardingCompleted intentionally persists across profile resets.
	// A user who has gone through onboarding once already knows about Aztec
	// and the accelerator; making them re-learn after a reset would be
	// patronizing. To restart onboarding, the user uninstalls + reinstalls
	// the extension (which wipes chrome.storage.local).

	openToast({ label: "Profile deleted", icon: "check-circle" })

	if (!appStore.profiles.length) {
		router.push("/popup/register")
	} else {
		router.push("/popup/auth")
	}
}

const handleScroll = () => {
	if (!scrollEl) return
	heroVisible.value = scrollEl.scrollTop < 40
}

onMounted(async () => {
	await nextTick()
	scrollEl = wrapperRef.value?.wrapper
	if (!scrollEl) return
	scrollEl.addEventListener("scroll", handleScroll, { passive: true })
	handleScroll()
})

onBeforeUnmount(() => {
	scrollEl?.removeEventListener("scroll", handleScroll)
	scrollEl = null
	if (slowDeleteTimer) clearTimeout(slowDeleteTimer)
})
</script>

<template>
	<Flex direction="column" :class="$style.page" :data-profile-name="appStore.profile?.name ?? ''">
		<Flex ref="wrapperRef" direction="column" :class="$style.wrapper">
			<SubPageHeader :backTo="'/popup/settings/profile'">
				<template #title>
					<span :class="[$style.collapsing_label, !heroVisible && $style.collapsing_label_visible]">Delete Profile</span>
				</template>
			</SubPageHeader>

			<Flex direction="column" :class="$style.content">
				<!-- Hero -->
				<div :class="$style.hero">
					<div :class="$style.title_stack">
						<span :class="$style.title_main">Delete</span>
						<span :class="$style.title_sub">Profile</span>
					</div>
					<div :class="$style.hero_bar" />
				</div>

				<!-- Profile -->
				<div :class="$style.section">
					<span :class="$style.section_label">Profile to delete</span>
					<ItemsContainer flat>
						<SettingItem :title="appStore.profile?.name ?? ''" icon="user" raw />
					</ItemsContainer>
				</div>

				<!-- Agreements -->
				<div :class="$style.section">
					<span :class="$style.section_label">Agreements required</span>
					<Flex direction="column" gap="12">
						<Checkbox v-model="checks.permanent" data-testid="reset-checkbox-permanent">
							<Text size="14" weight="600" color="secondary" height="140">I understand this action is permanent</Text>
						</Checkbox>
						<Checkbox v-model="checks.undone" data-testid="reset-checkbox-undone">
							<Text size="14" weight="600" color="secondary" height="140">I understand this action cannot be undone</Text>
						</Checkbox>
						<Checkbox v-model="checks.sure" data-testid="reset-checkbox-sure">
							<Text size="14" weight="600" color="secondary" height="140">I'm sure there's no assets left in my profile</Text>
						</Checkbox>
					</Flex>
				</div>

				<!-- Confirmation -->
				<div :class="$style.section_last">
					<span :class="$style.section_label">Confirm deletion</span>
					<Input
						v-model="confirmText"

						type="text"
						label="Profile name"
						:placeholder="`Type &quot;${appStore.profile?.name}&quot; to confirm`"
						data-testid="reset-confirm-input"
					/>
					<Text size="12" weight="500" color="tertiary" height="150">
						You will be able to recover your profile later if you have saved the seed phrase or secret key
					</Text>
				</div>
			</Flex>
		</Flex>

		<div :class="$style.bottom">
			<Text v-if="isSlowDelete" size="12" color="secondary" data-testid="reset-wait-hint">
				Waiting for an in-flight operation to finish — this can take up to ~30 minutes while a
				transaction is proving. Keep this window open.
			</Text>
			<Button @click="handleReset" :disabled="!isReadyToReset || isResetting" variant="cta_destructive" data-testid="reset-submit-btn">
				{{ isResetting ? "Deleting…" : "Delete Profile" }}
			</Button>
		</div>
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
	color: var(--red);
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
	background: var(--red);
	margin-top: 10px;
}

.section {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 20px 0;
	border-bottom: 1px solid rgba(35, 31, 28, 1);
}

.section:last-child {
	border-bottom: none;
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

.cta {
	width: 100%;
	border: none;

	background: var(--nulo-accent);
	color: var(--txt-inverse);

	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: 0.2em;
	text-transform: uppercase;

	padding: 20px 0;
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: #fff;
	}

	&:active {
		background: var(--txt-primary);
		color: var(--app-bg);
		transition: none;
	}

	&:disabled {
		opacity: 0.3;
		pointer-events: none;
	}

	&:focus-visible {
		outline: 2px dotted var(--nulo-accent);
		outline-offset: 2px;
	}
}

.cta_red {
	background: var(--red);
	color: #fff;
}
</style>
