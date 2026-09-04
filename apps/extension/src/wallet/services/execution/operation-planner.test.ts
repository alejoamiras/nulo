/**
 * Unit tests for `OperationPlanner`.
 *
 * Uses fake ProfileService + TokenService — no chrome.*, no real PXE, no
 * real Aztec crypto. Exercises: buildTransferOperation happy path per
 * transfer type, wallet-lock throw, unsupported transfer type,
 * processAztecJsPayload action normalization, extractPrimaryMethod shape
 * (including the FEE_METHODS-filtered drip regression — see the dedicated
 * describe block at the bottom).
 */

import { describe, expect, test, vi } from "vitest"
import type { ExecutionPayload } from "@aztec/stdlib/tx"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { TokenService, Token } from "@/wallet/services/token/service"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { TransferType } from "@/wallet/services/transaction/spec"
import type { AztecSendTxOperation, Operation, SendTransactionOperation } from "./spec"

// Stub the transfer-function factories — their real implementations call
// Barretenberg WASM (poseidon2 selectors) which isn't available under
// vitest/jsdom. The planner's contract under test is "pick the right fn
// by TransferType + build the op shape"; the fn internals aren't ours.
vi.mock("@/wallet/services/token/functions", () => {
	// The planner builds args via `createTokenFn(TOKEN_FN_DESCRIPTORS.<kind>, name, impl).buildArgs(...)`.
	// Fake it — the real factory calls Barretenberg WASM (poseidon2 selectors), unavailable under
	// vitest/jsdom. The planner's contract under test is "pick the right kind + build the op shape".
	const fakeFn = (fnName: string) => ({
		name: fnName,
		type: "private",
		isStatic: false,
		buildArgs: (..._args: unknown[]) => ["arg0", "arg1", "arg2"],
		getSelector: async () => ({ toString: () => `selector:${fnName}` }),
		encodeArgs: (_args: unknown[]) => [{ toString: () => "encoded" }],
	})
	return {
		createTokenFn: (_descriptor: unknown, name: string, _impl: unknown) => fakeFn(name),
		TOKEN_FN_DESCRIPTORS: {
			transferPrivate: { kind: "transferPrivate" },
			transferPrivateToPublic: { kind: "transferPrivateToPublic" },
			transferPublic: { kind: "transferPublic" },
			transferPublicToPrivate: { kind: "transferPublicToPrivate" },
		},
	}
})

const { OperationPlanner } = await import("./operation-planner")

const DEFAULT_FEE_SETTINGS = {
	paymentMethod: { kind: "fj" as const },
	priorityLevel: "normal" as const,
}

function makeProfile(returnsActive = true): ProfileService {
	return {
		getActiveProfile: vi.fn(async () => (returnsActive ? { id: "pid", name: "P", type: "password" } : undefined)),
	} as unknown as ProfileService
}

function makeToken(overrides: Partial<Token> = {}): Token {
	return {
		id: 1,
		profileId: "pid",
		chainId: 1,
		contract: "0x1234",
		name: "Nulo",
		symbol: "NULO",
		decimals: 18,
		transferPublicFn: { name: "transfer_in_public", impl: 0 },
		transferPrivateFn: { name: "transfer_in_private", impl: 0 },
		transferPrivateToPublicFn: { name: "transfer_private_to_public", impl: 0 },
		transferPublicToPrivateFn: { name: "transfer_public_to_private", impl: 0 },
		...overrides,
	}
}

function makeTokenService(token: Token): TokenService {
	return {
		getTokenRaw: vi.fn(async () => token),
	} as unknown as TokenService
}

