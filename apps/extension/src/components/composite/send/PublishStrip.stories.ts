import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { NO_FACTS, publishFacts } from "./publish-facts"
import PublishStrip from "./PublishStrip.vue"

const meta: Meta<typeof PublishStrip> = {
	title: "Composite / Send / PublishStrip",
	component: PublishStrip,
	tags: ["autodocs"],
	args: { facts: publishFacts("private", "private", "contract") },
	render: (args) => ({
		components: { PublishStrip },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 312px;"><PublishStrip v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof PublishStrip>

export const AllHidden: Story = {}
export const NamesYouAsFeePayer: Story = { args: { facts: publishFacts("private", "private", "account") } }
export const PublicSend: Story = { args: { facts: publishFacts("public", "public", "account") } }
export const PublicOriginPrivateDestination: Story = { args: { facts: publishFacts("public", "private", "contract") } }
export const PayerNotKnownYet: Story = { args: { facts: publishFacts("private", "public", null) } }
export const NothingToSend: Story = { args: { facts: NO_FACTS } }
