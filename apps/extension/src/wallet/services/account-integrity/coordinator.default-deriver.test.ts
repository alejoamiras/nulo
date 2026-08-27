/**
 * Pins the coordinator's PRODUCTION default deriver to the ONE shared formula.
 *
 * The R1 audits' bricking class: the default `DeriveAddress` silently re-implementing the
 * account-seed formula and drifting from AccountService's (every unlock then false-blocks).
 * The other coordinator tests inject fake derivers and can never catch that, and jsdom cannot
 * run the real poseidon (bb.js). So this test mocks the two module boundaries and asserts the
 * DEFAULT routes through `deriveAccountSeed` — the shared function whose values the node-env
 * KATs in aztec-runtime pin — with the ROW-CARRIED `l1ChainId`, never the composite chainId.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { beforeEach, describe, expect, test, vi } from "vitest"

const deriveCalls: Array<{ l1ChainId: number; type: number; index: number }> = []

vi.mock("@nulo/wallet-crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nulo/wallet-crypto")>()
	return {
		...original,
		deriveAccountSeed: vi.fn(async (_master: Fr, l1ChainId: number, type: number, index: number) => {
			deriveCalls.push({ l1ChainId, type, index })
			return new Fr(424242n)
		}),
	}
})

vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nulo/aztec-runtime/account")>()
	return {
		...original,
		NuloAccount: {
			new: vi.fn(async (seed: Fr) => ({ address: { toString: () => `0xaddr-${seed.toBigInt()}` } })),
		},
	}
})

import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { asMasterSecretBytes } from "@nulo/wallet-crypto"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountService, AccountType, type Account } from "@/wallet/services/account/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { svc } from "../composition-harness"
import { AccountIntegrityCoordinator } from "./coordinator"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)

const row: Account = {
	profileId: "p1",
	chainId: 0, // Composite scoping id — the default deriver must NOT feed this into derivation.
	address: "0xaddr-424242",
	index: 3,
	type: AccountType.Nulo_v1,
	l1ChainId: 31337,
	name: "A",
	visible: true,
}

async function buildWithDefaultDeriver(rows: Account[]) {
	const api = new FakeBrowserApi()
	api.reset()
	const services = new ServiceCollection()
	services.add(
		svc(ProfileService.name, {
			setIntegrityDelegate: () => {},
			lockProfileIfActive: async () => {},
			persistIntegrityBlockIfLive: async () => {},
			getActiveProfile: async () => undefined,
			getProfileSecret: async () => Fr.fromBuffer(Buffer.from(MASTER)),
		}),
	)
	services.add(svc(AccountService.name, { getAccountsRaw: async () => rows }))
	// NO injected deriver — the production default is the code under test.
	const coordinator = new AccountIntegrityCoordinator(new LoggerStore(new ConfigStore()), api)
	services.add(coordinator)
	await services.start()
	await coordinator.bootVerification
	return coordinator
}

describe("AccountIntegrityCoordinator — production default deriver", () => {
	beforeEach(() => {
		deriveCalls.length = 0
	})

	test("routes through the shared deriveAccountSeed with the ROW-CARRIED l1ChainId", async () => {
		const coordinator = await buildWithDefaultDeriver([row])
		await coordinator.verifyBeforeSessionOpen("p1", MASTER)
		expect(deriveCalls).toEqual([{ l1ChainId: 31337, type: AccountType.Nulo_v1, index: 3 }])
	})

	test("a mismatching stored address still fails closed through the default path", async () => {
		const coordinator = await buildWithDefaultDeriver([{ ...row, address: "0xTAMPERED" }])
		await expect(coordinator.verifyBeforeSessionOpen("p1", MASTER)).rejects.toThrow()
		expect(deriveCalls).toHaveLength(1)
	})
})
