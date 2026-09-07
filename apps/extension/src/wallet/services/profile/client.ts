import type { MethodsSpec, Restored, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { PROFILE_SERVICE_NAME, type ProfileInfo, type Events, type Methods, type RestoreSecret } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface ProfileServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class ProfileServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onProfileAdded = new EventHandler<ProfileInfo>()
	public readonly onProfileUpdated = new EventHandler<ProfileInfo>()
	public readonly onProfileDeleted = new EventHandler<ProfileInfo>()
	public readonly onActiveProfileChanged = new EventHandler<ProfileInfo | undefined>()
	public readonly onImportedKeysDegraded = new EventHandler<ProfileInfo>()

	public constructor(name?: string) {
		super(PROFILE_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	/** Declared here (and re-installed by the exhaustive list below) because the base client's
	 *  untyped `restore(...unknown[])` convenience stub would otherwise shadow the merged signature. */
	public override restore(
		profile: ProfileInfo,
		secret: RestoreSecret,
		password?: string,
		credentialData?: PasskeyCredentialData,
		allowDuplicate?: boolean,
	): Promise<Restored<ProfileInfo>> {
		return this.request("restore", profile, secret, password, credentialData, allowDuplicate)
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
	 * resolve and the `add(...)` call below is lost. The window is a real RPC
	 * round-trip (not a microtask) — accepted; a future hardening could buffer
	 * emits during this window and flush after the snapshot.
	 */
	public async subscribeActiveProfile(handler: (profile: ProfileInfo | undefined) => void): Promise<() => void> {
		// Latch + sequence: an in-flight snapshot RPC must not deliver into an
		// unsubscribed (unmounted) consumer, and reconnect snapshots resolving
		// out of order — or after a fresher LIVE event — must stand down rather
		// than overwrite the newer profile. Live events bump the seq so a stale
		// snapshot can never win; snapshots bump it so only the latest delivers.
		let unsubscribed = false
		let seq = 0
		const liveHandler = (profile: ProfileInfo | undefined) => {
			if (unsubscribed) return
			seq += 1
			handler(profile)
		}
		const emitSnapshot = async () => {
			const mySeq = ++seq
			try {
				const snapshot = await this.getActiveProfile()
				if (unsubscribed || mySeq !== seq) return
				handler(snapshot)
			} catch {
				// Fetch failed (port disconnected, service errored). The
				// reconnect hook will retry once the port is live again.
			}
		}
		await emitSnapshot()
		this.onActiveProfileChanged.add(liveHandler)
		this.onConnected.add(emitSnapshot)
		return () => {
			unsubscribed = true
			this.onActiveProfileChanged.remove(liveHandler)
			this.onConnected.remove(emitSnapshot)
		}
	}
}
// Every RPC method is a pure request-passthrough (`subscribeActiveProfile` above is client-side
// composition, not an RPC); the installer's signature checks the name list in both directions.
definePassthroughsExhaustive<Methods>()(ProfileServiceClient.prototype, [
	"getActiveProfile",
	"getProfiles",
	"generateProfileId",
	"createProfile",
	"createPasskeyProfile",
	"unlockProfile",
	"unlockPasskeyProfile",
	"getPasskeyCredentialId",
	"lockActiveProfile",
	"refreshSession",
	"changeProfileName",
	"changeProfilePassword",
	"confirmProfileOperation",
	"deleteProfile",
	"importMnemonic",
	"importPasskey",
	"exportPlain",
	"exportBackupMaterial",
	"getProfileDekSealed",
	"exportMnemonic",
	"restore",
	"finalizeRestore",
])
