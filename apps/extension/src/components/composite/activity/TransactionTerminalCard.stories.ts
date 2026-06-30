import type { Meta, StoryObj } from "@storybook/vue3-vite"
import TransactionTerminalCard from "./TransactionTerminalCard.vue"

const meta: Meta<typeof TransactionTerminalCard> = {
	title: "Composite / TransactionTerminalCard",
	component: TransactionTerminalCard,
	tags: ["autodocs"],
	argTypes: {
		color: { control: "select", options: ["gray", "amber", "red"] },
		icon: { control: "text" },
		activityIcon: { control: "text" },
	},
	render: (args) => ({
		components: { TransactionTerminalCard },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 360px;"><TransactionTerminalCard v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof TransactionTerminalCard>

/** Cancelled — neutral gray. User-initiated; "you did this on purpose". */
export const Cancelled: Story = {
	args: {
		title: "Send 5 USDC",
		subtitle: "Cancelled",
		icon: "cancel",
		color: "gray",
		activityIcon: "arrow-narrow-up-right",
		amount: "5.00",
		amountSymbol: "USDC",
	},
}

/** Interrupted — amber. SW restart or stuck prove; recoverable. */
export const Interrupted: Story = {
	args: {
		title: "Swap Tokens For Exact Tokens",
		subtitle: "Transaction was interrupted",
		icon: "refresh-circle",
		color: "amber",
		activityIcon: "zap",
		originLabel: "swap.aztec-kit.example",
	},
}

/** Failed — red. Real failure (network in this story). */
export const FailedNetwork: Story = {
	args: {
		title: "Swap Tokens For Exact Tokens",
		subtitle: "Network error",
		icon: "close-circle",
		color: "red",
		activityIcon: "zap",
		originLabel: "swap.aztec-kit.example",
	},
}

/** Failed — red. Simulation failure subtitle. */
export const FailedSimulation: Story = {
	args: {
		title: "Send 5 USDC",
		subtitle: "Simulation failed",
		icon: "close-circle",
		color: "red",
		activityIcon: "arrow-narrow-up-right",
		amount: "5.00",
		amountSymbol: "USDC",
	},
}
