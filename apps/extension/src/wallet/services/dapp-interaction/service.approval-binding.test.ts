/**
 * Approval authority binds to the STORED request. The popup contributes a
 * per-index delta (fee choice, SW-minted ids) and nothing else: every field
 * the executor receives is re-materialized from the dApp's payload, the fee
 * path is validated against what the dApp asked for, and an id that is not an
 * execution interaction is refused before any claim. The executor stub asserts
 * strict equality with the materialized operation, so a spread merge reds.
 */

import type { ILogger } from "@/wallet/logger"
import type { WindowManager } from "@/wallet/services/window-manager/window-manager"
import { describe, expect, test, vi } from "vitest"
import { OriginType } from "@/wallet/services/transaction/service"
import { DappInteractionService } from "./service"
import type { DappInteraction } from "./spec"

const noopLogger: ILogger = { log: () => {} }
const flush = () => new Promise((r) => setTimeout(r, 0))

const OWNER = "0xowner"
const NETWORK = { id: "net-1", chainId: 1, name: "N" }
const ACCOUNT = { address: OWNER, chainId: 1, name: "Owner" }
const SESSION = { id: "s1", profileId: "p1", dappMetadata: { name: "dapp.example", url: "https://dapp.example" } }

type Internals = {
	storage: Map<string, DappInteraction>
	profileService: unknown
	networkService: unknown
	accountService: unknown
	executionService: { executeOperations: ReturnType<typeof vi.fn> }
	dappSessionService: unknown
	windowManager: { cancel: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> }
}

function makeService(activeProfile: { id: string } | undefined = { id: "p1" }) {
	const windowManager = { detach: vi.fn(), settle: vi.fn(), cancel: vi.fn(), focus: vi.fn(async () => true) } as unknown as WindowManager
	const svc = new DappInteractionService(noopLogger, windowManager)
	const internals = svc as unknown as Internals
	internals.profileService = {
		refreshSession: vi.fn(async () => {}),
		getActiveProfile: async () => activeProfile,
		captureExecutionFence: async () => {
			if (!activeProfile) throw new Error("Wallet locked")
			return { profileId: activeProfile.id, epoch: 0 }
		},
	}
	internals.networkService = { getNetworks: vi.fn(async () => [NETWORK]) }
	internals.accountService = { getAccount: vi.fn(async () => ACCOUNT) }
	internals.executionService = { executeOperations: vi.fn(async () => []) }
	internals.dappSessionService = { tryGetDappSession: async () => ({ profileId: "p1" }) }
	return { svc, internals, windowManager: internals.windowManager }
}

const store = (internals: Internals, id: string, payload: unknown) =>
	internals.storage.set(id, { id, payload: payload as DappInteraction["payload"], handleId: `h-${id}`, cancellationToken: id })

const sendTxRequest = (exec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	kind: "aztec_sendTx",
	account: `aztec:1:${OWNER}`,
	exec,
	opts: { from: OWNER },
	...extra,
})
const execPayload = (operations: unknown[]) => ({ params: { operations }, session: SESSION })

const executedOps = (internals: Internals) => (internals.executionService.executeOperations.mock.calls[0] as unknown[])[0] as unknown[]
const executedArgs = (internals: Internals) => internals.executionService.executeOperations.mock.calls[0] as unknown[]

