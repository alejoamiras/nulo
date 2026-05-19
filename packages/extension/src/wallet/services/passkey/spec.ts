import type { PasskeyCredential, PasskeyCredentialData } from "@nulo/wallet-crypto"

export const PASSKEY_SERVICE_NAME = "passkey"
export const PASSKEY_TIMEOUT = 60_000 * 3 // 3 minutes

/**
 * WebAuthn Relying Party ID. **Crypto-bound**: changing this value
 * invalidates every existing passkey credential ever issued by this
 * extension. Keep in sync with `manifest.config.ts:host_permissions`.
 * The build-step gate `scripts/check-rp-id.ts` enforces the sync; CI
 * fails the build on drift.
 *
 * If a fork repurposes this extension under a different domain, change
 * BOTH this constant and the manifest entry, and accept that ALL
 * existing passkey wallets become unrecoverable.
 *
 * Single source of truth — every WebAuthn options object that needs an
 * `rpId` imports this constant. The AST drift scanner catches any
 * future literal `"nulo.sh"` in WebAuthn-options-shaped positions.
 */
export const RP_ID = "nulo.sh"

// `PASSKEY_PRF_LABEL` + `PasskeyCredentialData` live in
// `@nulo/wallet-crypto`. Re-exported here so call sites importing from
// `@/wallet/services/passkey/spec` keep working; this module owns only
// the service-layer concerns (request shape, method contracts, timeout).
export { PASSKEY_PRF_LABEL, type PasskeyCredentialData } from "@nulo/wallet-crypto"

export type PasskeyRequest =
	| {
			mode: "create"
			userHandle: string
	  }
	| {
			mode: "get"
			credentialId?: string
	  }

export type PasskeyRequestPromise = {
	resolve: (r: PasskeyCredential) => void
	reject: (reason: string) => void
	request: PasskeyRequest
}

export type Methods = {
	/**
	 * Returns details for the pending request so the window can proceed.
	 * Used by PATH B (SW-driven window): the spawned window calls this
	 * to learn what mode/userHandle/credentialId the SW is asking for.
	 * @param requestId Pending request identifier.
	 */
	getPendingRequest(requestId: string): PasskeyRequest

	/**
	 * Resolves a pending request, completing the promise.
	 * Used by PATH B: the spawned window posts the WebAuthn result here.
	 * @param requestId Pending request identifier.
	 * @param result Credential data containing the credential id and PRF output (base64 strings).
	 */
	resolvePasskeyRequest(requestId: string, result: PasskeyCredentialData): void

	/**
	 * Rejects a pending request with a reason.
	 * Used by PATH B.
	 * @param requestId Pending request identifier.
	 * @param reason Human-readable reason for rejection.
	 */
	rejectPasskeyRequest(requestId: string, reason: string): void
}

// PATH A note: `PasskeyService.materializeCredential(data)` is a
// SW-internal method (NOT in `Methods`) that wraps `PasskeyCredential.create`
// for popup-driven flows. The popup runs WebAuthn itself via
// `src/popup/utils/passkey-ceremony.ts` and hands the result to
// `ProfileService.{createPasskeyProfile,unlockPasskeyProfile,importPasskey}`
// which call `materializeCredential` SW-internally before delegating to the
// recovery coordinator. PasskeyCredential holds CryptoKey state so it
// can't cross the RPC boundary; it stays SW-internal.
