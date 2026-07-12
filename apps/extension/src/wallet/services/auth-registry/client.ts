import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AUTH_REGISTRY_SERVICE_NAME, type Authwit, type Events, type Methods } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const AUTH_REGISTRY_METHODS = [
	"getAuthwits",
	"revokeAuthwits",
	"getRegistryEnabled",
	"setRegistryEnabled",
	"syncRegistry",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _AuthRegistryMethodsExhaustive =
	Exclude<keyof Methods, (typeof AUTH_REGISTRY_METHODS)[number]> extends never
		? true
		: Exclude<keyof Methods, (typeof AUTH_REGISTRY_METHODS)[number]>
const _authRegistryMethodsExhaustive: _AuthRegistryMethodsExhaustive = true
void _authRegistryMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface AuthRegistryServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class AuthRegistryServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onAuthwitAdded = new EventHandler<Authwit>()
	public readonly onAuthwitDeleted = new EventHandler<Authwit>()
	public readonly onRegistryEnabled = new EventHandler<string>()
	public readonly onRegistryDisabled = new EventHandler<string>()

	public constructor(name?: string) {
		super(AUTH_REGISTRY_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(AuthRegistryServiceClient.prototype, AUTH_REGISTRY_METHODS)
