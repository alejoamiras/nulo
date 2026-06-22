import { ProfileIdConflictError } from "@nulo/extension-messaging/errors"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import type { ProfileInfo } from "@/wallet/services/profile/client"
import type { PasskeyRequest } from "@/wallet/services/passkey/spec"

/**
 * Dependencies for creating a passkey-typed profile with the
 * ProfileIdConflictError retry handshake. All three are injected
 * explicitly so the helper is fully testable and decoupled from the
 * `managers.*` global proxy.
 *
 *   - runCeremony: hand off to the page's PasskeyCeremonyDialog (mode:
 *     "create" with the pre-reserved userHandle).
 *   - generateProfileId: ask the SW to reserve a fresh profile id.
 *   - createPasskeyProfile: persist the new profile with the collected
 *     credential.
 */
export interface CreatePasskeyProfileDeps {
	runCeremony: (req: PasskeyRequest) => Promise<PasskeyCredentialData>
	generateProfileId: () => Promise<string>
	createPasskeyProfile: (name: string, credData: PasskeyCredentialData) => Promise<ProfileInfo>
}

/**
 * Create a passkey-typed profile with a single retry on
 * `ProfileIdConflictError`.
 *
 * The pre-reserved id can be claimed by another flow during the
 * WebAuthn prompt. On conflict, we re-run the entire ceremony with a
 * fresh id (and therefore a fresh credential) to keep the credential's
 * userHandle in sync with the persisted profile id.
 *
 * Scope is bounded to (a) reserve an id, (b) run the ceremony,
 * (c) call createPasskeyProfile, (d) retry once on conflict. The caller
 * owns ALL post-create side effects — `chrome.storage.local` writes,
 * bootstrap orchestration, routing, etc.
 *
 * @throws ProfileIdConflictError if both attempts hit the conflict.
 * @throws UserRejectedError if the ceremony was cancelled.
 * @throws Other Error from the service-client.
 */
export async function createPasskeyProfileWithRetry(name: string, deps: CreatePasskeyProfileDeps): Promise<ProfileInfo> {
	const MAX_RETRIES = 1
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const profileId = await deps.generateProfileId()
		const credData = await deps.runCeremony({ mode: "create", userHandle: profileId, name })
		try {
			return await deps.createPasskeyProfile(name, credData)
		} catch (e) {
			if (e instanceof ProfileIdConflictError && attempt < MAX_RETRIES) {
				continue
			}
			throw e
		}
	}
	throw new Error("createPasskeyProfile retried beyond MAX_RETRIES")
}
