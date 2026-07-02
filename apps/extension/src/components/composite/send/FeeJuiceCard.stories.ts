import type { Meta, StoryObj } from "@storybook/vue3-vite"
import FeeJuiceCard from "./FeeJuiceCard.vue"

const meta: Meta<typeof FeeJuiceCard> = {
	title: "Composite / FeeJuiceCard",
	component: FeeJuiceCard,
	tags: ["autodocs"],
	render: () => ({
		components: { FeeJuiceCard },
		template: '<div style="padding: 24px; width: 360px;"><FeeJuiceCard /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof FeeJuiceCard>

export const Default: Story = {}
