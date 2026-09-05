<script setup lang="ts">
import { Icon } from "@nulo/design"
import { computed, nextTick, onBeforeUnmount, ref } from "vue"
import { useOpsInFlight } from "@/composables/useOpsInFlight"
import { switchActiveAccount, useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"

/**
 * The connected account chip + dropdown switcher. Shared by both AztecWalletPanel variants — both
 * read the SAME session singleton, so switching here drives every section.
 *
 * The trigger is ONE button holding only non-interactive content; the copy
 * affordance lives in the menu rows as a SIBLING of the selection button, so no
 * button ever nests inside another. The menu renders for single-account sessions
 * too — it is where Disconnect lives, and Disconnect must never disappear.
 *
 * The dropdown is deliberately NOT the design package's Popover: that component
 * needs a `#popover` teleport root the tools app doesn't declare and carries a
 * pinned open/close lifecycle bug (packages/design/src/ui/Popover.vue), and its
 * rounded surface reads as the odd one out in an app of sharp hairline boxes.
 * This one is sharp, with the same hairline every other surface uses — which the
 * light palette needs anyway: a #fff panel on a #f5f5f7 page has no edge without it.
 */

const props = defineProps<{
	/** Panel-specific testid for the chip's address text (tl-account / tl-bridge-l2-account). */
	addressTestid: string
	/** Panel-specific testid for the menu's Disconnect action (keeps the pre-switcher ids alive). */
	disconnectTestid: string
}>()

const { accounts, selectedAccount, hiddenAccountsCount, disconnect } = useWalletConnection()
const { busy } = useOpsInFlight()

const open = ref(false)
const chipEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)

const active = computed(() => accounts.value.find((a) => a.address === selectedAccount.value) ?? null)

function shortAddress(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function toggle() {
	open.value ? close() : openMenu()
}
async function openMenu() {
	open.value = true
	await nextTick()
	menuEl.value?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
}
function close(refocus = true) {
	if (!open.value) return
	open.value = false
	if (refocus) chipEl.value?.focus()
}

function onPick(address: string) {
	if (address === selectedAccount.value) {
		close()
		return
	}
	// Shared switch path (selectAccount + toast) — same behavior as the journal cards' switch action.
	if (switchActiveAccount(address)) close()
	// Not applied = blocked (busy) or stale — the rows are disabled while busy, so this is
	// belt-and-braces: keep the menu open, state untouched.
}

async function onDisconnect() {
	close(false)
	await disconnect()
}

/** Per-row copy with transient feedback (the AddressDisplay pattern, as a sibling control). */
const copiedAddress = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function onCopy(address: string) {
	try {
		await navigator.clipboard.writeText(address)
		copiedAddress.value = address
		if (copiedTimer) clearTimeout(copiedTimer)
		copiedTimer = setTimeout(() => {
			copiedAddress.value = null
		}, 1200)
	} catch {
		// Clipboard denied: silently no-op — the full address stays visible in the row title.
	}
}

function onMenuKey(evt: KeyboardEvent) {
	if (evt.key === "Escape") {
		close()
		return
	}
	if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
		evt.preventDefault()
		const rows = [...(menuEl.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled])') ?? [])]
		if (rows.length === 0) return
		const idx = rows.indexOf(document.activeElement as HTMLElement)
		const next = evt.key === "ArrowDown" ? (idx + 1) % rows.length : (idx - 1 + rows.length) % rows.length
		rows[next].focus()
	}
}

