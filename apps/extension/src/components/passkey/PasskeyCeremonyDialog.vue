<script setup lang="ts">
/**
 * Path A — in-page passkey ceremony dialog. Mounts a non-dismissible
 * overlay in the existing extension popup, runs `navigator.credentials.*`
 * in the popup's frame, and emits the resulting `PasskeyCredentialData`
 * (or an error). The OS biometric prompt (Touch ID, Windows Hello,
 * security key) appears on top of the overlay; the overlay itself is
 * just visual context.
 *
 * This is PATH A (in-page). PATH B (`src/popup/windows/passkey/index.vue`)
 * is the SW-driven equivalent that runs in a chrome.windows.create popup;
 * both call the same `runPasskeyCeremony` helper to keep WebAuthn shape
 * consistent.
 *
 * Cancel paths (all abort the same AbortController):
 *   - Escape key (popup-side keydown handler)
 *   - `onBeforeUnmount` (parent navigates away mid-ceremony)
 *   - Explicit cancel button (user-visible)
 *
 * Errors:
 *   - DOMException("AbortError") on user cancel — emit("reject") with
 *     `UserRejectedError` so callers can `instanceof` and silently return.
 *   - Anything else → emit("reject") with the original error wrapped in
 *     a `WalletError`-shaped instance for stable cross-boundary handling.
 */
import { onBeforeUnmount, onMounted } from "vue"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"
import { UserRejectedError } from "@nulo/extension-messaging/errors"
import { runPasskeyCeremony } from "@/wallet/utils/passkey-ceremony"

const props = defineProps<{
	request: PasskeyRequest
}>()

const emit = defineEmits<{
	resolve: [data: PasskeyCredentialData]
	reject: [error: Error]
}>()

const controller = new AbortController()
let settled = false

function cancel(reason: string) {
	if (settled) return
	controller.abort(new DOMException(reason, "AbortError"))
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") cancel("user cancelled with Escape")
}

onMounted(async () => {
	window.addEventListener("keydown", handleKeydown)
	try {
		const data = await runPasskeyCeremony(props.request, controller.signal)
		settled = true
		emit("resolve", data)
	} catch (err) {
		settled = true
		// Normalize cancel paths to UserRejectedError so callers can
		// `instanceof` instead of string-matching. WebAuthn returns
		// `NotAllowedError` for user cancel via the OS prompt; AbortError
		// covers Escape / dismount / explicit cancel.
		const isCancel = err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")
		if (isCancel) {
			emit("reject", new UserRejectedError("User cancelled passkey ceremony"))
		} else {
			emit("reject", err instanceof Error ? err : new Error(String(err)))
		}
	}
})

onBeforeUnmount(() => {
	window.removeEventListener("keydown", handleKeydown)
	cancel("dialog dismounted")
})
</script>

<template>
	<teleport to="#popup">
		<div :class="$style.backdrop">
			<div :class="$style.card" data-testid="passkey-ceremony-dialog">
				<div :class="$style.spinner" />
				<h2 :class="$style.title">Waiting for passkey…</h2>
				<p :class="$style.subtitle">Use your authenticator (Touch ID, Windows Hello, security key) to continue.</p>
				<p :class="$style.hint">Don't navigate away — press Escape to cancel.</p>
			</div>
		</div>
	</teleport>
</template>

<style module>
.backdrop {
	position: fixed;
	inset: 0;
	z-index: 10000;

	display: flex;
	align-items: center;
	justify-content: center;

	background: rgba(10, 9, 8, 0.85);

	/* Intercept ALL pointer events — no click-outside dismissal. */
	pointer-events: auto;
}

.card {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;

	max-width: 320px;
	margin: 24px;
	padding: 32px 24px;

	background: var(--app-bg, #fff);
	border: 1px solid var(--nulo-border, rgba(35, 31, 28, 1));

	text-align: center;
}

.spinner {
	width: 32px;
	height: 32px;
	border: 3px solid var(--nulo-border, rgba(35, 31, 28, 0.3));
	border-top-color: var(--nulo-accent, #000);
	border-radius: 50%;
	animation: spin 0.8s linear infinite;
}

.title {
	font-family: var(--font-headline);
	font-size: 16px;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--txt-primary);
	margin: 0;
}

.subtitle {
	font-family: var(--font-body);
	font-size: 13px;
	line-height: 1.5;
	color: var(--nulo-secondary);
	margin: 0;
}

.hint {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.18em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
	margin: 0;
}

@keyframes spin {
	to { transform: rotate(360deg); }
}
</style>
