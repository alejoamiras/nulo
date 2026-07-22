<route lang="json">
{
	"meta": {
		"isAuthRequired": true
	}
}
</route>

<script setup>
/** Components */
import { Dropdown } from "@/components/ui/Dropdown"

/** Utils */
import { defaultConfig as makeDefaultConfig } from "@/wallet/config"
import { ConfigServiceClient } from "@/wallet/services/config/client"

/** Composables */
import { useToast } from "@/composables/toast"
const { openToast } = useToast()

const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)

const isLoading = ref(true)
const defaultConfig = makeDefaultConfig()
const theme = ref(defaultConfig.theme)
const isSidePanelEnabled = ref(defaultConfig.sidePanel)
const isShowNodeNameEnabled = ref(defaultConfig.showNode)
const isShowPopupFullscreen = ref(defaultConfig.showPopupFullscreen)
const isAnimationsDisabled = ref(defaultConfig.disableAnimations)
const isIncomingTransfersVisible = ref(defaultConfig.incomingTransfersVisible)
const isShowFiatValues = ref(defaultConfig.showFiatValues)
// D8 dust filter — a NUMBER, not a toggle, so it lives outside the `settings` toggle map.
const dustThreshold = ref(String(defaultConfig.incomingDustUsdThreshold))
const settings = {
	theme: {
		title: "",
		description: "",
		model: theme,
	},
	sidePanel: {
		title: "Open as Side Panel",
		description: "Open as side panel instead of popup",
		model: isSidePanelEnabled,
	},
	showNode: {
		title: "Show network name",
		description: "Always show network name in the header",
		model: isShowNodeNameEnabled,
	},
	showPopupFullscreen: {
		title: "Full-height popups",
		description: "Open popups to to the full height",
		model: isShowPopupFullscreen,
	},
	disableAnimations: {
		title: "Disable animations",
		description: "Minimize the use of animations",
		model: isAnimationsDisabled,
	},
	incomingTransfersVisible: {
		title: "Show incoming transfers",
		description: "Hide if you run the same seed on multiple devices and don't want one device's outgoing to appear as incoming here",
		model: isIncomingTransfersVisible,
	},
	showFiatValues: {
		title: "Show fiat values",
		description: "Fetch USD prices from CoinGecko while unlocked. Off hides all dollar values",
		model: isShowFiatValues,
	},
}

async function updateDustThreshold(raw) {
	const n = Number.parseFloat(raw)
	const value = Number.isFinite(n) && n >= 0 ? n : 0
	try {
		await configService.setValue("incomingDustUsdThreshold", value)
		dustThreshold.value = String(value)
	} catch (err) {
		openToast({ label: "Failed to update setting", icon: "warning" }, TOAST_DURATION.LONG)
	}
}

async function updateSetting(key, value) {
	if (!settings[key]) return
	if (settings[key].model.value === value) return

	try {
		await configService.setValue(key, value)
		applySetting(key, value)
	} catch (err) {
		openToast({ label: "Failed to update setting", icon: "warning" }, TOAST_DURATION.LONG)
	}
}

async function applySetting(key, value) {
	settings[key].model.value = value

	switch (key) {
		case "sidePanel":
			if (value) {
				const currentWindow = await chrome.windows.getCurrent()
				chrome.sidePanel.open({
					windowId: currentWindow.id,
				})
			}

			window.close()
			break

		default:
			break
	}
}

function onSettingUpdate(setting) {
	if (setting.key === "incomingDustUsdThreshold") {
		dustThreshold.value = String(setting.value)
		return
	}
	if (settings[setting.key]) {
		if (settings[setting.key].model.value !== setting.value) {
			applySetting(setting.key, setting.value)
		}
	}
}

onMounted(async () => {
	const _settings = await configService.getProps()
	_settings.forEach((s) => {
		if (s.key === "incomingDustUsdThreshold") {
			dustThreshold.value = String(s.value)
			return
		}
		if (settings[s.key]) {
			settings[s.key].model.value = s.value
		}
	})

	isLoading.value = false
})

onBeforeUnmount(() => {
	configService.disconnect()
})
</script>

