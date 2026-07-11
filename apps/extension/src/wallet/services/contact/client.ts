import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Contact, CONTACT_SERVICE_NAME, type Events, type Methods } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const CONTACT_METHODS = [
	"getContacts",
	"getContact",
	"getContactByAddress",
	"addContact",
	"updateContact",
	"deleteContact",
	"exportContacts",
	"importContacts",
] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _ContactMethodsExhaustive =
	Exclude<keyof Methods, (typeof CONTACT_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof CONTACT_METHODS)[number]>
const _contactMethodsExhaustive: _ContactMethodsExhaustive = true
void _contactMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface ContactServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class ContactServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onContactAdded = new EventHandler<Contact>()
	public readonly onContactUpdated = new EventHandler<Contact>()
	public readonly onContactDeleted = new EventHandler<Contact>()

	public constructor(name?: string) {
		super(CONTACT_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(ContactServiceClient.prototype, CONTACT_METHODS)
