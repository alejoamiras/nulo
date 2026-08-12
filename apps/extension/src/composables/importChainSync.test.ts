import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	ACCOUNT_STATE_SKIP_DEADLINE,
	ACCOUNT_STATE_SKIP_UNREACHABLE,
	ACCOUNT_STATE_SKIP_WRONG_NETWORK,
} from "@/wallet/services/account-state/normalize"
import { NodeStatus } from "@/wallet/services/network/spec"
import { IMPORT_REGISTRATION_BUDGET_MS, runImportChainSync } from "./importChainSync"

const sender = (address = `0x${"ab".repeat(32)}`) => ({ address })

interface Harness {
	records: unknown[][]
	restoreCalls: Array<{ items: unknown[]; deadlineMs: number }>
	probeCalls: string[]
}

function makeDeps(overrides: {
	slice: unknown
	createdNetworkIds?: string[]
	probeStatus?: NodeStatus | ((id: string) => NodeStatus)
	restoreImpl?: (items: unknown[], deadlineMs: number) => Promise<unknown>
}) {
	const harness: Harness = { records: [], restoreCalls: [], probeCalls: [] }
	const deps = {
		slice: overrides.slice,
		createdNetworkIds: overrides.createdNetworkIds ?? ["n1"],
		restore: (items: unknown[], deadlineMs: number) => {
			harness.restoreCalls.push({ items, deadlineMs })
			return overrides.restoreImpl ? overrides.restoreImpl(items, deadlineMs) : Promise.resolve([])
		},
		probe: async (id: string) => {
			harness.probeCalls.push(id)
			const s = overrides.probeStatus ?? NodeStatus.Active
			return typeof s === "function" ? s(id) : s
		},
		record: (records: unknown[]) => {
			harness.records.push(records)
		},
	}
	return { deps, harness }
}

async function run(promise: Promise<void>): Promise<void> {
	await vi.runAllTimersAsync()
	await promise
}

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
		expect(harness.records).toEqual([[...result].map((r) => r)])
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
		await expect(run(runImportChainSync(deps))).resolves.toBeUndefined()
		expect(harness.records).toEqual([[{ networkId: "n1", senders: [], contracts: [], restoreError: ACCOUNT_STATE_SKIP_DEADLINE }]])
	})

	test("violations AND registrations both flow: normalizer violations recorded before the leg runs", async () => {
		const { deps, harness } = makeDeps({
			slice: [null, { networkId: "n1", senders: [sender()], contracts: [] }],
			restoreImpl: async () => [],
		})
		await run(runImportChainSync(deps))
		expect(harness.records.length).toBeGreaterThanOrEqual(1)
		expect(JSON.stringify(harness.records[0])).toContain("malformed")
		expect(harness.restoreCalls).toHaveLength(1)
	})
})
