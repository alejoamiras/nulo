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
			await Promise.all(phase.map((svc) => svc.start(this)))
		}
	}
}
