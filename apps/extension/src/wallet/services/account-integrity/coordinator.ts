import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { IService, ServiceCollection } from "@/wallet/base"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import { AccountService, AccountType } from "@/wallet/services/account/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { AccountAddressInconsistencyError } from "@nulo/extension-messaging/errors"
import { NuloAccount, V5_REGIME } from "@nulo/aztec-runtime/account"
import type { MasterSecretBytes } from "@nulo/wallet-crypto"
import type { BrowserApi, StorageArea } from "@nulo/wallet-core/ports"
import { AccountIntegrityBlockedRepository, AccountIntegrityVerifiedStampRepository } from "./blocked-repository"
import type { AccountIntegrityBlocked, AccountIntegrityDelegate, AccountRuntimeIntegrityDelegate } from "./types"

declare const __VERSION__: string
const walletVersion = (): string => (typeof __VERSION__ === "undefined" ? "unknown" : __VERSION__)

export const ACCOUNT_INTEGRITY_COORDINATOR_NAME = "account-integrity-coordinator"

/** Injectable for unit tests (jsdom cannot run bb.js poseidon); production always uses the REAL
 *  frozen path — the same secret formula and `NuloAccount.new` the wallet derives with. */
export type DeriveAddress = (master: Fr, account: { chainId: number; type: number; index: number }) => Promise<string>

/**
 * AccountIntegrityCoordinator — the background owner of the address-freeze runtime check.
 *
 * Started LAST (declares dependencies on the services it drives), then registers itself as the
 * integrity delegate of ProfileService (pre-session-open verification) and AccountService
 * (operation-time mismatch reporting). A mismatch means this build derives different addresses
 * than the profile's stored accounts — wrong build for the profile's address regime, or tampered
 * rows. Response: withhold/close the session, persist a blocking record that survives SW
 * restarts (read raw by the popup barrier), and surface the typed error. The check is pure
 * KDF + descriptor + artifact — no PXE, no node — so it cannot produce transient false positives.
 */
export class AccountIntegrityCoordinator implements IService, AccountIntegrityDelegate, AccountRuntimeIntegrityDelegate {
	public static readonly name = ACCOUNT_INTEGRITY_COORDINATOR_NAME
	public readonly name = ACCOUNT_INTEGRITY_COORDINATOR_NAME
	public readonly dependencies = [ProfileService.name, AccountService.name] as const

	private profiles!: ProfileService
	private accounts!: AccountService
	private readonly blocked: AccountIntegrityBlockedRepository
	private readonly stamps: AccountIntegrityVerifiedStampRepository

	public constructor(
		private readonly logger: ILogger,
		browserApi?: BrowserApi,
		private readonly deriveAddress: DeriveAddress = async (master, account) => {
			// Mirrors AccountService.deriveAccountSecret exactly — same formula, same frozen path.
			const secret = await poseidon2Hash([master, account.chainId, account.type, account.index])
			return (await NuloAccount.new(secret, logger)).address.toString()
		},
	) {
		const storage = (browserApi?.storage.local ?? chrome.storage.local) as StorageArea
		this.blocked = new AccountIntegrityBlockedRepository(storage)
		this.stamps = new AccountIntegrityVerifiedStampRepository(storage)
	}

	public async start(services: ServiceCollection): Promise<void> {
		this.profiles = services.get(ProfileService.name)
		this.accounts = services.get(AccountService.name)
		this.profiles.setIntegrityDelegate(this)
		this.accounts.setIntegrityDelegate(this)
		// The green stamp is keyed by (profile, walletVersion) — it must NOT survive an account-set
		// change on the same build, or a boot could skip re-verifying a row added/restored after the
		// stamp was written. Any account mutation invalidates the profile's stamp, forcing a
		// re-verify on the next boot.
		this.accounts.onAccountAdded.add((account) => void this.stamps.clear(account.profileId).catch(() => {}))
		this.accounts.onAccountDeleted.add((account) => void this.stamps.clear(account.profileId).catch(() => {}))
		// The one activation the per-open chokepoint cannot see: an extension UPDATE rehydrates the
		// previous session silently, so the first boot of a NEW build re-verifies it here (once per
		// (profile, walletVersion) — the stamp keeps every later SW wake free). Fire-and-forget ON
		// PURPOSE: re-deriving N accounts with a cold bb WASM can take tens of seconds, and doing it
		// inside `services.start()` would stall EVERY service RPC past the popup's boot budget. The
		// verdict still lands mid-flight (mismatch → durable record + session close), so the exposed
		// window stays bounded to the verify's own duration.
		this.bootVerification = this.verifyRestoredSessionOnce().catch((error) => {
			this.logger.log(this.name, LogLevel.Error, "boot integrity verification failed", String(error))
		})
	}

