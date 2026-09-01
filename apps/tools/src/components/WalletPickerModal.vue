<script setup lang="ts">
import { Button } from "@nulo/design"
import { computed, nextTick, ref, watch } from "vue"
import { truncateName } from "@/composables/createAztecWalletSession"
import { useWalletConnection } from "@/composables/useWalletConnection"
import { TESTIDS } from "@/lib/testids"

/**
 * The wallet picker (approved Option B: modal overlay, one instance at the app
 * root). Rows are announcement-keyed — a wallet's id/name/icon are CLAIMED,
 * not proven, so two claimants of one identity render as two rows plus a
 * warning strip; the emoji verification on the next step remains the actual
 * trust anchor.
 */

const { discoveredWallets, scanning, pickerOpen, selectWallet, cancelChoice } = useWalletConnection()

// The session owns visibility: open IMMEDIATELY on a fresh connect (empty +
// scanning — wallets may need the user's discovery approval before the first
// row can arrive), closed during a remembered auto-reconnect attempt.
const open = computed(() => pickerOpen.value)

/** Provider-supplied name, hard-capped by CODE POINTS (a UTF-16 slice can
 *  split an emoji surrogate pair; CSS ellipsis is presentation, not capping). */
const NAME_MAX = 48
function displayName(name: string): string {
	return truncateName(name, NAME_MAX)
}

/** Provider-supplied icon URL: protocol allowlist + source-length cap.
 *  `chrome-extension:` is admitted deliberately — extension wallets (Nulo
 *  included) serve their icon from their own extension origin. Anything else
 *  (javascript:, http:, oversized data blobs) falls back to a glyph. */
const ICON_MAX_LENGTH = 4096
/** Icons that passed the allowlist but FAILED to load (e.g. the deployed
 *  tools app's CSP is `img-src 'self' data:`, which blocks https and
 *  chrome-extension sources) degrade to the glyph via @error. */
const failedIcons = ref(new Set<number>())
function onIconError(key: number) {
	const next = new Set(failedIcons.value)
	next.add(key)
	failedIcons.value = next
}
function safeIcon(icon: string | undefined): string | null {
	if (!icon || icon.length > ICON_MAX_LENGTH) return null
	try {
		const url = new URL(icon)
		if (url.protocol === "https:" || url.protocol === "chrome-extension:") return icon
		if (url.protocol === "data:" && icon.startsWith("data:image/")) return icon
		return null
	} catch {
		return null
	}
}

/** Two announcements claiming one id — the fail-closed signal the user needs
 *  to see spelled out. */
const hasCollision = computed(() => {
	const seen = new Set<string>()
	for (const w of discoveredWallets.value) {
		if (seen.has(w.id)) return true
		seen.add(w.id)
	}
	return false
})

function onKey(evt: KeyboardEvent) {
	if (evt.key === "Escape") {
		cancelChoice()
		return
	}
	// Minimal focus trap: Tab cycles within the dialog, so focus (and the
	// Escape handler with it) can't drift to the inert page behind.
	if (evt.key === "Tab" && dialogEl.value) {
		const focusables = [
			...dialogEl.value.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])"),
		].filter((el) => !el.hasAttribute("disabled"))
		if (focusables.length === 0) return
		const first = focusables[0]
		const last = focusables[focusables.length - 1]
		// Initial focus sits on the dialog CONTAINER — both Tab directions
		// must wrap from there too, or Shift+Tab escapes on the first press.
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

// Focus management: move focus into the dialog on open so Escape works
// without a click, and keyboard users land on the list, not the page behind.
const dialogEl = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null
watch(open, async (isOpen) => {
	if (isOpen) {
		previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
		await nextTick()
		dialogEl.value?.focus()
	} else {
		previouslyFocused?.focus()
		previouslyFocused = null
	}
})
</script>

<template>
	<Teleport to="body">
		<div
			v-if="open"
			class="overlay"
			:data-testid="TESTIDS.walletPicker"
			@click.self="cancelChoice"
		>
			<div ref="dialogEl" class="modal" role="dialog" aria-modal="true" aria-label="Choose a wallet" tabindex="-1" @keydown="onKey">
				<h2 class="title">CHOOSE A WALLET</h2>

				<p v-if="hasCollision" class="warning" role="alert" :data-testid="TESTIDS.walletPickerWarning">
					⚠ Multiple wallets claim the same identity. Names and icons are self-reported — pick deliberately. The emoji check on the next step verifies only the connection to the wallet you select.
				</p>

				<p v-if="discoveredWallets.length === 0" class="waiting" :data-testid="TESTIDS.walletPickerWaiting">
					No wallets have answered yet. If your wallet asks to allow this site, approve it there.
				</p>

				<ul class="rows" aria-live="polite">
					<li
						v-for="w in discoveredWallets"
						:key="w.key"
						class="row"
						:data-testid="TESTIDS.walletPickerRow"
						:data-wallet-key="w.key"
					>
						<img
							v-if="safeIcon(w.icon) && !failedIcons.has(w.key)"
							class="icon"
							:src="safeIcon(w.icon) ?? undefined"
							alt=""
							width="28"
							height="28"
							referrerpolicy="no-referrer"
							@error="onIconError(w.key)"
						/>
						<span v-else class="icon fallback" aria-hidden="true">◆</span>
						<span class="name">{{ displayName(w.name) }}</span>
						<span class="badge">{{ w.type }}</span>
						<Button
							class="connect"
							variant="primary_outline"
							size="small"
							:aria-label="`Connect ${displayName(w.name)} (${w.type})`"
							:data-testid="TESTIDS.walletPickerConnect"
							@click="selectWallet(w.key)"
						>
							Connect
						</Button>
					</li>
				</ul>

				<p v-if="scanning" class="scanning" :data-testid="TESTIDS.walletPickerScanning">
					<span class="dot" aria-hidden="true"></span> Scanning for more wallets…
				</p>

				<Button
					variant="primary_outline"
					:data-testid="TESTIDS.walletPickerCancel"
					@click="cancelChoice"
				>
					Cancel
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

.warning {
	border: 1px solid var(--yellow);
	color: var(--yellow);
	font-size: 11px;
	line-height: 1.5;
	padding: 10px 12px;
}

.rows {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.row {
	display: flex;
	align-items: center;
	gap: 12px;
	border: 1px solid var(--nulo-border);
	padding: 10px 12px;
}

.icon {
	width: 28px;
	height: 28px;
	flex: none;
	object-fit: contain;
	border: 1px solid var(--nulo-outline);
}

.icon.fallback {
	display: grid;
	place-items: center;
	color: var(--txt-secondary);
	font-size: 14px;
}

.name {
	color: var(--txt-primary);
	font-weight: 600;
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}

.badge {
	flex: none;
	color: var(--txt-secondary);
	border: 1px solid var(--nulo-outline);
	font-size: 9px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	padding: 3px 6px;
}

.connect {
	margin-left: auto;
	flex: none;
}

.waiting {
	color: var(--txt-secondary);
	font-size: 12px;
	line-height: 1.5;
}

.scanning {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var(--txt-secondary);
	font-size: 10px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}

.dot {
	width: 6px;
	height: 6px;
	background: var(--yellow);
	flex: none;
	animation: pulse 1.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
	.dot {
		animation: none;
	}
}

@keyframes pulse {
	50% {
		opacity: 0.25;
	}
}
</style>
