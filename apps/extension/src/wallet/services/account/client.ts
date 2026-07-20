import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Account, ACCOUNT_SERVICE_NAME, type Events, type Methods } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const ACCOUNT_METHODS = [
	"getAccounts",
	"getAccount",
	"createAccount",
	"ensureDefaultAccount",
	"changeAccountName",
	"changeAccountVisibility",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _AccountMethodsExhaustive =
	Exclude<keyof Methods, (typeof ACCOUNT_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof ACCOUNT_METHODS)[number]>
const _accountMethodsExhaustive: _AccountMethodsExhaustive = true
void _accountMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface AccountServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class AccountServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onAccountAdded = new EventHandler<Account>()
	public readonly onAccountUpdated = new EventHandler<Account>()
	public readonly onAccountDeleted = new EventHandler<Account>()

	public constructor(name?: string) {
		super(ACCOUNT_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(AccountServiceClient.prototype, ACCOUNT_METHODS)
