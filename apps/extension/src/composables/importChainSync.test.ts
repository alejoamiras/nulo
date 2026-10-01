import { ProtocolContractAddress } from "@aztec-labs/protocol-contracts"
import { STANDARD_AUTH_REGISTRY_ADDRESS } from "@aztec-labs/standard-contracts/auth-registry/constants"
import {
	HISTORICAL_STANDARD_HANDSHAKE_REGISTRY_ADDRESSES,
	STANDARD_HANDSHAKE_REGISTRY_ADDRESS,
} from "@aztec-labs/standard-contracts/handshake-registry/constants"
import { STANDARD_MULTI_CALL_ENTRYPOINT_ADDRESS } from "@aztec-labs/standard-contracts/multi-call-entrypoint/constants"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	ACCOUNT_STATE_SKIP_DEADLINE,
	ACCOUNT_STATE_SKIP_UNREACHABLE,
	ACCOUNT_STATE_SKIP_WRONG_NETWORK,
	skippedNetworkRecord,
} from "@/wallet/services/account-state/normalize"
import { NodeStatus } from "@/wallet/services/network/spec"
import { IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS, IMPORT_REGISTRATION_BUDGET_MS, runImportChainSync } from "./importChainSync"

const sender = (address = `0x${"ab".repeat(32)}`) => ({ address })
const contract = (address: string) => ({ address, instance: { i: 1 }, artifact: { a: 1 } })

interface Harness {
	records: unknown[][]
	kinds: unknown[]
	restoreCalls: Array<{ items: unknown[]; deadlineMs: number; at: number }>
	probeCalls: string[]
}

function makeDeps(overrides: {
	slice: unknown
	createdNetworkIds?: string[]
	probeStatus?: NodeStatus | ((id: string) => NodeStatus | Promise<NodeStatus>)
	restoreImpl?: (items: unknown[], deadlineMs: number) => Promise<unknown>
}) {
	const harness: Harness = { records: [], kinds: [], restoreCalls: [], probeCalls: [] }
	const deps = {
		slice: overrides.slice,
		createdNetworkIds: overrides.createdNetworkIds ?? ["n1"],
		restore: (items: unknown[], deadlineMs: number) => {
			harness.restoreCalls.push({ items, deadlineMs, at: Date.now() })
			return overrides.restoreImpl ? overrides.restoreImpl(items, deadlineMs) : Promise.resolve([])
		},
		probe: async (id: string) => {
			harness.probeCalls.push(id)
			const s = overrides.probeStatus ?? NodeStatus.Active
			return typeof s === "function" ? s(id) : s
		},
		record: (records: unknown[], kind?: unknown) => {
			harness.records.push(records)
			harness.kinds.push(kind)
		},
	}
	return { deps, harness }
}

async function run<T>(promise: Promise<T>): Promise<T> {
	await vi.runAllTimersAsync()
	return await promise
}

const idsOf = (items: unknown) => (items as Array<{ networkId: string }> | undefined)?.map((i) => i.networkId)
const callFor = (harness: Harness, networkId: string) => harness.restoreCalls.find((c) => idsOf(c.items)?.includes(networkId))
const hangs = () => new Promise<never>(() => {})
const twoNetworks = [
	{ networkId: "n1", senders: [sender()], contracts: [] },
	{ networkId: "n2", senders: [sender()], contracts: [] },
]

