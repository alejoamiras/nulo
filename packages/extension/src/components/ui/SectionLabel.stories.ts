import type { Meta, StoryObj } from "@storybook/vue3-vite"
import SectionLabel from "./SectionLabel.vue"

const meta: Meta<typeof SectionLabel> = {
	title: "UI / SectionLabel",
	component: SectionLabel,
	tags: ["autodocs"],
	argTypes: {
		label: { control: "text" },
		count: { control: "text" },
	},
	args: { label: "Section title" },
	render: (args) => ({
		components: { SectionLabel },
		setup: () => ({ args }),
		template: '<div style="padding: 24px;"><SectionLabel v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof SectionLabel>

export const Default: Story = {}
export const WithCount: Story = { args: { count: 3 } }
export const ZeroCount: Story = { args: { count: 0 } }
export const StringCount: Story = { args: { count: "12+" } }
