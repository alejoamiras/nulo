import { mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { humanizeMethodName } from "@/utils/tx-enrichment"
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
const mountCard = (op: unknown) =>
	mount(OperationCard, { props: { op: op as never, index: 0 }, global: { stubs, mocks: { humanizeMethodName } } })

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
