/**
 * A createAuthWit scope refusal reaches neither the log nor the dApp with a request value: with a
 * sentinel in every request field, no logger call at any level and no response carries one.
 */
import { describe, expect, test, vi } from "vitest"
import { enforceScope, type GrantedCapabilityRecord } from "@nulo/wallet-bridge"

vi.mock("@aztec/wallet-sdk/extension/handlers", () => ({ BackgroundConnectionHandler: class {} }))
vi.mock("./content-message-relay", () => ({ attachContentListener: () => {} }))
vi.mock("./tab-lifecycle", () => ({ wireTabLifecycle: () => {} }))
vi.mock("@nulo/wallet-sdk-schema-patch/register", () => ({}))

import { handleWalletMessage } from "./background"

const SESSION = { sessionId: "s1", origin: "https://dapp.example", chainInfo: { chainId: "1", version: "1" } } as never
const A = "0x1111111111111111111111111111111111111111111111111111111111111111"

const FROM = "SENTINEL-FROM"
const CALL_INTENT = { caller: "SENTINEL-CALLER", call: { to: "SENTINEL-TO", name: "SENTINEL-NAME" } }
const INNER_HASH = { consumer: "SENTINEL-CONSUMER", innerHash: "SENTINEL-INNER-HASH" }
const grant = (capability: unknown) => ({ capability, grantedAt: 0 }) as GrantedCapabilityRecord
const TRANSACTION = grant({ type: "transaction", scope: [{ contract: A, function: "transfer" }] })

// Each refusal's grants refuse it, and its pattern proves that branch threw.
const REFUSALS: [string, unknown[], GrantedCapabilityRecord[], RegExp][] = [
	[
		"the account",
		[FROM, CALL_INTENT],
		[grant({ type: "accounts", canCreateAuthWit: true, accounts: [{ alias: "a", item: A }] })],
		/^Scope violation: createAuthWit .*accounts scope$/,
	],
	["the call", [FROM, CALL_INTENT], [TRANSACTION], /^Scope violation: createAuthWit (?!inner-hash).*transaction or simulation scope$/],
	[
		"the inner hash's consumer",
		[FROM, INNER_HASH],
		[TRANSACTION],
		/^Scope violation: createAuthWit inner-hash .*transaction or simulation scope$/,
	],
]

function refusalFor(args: unknown[], grants: GrantedCapabilityRecord[]): Error {
	try {
		enforceScope("createAuthWit", args, grants)
	} catch (error) {
		return error as Error
	}
	throw new Error("the grants did not refuse the request")
}

/** JSON of `value` with every `Error` expanded to its own properties plus `message` and `stack`,
 *  which `JSON.stringify` alone drops. */
function serialize(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v instanceof Error
			? {
					...Object.fromEntries(Object.getOwnPropertyNames(v).map((k) => [k, Reflect.get(v, k)])),
					message: v.message,
					stack: v.stack,
				}
			: v,
	)
}

describe("handleWalletMessage — a createAuthWit scope refusal", () => {
	test("the serializer sees a nested Error's message", () => {
		expect(serialize([{ error: new Error("SENTINEL-PROBE") }])).toMatch(/SENTINEL-PROBE/)
	})

	test.each(REFUSALS)("of %s carries no request value into the log or the response", async (_name, args, grants, branch) => {
		const refusal = refusalFor(args, grants)
		expect(refusal.message).toMatch(branch)
		const dispatch = vi.fn(async () => {
			throw refusal
		})
		const sendResponse = vi.fn(async (_sessionId: string, _response: unknown) => {})
		const log = vi.fn()

		await handleWalletMessage(
			SESSION,
			{ messageId: "m1", type: "createAuthWit", args } as never,
			{ sendResponse, terminateSession: vi.fn() } as never,
			{ dispatch } as never,
			{ captureExecutionFence: async () => ({ profileId: "p1" }) } as never,
			{ transitionIfStage: vi.fn() } as never,
			new Map([["s1", "p1"]]),
			{ current: () => 0 } as never,
			{ log } as never,
			{ assertCurrent: async () => {} },
		)

		expect(dispatch).toHaveBeenCalledTimes(1)
		expect(log).toHaveBeenCalled()
		expect(sendResponse).toHaveBeenCalledTimes(1)
		for (const call of log.mock.calls) expect(serialize(call)).not.toMatch(/SENTINEL-/)
		expect(serialize(sendResponse.mock.calls)).not.toMatch(/SENTINEL-/)
	})
})
