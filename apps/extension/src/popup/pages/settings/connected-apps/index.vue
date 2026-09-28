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
import RowTarget from "@/components/ui/RowTarget.vue"

/** Services */
import { DappSessionServiceClient } from "@/wallet/services/dapp-session/client"
import { getSafeDisplay } from "@/wallet/services/dapp-session/capability-meta"

/** Store */
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
const cacheStore = useCacheStore()
const popupStore = usePopupStore()

const formatGrantSummary = (grants) => {
	// getSafeDisplay returns the constant "Unknown" shortLabel for
	// unrecognized types so the per-session row in the settings list never
	// paints a dApp-controlled wire string as a friendly summary.
	return grants.map((g) => getSafeDisplay(g.capability.type).shortLabel).join(" \u00B7 ")
}

/** The app's host, so e2e can pick one app's row without reading its text. */
const appHost = (session) => {
	try {
		return new URL(session.dappMetadata?.url ?? "").host
	} catch {
		return ""
	}
}

const dappSessions = ref([])

const sortedSessions = computed(() => [...dappSessions.value].sort((a, b) => a.expiry - b.expiry))

const dappSessionService = new DappSessionServiceClient()
dappSessionService.onDappSessionAdded.add(onDappSessionAdded)
dappSessionService.onDappSessionUpdated.add(onDappSessionUpdated)
dappSessionService.onDappSessionDeleted.add(onDappSessionDeleted)

function hydrateLogo(session) {
	if (!session.dappMetadata?.logo || session.dappMetadata.logoBlobUrl) return
	session.dappMetadata.logoBlobUrl = session.dappMetadata.logo
}

function onDappSessionAdded(session) {
	dappSessions.value.push(session)
	hydrateLogo(session)
}
function onDappSessionUpdated(session) {
	const idx = dappSessions.value.findIndex((ds) => ds.id === session.id)
	if (idx !== -1) {
		const prevBlob = dappSessions.value[idx].dappMetadata?.logoBlobUrl
		dappSessions.value[idx] = session
		if (prevBlob && session.dappMetadata) {
			session.dappMetadata.logoBlobUrl = prevBlob
		}
	} else {
		dappSessions.value.push(session)
	}
	hydrateLogo(session)
}
function onDappSessionDeleted(session) {
	dappSessions.value = dappSessions.value.filter((ds) => ds.id !== session.id)
}

const rowIdBase = useId()

const handleDropSession = (session) => {
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.confirm_text = "Yes, disconnect"
	cacheStore.confirm.description = `Disconnect "${session.dappMetadata?.name ?? "this dApp"}"?`
	cacheStore.confirm.callback = async () => {
		await dappSessionService.deleteDappSession(session.id)
	}
	popupStore.open("confirm")
}

const handleDropAllSessions = () => {
	if (!dappSessions.value.length) return
	cacheStore.confirm.confirm_color = "red"
	cacheStore.confirm.confirm_text = "Yes, disconnect all"
	cacheStore.confirm.description = `Disconnect all ${dappSessions.value.length} sessions?`
	cacheStore.confirm.callback = async () => {
		for (const session of [...dappSessions.value]) {
			await dappSessionService.deleteDappSession(session.id)
		}
	}
	popupStore.open("confirm")
}

onBeforeMount(async () => {
	const sessions = await dappSessionService.getDappSessions()
	dappSessions.value = sessions
	for (const session of sessions) hydrateLogo(session)
})

onBeforeUnmount(() => {
	dappSessionService.disconnect()
})
</script>

