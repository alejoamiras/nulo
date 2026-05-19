import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Toggle from "./Toggle.vue"

const meta: Meta<typeof Toggle> = {
	title: "UI / Toggle",
	component: Toggle,
	tags: ["autodocs"],
	argTypes: {
		modelValue: { control: "boolean" },
		disabled: { control: "boolean" },
		protected: { control: "boolean" },
	},
	args: { modelValue: false },
	render: (args) => ({
		components: { Toggle },
		setup: () => ({ args }),
		data() {
			return { value: (args as { modelValue: boolean }).modelValue }
		},
		template: '<div style="padding: 24px;"><Toggle v-bind="args" v-model="value" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof Toggle>

export const Off: Story = { args: { modelValue: false } }
export const On: Story = { args: { modelValue: true } }
export const Disabled: Story = { args: { disabled: true } }
export const Protected: Story = { args: { protected: true, modelValue: true } }

export const StateMatrix: Story = {
	render: () => ({
		components: { Toggle },
		template: `
			<div style="display: flex; flex-direction: column; gap: 12px; padding: 24px;">
				<div style="display: flex; align-items: center; gap: 12px;"><code>off</code><Toggle :modelValue="false" /></div>
				<div style="display: flex; align-items: center; gap: 12px;"><code>on</code><Toggle :modelValue="true" /></div>
				<div style="display: flex; align-items: center; gap: 12px;"><code>disabled</code><Toggle :disabled="true" /></div>
				<div style="display: flex; align-items: center; gap: 12px;"><code>protected</code><Toggle :protected="true" :modelValue="true" /></div>
			</div>
		`,
	}),
}
