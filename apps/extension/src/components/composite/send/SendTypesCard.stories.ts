import type { Meta, StoryObj } from "@storybook/vue3-vite"
import SendTypesCard from "./SendTypesCard.vue"

const fullToken = {
	hasPrivateTransfers: true,
	hasPublicTransfers: true,
	hasPrivateBalances: true,
	hasPublicBalances: true,
}

const meta: Meta<typeof SendTypesCard> = {
	title: "Composite / SendTypesCard",
	component: SendTypesCard,
	tags: ["autodocs"],
	args: { token: fullToken, sendType: "private", receiverType: "private" },
	render: (args) => ({
		components: { SendTypesCard },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 360px;"><SendTypesCard v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof SendTypesCard>

export const PrivateToPrivate: Story = { args: { sendType: "private", receiverType: "private" } }
export const PublicToPrivate: Story = { args: { sendType: "public", receiverType: "private" } }
export const PrivateOnly: Story = {
	args: { token: { ...fullToken, hasPublicTransfers: false, hasPublicBalances: false } },
}
