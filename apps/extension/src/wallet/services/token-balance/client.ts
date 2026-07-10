import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Events, type Methods, TOKEN_BALANCE_SERVICE_NAME, type TokenBalanceInfo } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const TOKEN_BALANCE_METHODS = ["getTokenBalance", "getTokenBalances", "refreshTokenBalance"] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _TokenBalanceMethodsExhaustive =
	Exclude<keyof Methods, (typeof TOKEN_BALANCE_METHODS)[number]> extends never
		? true
		: Exclude<keyof Methods, (typeof TOKEN_BALANCE_METHODS)[number]>
const _tokenBalanceMethodsExhaustive: _TokenBalanceMethodsExhaustive = true
void _tokenBalanceMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface TokenBalanceServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class TokenBalanceServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onTokenBalanceAdded = new EventHandler<TokenBalanceInfo>()
	public readonly onTokenBalanceUpdated = new EventHandler<TokenBalanceInfo>()
	public readonly onTokenBalanceDeleted = new EventHandler<TokenBalanceInfo>()

	public constructor(name?: string) {
		super(TOKEN_BALANCE_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(TokenBalanceServiceClient.prototype, TOKEN_BALANCE_METHODS)
