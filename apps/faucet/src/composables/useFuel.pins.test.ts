/**
 * Pre-extraction CHARACTERIZATION pins for the Fuel deposit orchestration (`useFuelFlow().deposit`):
 * the real flow runs over full fakes and records exact call order + values; the decomposition
 * must keep every trace identical. Pinned here because nothing else exercises `deposit` —
 * `FuelForm.test.ts` mocks it and `fuel-smoke` mocks `useFuelFlow` itself.
 *
 * Also pins (codex condition) the TOKEN IDENTITY across the Permit2 leg: the allowance read, the
 * approve write, the Permit2 typed-data `permitted.token`, the witness `bridgeToken` and the router
 * calldata `bridgeToken` are all the configured fee asset.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const h = vi.hoisted(() => {
	const trace: Array<[string, unknown]> = []
	return {
		trace,
		t: (name: string, detail?: unknown) => void trace.push([name, detail]),
		records: [] as Array<Record<string, unknown>>,
		allowance: { value: (1n << 256n) - 1n },
		fail: {
			noWallet: false,
			verify: null as null | Error,
			approve: null as null | Error,
			sign: null as null | Error,
			bridge: null as null | Error,
			receipt: null as null | Error,
		},
		FUEL_ASSET: "0x0000000000000000000000000000000000000044",
		FUEL_PORTAL: "0x0000000000000000000000000000000000000033",
		PERMIT2: "0x00000000000000000000000000000000000000cc",
		ROUTER: "0x00000000000000000000000000000000000000dd",
		SWAP_TARGET: "0x00000000000000000000000000000000000000ee",
		FROM: "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d",
		RECIPIENT: "0x1018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d",
		SECRET_HASH: "0x2018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d",
	}
})

vi.mock("@/contracts/bridge-deployments", () => ({
	FUEL_PORTAL: h.FUEL_PORTAL,
	FUEL_ASSET: h.FUEL_ASSET,
	BRIDGE_PERMIT2: h.PERMIT2,
	BRIDGE_ROUTER: h.ROUTER,
	BRIDGE_SWAP_TARGET: h.SWAP_TARGET,
}))
vi.mock("@aztec/noir-contracts.js/FeeJuice", () => ({ FeeJuiceContractArtifact: { name: "FeeJuice" } }))
vi.mock("@nulo/bridge-core/private-fpc-artifact", () => ({ PrivateFPCContractArtifact: { name: "PrivateFPC" } }))

vi.mock("@nulo/bridge-core", async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown>
	const plan = (salt: boolean) => ({
		secret: { toString: () => "0xsecret" },
		secretHash: h.SECRET_HASH,
		to: h.RECIPIENT,
		salt: salt ? { toString: () => "0xsalt" } : undefined,
	})
	return {
		...real,
		planPublicFuelDeposit: async (_claimer: unknown, amount: bigint) => {
			h.t("plan.public", amount)
			return plan(false)
		},
		planPrivateFuelDeposit: async (_claimer: unknown, amount: bigint) => {
			h.t("plan.private", amount)
			return plan(true)
		},
		sealDepositRecord: async (opts: { sign: (m: string) => Promise<string>; trusted: boolean; binding: unknown }) => {
			h.t("seal", { trusted: opts.trusted, binding: opts.binding })
			await opts.sign("seal-message")
			return { blob: "sealed-blob" }
		},
		awaitL1Receipt: async (_client: unknown, hash: string) => {
			h.t("l1.awaitReceipt", hash)
			if (h.fail.receipt) throw h.fail.receipt
			return { status: "success", logs: [] }
		},
		parseFeeJuiceDeposit: () => ({ leafIndex: 7n, amount: 1000n }),
	}
})

vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({
		getBlockNumber: async () => {
			h.t("l2.blockNumber")
			return 42n
		},
	}),
}))

vi.mock("./useBridgeJournal", () => ({
	addRecordVerified: (rec: Record<string, unknown>) => {
		h.t("journal.add", { schema: rec.schema, assetKind: rec.assetKind, secret: rec.secret, portal: rec.portal, fuel: rec.fuel })
		h.records.push({ ...rec })
	},
	markSessionLive: (id: string) => h.t("journal.live", id),
	setRecordStep: (_id: string, step?: string, detail?: string) => h.t("journal.step", { step, detail }),
	updateRecord: (id: string, patch: Record<string, unknown>) => {
		h.t("journal.update", patch)
		const rec = h.records.find((r) => r.id === id)
		if (rec) Object.assign(rec, patch)
	},
	markApproveOutcome: (_id: string, outcome: string) => h.t("journal.approveOutcome", outcome),
	cacheSecret: () => h.t("journal.cacheSecret"),
	discard: (id: string) => {
		h.t("journal.discard", id)
		h.records.splice(0, h.records.length, ...h.records.filter((r) => r.id !== id))
	},
	flagRecordError: (_id: string, note: string) => h.t("journal.flagError", note),
	runDepositClaim: async (id: string) => h.t("journal.runDepositClaim", id),
	runOnLane: (_lane: string, fn: () => Promise<unknown>) => fn(),
	useBridgeJournal: () => ({ records: { value: h.records } }),
}))
vi.mock("./useDeposit", () => ({ ensureDepositJournalDeps: () => {}, providerFingerprint: () => "fp" }))
vi.mock("./useOpsInFlight", () => ({ withOperation: (fn: () => Promise<unknown>) => fn() }))
vi.mock("./useL1Usdc", () => ({ ERC20_ABI: [] }))
vi.mock("./useL1FeeAsset", () => ({
	useL1FeeAsset: () => ({
		verifyPortalAsset: async () => {
			h.t("feeAsset.verifyPortalAsset")
			if (h.fail.verify) throw h.fail.verify
		},
	}),
}))
vi.mock("./useBridgeWallet", () => ({
	useBridgeWallet: () => ({ wallet: { value: {} }, selectedAccount: { value: h.RECIPIENT } }),
}))
vi.mock("./useL1Wallet", () => {
	const publicClient = {
		readContract: async (args: { functionName: string; address: string }) => {
			h.t("l1.read", { fn: args.functionName, address: args.address })
			if (args.functionName === "allowance") return h.allowance.value
			throw new Error(`unexpected readContract ${args.functionName}`)
		},
	}
	const walletClient = {
		signMessage: async () => {
			h.t("l1.signMessage")
			return `0x${"a".repeat(130)}`
		},
		signTypedData: async (typed: { message: { permitted: unknown; witness: unknown } }) => {
			h.t("l1.signTypedData", { permitted: typed.message.permitted, witness: typed.message.witness })
			if (h.fail.sign) throw h.fail.sign
			return `0x${"b".repeat(130)}`
		},
		writeContract: async (args: { functionName: string; address: string; args?: unknown[] }) => {
			h.t("l1.write", { fn: args.functionName, to: args.address, args: args.args })
			if (args.functionName === "approve") {
				if (h.fail.approve) throw h.fail.approve
				h.allowance.value = (1n << 256n) - 1n
				return "0xapprovetx"
			}
			if (h.fail.bridge) throw h.fail.bridge
			return "0xdeposittx"
		},
	}
	return {
		useL1Wallet: () => ({
			address: { value: h.FROM },
			publicClient,
			ensureWalletClient: () => (h.fail.noWallet ? null : walletClient),
		}),
	}
})

import { PRIVATE_FPC_ADDRESS, feeJuiceAddress } from "@nulo/bridge-core"
import { useFuelFlow } from "./useFuel"

const names = () => h.trace.map(([n]) => n)
const detailOf = (name: string, nth = 0) => h.trace.filter(([n]) => n === name)[nth]?.[1] as Record<string, unknown>
const rejection = () => Object.assign(new Error("User rejected the request"), { code: 4001 })

beforeEach(() => {
	localStorage.clear()
	h.trace.length = 0
	h.records.length = 0
	h.allowance.value = (1n << 256n) - 1n
	h.fail.noWallet = false
	h.fail.verify = null
	h.fail.approve = null
	h.fail.sign = null
	h.fail.bridge = null
	h.fail.receipt = null
})
afterEach(() => {
	vi.restoreAllMocks()
})

const PUBLIC_TRACE_ALREADY_APPROVED = [
	"feeAsset.verifyPortalAsset",
	"plan.public",
	"journal.add",
	"journal.live",
	"onRecord",
	"l1.read",
	"journal.step",
	"l1.signTypedData",
	"journal.step",
	"l1.write",
	"journal.update",
	"journal.step",
	"l1.awaitReceipt",
	"l2.blockNumber",
	"journal.update",
	"journal.step",
	"journal.runDepositClaim",
]

describe("useFuelFlow().deposit — characterization traces", () => {
	test("PUBLIC, Permit2 already approved: exact call order, record shape, journal patches", async () => {
		const flow = useFuelFlow()
		const id = await flow.deposit(1000n, false, { onRecord: (rid) => h.t("onRecord", rid) })
		expect(id).toBe(h.SECRET_HASH)
		expect(names()).toEqual(PUBLIC_TRACE_ALREADY_APPROVED)
		expect(detailOf("journal.add")).toEqual({
			schema: 2,
			assetKind: "fee-juice",
			secret: "0xsecret",
			portal: h.FUEL_PORTAL,
			fuel: { amount: "1000", secret: "0xsecret", secretHashHex: h.SECRET_HASH, minOutput: "0" },
		})
		expect(h.records[0]?.bridge).toBe(feeJuiceAddress)
		expect(detailOf("journal.step", 0)).toEqual({
			step: "signing",
			detail: "sign the Fuel deposit in your Ethereum wallet - one signature",
		})
		expect(detailOf("journal.step", 1)).toEqual({ step: "depositing", detail: "confirm the Fuel deposit in your Ethereum wallet" })
		expect(detailOf("journal.update", 0)).toEqual({ depositTxHash: "0xdeposittx" })
		expect(detailOf("journal.step", 2)).toEqual({ step: "depositing", detail: "waiting for the Ethereum confirmation" })
		expect(detailOf("l1.awaitReceipt")).toBe("0xdeposittx")
		expect(detailOf("journal.update", 1)).toEqual({
			leafIndex: "7",
			depositL2Block: 42,
			fuel: { amount: "1000", secret: "0xsecret", secretHashHex: h.SECRET_HASH, minOutput: "0", received: "1000", leafIndex: "7" },
		})
		expect(detailOf("journal.step", 3)).toEqual({ step: undefined, detail: undefined })
		expect(flow.busy.value).toBe(false)
		expect(flow.error.value).toBeNull()
	})

	test("token identity: allowance read, approve write, typed data (permitted + witness) and router calldata all name the fee asset", async () => {
		h.allowance.value = 0n
		const flow = useFuelFlow()
		await flow.deposit(1000n, false)
		expect(detailOf("l1.read")).toEqual({ fn: "allowance", address: h.FUEL_ASSET })
		expect(detailOf("l1.write", 0)).toMatchObject({ fn: "approve", to: h.FUEL_ASSET, args: [h.PERMIT2, (1n << 256n) - 1n] })
		const typed = detailOf("l1.signTypedData") as { permitted: { token: string; amount: bigint }; witness: Record<string, unknown> }
		expect(typed.permitted).toEqual({ token: h.FUEL_ASSET, amount: 1000n })
		expect(typed.witness).toMatchObject({
			tokenPortal: h.FUEL_PORTAL,
			bridgeToken: h.FUEL_ASSET,
			totalAmount: 1000n,
			fuelAmount: 0n,
			aztecRecipient: h.RECIPIENT,
			tokenSecretHash: h.SECRET_HASH,
			isPrivate: false,
			swapTarget: h.SWAP_TARGET,
		})
		const bridge = detailOf("l1.write", 1) as { fn: string; to: string; args: [Record<string, unknown>, Record<string, unknown>] }
		expect(bridge.fn).toBe("bridge")
		expect(bridge.to).toBe(h.ROUTER)
		expect(bridge.args[0]).toEqual({
			tokenPortal: h.FUEL_PORTAL,
			bridgeToken: h.FUEL_ASSET,
			amount: 1000n,
			aztecRecipient: h.RECIPIENT,
			secretHash: h.SECRET_HASH,
			isPrivate: false,
		})
		// The approval leg journals its hash and outcome BEFORE the signing prompt.
		const n = names()
		expect(n.indexOf("journal.approveOutcome")).toBeLessThan(n.indexOf("l1.signTypedData"))
		expect(
			h.trace.some(([name, d]) => name === "journal.update" && (d as { approveTxHash?: string }).approveTxHash === "0xapprovetx"),
		).toBe(true)
	})

	test("PRIVATE: seal between record creation and the Permit2 leg; salt + FPC in the fuel block; no top-level secret", async () => {
		const flow = useFuelFlow()
		await flow.deposit(1000n, true)
		const n = names()
		expect(n.slice(0, 5)).toEqual(["feeAsset.verifyPortalAsset", "plan.private", "journal.add", "journal.live", "journal.step"])
		expect(detailOf("journal.step", 0)).toEqual({ step: "sealing", detail: "two Ethereum signatures - encrypt + verify" })
		expect(n.indexOf("seal")).toBeLessThan(n.indexOf("l1.read"))
		expect(n.slice(n.indexOf("seal"), n.indexOf("seal") + 4)).toEqual([
			"seal",
			"l1.signMessage",
			"journal.cacheSecret",
			"journal.update",
		])
		expect(detailOf("journal.update", 0)).toEqual({ sealedEnvelope: "sealed-blob", sealerL1: h.FROM })
		expect(detailOf("journal.add")).toMatchObject({
			secret: undefined,
			fuel: { minOutput: "0", bridgeSecretSalt: "0xsalt", fpc: PRIVATE_FPC_ADDRESS },
		})
		expect(detailOf("seal")).toEqual({
			trusted: false,
			binding: { chainId: expect.any(Number), portal: h.FUEL_PORTAL, bridge: feeJuiceAddress, secretHashHex: h.SECRET_HASH },
		})
		// Second private deposit from the same wallet: the seal trust is remembered.
		h.trace.length = 0
		await flow.deposit(1000n, true)
		expect(detailOf("journal.step", 0)).toEqual({ step: "sealing", detail: "one Ethereum signature - encrypts the recovery salt" })
		expect(detailOf("seal")).toMatchObject({ trusted: true })
	})
})

describe("useFuelFlow().deposit — failure classification", () => {
	test("preconditions: no Ethereum wallet → message, null, no record", async () => {
		h.fail.noWallet = true
		const flow = useFuelFlow()
		expect(await flow.deposit(1000n)).toBeNull()
		expect(flow.error.value).toBe("Connect your Ethereum wallet first.")
		expect(names()).toEqual([])
		expect(flow.busy.value).toBe(false)
	})

	test("failure before any record (portal/asset check): humanized error, no journal writes", async () => {
		h.fail.verify = new Error("Fuel portal/asset mismatch")
		const flow = useFuelFlow()
		expect(await flow.deposit(1000n)).toBeNull()
		expect(flow.error.value).toMatch(/mismatch/)
		expect(names()).toEqual(["feeAsset.verifyPortalAsset"])
		expect(flow.busy.value).toBe(false)
	})

	test("rejection BEFORE the approval mined: record discarded, plain rejection message", async () => {
		h.allowance.value = 0n
		h.fail.approve = rejection()
		const flow = useFuelFlow()
		expect(await flow.deposit(1000n)).toBe(h.SECRET_HASH)
		expect(names()).toContain("journal.discard")
		expect(names()).not.toContain("journal.flagError")
		expect(flow.error.value).toBe("Rejected in your wallet - nothing was sent.")
		expect(h.records).toEqual([])
		expect(flow.busy.value).toBe(false)
	})

	test("rejection AFTER the approval mined: record discarded, the standing-allowance message", async () => {
		h.allowance.value = 0n
		h.fail.sign = rejection()
		const flow = useFuelFlow()
		await flow.deposit(1000n)
		expect(names()).toContain("journal.discard")
		expect(flow.error.value).toBe(
			"Rejected in your wallet - nothing was bridged. The one-time Permit2 approval from this attempt remains active (only your signature can use it; revocable anytime).",
		)
		expect(flow.busy.value).toBe(false)
	})

	test("ambiguous failure (deposit write throws): record flagged, never discarded", async () => {
		h.fail.bridge = new Error("insufficient funds for gas")
		const flow = useFuelFlow()
		await flow.deposit(1000n)
		expect(names()).not.toContain("journal.discard")
		expect(detailOf("journal.flagError")).toMatch(/\. Your funds are not lost - this bridge stays in Pending\.$/)
		expect(flow.error.value).toBeTruthy()
		expect(h.records).toHaveLength(1)
		expect(flow.busy.value).toBe(false)
	})

	test("rejection AFTER depositTxHash exists is NOT a discard: the record is flagged", async () => {
		h.fail.receipt = rejection()
		const flow = useFuelFlow()
		await flow.deposit(1000n)
		expect(names()).not.toContain("journal.discard")
		expect(names()).toContain("journal.flagError")
		expect(h.records[0]?.depositTxHash).toBe("0xdeposittx")
		expect(flow.busy.value).toBe(false)
	})
})