describe("runImportChainSync", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	test("clean empty slice: no probe, no restore, no records", async () => {
		const { deps, harness } = makeDeps({ slice: [] })
		await run(runImportChainSync(deps))
		expect(harness.probeCalls).toEqual([])
		expect(harness.restoreCalls).toEqual([])
		expect(harness.records).toEqual([])
	})

	test("malformed slice: violations recorded, nothing dialed", async () => {
		const { deps, harness } = makeDeps({ slice: { evil: 1 } })
		await run(runImportChainSync(deps))
		expect(harness.records).toHaveLength(1)
		expect(harness.probeCalls).toEqual([])
		expect(harness.restoreCalls).toEqual([])
	})

	test("zero-work items (empty children): no probe, no restore", async () => {
		const { deps, harness } = makeDeps({ slice: [{ networkId: "n1", senders: [], contracts: [] }] })
		await run(runImportChainSync(deps))
		expect(harness.probeCalls).toEqual([])
		expect(harness.restoreCalls).toEqual([])
	})

	test("a network holding only what every PXE boot registers: no probe, no restore, no record", async () => {
		const rebuilt = [
			...Object.values(ProtocolContractAddress),
			STANDARD_MULTI_CALL_ENTRYPOINT_ADDRESS,
			STANDARD_AUTH_REGISTRY_ADDRESS,
			STANDARD_HANDSHAKE_REGISTRY_ADDRESS,
			...HISTORICAL_STANDARD_HANDSHAKE_REGISTRY_ADDRESSES,
		].map((a) => contract(a.toString()))
		const { deps, harness } = makeDeps({ slice: [{ networkId: "n1", senders: [], contracts: rebuilt }] })
		await run(runImportChainSync(deps))
		expect(harness.probeCalls).toEqual([])
		expect(harness.restoreCalls).toEqual([])
		expect(harness.records).toEqual([])
	})

	test("GO network: restore runs with the clamped deadline and its result is recorded", async () => {
		const result = [{ networkId: "n1", senders: [sender()], contracts: [] }]
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "n1", senders: [sender()], contracts: [] }],
			restoreImpl: async () => result,
		})
		await run(runImportChainSync(deps))
		expect(harness.probeCalls).toEqual(["n1"])
		expect(harness.restoreCalls).toHaveLength(1)
		expect(harness.restoreCalls[0].deadlineMs).toBeLessThanOrEqual(IMPORT_REGISTRATION_BUDGET_MS)
		expect(harness.restoreCalls[0].deadlineMs).toBeGreaterThan(0)
		expect(harness.records).toEqual([result])
	})

	test("unreachable network: skip record with the constant copy, restore NOT called", async () => {
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "n1", senders: [sender()], contracts: [] }],
			probeStatus: NodeStatus.Inactive,
		})
		await run(runImportChainSync(deps))
		expect(harness.restoreCalls).toEqual([])
		expect(harness.records).toEqual([[{ networkId: "n1", senders: [], contracts: [], restoreError: ACCOUNT_STATE_SKIP_UNREACHABLE }]])
	})

	test("wrong-network verdict: its own constant copy", async () => {
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "n1", senders: [sender()], contracts: [] }],
			probeStatus: NodeStatus.InvalidChain,
		})
		await run(runImportChainSync(deps))
		expect(harness.records).toEqual([[{ networkId: "n1", senders: [], contracts: [], restoreError: ACCOUNT_STATE_SKIP_WRONG_NETWORK }]])
	})

	test("mixed verdicts: skipped networks recorded, GO networks restored", async () => {
		const { deps, harness } = makeDeps({
			slice: [
				{ networkId: "n1", senders: [sender()], contracts: [] },
				{ networkId: "n2", senders: [sender("0xdead")], contracts: [] },
			],
			createdNetworkIds: ["n1", "n2"],
			probeStatus: (id) => (id === "n1" ? NodeStatus.Active : NodeStatus.Inactive),
		})
		await run(runImportChainSync(deps))
		expect(harness.records[0]).toEqual([{ networkId: "n2", senders: [], contracts: [], restoreError: ACCOUNT_STATE_SKIP_UNREACHABLE }])
		expect(harness.restoreCalls).toHaveLength(1)
		const restoredIds = (harness.restoreCalls[0].items as Array<{ networkId: string }>).map((i) => i.networkId)
		expect(restoredIds).toEqual(["n1"])
	})

	test("unknown network ids (not created by this restore) skip the probe but reach restore", async () => {
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "ghost", senders: [sender()], contracts: [] }],
			createdNetworkIds: ["n1"],
		})
		await run(runImportChainSync(deps))
		expect(harness.probeCalls).toEqual([])
		expect(harness.restoreCalls).toHaveLength(1)
	})

	test("HANGING restore: the race records deadline skips ONCE; a late resolution appends nothing", async () => {
		let resolveLate: (v: unknown) => void = () => {}
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "n1", senders: [sender()], contracts: [] }],
			restoreImpl: () =>
				new Promise((resolve) => {
					resolveLate = resolve
				}),
		})
		await run(runImportChainSync(deps))
		expect(harness.records).toEqual([[{ networkId: "n1", senders: [], contracts: [], restoreError: ACCOUNT_STATE_SKIP_DEADLINE }]])
		// The abandoned SW-side call resolving late must not re-append.
		resolveLate([{ networkId: "n1", senders: [], contracts: [] }])
		for (let i = 0; i < 5; i++) await Promise.resolve()
		expect(harness.records).toHaveLength(1)
	})

	test("REJECTING restore: deadline skip records, no throw", async () => {
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "n1", senders: [sender()], contracts: [] }],
			restoreImpl: () => Promise.reject(new Error("SW gone")),
		})
		const retryable = await run(runImportChainSync(deps))
		expect(idsOf(retryable)).toEqual(["n1"])
		expect(harness.records).toEqual([[{ networkId: "n1", senders: [], contracts: [], restoreError: ACCOUNT_STATE_SKIP_DEADLINE }]])
	})

	test("a rejected call records only its own network, with the constant copy (the message is dropped)", async () => {
		const { deps, harness } = makeDeps({
			slice: twoNetworks,
			createdNetworkIds: ["n1", "n2"],
			restoreImpl: (items) => (idsOf(items)?.includes("n1") ? Promise.reject(new Error("<script>0xdeadbeef")) : Promise.resolve([])),
		})
		await run(runImportChainSync(deps))
		expect(harness.records).toEqual([[skippedNetworkRecord("n1", ACCOUNT_STATE_SKIP_DEADLINE)]])
	})

	test("a resolved connectivity or deadline failure is retryable; a resolved payload failure is not", async () => {
		const results: Record<string, unknown[]> = {
			n1: [
				{
					networkId: "n1",
					senders: [{ ...sender(), restoreError: "Error fetching from host http://x: TypeError: fetch failed" }],
					contracts: [],
				},
			],
			n2: [{ networkId: "n2", senders: [{ ...sender(), restoreError: "Invalid artifact: missing function abi" }], contracts: [] }],
			n3: [
				{
					networkId: "n3",
					senders: [],
					contracts: [],
					restoreError: `${ACCOUNT_STATE_SKIP_DEADLINE} (1 registration(s) not attempted)`,
				},
			],
		}
		const { deps } = makeDeps({
			slice: ["n1", "n2", "n3"].map((networkId) => ({ networkId, senders: [sender()], contracts: [] })),
			createdNetworkIds: ["n1", "n2", "n3"],
			restoreImpl: (items) => Promise.resolve(results[idsOf(items)?.[0] ?? ""]),
		})
		const retryable = await run(runImportChainSync(deps))
		expect(idsOf(retryable)).toEqual(["n1", "n3"])
	})

	test("violations AND registrations both flow: normalizer violations recorded before the leg runs", async () => {
		const { deps, harness } = makeDeps({
			slice: [null, { networkId: "n1", senders: [sender()], contracts: [] }],
			restoreImpl: async () => [{ networkId: "n1", senders: [sender()], contracts: [] }],
		})
		await run(runImportChainSync(deps))
		expect(harness.kinds).toEqual(["violations", "outcomes"])
		expect(JSON.stringify(harness.records[0])).toContain("malformed")
		expect(harness.restoreCalls).toHaveLength(1)
	})

	test("a stalled network costs only its own row: the other's result lands, the stalled one gets one deadline record", async () => {
		const n1Result = [{ networkId: "n1", senders: [sender()], contracts: [] }]
		const { deps, harness } = makeDeps({
			slice: twoNetworks,
			createdNetworkIds: ["n1", "n2"],
			restoreImpl: (items) => (idsOf(items)?.includes("n2") ? hangs() : Promise.resolve(n1Result)),
		})
		await run(runImportChainSync(deps))
		expect(harness.records).toEqual([[...n1Result, skippedNetworkRecord("n2", ACCOUNT_STATE_SKIP_DEADLINE)]])
	})

	test("each network registers as soon as its own probe answers, not after the slowest probe", async () => {
		const { deps, harness } = makeDeps({
			slice: twoNetworks,
			createdNetworkIds: ["n1", "n2"],
			probeStatus: (id) =>
				id === "n1" ? NodeStatus.Active : new Promise((resolve) => setTimeout(() => resolve(NodeStatus.Active), 4_000)),
		})
		const startedAt = Date.now()
		await run(runImportChainSync(deps))
		expect((callFor(harness, "n1")?.at ?? Number.POSITIVE_INFINITY) - startedAt).toBeLessThan(4_000)
		expect((callFor(harness, "n2")?.at ?? Number.NEGATIVE_INFINITY) - startedAt).toBeGreaterThanOrEqual(4_000)
	})

	test("guard: both networks stalled, exactly one deadline record each", async () => {
		const { deps, harness } = makeDeps({ slice: twoNetworks, createdNetworkIds: ["n1", "n2"], restoreImpl: hangs })
		await run(runImportChainSync(deps))
		expect(harness.records).toEqual([
			[skippedNetworkRecord("n1", ACCOUNT_STATE_SKIP_DEADLINE), skippedNetworkRecord("n2", ACCOUNT_STATE_SKIP_DEADLINE)],
		])
	})

	test("guard: a probe answering on its third attempt and a hung registration end within the total budget", async () => {
		let attempts = 0
		let resolveLate: (v: unknown) => void = () => {}
		const { deps, harness } = makeDeps({
			slice: [{ networkId: "n1", senders: [sender()], contracts: [] }],
			probeStatus: () => (++attempts < 3 ? hangs() : new Promise((resolve) => setTimeout(() => resolve(NodeStatus.Active), 4_000))),
			restoreImpl: () =>
				new Promise((resolve) => {
					resolveLate = resolve
				}),
		})
		const startedAt = Date.now()
		let settledAt = Number.POSITIVE_INFINITY
		await run(
			runImportChainSync(deps).then(() => {
				settledAt = Date.now()
			}),
		)
		expect(harness.restoreCalls).toHaveLength(1)
		expect(settledAt - startedAt).toBeLessThanOrEqual(IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS)
		expect(harness.records).toEqual([[skippedNetworkRecord("n1", ACCOUNT_STATE_SKIP_DEADLINE)]])
		resolveLate([{ networkId: "n1", senders: [], contracts: [] }])
		for (let i = 0; i < 5; i++) await Promise.resolve()
		expect(harness.records).toHaveLength(1)
	})

	test("the retry set: a deadline, a rejection and an unreachable verdict; never wrong-network or an unknown id", async () => {
		const verdicts: Record<string, NodeStatus> = { n3: NodeStatus.Inactive, n4: NodeStatus.InvalidChain }
		const { deps } = makeDeps({
			slice: ["n1", "n2", "n3", "n4", "ghost"].map((networkId) => ({ networkId, senders: [sender()], contracts: [] })),
			createdNetworkIds: ["n1", "n2", "n3", "n4"],
			probeStatus: (id) => verdicts[id] ?? NodeStatus.Active,
			restoreImpl: (items) => (idsOf(items)?.includes("n2") ? Promise.reject(new Error("SW gone")) : hangs()),
		})
		const retryable = await run(runImportChainSync(deps))
		expect(idsOf(retryable)).toEqual(["n1", "n2", "n3"])
	})
})
