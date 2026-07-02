import type { Meta, StoryObj } from "@storybook/vue3-vite"
import SecretRevealCard from "./SecretRevealCard.vue"

const meta: Meta<typeof SecretRevealCard> = {
	title: "Composite / SecretRevealCard",
	component: SecretRevealCard,
	tags: ["autodocs"],
	args: { value: "scratch frozen liver curtain pact buyer ...", label: "Seed Phrase" },
	render: (args) => ({
		components: { SecretRevealCard },
		setup: () => ({ args }),
		template:
			'<div style="padding: 24px; width: 360px; background: var(--app-bg);"><SecretRevealCard v-bind="args" @copy="() => {}" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof SecretRevealCard>

export const SeedPhrase: Story = {}
export const PrivateKey: Story = {
	args: { value: `0x${"a".repeat(64)}`, label: "Plain Key" },
}
export const EncryptedBackup: Story = {
	args: { value: "v1:base64-encrypted-blob...", label: "Encrypted Key" },
}
export const Copied: Story = {
	args: { isCopied: true },
}
