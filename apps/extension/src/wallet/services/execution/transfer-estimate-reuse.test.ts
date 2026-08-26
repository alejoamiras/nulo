/**
 * `TransferEstimateReuse` — ported characterization pins (every
 * observable exit of `tryConsume`, fingerprint byte-stability, stash
 * sweep). These were written against the facade BEFORE extraction and
 * moved here with the subsystem; the behavior contract is identical.
 */

import { GasFees } from "@aztec/stdlib/gas"
import { describe, expect, test } from "vitest"
import { TransferType } from "@/wallet/services/transaction/spec"
import type { Network } from "@/wallet/services/network/service"
import type { FeeSettings } from "./spec"
import {
	ESTIMATE_REUSE_TTL_MS,
	TransferEstimateReuse,
	type TransferEstimateReuseDeps,
	type TransferEstimateReuseEntry,
	fingerprintBaseFee,
	fingerprintFeeSettings,
} from "./transfer-estimate-reuse"

const FEE_SETTINGS: FeeSettings = { paymentMethod: { kind: "fj" } }

const INPUTS = {
	networkId: "net-1",
	accountAddress: "0xacc",
	tokenId: 1,
	transferType: TransferType.Public,
	recipientAddress: "0xrecipient",
	amount: 100n,
	feeSettings: FEE_SETTINGS,
}

// Node reports min fees of 50/100; default multiplier 2 → a fresh build
// would finalize 100:200, so a matching entry stores that fingerprint.
const CURRENT_MIN = new GasFees(50n, 100n)
const MATCHING_BASE_FEE_FINGERPRINT = "100:200"

const PRIMARY_ENDPOINT = { id: "ep-1", rpcUrl: "http://localhost:8080" }

function makeEntry(overrides: Partial<TransferEstimateReuseEntry> = {}): TransferEstimateReuseEntry {
	return {
		networkId: INPUTS.networkId,
		initializesAccount: false,
		accountAddress: INPUTS.accountAddress,
		tokenId: INPUTS.tokenId,
		transferType: INPUTS.transferType,
		recipientAddress: INPUTS.recipientAddress,
		amount: INPUTS.amount,
		feeSettingsHash: fingerprintFeeSettings(FEE_SETTINGS),
		profileId: "profile-1",
		baseFeeFingerprint: MATCHING_BASE_FEE_FINGERPRINT,
		primaryEndpointId: PRIMARY_ENDPOINT.id,
		primaryEndpointUrl: PRIMARY_ENDPOINT.rpcUrl,
		pendingHashes: [],
		txRequest: {} as TransferEstimateReuseEntry["txRequest"],
		nonce: { toString: () => "1" },
		feePaymentMethod: 0 as TransferEstimateReuseEntry["feePaymentMethod"],
		token: { contract: "0xtoken", name: "Token", symbol: "TOK", decimals: 18 },
		fnName: "transfer_in_public",
		args: [],
		builtAt: Date.now(),
		...overrides,
	}
}

function makeReuse(
	overrides: {
		entry?: Partial<TransferEstimateReuseEntry>
		profile?: { id: string } | undefined
		network?: Partial<Network>
		getCurrentMinFees?: () => Promise<GasFees>
		getPredictedMinFees?: () => Promise<GasFees[]>
		pending?: Array<{ hash: string }>
	} = {},
) {
	const entry = makeEntry(overrides.entry)
	const deps: TransferEstimateReuseDeps = {
		getActiveProfile: async () => ("profile" in overrides ? overrides.profile : { id: "profile-1" }),
		getNetwork: async () =>
			(overrides.network ?? {
				chainId: 0,
				primaryEndpointId: PRIMARY_ENDPOINT.id,
				endpoints: [PRIMARY_ENDPOINT],
			}) as Network,
		getNode: async () => ({
			getCurrentMinFees: overrides.getCurrentMinFees ?? (async () => CURRENT_MIN),
			getPredictedMinFees: overrides.getPredictedMinFees,
		}),
		getPendingForAccount: () => overrides.pending ?? [],
		logDebug: () => {},
	}
	const reuse = new TransferEstimateReuse(deps)
	reuse.stash("est-1", entry)
	return { reuse, entry }
}

describe("fingerprint byte-stability (cache-compare contract)", () => {
	test("fingerprintBaseFee exact format: '<da>:<l2>'", () => {
		expect(fingerprintBaseFee({ feePerDaGas: 100n, feePerL2Gas: 200n })).toBe("100:200")
		expect(fingerprintBaseFee({ feePerDaGas: 0n, feePerL2Gas: 0n })).toBe("0:0")
	})

	test("fingerprintFeeSettings exact format per payment-method variant", () => {
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "fj" } })).toBe("fj|default")
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "fj" }, priorityLevel: "fast" })).toBe("fj|fast")
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "fpc", fpcId: "abc" }, priorityLevel: "urgent" })).toBe("fpc:abc|urgent")
		expect(
			fingerprintFeeSettings({
				paymentMethod: { kind: "fjwc", claimAmount: "100", claimSecret: "sec", messageLeafIndex: "0" },
			}),
		).toBe("fjwc:100:sec:0|default")
		expect(fingerprintFeeSettings({ paymentMethod: { kind: "embedded" } })).toBe("embedded|default")
	})
})

