import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Tooltip from "./Tooltip.vue"

const meta: Meta<typeof Tooltip> = {
	title: "UI / Tooltip",
	component: Tooltip,
	tags: ["autodocs"],
	argTypes: {
		side: { control: "select", options: ["top", "bottom", "left", "right"] },
		position: { control: "select", options: ["start", "center", "end"] },
		textAlign: { control: "select", options: ["left", "center", "right"] },
		wide: { control: "boolean" },
		disabled: { control: "boolean" },
		delay: { control: "number" },
		inline: { control: "boolean" },
	},
	args: { side: "bottom", position: "center" },
	render: (args) => ({
		components: { Tooltip },
		setup: () => ({ args }),
		template: `
			<div style="padding: 80px; display: flex; justify-content: center;">
				<Tooltip v-bind="args">
					<button style="padding: 8px 16px; border: 1px solid #555; background: transparent; color: inherit; font-family: inherit; cursor: help;">
						Hover me
					</button>
					<template #content>This is a tooltip body.</template>
				</Tooltip>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof Tooltip>

export const Default: Story = {}
export const Top: Story = { args: { side: "top" } }
export const Right: Story = { args: { side: "right" } }
export const Left: Story = { args: { side: "left" } }
export const StartPosition: Story = { args: { position: "start" } }
export const EndPosition: Story = { args: { position: "end" } }
export const Disabled: Story = { args: { disabled: true } }
export const Delayed: Story = { args: { delay: 500 } }

const BUTTON = "padding: 8px 16px; border: 1px solid #555; background: transparent; color: inherit; font-family: inherit; cursor: help;"
const LONG = "A longer body that wraps inside the 272px cap instead of running past the edge of the window."

/** The bubble stays 8px inside the window's right edge instead of running past it. */
export const AtRightEdge: Story = {
	render: (args) => ({
		components: { Tooltip },
		setup: () => ({ args }),
		template: `
			<div style="display: flex; justify-content: flex-end; padding: 8px;">
				<Tooltip v-bind="args">
					<button style="${BUTTON}">Hover me</button>
					<template #content>${LONG}</template>
				</Tooltip>
			</div>
		`,
	}),
}

/** With no room below, the bubble flips above its trigger. */
export const AtBottom: Story = {
	render: (args) => ({
		components: { Tooltip },
		setup: () => ({ args }),
		template: `
			<div style="display: flex; align-items: flex-end; justify-content: center; height: calc(100vh - 16px);">
				<Tooltip v-bind="args">
					<button style="${BUTTON}">Hover me</button>
					<template #content>${LONG}</template>
				</Tooltip>
			</div>
		`,
	}),
}

/** An inline trigger sits on the sentence's baseline. */
export const InlineInSentence: Story = {
	args: { inline: true, textAlign: "left" },
	render: (args) => ({
		components: { Tooltip },
		setup: () => ({ args }),
		template: `
			<p style="padding: 80px; max-width: 320px; font-size: 13px; line-height: 1.45;">
				This app asks for
				<Tooltip v-bind="args">
					<span tabindex="0" style="text-decoration: underline dotted; text-underline-offset: 3px; cursor: help;">authorizations</span>
					<template #content>Lets a contract do one specific thing for you, once.</template>
				</Tooltip>
				on your account.
			</p>
		`,
	}),
}
