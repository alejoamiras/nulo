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
import { AccountIntegrityBlockedRepository } from "./blocked-repository"
import type { AccountIntegrityBlocked, AccountIntegrityDelegate, AccountRuntimeIntegrityDelegate } from "./types"

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

	public constructor(
		private readonly logger: ILogger,
		browserApi?: BrowserApi,
		private readonly deriveAddress: DeriveAddress = async (master, account) => {
			// Mirrors AccountService.deriveAccountSecret exactly — same formula, same frozen path.
			const secret = await poseidon2Hash([master, account.chainId, account.type, account.index])
			return (await NuloAccount.new(secret, logger)).address.toString()
		},
	) {
		this.blocked = new AccountIntegrityBlockedRepository((browserApi?.storage.local ?? chrome.storage.local) as StorageArea)
	}

	public async start(services: ServiceCollection): Promise<void> {
		this.profiles = services.get(ProfileService.name)
		this.accounts = services.get(AccountService.name)
		this.profiles.setIntegrityDelegate(this)
		this.accounts.setIntegrityDelegate(this)
	}

	/** See `AccountIntegrityDelegate.verifyBeforeSessionOpen`. */
	public async verifyBeforeSessionOpen(profileId: string, masterSecret: MasterSecretBytes): Promise<void> {
		const rows = await this.accounts.getAccountsRaw(profileId)
		const master = Fr.fromBuffer(Buffer.from(masterSecret))
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
					walletVersion: typeof __VERSION__ === "undefined" ? "unknown" : __VERSION__,
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
		// A green pass heals a stale block: installing a build whose derivation matches again is
		// exactly the documented recovery path.
		await this.blocked.clear(profileId)
	}

	/** See `AccountRuntimeIntegrityDelegate.reportRuntimeMismatch`. */
	public async reportRuntimeMismatch(record: AccountIntegrityBlocked): Promise<void> {
		await this.blocked.set(record)
		this.logger.log(
			this.name,
			LogLevel.Error,
			"runtime account address mismatch — closing session",
			`profile=${record.profileId} chain=${record.chainId} index=${record.accountIndex}`,
		)
		// Close the live session so nothing further operates on the mismatched profile; the
		// persisted record keeps the profile blocked across SW restarts.
		await this.profiles.lockActiveProfile()
	}
}
