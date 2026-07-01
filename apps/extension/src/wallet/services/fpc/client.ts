import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Events, FPC_SERVICE_NAME, type FpcInfo, type Methods } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const FPC_METHODS = [
	"getFpcs",
	"getFpc",
	"addFpc",
	"updateFpc",
	"updateFpcAddress",
	"deleteFpc",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _FpcMethodsExhaustive =
	Exclude<keyof Methods, (typeof FPC_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof FPC_METHODS)[number]>
const _fpcMethodsExhaustive: _FpcMethodsExhaustive = true
void _fpcMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface FpcServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class FpcServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onFpcAdded = new EventHandler<FpcInfo>()
	public readonly onFpcUpdated = new EventHandler<FpcInfo>()
	public readonly onFpcDeleted = new EventHandler<FpcInfo>()

	public constructor(name?: string) {
		super(FPC_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(FpcServiceClient.prototype, FPC_METHODS)
