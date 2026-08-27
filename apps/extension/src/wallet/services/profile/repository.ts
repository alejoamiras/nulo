/**
 * `ProfileRepository` — the storage layer for profile records.
 *
 * Pure CRUD around an `EntityStorage<Profile>`, plus a single helper
 * for the id-generation pattern.
 *
 * Ownership: this class owns the `nulo:core:profiles` storage root.
 * Nothing else in the codebase should touch that key directly. Changing
 * the key renames every existing profile record on disk — don't.
 *
 * Lock-free by design. The facade (`ProfileService`) is responsible for
 * serializing cross-collaborator operations; this class never reaches
 * for locks, sessions, or crypto. That keeps it trivially unit-testable
 * via `FakeBrowserApi`.
 */

import type { BrowserApi } from "@nulo/wallet-core/ports"
import { EntityStorage } from "@/wallet/storage"
import { nextRandomId } from "@/wallet/services/id-allocators"
import type { Profile } from "./spec"

/** Storage root for profile records. Frozen: renaming detaches every
 *  wallet on disk from its profile metadata. */
export const PROFILE_STORAGE_ROOT = "nulo:core:profiles"

/** Length in hex characters of generated profile ids. 8 hex chars ≈
 *  32 bits — collisions are astronomically unlikely for wallet-scale
 *  profile counts but the facade still re-verifies before `set()` (see
 *  `generateUniqueId` JSDoc for the full contract). */
const PROFILE_ID_HEX_LENGTH = 8

export class ProfileRepository {
	private readonly storage: EntityStorage<Profile>

	/**
	 * @param browserApi Optional port for the storage area. Tests pass
	 *        `FakeBrowserApi` so the repository operates against
	 *        in-memory state; the composition root passes the real
	 *        adapter. If omitted, falls back to `chrome.storage.local`
	 *        for legacy SW startup paths.
	 */
	public constructor(browserApi?: BrowserApi) {
		// Profile rows are the auth-critical root: every sealed-slot/MAC/fingerprint decision
		// trusts the row fetched BY id. The key-identity guard hides any raw-storage row whose
		// embedded id disagrees with its storage key, closing the embedded-id transplant bypass.
		const guard = { requireKeyIdentityMatch: true } as const
		this.storage = browserApi
			? new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, browserApi.storage.local, undefined, guard)
			: new EntityStorage<Profile>(PROFILE_STORAGE_ROOT, chrome.storage.local, undefined, guard)
	}

	/** Returns the profile with the given id, or `undefined`. */
	public get(id: string): Promise<Profile | undefined> {
		return this.storage.get(id)
	}

	/** Returns every profile currently on disk, order-unspecified. */
	public getAll(): Promise<Profile[]> {
		return this.storage.getValues()
	}

	/** `true` iff a profile record exists for the given id. */
	public contains(id: string): Promise<boolean> {
		return this.storage.contains(id)
	}

	/** Upserts `profile` under `id`. */
	public set(id: string, profile: Profile): Promise<void> {
		return this.storage.set(id, profile)
	}

	/** Removes the profile with the given id, if any. */
	public delete(id: string): Promise<void> {
		return this.storage.delete(id)
	}

	/**
	 * Returns a random id that is *not currently* in storage. The
	 * emphasis on "currently" is deliberate: this helper runs without
	 * any lock, so by the time the caller uses the returned id, another
	 * concurrent writer could have claimed it.
	 *
	 * **Contract for callers:** pair every use of `generateUniqueId`
	 * with a locked re-verification before `set()`:
	 *
	 *     const id = await repo.generateUniqueId()     // unlocked
	 *     await facadeLock.withLock(async () => {
	 *       while (await repo.contains(id)) {          // re-verify
	 *         id = await repo.generateUniqueId()        //   under lock
	 *       }
	 *       await repo.set(id, profile)
	 *     })
	 *
	 * This mirrors the existing pattern in `createPasskeyProfile`,
	 * where the WebAuthn prompt between generation and persistence
	 * can't be held under the lock (UI-blocking + 5-minute safety
	 * force-release). Keeping the generator lock-free lets callers
	 * interleave slow external work without inversion risk.
	 *
	 * For facade methods that don't have slow external work between
	 * generation and `set()` (e.g. `createProfile`, `importPassword*`),
	 * it's safe to call `generateUniqueId` inside the lock — the
	 * re-verify becomes a no-op but costs nothing.
	 */
	public async generateUniqueId(): Promise<string> {
		return nextRandomId(this, PROFILE_ID_HEX_LENGTH)
	}
}