describe("OperationPlanner.buildTransferOperation", () => {
	test("builds a SendTransactionOperation for TransferType.Public", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const { op, token, fn, args } = await planner.buildTransferOperation({
			networkId: "net-1",
			accountAddress: "0xabc",
			tokenId: 1,
			transferType: TransferType.Public,
			recipientAddress: "0xdef",
			amount: 100n,
			feeSettings: DEFAULT_FEE_SETTINGS,
		})
		expect(op.kind).toBe("send_transaction")
		expect(op.networkId).toBe("net-1")
		expect(op.accountAddress).toBe("0xabc")
		expect(op.feeSettings).toEqual(DEFAULT_FEE_SETTINGS)
		expect(op.actions).toHaveLength(1)
		expect(op.actions[0].kind).toBe("encoded_call")
		expect(op.actions[0]).toMatchObject({ to: token.contract, name: fn.name })
		expect(args).toBeDefined()
	})

	test("builds a SendTransactionOperation for TransferType.Private", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const { op } = await planner.buildTransferOperation({
			networkId: "net-1",
			accountAddress: "0xa",
			tokenId: 1,
			transferType: TransferType.Private,
			recipientAddress: "0xb",
			amount: 1n,
			feeSettings: DEFAULT_FEE_SETTINGS,
		})
		expect(op.actions[0].kind).toBe("encoded_call")
	})

	test("builds a SendTransactionOperation for TransferType.PrivateToPublic", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const { op } = await planner.buildTransferOperation({
			networkId: "n",
			accountAddress: "0xa",
			tokenId: 1,
			transferType: TransferType.PrivateToPublic,
			recipientAddress: "0xb",
			amount: 1n,
			feeSettings: DEFAULT_FEE_SETTINGS,
		})
		expect(op.actions[0].kind).toBe("encoded_call")
	})

	test("builds a SendTransactionOperation for TransferType.PublicToPrivate", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const { op } = await planner.buildTransferOperation({
			networkId: "n",
			accountAddress: "0xa",
			tokenId: 1,
			transferType: TransferType.PublicToPrivate,
			recipientAddress: "0xb",
			amount: 1n,
			feeSettings: DEFAULT_FEE_SETTINGS,
		})
		expect(op.actions[0].kind).toBe("encoded_call")
	})

	test("throws 'Unauthorized' when no active profile", async () => {
		const planner = new OperationPlanner(makeProfile(false), makeTokenService(makeToken()))
		await expect(
			planner.buildTransferOperation({
				networkId: "n",
				accountAddress: "0xa",
				tokenId: 1,
				transferType: TransferType.Public,
				recipientAddress: "0xb",
				amount: 1n,
				feeSettings: DEFAULT_FEE_SETTINGS,
			}),
		).rejects.toThrow(/Unauthorized/)
	})

	test("throws 'Transfer type not supported' when token missing private fn", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken({ transferPrivateFn: undefined })))
		await expect(
			planner.buildTransferOperation({
				networkId: "n",
				accountAddress: "0xa",
				tokenId: 1,
				transferType: TransferType.Private,
				recipientAddress: "0xb",
				amount: 1n,
				feeSettings: DEFAULT_FEE_SETTINGS,
			}),
		).rejects.toThrow(/Transfer type not supported/)
	})

	test("throws 'Transfer type not supported' when token missing public-to-private fn", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken({ transferPublicToPrivateFn: undefined })))
		await expect(
			planner.buildTransferOperation({
				networkId: "n",
				accountAddress: "0xa",
				tokenId: 1,
				transferType: TransferType.PublicToPrivate,
				recipientAddress: "0xb",
				amount: 1n,
				feeSettings: DEFAULT_FEE_SETTINGS,
			}),
		).rejects.toThrow(/Transfer type not supported/)
	})

	test("throws 'Invalid transfer type' for an unknown enum value", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		await expect(
			planner.buildTransferOperation({
				networkId: "n",
				accountAddress: "0xa",
				tokenId: 1,
				transferType: 99 as TransferType,
				recipientAddress: "0xb",
				amount: 1n,
				feeSettings: DEFAULT_FEE_SETTINGS,
			}),
		).rejects.toThrow(/Invalid transfer type/)
	})
})

describe("OperationPlanner.processAztecJsPayload", () => {
	test("returns empty actions + AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE for a minimal ExecutionPayload", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const exec = { calls: [], authWitnesses: [], capsules: [], extraHashedArgs: [] } as unknown as ExecutionPayload
		const { actions, feePaymentMethod: method, feeOptions } = await planner.processAztecJsPayload(exec, {} as never)
		expect(actions).toEqual([])
		// No feePayer → detectEmbeddedFeePayment returns undefined → FeeJuice.
		expect(method).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(feeOptions.gasPadding).toBe(1)
	})

	test("a payer that is the sender with no fee call is a requested self-pay: preexisting Fee Juice, the wallet's own method, not embedded", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const from = "0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1"
		const exec = { calls: [], authWitnesses: [], capsules: [], extraHashedArgs: [], feePayer: from } as unknown as ExecutionPayload
		const { feePaymentMethod: method, feeOptions } = await planner.processAztecJsPayload(exec, { from } as never)
		expect(method).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(feeOptions.embeddedFeePayment).toBeUndefined()
		expect(feeOptions.requestedPayment).toBe("fj")
	})

	// Regression pin: the planner previously extracted only
	// `maxFeesPerGas` from `opts.fee.gasSettings`, silently dropping
	// `maxPriorityFeesPerGas`. Both fields are now stringified into the
	// local `FeeOptions`.

	test("preserves opts.fee.gasSettings.maxFeesPerGas (regression pin)", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const exec = { calls: [], authWitnesses: [], capsules: [], extraHashedArgs: [] } as unknown as ExecutionPayload
		const opts = {
			fee: { gasSettings: { maxFeesPerGas: { feePerDaGas: 1000n, feePerL2Gas: 2000n } } },
		} as never
		const { feeOptions } = await planner.processAztecJsPayload(exec, opts)
		expect(feeOptions.maxFeesPerGas).toEqual({ feePerDaGas: "1000", feePerL2Gas: "2000" })
	})

	test("preserves opts.fee.gasSettings.maxPriorityFeesPerGas (was dropped pre-PR-8c-followup)", async () => {
		const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))
		const exec = { calls: [], authWitnesses: [], capsules: [], extraHashedArgs: [] } as unknown as ExecutionPayload
		const opts = {
			fee: {
				gasSettings: {
					maxFeesPerGas: { feePerDaGas: 1000n, feePerL2Gas: 2000n },
					maxPriorityFeesPerGas: { feePerDaGas: 5n, feePerL2Gas: 7n },
				},
			},
		} as never
		const { feeOptions } = await planner.processAztecJsPayload(exec, opts)
		expect(feeOptions.maxFeesPerGas).toEqual({ feePerDaGas: "1000", feePerL2Gas: "2000" })
		expect(feeOptions.maxPriorityFeesPerGas).toEqual({ feePerDaGas: "5", feePerL2Gas: "7" })
	})
})

