/**
 * Color tokens visual reference.
 *
 * Renders every color token from `tokens.ts` as a swatch with its
 * variable name + resolved value. Useful for spotting unused/duplicate
 * tokens and verifying theme overrides at a glance.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { brand, colors, surfaces, text } from "./tokens"

const meta: Meta = {
	title: "Design / Colors",
	tags: ["autodocs"],
	parameters: {
		layout: "fullscreen",
	},
}
export default meta

type Story = StoryObj

const swatchSheet = (entries: Array<[string, string]>): string => `
	<div style="display: grid; grid-template-columns: 56px 1fr 1fr; gap: 12px; align-items: center; padding: 24px; font-family: var(--font-mono); font-size: 12px; color: var(--txt-primary);">
		${entries
			.map(
				([name, varName]) => `
			<div style="width: 48px; height: 48px; background: var(${varName}); border: 1px solid var(--nulo-outline);"></div>
			<div>
				<div style="color: var(--txt-primary); font-weight: 600;">${name}</div>
				<code style="color: var(--txt-secondary);">${varName}</code>
			</div>
			<div style="color: var(--txt-secondary); font-family: var(--font-mono);">
				<span style="display: inline-block; width: 12px; height: 12px; vertical-align: middle; background: var(${varName}); border: 1px solid var(--nulo-outline); margin-right: 6px;"></span>
				resolves at runtime
			</div>
		`,
			)
			.join("")}
	</div>
`

export const Surfaces: Story = {
	render: () => ({
		template: swatchSheet(Object.entries(surfaces) as Array<[string, string]>),
	}),
}

export const Brand: Story = {
	render: () => ({
		template: swatchSheet(Object.entries(brand) as Array<[string, string]>),
	}),
}

export const Text: Story = {
	render: () => ({
		template: swatchSheet(Object.entries(text) as Array<[string, string]>),
	}),
}

export const SemanticAccents: Story = {
	render: () => ({
		template: swatchSheet(Object.entries(colors) as Array<[string, string]>),
	}),
}
