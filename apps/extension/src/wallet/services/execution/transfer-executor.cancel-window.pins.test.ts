/**
 * Cancel-publication-window pin: the controller must be registered in the SAME
 * microtask continuation that observes the journal create resolving. A helper
 * that returns only the id adds a promise-settlement hop between the durable
 * `pending` row and `activeControllers.set` — a cancelJob landing there
 * transitions the row terminal, finds no controller to abort, and the
 * later-installed controller lets proving continue (the rejected `simulating`
 * transition is swallowed by markJournal). Both pins fail against that shape.
 */
import { describe, expect, test, vi } from "vitest"
import { TransferType } from "@/wallet/services/transaction/service"
import type { TransferRequest } from "./operation-planner"
import { TransferExecutor, type TransferExecutorDeps } from "./transfer-executor"

const FEE_SETTINGS = { paymentMethod: { kind: "fj" } } as never

function makeReq(): TransferRequest {
	return {
		networkId: "net-1",
		accountAddress: "0xme",
		tokenId: 1,
		transferType: TransferType.Private,
		recipientAddress: "0xyou",
		amount: 5n,
		feeSettings: FEE_SETTINGS,
	}
}

function makeDeps(overrides: Partial<TransferExecutorDeps>): TransferExecutorDeps {
	const task = { complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
	return {
		tasks: { startNewTask: vi.fn(() => task) } as never,
		planner: {
			buildTransferOperation: vi.fn(async (req: TransferRequest) => ({
				op: { networkId: req.networkId, accountAddress: req.accountAddress, actions: [], feeSettings: req.feeSettings },
				token: { contract: "0xtoken", name: "T", symbol: "T", decimals: 18 },
				fn: { name: "transfer_private" },
				args: [],
			})),
		} as never,
		estimateReuse: { tryConsume: vi.fn(async () => undefined), stash: vi.fn() } as never,
		coordinator: { proveAndSend: vi.fn(async () => ({ txHash: { toString: () => "0xhash" } })) } as never,
		lane: { registerController: vi.fn(), deleteController: vi.fn() },
		getActiveProfile: vi.fn(async () => ({ id: "p1" }) as never),
		getNetwork: vi.fn(async () => ({}) as never),
		getNode: vi.fn(async () => ({}) as never),
		getPXE: vi.fn(() => ({}) as never),
		getAccountContract: vi.fn(async () => ({}) as never),
		getPendingForAccount: vi.fn(() => []),
		addTransaction: vi.fn(async () => ({}) as never),
		buildAndEstimate: vi.fn(
			async () =>
				({
					txRequest: { txContext: { gasSettings: {} } },
					initializesAccount: false,
					node: {},
					pxe: {},
					account: { address: "0xacct" },
					network: { chainId: 7, endpoints: [{ id: "e1", rpcUrl: "http://p" }], primaryEndpointId: "e1" },
					nonce: { toString: () => "1" },
					feePaymentMethod: { kind: "fee_juice" },
				}) as never,
		),
		createJournalOperation: vi.fn(async (input) => ({ id: "j1", ...input }) as never),
		transitionJournal: vi.fn(async () => ({})),
		logDebug: vi.fn(),
		logError: vi.fn(),
		...overrides,
	}
}

describe("transfer cancel publication window", () => {
	test("controller registration lands in the create-resolution continuation — no settlement hop", async () => {
		let resolveCreate: ((r: unknown) => void) | undefined
		const deps = makeDeps({
			createJournalOperation: vi.fn(
				() =>
					new Promise((res) => {
						resolveCreate = res
					}),
			) as never,
		})
		const executor = new TransferExecutor(deps)
		const pending = executor.execute(makeReq())

		// Drain microtasks until execution parks on the create await.
		while (!resolveCreate) await Promise.resolve()
		expect(deps.lane.registerController).not.toHaveBeenCalled()

		resolveCreate({ id: "j1" })
		// EXACTLY one microtask: the helper's own await-resumption. The fixed
		// shape registers the controller inside that continuation; a shape that
		// returns the bare id defers registration to the caller's resumption,
		// one settlement hop later — and this assertion catches it.
		await Promise.resolve()
		expect(deps.lane.registerController).toHaveBeenCalledWith("j1", expect.any(AbortController))

		await pending
	})

	test("a cancel that aborts the registered controller before `simulating` prevents proveAndSend", async () => {
		// Worst-case arbitration: cancelJob wins the journal mutex right at the
		// simulating transition — it has already moved the row terminal AND
		// aborted the controller it found registered (registration is visible
		// because the helper owns the create→register span). The stage-boundary
		// checkCancelled must then short-circuit before the pipeline.
		const registered = new Map<string, AbortController>()
		const deps = makeDeps({
			lane: {
				registerController: vi.fn((id: string, c: AbortController) => registered.set(id, c)),
				deleteController: vi.fn((id: string) => registered.delete(id)),
			},
			transitionJournal: vi.fn(async (_id: string, progress: { stage: string }) => {
				if (progress.stage === "simulating") {
					registered.get("j1")?.abort()
					throw new Error("row is terminal (cancelled)")
				}
				return {}
			}) as never,
		})
		const executor = new TransferExecutor(deps)

		await expect(executor.execute(makeReq())).rejects.toThrowError()
		// biome-ignore lint/suspicious/noExplicitAny: reading stub call state
		expect((deps.coordinator as any).proveAndSend).not.toHaveBeenCalled()
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})
})
