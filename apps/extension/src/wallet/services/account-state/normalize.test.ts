import { describe, expect, test } from "vitest"
import {
	ACCOUNT_STATE_CAPS,
	ACCOUNT_STATE_SKIP_UNREACHABLE,
	isConnectivityErrorMessage,
	normalizeAccountStateSlice,
	registrableNetworkIds,
	skippedNetworkRecord,
	truncateErrorMessage,
} from "./normalize"

const sender = (address = `0x${"ab".repeat(32)}`) => ({ address })
const contract = (address = `0x${"cd".repeat(32)}`) => ({ address, instance: { x: 1 }, artifact: { y: 2 } })

describe("normalizeAccountStateSlice", () => {
	test("non-array slice collapses to one violation, zero items", () => {
		const { items, violations } = normalizeAccountStateSlice({ evil: true })
		expect(items).toEqual([])
		expect(violations).toHaveLength(1)
		expect(violations[0].restoreError).toContain("not an array")
	})

	test("empty slice is a clean no-op", () => {
		expect(normalizeAccountStateSlice([])).toEqual({ items: [], violations: [] })
	})

	test("well-formed items pass through with children intact", () => {
		const { items, violations } = normalizeAccountStateSlice([{ networkId: "n1", senders: [sender()], contracts: [contract()] }])
		expect(violations).toEqual([])
		expect(items).toHaveLength(1)
		expect(items[0].senders).toHaveLength(1)
		expect(items[0].contracts).toHaveLength(1)
	})

	test("duplicate networkIds merge BEFORE caps apply (duplicates cannot bypass them)", () => {
		const half = ACCOUNT_STATE_CAPS.maxSendersPerNetwork / 2 + 1
		const mkSenders = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ address: `0x${tag}${i}` }))
		const { items, violations } = normalizeAccountStateSlice([
			{ networkId: "n1", senders: mkSenders(half, "a"), contracts: [] },
			{ networkId: "n1", senders: mkSenders(half, "b"), contracts: [] },
		])
		expect(items).toHaveLength(1)
		expect(items[0].senders).toHaveLength(ACCOUNT_STATE_CAPS.maxSendersPerNetwork)
		expect(violations.some((v) => v.restoreError.includes("per-network cap"))).toBe(true)
	})

	test("networks over the cap are dropped with a per-network violation", () => {
		const raw = Array.from({ length: ACCOUNT_STATE_CAPS.maxNetworks + 2 }, (_, i) => ({
			networkId: `n${i}`,
			senders: [sender()],
			contracts: [],
		}))
		const { items, violations } = normalizeAccountStateSlice(raw)
		expect(items).toHaveLength(ACCOUNT_STATE_CAPS.maxNetworks)
		expect(violations.filter((v) => v.restoreError.includes("network cap"))).toHaveLength(2)
	})

	test("items over the input-item cap are dropped with ONE bounded violation", () => {
		const raw = Array.from({ length: ACCOUNT_STATE_CAPS.maxInputItems + 50 }, () => ({
			networkId: "n1",
			senders: [],
			contracts: [],
		}))
		const { violations } = normalizeAccountStateSlice(raw)
		expect(violations.filter((v) => v.restoreError.includes("over the cap were dropped"))).toHaveLength(1)
	})

	test("malformed items/children collapse into fixed-size violations, never per-entry records", () => {
		const { items, violations } = normalizeAccountStateSlice([
			null,
			42,
			{ networkId: "" },
			{ networkId: "n1", senders: [null, { address: "" }, sender()], contracts: [{ address: "x" }, contract()] },
			{ networkId: "n2", senders: null, contracts: [contract()] },
		])
		expect(items.find((i) => i.networkId === "n1")?.senders).toHaveLength(1)
		expect(items.find((i) => i.networkId === "n1")?.contracts).toHaveLength(1)
		// n2's malformed senders coerce to empty but its valid contracts survive.
		expect(items.find((i) => i.networkId === "n2")?.contracts).toHaveLength(1)
		// Bounded: one malformed-items record + one malformed-children record + one not-arrays record.
		expect(violations.filter((v) => v.restoreError.includes("malformed account-state item(s)"))).toHaveLength(1)
		expect(violations.filter((v) => v.restoreError.includes("malformed sender/contract"))).toHaveLength(1)
		expect(violations.filter((v) => v.restoreError.includes("not arrays"))).toHaveLength(1)
	})

	test("oversized slice collapses to one violation", () => {
		const big = [{ networkId: "n1", senders: [{ address: `0x${"a".repeat(ACCOUNT_STATE_CAPS.maxSliceBytes)}` }], contracts: [] }]
		const { items, violations } = normalizeAccountStateSlice(big)
		expect(items).toEqual([])
		expect(violations).toHaveLength(1)
		expect(violations[0].restoreError).toContain("too large")
	})
})

describe("registrableNetworkIds", () => {
	test("only networks with at least one sender or contract qualify", () => {
		const normalized = normalizeAccountStateSlice([
			{ networkId: "empty", senders: [], contracts: [] },
			{ networkId: "hasSender", senders: [sender()], contracts: [] },
			{ networkId: "hasContract", senders: [], contracts: [contract()] },
		])
		expect(registrableNetworkIds(normalized).sort()).toEqual(["hasContract", "hasSender"])
	})
})

describe("isConnectivityErrorMessage", () => {
	test("classifies transport failures, not payload failures", () => {
		expect(isConnectivityErrorMessage("Request to http://x timed out after 5000ms")).toBe(true)
		expect(isConnectivityErrorMessage("Error fetching from host http://x: TypeError: fetch failed")).toBe(true)
		expect(isConnectivityErrorMessage("connect ECONNREFUSED 127.0.0.1:1")).toBe(true)
		expect(isConnectivityErrorMessage("Invalid artifact: missing function abi")).toBe(false)
		expect(isConnectivityErrorMessage("Network not found")).toBe(false)
	})
})

describe("truncateErrorMessage / skippedNetworkRecord", () => {
	test("bounds hostile-length messages", () => {
		const long = "x".repeat(5_000)
		expect(truncateErrorMessage(long).length).toBe(ACCOUNT_STATE_CAPS.maxErrorMessageLength)
		expect(truncateErrorMessage("short")).toBe("short")
	})

	test("skip records carry the full account-state result shape", () => {
		expect(skippedNetworkRecord("n1", ACCOUNT_STATE_SKIP_UNREACHABLE)).toEqual({
			networkId: "n1",
			senders: [],
			contracts: [],
			restoreError: ACCOUNT_STATE_SKIP_UNREACHABLE,
		})
	})
})
