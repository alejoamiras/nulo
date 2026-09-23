import { describe, expect, test } from "vitest"
import type { Action } from "@nulo/wallet-bridge"
import {
	fingerprintNoFromInputs,
	fingerprintOperation,
	type NoFromFingerprintInput,
	type OperationFingerprintInput,
} from "./operation-fingerprint"

const CALL: Action = { kind: "call", contract: "0xtoken", method: "transfer", args: ["0xme", "0xyou", 5] }

function makeInput(overrides: Partial<OperationFingerprintInput> = {}): OperationFingerprintInput {
	return {
		networkId: "net-1",
		accountAddress: "0xacc",
		executionMode: "standard",
		from: "0xacc",
		actions: [CALL],
		fee: undefined,
		feeSettings: { paymentMethod: { kind: "fj" } } as never,
		...overrides,
	}
}

describe("fingerprintOperation", () => {
	test("deterministic: identical inputs produce identical output", () => {
		expect(fingerprintOperation(makeInput())).toBe(fingerprintOperation(makeInput()))
	})

	test("every scalar identity field is bound", () => {
		const base = fingerprintOperation(makeInput())
		expect(fingerprintOperation(makeInput({ networkId: "net-2" }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ accountAddress: "0xother" }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ executionMode: "default_entrypoint" }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ from: "0xother" }))).not.toBe(base)
	})

	test("action order, arg values, and arg TYPES are bound", () => {
		const other: Action = { kind: "call", contract: "0xother", method: "m", args: [] }
		const base = fingerprintOperation(makeInput({ actions: [CALL, other] }))
		expect(fingerprintOperation(makeInput({ actions: [other, CALL] }))).not.toBe(base)
		const argChanged: Action = { ...CALL, args: ["0xme", "0xyou", 6] } as Action
		expect(fingerprintOperation(makeInput({ actions: [argChanged, other] }))).not.toBe(base)
		// "5" (string) vs 5 (number) must NOT collide — type-tagged encoding.
		const argStr: Action = { ...CALL, args: ["0xme", "0xyou", "5"] } as Action
		expect(fingerprintOperation(makeInput({ actions: [argStr, other] }))).not.toBe(
			fingerprintOperation(makeInput({ actions: [CALL, other] })),
		)
	})

	test("FULL FeeOptions bound — incl. teardownGasLimits and maxPriorityFeesPerGas", () => {
		const base = fingerprintOperation(makeInput({ fee: { gasPadding: 1.05 } }))
		expect(fingerprintOperation(makeInput({ fee: { gasPadding: 1.1 } }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ fee: { gasPadding: 1.05, gasLimits: { daGas: 1, l2Gas: 2 } } }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ fee: { gasPadding: 1.05, requestedPayment: "fj" } }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ fee: { gasPadding: 1.05, teardownGasLimits: { daGas: 1, l2Gas: 2 } } }))).not.toBe(base)
		expect(fingerprintOperation(makeInput({ fee: { gasPadding: 1.05, maxFeesPerGas: { feePerDaGas: 1, feePerL2Gas: 2 } } }))).not.toBe(
			base,
		)
		expect(
			fingerprintOperation(makeInput({ fee: { gasPadding: 1.05, maxPriorityFeesPerGas: { feePerDaGas: 1, feePerL2Gas: 2 } } })),
		).not.toBe(base)
	})

	test("wallet FeeSettings bound (payment method + priority)", () => {
		const base = fingerprintOperation(makeInput())
		expect(fingerprintOperation(makeInput({ feeSettings: { paymentMethod: { kind: "fpc", fpcId: "f1" } } as never }))).not.toBe(base)
		expect(
			fingerprintOperation(makeInput({ feeSettings: { paymentMethod: { kind: "fj" }, priorityLevel: "high" } as never })),
		).not.toBe(base)
	})

	test("every action kind is encodable", () => {
		const actions: Action[] = [
			{ kind: "add_capsule", contract: "0xc", storageSlot: "0x1", capsule: ["0xaa"], scope: "0xs" },
			{ kind: "add_extra_args", args: ["0x1", "0x2"] },
			{ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0xm" } },
			{ kind: "add_public_authwit", content: { kind: "intent", consumer: "0xc", intent: ["0x1"] } },
			CALL,
			{ kind: "encoded_call", to: "0xt", selector: "0xsel", args: ["0x1"], hideMsgSender: true },
		]
		expect(fingerprintOperation(makeInput({ actions }))).not.toBeNull()
	})

	test("REJECT-UNSUPPORTED: exotic arg values make the op non-fingerprintable (null), never a lossy hash", () => {
		const withFn: Action = { kind: "call", contract: "0xc", method: "m", args: [() => 1] } as unknown as Action
		expect(fingerprintOperation(makeInput({ actions: [withFn] }))).toBeNull()
		class Custom {}
		const withInstance: Action = { kind: "call", contract: "0xc", method: "m", args: [new Custom()] } as unknown as Action
		expect(fingerprintOperation(makeInput({ actions: [withInstance] }))).toBeNull()
		// Depth bomb: nesting past the cap rejects instead of truncating.
		let deep: unknown = "x"
		for (let i = 0; i < 10; i++) deep = [deep]
		const tooDeep: Action = { kind: "call", contract: "0xc", method: "m", args: [deep] } as unknown as Action
		expect(fingerprintOperation(makeInput({ actions: [tooDeep] }))).toBeNull()
	})

	test("delimiter injection cannot collide adjacent fields (length-prefixed scalars)", () => {
		const a: Action = { kind: "call", contract: "0xa|b", method: "c", args: [] }
		const b: Action = { kind: "call", contract: "0xa", method: "b|c", args: [] }
		expect(fingerprintOperation(makeInput({ actions: [a] }))).not.toBe(fingerprintOperation(makeInput({ actions: [b] })))
		// undefined scope vs empty-string scope must stay distinct too.
		const withScope: Action = { kind: "add_capsule", contract: "0xc", storageSlot: "0x1", capsule: [], scope: "" }
		const noScope: Action = { kind: "add_capsule", contract: "0xc", storageSlot: "0x1", capsule: [] }
		expect(fingerprintOperation(makeInput({ actions: [withScope] }))).not.toBe(fingerprintOperation(makeInput({ actions: [noScope] })))
	})

	test("plain nested objects/arrays/bigints ARE supported and order-normalized by key", () => {
		const a: Action = { kind: "call", contract: "0xc", method: "m", args: [{ b: 1n, a: [true, null] }] } as unknown as Action
		const b: Action = { kind: "call", contract: "0xc", method: "m", args: [{ a: [true, null], b: 1n }] } as unknown as Action
		expect(fingerprintOperation(makeInput({ actions: [a] }))).toBe(fingerprintOperation(makeInput({ actions: [b] })))
	})
})

