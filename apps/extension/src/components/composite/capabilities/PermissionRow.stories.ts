import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { ref } from "vue"
import PermissionRow from "./PermissionRow.vue"

const meta: Meta<typeof PermissionRow> = {
	title: "Composite / PermissionRow",
	component: PermissionRow,
	tags: ["autodocs"],
	args: {
		icon: "signature",
		title: "Act for you in transactions you approve",
		subOn: "Nulo signs its authorizations without asking.",
		subOff: "You confirm each authorization first.",
		switchLabel: "Authorizations without asking",
		modelValue: true,
	},
	render: (args) => ({
		components: { PermissionRow },
		setup: () => {
			const on = ref(args.modelValue)
			return { args, on }
		},
		template: '<div style="padding: 24px; width: 360px;"><PermissionRow v-bind="args" v-model="on" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof PermissionRow>

export const SwitchOn: Story = {}

export const SwitchOff: Story = { args: { modelValue: false } }

export const Broad: Story = {
	args: {
		subOn: "For any call, on any contract.",
		subOff: "You confirm each authorization first. Off because it listed any contract.",
		flagged: true,
		modelValue: false,
	},
}

export const NoSwitch: Story = {
	args: { switchLabel: undefined, subOff: undefined, subOn: "You confirm each authorization first." },
}

export const AnyContractChip: Story = {
	args: {
		icon: "play_circle",
		title: "Run simulations on any contract",
		subOn: "Results can include your private balances.",
		subOff: undefined,
		switchLabel: undefined,
		flagged: true,
		chip: "Any contract",
	},
}
