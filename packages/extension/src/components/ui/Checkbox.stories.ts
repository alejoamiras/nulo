import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Checkbox from "./Checkbox.vue"

const meta: Meta<typeof Checkbox> = {
	title: "UI / Checkbox",
	component: Checkbox,
	tags: ["autodocs"],
	argTypes: {
		modelValue: { control: "boolean" },
		checked: { control: "boolean" },
		disabled: { control: "boolean" },
	},
	args: { modelValue: false },
	render: (args) => ({
		components: { Checkbox },
		setup: () => ({ args }),
		data() {
			return { value: (args as { modelValue: boolean }).modelValue }
		},
		template: '<div style="padding: 24px;"><Checkbox v-bind="args" v-model="value">I agree to the terms</Checkbox></div>',
	}),
}
export default meta

type Story = StoryObj<typeof Checkbox>

export const Unchecked: Story = { args: { modelValue: false } }
export const Checked: Story = { args: { modelValue: true } }
export const Disabled: Story = { args: { disabled: true } }
export const ForcedChecked: Story = { args: { checked: true } }

export const StateMatrix: Story = {
	render: () => ({
		components: { Checkbox },
		template: `
			<div style="display: flex; flex-direction: column; gap: 12px; padding: 24px;">
				<Checkbox :modelValue="false">Unchecked</Checkbox>
				<Checkbox :modelValue="true">Checked</Checkbox>
				<Checkbox :checked="true">Forced checked (no model)</Checkbox>
				<Checkbox :disabled="true">Disabled</Checkbox>
			</div>
		`,
	}),
}