describe("fingerprintOperation — call names", () => {
	test("two encoded calls differing ONLY in name fingerprint differently", () => {
		const enc = (name: string | undefined) =>
			fingerprintOperation(makeInput({ actions: [{ kind: "encoded_call", to: "0xt", selector: "0xsel", name, args: ["0x1"] }] }))
		expect(enc("transfer")).not.toBe(enc("transfer_to_public"))
		expect(enc("transfer")).not.toBe(enc(undefined))
	})

	test("two encoded-call authwits differing ONLY in name fingerprint differently", () => {
		const enc = (name: string | undefined) =>
			fingerprintOperation(
				makeInput({
					actions: [
						{
							kind: "add_public_authwit",
							content: { kind: "encoded_call", caller: "0xc", to: "0xt", selector: "0xsel", name, args: [] },
						},
					],
				}),
			)
		expect(enc("transfer")).not.toBe(enc("burn"))
	})
})

describe("fingerprintNoFromInputs", () => {
	const hex = (s: string) => ({ toString: () => s })
	const makeNoFrom = (overrides: Partial<NoFromFingerprintInput> = {}): NoFromFingerprintInput => ({
		networkId: "net-1",
		accountAddress: "0xacc",
		from: "0xacc",
		calls: [
			{ to: hex("0xt"), selector: hex("0xsel"), name: "swap", args: [hex("0x1"), hex("0x2")], isStatic: false, hideMsgSender: false },
		],
		authWitnesses: [],
		capsules: [],
		extraHashedArgs: [],
		gasSettings: undefined,
		additionalScopes: [hex("0xb"), hex("0xa")],
		...overrides,
	})

	test("independent builds with equal inputs match; scopes are order- and dup-insensitive", () => {
		expect(fingerprintNoFromInputs(makeNoFrom())).toBe(fingerprintNoFromInputs(makeNoFrom()))
		expect(fingerprintNoFromInputs(makeNoFrom({ additionalScopes: [hex("0xa"), hex("0xb"), hex("0xa")] }))).toBe(
			fingerprintNoFromInputs(makeNoFrom()),
		)
	})

	test("a changed argument (an authwit_nonce), a scope, an explicit gas constraint or an extra changes it", () => {
		const base = fingerprintNoFromInputs(makeNoFrom())
		expect(
			fingerprintNoFromInputs(
				makeNoFrom({ calls: [{ to: hex("0xt"), selector: hex("0xsel"), name: "swap", args: [hex("0x1"), hex("0x3")] }] }),
			),
		).not.toBe(base)
		expect(fingerprintNoFromInputs(makeNoFrom({ additionalScopes: [hex("0xa")] }))).not.toBe(base)
		expect(fingerprintNoFromInputs(makeNoFrom({ gasSettings: { maxFeesPerGas: { feePerDaGas: "1", feePerL2Gas: "2" } } }))).not.toBe(
			base,
		)
		expect(fingerprintNoFromInputs(makeNoFrom({ extraHashedArgs: [hex("0xe")] }))).not.toBe(base)
		expect(fingerprintNoFromInputs(makeNoFrom({ authWitnesses: [hex("0xw")] }))).not.toBe(base)
	})
})