<template>
	<Flex direction="column" :class="$style.wrapper">
		<SubPageHeader title="Appearance" :backTo="'/popup/settings'" />

		<Flex v-if="!isLoading" direction="column" gap="24" :class="$style.content">
			<Flex justify="between">
				<Flex direction="column" gap="6">
					<Text size="13" weight="600" color="primary"> Dark Theme </Text>
					<Text size="12" weight="500" color="tertiary"> Application theme </Text>
				</Flex>

				<Dropdown>
					<template #trigger>
						<DropdownTrigger data-testid="theme-trigger">
							<Icon
								:name="
									(theme === 'dark' && 'moon') ||
									(theme === 'light' && 'sun') ||
									(theme === 'system' && 'settings')
								"
								size="14"
								color="primary"
							/>
							<Text size="13" weight="600" color="primary" style="text-transform: capitalize">
								{{ theme }}
							</Text>
						</DropdownTrigger>
					</template>

					<template #popup>
						<DropdownItem @click="updateSetting('theme', 'dark')" data-testid="theme-dark-btn">
							<Flex align="center" gap="8">
								<Icon :name="theme === 'dark' ? 'check' : ''" size="14" color="primary" />
								Dark
							</Flex>
						</DropdownItem>
						<DropdownItem @click="updateSetting('theme', 'light')" data-testid="theme-light-btn">
							<Flex align="center" gap="8">
								<Icon :name="theme === 'light' ? 'check' : ''" size="14" color="primary" />
								Light
							</Flex>
						</DropdownItem>
						<DropdownItem @click="updateSetting('theme', 'system')" data-testid="theme-system-btn">
							<Flex align="center" gap="8">
								<Icon :name="theme === 'system' ? 'check' : ''" size="14" color="primary" />
								System
							</Flex>
						</DropdownItem>
					</template>
				</Dropdown>
			</Flex>

			<Flex v-for="sk in Object.keys(settings).filter(sk => sk !== 'theme')" justify="between">
				<Flex direction="column" gap="6">
					<Text size="13" weight="600" color="primary"> {{ settings[sk].title }} </Text>
					<Text size="12" weight="500" color="tertiary"> {{ settings[sk].description }} </Text>
				</Flex>

				<Toggle
					@update:modelValue="updateSetting(sk, $event)"
					:modelValue="settings[sk].model.value"
					:data-testid="(sk === 'disableAnimations' && 'animations-toggle') || (sk === 'showFiatValues' && 'fiat-values-toggle') || null"
				/>
			</Flex>

			<!-- D8 dust filter: hide incoming receipts worth less than this USD value (0 = off). -->
			<Flex justify="between" align="center" gap="12">
				<Flex direction="column" gap="6">
					<Text size="13" weight="600" color="primary"> Hide dust receipts </Text>
					<Text size="12" weight="500" color="tertiary">
						Hide incoming receipts worth less than this USD value (0 = off; unpriced tokens always show)
					</Text>
				</Flex>

				<input
					:class="$style.dust_input"
					type="number"
					min="0"
					step="0.01"
					inputmode="decimal"
					data-testid="dust-threshold-input"
					:value="dustThreshold"
					@change="updateDustThreshold($event.target.value)"
				/>
			</Flex>
		</Flex>

	</Flex>
</template>

<style module>
.wrapper {
	flex: 1;
	overflow: auto;
	background: var(--app-bg);
	scrollbar-gutter: stable;
}

.content {
	padding: 16px 24px var(--nav-clearance) 24px;
}

.item {
	border-radius: 0;
	border: 1px solid var(--nulo-border);
	cursor: pointer;

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);

		& .item_icon {
			transform: rotate(-90deg) translateY(3px);
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.item_icon {
	transform: rotate(-90deg);

	transition: transform 0.2s var(--bezier);
}

.dust_input {
	width: 88px;
	text-align: right;
	font-family: var(--font-mono);
	font-size: 13px;
	color: var(--txt-primary);
	background: var(--nulo-surface-low);
	border: 1px solid var(--nulo-border);
	padding: 6px 8px;
}
</style>
