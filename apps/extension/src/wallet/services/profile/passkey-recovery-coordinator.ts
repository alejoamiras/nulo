/**
 * `PasskeyRecoveryCoordinator` — passkey-side half of the profile flow.
 *
 * Wraps the lower-level `PasskeyService` with a wallet-level semantic
 * interface:
 *   - Create a passkey credential bound to a new profile.
 *   - Recover the master secret from an existing credential (by id for
 *     the unlock path, or without one for the import path).
 *   - Confirm the user still holds the key bound to a profile.
 *
 * Pure coordinator: no storage, no session state, no passwords, no
 * locking. The facade serializes cross-collaborator workflows.
 *
 * ## Lock scope contract
 *
 * WebAuthn prompts take up to 3 minutes (the user must physically touch
 * the authenticator). The `ProfileService` lock has a 5-minute safety
 * force-release; holding it across a WebAuthn prompt is legal in theory
 * but pathological in practice. Every passkey path follows the same
 * shape: **callers MUST run the prompt unlocked**, then re-enter the
 * lock for storage writes. The coordinator itself is lock-agnostic and
 * makes no locking assumptions. `service.ts:221-274` shows the
 * snapshot → unlocked-prompt → revalidate-under-lock pattern.
 */

import type { ILogger } from "@/wallet/logger"
import type { PasskeyService } from "@/wallet/services/passkey/service"
import type { Base64CredentialId, HexUserHandle, MasterSecretBytes, PasskeyCredentialData } from "@nulo/wallet-crypto"
import type { Profile } from "./spec"

/** Shape returned by create / import paths — everything the facade
 *  needs to persist a passkey Profile + open the first session.
 *
 *  `secret` is the canonical Fr-reduced master-key bytes as returned by
 *  `PasskeyCredential.deriveMasterSecret()`. It is a raw byte buffer,
 *  not an `Fr` instance — `SessionManager.open()` consumes a buffer
 *  directly, so there is no reason to round-trip through `Fr`. */
export type PasskeyRecovery = {
	credentialId: Base64CredentialId
	secret: MasterSecretBytes
	/** The AES-GCM wrap key for the imported-keys DEK slot, derived while the credential is
	 *  transiently alive (same HKDF extract as the master, distinct expand — see
	 *  `PasskeyCredential.deriveDekWrapKey`). Non-extractable; nothing to zeroize. */
	dekWrapKey: CryptoKey
	/** Optional because WebAuthn `get` may omit userHandle. */
	userHandle?: HexUserHandle
}

export class PasskeyRecoveryCoordinator {
	public constructor(
		private readonly passkeys: PasskeyService,
		private readonly logger: ILogger,
	) {}

	/** Bind a new passkey credential to a freshly-chosen profile id +
	 *  derive the master secret from the PRF output. Caller (the
	 *  facade) pre-picked `profileId` via `ProfileRepository.generateUniqueId()`
	 *  and will re-verify it under the lock after this returns. */
	public async createForNewProfile(profileId: string, name: string): Promise<PasskeyRecovery> {
		const credential = await this.passkeys.createKey(profileId, name)
		const secret = await credential.deriveMasterSecret()
		const dekWrapKey = await credential.deriveDekWrapKey()
		return {
			credentialId: credential.id,
			secret,
			dekWrapKey,
			userHandle: credential.userHandle,
		}
	}

	/** Unlock an existing passkey profile by credentialId, or recover
	 *  the credential during `restore()`. Returns the full recovery
	 *  shape (credentialId echoes the request, userHandle may differ
	 *  from what the caller had, secret is the PRF-derived master). */
	public async recoverByCredentialId(credentialId: string): Promise<PasskeyRecovery> {
		const credential = await this.passkeys.getKey(credentialId)
		const secret = await credential.deriveMasterSecret()
		const dekWrapKey = await credential.deriveDekWrapKey()
		return {
			credentialId: credential.id,
			secret,
			dekWrapKey,
			userHandle: credential.userHandle,
		}
	}

	/** Import an existing passkey with no credentialId pre-known (used by
	 *  `importPasskey`). WebAuthn's `get` with no allowedCredentials
	 *  returns whichever credential the user selects. */
	public async recoverUnknown(): Promise<PasskeyRecovery> {
		const credential = await this.passkeys.getKey()
		const secret = await credential.deriveMasterSecret()
		const dekWrapKey = await credential.deriveDekWrapKey()
		return {
			credentialId: credential.id,
			secret,
			dekWrapKey,
			userHandle: credential.userHandle,
		}
	}

	/** PATH A — caller (popup) has already collected `PasskeyCredentialData`
	 *  via the in-page WebAuthn ceremony. Materialize the credential
	 *  SW-side and derive the master secret. Equivalent to
	 *  `createForNewProfile` / `recoverByCredentialId` / `recoverUnknown`
	 *  except no window is opened — the caller drove the ceremony.
	 *
	 *  The ceremony mode that was run is implicit in `data`:
	 *    - `mode: "create"` → `data.userHandle` is the new profile id
	 *    - `mode: "get"` → `data.userHandle` echoes whatever WebAuthn
	 *      returned (may be undefined). */
	public async recoverFromCredentialData(data: PasskeyCredentialData): Promise<PasskeyRecovery> {
		const credential = await this.passkeys.materializeCredential(data)
		const secret = await credential.deriveMasterSecret()
		const dekWrapKey = await credential.deriveDekWrapKey()
		return {
			credentialId: credential.id,
			secret,
			dekWrapKey,
			userHandle: credential.userHandle,
		}
	}

	/** Verifies the user still holds the key bound to this passkey
	 *  profile. Used by `confirmProfileOperation` for the passkey
	 *  branch; the password branch goes through `PasswordSecretBox`
	 *  on the facade. Dropped the `password?` parameter that the
	 *  original plan had — codex audit Q2 confirmed the facade
	 *  should dispatch on `profile.type` instead of pushing both
	 *  branches into this coordinator. */
	public async confirm(profile: Profile & { type: "passkey" }): Promise<void> {
		if (!profile.credentialId) {
			throw new Error("Missing credentialId")
		}
		const credential = await this.passkeys.getKey(profile.credentialId)
		if (!credential) {
			throw new Error("Failed to get passkey credential")
		}
	}
}
