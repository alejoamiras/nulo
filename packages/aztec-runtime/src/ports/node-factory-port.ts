import type { Fr } from "@aztec-labs/foundation/curves/bn254"
import type { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client"

/**
 * Construct an `AztecNode` RPC client from a URL.
 *
 * The production adapter wraps `@aztec-labs/stdlib`'s `createAztecNodeClient`
 * with a timeout-bounded fetch (`makeFetchWithTimeout`). Tests inject a
 * fake that returns a deterministic in-memory node, sidestepping real
 * RPC while still satisfying the `AztecNode` interface.
 *
 * Invariant: exactly one production call site constructs real nodes —
 * `AztecNodeFactoryAdapter`. Every other consumer receives a
 * `NodeFactory` at construction and calls `createNode(rpcUrl)`. A lint
 * guard enforces this.
 *
 * The production `AztecNode` is a `createSafeJsonRpcClient` proxy. The
 * unit-test `FakeNodeFactory` POJOs satisfy the interface structurally
 * but do NOT exercise the proxy's error surface (param validation,
 * JSON-RPC error marshalling). If a code path's correctness depends on
 * those, write a `*.integration.test.ts` that uses the production
 * adapter against a test node.
 */
export interface NodeFactory {
	createNode(rpcUrl: string): AztecNode

	/**
	 * A client whose every call is ONE non-retrying attempt, aborted at `timeoutMs`: for a caller
	 * that retries on its own schedule and must send nothing once it stops.
	 */
	createSingleAttemptNode(rpcUrl: string, timeoutMs: number): AztecNode

	/**
	 * Bounded connectivity probe: ONE non-retrying `getNodeInfo` attempt whose
	 * AbortController fires at `timeoutMs`, returning the composed chain id
	 * (`(l1ChainId ^ rollupVersion) >>> 0`). Unlike `createNode(...)` calls —
	 * whose fetch retries with backoff and can outlive any caller-side race by
	 * minutes — a probe leaves NO work running past its budget. Throws on
	 * timeout, refusal, or a non-Aztec endpoint.
	 */
	probeChainId(rpcUrl: string, timeoutMs: number): Promise<number>

	/**
	 * One public-storage read at the latest block, under `probeChainId`'s contract: one
	 * non-retrying attempt whose abort at `timeoutMs` also covers the body read, so nothing
	 * outlives the call. The client logs nothing: the SDK's warnings carry the reply body and the
	 * endpoint URL. Throws on timeout, refusal, or a reply that is not a field.
	 */
	readPublicStorageOnce(rpcUrl: string, contract: AztecAddress, slot: Fr, timeoutMs: number): Promise<Fr>
}