function onDocumentClick(evt: MouseEvent) {
	if (!open.value) return
	const target = evt.target as Node
	if (chipEl.value?.contains(target) || menuEl.value?.contains(target)) return
	close(false)
}
document.addEventListener("click", onDocumentClick)
onBeforeUnmount(() => {
	document.removeEventListener("click", onDocumentClick)
	if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
	<div class="switcher">
		<button
			ref="chipEl"
			type="button"
			class="chip"
			aria-haspopup="menu"
			:aria-expanded="open"
			aria-label="Active account — open account menu"
			:data-testid="TESTIDS.accountChip"
			@click="toggle"
		>
			<span class="net">Aztec</span>
			<span v-if="selectedAccount" class="identity" :class="{ solo: !active?.alias }">
				<span v-if="active?.alias" class="name">{{ active.alias }}</span>
				<span class="addr" :title="selectedAccount" :data-testid="props.addressTestid">{{ shortAddress(selectedAccount) }}</span>
			</span>
			<Icon name="chevron" size="16" color="secondary" :rotate="open ? 180 : 0" />
		</button>

		<div
			v-if="open"
			ref="menuEl"
			class="menu"
			role="menu"
			aria-label="Granted accounts"
			:data-testid="TESTIDS.accountMenu"
			@keydown="onMenuKey"
		>
			<p class="hdr" aria-hidden="true">Granted accounts · {{ accounts.length }}</p>

			<p v-if="busy" class="busy-hint" role="status">Finish the current operation to switch.</p>

			<ul class="rows">
				<li
					v-for="a in accounts"
					:key="a.address"
					role="none"
					class="row-line"
					:class="{ inert: busy && a.address !== selectedAccount }"
				>
					<button
						type="button"
						class="row"
						role="menuitemradio"
						:aria-checked="a.address === selectedAccount"
						:disabled="busy && a.address !== selectedAccount"
						:data-testid="TESTIDS.accountMenuRow"
						:data-address="a.address"
						@click="onPick(a.address)"
					>
						<span class="check" :class="{ off: a.address !== selectedAccount }" aria-hidden="true">✓</span>
						<span class="who">
							<span class="name">{{ a.alias || "—" }}</span>
							<span class="addr-sub" :title="a.address">{{ shortAddress(a.address) }}</span>
						</span>
					</button>
					<button
						type="button"
						class="copy"
						:aria-label="`Copy address ${a.address}`"
						:data-testid="TESTIDS.accountMenuCopy"
						@click="onCopy(a.address)"
					>
						{{ copiedAddress === a.address ? "✓" : "⧉" }}
					</button>
				</li>
			</ul>

			<p v-if="hiddenAccountsCount > 0" class="truncation" :data-testid="TESTIDS.accountMenuTruncation">
				Showing {{ accounts.length }} of {{ accounts.length + hiddenAccountsCount }} granted accounts.
			</p>

			<div class="foot">
				<button
					type="button"
					class="disconnect"
					:data-testid="props.disconnectTestid"
					@click="onDisconnect"
				>
					Disconnect
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.switcher {
	position: relative;
	display: inline-flex;
}

.chip {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	min-height: 40px;
	padding: 0 12px;
	box-sizing: border-box;
	border: 1px solid var(--nulo-outline);
	background: transparent;
	cursor: pointer;
	transition: border-color 0.15s ease;
}

.chip:hover,
.chip[aria-expanded="true"] {
	border-color: var(--nulo-accent);
}

.chip .net {
	color: var(--txt-tertiary);
	font: 500 10px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
}

/* One border per chip: name and address sit on one line inside it, no inner box. */
.identity {
	display: inline-flex;
	align-items: baseline;
	gap: 6px;
	min-width: 0;
}

.identity .name {
	color: var(--txt-primary);
	font: 600 12.5px/1.1 var(--font-body);
	max-width: 18ch;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.identity .addr {
	color: var(--txt-secondary);
	font: 400 11px/1.1 var(--font-mono);
	white-space: nowrap;
}

/* Unnamed account: the address carries the chip alone, at the Ethereum chip's weight. */
.identity.solo .addr {
	color: var(--txt-primary);
	font-size: 12.5px;
}

/* Sharp corners like every other nulo surface — the rounded Popover recipe was the odd one out. The
   hairline is load-bearing, not decoration: in the light palette the panel is #fff on a #f5f5f7 page,
   so shadow alone leaves it with no discernible edge. */
.menu {
	position: absolute;
	top: calc(100% + 6px);
	left: 0;
	z-index: 50;
	min-width: 264px;
	background: var(--dropdown-bg);
	border: 1px solid var(--nulo-outline);
	box-shadow:
		0 14px 34px rgba(0, 0, 0, 0.28),
		0 4px 14px rgba(0, 0, 0, 0.12);
	padding: 6px 0;
	display: flex;
	flex-direction: column;
}

.hdr {
	font: 500 10px/1 var(--font-mono);
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--txt-secondary);
	padding: 8px 14px 6px;
}

.busy-hint {
	color: var(--sand);
	font-size: 11px;
	padding: 2px 14px 6px;
}

.rows {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
}

/* The whole line is ONE hover surface: highlighting only the selection button left the fill
   stopping short of the copy control. */
.row-line {
	display: flex;
	align-items: stretch;
	transition: background 0.15s ease;
}

.row-line:hover:not(.inert) {
	background: var(--nulo-surface-high);
}

.row {
	flex: 1;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 9px 6px 9px 14px;
	background: transparent;
	border: none;
	cursor: pointer;
	text-align: left;
	min-width: 0;
	transition: background 0.15s ease;
}

.row:focus-visible {
	background: var(--nulo-surface-high);
}

.row:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.check {
	color: var(--mint);
	font-size: 13px;
	width: 14px;
	flex: none;
	text-align: center;
}

.check.off {
	color: transparent;
}

.who {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.name {
	color: var(--txt-primary);
	font-weight: 600;
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.addr-sub {
	color: var(--txt-secondary);
	font-family: var(--font-mono);
	font-size: 11px;
}

.copy {
	flex: none;
	align-self: center;
	color: var(--txt-secondary);
	background: transparent;
	border: none;
	cursor: copy;
	font-size: 13px;
	padding: 6px 12px 6px 6px;
}

/* Nested inside the row's hover rather than competing with it. */
.copy:hover {
	color: var(--txt-primary);
	background: color-mix(in srgb, var(--txt-primary) 8%, transparent);
}

.truncation {
	color: var(--sand);
	font-size: 10.5px;
	padding: 6px 14px 2px;
}

.foot {
	border-top: 1px solid var(--nulo-border);
	margin-top: 4px;
	padding: 7px 14px 3px;
	display: flex;
}

.disconnect {
	color: var(--txt-secondary);
	font: 500 11px/1 var(--font-mono);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	background: transparent;
	border: none;
	padding: 2px 0;
	cursor: pointer;
}

.disconnect:hover {
	color: var(--red);
}
</style>
