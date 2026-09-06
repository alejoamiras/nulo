/**
 * @vitest-environment node
 *
 * Node, not jsdom: the exit path builds real Aztec field elements and addresses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ExitPlan, ResolvedToken } from "@/lib/send-model"

const EXIT_TX = `0x${"1e".repeat(32)}`

const h = vi.hoisted(() => ({
	// Field elements, so the leading nibble keeps them under the modulus.
	HUB_ADDR: `0x0${"b".repeat(63)}`,
	L2_TOKEN: `0x0${"c".repeat(63)}`,
	FACTORY: "0x5eb3bc0a489c5a8288765d2336659ebca68fcd00",
	IMPLEMENTATION: "0xc95ff0608561b6ba084c78d14f09e9826190f968",
	FJ_PORTAL: "0xfd05ee8687d4ca828ba3d26ef04b80dd1348e5bd",
	withdrawsPaused: false,
	exitsPaused: vi.fn(async () => false),
	/** Ordered log of every chain-touching step, so the authwit/simulate/send sequence is assertable. */
	order: [] as string[],
	publicBalance: 5_000_000_000n,
	privateBalance: 5_000_000_000n,
	/** The credit at the PrivateFPC when it must differ from the token balance the same stub serves. */
	fpcCredit: undefined as bigint | undefined,
	hubBinding: { value: undefined as string | undefined },
	assertL1Chain: vi.fn(async (_l1: unknown) => {}),
	isGranted: vi.fn((_l2Token: string) => true),
	outboxConsumed: vi.fn(async () => false),
	preflightHubExit: vi.fn(async (_hub: unknown, _p: unknown, _from: string, _opts?: Record<string, unknown>) => {}),
	exitViaHub: vi.fn(async (_hub: unknown, _p: unknown, _opts: Record<string, unknown>) => ({
		receipt: { txHash: EXIT_TX, blockNumber: 42 },
	})),
	consumeWithdrawal: vi.fn(
		async (_l1: unknown, _node: unknown, _receipt: unknown, _p: { portal: string; recipientL1: string; amount: bigint }) => ({
			consumeTxHash: "0xconsume",
		}),
	),
	createPublicAuthwit: vi.fn(async (_w: unknown, _from: unknown, _intent: { caller: { toString(): string } }, _pub: boolean) => ({
		send: vi.fn(async () => ({})),
	})),
	createAuthWit: vi.fn(async () => "0xwitness"),
	burnPublic: vi.fn(() => ({ kind: "burn_public" })),
	burnPrivate: vi.fn(() => ({ getFunctionCall: async () => ({ kind: "burn_private" }) })),
	selectedAccount: { value: "0x1018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d" as string | null },
	address: { value: "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d" as string | null },
}))

vi.mock("@/contracts/bridge-generation", () => ({
	HUB: { toString: () => h.HUB_ADDR },
	SEND_GENERATION: { factory: h.FACTORY, implementation: h.IMPLEMENTATION },
	TOKEN_CLASS_ID: `0x${"a".repeat(64)}`,
	FUEL_PORTAL: h.FJ_PORTAL,
	MANIFEST_TOKENS: [],
	IS_PLACEHOLDER: false,
	rebuildHubTokenInstance: vi.fn(async () => ({ address: { toString: () => h.L2_TOKEN } })),
}))

vi.mock("@nulo/bridge-core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@nulo/bridge-core")>()),
	hubAt: () => ({ address: h.HUB_ADDR }),
	hubExitsPaused: h.exitsPaused,
	hubTokenFor: async () => h.hubBinding.value,
	preflightHubExit: h.preflightHubExit,
	exitViaHub: h.exitViaHub,
	consumeWithdrawal: h.consumeWithdrawal,
	isOutboxMessageConsumed: h.outboxConsumed,
	awaitL1Receipt: async () => ({ status: "success" }),
}))

// The Token the burn spends: the two balance reads the preflight makes, plus the two burn calls the
// authwit is built over.
vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: {
		at: async () => ({
			methods: {
				burn_public: h.burnPublic,
				burn_private: h.burnPrivate,
				balance_of_public: () => ({ simulate: async () => ({ result: h.publicBalance }) }),
				balance_of_private: () => ({ request: async () => ({ calls: [{ kind: "balance_of_private" }] }) }),
			},
		}),
	},
}))

vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({ TokenContractArtifact: { name: "Token" } }))

vi.mock("@aztec/aztec.js/authorization", () => ({
	SetPublicAuthwitContractInteraction: { create: h.createPublicAuthwit },
}))

vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({
		getTxReceipt: async () => ({ blockNumber: 42 }),
		getBlockNumber: async () => 40,
		// Predicted worst fees, so a private exit's ceiling is priced without a network.
		getCurrentMinFees: async () => ({ feePerDaGas: 10n, feePerL2Gas: 20n }),
	}),
}))
vi.mock("@aztec/stdlib/messaging", () => ({ computeL2ToL1MembershipWitness: async () => undefined }))
vi.mock("@aztec/ethereum/contracts", () => ({ OutboxContract: class {} }))

vi.mock("@/composables/useWalletConnection", () => ({
	requestHubToken: vi.fn(),
	useWalletConnection: () => ({
		status: { value: "connected" },
		selectedAccount: h.selectedAccount,
		wallet: { value: { createAuthWit: h.createAuthWit, executeUtility: async () => ({ result: [h.privateBalance] }) } },
	}),
	__resetWalletConnectionForTests: () => {},
}))

vi.mock("@/composables/useTokenGrant", () => ({ useTokenGrant: () => ({ isGranted: h.isGranted }) }))

// The private exit's fee reads the account's credit at the PrivateFPC: the harness's private balance
// unless a case pins the credit apart from it.
vi.mock("./deposit-flow", () => ({
	readPrivateFeeJuiceBalance: async () => h.fpcCredit ?? h.privateBalance,
	readFeeJuiceOrNull: async (_label: string, read: () => Promise<bigint>) => {
		try {
			return await read()
		} catch {
			return null
		}
	},
}))

vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({
		address: h.address,
		publicClient: {
			readContract: async () => {
				h.order.push("pauses")
				return h.withdrawsPaused
			},
			getTransaction: async () => null,
		},
		ensureWalletClient: () => ({ writeContract: async () => "0xl1" }),
	}),
}))

// useSend only contributes the generation binding, the block check and the chain guard here; its own
// chain wiring must not run, so the modules it would reach for are stubbed at the composable boundary.
vi.mock("@/composables/useSend", () => ({
	assertL1Chain: h.assertL1Chain,
	sendBindingOf: () => ({ factory: h.FACTORY, implementation: h.IMPLEMENTATION, hub: h.HUB_ADDR, feeJuicePortal: h.FJ_PORTAL }),
	validateTokenBlock: vi.fn(async () => null),
}))

import { type SendWithdrawRecord, validateAnyBackupRecord } from "@nulo/bridge-core"
import { __resetJournalForTests, connectJournalDeps, runWithdrawConsume, useBridgeJournal } from "./useBridgeJournal"
import { __resetOpsInFlightForTests, useOpsInFlight } from "./useOpsInFlight"
import { __resetHubExitDepsForTests, buildExitSendOpts, useHubExit } from "./useHubExit"

const HUB_ADDR = h.HUB_ADDR
const L2_TOKEN = h.L2_TOKEN
const FROM = "0x1018808f2c17794badb361c02c945582b8198b495a7e8d01154f7eeb7d719c0d"
const L1_ACCOUNT = "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"
const ERC20 = "0x70e0ba845a1a0f2da3359c97e0285013525ffc49"
const PORTAL = "0x94752ef7cf8f037f78ee7722a9387ef95c819fc8"

const registration = {
	portal: PORTAL as `0x${string}`,
	decimals: 6,
	registerIndex: 3n,
	nameWord: `0x${"1".repeat(64)}` as `0x${string}`,
	symbolWord: `0x${"2".repeat(64)}` as `0x${string}`,
	registerKey: `0x${"4".repeat(64)}` as `0x${string}`,
}

const token: ResolvedToken = {
	chainId: 11155111,
	address: ERC20,
	symbol: "USDC",
	name: "Nulo USDC",
	decimals: 6,
	source: "manifest",
	logoKey: `1:${ERC20}`,
	// Only a hub-registered token can be exited: the hub burns through its own binding.
	state: { kind: "registered", registration, l2Token: L2_TOKEN as `0x${string}` },
	portal: PORTAL,
	words: { nameWord: registration.nameWord, symbolWord: registration.symbolWord },
	l2Token: L2_TOKEN as `0x${string}`,
	registration,
}

const plan = (over: Partial<ExitPlan> = {}): ExitPlan => ({
	direction: "l2-to-l1",
	token,
	amount: 40_000_000n,
	isPrivate: false,
	recipientL1: L1_ACCOUNT,
	...over,
})

const recordOf = (id: string) => useBridgeJournal().records.value.find((r) => r.id === id) as SendWithdrawRecord | undefined

