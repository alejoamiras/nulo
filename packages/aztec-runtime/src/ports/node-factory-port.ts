import type { AztecNode } from "@aztec/stdlib/interfaces/client"

/**
 * Construct an `AztecNode` RPC client from a URL.
 *
 * The production adapter wraps `@aztec/stdlib`'s `createAztecNodeClient`
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
}