<template>
	<SettingsPageShell title="Connected Apps" :backTo="'/popup/settings'" gap="12">
		<template #trailing>
			<Dropdown>
				<button type="button" :class="$style.icon_btn" aria-label="Session actions">
					<MaterialIcon name="more_vert" :size="18" color="secondary" />
				</button>

				<template #popup>
					<DropdownItem @click="handleDropAllSessions" :disabled="!dappSessions.length">
						<Flex align="center" gap="8">
							<Icon name="log-out" size="14" color="secondary" />
							Disconnect all sessions
						</Flex>
					</DropdownItem>
				</template>
			</Dropdown>
		</template>

		<SectionLabel label="Sessions" :count="sortedSessions.length" />

		<ItemsContainer v-if="sortedSessions.length">
			<div v-for="(ds, i) in sortedSessions" :key="ds.id" :class="$style.row">
				<RowTarget data-testid="connected-app-row" :data-app-host="appHost(ds)" :to="`/popup/settings/connected-apps/${ds.id}`" :labelledby="`${rowIdBase}-${i}`" />

				<Flex align="center" gap="12" wide>
					<div :class="$style.logo_wrapper">
						<Icon v-if="ds.loadingLogo" :loading="true" name="dapp" size="18" color="tertiary" />
						<img
							v-else-if="ds.dappMetadata.logoBlobUrl"
							:src="ds.dappMetadata.logoBlobUrl"
							:class="$style.logo"
							alt=""
						/>
						<Icon v-else name="dapp" size="18" color="tertiary" />
					</div>

					<Flex direction="column" gap="2" wide :class="$style.row_text">
						<span :id="`${rowIdBase}-${i}`" :class="$style.row_name">{{ ds.dappMetadata.name }}</span>
						<span v-if="ds.capabilityGrants?.length" :class="$style.row_grants">
							{{ formatGrantSummary(ds.capabilityGrants) }}
						</span>
					</Flex>

					<Flex align="center" gap="8" :class="$style.actions">
						<Tooltip position="end" delay="350">
							<RowAction label="Disconnect session" data-testid="session-disconnect" :class="$style.action_danger" @click="handleDropSession(ds)">
								<Icon name="close-circle" size="14" color="tertiary" />
							</RowAction>

							<template #content> Disconnect session </template>
						</Tooltip>
					</Flex>
				</Flex>
			</div>
		</ItemsContainer>

		<div v-else :class="$style.empty">
			<div :class="$style.empty_label">No active sessions</div>
			<div :class="$style.empty_hint">Connect a dApp to start a session</div>
		</div>
	</SettingsPageShell>
</template>

<style module>
.row {
	position: relative;
	padding: 12px 16px;
	cursor: pointer;
	background: transparent;

	transition: background 0.2s var(--bezier);

	&:hover,
	&:has(> [data-row-target]:focus-visible) {
		background: var(--nulo-surface-high);
	}

	&:has(> [data-row-target]:focus-visible) {
		outline: 2px solid var(--nulo-accent);
		outline-offset: -2px;
	}

	&:active {
		background: var(--nulo-surface-highest);
	}

	&::after {
		position: absolute;
		bottom: 0;
		left: 16px;
		right: 16px;
		display: block;
		height: 1px;

		background: rgba(74, 70, 63, 0.3);

		content: " ";
	}

	&:last-child::after {
		display: none;
	}
}

.logo_wrapper {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;

	width: 24px;
	height: 24px;
}

.logo {
	width: 24px;
	height: 24px;
	object-fit: cover;
}

.row_text {
	min-width: 0;
}

.row_name {
	font-family: var(--font-body);
	font-size: 14px;
	font-weight: 600;
	color: var(--txt-primary);
	line-height: 20px;
	letter-spacing: 0.01em;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.row_grants {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
	line-height: 16px;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	flex-shrink: 0;
}

.action_danger {
	&:hover svg,
	&:focus-visible svg {
		fill: var(--red);
	}
}

.empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;

	padding: 40px 16px;

	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
}

.empty_label {
	font-family: var(--font-headline);
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.empty_hint {
	font-family: var(--font-body);
	font-size: 12px;
	color: var(--nulo-outline);
}

.icon_btn {
	display: flex;
	align-items: center;
	justify-content: center;

	width: 32px;
	height: 32px;

	background: transparent;
	border: none;
	cursor: pointer;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: color-mix(in srgb, var(--nulo-accent) 8%, transparent);
	}
}
</style>
