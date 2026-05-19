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

const handleReset = async () => {
	if (!isReadyToReset.value) return

	managers.profile.deleteProfile(appStore.profile.id)

	appStore.profiles = appStore.profiles.filter((p) => p.id !== appStore.profile.id)
	appStore.profile = appStore.profiles.length && appStore.profiles[0]
	appStore.networks = []
	appStore.network = null
	appStore.accounts = []
	appStore.account = null
	appStore.transactions = []
	appStore.awaitingTransactions = []
	chrome.storage.local.remove("nulo:ui:feePaymentMethods")

	appStore.isLogined = false
	appStore.isSessionChecked = false

	// Clearing the last profile? Send the user back through onboarding next
	// time. Without this, a wallet-reset user would skip the Aztec primer
	// and accelerator setup on their next install attempt.
	if (!appStore.profiles.length) {
		await appStore.setOnboardingCompleted(false)
	}

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
			<Button @click="handleReset" :disabled="!isReadyToReset" variant="cta_destructive" data-testid="reset-submit-btn">
				Delete Profile
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
	color: #0a0908;

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
