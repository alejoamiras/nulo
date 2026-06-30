/**
 * Pins the shared PXE seam that TokenService injects (FpcService constructs its
 * client directly — bb-bound, e2e-only — so it does NOT inject this seam).
 *
 * Two directions of conformance:
 *  - client → port: the production DEFAULT factory builds the REAL
 *    PxeServiceClient (so the seam can't silently ship a fake). The typed
 *    assignment here also proves `PxeServiceClient` is a `ShallowPxeClient`.
 *  - fake → port: the shared fake structurally satisfies `ShallowPxe`. This
 *    file is under `src/`, so that conformance is `typecheck`-enforced — the
 *    compile-time drift guard (a shape change on `IPXE` breaks this).
 *
 * (`chrome.*` is stubbed by tests/vitest.setup.ts, so building the real client
 * here is safe — we never make an RPC call.)
 */
import { describe, expect, test } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { DEFAULT_SHALLOW_PXE_CLIENT_FACTORY, type ShallowPxe, type ShallowPxeClient } from "./shallow-port"
import { makeShallowPxeFake } from "./shallow-port.fake"

describe("ShallowPxe port", () => {
	test("DEFAULT_SHALLOW_PXE_CLIENT_FACTORY (the TokenService production default) builds the real PxeServiceClient", () => {
		const client: ShallowPxeClient = DEFAULT_SHALLOW_PXE_CLIENT_FACTORY(new LoggerStore(new ConfigStore()))
		expect(client).toBeInstanceOf(PxeServiceClient)
	})

	test("the shared fake structurally satisfies the port (compile-time drift guard)", () => {
		const { client } = makeShallowPxeFake()
		const pxe: ShallowPxe = client.getPXE({} as never)
		for (const m of ["getContractInstance", "getContractArtifact", "getContracts", "registerContract"] as const) {
			expect(typeof pxe[m]).toBe("function")
		}
	})
})
