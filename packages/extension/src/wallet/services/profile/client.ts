import type { Restored, ServiceSpec } from "@/wallet/base"
import { ServiceClient } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { PROFILE_SERVICE_NAME, type ProfileInfo, type Events, type Methods } from "./spec"

export * from "./spec"

export class ProfileServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onProfileAdded = new EventHandler<ProfileInfo>()
	public readonly onProfileUpdated = new EventHandler<ProfileInfo>()
	public readonly onProfileDeleted = new EventHandler<ProfileInfo>()
	public readonly onActiveProfileChanged = new EventHandler<ProfileInfo | undefined>()

	public constructor(name?: string) {
		super(PROFILE_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	public getActiveProfile(): Promise<ProfileInfo | undefined> {
		return this.request("getActiveProfile")
	}

	public getProfiles(): Promise<ProfileInfo[]> {
		return this.request("getProfiles")
	}

	public generateProfileId(): Promise<string> {
		return this.request("generateProfileId")
	}

	public createProfile(name: string, password: string): Promise<ProfileInfo> {
		return this.request("createProfile", name, password)
	}

	public createPasskeyProfile(name: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		return this.request("createPasskeyProfile", name, credentialData)
	}

	public unlockProfile(id: string, password: string): Promise<ProfileInfo> {
		return this.request("unlockProfile", id, password)
	}

	public unlockPasskeyProfile(id: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		return this.request("unlockPasskeyProfile", id, credentialData)
	}

	public getPasskeyCredentialId(id: string): Promise<string> {
		return this.request("getPasskeyCredentialId", id)
	}

	public lockActiveProfile(): Promise<void> {
		return this.request("lockActiveProfile")
	}

	public refreshSession(): Promise<void> {
		return this.request("refreshSession")
	}

	public changeProfileName(id: string, newName: string): Promise<ProfileInfo> {
		return this.request("changeProfileName", id, newName)
	}

	public changeProfilePassword(id: string, oldPassword: string, newPassword: string): Promise<ProfileInfo> {
		return this.request("changeProfilePassword", id, oldPassword, newPassword)
	}

	public confirmProfileOperation(id: string, password?: string): Promise<boolean> {
		return this.request("confirmProfileOperation", id, password)
	}

	public deleteProfile(id: string): Promise<ProfileInfo> {
		return this.request("deleteProfile", id)
	}

	public importEncrypted(name: string, secret: string, password: string): Promise<ProfileInfo> {
		return this.request("importEncrypted", name, secret, password)
	}

	public importPlain(name: string, secret: string, password: string): Promise<ProfileInfo> {
		return this.request("importPlain", name, secret, password)
	}

	public importMnemonic(name: string, mnemonic: string[], password: string): Promise<ProfileInfo> {
		return this.request("importMnemonic", name, mnemonic, password)
	}

	public importPasskey(name: string, credentialData?: PasskeyCredentialData): Promise<ProfileInfo> {
		return this.request("importPasskey", name, credentialData)
	}

	public exportEncrypted(id: string): Promise<string> {
		return this.request("exportEncrypted", id)
	}

	public exportPlain(id: string, password?: string, credentialData?: PasskeyCredentialData): Promise<string> {
		return this.request("exportPlain", id, password, credentialData)
	}

	public exportMnemonic(id: string, password: string): Promise<string[]> {
		return this.request("exportMnemonic", id, password)
	}

	public restore(
		profile: ProfileInfo,
		masterKey: string,
		password?: string,
		credentialData?: PasskeyCredentialData,
	): Promise<Restored<ProfileInfo>> {
		return this.request("restore", profile, masterKey, password, credentialData)
	}

	public finalizeRestore(id: string, password?: string): Promise<ProfileInfo> {
		return this.request("finalizeRestore", id, password)
	}

	/**
	 * Snapshot-with-subscribe pattern.
	 *
	 * Preferred over `onActiveProfileChanged.add(...)` + manual
	 * `getActiveProfile()`. Does three things in one call:
	 *
	 *   1. Fetches the current active profile and fires `handler` once
	 *      with it (the snapshot). If no profile is active, `handler` is
	 *      called with `undefined`.
	 *   2. Subscribes to `onActiveProfileChanged` so every subsequent
	 *      change fires `handler`.
	 *   3. On `onConnected` (SW restart / reconnect), re-fetches the
	 *      current state and re-fires `handler` — otherwise events
	 *      emitted during the disconnect window would be lost.
	 *
	 * Returns an unsubscribe function that detaches both the event and
	 * the reconnect hook. Consumers **should** call it from `onBeforeUnmount`.
	 *
	 * Known edge case: an event fired between the snapshot `getActiveProfile`
	 * resolve and the `add(...)` call below is lost. In practice the
	 * window is one microtask — acceptable for the pilot. A future hardening
	 * could buffer emits during this window and flush after the snapshot.
	 */
	public async subscribeActiveProfile(handler: (profile: ProfileInfo | undefined) => void): Promise<() => void> {
		const emitSnapshot = async () => {
			try {
				const snapshot = await this.getActiveProfile()
				handler(snapshot)
			} catch {
				// Fetch failed (port disconnected, service errored). The
				// reconnect hook will retry once the port is live again.
			}
		}
		await emitSnapshot()
		this.onActiveProfileChanged.add(handler)
		this.onConnected.add(emitSnapshot)
		return () => {
			this.onActiveProfileChanged.remove(handler)
			this.onConnected.remove(emitSnapshot)
		}
	}
}
