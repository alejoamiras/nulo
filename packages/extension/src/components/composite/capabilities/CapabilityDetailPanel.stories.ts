import type { Meta, StoryObj } from "@storybook/vue3-vite"
import CapabilityDetailPanel from "./CapabilityDetailPanel.vue"

const meta: Meta<typeof CapabilityDetailPanel> = {
	title: "Composite / CapabilityDetailPanel",
	component: CapabilityDetailPanel,
	tags: ["autodocs"],
	args: { granted: false },
	render: (args) => ({
		components: { CapabilityDetailPanel },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 400px;"><CapabilityDetailPanel v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof CapabilityDetailPanel>

export const AccountsCapability: Story = {
	// biome-ignore lint/suspicious/noExplicitAny: story fixture — minimal capability shape
	args: { capability: { type: "accounts", canGet: true, canCreateAuthWit: true } as any },
}

export const ContractsAnyScope: Story = {
	// biome-ignore lint/suspicious/noExplicitAny: story fixture — minimal capability shape
	args: { capability: { type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true } as any },
}

export const ContractsExplicitList: Story = {
	args: {
		capability: {
			type: "contracts",
			contracts: ["0xabc1234567890def", "0xdef9876543210abc"],
			canRegister: true,
			// biome-ignore lint/suspicious/noExplicitAny: story fixture
		} as any,
	},
}

export const ContractClassesAny: Story = {
	// biome-ignore lint/suspicious/noExplicitAny: story fixture — minimal capability shape
	args: { capability: { type: "contractClasses", classes: "*" } as any },
}

export const Granted: Story = {
	// biome-ignore lint/suspicious/noExplicitAny: story fixture — minimal capability shape
	args: { capability: { type: "accounts", canGet: true } as any, granted: true },
}
