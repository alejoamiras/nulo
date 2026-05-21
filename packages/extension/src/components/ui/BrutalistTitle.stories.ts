import type { Meta, StoryObj } from "@storybook/vue3-vite"
import BrutalistTitle from "./BrutalistTitle.vue"

const meta: Meta<typeof BrutalistTitle> = {
	title: "UI / BrutalistTitle",
	component: BrutalistTitle,
	tags: ["autodocs"],
	argTypes: {
		main: { control: "text" },
		sub: { control: "text" },
		align: { control: "select", options: ["left", "center"] },
		size: { control: "select", options: ["default", "hero"] },
	},
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: { main: "Create", sub: "Profile" },
}

export const HeroCenter: Story = {
	args: { main: "Welcome", sub: "to Nulo", align: "center", size: "hero" },
}

export const DefaultCenter: Story = {
	args: { main: "You're", sub: "In", align: "center" },
}
