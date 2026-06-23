/**
 * Pins the ExecutionService PXE construction seam (the spike's Phase 1).
 *
 * The existing execution suite bypasses construction via private-field
 * injection, so nothing else covers "with no factory supplied, production
 * builds the REAL PxeServiceClient". This pins exactly that: the default
 * factory (which `ExecutionService`'s constructor uses as its `pxeClientFactory`
 * default) produces the real RPC-backed client, so the new seam can't silently
 * make production run a fake. (`chrome.*` is stubbed by tests/vitest.setup.ts,
 * so constructing the real client here is safe — we never make an RPC call.)
 */

import { describe, expect, test } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { DEFAULT_PXE_CLIENT_FACTORY } from "./service"

describe("ExecutionService PXE construction seam", () => {
	test("DEFAULT_PXE_CLIENT_FACTORY (the production default) builds the real PxeServiceClient", () => {
		const client = DEFAULT_PXE_CLIENT_FACTORY(new LoggerStore(new ConfigStore()))
		expect(client).toBeInstanceOf(PxeServiceClient)
	})
})
