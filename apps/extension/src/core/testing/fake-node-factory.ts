/**
 * Test double for `NodeFactory`. Returns a deterministic in-memory
 * `AztecNode` handle keyed by the rpcUrl passed to `createNode`.
 *
 * Callers can register per-URL overrides to make `getNodeInfo()` /
 * `getBlockNumber()` / etc. return specific values, or supply a
 * shared template that every URL receives.
 *
 * WARNING: A POJO `AztecNode` satisfies the interface structurally but
 * bypasses the `createSafeJsonRpcClient` proxy's param validation and
 * error marshalling. Unit tests driving `NetworkService` / code that
 * relies on JSON-RPC error surfaces (e.g. `NetworkService.getChainId`'s
 * catch block) will go green against this fake even if the real code
 * path would throw against a live node. Use integration tests against
 * the production adapter for those paths.
 */

import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { NodeFactory } from "@nulo/aztec-runtime/ports"
import { walletChainId } from "@/utils/chain-ids"

export type FakeNodeOverrides = Partial<AztecNode>

export class FakeNodeFactory implements NodeFactory {
	/** Nodes created so far, in call order. Useful for assertions. */
	public readonly created: Array<{ rpcUrl: string; node: AztecNode }> = []

	private readonly perUrl = new Map<string, FakeNodeOverrides>()
	private template: FakeNodeOverrides = {}

	/** Set a fallback override applied to every unregistered rpcUrl. */
	public setTemplate(template: FakeNodeOverrides): void {
		this.template = template
	}

	/** Register per-rpcUrl overrides. Shadows `template`. */
	public setOverrides(rpcUrl: string, overrides: FakeNodeOverrides): void {
		this.perUrl.set(rpcUrl, overrides)
	}

	/** Mirrors the production probe against the same per-URL stubs: resolves the
	 *  fake node's `getNodeInfo` and composes the chain id. `timeoutMs` is
	 *  accepted but not enforced — fakes settle synchronously. */
	public async probeChainId(rpcUrl: string, _timeoutMs: number): Promise<number> {
		const node = this.createNode(rpcUrl)
		const info = await node.getNodeInfo()
		return walletChainId(info.l1ChainId, info.rollupVersion)
	}

	public createNode(rpcUrl: string): AztecNode {
		const overrides = this.perUrl.get(rpcUrl) ?? this.template
		const node = new Proxy({ ...overrides } as AztecNode, {
			get(target, prop) {
				// Promise.resolve() probes `then` to decide if the value is
				// thenable. Returning a function here (the loud-throw default
				// below) would make the node accidentally thenable and cause
				// `await someNode` to throw "method 'then' not stubbed".
				// `catch` / `finally` get the same treatment for symmetry.
				if (prop === "then" || prop === "catch" || prop === "finally") return undefined
				if (prop in target) return Reflect.get(target, prop)
				// Any unstubbed method throws loudly so tests fail fast rather
				// than silently returning `undefined`.
				return () => {
					throw new Error(`FakeNode: method "${String(prop)}" not stubbed for ${rpcUrl}`)
				}
			},
		})
		this.created.push({ rpcUrl, node })
		return node
	}
}