	/** The in-flight boot verification — observable (tests await it); startup never does. */
	public bootVerification: Promise<void> = Promise.resolve()

	private async verifyRestoredSessionOnce(): Promise<void> {
		const active = await this.profiles.getActiveProfile()
		if (!active) return
		if ((await this.stamps.get(active.id))?.walletVersion === walletVersion()) return
		let master: Fr
		try {
			master = await this.profiles.getProfileSecret(active.id)
		} catch {
			// Locked/raced away between the getActiveProfile read and here — nothing rehydrated to
			// verify; the next real open goes through the chokepoint.
			return
		}
		try {
			await this.verifyProfile(active.id, master)
		} catch (error) {
			if (error instanceof AccountAddressInconsistencyError) {
				// Close ONLY the profile we verified — a different profile may have become active
				// during the (slow, unlocked) verification.
				await this.profiles.lockProfileIfActive(active.id)
				return
			}
			throw error
		}
	}

	/** See `AccountIntegrityDelegate.verifyBeforeSessionOpen`. */
	public async verifyBeforeSessionOpen(profileId: string, masterSecret: MasterSecretBytes): Promise<void> {
		await this.verifyProfile(profileId, Fr.fromBuffer(Buffer.from(masterSecret)))
	}

	/** Re-derive every stored account for the profile and compare; persist + throw on mismatch,
	 *  heal the block and stamp the build on green. */
	private async verifyProfile(profileId: string, master: Fr): Promise<void> {
		const rows = await this.accounts.getAccountsRaw(profileId)
		for (const account of rows) {
			// Only Nulo_v1 rows have a derivation to re-check; an unknown future type is skipped
			// here and rejected at use by AccountService's own type guard.
			if (account.type !== AccountType.Nulo_v1) continue
			const derivedAddress = await this.deriveAddress(master, account)
			if (derivedAddress !== account.address) {
				const record: AccountIntegrityBlocked = {
					profileId,
					chainId: account.chainId,
					accountIndex: account.index,
					storedAddress: account.address,
					derivedAddress,
					regimeId: V5_REGIME.id,
					walletVersion: walletVersion(),
					detectedAt: Date.now(),
				}
				this.logger.log(
					this.name,
					LogLevel.Error,
					"account address integrity mismatch — session withheld",
					`profile=${profileId} chain=${account.chainId} index=${account.index}`,
				)
				await this.blocked.set(record)
				throw new AccountAddressInconsistencyError(undefined, {
					profileId,
					chainId: account.chainId,
					accountIndex: account.index,
				})
			}
		}
		// A green pass heals a stale block (installing a build whose derivation matches again is
		// exactly the documented recovery path) and stamps the build so the boot path can skip
		// re-deriving until the next update.
		await this.blocked.clear(profileId)
		await this.stamps.set(profileId, { walletVersion: walletVersion() })
	}

	/** See `AccountRuntimeIntegrityDelegate.closeSessionForMismatch`. The DURABLE block was already
	 *  written by AccountService (fail-closed); this only closes the live session — and ONLY if the
	 *  mismatching profile is still the active one. */
	public async closeSessionForMismatch(profileId: string): Promise<void> {
		this.logger.log(this.name, LogLevel.Error, "runtime account address mismatch — closing session", `profile=${profileId}`)
		await this.profiles.lockProfileIfActive(profileId)
	}
}
