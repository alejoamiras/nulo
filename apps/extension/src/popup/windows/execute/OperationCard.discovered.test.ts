/**
 * The card lists the private authorizations the wallet will sign for a dApp
 * `aztec_sendTx` — from the fee estimate for a standard operation, from the
 * authorization preview for a `default_entrypoint` one. An operation with nothing
 * to list renders no block at all: `send_transaction`, whose confirm adds none, and
 * an embedded-fee standard one, whose discovery is skipped. Each entry is a summary
 * row; its arguments and inner hash sit behind a toggle.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OperationCard from "./OperationCard.vue"

const OWNER = "0xowner0000000000000000000000000000000000000000000000000000000cc"
const CALLER = "0xcaller000000000000000000000000000000000000000000000000000000dd"
const CONSUMER = "0xconsumer00000000000000000000000000000000000000000000000000000ee"
const INNER = `0x${"f".repeat(64)}`

const authwit = (tag: string) => ({
	consumer: CONSUMER,
	caller: CALLER,
	selector: "0x1234abcd",
	args: [`arg-${tag}`, "‮evil"],
	innerHash: INNER,
	messageHash: `0xmsg${tag}`,
})
const estimate = (discoveredAuthwits?: unknown[]) => ({
	maxFee: "1",
	maxFeeFormatted: "0.000001",
	gasDetails: { l2GasLimit: 0, daGasLimit: 0, teardownL2GasLimit: 0, teardownDaGasLimit: 0, feePerL2Gas: "1", feePerDaGas: "1" },
	...(discoveredAuthwits ? { discoveredAuthwits } : {}),
})
const sendTx = (exec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	kind: "aztec_sendTx" as const,
	networkId: "net-1",
	accountAddress: OWNER,
	account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
	network: { id: "net-1", chainId: 1, name: "N" },
	exec,
	opts: { from: OWNER },
	feeSettings: { paymentMethod: { kind: "fj" } },
	...extra,
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

describe("OperationCard — discovered authorizations", () => {
	test("a standard aztec_sendTx lists what the estimate found: consumer, delegate and function; args and inner hash behind the toggle", async () => {
		const w = mountCard(sendTx({ calls: [] }), { feeEstimate: estimate([authwit("a"), authwit("b")]) })
		const rows = w.findAll('[data-testid="execute-op-discovered-authwit"]')
		expect(rows).toHaveLength(2)
		expect(rows[0]!.attributes("data-message-hash")).toBe("0xmsga")
		const summary = rows[0]!.html()
		expect(summary).toContain(CONSUMER)
		expect(summary).toContain(CALLER)
		expect(summary).toContain("0x1234abcd")
		expect(summary).not.toContain("arg-a")
		expect(summary).not.toContain(INNER)
		await rows[0]!.find('[data-testid="execute-discovered-authwit-toggle"]').trigger("click")
		const details = rows[0]!.find('[data-testid="execute-discovered-authwit-details"]')
		expect(details.exists()).toBe(true)
		expect(details.text()).toContain("Reading arguments…")
		expect(details.find("[title]").attributes("title")).toBe(INNER)
		expect(details.text()).not.toContain(INNER)
	})

	test("a decoded authorization names its function and parameters; an undecoded one shows the raw values, bidi sanitized", async () => {
		const decodedAuthwits = new Map([
			[
				"0xmsga",
				{
					kind: "decoded",
					contract: "Token",
					fn: "transfer_in_private",
					params: [{ name: "amount", value: { kind: "integer", value: "5" } }],
				},
			],
			["0xmsgb", { kind: "undecoded", reason: "unknown-contract" }],
		])
		const w = mountCard(sendTx({ calls: [] }), { feeEstimate: estimate([authwit("a"), authwit("b")]), decodedAuthwits })
		const [a, b] = w.findAll('[data-testid="execute-op-discovered-authwit"]')
		expect(a!.find('[data-testid="execute-discovered-authwit-function"]').text()).not.toContain("0x1234abcd")
		expect(b!.find('[data-testid="execute-discovered-authwit-function"]').text()).toContain("0x1234abcd")
		await a!.find('[data-testid="execute-discovered-authwit-toggle"]').trigger("click")
		expect(a!.findAll('[data-testid="execute-discovered-authwit-decoded-param"]')).toHaveLength(1)
		await b!.find('[data-testid="execute-discovered-authwit-toggle"]').trigger("click")
		expect(b!.find('[data-testid="execute-discovered-authwit-unverified-warning"]').exists()).toBe(true)
		await b!.find('[data-testid="execute-discovered-authwit-raw-toggle"]').trigger("click")
		const html = b!.html()
		expect(html).toContain("arg-b")
		expect(html).not.toContain("‮")
	})

	test("zero entries render nothing; without an estimate nothing renders either", () => {
		expect(
			mountCard(sendTx({ calls: [] }), { feeEstimate: estimate([]) })
				.find('[data-testid="execute-op-discovered-authwits"]')
				.exists(),
		).toBe(false)
		expect(
			mountCard(sendTx({ calls: [] }))
				.find('[data-testid="execute-op-discovered-authwits"]')
				.exists(),
		).toBe(false)
	})

	test("an embedded-fee standard operation renders no authorization block at all", () => {
		const op = sendTx({ calls: [], feePayer: "0xfpc" }, { feeSettings: { paymentMethod: { kind: "embedded" } } })
		const w = mountCard(op, { feeEstimate: estimate([authwit("x")]) })
		expect(w.find('[data-testid="execute-op-discovered-authwits"]').exists()).toBe(false)
		expect(w.find('[data-testid="execute-op-authwits-pending"]').exists()).toBe(false)
	})

	test("a default_entrypoint operation lists its preview, and shows the pending state while it runs", () => {
		const op = sendTx({ calls: [] }, { executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })
		const listed = mountCard(op, { authwitPreview: { previewId: "pv", discoveredAuthwits: [authwit("n")] } })
		expect(listed.findAll('[data-testid="execute-op-discovered-authwit"]')).toHaveLength(1)
		const pending = mountCard(op, { isPreviewing: true })
		expect(pending.find('[data-testid="execute-op-authwits-pending"]').exists()).toBe(true)
	})

	test("send_transaction never lists discovered authorizations", () => {
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: OWNER,
			account: { name: "Owner", address: OWNER },
			network: { id: "net-1", chainId: 1, name: "N" },
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [],
		}
		const w = mountCard(op, { feeEstimate: estimate([authwit("s")]) })
		expect(w.find('[data-testid="execute-op-discovered-authwits"]').exists()).toBe(false)
	})
})
