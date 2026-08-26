import type { EventHandler } from "../utils/event-handler"
import { topologicalPhases } from "./topology"

export type EventsMap = Record<string, unknown>

export type EventsSpec<T extends EventsMap> = {
	[P in keyof T]: EventHandler<T[P]>
}

// biome-ignore lint/suspicious/noExplicitAny: params must be `any[]` so concrete method signatures satisfy this constraint
export type MethodsMap = Record<string, (...params: any[]) => unknown>

export type MethodsSpec<T extends MethodsMap> = {
	[M in keyof T]: (...params: Parameters<T[M]>) => Promise<ReturnType<T[M]>>
}

export type ServiceSpec<T1 extends MethodsMap, T2 extends EventsMap = {}> = MethodsSpec<T1> & EventsSpec<T2>

export type Restored<T> = T & { restoreError?: unknown }

export interface IService {
	name: string
	/**
	 * Names of services that must finish starting before this one begins.
	 * Optional — services without declared deps land in phase 0 and still
	 * rely on the base-class `ensureInitialized()` fallback for any deps
	 * they access during `init()`. Services opt into ordering as needed.
	 */
	readonly dependencies?: readonly string[]
	start(services: ServiceCollection): Promise<void>
}

export { DependencyCycleError, UnknownDependencyError, topologicalPhases } from "./topology"
export type { ServiceNode } from "./topology"

export class ServiceCollection {
	private readonly services = new Map<string, IService>()

	public add(service: IService) {
		if (this.services.has(service.name)) {
			throw new Error(`Service '${service.name}' has already been registered`)
		}
		this.services.set(service.name, service)
	}

	public get<T extends IService>(name: string): T {
		const service = this.services.get(name)
		if (!service) {
			throw new Error(`Service '${name}' hasn't been registered`)
		}
		return service as T
	}

	/**
	 * Topologically-ordered startup. Services with no declared dependencies
	 * run in phase 0 (parallel); each subsequent phase starts only after the
	 * previous phase fully resolves. Cycles and unknown deps throw named
	 * errors up front instead of surfacing as mysterious `ensureInitialized`
	 * timeouts at runtime.
	 *
	 * Services that haven't declared deps (default `undefined`) still get
	 * phase 0, so behavior is backward-compatible with the old `Promise.all`
	 * startup. Services opt into ordering as they're migrated.
	 */
	public async start() {
		const phases = topologicalPhases([...this.services.values()])
		for (const phase of phases) {
			// allSettled, not reject-fast Promise.all: a mid-phase failure must
			// not leave still-starting siblings running unobserved (their late
			// side effects would land against a "failed" boot with nothing
			// tracking them). Every sibling settles before the phase fails, the
			// aggregate names EVERY failed service, and no later phase starts.
			// Deliberate limit: services that started successfully stay live —
			// IService has no stop hook, so this is a phase barrier and honest
			// diagnostics, not rollback.
			const results = await Promise.allSettled(phase.map((svc) => svc.start(this)))
			const failures = results
				.map((r, i) => ({ r, name: phase[i]?.name ?? `service#${i}` }))
				.filter((x): x is { r: PromiseRejectedResult; name: string } => x.r.status === "rejected")
			if (failures.length > 0) {
				// The message folds each ROOT CAUSE in, not just names: a failed
				// boot's log line prints message/stack only, and with retry vetoed
				// for the SW lifetime that line is the entire post-mortem.
				const summary = failures
					.map((f) => `${f.name}: ${f.r.reason instanceof Error ? f.r.reason.message : String(f.r.reason)}`)
					.join("; ")
				throw new AggregateError(
					failures.map((f) => f.r.reason),
					`ServiceCollection.start failed in phase — ${summary}`,
				)
			}
		}
	}
}