describe("useHubExit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		__resetJournalForTests()
		__resetHubExitDepsForTests()
		__resetOpsInFlightForTests()
		h.withdrawsPaused = false
		h.order = []
		h.publicBalance = 5_000_000_000n
		h.privateBalance = 5_000_000_000n
		h.fpcCredit = undefined
		h.hubBinding.value = L2_TOKEN
		h.exitsPaused.mockImplementation(async () => false)
		h.assertL1Chain.mockImplementation(async () => {})
		h.isGranted.mockImplementation(() => true)
		h.outboxConsumed.mockImplementation(async () => false)
		h.consumeWithdrawal.mockImplementation(async () => ({ consumeTxHash: "0xconsume" }))
		h.createPublicAuthwit.mockImplementation(async () => ({
			send: vi.fn(async () => {
				h.order.push("authwit")
				return {}
			}),
		}))
		h.preflightHubExit.mockImplementation(async () => {
			// The Token refuses a PUBLIC burn it has no authwit for; the simulate is what proves it took.
			if (!h.order.includes("authwit") && !h.order.includes("witness")) throw new Error("Assertion failed: unauthorized")
			h.order.push("simulate")
		})
		h.createAuthWit.mockImplementation(async () => {
			h.order.push("witness")
			return "0xwitness"
		})
		h.exitViaHub.mockImplementation(async () => {
			h.order.push("exit")
			return { receipt: { txHash: EXIT_TX, blockNumber: 42 } }
		})
		h.selectedAccount.value = FROM
		h.address.value = L1_ACCOUNT
		connectJournalDeps({ now: () => 999, waitConsumeReceipt: async () => true })
	})

	it("an L1 withdraw pause refuses by name, before any authwit and with no record written", async () => {
		h.withdrawsPaused = true
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.paused.value).toBe("l1")
		expect(exit.error.value).toBeNull()
		expect(h.createPublicAuthwit).not.toHaveBeenCalled()
		expect(h.exitViaHub).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})

	it("an L2 exit pause refuses the same way, with its own copy", async () => {
		h.exitsPaused.mockImplementation(async () => true)
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.paused.value).toBe("l2")
		expect(exit.error.value).toBeNull()
		expect(h.exitViaHub).not.toHaveBeenCalled()
	})

	it("a balance too small for the burn refuses read-only, before any authwit and with no record", async () => {
		h.publicBalance = 1n
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/balance is smaller/)
		expect(h.createPublicAuthwit).not.toHaveBeenCalled()
		expect(h.preflightHubExit).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})

	it("a token the HUB has no binding for refuses read-only, whatever the screen said", async () => {
		h.hubBinding.value = undefined
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/hasn't registered this token on Aztec/)
		expect(h.createPublicAuthwit).not.toHaveBeenCalled()
		expect(h.exitViaHub).not.toHaveBeenCalled()
	})

	it("a hub binding naming ANOTHER Aztec token refuses - the burn would spend the wrong asset", async () => {
		h.hubBinding.value = `0x0${"d".repeat(63)}`
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/different Aztec token/)
		expect(h.exitViaHub).not.toHaveBeenCalled()
	})

	it("a PUBLIC exit sends the burn authwit BEFORE the simulate the Token would otherwise refuse", async () => {
		const exit = useHubExit()
		const id = await exit.exit(plan())
		expect(id).toBe(EXIT_TX)
		// The simulate fake accepts only once the authwit tx landed - so this order IS the assertion.
		expect(h.order).toEqual(["pauses", "authwit", "simulate", "exit"])
		expect(h.createPublicAuthwit).toHaveBeenCalledTimes(1)
		expect(h.createAuthWit).not.toHaveBeenCalled()
		expect(h.burnPublic).toHaveBeenCalledWith(expect.anything(), 40_000_000n, expect.anything())
		const authwitIntent = h.createPublicAuthwit.mock.calls[0][2] as { caller: { toString(): string } }
		expect(authwitIntent.caller.toString()).toBe(HUB_ADDR)
	})

	it("a private exit carries an off-chain burn witness instead - no extra Aztec transaction", async () => {
		const exit = useHubExit()
		await exit.exit(plan({ isPrivate: true }))
		expect(h.order).toEqual(["pauses", "witness", "simulate", "exit"])
		expect(h.createAuthWit).toHaveBeenCalledTimes(1)
		expect(h.createPublicAuthwit).not.toHaveBeenCalled()
		// The witness the simulate ran against is the one the send spends - built once.
		expect(h.preflightHubExit).toHaveBeenCalledTimes(1)
		expect((h.preflightHubExit.mock.calls[0][3] as { authWitnesses?: unknown[] }).authWitnesses).toEqual(["0xwitness"])
		const extra = h.exitViaHub.mock.calls[0][2] as { authWitnesses?: unknown[] }
		expect(extra.authWitnesses).toEqual(["0xwitness"])
	})

	it("the exit records the writers produce are records the backup validator accepts", async () => {
		const exit = useHubExit()
		const publicId = await exit.exit(plan())
		expect(() => validateAnyBackupRecord(recordOf(publicId) as never)).not.toThrow()
		// The consume leg's own fields are written onto the same record.
		await runWithdrawConsume(publicId)
		const consumed = recordOf(publicId)
		expect([consumed?.exitBlock, consumed?.consumeTxHash, consumed?.completedAt]).toEqual([42, "0xconsume", 999])
		expect(() => validateAnyBackupRecord(consumed as never)).not.toThrow()

		__resetJournalForTests()
		connectJournalDeps({ now: () => 999, waitConsumeReceipt: async () => true })
		const privateId = await exit.exit(plan({ isPrivate: true }))
		expect(() => validateAnyBackupRecord(recordOf(privateId) as never)).not.toThrow()
	})

	it("a failing PRIVATE simulate surfaces before the exit is sent, and writes no record", async () => {
		h.preflightHubExit.mockImplementation(async () => {
			throw new Error("Assertion failed: note not found")
		})
		const exit = useHubExit()
		expect(await exit.exit(plan({ isPrivate: true }))).toBe("")
		expect(exit.error.value).toMatch(/note not found/)
		expect(h.exitViaHub).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})

	it("an ungranted token is refused by name, before anything is authorised", async () => {
		h.isGranted.mockImplementation(() => false)
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/hasn't granted access to this token/)
		expect(h.assertL1Chain).not.toHaveBeenCalled()
		expect(h.createPublicAuthwit).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})

	it("an L1 client on another chain refuses before any pause or portal state is read", async () => {
		h.assertL1Chain.mockImplementation(async () => {
			throw new Error("Your Ethereum wallet is on chain 1, but this bridge lives on chain 11155111.")
		})
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/on chain 1/)
		expect(h.order).toEqual([])
		expect(h.exitsPaused).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})

	it("a consume that fails on an already-consumed message completes the record instead of retrying", async () => {
		h.consumeWithdrawal.mockImplementation(async () => {
			throw new Error("execution reverted: Outbox__AlreadyNullified")
		})
		h.outboxConsumed.mockImplementation(async () => true)
		const exit = useHubExit()
		const id = await exit.exit(plan())
		const rec = recordOf(id) as SendWithdrawRecord
		expect(rec.consumedByOther).toBe(true)
		expect(rec.completedAt).toBe(999)
		expect(rec.consumeTxHash).toBeUndefined()
		expect(useBridgeJournal().runtime.value[id]?.attention).toBeUndefined()
	})

	it("a consume failure on a message NOBODY consumed still surfaces as the failure it is", async () => {
		h.consumeWithdrawal.mockImplementation(async () => {
			throw new Error("execution reverted: nonsense")
		})
		const exit = useHubExit()
		const id = await exit.exit(plan())
		expect(recordOf(id)?.completedAt).toBeUndefined()
		expect(useBridgeJournal().runtime.value[id]?.attention).toBe("error")
	})

	it.each([
		["portal-only", { kind: "portal-only", registration } as const],
		["first-time", { kind: "first-time" } as const],
	])("a %s token is refused: the hub holds no binding it could burn", async (_label, state) => {
		const exit = useHubExit()
		expect(await exit.exit(plan({ token: { ...token, state } }))).toBe("")
		expect(exit.error.value).toMatch(/hasn't registered this token on Aztec/)
		expect(h.createAuthWit).not.toHaveBeenCalled()
		expect(h.createPublicAuthwit).not.toHaveBeenCalled()
		expect(h.preflightHubExit).not.toHaveBeenCalled()
		expect(h.exitViaHub).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})

	it("a public exit never carries an app-set fee", async () => {
		const exit = useHubExit()
		await exit.exit(plan())
		const opts = h.exitViaHub.mock.calls[0][2] as Record<string, unknown>
		expect("fee" in opts).toBe(false)
		expect(opts.paymentMethod).toBeUndefined()
		expect("fee" in buildExitSendOpts(undefined as never)).toBe(false)
	})

	// The PrivateFPC's `getFeeLimit` over the exit's limits at the mocked fees:
	// 100_000·10 + 2_000_000·20 = 41_000_000.
	const EXIT_CEILING = 41_000_000n

	it("a private exit names the PrivateFPC as payer, from the credit the account holds, at the committed ceiling", async () => {
		h.privateBalance = EXIT_CEILING
		const exit = useHubExit()
		const id = await exit.exit(plan({ isPrivate: true }))
		expect(id).toBe(EXIT_TX)
		const opts = h.exitViaHub.mock.calls[0][2] as { fee?: { paymentMethod: unknown; gasSettings: Record<string, unknown> } }
		expect(opts.fee?.paymentMethod).toBeDefined()
		expect(opts.fee?.gasSettings).toEqual({
			gasLimits: { daGas: 100_000, l2Gas: 2_000_000 },
			teardownGasLimits: { daGas: 0, l2Gas: 0 },
			maxFeesPerGas: { feePerDaGas: 10n, feePerL2Gas: 20n },
		})
		// The simulate that proves the witness carries the same payer: it must not dry-run under a public one.
		const sim = h.preflightHubExit.mock.calls[0][3] as { fee?: unknown }
		expect(sim.fee).toBe(opts.fee)
	})

	it("a private exit short of private gas is refused before any authwit, opens no record, and says why", async () => {
		h.privateBalance = EXIT_CEILING - 1n
		const exit = useHubExit()
		expect(await exit.exit(plan({ isPrivate: true }))).toBe("")
		expect(exit.error.value).toMatch(/private gas is under/)
		expect(h.createAuthWit).not.toHaveBeenCalled()
		expect(h.preflightHubExit).not.toHaveBeenCalled()
		expect(h.exitViaHub).not.toHaveBeenCalled()
		expect(useBridgeJournal().records.value).toHaveLength(0)
		h.privateBalance = 5_000_000_000n
		h.fpcCredit = 0n
		expect(await exit.exit(plan({ isPrivate: true }))).toBe("")
		expect(exit.error.value).toMatch(/only from private gas.*link your account/)
	})

	it("journals a schema-3 exit bound to THIS token's clone and the hub, keyed by its exit tx", async () => {
		const exit = useHubExit()
		const id = await exit.exit(plan())
		const rec = recordOf(id) as SendWithdrawRecord
		expect(rec.schema).toBe(3)
		expect(rec.intent).toBe("token")
		expect(rec.token.portal).toBe(PORTAL)
		expect(rec.token.registerIndex).toBe("3")
		expect(rec.portal).toBe(PORTAL)
		expect(rec.bridge).toBe(HUB_ADDR)
		expect(rec.recipientL1).toBe(L1_ACCOUNT)
		expect(rec.exitTxHash).toBe(EXIT_TX)
		// The provisional record is gone - the exit tx names it now.
		expect(useBridgeJournal().records.value).toHaveLength(1)
	})

	it("finishes on L1 through the record's OWN portal clone", async () => {
		const exit = useHubExit()
		await exit.exit(plan())
		expect(h.consumeWithdrawal).toHaveBeenCalledTimes(1)
		const params = h.consumeWithdrawal.mock.calls[0][3] as { portal: string; recipientL1: string; amount: bigint }
		expect(params.portal).toBe(PORTAL)
		expect(params.recipientL1).toBe(L1_ACCOUNT)
		expect(params.amount).toBe(40_000_000n)
	})

	it("a token with no frozen registration is refused - nothing a resume could validate", async () => {
		const exit = useHubExit()
		expect(await exit.exit(plan({ token: { ...token, registration: undefined } }))).toBe("")
		expect(exit.error.value).toMatch(/no registration/)
		expect(h.exitViaHub).not.toHaveBeenCalled()
	})

	it("refuses without a connected wallet on either side", async () => {
		h.selectedAccount.value = null
		const exit = useHubExit()
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/Aztec wallet/)
		h.selectedAccount.value = FROM
		h.address.value = null
		expect(await exit.exit(plan())).toBe("")
		expect(exit.error.value).toMatch(/Ethereum wallet/)
	})

	it("runs inside a tracked operation span and clears busy afterwards", async () => {
		const exit = useHubExit()
		const { busy } = useOpsInFlight()
		let inFlight = false
		h.exitViaHub.mockImplementation(async () => {
			inFlight = busy.value && exit.busy.value
			return { receipt: { txHash: EXIT_TX, blockNumber: 42 } }
		})
		await exit.exit(plan())
		expect(inFlight).toBe(true)
		expect(busy.value).toBe(false)
		expect(exit.busy.value).toBe(false)
	})

	it("dispose stops the composable from starting anything new", async () => {
		const exit = useHubExit()
		exit.dispose()
		expect(await exit.exit(plan())).toBe("")
		expect(h.exitViaHub).not.toHaveBeenCalled()
	})
})
