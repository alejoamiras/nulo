/**
 * Per-path lifecycle pins for the four fee strategies: the "Estimating fee"
 * task each path starts and finishes, the exact simulation options of every
 * call, the probe-fold choreography with its cancel checkpoints, and the fees
 * each path commits for an explicit priority multiplier.
 *
 * Every build returns a fresh object (its own `pxe` and account address), so a
 * simulation scoped to a stale build fails an identity assertion. Task state is
 * read from a real `TaskService`, whose finish refusals are part of the contract.
 */

import { describe, expect, test, vi } from "vitest"
import { Gas, GasFees, GasSettings } from "@aztec-labs/stdlib/gas"
import { AccountFeePaymentMethodOptions } from "@aztec-labs/entrypoints/account"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { DummyLogger } from "@/wallet/logger"
import { FpcType } from "@/wallet/services/fpc/service"
import { StepContent, type Task, TaskService, TaskStatus } from "@/wallet/services/task/service"
import type { Action } from "../spec"
import { EmbeddedStrategy } from "./embedded-strategy"
import { FeeJuiceStrategy } from "./fee-juice-strategy"
import { FeeJuiceWithClaimStrategy } from "./fee-juice-with-claim-strategy"
import type { FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { FpcStrategy } from "./fpc-strategy"

const PREEXISTING = AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE
const EXTERNAL = AccountFeePaymentMethodOptions.EXTERNAL
const ORIGINAL = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
const DISCOVERED = { kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0xd" } } as unknown as Action
const PAYLOAD = { kind: "call", contract: "0xfpc", method: "pay", args: [] } as unknown as Action

type BuildOpts = { initWrapped?: boolean; chainId?: number; txsLimits?: Gas }
type Built = ReturnType<typeof makeBuilt>

let buildSeq = 0
function makeBuilt(opts: BuildOpts) {
	const n = ++buildSeq
	return {
		txRequest: {
			origin: { toString: () => (opts.initWrapped ? "0xentrypoint" : "0xaccount") },
			txContext: {
				gasSettings: new GasSettings(new Gas(11_000, 22_000), new Gas(3_300, 4_400), new GasFees(555n, 666n), new GasFees(7n, 8n)),
			},
		},
		node: { getCurrentMinFees: vi.fn(async () => new GasFees(555n, 666n)) },
		pxe: { build: n },
		account: { address: { toString: () => "0xaccount", build: n } },
		network: { chainId: opts.chainId },
		nonce: { toString: () => `nonce-${n}` },
		txCalls: [],
		txsLimits: opts.txsLimits,
	}
}

function sentinelSim() {
	return { gasUsed: { totalGas: new Gas(31_000, 32_000), teardownGas: new Gas(3_500, 3_600) } }
}

type PathName = "fj" | "fjwc" | "embedded" | "fpc two-pass" | "fpc fast path"
const PATHS: PathName[] = ["fj", "fjwc", "embedded", "fpc two-pass", "fpc fast path"]

function makeFpc(path: PathName, chainId?: number) {
	const type = path === "fpc fast path" ? FpcType.DefaultSponsoredFpc : FpcType.PrivateFpc
	return {
		infoData: { type, isProtocol: true, chainId },
		getTotalGas: () => new Gas(1_000, 2_000),
		getTeardownGas: () => new Gas(100, 200),
		getFeePayload: vi.fn((_account: string, _maxFee: unknown) => [PAYLOAD]),
	}
}

type HarnessOpts = { build?: BuildOpts; fpcChainId?: number; effects?: Action[]; probe?: boolean; abortOnFirstSim?: boolean }

function harness(path: PathName, opts: HarnessOpts = {}) {
	const builds: Built[] = []
	const buildStandard = vi.fn(async (..._args: unknown[]) => {
		const built = makeBuilt(opts.build ?? {})
		builds.push(built)
		return built
	})
	const controller = new AbortController()
	const simulateTxTask = vi.fn(async (..._args: unknown[]) => {
		if (opts.abortOnFirstSim && simulateTxTask.mock.calls.length === 1) controller.abort()
		return sentinelSim()
	})
	const tasks = new TaskService(new DummyLogger())
	const created: Task[] = []
	const log: string[] = []
	tasks.onTaskCreated.add((task) => {
		created.push(task)
		log.push(`created:${task.content.label}`)
	})
	tasks.onTaskUpdated.add((task) => log.push(`${TaskStatus[task.status]}:${task.content.label}`))
	const fpc = makeFpc(path, opts.fpcChainId)
	const deps = {
		txBuilder: { buildStandard },
		simulateTxTask,
		fpcService: { getFpcImpl: vi.fn(async () => fpc) },
		tasks,
		logger: { log: () => {} },
	} as unknown as FeeStrategyDeps
	const probe = { extractEffects: vi.fn(async () => opts.effects ?? []) }
	const ctx = makeCtx(path, opts.probe ? probe : undefined, controller.signal)
	return { deps, ctx, builds, buildStandard, simulateTxTask, tasks, created, log, fpc, probe, strategy: strategyFor(path, deps) }
}

function makeCtx(path: PathName, probe: unknown, signal: AbortSignal): FeeStrategyContext {
	const feeSettings = {
		fj: { paymentMethod: { kind: "fj" } },
		fjwc: { paymentMethod: { kind: "fjwc", claimAmount: "1", claimSecret: "0x01", messageLeafIndex: "0" } },
		embedded: { paymentMethod: { kind: "embedded" } },
		"fpc two-pass": { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } },
		"fpc fast path": { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } },
	}[path]
	return {
		op: {
			networkId: "net-1",
			accountAddress: "0xacc",
			actions: [ORIGINAL],
			fee: path === "embedded" ? { embeddedFeePayment: "fpc" } : undefined,
		},
		fence: { profileId: "p1", epoch: 0, session: 1 },
		feeSettings,
		gasPadding: 1,
		signal,
		probe,
	} as unknown as FeeStrategyContext
}

