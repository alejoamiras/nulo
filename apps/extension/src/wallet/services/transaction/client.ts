import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Events, type Methods, TRANSACTION_SERVICE_NAME, type Tx } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface TransactionServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class TransactionServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onTransactionAdded = new EventHandler<Tx>()
	public readonly onTransactionUpdated = new EventHandler<Tx>()
	public readonly onTransactionDeleted = new EventHandler<Tx>()

	public constructor(name?: string) {
		super(TRANSACTION_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	/** Tx rows' own profileId is optional and backup-controlled, so restore
	 *  requires the authoritative created-profile id as its deletion-fence key.
	 *  The base client's `restore(...args)` enforces no arity — this typed
	 *  override makes an omitted id a compile error at the call site. */
	public override async restore(rows: unknown[], profileId: string): Promise<unknown> {
		return await super.restore(rows, profileId)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(TransactionServiceClient.prototype, ["getTransactions", "getTransaction"])
