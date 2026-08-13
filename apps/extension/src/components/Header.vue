<script setup>
import { defaultConfig as makeDefaultConfig } from "@/wallet/config"
import { LogLevel } from "@/wallet/logger"
import { LogViewerServiceClient } from "@/wallet/services/log-viewer/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { TaskServiceClient } from "@/wallet/services/task/client"

/** Utils */
import { managers } from "@/utils/core"
import { copyAddressToClipboard } from "./header-copy-address"

/** Store */
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const appStore = useAppStore()
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const route = useRoute()
const router = useRouter()

const handleLockWallet = () => {
	if (!appStore.isLogined) return
	appStore.isLogined = false
	managers.profile.lockActiveProfile()
}

const logViewerService = new LogViewerServiceClient()
logViewerService.onLog.add(onLogAdded)

const configService = new ConfigServiceClient()
configService.onUpdate.add(onSettingUpdate)

const defaultConfig = makeDefaultConfig()
const indicateFailures = ref(defaultConfig.indicateFailures)
const showNode = ref(defaultConfig.showNode)

const HEADER_INDICATION_DURATION = 5_000
let headerIndicateFailureTimer = null
let headerIndicateTaskTimer = null

const MENU_INDICATION_DURATION = 60_000
let menuIndicateFailureTimer = null
let menuIndicateTaskTimer = null

const tasks = ref([])
const activeTasksCount = ref(0)
const taskService = new TaskServiceClient()
taskService.onTaskCreated.add(onTaskCreated)
taskService.onTaskUpdated.add(onTaskUpdated)
taskService.onTaskDeleted.add(processTask)
async function onTaskCreated(task) {
	if (task.parentId) return

	tasks.value.push(task)
}
function processTask(task) {
	const idx = tasks.value.findIndex((t) => t.id === task.id)
	if (idx !== -1) {
		tasks.value.splice(idx, 1)
	}
}
function onTaskUpdated(task) {
	if (!task.finishedAt || task.parentId) return

	processTask(task)
}

const currentFailureType = ref("")
const highlightColor = computed(() => {
	if (currentFailureType.value === "error") {
		return "var(--red)"
	} else if (currentFailureType.value === "warning") {
		return "var(--yellow)"
	} else if (activeTasksCount.value) {
		return "" // "var(--green)"
	} else {
		return ""
	}
})

function handleWalletFailure(type, logId) {
	currentFailureType.value = type

	// Header
	if (headerIndicateFailureTimer) {
		clearTimeout(headerIndicateFailureTimer)
		headerIndicateFailureTimer = null
	}

	headerIndicateFailureTimer = setTimeout(() => {
		currentFailureType.value = ""
		activeTasksCount.value = tasks.value?.length || 0
		cacheStore.activeTasksCount = activeTasksCount.value
		headerIndicateFailureTimer = null
	}, HEADER_INDICATION_DURATION)

	// Menu
	if (menuIndicateFailureTimer) {
		clearTimeout(menuIndicateFailureTimer)
		menuIndicateFailureTimer = null
	}
	cacheStore.failureLog = {
		id: logId,
		color: highlightColor.value,
	}

	menuIndicateFailureTimer = setTimeout(() => {
		cacheStore.failureLog = null
		menuIndicateFailureTimer = null
	}, MENU_INDICATION_DURATION)
}

function onLogAdded(log) {
	switch (log.level) {
		case LogLevel.Warn:
			handleWalletFailure("warning", log.id)
			break
		case LogLevel.Error:
			handleWalletFailure("error", log.id)
			break

		default:
			break
	}
}

function onSettingUpdate(setting) {
	switch (setting.key) {
		case "indicateFailures":
			indicateFailures.value = setting.value
			break
		case "showNode":
			showNode.value = setting.value
			break

		default:
			break
	}
}

const handleOpenPopup = (target) => {
	if (!appStore.isLogined) return
	popupStore.open(target)
}

const { openToast } = useToast()
const handleCopyAddress = () => copyAddressToClipboard(appStore.account?.address, openToast)

const handleOpenNetworks = () => {
	if (!appStore.isLogined) return
	router.push("/popup/settings/networks")
}

watch(
	() => indicateFailures.value,
	() => {
		if (!indicateFailures.value) {
			logViewerService.disconnect()
		} else {
			logViewerService.connect()
		}
	},
)
watch(
	() => tasks.value?.length,
	(newValue) => {
		if (!newValue) {
			if (headerIndicateTaskTimer) {
				clearTimeout(headerIndicateTaskTimer)
				headerIndicateTaskTimer = null
			}

			headerIndicateTaskTimer = setTimeout(() => {
				activeTasksCount.value = 0
				headerIndicateTaskTimer = null
			}, HEADER_INDICATION_DURATION)

			menuIndicateTaskTimer = setTimeout(() => {
				cacheStore.activeTasksCount = null
				menuIndicateTaskTimer = null
			}, MENU_INDICATION_DURATION)

			return
		}

		if (menuIndicateTaskTimer) {
			clearTimeout(menuIndicateTaskTimer)
			menuIndicateTaskTimer = null
		}

		activeTasksCount.value = newValue
		cacheStore.activeTasksCount = newValue
	},
)

onMounted(async () => {
	indicateFailures.value = await configService.getValue("indicateFailures")
	showNode.value = await configService.getValue("showNode")

	tasks.value = (await taskService.getTasks()).filter((t) => !t.parentId && !t.finishedAt)
	activeTasksCount.value = tasks.value?.length

	if (indicateFailures.value) {
		logViewerService.connect()
	}
})