function strategyFor(path: PathName, deps: FeeStrategyDeps): FeeStrategy {
	if (path === "fj") return new FeeJuiceStrategy(deps)
	if (path === "fjwc") return new FeeJuiceWithClaimStrategy(deps)
	if (path === "embedded") return new EmbeddedStrategy(deps)
	return new FpcStrategy(deps)
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise
	} catch (error) {
		return error
	}
	throw new Error("expected a rejection")
}

const estimateTasks = (created: Task[]) => created.filter((t) => t.content.label === "Estimating fee")

/** Every simulation's options, exactly: `stub` or `valid`, scoped to the account of the build whose `pxe` it ran on. */
function expectSimOpts(h: ReturnType<typeof harness>, kinds: Array<"stub" | "valid">) {
	const calls = h.simulateTxTask.mock.calls as unknown[][]
	expect(calls.map((c) => ((c[2] as { skipTxValidation?: boolean }).skipTxValidation ? "stub" : "valid"))).toEqual(kinds)
	for (const call of calls) {
		const built = h.builds.find((b) => b.pxe === call[0])
		expect(built).toBeDefined()
		const address = built?.account.address
		const expected =
			(call[2] as { skipTxValidation?: boolean }).skipTxValidation === true
				? {
						simulatePublic: true,
						skipFeeEnforcement: true,
						skipTxValidation: true,
						scopes: [address],
						stubAccountAddresses: ["0xaccount"],
					}
				: { simulatePublic: true, skipFeeEnforcement: true, scopes: [address] }
		expect(call[2]).toStrictEqual(expected)
		expect((call[2] as { scopes: unknown[] }).scopes[0]).toBe(address)
	}
}

function feesOf(txRequest: { txContext: { gasSettings: GasSettings } }) {
	const fees = txRequest.txContext.gasSettings.maxFeesPerGas
	return [fees.feePerDaGas, fees.feePerL2Gas]
}

