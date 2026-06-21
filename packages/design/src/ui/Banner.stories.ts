import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Banner from "./Banner.vue"

const meta: Meta<typeof Banner> = {
	title: "UI / Banner",
	component: Banner,
	tags: ["autodocs"],
	argTypes: {
		variant: { control: "select", options: ["info", "done", "warning", "error"] },
		direction: { control: "select", options: ["horizontal", "vertical"] },
		isLoading: { control: "boolean" },
		wide: { control: "boolean" },
	},
	args: { variant: "info", direction: "horizontal", wide: true },
	render: (args) => ({
		components: { Banner },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px;">
				<Banner v-bind="args">
					Title text
					<template #description>Description text providing more context.</template>
				</Banner>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof Banner>

export const Info: Story = { args: { variant: "info" } }
export const Done: Story = { args: { variant: "done" } }
export const Warning: Story = { args: { variant: "warning" } }
export const ErrorState: Story = { args: { variant: "error" } }
export const Loading: Story = { args: { isLoading: true } }
export const Vertical: Story = { args: { direction: "vertical" } }
export const WithAction: Story = {
	args: {},
	render: (args) => ({
		components: { Banner },
		setup() {
			return { args: { ...args, action: { name: "Action", callback: () => {} } } }
		},
		template: `
			<div style="padding: 24px; width: 360px;">
				<Banner v-bind="args">
					Title text
					<template #description>With an action button.</template>
				</Banner>
			</div>
		`,
	}),
}
