/**
 * Real `NodeFactory` implementation. Wraps `createAztecNodeClient` with
 * `makeFetchWithTimeout()` so every production node has bounded HTTP I/O.
 * Tests substitute a `FakeNodeFactory`.
 *
 * Invariant: this is the ONLY `createAztecNodeClient(...)` call site in
 * the codebase (and the one `createSafeJsonRpcClient` over the node schema,
 * for the silent single read). A lint guard (`no-restricted-syntax`)
 * enforces that every other reference goes through `NodeFactory.createNode()`.
 *
 * Every node is built through the transport rule (`rpcTransportVerdict`). It is the only gate
 * for a URL that never crossed the extension's schema, such as a persisted endpoint. Unlike the
 * schema it accepts userinfo, and it judges the raw string, not a trimmed copy.
 */

import type { Fr } from "@aztec-labs/foundation/curves/bn254"
import { createSafeJsonRpcClient } from "@aztec-labs/foundation/json-rpc/client"
import type { Logger } from "@aztec-labs/foundation/log"
import type { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { type AztecNode, AztecNodeApiSchema, createAztecNodeClient } from "@aztec-labs/stdlib/interfaces/client"
import { rpcTransportVerdict, walletChainId } from "@nulo/wallet-core/utils"
import type { NodeFactory } from "../ports/node-factory-port"
import { makeFetchWithTimeout, makeSingleAttemptFetch } from "../utils/fetch"

const noop = () => {}

/** The JSON-RPC client's logger for the single read: every level a no-op. Without it the SDK
 *  warns through pino, which reaches `console.*` and so the user's exportable log, with the reply
 *  body and the endpoint URL (providers put API keys in the path). */
export const SILENT_RPC_LOG: Logger = {
	silent: noop,
	fatal: noop,
	error: noop,
	warn: noop,
	info: noop,
	verbose: noop,
	debug: noop,
	trace: noop,
	level: "silent",
	isLevelEnabled: () => false,
	module: "json-rpc:client",
	createChild: () => SILENT_RPC_LOG,
	getBindings: () => ({}),
}

/** The transport rule on the raw string; each refusal `reason` embeds the URL, host or scheme it
 *  refused. */
export function isAllowedRpcUrl(rpcUrl: string): { ok: true } | { ok: false; reason: string } {
	let parsed: URL
	try {
		parsed = new URL(rpcUrl)
	} catch {
		return { ok: false, reason: `not a valid URL: ${rpcUrl}` }
	}
	const verdict = rpcTransportVerdict(parsed)
	if (verdict.allowed) return { ok: true }
	if (verdict.refusal === "non-loopback-http") {
		return { ok: false, reason: `http: only permitted for loopback hosts (got host="${verdict.host}")` }
	}
	return { ok: false, reason: `scheme "${verdict.scheme}:" not in allowlist (only https: and http://loopback are permitted)` }
}

export class AztecNodeFactoryAdapter implements NodeFactory {
	public createNode(rpcUrl: string): AztecNode {
		const check = isAllowedRpcUrl(rpcUrl)
		if (!check.ok) {
			throw new Error(`AztecNodeFactoryAdapter refused to construct node client — ${check.reason}`)
		}
		return createAztecNodeClient(rpcUrl, { fetch: makeFetchWithTimeout() })
	}

	public createSingleAttemptNode(rpcUrl: string, timeoutMs: number): AztecNode {
		const check = isAllowedRpcUrl(rpcUrl)
		if (!check.ok) {
			throw new Error(`AztecNodeFactoryAdapter refused to construct node client — ${check.reason}`)
		}
		return createAztecNodeClient(rpcUrl, { fetch: makeSingleAttemptFetch(timeoutMs) })
	}

	public async probeChainId(rpcUrl: string, timeoutMs: number): Promise<number> {
		const check = isAllowedRpcUrl(rpcUrl)
		if (!check.ok) {
			throw new Error(`AztecNodeFactoryAdapter refused to probe — ${check.reason}`)
		}
		// Single attempt, no retry chain: the probe's whole point is that its
		// socket dies WITH its budget (see NodeFactory.probeChainId).
		const node = createAztecNodeClient(rpcUrl, { fetch: makeSingleAttemptFetch(timeoutMs) })
		const info = await node.getNodeInfo()
		return walletChainId(info.l1ChainId, info.rollupVersion)
	}

	public async readPublicStorageOnce(rpcUrl: string, contract: AztecAddress, slot: Fr, timeoutMs: number): Promise<Fr> {
		const check = isAllowedRpcUrl(rpcUrl)
		if (!check.ok) {
			throw new Error(`AztecNodeFactoryAdapter refused to read — ${check.reason}`)
		}
		// `createAztecNodeClient` with no versions to check, plus the `log` option it cannot pass.
		const node = createSafeJsonRpcClient<AztecNode>(rpcUrl, AztecNodeApiSchema, {
			namespaceMethods: "aztec",
			fetch: makeSingleAttemptFetch(timeoutMs),
			log: SILENT_RPC_LOG,
		})
		const value = await node.getPublicStorageAt("latest", contract, slot)
		// The SDK resolves a `null` result as `undefined` rather than rejecting it.
		if (value === undefined) throw new Error("AztecNodeFactoryAdapter read no value")
		return value
	}
}
