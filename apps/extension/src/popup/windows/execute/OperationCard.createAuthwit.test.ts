/**
 * An `aztec_createAuthWit` card shows the delegate and the arguments for a call intent, and says
 * plainly that an inner-hash intent cannot be explained. A phishing intent hides in whichever of
 * those fields is missing.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OperationCard from "./OperationCard.vue"

const OWNER = `0x${"a".repeat(64)}`
const DELEGATE = `0x${"d".repeat(64)}`
const TOKEN = `0x${"c".repeat(64)}`
const CONSUMER = `0x${"e".repeat(64)}`
const INNER = `0x${"f".repeat(64)}`

const createAuthWit = (messageHashOrIntent: unknown) => ({
	kind: "aztec_createAuthWit" as const,
	networkId: "net-1",
	accountAddress: OWNER,
	account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
	messageHashOrIntent,
})

const stubs = {
	AddressDisplay: { props: ["address"], template: '<span class="addr">{{ address }}</span>' },
	Flex: { inheritAttrs: false, template: '<div v-bind="$attrs"><slot /></div>' },
	Text: { inheritAttrs: false, template: '<span v-bind="$attrs"><slot /></span>' },
	Icon: true,
	FeeSettingsCard: true,
}
const mocks = { trimAddress: (a: string) => a, humanizeMethodName: (m: string) => m, humanizeOperationKind: (k: string) => k }
const mountCard = (op: unknown) => mount(OperationCard, { props: { op: op as never, index: 0 }, global: { stubs, mocks } })

describe("OperationCard — aztec_createAuthWit", () => {
	test("a call intent renders the delegate, the target, the function and every argument", () => {
		const w = mountCard(
			createAuthWit({ caller: DELEGATE, call: { to: TOKEN, name: "transfer_in_private", args: [OWNER, DELEGATE, "5", "x"] } }),
		)
		expect(w.text()).toContain("Call intent")
		const caller = w.find('[data-testid="execute-authwit-caller"]')
		expect(caller.text()).toContain("Authorizes:")
		expect(caller.text()).toContain(DELEGATE)
		expect(w.text()).toContain(TOKEN)
		expect(w.text()).toContain("transfer_in_private")
		const rows = w.findAll('[data-testid="execute-authwit-arg"]')
		expect(rows).toHaveLength(4)
		expect(rows[0].attributes("data-arg-kind")).toBe("address")
		expect(rows[2].text()).toContain("5")
		expect(rows[3].text()).not.toContain("")
		expect(w.find('[data-testid="execute-authwit-opaque-warning"]').exists()).toBe(false)
	})

	test("an inner-hash intent renders the consumer, the raw hash and the opaque warning; no delegate row", () => {
		const w = mountCard(createAuthWit({ consumer: CONSUMER, innerHash: INNER }))
		expect(w.text()).toContain("Inner hash")
		expect(w.text()).toContain(CONSUMER)
		expect(w.find('[data-testid="execute-authwit-inner-hash"]').text()).toContain(INNER)
		expect(w.find('[data-testid="execute-authwit-opaque-warning"]').text()).toContain("Opaque authorization")
		expect(w.find('[data-testid="execute-authwit-caller"]').exists()).toBe(false)
		expect(w.find('[data-testid="execute-authwit-args"]').exists()).toBe(false)
	})
})
