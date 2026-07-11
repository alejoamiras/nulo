/**
 * Pure helper that runs the WebAuthn passkey ceremony from a popup-side
 * frame, returning the `PasskeyCredentialData` shape the wallet's
 * `PasskeyService.materializeCredential` consumes.
 *
 * Single source of truth for the WebAuthn parameter shape and PRF
 * extension wiring: the in-page dialog (PATH A) and the SW-driven window
 * (PATH B, kept for flows where the popup isn't open) both call this, so
 * the two ceremony hosts never diverge — a regression in either calls the
 * same code.
 */

import {
	asBase64CredentialId,
	asBase64SecretPrf,
	asHexUserHandle,
	type PasskeyCredentialData,
	PASSKEY_PRF_LABEL,
} from "@nulo/wallet-crypto"
import { PASSKEY_TIMEOUT, type PasskeyRequest, RP_ID } from "@/wallet/services/passkey/spec"
import { fromBase64, toBase64 } from "@/wallet/utils"
import { formatPasskeyUserName } from "./passkey-label"

function encodeBase64(buf: BufferSource): string {
	const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
	return toBase64(bytes)
}

function decodeBase64(b64: string): Uint8Array {
	return fromBase64(b64)
}

async function buildPrfInput(): Promise<ArrayBuffer> {
	const te = new TextEncoder()
	return await crypto.subtle.digest("SHA-256", te.encode(PASSKEY_PRF_LABEL))
}

export async function buildCreateOptions(userHandle: string, name: string): Promise<PublicKeyCredentialCreationOptions> {
	const challenge = crypto.getRandomValues(new Uint8Array(32))
	const prfInput = await buildPrfInput()
	const userHandleBytes = Uint8Array.from(Buffer.from(userHandle, "hex"))
	// The label shown by iCloud Keychain / password managers. `user.name` and
	// `user.displayName` carry the same value so the credential renders
	// consistently regardless of which field a given manager surfaces.
	const label = formatPasskeyUserName(name, userHandle)
	return {
		challenge,
		rp: {
			name: "Nulo",
			id: RP_ID,
		},
		user: {
			id: userHandleBytes,
			name: label,
			displayName: label,
		},
		pubKeyCredParams: [{ type: "public-key", alg: -7 }],
		authenticatorSelection: {
			residentKey: "required",
			userVerification: "required",
			requireResidentKey: true,
		},
		timeout: PASSKEY_TIMEOUT,
		extensions: { prf: { eval: { first: new Uint8Array(prfInput) } } },
	}
}

export async function buildGetOptions(credentialId?: string): Promise<PublicKeyCredentialRequestOptions> {
	const challenge = crypto.getRandomValues(new Uint8Array(32))
	const prfInput = await buildPrfInput()
	const opts: PublicKeyCredentialRequestOptions = {
		challenge,
		rpId: RP_ID,
		userVerification: "required",
		timeout: PASSKEY_TIMEOUT,
		extensions: { prf: { eval: { first: new Uint8Array(prfInput) } } },
	}
	if (credentialId) {
		// Cast through unknown — `Uint8Array<ArrayBufferLike>` from
		// `Uint8Array.from` upcasts to BufferSource at runtime; TS's stricter
		// generic-typed-array narrowing in @types/dom misses this. Mirrors the
		// pre-extraction code in `windows/passkey/index.vue` which compiled
		// without this cast under the same target.
		opts.allowCredentials = [{ id: decodeBase64(credentialId) as unknown as BufferSource, type: "public-key" }]
	}
	return opts
}

/**
 * Run the create-mode ceremony. Throws if PRF wasn't returned (the wallet
 * hard-requires PRF; the master derivation pipe can't run without it).
 *
 * `signal` aborts the underlying `navigator.credentials.create` call if
 * the caller cancels (Escape, dialog dismount, popup nav).
 */
async function runCreate(userHandle: string, name: string, signal?: AbortSignal): Promise<PasskeyCredentialData> {
	const publicKey = await buildCreateOptions(userHandle, name)
	const credential = await navigator.credentials.create({ publicKey, signal })
	if (!credential) throw new Error("Failed to create passkey credential")
	if (!(credential instanceof PublicKeyCredential)) throw new Error("Unexpected credential type")
	const ext = credential.getClientExtensionResults()
	if (!ext.prf) throw new Error("Passkey PRF not available")

	if (ext.prf.enabled) {
		if (!ext.prf.results) throw new Error("Passkey PRF has no results")
		return {
			id: asBase64CredentialId(encodeBase64(credential.rawId)),
			prf: asBase64SecretPrf(encodeBase64(ext.prf.results.first)),
			userHandle: asHexUserHandle(userHandle),
		}
	}

	// Fallback path: some authenticators only return PRF on `get`, not on
	// `create`. Re-prompt with a get to fetch the PRF for the just-created
	// credential. Mirrors the original `windows/passkey/index.vue:74-77`
	// behavior.
	const rawIdB64 = encodeBase64(credential.rawId)
	return await runGet(rawIdB64, signal)
}

async function runGet(credentialId: string | undefined, signal?: AbortSignal): Promise<PasskeyCredentialData> {
	const publicKey = await buildGetOptions(credentialId)
	const assertion = await navigator.credentials.get({ publicKey, signal })
	if (!assertion) throw new Error("Failed to get passkey assertion")
	if (!(assertion instanceof PublicKeyCredential)) throw new Error("Unexpected assertion type")
	const ext = assertion.getClientExtensionResults()
	if (!ext.prf) throw new Error("Passkey PRF not available")
	if (!ext.prf.results) throw new Error("Passkey PRF has no results")
	if (!(assertion.response instanceof AuthenticatorAssertionResponse)) throw new Error("Unexpected assertion response type")
	const userHandleOption = assertion.response.userHandle
	return {
		id: asBase64CredentialId(encodeBase64(assertion.rawId)),
		prf: asBase64SecretPrf(encodeBase64(ext.prf.results.first)),
		userHandle: userHandleOption ? asHexUserHandle(Buffer.from(userHandleOption).toString("hex")) : undefined,
	}
}

/**
 * Run a passkey ceremony for the given request, returning the credential
 * data the wallet needs to derive a master secret.
 *
 * `signal` is forwarded to `navigator.credentials.{create,get}` so the
 * caller can abort the ceremony cleanly via `AbortController.abort()`.
 * Aborts surface as DOMException("AbortError").
 */
export async function runPasskeyCeremony(request: PasskeyRequest, signal?: AbortSignal): Promise<PasskeyCredentialData> {
	if (request.mode === "create") {
		return await runCreate(request.userHandle, request.name, signal)
	}
	return await runGet(request.credentialId, signal)
}
