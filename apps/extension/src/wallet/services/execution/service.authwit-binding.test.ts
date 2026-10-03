// @vitest-environment node
/**
 * `aztec_createAuthWit` through the real facade arm on a bare prototype: the hash is bound to the live
 * node's checked chain identity, and a call intent to the selector's real function, before anything
 * is signed. Node environment because the outer hash is the real poseidon2 (jsdom takes the sync
 * Barretenberg branch, which fails under vitest).
 */
import { computeAuthWitMessageHash } from "@aztec-labs/aztec.js/authorization"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { FunctionCall, FunctionSelector, FunctionType } from "@aztec-labs/stdlib/abi"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { describe, expect, test, vi } from "vitest"
import { ExecutionService } from "./service"

const FENCE = { profileId: "p1", epoch: 0, session: 1 }
const LIVE = { l1ChainId: 31337, rollupVersion: 1 }
/** The stored row whose composite matches `LIVE`: (31337 ^ 1) >>> 0. */
const NETWORK = {
	id: "net-1",
	profileId: "p1",
	chainId: 31336,
	l1ChainId: 31337,
	primaryEndpointId: "e1",
	endpoints: [{ id: "e1", rpcUrl: "http://node" }],
}
const CHAIN_INFO = { chainId: new Fr(LIVE.l1ChainId), version: new Fr(LIVE.rollupVersion) }
const DRIFT =
	"Chain identity mismatch: selected network has chainId=31336 but live node reports composite=31339 (l1ChainId=31337, rollupVersion=2). Refusing to sign/prove against a drifted endpoint."

const FN = {
	name: "transfer_in_public",
	functionType: FunctionType.PUBLIC,
	isStatic: false,
	parameters: [],
	returnType: { kind: "boolean" },
}
const TO = AztecAddress.fromBigIntUnsafe(0x70c3n).toString()
const CALLER = AztecAddress.fromBigIntUnsafe(0xca11n).toString()
const CONSUMER = AztecAddress.fromBigIntUnsafe(0xc045n).toString()
const INNER_HASH = new Fr(0x1234n).toString()
const RAW_HASH = new Fr(0xabcdn).toString()
const selectorOf = async () => (await FunctionSelector.fromNameAndParameters(FN.name, FN.parameters)).toString()

function makeFacade(live: { l1ChainId: number; rollupVersion: number } = LIVE) {
	const createAuthWit = vi.fn(async (_hash: Fr) => "0xwit")
	const getNodeInfo = vi.fn(async () => live)
	const getContractInstance = vi.fn(async () => ({ currentContractClassId: { toString: () => "0xc1a55" } }))
	const getContractArtifact = vi.fn(async () => ({ functions: [FN], nonDispatchPublicFunctions: [] }))
	const facade = Object.assign(Object.create(ExecutionService.prototype), {
		networkService: { getNetwork: async () => NETWORK, getNode: async () => ({ getNodeInfo }) },
		accountService: { getAccountContract: async () => ({ createAuthWit }) },
		profileService: { assertFence: async () => {}, isFenceLive: () => true },
		pxeService: { getContractInstance, getContractArtifact },
	}) as ExecutionService
	return { facade, createAuthWit, getNodeInfo, getContractInstance }
}

/** The intent shapes as the dApp's JSON carries them. */
const callIntent = (call: Record<string, unknown>) => ({
	caller: CALLER,
	call: { to: TO, type: FunctionType.PUBLIC, isStatic: false, hideMsgSender: false, args: [], ...call },
})
const consumerIntent = { consumer: CONSUMER, innerHash: INNER_HASH }
const op = (messageHashOrIntent: unknown) =>
	({ kind: "aztec_createAuthWit", networkId: "net-1", accountAddress: CALLER, messageHashOrIntent }) as never

async function rejectionOf(run: Promise<unknown>): Promise<Error> {
	try {
		await run
	} catch (error) {
		return error as Error
	}
	throw new Error("expected a rejection")
}

async function expectedCallHash(): Promise<string> {
	const call = new FunctionCall(
		FN.name,
		AztecAddress.fromStringUnsafe(TO),
		FunctionSelector.fromString(await selectorOf()),
		FN.functionType,
		false,
		FN.isStatic,
		[],
		FN.returnType as never,
	)
	return (await computeAuthWitMessageHash({ caller: AztecAddress.fromStringUnsafe(CALLER), call }, CHAIN_INFO)).toString()
}

describe("aztec_createAuthWit: the live chain binding", () => {
	test("each intent kind signs a hash over the checked pair, l1ChainId then rollupVersion", async () => {
		const selector = await selectorOf()
		const signed = async (intent: unknown) => {
			const { facade, createAuthWit } = makeFacade()
			await facade.executeAztecCreateAuthWit(op(intent), FENCE)
			return createAuthWit.mock.calls[0]?.[0]?.toString()
		}
		expect(await signed(callIntent({ name: FN.name, selector }))).toBe(await expectedCallHash())
		expect(await signed(consumerIntent)).toBe(
			(
				await computeAuthWitMessageHash(
					{ consumer: AztecAddress.fromStringUnsafe(CONSUMER), innerHash: Fr.fromString(INNER_HASH) },
					CHAIN_INFO,
				)
			).toString(),
		)
		expect(await signed(RAW_HASH)).toBe(RAW_HASH)
	})

	test("a drifted live pair is refused for every intent kind, a raw hash included, before any lookup or sign", async () => {
		const selector = await selectorOf()
		for (const intent of [callIntent({ name: FN.name, selector }), consumerIntent, RAW_HASH]) {
			const { facade, createAuthWit, getContractInstance } = makeFacade({ l1ChainId: 31337, rollupVersion: 2 })
			const refused = await rejectionOf(facade.executeAztecCreateAuthWit(op(intent), FENCE))
			expect(refused.constructor).toBe(Error)
			expect(refused.message).toBe(DRIFT)
			expect(getContractInstance).not.toHaveBeenCalled()
			expect(createAuthWit).not.toHaveBeenCalled()
		}
	})
})

describe("aztec_createAuthWit: the selector binding of a call intent", () => {
	test("an unknown selector, a wrong name and an empty name are refused before anything is signed", async () => {
		const selector = await selectorOf()
		const unknownRun = makeFacade()
		const unknown = await rejectionOf(
			unknownRun.facade.executeAztecCreateAuthWit(op(callIntent({ name: FN.name, selector: "0x0badc0de" })), FENCE),
		)
		expect(unknown.constructor).toBe(Error)
		expect(unknown.message).toBe("Method not found")
		expect(unknownRun.createAuthWit).not.toHaveBeenCalled()
		for (const name of ["sneaky", ""]) {
			const { facade, createAuthWit } = makeFacade()
			const refused = await rejectionOf(facade.executeAztecCreateAuthWit(op(callIntent({ name, selector })), FENCE))
			expect(refused.constructor).toBe(Error)
			expect(refused.message).toBe(
				`Scope violation: authwit call name "${name}" does not match selector's function "${FN.name}" on ${TO}`,
			)
			expect(createAuthWit).not.toHaveBeenCalled()
		}
	})

	test("an absent name (a direct call; the wire schema requires one) signs over the selector's function", async () => {
		const { facade, createAuthWit } = makeFacade()
		await facade.executeAztecCreateAuthWit(op(callIntent({ selector: await selectorOf() })), FENCE)
		expect(createAuthWit.mock.calls[0]?.[0]?.toString()).toBe(await expectedCallHash())
	})
})
