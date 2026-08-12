/**
 * Bounded connectivity preflight for the import flow's chain-registration
 * leg. Pure orchestration — the probe, clock, and sleeper are injected so
 * every timing path is unit-testable without real timers or a live SW.
 *
 * Per network: up to `1 + backoffWaitsMs.length` probe attempts (exponential
 * backoff between them), each bounded BOTH by the SW-side probe budget
 * (`probeNodeStatus` aborts its socket at `timeoutMs`) and a page-side race
 * (in case the SW itself is unresponsive). The shared `deadlineAt` caps the
 * whole preflight — later attempts only get the remainder.
 */

import { NodeStatus } from "@/wallet/services/network/spec"

export type PreflightVerdict = "go" | "unreachable" | "wrong-network"

export const PREFLIGHT_ATTEMPT_TIMEOUT_MS = 5_000
export const PREFLIGHT_BACKOFF_WAITS_MS = [2_000, 4_000] as const
export const PREFLIGHT_CONCURRENCY = 3
/** Below this remainder an attempt is pointless — classify unreachable. */
const MIN_ATTEMPT_MS = 100

export interface PreflightOptions {
	networkIds: string[]
	/** `NetworkServiceClient.probeNodeStatus`-shaped probe. */
	probe: (networkId: string, timeoutMs: number) => Promise<NodeStatus>
	/** Absolute wall-clock deadline for the WHOLE preflight. */
	deadlineAt: number
	attemptTimeoutMs?: number
	backoffWaitsMs?: readonly number[]
	concurrency?: number
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function probeOneNetwork(
	networkId: string,
	opts: Required<Pick<PreflightOptions, "probe" | "deadlineAt" | "attemptTimeoutMs" | "backoffWaitsMs" | "now" | "sleep">>,
): Promise<PreflightVerdict> {
	const attempts = opts.backoffWaitsMs.length + 1
	for (let attempt = 0; attempt < attempts; attempt++) {
		const remaining = opts.deadlineAt - opts.now()
		// The deadline is ABSOLUTE: never force a minimum attempt past it.
		if (remaining < MIN_ATTEMPT_MS) return "unreachable"
		const budget = Math.min(opts.attemptTimeoutMs, remaining)

		const outcome = await Promise.race([
			opts
				.probe(networkId, budget)
				.then((status) => ({ kind: "status" as const, status }))
				.catch(() => ({ kind: "failed" as const })),
			opts.sleep(budget).then(() => ({ kind: "timeout" as const })),
		])

		if (outcome.kind === "status") {
			// Only a node that answers WITH THE RIGHT CHAIN is a go. InvalidChain
			// means the endpoint answered for a different network — registering
			// chain state against it would be wrong, not slow, so it fails
			// immediately (no retries) as its own verdict.
			if (outcome.status === NodeStatus.Active) return "go"
			if (outcome.status === NodeStatus.InvalidChain) return "wrong-network"
			// Inactive: refused/timeout/unreachable — retry with backoff below.
		}

		const wait = opts.backoffWaitsMs[attempt]
		if (wait !== undefined && opts.deadlineAt - opts.now() > wait) {
			await opts.sleep(wait)
		}
	}
	return "unreachable"
}

export async function preflightNetworkConnectivity(options: PreflightOptions): Promise<Map<string, PreflightVerdict>> {
	const opts = {
		probe: options.probe,
		deadlineAt: options.deadlineAt,
		attemptTimeoutMs: options.attemptTimeoutMs ?? PREFLIGHT_ATTEMPT_TIMEOUT_MS,
		backoffWaitsMs: options.backoffWaitsMs ?? PREFLIGHT_BACKOFF_WAITS_MS,
		now: options.now ?? Date.now,
		sleep: options.sleep ?? realSleep,
	}
	const concurrency = options.concurrency ?? PREFLIGHT_CONCURRENCY
	const verdicts = new Map<string, PreflightVerdict>()
	const queue = [...new Set(options.networkIds)]

	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
		for (;;) {
			const networkId = queue.shift()
			if (networkId === undefined) return
			verdicts.set(networkId, await probeOneNetwork(networkId, opts))
		}
	})
	await Promise.all(workers)
	return verdicts
}
