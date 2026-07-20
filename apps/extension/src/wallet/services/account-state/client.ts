import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ACCOUNT_STATE_SERVICE_NAME, type Events, type Methods } from "./spec"
import { LoggerServiceClient } from "../logger/client"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const ACCOUNT_STATE_METHODS = [
	"getAccounts",
	"getSenders",
	"getSendersAcrossActiveNetworks",
	"addSender",
	"deleteSender",
	"getContracts",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _AccountStateMethodsExhaustive =
	Exclude<keyof Methods, (typeof ACCOUNT_STATE_METHODS)[number]> extends never
		? true
		: Exclude<keyof Methods, (typeof ACCOUNT_STATE_METHODS)[number]>
const _accountStateMethodsExhaustive: _AccountStateMethodsExhaustive = true
void _accountStateMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface AccountStateServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class AccountStateServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onSenderAdded = new EventHandler<string>()
	public readonly onSenderDeleted = new EventHandler<string>()

	public constructor(name?: string) {
		super(ACCOUNT_STATE_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(AccountStateServiceClient.prototype, ACCOUNT_STATE_METHODS)
