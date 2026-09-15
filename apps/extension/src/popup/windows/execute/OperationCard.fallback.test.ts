/**
 * Every `aztec_sendTx` call renders the first reading that applies — the wallet's transfer/mint
 * vocabulary, the ABI decode the parent fetched, or the raw fields behind a toggle — against
 * arguments shaped exactly as dApps send them: 32-byte hex fields. The real `AddressDisplay` and
 * `CallArguments` are mounted so trimming and the toggle are asserted on the components that do them.
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
/** An `Fr` as the wire carries it. */
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`
const USDC = { id: 1, chainId: 1, contract: TOKEN, name: "USD Coin", symbol: "USDC", decimals: 6 }

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
const decoded = (fn: string, params: { name: string; value: unknown }[]) => ({ kind: "decoded" as const, contract: "Token", fn, params })
const undecoded = (reason: string) => ({ kind: "undecoded" as const, reason })

const stubs = {
	Flex: { inheritAttrs: false, template: '<div v-bind="$attrs"><slot /></div>' },
	Text: { inheritAttrs: false, template: '<span v-bind="$attrs"><slot /></span>' },
	Icon: true,
	FeeSettingsCard: true,
}
const mountCard = async (op: unknown, props: Record<string, unknown> = {}) => {
	const w = mount(OperationCard, {
		props: { op: op as never, index: 0, ...props },
		global: { stubs, components: { AddressDisplay } },
	})
	await flushPromises()
	return w
}
const all = (w: ReturnType<typeof mount>, testid: string) => w.findAll(`[data-testid="${testid}"]`)
const one = (w: ReturnType<typeof mount>, testid: string) => w.find(`[data-testid="${testid}"]`)

describe("OperationCard — the vocabulary reading", () => {
	test("transfer(to, amount) from the account: 'From: this account', a trimmed recipient, a decimal amount", async () => {
		const w = await mountCard(sendTx([{ name: "transfer", to: TOKEN, args: [TO, field(5n)] }]))
		expect(one(w, "execute-op-payload-row").attributes("data-intent-kind")).toBe("transfer")
		const sender = one(w, "execute-op-transfer-sender")
		expect(sender.attributes("data-sender-kind")).toBe("account")
		expect(sender.text()).toContain("this account")
		expect(sender.text()).toContain(trimAddress(OWNER))
		expect(one(w, "execute-op-amount").text()).toContain("5")
		expect(one(w, "execute-op-amount").text()).toContain("base units")
		expect(w.text()).not.toContain(field(5n))
		expect(w.text()).not.toContain(TO)
		expect(w.text()).toContain(trimAddress(TO))
	})

	test("the same call under default_entrypoint renders 'Caller: none'", async () => {
		const w = await mountCard(
			sendTx([{ name: "transfer", to: TOKEN, args: [TO, field(5n)] }], { executionMode: "default_entrypoint", opts: {} }),
		)
		const sender = one(w, "execute-op-transfer-sender")
		expect(sender.attributes("data-sender-kind")).toBe("none")
		expect(sender.text()).toContain("none")
		expect(sender.text()).not.toContain(trimAddress(OWNER))
	})

	test("an explicit from and a non-zero nonce are shown, a zero nonce is not, and a known token labels the amount", async () => {
		const w = await mountCard(
			sendTx([
				{ name: "transfer_in_private", to: TOKEN, args: [OWNER, TO, field(5_000_000n), field(9n)] },
				{ name: "transfer_in_private", to: TOKEN, args: [OWNER, TO, field(5_000_000n), field(0n)] },
			]),
			{ tokens: [USDC] },
		)
		expect(all(w, "execute-op-transfer-sender").map((s) => s.attributes("data-sender-kind"))).toEqual(["explicit", "explicit"])
		const nonces = all(w, "execute-op-transfer-nonce")
		expect(nonces).toHaveLength(1)
		expect(nonces[0]!.text()).toContain("9")
		expect(all(w, "execute-op-amount")[0]!.text()).toContain("5 USDC")
	})

	test("mint_to_private(to, amount) is a mint: recipient and amount, no sender row", async () => {
		const w = await mountCard(sendTx([{ name: "mint_to_private", to: TOKEN, args: [TO, field(500n)] }]))
		expect(one(w, "execute-op-payload-row").attributes("data-intent-kind")).toBe("mint")
		expect(one(w, "execute-op-structured-args").text()).toContain("Mint to:")
		expect(one(w, "execute-op-transfer-sender").exists()).toBe(false)
		expect(one(w, "execute-op-amount").text()).toContain("500")
		expect(one(w, "execute-op-unverified-args").exists()).toBe(false)
	})

	test("a 2-arg transfer that hides its msg_sender never claims the account: it takes the ABI decode", async () => {
		const w = await mountCard(sendTx([{ name: "transfer", to: TOKEN, args: [TO, field(5n)], hideMsgSender: true }]), {
			decodedCalls: [
				decoded("transfer", [
					{ name: "to", value: { kind: "address", value: TO } },
					{ name: "amount", value: { kind: "integer", value: "5" } },
				]),
			],
		})
		expect(one(w, "execute-op-payload-row").attributes("data-intent-kind")).toBe("decoded")
		expect(one(w, "execute-op-transfer-sender").exists()).toBe(false)
		expect(w.text()).not.toContain("this account")
		expect(all(w, "execute-op-decoded-param")).toHaveLength(2)
	})
})

describe("OperationCard — the ABI decode and the raw fallback", () => {
	const claimArgs = [TO, field(5_000_000n), field(7n), field(1n)]
	const claim = { name: "claim_lie", to: TOKEN, selector: "0x11223344", args: claimArgs }

	test("a decoded call names its parameters by ABI truth, trims addresses and fields, and labels an amount", async () => {
		const w = await mountCard(sendTx([claim]), {
			tokens: [USDC],
			decodedCalls: [
				decoded("claim_private", [
					{ name: "to", value: { kind: "address", value: TO } },
					{ name: "amount", value: { kind: "integer", value: "5000000" } },
					{ name: "secret", value: { kind: "field", value: field(7n) } },
					{ name: "shielded", value: { kind: "boolean", value: true } },
				]),
			],
		})
		const row = one(w, "execute-op-payload-row")
		expect(row.attributes("data-intent-kind")).toBe("decoded")
		expect(row.text()).not.toContain("claim_lie")
		const params = all(w, "execute-op-decoded-param")
		expect(params.map((p) => p.attributes("data-param"))).toEqual(["to", "amount", "secret", "shielded"])
		expect(params[0]!.text()).toContain(trimAddress(TO))
		expect(params[0]!.text()).not.toContain(TO)
		expect(params[1]!.text()).toContain("5 USDC")
		expect(params[2]!.text()).not.toContain(field(7n))
		expect(params[2]!.find("[title]").attributes("title")).toBe(field(7n))
		expect(params[3]!.text()).toContain("true")
		expect(one(w, "execute-op-unverified-args").exists()).toBe(false)
	})

	test("while the wallet is still decoding, the card says so and shows no field", async () => {
		const w = await mountCard(sendTx([claim]))
		expect(one(w, "execute-op-payload-row").attributes("data-intent-kind")).toBe("pending")
		expect(one(w, "execute-op-args-pending").exists()).toBe(true)
		expect(w.text()).not.toContain(TO)
		expect(one(w, "execute-op-unverified-args").exists()).toBe(false)
	})

	test("an undecodable call shows the notice and keeps its raw fields behind a toggle; fields trim and small ones read as decimals", async () => {
		const w = await mountCard(sendTx([claim]), { decodedCalls: [undecoded("unknown-contract")] })
		const block = one(w, "execute-op-unverified-args")
		expect(block.attributes("data-reason")).toBe("unknown-contract")
		expect(one(w, "execute-op-unverified-warning").text()).toContain("Can't read the arguments")
		expect(block.text()).toContain("doesn't have this contract's interface")
		expect(one(w, "execute-op-raw-args").exists()).toBe(false)
		expect(w.text()).not.toContain(TO)
		const toggle = one(w, "execute-op-raw-toggle")
		expect(toggle.text()).toContain("Show 4 raw values")
		await toggle.trigger("click")
		expect(toggle.text()).toContain("Hide raw values")
		const rows = all(w, "execute-op-arg")
		expect(rows).toHaveLength(4)
		expect(rows.every((r) => r.attributes("data-arg-kind") === "field")).toBe(true)
		expect(rows[0]!.text()).toContain(trimAddress(TO, 10, 6))
		expect(rows[0]!.text()).not.toContain(TO)
		expect(rows[0]!.find("[title]").attributes("title")).toBe(TO)
		expect(rows[1]!.text()).toContain("= 5000000")
		expect(rows[0]!.text()).not.toContain("=")
		await toggle.trigger("click")
		expect(one(w, "execute-op-raw-args").exists()).toBe(false)
	})

	test("a 40-field call renders 32 rows and points at the JSON view for the rest", async () => {
		const args = Array.from({ length: 40 }, (_, i) => field(BigInt(i)))
		const w = await mountCard(sendTx([{ name: "batch", to: TOKEN, args }]), { decodedCalls: [undecoded("unknown-function")] })
		expect(one(w, "execute-op-raw-toggle").text()).toContain("Show 40 raw values")
		await one(w, "execute-op-raw-toggle").trigger("click")
		expect(all(w, "execute-op-arg")).toHaveLength(32)
		expect(one(w, "execute-op-args-more").text()).toContain("+8 more")
	})

	test("a hostile toString renders as text or unreadable, never as a field; a short batch reads as unavailable", async () => {
		const args = [{ toString: () => ({}) }, {}, { toString: () => `${TO} trust me` }]
		const w = await mountCard(sendTx([{ name: "batch", to: TOKEN, args }]), { decodedCalls: [] })
		expect(one(w, "execute-op-unverified-args").attributes("data-reason")).toBe("unavailable")
		await one(w, "execute-op-raw-toggle").trigger("click")
		const rows = all(w, "execute-op-arg")
		expect(rows.map((r) => r.attributes("data-arg-kind"))).toEqual(["opaque", "opaque", "text"])
		expect(rows[0]!.text()).toContain("(unreadable)")
	})
})
