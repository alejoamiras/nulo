/**
 * An `aztec_createAuthWit` card shows the delegate and the arguments for a call intent, and says
 * plainly that an inner-hash intent cannot be explained. A phishing intent hides in whichever of
 * those fields is missing.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import { trimAddress } from "@/utils/string"
import type { TokenInfo } from "@/wallet/services/token/client"
import OperationCard from "./OperationCard.vue"

const OWNER = `0x${"a".repeat(64)}`
const DELEGATE = `0x${"d".repeat(64)}`
const TOKEN = `0x${"c".repeat(64)}`
const USDC = { id: 1, chainId: 1, contract: TOKEN, name: "USD Coin", symbol: "USDC", decimals: 6 } as TokenInfo
const CONSUMER = `0x${"e".repeat(64)}`
const INNER = `0x${"f".repeat(64)}`
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`

const createAuthWit = (messageHashOrIntent: unknown) => ({
	kind: "aztec_createAuthWit" as const,
	networkId: "net-1",
	accountAddress: OWNER,
	account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
	network: { id: "net-1", chainId: 1, name: "N" },
	messageHashOrIntent,
})

const stubs = {
	AddressDisplay: { props: ["address"], template: '<span class="addr">{{ address }}</span>' },
	Flex: { inheritAttrs: false, template: '<div v-bind="$attrs"><slot /></div>' },
	Text: { inheritAttrs: false, template: '<span v-bind="$attrs"><slot /></span>' },
	Icon: true,
	FeeSettingsCard: true,
}
const mountCard = (op: unknown, props: Record<string, unknown> = {}) =>
	mount(OperationCard, { props: { op: op as never, index: 0, ...props }, global: { stubs } })

describe("OperationCard — aztec_createAuthWit", () => {
	test("a transfer intent on a registered token with an explicit sender renders the delegate, the target and the structured arguments", () => {
		const w = mountCard(
			createAuthWit({
				caller: DELEGATE,
				call: { to: TOKEN, name: "transfer_in_private", args: [OWNER, DELEGATE, field(5n), field(1n)] },
			}),
			{ tokens: [USDC] },
		)
		expect(w.text()).toContain("Call intent")
		const caller = w.find('[data-testid="execute-authwit-caller"]')
		expect(caller.text()).toContain("Authorizes:")
		expect(caller.text()).toContain(DELEGATE)
		expect(w.text()).toContain(TOKEN)
		expect(w.find('[data-testid="execute-authwit-function"]').text().toLowerCase()).toContain("transfer")
		const structured = w.find('[data-testid="execute-authwit-structured-args"]')
		expect(structured.find('[data-testid="execute-authwit-transfer-sender"]').attributes("data-sender-kind")).toBe("explicit")
		expect(structured.find('[data-testid="execute-authwit-amount"]').text()).toContain("5")
		expect(structured.find('[data-testid="execute-authwit-transfer-nonce"]').text()).toContain("1")
		expect(w.find('[data-testid="execute-authwit-opaque-warning"]').exists()).toBe(false)
	})

	test("an unrecognized intent waits for the decode, then renders named parameters; a 2-arg transfer never claims a sender", () => {
		const call = { to: TOKEN, name: "transfer", args: [DELEGATE, field(5n)] }
		const pending = mountCard(createAuthWit({ caller: DELEGATE, call }))
		expect(pending.find('[data-testid="execute-authwit-args-pending"]').exists()).toBe(true)
		expect(pending.find('[data-testid="execute-authwit-transfer-sender"]').exists()).toBe(false)
		const decoded = mountCard(createAuthWit({ caller: DELEGATE, call }), {
			decodedCalls: [
				{
					kind: "decoded",
					contract: "Token",
					fn: "transfer",
					params: [{ name: "to", value: { kind: "address", value: DELEGATE } }],
				},
			],
		})
		expect(decoded.findAll('[data-testid="execute-authwit-decoded-param"]')).toHaveLength(1)
		expect(decoded.text()).not.toContain("this account")
	})

	test("an inner-hash intent renders the consumer, the trimmed hash and the opaque warning; no delegate row", () => {
		const w = mountCard(createAuthWit({ consumer: CONSUMER, innerHash: INNER }))
		expect(w.text()).toContain("Inner hash")
		expect(w.text()).toContain(CONSUMER)
		const hash = w.find('[data-testid="execute-authwit-inner-hash"]')
		expect(hash.text()).toContain(trimAddress(INNER, 10, 6))
		expect(hash.text()).not.toContain(INNER)
		expect(hash.find("[title]").attributes("title")).toBe(INNER)
		expect(w.find('[data-testid="execute-authwit-opaque-warning"]').text()).toContain("Opaque authorization")
		expect(w.find('[data-testid="execute-authwit-caller"]').exists()).toBe(false)
		expect(w.find('[data-testid="execute-authwit-args"]').exists()).toBe(false)
	})
})
