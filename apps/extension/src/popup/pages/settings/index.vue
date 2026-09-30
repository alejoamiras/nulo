<route lang="json">
{
	"meta": {
		"title": "Settings",
		"isAuthRequired": true,
		"showBottomNav": true
	}
}
</route>

<script setup>
/** Services */
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { ExecutionServiceClient } from "@/wallet/services/execution/client"

/** Utils */
import { rowDescriptionFor } from "@/utils/presto-ui-state"

/** Store */
import { useAppStore } from "@/stores/app.store"
const appStore = useAppStore()

/** Proving row: Presto's live status plus the SW's memory of the last prove attempt. */
const configService = new ConfigServiceClient()
const { state: prestoState, start: startPresto, dispose: disposePresto } = usePrestoCheck(configService)
const lastProve = ref(null)
const provingDescription = computed(() => rowDescriptionFor(prestoState.value, lastProve.value))
const executionService = new ExecutionServiceClient()

onBeforeMount(async () => {
	void startPresto()
	try {
		lastProve.value = await executionService.getLastProveOutcome()
	} catch {
		lastProve.value = null
	}
})

/** Hero visibility → compact sticky title fade */
const heroRef = useTemplateRef("heroRef")
const heroVisible = ref(true)
let heroObserver = null

onMounted(() => {
	if (heroRef.value) {
		heroObserver = new IntersectionObserver(
			([entry]) => {
				heroVisible.value = entry.isIntersecting
			},
			{ threshold: 0 },
		)
		heroObserver.observe(heroRef.value)
	}
})

onBeforeUnmount(() => {
	heroObserver?.disconnect()
	executionService.disconnect()
	configService.disconnect()
	disposePresto()
})
</script>

<template>
	<Flex v-if="appStore.isLogined" direction="column" :class="$style.wrapper" data-testid="settings-page">
		<div :class="[$style.page_title_bar, !heroVisible && $style.page_title_bar_visible]">
			<span :class="$style.page_title_label" data-testid="page-title-bar">SETTINGS</span>
		</div>

		<div ref="heroRef">
			<Flex direction="column" align="center" gap="16" :class="$style.hero" data-testid="page-hero">
				<h1 :class="$style.hero_title" data-testid="page-hero-title">SETTINGS</h1>
				<div :class="$style.hero_bar" />
			</Flex>
		</div>

		<Flex direction="column" gap="32" :class="$style.content">
			<ItemsContainer title="Identity">
				<SettingItem
					to="/popup/settings/profile"
					title="Profile"
					description="Profile name, password, backup"
					materialIcon="person"
					chevron
					data-testid="setting-nav-profile"
				/>
				<SettingItem
					to="/popup/settings/accounts"
					title="Accounts"
					description="Switch, create, manage"
					materialIcon="account_balance_wallet"
					chevron
					data-testid="setting-nav-accounts"
				/>
			</ItemsContainer>

			<ItemsContainer title="Connections">
				<SettingItem
					to="/popup/settings/contacts"
					title="Contacts"
					description="Saved addresses"
					materialIcon="group"
					chevron
					data-testid="setting-nav-contacts"
				/>
				<SettingItem
					to="/popup/settings/networks"
					title="Networks"
					description="Aztec networks and RPCs"
					materialIcon="hub"
					chevron
					data-testid="setting-nav-networks"
				/>
				<SettingItem
					to="/popup/settings/tokens"
					title="Tokens"
					description="Tracked tokens and balances"
					materialIcon="toll"
					chevron
					data-testid="setting-nav-tokens"
				/>
				<SettingItem
					to="/popup/settings/fpcs"
					title="Fee Payments"
					description="FPCs and fee methods"
					materialIcon="local_gas_station"
					chevron
					data-testid="setting-nav-fpcs"
				/>
			</ItemsContainer>

			<ItemsContainer title="Security">
				<SettingItem
					to="/popup/settings/security"
					title="Security & Backup"
					description="Auto-lock, recovery phrase"
					materialIcon="lock"
					chevron
					data-testid="setting-nav-security"
				/>
				<SettingItem
					to="/popup/settings/connected-apps"
					title="Connected Apps"
					description="Apps with granted permissions"
					materialIcon="extension"
					chevron
					data-testid="setting-nav-connected-apps"
				/>
			</ItemsContainer>

			<ItemsContainer title="App">
				<SettingItem
					to="/popup/settings/appearance"
					title="Appearance"
					description="Theme and display"
					materialIcon="palette"
					chevron
					data-testid="setting-nav-appearance"
				/>
				<SettingItem
					to="/popup/settings/proving"
					title="Proving"
					:description="provingDescription"
					materialIcon="speed"
					chevron
					data-testid="setting-nav-proving"
					:data-status="prestoState.kind"
				/>
				<SettingItem
					to="/popup/settings/glossary"
					title="Glossary"
					description="What Nulo's words mean"
					materialIcon="menu_book"
					chevron
					data-testid="setting-nav-glossary"
				/>
				<SettingItem
					to="/popup/settings/advanced"
					title="Advanced"
					description="Developer, account state, explorer"
					materialIcon="bolt"
					chevron
					data-testid="setting-nav-advanced"
				/>
			</ItemsContainer>

			<RouterLink to="/popup/settings/about" :class="$style.footer_link">
				About Nulo
			</RouterLink>
		</Flex>
	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;

	overflow: auto;
	scrollbar-gutter: stable;
	background: var(--app-bg);

	padding-bottom: var(--nav-clearance);
}

.page_title_bar {
	composes: page_title_bar from "../tab-hero.module.css";
}

.page_title_bar_visible {
	composes: page_title_bar_visible from "../tab-hero.module.css";
}

.page_title_label {
	composes: page_title_label from "../tab-hero.module.css";
}

.hero {
	composes: hero from "../tab-hero.module.css";
}

.hero_title {
	composes: hero_title from "../tab-hero.module.css";
}

.hero_bar {
	composes: hero_bar from "../tab-hero.module.css";
}

.content {
	padding: 0 24px;
}

.footer_link {
	align-self: center;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	text-decoration: underline;
	text-decoration-color: var(--nulo-outline);
	text-underline-offset: 6px;

	margin-top: 16px;

	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--nulo-accent);
	}
}
</style>
