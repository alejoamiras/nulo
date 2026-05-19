/**
 * Real `NodeFactory` implementation. Wraps `createAztecNodeClient` with
 * `makeFetchWithTimeout()` so every production node has bounded HTTP I/O.
 * Tests substitute a `FakeNodeFactory`.
 *
 * Invariant: this is the ONLY `createAztecNodeClient(...)` call site in
 * the codebase. A lint guard (`no-restricted-syntax`) enforces that every
 * other reference goes through `NodeFactory.createNode()`.
 */

import { type AztecNode, createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
import type { NodeFactory } from "../ports/node-factory-port"
import { makeFetchWithTimeout } from "../utils/fetch"

export class AztecNodeFactoryAdapter implements NodeFactory {
	public createNode(rpcUrl: string): AztecNode {
		return createAztecNodeClient(rpcUrl, {}, makeFetchWithTimeout())
	}
}