describe("approveInteraction — the popup cannot substitute what executes", () => {
	test("a delta carrying only feeSettings executes the SW-materialized operation, exactly", async () => {
		const { svc, internals } = makeService()
		store(internals, "i-1", execPayload([sendTxRequest({ calls: [{ name: "swap" }] })]))
		await svc.approveInteraction("i-1", [{ feeSettings: { paymentMethod: { kind: "fj" } } }])
		await flush()
		expect(executedOps(internals)).toEqual([
			{
				kind: "aztec_sendTx",
				account: `aztec:1:${OWNER}`,
				networkId: "net-1",
				accountAddress: OWNER,
				exec: { calls: [{ name: "swap" }] },
				opts: { from: OWNER },
				feeSettings: { paymentMethod: { kind: "fj" } },
			},
		])
	})

	test("forged fields on the delta never reach the operation", async () => {
		const { svc, internals } = makeService()
		store(internals, "i-1", execPayload([sendTxRequest({ calls: [{ name: "swap" }] })]))
		const forged = {
			feeSettings: { paymentMethod: { kind: "fj" } },
			accountAddress: "0xevil",
			exec: { calls: [{ name: "drain" }] },
			opts: { from: "0xevil" },
			executionMode: "default_entrypoint",
			previewedInterface: { contract: "0x" },
		}
		await svc.approveInteraction("i-1", [forged as never])
		await flush()
		const op = executedOps(internals)[0] as Record<string, unknown>
		expect(op.accountAddress).toBe(OWNER)
		expect(op.exec).toEqual({ calls: [{ name: "swap" }] })
		expect(op.opts).toEqual({ from: OWNER })
		expect("executionMode" in op).toBe(false)
		expect("previewedInterface" in op).toBe(false)
	})

	test("feeSettings on a non-send kind is ignored; embedded + a conflicting delta stays embedded", async () => {
		const { svc, internals } = makeService()
		store(
			internals,
			"i-1",
			execPayload([
				{ kind: "register_token", account: `aztec:1:${OWNER}`, address: "0xtok" },
				sendTxRequest({ calls: [], feePayer: "0xfpc" }),
			]),
		)
		await svc.approveInteraction("i-1", [
			{ feeSettings: { paymentMethod: { kind: "fj" } } },
			{ feeSettings: { paymentMethod: { kind: "fpc", fpcId: "x" } } },
		])
		await flush()
		const [token, send] = executedOps(internals) as Record<string, unknown>[]
		expect("feeSettings" in token!).toBe(false)
		expect(send!.feeSettings).toEqual({ paymentMethod: { kind: "embedded" } })
	})

	test("a requested self-pay rejects an fpc delta and executes with fj", async () => {
		const rejected = makeService()
		store(rejected.internals, "i-1", execPayload([sendTxRequest({ calls: [{ name: "transfer" }], feePayer: OWNER })]))
		await rejected.svc.approveInteraction("i-1", [{ feeSettings: { paymentMethod: { kind: "fpc", fpcId: "x" } } }])
		await flush()
		expect(rejected.internals.executionService.executeOperations).not.toHaveBeenCalled()
		expect(rejected.windowManager.cancel).toHaveBeenCalledWith("h-i-1", expect.stringContaining("Fee Juice"))

		const accepted = makeService()
		store(accepted.internals, "i-1", execPayload([sendTxRequest({ calls: [{ name: "transfer" }], feePayer: OWNER })]))
		await accepted.svc.approveInteraction("i-1", [{ feeSettings: { paymentMethod: { kind: "fj" } } }])
		await flush()
		expect(accepted.internals.executionService.executeOperations).toHaveBeenCalledTimes(1)
	})

	test("the origin is the session's dApp name and the envelopes carry the SW ids per index", async () => {
		const { svc, internals } = makeService()
		store(
			internals,
			"i-9",
			execPayload([sendTxRequest({ calls: [] }), { kind: "register_token", account: `aztec:1:${OWNER}`, address: "0xt" }]),
		)
		await svc.approveInteraction("i-9", [{ feeSettings: { paymentMethod: { kind: "fj" } }, estimateId: "est", previewId: "prev" }, {}])
		await flush()
		const args = executedArgs(internals)
		expect(args[1]).toEqual({ type: OriginType.DAPP, name: "dapp.example" })
		expect(args[4]).toEqual([
			{ interactionId: "i-9", index: 0, estimateId: "est", previewId: "prev" },
			{ interactionId: "i-9", index: 1, estimateId: undefined, previewId: undefined },
		])
	})

	test("a capability- or discovery-shaped id is refused BEFORE the claim; the record survives for resolveInteraction", async () => {
		const { svc, internals } = makeService()
		store(internals, "cap", { params: { capabilities: {} }, session: SESSION })
		store(internals, "disc", { params: { dappMetadata: SESSION.dappMetadata } })
		await expect(svc.approveInteraction("cap", [])).rejects.toThrow("Invalid id")
		await expect(svc.approveInteraction("disc", [])).rejects.toThrow("Invalid id")
		expect(internals.storage.has("cap")).toBe(true)
		expect(internals.storage.has("disc")).toBe(true)
		await expect(svc.resolveInteraction("cap", { approved: true })).resolves.toBeUndefined()
		expect(internals.executionService.executeOperations).not.toHaveBeenCalled()
	})

	test("a delta-length mismatch is refused before the claim", async () => {
		const { svc, internals } = makeService()
		store(internals, "i-1", execPayload([sendTxRequest({ calls: [] })]))
		await expect(svc.approveInteraction("i-1", [])).rejects.toThrow("Invalid id")
		expect(internals.storage.has("i-1")).toBe(true)
	})
})

describe("materializeStoredOperation — estimate and preview read the stored request", () => {
	test("returns the materialized operation completed with the validated fee choice", async () => {
		const { svc, internals } = makeService()
		store(internals, "i-1", execPayload([sendTxRequest({ calls: [{ name: "swap" }] })]))
		const op = await svc.materializeStoredOperation("i-1", 0, { paymentMethod: { kind: "fj" } })
		expect(op).toMatchObject({
			kind: "aztec_sendTx",
			accountAddress: OWNER,
			networkId: "net-1",
			feeSettings: { paymentMethod: { kind: "fj" } },
		})
		await expect(svc.materializeStoredOperation("i-1", 0, { paymentMethod: { kind: "embedded" } })).rejects.toThrow("not selectable")
	})

	test("an unknown id, a non-execution id or an out-of-range index is 'Invalid id'; another profile is 'Wallet locked'", async () => {
		const { svc, internals } = makeService({ id: "p2" })
		store(internals, "i-1", execPayload([sendTxRequest({ calls: [] })]))
		store(internals, "cap", { params: { capabilities: {} }, session: SESSION })
		await expect(svc.materializeStoredOperation("nope", 0)).rejects.toThrow("Invalid id")
		await expect(svc.materializeStoredOperation("cap", 0)).rejects.toThrow("Invalid id")
		await expect(svc.materializeStoredOperation("i-1", 3)).rejects.toThrow("Invalid id")
		await expect(svc.materializeStoredOperation("i-1", 0, { paymentMethod: { kind: "fj" } })).rejects.toThrow("Wallet locked")
	})
})
