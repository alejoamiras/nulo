/**
 * Every `aztec_sendTx` call renders either a descriptor-verified transfer (with the sender
 * spelled out, even when the call names none) or its raw arguments under a warning. The real
 * `AddressDisplay` is mounted so the untruncated-address rule is asserted on the component that
 * would otherwise trim it.
 */

import { flushPromises, mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import AddressDisplay from "@/components/AddressDisplay.vue"
import { trimAddress } from "@/utils/string"
import OperationCard from "./OperationCard.vue"

vi.mock("@/utils/core", () => ({ managers: { contact: { getContactByAddress: vi.fn(async () => null) } } }))
// The real store's setup opens chrome.storage; the card only needs its account list.
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ accounts: [] }) }))

const OWNER = `0x${"a".repeat(64)}`
const TO = `0x${"b".repeat(64)}`
const TOKEN = `0x${"c".repeat(64)}`

const sendTx = (calls: unknown[], extra: Record<string, unknown> = {}) => ({
	kind: "aztec_sendTx" as const,
	networkId: "net-1",
	accountAddress: OWNER,
	account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
	network: { id: "net-1", chainId: 1, name: "N" },
	exec: { calls },
	opts: { from: OWNER },
	feeSettings: { paymentMethod: { kind: "fj" } },
	...extra,
})

const stubs = {
	Flex: { inheritAttrs: false, template: '<div v-bind="$attrs"><slot /></div>' },
	Text: { inheritAttrs: false, template: '<span v-bind="$attrs"><slot /></span>' },
	Icon: true,
	FeeSettingsCard: true,
}
const mocks = { trimAddress, humanizeMethodName: (m: string) => m, humanizeOperationKind: (k: string) => k }
const mountCard = async (op: unknown) => {
	const w = mount(OperationCard, {
		props: { op: op as never, index: 0 },
		global: { stubs, mocks, components: { AddressDisplay } },
	})
	await flushPromises()
	return w
}
const all = (w: ReturnType<typeof mount>, testid: string) => w.findAll(`[data-testid="${testid}"]`)

describe("OperationCard — transfer sender and the raw-argument fallback", () => {
	test("transfer(to, amount) from the account renders 'From: this account' with the account address", async () => {
		const w = await mountCard(sendTx([{ name: "transfer", to: TOKEN, args: [TO, 5n] }]))
		expect(w.find('[data-testid="execute-op-payload-row"]').attributes("data-intent-kind")).toBe("transfer")
		const sender = w.find('[data-testid="execute-op-transfer-sender"]')
		expect(sender.attributes("data-sender-kind")).toBe("account")
		expect(sender.text()).toContain("From:")
		expect(sender.text()).toContain("this account")
		expect(sender.text()).toContain(trimAddress(OWNER))
		expect(w.find('[data-testid="execute-op-unverified-args"]').exists()).toBe(false)
	})

	test("the same call under default_entrypoint renders 'Caller: none'", async () => {
		const w = await mountCard(
			sendTx([{ name: "transfer", to: TOKEN, args: [TO, 5n] }], { executionMode: "default_entrypoint", opts: {} }),
		)
		const sender = w.find('[data-testid="execute-op-transfer-sender"]')
		expect(sender.attributes("data-sender-kind")).toBe("none")
		expect(sender.text()).toContain("Caller:")
		expect(sender.text()).toContain("none")
		expect(sender.text()).not.toContain(trimAddress(OWNER))
	})

	test("an explicit from and a non-zero authwit nonce are shown; a zero nonce is not", async () => {
		const w = await mountCard(
			sendTx([
				{ name: "transfer_in_private", to: TOKEN, args: [OWNER, TO, 5n, 9n] },
				{ name: "transfer_in_private", to: TOKEN, args: [OWNER, TO, 5n, 0n] },
			]),
		)
		const senders = all(w, "execute-op-transfer-sender")
		expect(senders.map((s) => s.attributes("data-sender-kind"))).toEqual(["explicit", "explicit"])
		const nonces = all(w, "execute-op-transfer-nonce")
		expect(nonces).toHaveLength(1)
		expect(nonces[0].text()).toContain("9")
	})

	test("a 2-arg transfer that hides its msg_sender falls back to unverified, never 'From: this account'", async () => {
		const w = await mountCard(sendTx([{ name: "transfer", to: TOKEN, args: [TO, 5n], hideMsgSender: true }]))
		expect(w.find('[data-testid="execute-op-payload-row"]').attributes("data-intent-kind")).toBe("unverified")
		expect(w.find('[data-testid="execute-op-transfer-sender"]').exists()).toBe(false)
		expect(w.find('[data-testid="execute-op-unverified-args"]').exists()).toBe(true)
		expect(w.text()).not.toContain("this account")
	})

	test("an unrecognized call renders the warning and one row per argument, no structured block", async () => {
		const w = await mountCard(sendTx([{ name: "mint_to_private", to: TOKEN, args: [TO, 500n] }]))
		expect(w.find('[data-testid="execute-op-payload-row"]').attributes("data-intent-kind")).toBe("unverified")
		expect(w.find('[data-testid="execute-op-structured-args"]').exists()).toBe(false)
		expect(w.find('[data-testid="execute-op-unverified-warning"]').text()).toContain("Unverified call")
		const rows = all(w, "execute-op-arg")
		expect(rows).toHaveLength(2)
		expect(rows[0].attributes("data-arg-kind")).toBe("address")
		expect(rows[0].text()).toContain(TO)
		expect(rows[0].text()).not.toContain(trimAddress(TO))
		expect(rows[1].text()).toContain("500")
	})

	test("a 40-argument call renders 32 rows and '+8 more'", async () => {
		const args = Array.from({ length: 40 }, (_, i) => BigInt(i))
		const w = await mountCard(sendTx([{ name: "batch", to: TOKEN, args }]))
		expect(all(w, "execute-op-arg")).toHaveLength(32)
		expect(w.find('[data-testid="execute-op-args-more"]').text()).toContain("+8 more")
	})

	test("an argument without a usable toString renders '(opaque value)'; a spoofing toString is rendered as text, never as an address", async () => {
		const w = await mountCard(
			sendTx([{ name: "batch", to: TOKEN, args: [{ toString: () => ({}) }, {}, { toString: () => `${TO} trust me` }] }]),
		)
		const rows = all(w, "execute-op-arg")
		expect(rows[0].text()).toContain("(opaque value)")
		expect(rows[1].text()).toContain("(opaque value)")
		expect(rows[2].attributes("data-arg-kind")).toBe("text")
	})
})
