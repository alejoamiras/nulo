// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ACCOUNT_STATE_SERVICE_NAME, type Events, type Methods } from "./spec"
import { documentLogger } from "../logger/client"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface AccountStateServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class AccountStateServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onSenderAdded = new EventHandler<string>()
	public readonly onSenderDeleted = new EventHandler<string>()

	public constructor(name?: string) {
		super(ACCOUNT_STATE_SERVICE_NAME, documentLogger(), name)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(AccountStateServiceClient.prototype, [
	"getAccounts",
	"getSenders",
	"getSendersAcrossActiveNetworks",
	"addSender",
	"deleteSender",
	"getContracts",
])
