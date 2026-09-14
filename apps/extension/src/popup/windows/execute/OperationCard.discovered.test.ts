/**
 * The card lists the private authorizations the wallet will sign for a dApp
 * `aztec_sendTx` — from the fee estimate for a standard operation, from the
 * authorization preview for a `default_entrypoint` one — and says so when an
 * embedded-fee standard operation adds none. `send_transaction` never lists any:
 * its confirm adds none.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OperationCard from "./OperationCard.vue"

const OWNER = "0xowner0000000000000000000000000000000000000000000000000000000cc"
const CALLER = "0xcaller000000000000000000000000000000000000000000000000000000dd"
const CONSUMER = "0xconsumer00000000000000000000000000000000000000000000000000000ee"

const authwit = (tag: string) => ({
	consumer: CONSUMER,
	caller: CALLER,
	selector: "0x1234abcd",
	args: [`arg-${tag}`, "\u202eevil"],
	innerHash: `0xinner${tag}`,
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
const mocks = {
	trimAddress: (a: string) => a,
	humanizeMethodName: (m: string) => m,
	humanizeOperationKind: (k: string) => k,
}
const mountCard = (op: unknown, props: Record<string, unknown> = {}) =>
	mount(OperationCard, { props: { op: op as never, index: 0, ...props }, global: { stubs, mocks } })

describe("OperationCard — discovered authorizations", () => {
	test("a standard aztec_sendTx lists what the estimate found: consumer, delegate, function, args, inner hash", () => {
		const w = mountCard(sendTx({ calls: [] }), { feeEstimate: estimate([authwit("a"), authwit("b")]) })
		const rows = w.findAll('[data-testid="execute-op-discovered-authwit"]')
		expect(rows).toHaveLength(2)
		expect(rows[0]!.attributes("data-message-hash")).toBe("0xmsga")
		const html = rows[0]!.html()
		expect(html).toContain(CONSUMER)
		expect(html).toContain(CALLER)
		expect(html).toContain("0x1234abcd")
		expect(html).toContain("arg-a")
		expect(html).toContain("0xinnera")
		// A bidi override in an argument is sanitized, never rendered raw.
		expect(html).not.toContain("\u202e")
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

	test("an embedded-fee standard operation says the wallet adds none", () => {
		const op = sendTx({ calls: [], feePayer: "0xfpc" }, { feeSettings: { paymentMethod: { kind: "embedded" } } })
		const w = mountCard(op, { feeEstimate: estimate([authwit("x")]) })
		expect(w.find('[data-testid="execute-op-no-wallet-authwits"]').exists()).toBe(true)
		expect(w.find('[data-testid="execute-op-discovered-authwits"]').exists()).toBe(false)
	})

	test("a default_entrypoint operation lists its preview, and shows the pending state while it runs", () => {
		const op = sendTx({ calls: [] }, { executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })
		const listed = mountCard(op, { authwitPreview: { previewId: "pv", discoveredAuthwits: [authwit("n")] } })
		expect(listed.findAll('[data-testid="execute-op-discovered-authwit"]')).toHaveLength(1)
		expect(listed.find('[data-testid="execute-op-no-wallet-authwits"]').exists()).toBe(false)
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
		expect(w.find('[data-testid="execute-op-no-wallet-authwits"]').exists()).toBe(false)
	})
})
