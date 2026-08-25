/**
 * Provenance pins for the first-tx wrap decision (N-15): `outMeta.
 * initializesAccount` must be true iff THIS build wrapped the account ctor.
 * The flag gates the send-path existing-nullifier classification — the pins
 * red if the assignments are dropped (the classification then never fires,
 * or fires without provenance).
 *
 * Real account (node env runs the actual derivation); the node/pxe/entrypoint
 * surfaces are stubbed at the instance seam — the subject is the DECISION and
 * its out-param, not the request assembly.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { GasFees } from "@aztec/stdlib/gas"
import { beforeAll, describe, expect, test, vi } from "vitest"
import { NuloAccount } from "./nulo-account"

const logger = { log: () => {} } as never

function stubNode(witnessPresent: boolean) {
	return {
		getNullifierMembershipWitness: vi.fn(async () => (witnessPresent ? ({ marker: "witness" } as never) : undefined)),
		getCurrentMinFees: vi.fn(async () => new GasFees(1n, 1n)),
	} as never
}

describe("NuloAccount.buildTxExecutionRequest — initializesAccount provenance (N-15)", () => {
	let account: NuloAccount

	beforeAll(async () => {
		account = await NuloAccount.new(new Fr(42n), logger)
		// The pins target the wrap DECISION: registration + both build tails are
		// stubbed on the instance so no PXE/entrypoint machinery runs.
		const anyAccount = account as unknown as Record<string, unknown>
		anyAccount.ensureRegistered = vi.fn(async () => {})
		anyAccount.ensureContractRegistered = vi.fn(async () => {})
		anyAccount.buildWithInitialization = vi.fn(async () => ({ marker: "wrapped" }))
		anyAccount.entrypoint = { createTxExecutionRequest: vi.fn(async () => ({ marker: "plain" })) }
	}, 60_000)

	const payload = { calls: [] } as never
	const options = {} as never
	const chainInfo = { l1ChainId: 1, rollupVersion: 1 } as never

	test("no witness (uninitialized) → wraps the ctor AND sets initializesAccount = true", async () => {
		const outMeta: { initializesAccount?: boolean } = {}
		const req = await account.buildTxExecutionRequest(stubNode(false), {} as never, payload, options, chainInfo, undefined, outMeta)
		expect((req as unknown as { marker: string }).marker).toBe("wrapped")
		expect(outMeta.initializesAccount).toBe(true)
	})

	test("witness present (initialized) → plain entrypoint AND initializesAccount = false", async () => {
		const outMeta: { initializesAccount?: boolean } = {}
		const req = await account.buildTxExecutionRequest(stubNode(true), {} as never, payload, options, chainInfo, undefined, outMeta)
		expect((req as unknown as { marker: string }).marker).toBe("plain")
		expect(outMeta.initializesAccount).toBe(false)
	})

	test("no outMeta supplied → both paths still build (the out-param is optional)", async () => {
		await expect(account.buildTxExecutionRequest(stubNode(false), {} as never, payload, options, chainInfo)).resolves.toBeDefined()
		await expect(account.buildTxExecutionRequest(stubNode(true), {} as never, payload, options, chainInfo)).resolves.toBeDefined()
	})
})