onBeforeUnmount(() => {
	configService.disconnect()
	logViewerService.disconnect()
	taskService.disconnect()
})
</script>

<template>
	<header v-if="!appStore._isHomeScreenOpened && route.name !== 'popup-auth' && !route.meta.hideHeader" :class="$style.wrapper">
		<!-- The switcher owns TWO explicit affordances (avatar + name) while the address is a
		     one-click copy target — no popup detour. `account-selector` stays on the name button so
		     every existing e2e switching flow passes unchanged (testid-preservation contract). -->
		<Flex v-if="appStore.isLogined" align="center" gap="10" :class="$style.account_group">
			<button
				type="button"
				@click="handleOpenPopup('accounts')"
				data-testid="account-avatar-btn"
				aria-label="Switch account"
				:class="$style.avatar_btn"
			>
				<AccountAvatar :name="appStore.account?.name || 'Primary Account'" :address="appStore.account?.address" :size="32" />
			</button>
			<Flex direction="column" gap="2" :class="$style.account_col">
				<button
					type="button"
					@click="handleOpenPopup('accounts')"
					data-testid="account-selector"
					aria-label="Switch account"
					:class="$style.account_label"
				>
					{{ appStore.account?.name?.toUpperCase() || "PRIMARY ACCOUNT" }}
				</button>
				<button
					type="button"
					@click="handleCopyAddress"
					data-testid="account-address-copy"
					aria-label="Copy address"
					:class="$style.account_address"
				>
					<span :class="$style.address_text">
						{{ appStore.account?.address ? `${appStore.account.address.slice(0, 6)}...${appStore.account.address.slice(-4)}` : "" }}
						<span :class="$style.copy_reveal"><Icon name="copy" size="12" /></span>
					</span>
				</button>
			</Flex>
		</Flex>

		<Flex align="center" gap="8">
			<button
				v-if="appStore.isLogined && appStore.network?.name"
				type="button"
				@click="handleOpenNetworks"
				data-testid="network-button"
				:aria-label="`Manage networks (currently ${appStore.network.name})`"
				:class="$style.network_chip"
			>
				<span :class="$style.network_label">{{ appStore.network.name }}</span>
				<div :class="[$style.status_dot, $style[String(appStore.networkStatus).toLowerCase()]]" />
			</button>

			<button
				v-if="appStore.isLogined"
				type="button"
				@click="handleLockWallet"
				data-testid="header-lock"
				aria-label="Lock wallet"
				:class="$style.icon_button"
			>
				<MaterialIcon name="lock" :size="20" color="primary" />
			</button>

		</Flex>
	</header>
</template>

<style module>
.wrapper {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;

	height: 64px;
	min-height: 64px;

	padding: 0 16px 0 24px;
	background: var(--app-bg);
}

.account_group {
	min-width: 0;
	flex-shrink: 1;
}

.account_col {
	min-width: 0;
	align-items: flex-start;
}

.avatar_btn {
	display: flex;
	flex-shrink: 0;

	padding: 0;
	background: transparent;
	border: 1px solid var(--nulo-border);
	cursor: pointer;

	transition: border-color 0.2s var(--bezier);

	&:hover,
	&:focus-visible {
		border-color: var(--nulo-outline);
	}
}

.account_label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;

	padding: 0;
	background: transparent;
	border: none;
	cursor: pointer;
	text-align: left;

	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: -0.04em;
	text-transform: uppercase;
	color: var(--nulo-secondary);

	transition: color 0.2s var(--bezier);

	&:hover,
	&:focus-visible {
		color: var(--txt-primary);
	}
}

.account_address {
	padding: 0;
	background: transparent;
	border: none;
	cursor: pointer;
	text-align: left;

	font-family: var(--font-headline);
	font-size: 14px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
}

/* Hover/focus underlines the address and reveals the copy icon — the icon is absolutely
 * positioned in the free space to its right, so nothing shifts and no target shrinks. */
.address_text {
	position: relative;
	display: inline-flex;
	align-items: center;

	text-decoration: underline transparent;
	text-underline-offset: 3px;

	transition: text-decoration-color 0.2s var(--bezier);
}

.copy_reveal {
	position: absolute;
	left: calc(100% + 6px);
	top: 50%;
	transform: translateY(-50%);

	display: inline-flex;
	color: var(--txt-tertiary);

	opacity: 0;
	transition: opacity 0.15s var(--bezier);
}

.account_address:hover .address_text,
.account_address:focus-visible .address_text {
	text-decoration-color: var(--nulo-outline);
}

.account_address:hover .copy_reveal,
.account_address:focus-visible .copy_reveal {
	opacity: 1;
}

.account_address:hover .copy_reveal {
	color: var(--nulo-accent);
}

.network_chip {
	display: inline-flex;
	align-items: center;
	gap: 6px;

	max-width: 120px;
	flex-shrink: 1;
	min-width: 0;

	padding: 6px 10px;
	background: transparent;
	border: 1px solid var(--nulo-border);
	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
	}
}

.network_label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;

	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 500;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.icon_button {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 36px;
	height: 36px;

	background: transparent;
	border: none;
	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-high);
	}

	&:active {
		opacity: 0.8;
	}
}

.status_dot {
	width: 6px;
	height: 6px;
	flex-shrink: 0;
	background: var(--gray);

	&.active {
		background: var(--green);
	}
	&.inactive {
		background: var(--red);
	}
	&.invalidchain {
		background: var(--red);
	}
	&.sync {
		background: var(--gray);
		animation: loading 1.5s infinite linear;
	}
}

@keyframes loading {
	0% { opacity: 1; }
	50% { opacity: 0.4; }
	100% { opacity: 1; }
}
</style>