describe("tryConsume: every observable exit", () => {
	test("happy path returns the entry", async () => {
		const { reuse, entry } = makeReuse()
		expect(await reuse.tryConsume("est-1", INPUTS)).toBe(entry)
	})

	test("unknown estimateId → undefined", async () => {
		const { reuse } = makeReuse()
		expect(await reuse.tryConsume("nope", INPUTS)).toBeUndefined()
	})

	test("single-shot: second consume of the same id → undefined", async () => {
		const { reuse } = makeReuse()
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeDefined()
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("TTL stale → undefined", async () => {
		const { reuse } = makeReuse({ entry: { builtAt: Date.now() - ESTIMATE_REUSE_TTL_MS - 1 } })
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("input drift (recipient) → undefined", async () => {
		const { reuse } = makeReuse({ entry: { recipientAddress: "0xother" } })
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("fee-settings drift (different payment method hash) → undefined", async () => {
		const { reuse } = makeReuse({
			entry: { feeSettingsHash: fingerprintFeeSettings({ paymentMethod: { kind: "fpc", fpcId: "x" } }) },
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("profile drift (different active profile) → undefined", async () => {
		const { reuse } = makeReuse({ profile: { id: "profile-2" } })
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("no active profile → undefined", async () => {
		const { reuse } = makeReuse({ profile: undefined })
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("no primary endpoint on the network → undefined", async () => {
		const { reuse } = makeReuse({
			network: { chainId: 0, primaryEndpointId: "ep-gone", endpoints: [PRIMARY_ENDPOINT] } as Partial<Network>,
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("primary endpoint URL changed → undefined", async () => {
		const { reuse } = makeReuse({
			network: {
				chainId: 0,
				primaryEndpointId: PRIMARY_ENDPOINT.id,
				endpoints: [{ id: PRIMARY_ENDPOINT.id, rpcUrl: "http://localhost:9999" }],
			} as Partial<Network>,
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("base fee drift → undefined", async () => {
		const { reuse } = makeReuse({
			getCurrentMinFees: async () => new GasFees(51n, 100n),
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("predicted-worst (not current-min) is the consume-time basis", async () => {
		// Current-min alone would finalize 100:200 and match the entry, but a
		// fresh build prices off the worst predicted slot (60/120 → 120:240),
		// so the 100:200 entry must reject.
		const { reuse } = makeReuse({
			getPredictedMinFees: async () => [new GasFees(55n, 110n), new GasFees(60n, 120n)],
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("predicted-worst entry matches when the prediction is stable", async () => {
		const { reuse, entry } = makeReuse({
			entry: { baseFeeFingerprint: "120:240" },
			getPredictedMinFees: async () => [new GasFees(55n, 110n), new GasFees(60n, 120n)],
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBe(entry)
	})

	test("base fee fetch failure → undefined (conservative)", async () => {
		const { reuse } = makeReuse({
			getCurrentMinFees: async () => {
				throw new Error("node down")
			},
		})
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})

	test("pending-tx set changed → undefined", async () => {
		const { reuse } = makeReuse({ pending: [{ hash: "0xnew" }] })
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeUndefined()
	})
})

describe("stash: opportunistic TTL sweep", () => {
	test("stale entries are evicted on write; fresh ones survive", async () => {
		const { reuse } = makeReuse() // est-1 fresh
		const stale = makeEntry({ builtAt: Date.now() - ESTIMATE_REUSE_TTL_MS - 1 })
		reuse.stash("est-stale", stale)
		// Writing a THIRD entry sweeps est-stale (past TTL) but not est-1.
		reuse.stash("est-2", makeEntry())
		expect(await reuse.tryConsume("est-stale", INPUTS)).toBeUndefined()
		expect(await reuse.tryConsume("est-1", INPUTS)).toBeDefined()
		expect(await reuse.tryConsume("est-2", INPUTS)).toBeDefined()
	})

	test("(N-15) a consumed entry carries the build's initializesAccount provenance verbatim", async () => {
		// The entry retains the EXACT build, so the confirm leg's classification
		// must see the same provenance a fresh build would — a cache hit that
		// dropped the flag would silently downgrade a real init race to generic.
		const { reuse } = makeReuse({ entry: { initializesAccount: true } })
		const consumed = await reuse.tryConsume("est-1", INPUTS)
		expect(consumed?.initializesAccount).toBe(true)
	})
})
