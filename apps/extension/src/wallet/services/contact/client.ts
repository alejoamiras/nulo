import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughsExhaustive } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Contact, CONTACT_SERVICE_NAME, type Events, type Methods } from "./spec"

export * from "./spec"

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface ContactServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughsExhaustive below, whose signature proves the name list covers every Methods key, so no advertised method is missing.
export class ContactServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onContactAdded = new EventHandler<Contact>()
	public readonly onContactUpdated = new EventHandler<Contact>()
	public readonly onContactDeleted = new EventHandler<Contact>()

	public constructor(name?: string) {
		super(CONTACT_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
// Every client method is a pure request-passthrough; the installer's
// signature checks the name list in both directions against `Methods`.
definePassthroughsExhaustive<Methods>()(ContactServiceClient.prototype, [
	"getContacts",
	"getContact",
	"getContactByAddress",
	"addContact",
	"updateContact",
	"deleteContact",
	"exportContacts",
	"importContacts",
])
