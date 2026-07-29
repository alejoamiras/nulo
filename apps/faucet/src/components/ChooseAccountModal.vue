<script setup lang="ts">
import { Button } from "@nulo/design"
import { computed, nextTick, ref, watch } from "vue"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"

/**
 * The choose-main-account step (plan: Proposal D). Mounted ONCE at the app root
 * (like WalletPickerModal) and driven entirely by session state: it appears only
 * while the connect flow is paused in `choosing-account` — i.e. the wallet granted
 * more than one account and none was remembered for this wallet. Esc/backdrop
 * cancel the CONNECT (same semantics as cancelling verification): abandoning the
 * choice must not leave a half-connected session.
 */

const { status, accounts, hiddenAccountsCount, confirmAccountChoice, cancelAccountChoice } = useWalletConnection()

const open = computed(() => status.value === "choosing-account")

const picked = ref<string | null>(null)
// Declared BEFORE the immediate watcher below: `immediate: true` runs the callback
// synchronously during setup, so bottom-of-script declarations would still be in TDZ.
const dialogEl = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null
// Pre-select the first granted account on open; clear on close so a later
// session never inherits a stale pick. `immediate` covers mounting while the
// session is ALREADY paused in choosing-account (remount/HMR) — without it the
// dialog would open with nothing selected and a dead Continue button.
watch(
	open,
	async (isOpen) => {
		if (isOpen) {
			picked.value = accounts.value[0]?.address ?? null
			previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
			await nextTick()
			dialogEl.value?.focus()
		} else {
			picked.value = null
			previouslyFocused?.focus()
			previouslyFocused = null
		}
	},
	{ immediate: true },
)

function shortAddress(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`
}
function initials(address: string): string {
	return address.slice(2, 4).toUpperCase()
}

function pick(address: string) {
	picked.value = address
}

async function onContinue() {
	if (!picked.value) return
	await confirmAccountChoice(picked.value)
}

/** Roving radio: arrows move the pick, matching the radiogroup pattern. */
function onRadioKey(evt: KeyboardEvent) {
	const list = accounts.value
	if (list.length === 0) return
	const idx = list.findIndex((a) => a.address === picked.value)
	if (evt.key === "ArrowDown" || evt.key === "ArrowRight") {
		evt.preventDefault()
		pickAndFocus(list[(idx + 1) % list.length].address)
	} else if (evt.key === "ArrowUp" || evt.key === "ArrowLeft") {
		evt.preventDefault()
		pickAndFocus(list[(idx - 1 + list.length) % list.length].address)
	}
}
function pickAndFocus(address: string) {
	picked.value = address
	nextTick(() => {
		dialogEl.value?.querySelector<HTMLElement>(`[data-address="${address}"]`)?.focus()
	})
}

function onKey(evt: KeyboardEvent) {
	if (evt.key === "Escape") {
		void cancelAccountChoice()
		return
	}
	// Minimal focus trap, same as WalletPickerModal: Tab cycles within the dialog.
	if (evt.key === "Tab" && dialogEl.value) {
		const focusables = [
			...dialogEl.value.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])"),
		].filter((el) => !el.hasAttribute("disabled"))
		if (focusables.length === 0) return
		const first = focusables[0]
		const last = focusables[focusables.length - 1]
		const onContainer = document.activeElement === dialogEl.value
		if (evt.shiftKey && (onContainer || document.activeElement === first)) {
			evt.preventDefault()
			last.focus()
		} else if (!evt.shiftKey && document.activeElement === last) {
			evt.preventDefault()
			first.focus()
		}
	}
}
</script>

<template>
	<Teleport to="body">
		<div
			v-if="open"
			class="overlay"
			:data-testid="TESTIDS.accountChoice"
			@click.self="cancelAccountChoice"
		>
			<div
				ref="dialogEl"
				class="modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="fa-account-choice-title"
				tabindex="-1"
				@keydown="onKey"
			>
				<h2 id="fa-account-choice-title" class="title">CHOOSE MAIN ACCOUNT</h2>
				<p class="body">
					Your wallet shared {{ accounts.length }} accounts. Pick the one this app should use —
					you can switch anytime from the account chip.
				</p>

				<ul class="rows" role="radiogroup" aria-label="Granted accounts" @keydown="onRadioKey">
					<li v-for="a in accounts" :key="a.address">
						<button
							type="button"
							class="row"
							:class="{ selected: picked === a.address }"
							role="radio"
							:aria-checked="picked === a.address"
							:tabindex="picked === a.address ? 0 : -1"
							:data-address="a.address"
							:data-testid="TESTIDS.accountChoiceRow"
							@click="pick(a.address)"
						>
							<span class="sq" aria-hidden="true">{{ initials(a.address) }}</span>
							<span class="who">
								<span class="name">{{ a.alias || "—" }}</span>
								<span class="addr">{{ shortAddress(a.address) }}</span>
							</span>
							<span v-if="picked === a.address" class="check" aria-hidden="true">✓</span>
						</button>
					</li>
				</ul>

				<p v-if="hiddenAccountsCount > 0" class="truncation" :data-testid="TESTIDS.accountChoiceTruncation">
					Showing {{ accounts.length }} of {{ accounts.length + hiddenAccountsCount }} granted accounts.
				</p>

				<Button
					variant="primary"
					:disabled="!picked"
					:data-testid="TESTIDS.accountChoiceContinue"
					@click="onContinue"
				>
					Continue
				</Button>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.overlay {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.7);
	z-index: 100;
	padding: 24px;
}

.modal {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-outline);
	padding: 24px;
	display: flex;
	flex-direction: column;
	gap: 14px;
	max-width: 380px;
	width: 100%;
	outline: none;
}

.title {
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 16px;
	letter-spacing: 0.06em;
	color: var(--txt-primary);
}

.body {
	color: var(--txt-secondary);
	font-size: 12px;
	line-height: 1.5;
}

.rows {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.row {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	border: 1px solid var(--nulo-border);
	padding: 10px 12px;
	background: transparent;
	cursor: pointer;
	text-align: left;
	transition: border-color 0.15s ease, background 0.15s ease;
}

.row:hover {
	border-color: var(--nulo-outline);
}

.row.selected {
	border-color: var(--nulo-outline);
	background: var(--nulo-surface-low);
}

.sq {
	width: 28px;
	height: 28px;
	flex: none;
	display: grid;
	place-items: center;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-secondary);
	font: 600 10px var(--font-mono);
}

.who {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	flex: 1;
}

.name {
	color: var(--txt-primary);
	font-weight: 600;
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.addr {
	color: var(--txt-secondary);
	font-family: var(--font-mono);
	font-size: 11px;
}

.check {
	color: var(--mint);
	font-size: 13px;
	flex: none;
}

.truncation {
	color: var(--sand);
	font-size: 11px;
	letter-spacing: 0.04em;
}
</style>
