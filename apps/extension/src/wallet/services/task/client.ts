import type { MethodsSpec, ServiceSpec } from "@/wallet/base"
import { ServiceClient, definePassthroughs } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type Events, type Methods, type Task, TASK_SERVICE_NAME } from "./spec"

export * from "./spec"

/** Every client method is a pure request-passthrough — installed on the
 *  prototype by `definePassthroughs`. The list is the only per-method content;
 *  the two drift guards below keep it locked to the `Methods` surface. */
const TASK_METHODS = ["getTask", "getTasks"] as const satisfies readonly (keyof Methods)[]
// Completeness: if any `Methods` key is missing from the list above, the
// declaration-merged type would advertise a method the runtime never installs.
// This makes the union of missing keys the required type of `true` → type error.
type _TaskMethodsExhaustive =
	Exclude<keyof Methods, (typeof TASK_METHODS)[number]> extends never ? true : Exclude<keyof Methods, (typeof TASK_METHODS)[number]>
const _taskMethodsExhaustive: _TaskMethodsExhaustive = true
void _taskMethodsExhaustive

// Declaration-merge the passthrough signatures onto the class type. Bodies are
// installed at runtime by `definePassthroughs`; this is what satisfies
// `implements ServiceSpec` and gives consumers full inference.
export interface TaskServiceClient extends MethodsSpec<Methods> {}
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: the merged interface's methods ARE installed — at runtime by definePassthroughs below — and the exhaustiveness guard above proves the name list covers every Methods key, so no advertised method is missing.
export class TaskServiceClient extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events> {
	public readonly onTaskCreated = new EventHandler<Task>()
	public readonly onTaskUpdated = new EventHandler<Task>()
	public readonly onTaskDeleted = new EventHandler<Task>()

	public constructor(name?: string) {
		super(TASK_SERVICE_NAME, new LoggerServiceClient(), name)
	}
}
definePassthroughs<Methods>(TaskServiceClient.prototype, TASK_METHODS)
