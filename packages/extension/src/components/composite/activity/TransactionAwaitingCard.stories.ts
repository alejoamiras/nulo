import type { Meta, StoryObj } from "@storybook/vue3-vite"
import TransactionAwaitingCard from "./TransactionAwaitingCard.vue"

const meta: Meta<typeof TransactionAwaitingCard> = {
	title: "Composite / TransactionAwaitingCard",
	component: TransactionAwaitingCard,
	tags: ["autodocs"],
	// box-sizing: border-box so the wrapper is 360px total (matches the popup
	// width), with 24px of inner padding leaving 312px of card width — same
	// budget the production card gets inside .content. Without border-box the
	// story would render a 408px-wide card and silently mask width-pressure
	// regressions like the one this story is here to demonstrate.
	render: (args) => ({
		components: { TransactionAwaitingCard },
		setup: () => ({ args }),
		template: '<div style="box-sizing: border-box; padding: 24px; width: 360px;"><TransactionAwaitingCard v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof TransactionAwaitingCard>

export const Default: Story = {}
export const SendingTransfer: Story = {
	args: { title: "Sending 5 USDC", subtitle: "Generating proofs", amount: "5.00", amountSymbol: "USDC" },
}
export const DappOriginated: Story = {
	args: { title: "Calling contract", originLabel: "example.dapp.io" },
}

/**
 * Width-pressure regression scenario: long subtitle ("Generating proof...")
 * + transfer-direction chip ("Private → Public") + amount + cancel button.
 * Before the chip-fit work the chip wrapped onto a 2nd visual line and the
 * subtitle pushed off-grid. Now the subtitle ellipsis-clamps and the chip
 * stays put with the X button sitting outside the card in the page-padding
 * gutter.
 */
export const TransferUnderWidthPressure: Story = {
	args: {
		title: "USDC",
		subtitle: "Generating proof...",
		icon: "arrow-narrow-up-right",
		amount: "5.00",
		amountSymbol: "USDC",
		transferTypeLabel: "Private → Public",
		cancellable: true,
		jobId: "story-1",
		stage: "proving",
	},
}
