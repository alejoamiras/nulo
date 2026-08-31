/**
 * Topological ordering for service startup.
 *
 * `ServiceCollection.start()` used to Promise.all everything; each service
 * then defensively polled `ensureInitialized()` for up to 30s when it hit a
 * dep that wasn't ready yet. Cycles showed up as mysterious timeouts.
 *
 * This module computes phases from each service's declared `dependencies`.
 * Services in the same phase start in parallel; phases run sequentially.
 * A cycle surfaces as a named error, not a hang.
 *
 * Pure function with no runtime coupling — see topology.test.ts.
 */

export interface ServiceNode {
	name: string
	dependencies?: readonly string[]
}

/** Thrown when service dependencies form a cycle. Lists the offending names. */
export class DependencyCycleError extends Error {
	public readonly pending: readonly string[]

	public constructor(pending: readonly string[]) {
		super(`Service startup has a dependency cycle among: ${pending.join(", ")}`)
		this.name = "DependencyCycleError"
		this.pending = pending
	}
}

/** Thrown when a service declares a dependency on a service that isn't registered. */
export class UnknownDependencyError extends Error {
	public readonly service: string
	public readonly missing: string

	public constructor(service: string, missing: string) {
		super(`Service '${service}' declares a dependency on unknown service '${missing}'`)
		this.name = "UnknownDependencyError"
		this.service = service
		this.missing = missing
	}
}

/**
 * Group services into startup phases so every service's dependencies start
 * (and finish) before it does. Services with no declared dependencies land in
 * phase 0; everything else falls into the earliest phase that satisfies its
 * deps. Ordering within a phase is stable (matches registration order).
 *
 * @throws UnknownDependencyError — dep names a service not in the collection.
 * @throws DependencyCycleError   — any strongly-connected subgraph remains.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 29) — refactor when touched, never raise
export function topologicalPhases<T extends ServiceNode>(nodes: readonly T[]): T[][] {
	const byName = new Map<string, T>()
	for (const node of nodes) byName.set(node.name, node)

	// Validate every declared dep names a registered service.
	for (const node of nodes) {
		for (const dep of node.dependencies ?? []) {
			if (!byName.has(dep)) throw new UnknownDependencyError(node.name, dep)
		}
	}

	// Kahn's algorithm, layered: each iteration extracts everything currently
	// at in-degree 0 as one phase.
	const unresolvedCount = new Map<string, number>()
	for (const node of nodes) unresolvedCount.set(node.name, (node.dependencies ?? []).length)

	const dependents = new Map<string, Set<string>>()
	for (const node of nodes) dependents.set(node.name, new Set())
	for (const node of nodes) {
		for (const dep of node.dependencies ?? []) {
			dependents.get(dep)!.add(node.name)
		}
	}

	const phases: T[][] = []
	const resolved = new Set<string>()

	while (resolved.size < nodes.length) {
		// Collect this phase in registration order for stability.
		const phase: T[] = []
		for (const node of nodes) {
			if (!resolved.has(node.name) && unresolvedCount.get(node.name) === 0) {
				phase.push(node)
			}
		}

		if (phase.length === 0) {
			const pending = nodes.map((n) => n.name).filter((n) => !resolved.has(n))
			throw new DependencyCycleError(pending)
		}

		for (const node of phase) {
			resolved.add(node.name)
			for (const dependent of dependents.get(node.name)!) {
				unresolvedCount.set(dependent, unresolvedCount.get(dependent)! - 1)
			}
		}

		phases.push(phase)
	}

	return phases
}