describe("OperationPlanner.extractPrimaryMethod", () => {
	const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))

	test("returns the method name for a call action", () => {
		const op = {
			kind: "send_transaction",
			actions: [{ kind: "call", method: "transfer_public" }],
		} as unknown as Operation
		expect(planner.extractPrimaryMethod(op)).toBe("transfer_public")
	})

	test("returns the encoded-call name if set", () => {
		const op = {
			kind: "send_transaction",
			actions: [{ kind: "encoded_call", name: "transfer_in_public", selector: "0xdead" }],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("transfer_in_public")
	})

	test("falls back to selector when encoded-call name is missing", () => {
		const op = {
			kind: "send_transaction",
			actions: [{ kind: "encoded_call", selector: "0xdead" }],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("0xdead")
	})

	test("returns the first exec.calls[].name for aztec_sendTx shape", () => {
		const op = {
			kind: "aztec_sendTx",
			exec: { calls: [{ name: "some_fn", selector: "0xbeef" }] },
		} as unknown as AztecSendTxOperation
		expect(planner.extractPrimaryMethod(op)).toBe("some_fn")
	})

	test("returns undefined for operation kinds with no primary call", () => {
		const op = { kind: "register_sender" } as unknown as Operation
		expect(planner.extractPrimaryMethod(op)).toBeUndefined()
	})
})

// FEE_METHODS-filter regression: when the planner's input includes a fee
// method as the first call (the drip wraps the user's drip_to_private
// behind a wallet-injected sponsor_unconditionally), the in-flight task
// title MUST be derived from the USER call, not the fee call. Pinned here
// so a future refactor of the planner or the shared pickPrimaryMethod helper
// that breaks this contract fails CI before the proving-state card regresses.
describe("OperationPlanner.extractPrimaryMethod — FEE_METHODS filter (drip regression)", () => {
	const planner = new OperationPlanner(makeProfile(), makeTokenService(makeToken()))

	test("actions: [sponsor, drip] → drip method (filters fee call)", () => {
		const op = {
			kind: "send_transaction",
			actions: [
				{ kind: "call", method: "sponsor_unconditionally" },
				{ kind: "call", method: "drip_to_private" },
			],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("drip_to_private")
	})

	test("actions: [pay_fee, transfer] → transfer method", () => {
		const op = {
			kind: "send_transaction",
			actions: [
				{ kind: "call", method: "pay_fee" },
				{ kind: "call", method: "transfer_in_private" },
			],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("transfer_in_private")
	})

	test("encoded_call actions: [sponsor, drip] → drip name", () => {
		const op = {
			kind: "send_transaction",
			actions: [
				{ kind: "encoded_call", name: "sponsor_unconditionally", selector: "0x01" },
				{ kind: "encoded_call", name: "drip_to_private", selector: "0x02" },
			],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("drip_to_private")
	})

	test("exec.calls: [sponsor, drip] → drip name", () => {
		const op = {
			kind: "aztec_sendTx",
			exec: {
				calls: [
					{ name: "sponsor_unconditionally", selector: "0x01" },
					{ name: "drip_to_private", selector: "0x02" },
				],
			},
		} as unknown as AztecSendTxOperation
		expect(planner.extractPrimaryMethod(op)).toBe("drip_to_private")
	})

	test("preserves mint heuristic — actions: [transfer, mint_to_private] → mint", () => {
		const op = {
			kind: "send_transaction",
			actions: [
				{ kind: "call", method: "transfer_in_public" },
				{ kind: "call", method: "mint_to_private" },
			],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("mint_to_private")
	})

	test("(BUG PIN) all-fee-only actions return the first fee method (pre-existing behavior)", () => {
		const op = {
			kind: "send_transaction",
			actions: [
				{ kind: "call", method: "sponsor_unconditionally" },
				{ kind: "call", method: "pay_fee" },
			],
		} as unknown as SendTransactionOperation
		expect(planner.extractPrimaryMethod(op)).toBe("sponsor_unconditionally")
	})
})
