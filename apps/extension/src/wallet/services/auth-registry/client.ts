// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { documentLogger } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AUTH_REGISTRY_SERVICE_NAME, type Authwit, type AuthwitRegistryScope, type Events, type Methods } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface AuthRegistryServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class AuthRegistryServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onAuthwitAdded = new EventHandler<Authwit>()
	public readonly onAuthwitDeleted = new EventHandler<Authwit>()
	public readonly onRegistryEnabled = new EventHandler<AuthwitRegistryScope>()
	public readonly onRegistryDisabled = new EventHandler<AuthwitRegistryScope>()

	public constructor(name?: string) {
		super(AUTH_REGISTRY_SERVICE_NAME, documentLogger(), name)
	}

	/** Restore forces every row's profileId to the authoritative created-profile id (a backup's
	 *  own profileId is never trusted) and keys its deletion fence on it. The base client's
	 *  `restore(...args)` enforces no arity — this typed override makes an omitted id a compile
	 *  error at the call site. */
	public override async restore(rows: unknown[], profileId: string): Promise<unknown> {
		return await super.restore(rows, profileId)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(AuthRegistryServiceClient.prototype, [
	"getAuthwits",
	"revokeAuthwits",
	"getRegistryEnabled",
	"setRegistryEnabled",
	"syncRegistry",
])
