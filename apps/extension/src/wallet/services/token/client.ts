import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Events, type Methods, TOKEN_SERVICE_NAME, type TokenInfo, type TokenDeleted } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const TOKEN_METHODS = [
	"getTokens",
	"getToken",
	"addToken",
	"updateToken",
	"deleteToken",
	"getTokenInterface",
	"parseTokenInterface",
	"previewTokenMetadata",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _TokenMethodsExhaustive =
	Exclude<keyof Methods, (typeof TOKEN_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof TOKEN_METHODS)[number]>
const _tokenMethodsExhaustive: _TokenMethodsExhaustive = true
void _tokenMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface TokenServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class TokenServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onTokenAdded = new EventHandler<TokenInfo>()
	public readonly onTokenUpdated = new EventHandler<TokenInfo>()
	public readonly onTokenDeleted = new EventHandler<TokenDeleted>()

	public constructor(name?: string) {
		super(TOKEN_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(TokenServiceClient.prototype, TOKEN_METHODS)
