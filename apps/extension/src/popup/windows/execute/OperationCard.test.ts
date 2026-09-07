import { mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { trimAddress } from "@/utils/string"
import { humanizeMethodName } from "@/utils/tx-enrichment"
import OperationActionRow from "./OperationActionRow.vue"
import OperationCard from "./OperationCard.vue"

const mounts = vi.hoisted(() => ({ count: 0 }))
const stubs = {
	Flex: { inheritAttrs: false, template: `<div v-bind="$attrs"><slot /></div>` },
	Text: { inheritAttrs: false, template: `<span v-bind="$attrs"><slot /></span>` },
	AddressDisplay: {
		props: ["address"],
		setup() {
			mounts.count++
		},
		template: `<i data-testid="address" :data-address="address" />`,
	},
	FeeSettingsCard: true,
	Icon: true,
	Badge: true,
	Tooltip: true,
}

const execOp = (kind: "aztec_simulateTx" | "aztec_profileTx", to: string) => ({
	kind,
	networkId: "net",
	accountAddress: "0xacct",
	exec: { calls: [{ name: "transfer", to, selector: undefined }] },
	opts: {},
})

// The template reaches this util through the build's auto-import; vitest registers none, so it rides on the instance.
const authwitOp = (kind: "send_transaction" | "simulate_transaction") => ({
	kind,
	account: { name: "Owner", address: "0xacct" },
	actions: [
		{ kind: "call", contract: "0xtoken", method: "transfer", args: [] },
		{
			kind: "add_public_authwit",
			content: { kind: "call", caller: "0xspender", contract: "0xtoken", method: "transfer_in_public", args: ["1", "2"] },
		},
	],
})

const mountCard = (op: unknown) =>
	mount(OperationCard, {
		props: { op: op as never, index: 0 },
		global: { stubs, components: { OperationActionRow }, mocks: { humanizeMethodName, trimAddress } },
	})

describe("windows/execute/OperationCard", () => {
	test("simulate and profile render the same payload rows", () => {
		for (const kind of ["aztec_simulateTx", "aztec_profileTx"] as const) {
			const w = mountCard(execOp(kind, "0xaaa"))
			const row = w.find("[data-testid='execute-op-payload-row']")
			expect(row.exists()).toBe(true)
			expect(row.attributes("data-call-to")).toBe("0xaaa")
			expect(w.find("[data-testid='address']").attributes("data-address")).toBe("0xaaa")
		}
	})

	test("switching the kind with a new destination remounts the payload subtree", async () => {
		const w = mountCard(execOp("aztec_simulateTx", "0xaaa"))
		const before = mounts.count
		await w.setProps({ op: execOp("aztec_profileTx", "0xbbb") as never })
		expect(w.find("[data-testid='address']").attributes("data-address")).toBe("0xbbb")
		expect(mounts.count).toBe(before + 1)
	})
})

describe("windows/execute/OperationCard — action rows", () => {
	test.each(["send_transaction", "simulate_transaction"] as const)(
		"%s renders a public authwit with its spender, method, contract and args",
		(kind) => {
			const w = mountCard(authwitOp(kind))
			const rows = w.findAll("[data-testid='execute-op-payload-row']")
			expect(rows).toHaveLength(2)
			expect(rows[1]?.text()).toContain("Authorize public spend")
			expect(rows[1]?.find("[data-testid='execute-authwit-spender']").attributes("data-address")).toBe("0xspender")
			expect(rows[1]?.text()).toContain("Transfer (public)")
			expect(rows[1]?.find("[data-testid='execute-authwit-args']").text()).toBe("1, 2")
			expect(rows[1]?.text()).not.toContain("add public authwit")
		},
	)
})
