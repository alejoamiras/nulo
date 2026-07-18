import type { ILogger } from "@/wallet/logger"
import type { IService, ServiceCollection } from "@/wallet/base"
import { AccountService } from "@/wallet/services/account/service"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { ContactService } from "@/wallet/services/contact/service"
import { DappSessionService } from "@/wallet/services/dapp-session/service"
import { FpcService } from "@/wallet/services/fpc/service"
import { IncomingTransferService } from "@/wallet/services/incoming-transfer/service"
import { NetworkService } from "@/wallet/services/network/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { TokenBalanceService } from "@/wallet/services/token-balance/service"
import { TokenService } from "@/wallet/services/token/service"
import { TransactionService } from "@/wallet/services/transaction/service"
import type { ProfileDeletionDelegate, ProfileDeletionRows, ProfileDeletionSnapshot } from "./types"

export const PROFILE_DELETION_COORDINATOR_NAME = "profile-deletion-coordinator"
export type { ProfileDeletionDelegate, ProfileDeletionRows, ProfileDeletionSnapshot } from "./types"

/**
 * ProfileDeletionCoordinator — the awaited, idempotent purge of EVERY
 * profile-bearing root (finding D). Started LAST (declares dependencies on all
 * the services it drives), then registers itself as ProfileService's deletion
 * delegate. It owns NO storage: ProfileService owns the tombstone lifecycle and
 * calls `snapshot`/`runFor`; the coordinator only executes the purge.
 */
export class ProfileDeletionCoordinator implements IService, ProfileDeletionDelegate {
	public static readonly name = PROFILE_DELETION_COORDINATOR_NAME
	public readonly name = PROFILE_DELETION_COORDINATOR_NAME
	public readonly dependencies = [
		ProfileService.name,
		AccountService.name,
		TokenService.name,
		NetworkService.name,
		TransactionService.name,
		AuthRegistryService.name,
		TokenBalanceService.name,
		IncomingTransferService.name,
		ContactService.name,
		DappSessionService.name,
		FpcService.name,
		OperationJournalService.name,
	] as const

	private profiles!: ProfileService
	private accounts!: AccountService
	private tokens!: TokenService
	private networks!: NetworkService
	private txs!: TransactionService
	private auth!: AuthRegistryService
	private balances!: TokenBalanceService
	private incoming!: IncomingTransferService
	private contacts!: ContactService
	private sessions!: DappSessionService
	private fpcs!: FpcService
	private journal!: OperationJournalService
	private readonly pxe: PxeServiceClient
	/** Single-flight per profile so a resume + a live delete can't run twice. */
	private readonly inflight = new Map<string, Promise<void>>()

	public constructor(private readonly logger: ILogger) {
		this.pxe = new PxeServiceClient(logger)
	}

	public async start(services: ServiceCollection): Promise<void> {
		this.profiles = services.get(ProfileService.name)
		this.accounts = services.get(AccountService.name)
		this.tokens = services.get(TokenService.name)
		this.networks = services.get(NetworkService.name)
		this.txs = services.get(TransactionService.name)
		this.auth = services.get(AuthRegistryService.name)
		this.balances = services.get(TokenBalanceService.name)
		this.incoming = services.get(IncomingTransferService.name)
		this.contacts = services.get(ContactService.name)
		this.sessions = services.get(DappSessionService.name)
		this.fpcs = services.get(FpcService.name)
		this.journal = services.get(OperationJournalService.name)
		this.profiles.setDeletionDelegate(this)
	}

	/** Lock-free profileId reads only (safe under ProfileService's facade lock). */
	public async snapshot(profileId: string): Promise<ProfileDeletionRows> {
		const [accounts, tokens, networks] = await Promise.all([
			this.accounts.getAccountsRaw(profileId),
			this.tokens.getTokensRaw(profileId),
			this.networks.getNetworksRaw(profileId),
		])
		return {
			addresses: accounts.map((a) => a.address),
			tokenIds: tokens.map((t) => t.id),
			networkIds: networks.map((n) => n.id),
		}
	}

	public runFor(profileId: string, snapshot: ProfileDeletionSnapshot): Promise<void> {
		const existing = this.inflight.get(profileId)
		if (existing) return existing
		const p = this.purge(profileId, snapshot).finally(() => this.inflight.delete(profileId))
		this.inflight.set(profileId, p)
		return p
	}

	/**
	 * Awaited, fail-fast, idempotent. ORDER matters: the address-derived purges
	 * (tx/auth/balance) run BEFORE the network tail, so the tail's re-emitted
	 * `onAccountDeleted`/`onTokenDeleted` find their rows already gone (harmless
	 * no-op). Each step is idempotent (delete-of-gone is a no-op), so a resumed or
	 * re-run purge converges. Any throw propagates → the caller keeps the tombstone.
	 */
	private async purge(profileId: string, s: ProfileDeletionSnapshot): Promise<void> {
		await this.txs.purgeForAccounts(s.addresses)
		await this.auth.purgeForAccounts(s.addresses)
		await this.balances.purgeForTokens(s.tokenIds)
		await this.incoming.clearProfile(profileId)
		await this.contacts.purgeForProfile(profileId)
		await this.sessions.purgeForProfile(profileId)
		await this.fpcs.purgeForProfile(profileId)
		await this.journal.purgeForProfile(profileId)
		await this.accounts.purgeForProfile(profileId)
		await this.tokens.purgeForProfile(profileId)
		await this.networks.purgeForProfile(profileId)
		await this.pxe.clearProfileState(profileId, s.pxeGeneration)
	}

	/** Resume any tombstoned deletion after a restart. Called AFTER `services.start()`
	 *  so it never blocks unrelated startup. Delegates to ProfileService (which owns
	 *  the tombstone lifecycle); invalid tombstones stay reserved ("deletion pending"). */
	public async resumePending(): Promise<void> {
		await this.profiles.resumePendingDeletions()
	}
}
