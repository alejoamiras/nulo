import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { PASSKEY_SERVICE_NAME, type Methods } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const PASSKEY_METHODS = ["getPendingRequest", "resolvePasskeyRequest", "rejectPasskeyRequest"] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _PasskeyMethodsExhaustive =
	Exclude<keyof Methods, (typeof PASSKEY_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof PASSKEY_METHODS)[number]>
const _passkeyMethodsExhaustive: _PasskeyMethodsExhaustive = true
void _passkeyMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface PasskeyServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class PasskeyServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
	public constructor(name?: string) {
		super(PASSKEY_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(PasskeyServiceClient.prototype, PASSKEY_METHODS)
