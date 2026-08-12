/**
 * Real `NodeFactory` implementation. Wraps `createAztecNodeClient` with
 * `makeFetchWithTimeout()` so every production node has bounded HTTP I/O.
 * Tests substitute a `FakeNodeFactory`.
 *
 * Invariant: this is the ONLY `createAztecNodeClient(...)` call site in
 * the codebase. A lint guard (`no-restricted-syntax`) enforces that every
 * other reference goes through `NodeFactory.createNode()`.
 *
 * F-011 / Phase 5: scheme allowlist enforced at THIS boundary too (in
 * addition to the network/spec.ts schema). Defense in depth — if a future
 * code path persists a URL bypassing the schema (e.g., direct storage
 * write, internal bypass), the adapter still refuses to construct a node
 * client from a non-allowlisted URL.
 *
 * The schema is the primary gate; this is the safety net that catches
 * any drift. Allowlist policy matches the schema:
 * - `https:` for any host.
 * - `http:` only for `localhost`, `127.0.0.1`, `[::1]` (WHATWG-URL form).
 * - Everything else rejected.
 */

import { type AztecNode, createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
import type { NodeFactory } from "../ports/node-factory-port"
import { makeFetchWithTimeout, makeSingleAttemptFetch } from "../utils/fetch"

/**
 * F-011: stand-alone allowlist check used by the adapter (and exportable for
 * other call sites that need to verify before persisting). Returns
 * `{ ok: true }` or `{ ok: false, reason: string }`.
 */
export function isAllowedRpcUrl(rpcUrl: string): { ok: true } | { ok: false; reason: string } {
	let parsed: URL
	try {
		parsed = new URL(rpcUrl)
	} catch {
		return { ok: false, reason: `not a valid URL: ${rpcUrl}` }
	}
	const scheme = parsed.protocol.slice(0, -1)
	if (scheme === "https") return { ok: true }
	if (scheme === "http") {
		const host = parsed.hostname.toLowerCase()
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return { ok: true }
		return { ok: false, reason: `http: only permitted for loopback hosts (got host="${host}")` }
	}
	return { ok: false, reason: `scheme "${scheme}:" not in allowlist (only https: and http://loopback are permitted)` }
}

export class AztecNodeFactoryAdapter implements NodeFactory {
	public createNode(rpcUrl: string): AztecNode {
		const check = isAllowedRpcUrl(rpcUrl)
		if (!check.ok) {
			throw new Error(`AztecNodeFactoryAdapter refused to construct node client — ${check.reason}`)
		}
		return createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())
	}

	public async probeChainId(rpcUrl: string, timeoutMs: number): Promise<number> {
		const check = isAllowedRpcUrl(rpcUrl)
		if (!check.ok) {
			throw new Error(`AztecNodeFactoryAdapter refused to probe — ${check.reason}`)
		}
		// Single attempt, no retry chain: the probe's whole point is that its
		// socket dies WITH its budget (see NodeFactory.probeChainId).
		const node = createAztecNodeClient(rpcUrl, {}, makeSingleAttemptFetch(timeoutMs))
		const info = await node.getNodeInfo()
		return (info.l1ChainId ^ info.rollupVersion) >>> 0
	}
}