describe("estimate task lifecycle", () => {
	test.each(PATHS)("%s: one root task, Completed when the estimate settles", async (path) => {
		const h = harness(path)
		await h.strategy.buildAndEstimate(h.ctx)
		const tasks = estimateTasks(h.created)
		expect(tasks).toHaveLength(1)
		expect(tasks[0]?.parentId).toBeUndefined()
		expect(tasks[0]?.status).toBe(TaskStatus.Completed)
	})

	test.each(PATHS)("%s: under a parent task, a subtask of it", async (path) => {
		const h = harness(path)
		const parent = h.tasks.startNewTask(new StepContent("parent"))
		h.ctx.parentTask = parent
		await h.strategy.buildAndEstimate(h.ctx)
		const tasks = estimateTasks(h.created)
		expect(tasks).toHaveLength(1)
		expect(tasks[0]?.parentId).toBe(parent.id)
		expect(tasks[0]?.status).toBe(TaskStatus.Completed)
	})

	test.each(PATHS)("%s: a build rejection fails the task and rethrows the same object", async (path) => {
		const h = harness(path)
		const boom = new Error("build boom")
		h.buildStandard.mockRejectedValueOnce(boom)
		expect(await rejectionOf(h.strategy.buildAndEstimate(h.ctx))).toBe(boom)
		const tasks = estimateTasks(h.created)
		expect(tasks.map((t) => [t.status, t.error])).toEqual([[TaskStatus.Failed, "build boom"]])
	})

	test.each(PATHS)("%s: a simulation rejection fails the task and rethrows the same object", async (path) => {
		const h = harness(path)
		const boom = new Error("sim boom")
		h.simulateTxTask.mockRejectedValueOnce(boom)
		expect(await rejectionOf(h.strategy.buildAndEstimate(h.ctx))).toBe(boom)
		expect(estimateTasks(h.created).map((t) => [t.status, t.error])).toEqual([[TaskStatus.Failed, "sim boom"]])
	})

	test.each(PATHS)("%s: finalize's admission-cap refusal fails the task with its exact message", async (path) => {
		const h = harness(path, { build: { txsLimits: new Gas(10, 10) } })
		const error = await rejectionOf(h.strategy.buildAndEstimate(h.ctx))
		const message =
			"Simulated gas (da=31000, l2=32000) exceeds the network per-tx admission limit (da=10, l2=10) — this transaction cannot be included."
		expect((error as Error).message).toBe(message)
		expect(estimateTasks(h.created).map((t) => [t.status, t.error])).toEqual([[TaskStatus.Failed, message]])
	})

	test.each([
		{
			name: "fjwc called with another kind",
			run: (deps: FeeStrategyDeps, ctx: FeeStrategyContext) => new FeeJuiceWithClaimStrategy(deps).buildAndEstimate(ctx),
			path: "fj" as PathName,
			message: "FeeJuiceWithClaimStrategy called with non-fjwc payment method",
		},
		{
			name: "embedded without embeddedFeePayment",
			run: (deps: FeeStrategyDeps, ctx: FeeStrategyContext) => new EmbeddedStrategy(deps).buildAndEstimate(ctx),
			path: "fj" as PathName,
			message: "Embedded fee payment not specified",
		},
		{
			name: "fpc called with another kind",
			run: (deps: FeeStrategyDeps, ctx: FeeStrategyContext) => new FpcStrategy(deps).buildAndEstimate(ctx),
			path: "fj" as PathName,
			message: "FpcStrategy called with non-fpc payment method",
		},
	])("pre-task guard: $name rejects with its message and starts no task", async ({ run, path, message }) => {
		const h = harness(path)
		const error = await rejectionOf(run(h.deps, h.ctx))
		expect((error as Error).message).toBe(message)
		expect(h.created).toHaveLength(0)
	})

	test("pre-task guard: an fpc row that cannot be read rejects as-is and starts no task", async () => {
		const h = harness("fpc two-pass")
		const boom = new Error("no row")
		;(h.deps.fpcService.getFpcImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(boom)
		expect(await rejectionOf(h.strategy.buildAndEstimate(h.ctx))).toBe(boom)
		expect(h.created).toHaveLength(0)
	})

	test("fast-path cross-chain fallback: the first task completes before the two-pass task starts", async () => {
		const h = harness("fpc fast path", { build: { chainId: 7 }, fpcChainId: 999 })
		await h.strategy.buildAndEstimate(h.ctx)
		expect(h.log).toEqual(["created:Estimating fee", "Completed:Estimating fee", "created:Estimating fee", "Completed:Estimating fee"])
		expect(h.buildStandard.mock.calls.map((c) => c[2])).toEqual([EXTERNAL, PREEXISTING, EXTERNAL])
	})

	test("fast-path cross-chain fallback: a two-pass rejection escapes as-is; the first task stays Completed", async () => {
		const h = harness("fpc fast path", { build: { chainId: 7 }, fpcChainId: 999 })
		const boom = new Error("two-pass boom")
		h.simulateTxTask.mockRejectedValueOnce(boom)
		expect(await rejectionOf(h.strategy.buildAndEstimate(h.ctx))).toBe(boom)
		expect(estimateTasks(h.created).map((t) => [t.status, t.error])).toEqual([
			[TaskStatus.Completed, undefined],
			[TaskStatus.Failed, "two-pass boom"],
		])
	})
})

describe("validated simulation options", () => {
	test.each([
		{ path: "fj" as PathName, kinds: ["valid"] },
		{ path: "fjwc" as PathName, kinds: ["valid"] },
		{ path: "embedded" as PathName, kinds: ["valid"] },
		{ path: "fpc two-pass" as PathName, kinds: ["valid", "valid"] },
		{ path: "fpc fast path" as PathName, kinds: ["valid"] },
	])("$path without a probe: every call is exactly the validated literal, scoped to its own build", async ({ path, kinds }) => {
		const h = harness(path)
		await h.strategy.buildAndEstimate(h.ctx)
		expectSimOpts(h, kinds as Array<"stub" | "valid">)
	})
})

type FoldRow = {
	path: PathName
	cell: "none" | "effects" | "init" | "both"
	methods: AccountFeePaymentMethodOptions[]
	sims: Array<"stub" | "valid">
	actions: Action[]
}

const P = PREEXISTING
const E = EXTERNAL
const FOLD_MATRIX: FoldRow[] = [
	{ path: "fj", cell: "none", methods: [P], sims: ["stub"], actions: [ORIGINAL] },
	{ path: "fj", cell: "effects", methods: [P, P], sims: ["stub", "valid"], actions: [ORIGINAL, DISCOVERED] },
	{ path: "fj", cell: "init", methods: [P, P], sims: ["stub", "valid"], actions: [ORIGINAL] },
	{ path: "fj", cell: "both", methods: [P, P], sims: ["stub", "valid"], actions: [ORIGINAL, DISCOVERED] },
	{ path: "fpc fast path", cell: "none", methods: [E], sims: ["stub"], actions: [PAYLOAD, ORIGINAL] },
	{ path: "fpc fast path", cell: "effects", methods: [E, E], sims: ["stub", "valid"], actions: [PAYLOAD, ORIGINAL, DISCOVERED] },
	{ path: "fpc fast path", cell: "init", methods: [E, E], sims: ["stub", "valid"], actions: [PAYLOAD, ORIGINAL] },
	{ path: "fpc fast path", cell: "both", methods: [E, E], sims: ["stub", "valid"], actions: [PAYLOAD, ORIGINAL, DISCOVERED] },
	{ path: "fpc two-pass", cell: "none", methods: [P, E], sims: ["stub", "valid"], actions: [PAYLOAD, ORIGINAL] },
	{ path: "fpc two-pass", cell: "effects", methods: [P, E], sims: ["stub", "valid"], actions: [PAYLOAD, ORIGINAL, DISCOVERED] },
	{ path: "fpc two-pass", cell: "init", methods: [P, P, E], sims: ["stub", "valid", "valid"], actions: [PAYLOAD, ORIGINAL] },
	{
		path: "fpc two-pass",
		cell: "both",
		methods: [P, P, E],
		sims: ["stub", "valid", "valid"],
		actions: [PAYLOAD, ORIGINAL, DISCOVERED],
	},
]

const foldOpts = (cell: FoldRow["cell"], extra: HarnessOpts = {}): HarnessOpts => ({
	probe: true,
	effects: cell === "effects" || cell === "both" ? [DISCOVERED] : [],
	build: { initWrapped: cell === "init" || cell === "both" },
	...extra,
})

describe("probe fold", () => {
	test.each(FOLD_MATRIX)(
		"$path, $cell: builds, simulations, probe input and final actions",
		async ({ path, cell, methods, sims, actions }) => {
			const h = harness(path, foldOpts(cell))
			await h.strategy.buildAndEstimate(h.ctx)
			expect(h.buildStandard.mock.calls.map((c) => c[2])).toEqual(methods)
			expectSimOpts(h, sims)
			expect(h.probe.extractEffects).toHaveBeenCalledTimes(1)
			const [sim, chain] = h.probe.extractEffects.mock.calls[0] as unknown as [unknown, { node: unknown; network: unknown }]
			expect(sim).toBe(await h.simulateTxTask.mock.results[0]?.value)
			expect(chain.node).toBe(h.builds[0]?.node)
			expect(chain.network).toBe(h.builds[0]?.network)
			expect(h.ctx.op.actions).toEqual(actions)
		},
	)

	test.each(FOLD_MATRIX.filter((row) => row.methods.length > 1 && row.methods[1] === row.methods[0]))(
		"$path, $cell: a cancel during the stubbed sim throws before the second build",
		async ({ path, cell }) => {
			const h = harness(path, foldOpts(cell, { abortOnFirstSim: true }))
			expect(await rejectionOf(h.strategy.buildAndEstimate(h.ctx))).toBeInstanceOf(JobCancelledSentinel)
			expect(h.buildStandard).toHaveBeenCalledTimes(1)
			expect(estimateTasks(h.created).map((t) => t.status)).toEqual([TaskStatus.Failed])
		},
	)

	test("fpc two-pass, effects only: the fold passes; the cancel lands before Pass 2, after one fee read", async () => {
		const h = harness("fpc two-pass", foldOpts("effects", { abortOnFirstSim: true }))
		expect(await rejectionOf(h.strategy.buildAndEstimate(h.ctx))).toBeInstanceOf(JobCancelledSentinel)
		expect(h.buildStandard).toHaveBeenCalledTimes(1)
		expect(h.builds[0]?.node.getCurrentMinFees).toHaveBeenCalledTimes(1)
		expect(h.ctx.op.actions).toEqual([PAYLOAD, ORIGINAL, DISCOVERED])
	})
})

describe("committed fees for an explicit multiplier", () => {
	test.each(["fj", "fjwc"] as PathName[])("%s: finalize commits the node min × 3", async (path) => {
		const h = harness(path)
		h.ctx.feeMultiplier = 3
		const result = await h.strategy.buildAndEstimate(h.ctx)
		expect(feesOf(result.txRequest as never)).toEqual([1_665n, 1_998n])
	})

	test.each(["fpc two-pass", "fpc fast path"] as PathName[])(
		"%s: the fee basis, Pass 2's cap and the payload's maxFee use × 3",
		async (path) => {
			const h = harness(path)
			h.ctx.feeMultiplier = 3
			const capsAtSim: bigint[][] = []
			h.simulateTxTask.mockImplementation(async (...args: unknown[]) => {
				capsAtSim.push(feesOf(args[1] as never))
				return sentinelSim()
			})
			const result = await h.strategy.buildAndEstimate(h.ctx)
			expect(feesOf(result.txRequest as never)).toEqual([1_665n, 1_998n])
			if (path === "fpc two-pass") expect(capsAtSim[1]).toEqual([1_665n, 1_998n])
			const lastPayload = h.fpc.getFeePayload.mock.calls.at(-1) as unknown as [string, { toBigInt(): bigint }]
			// 31_000 · 1_665 + 32_000 · 1_998: the final sim's gas at padding 1, priced at the committed basis.
			expect(lastPayload[1].toBigInt()).toBe(115_551_000n)
		},
	)

	test("embedded: the multiplier never applies; the committed cap stays at the node min", async () => {
		const h = harness("embedded")
		h.ctx.feeMultiplier = 3
		const result = await h.strategy.buildAndEstimate(h.ctx)
		expect(feesOf(result.txRequest as never)).toEqual([555n, 666n])
	})
})
