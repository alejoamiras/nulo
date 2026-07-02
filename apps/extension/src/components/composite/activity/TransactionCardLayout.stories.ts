import type { Meta, StoryObj } from "@storybook/vue3-vite"
import TransactionCardLayout from "./TransactionCardLayout.vue"

const meta: Meta<typeof TransactionCardLayout> = {
	title: "Composite / TransactionCardLayout",
	component: TransactionCardLayout,
	tags: ["autodocs"],
	args: { title: "Sending 5 USDC", icon: "arrow-narrow-up-right" },
	render: (args) => ({
		components: { TransactionCardLayout },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 360px;"><TransactionCardLayout v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof TransactionCardLayout>

export const Minimal: Story = {}

export const WithAmount: Story = {
	args: { amount: "5.00", amountSymbol: "USDC" },
}

export const WithSecondary: Story = {
	render: (args) => ({
		components: { TransactionCardLayout },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px;">
				<TransactionCardLayout v-bind="args">
					<template #secondary>
						<span style="font-family: var(--font-mono); font-size: 10px; color: var(--nulo-secondary);">0xabc...def</span>
					</template>
				</TransactionCardLayout>
			</div>
		`,
	}),
}

export const WithBadge: Story = {
	render: (args) => ({
		components: { TransactionCardLayout },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px;">
				<TransactionCardLayout v-bind="args">
					<template #badge>
						<span style="font-size: 8px;">✓</span>
					</template>
				</TransactionCardLayout>
			</div>
		`,
	}),
}
