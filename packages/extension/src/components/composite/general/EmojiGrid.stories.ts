import type { Meta, StoryObj } from "@storybook/vue3-vite"
import EmojiGrid from "./EmojiGrid.vue"

const meta: Meta<typeof EmojiGrid> = {
	title: "Composite / EmojiGrid",
	component: EmojiGrid,
	tags: ["autodocs"],
	args: { emojis: "🐷🐔🐮🦊🐭🦁🐶🐱🐰" },
	render: (args) => ({
		components: { EmojiGrid },
		setup: () => ({ args }),
		template: '<div style="padding: 24px;"><EmojiGrid v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof EmojiGrid>

export const Default: Story = {}
export const FewerThanNine: Story = { args: { emojis: "🐷🐔🐮" } }
export const Mixed: Story = { args: { emojis: "🚀🌟🎨🌊🍕🎮🎵🌈🦋" } }
