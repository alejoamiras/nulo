/**
 * Typography tokens visual reference.
 *
 * Renders the font family / size / weight / line-height scales so you
 * can see the full type system on one page.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { fontSizes, fontWeights, fonts, lineHeights } from "./tokens"

const meta: Meta = {
	title: "Design / Typography",
	tags: ["autodocs"],
	parameters: {
		layout: "fullscreen",
	},
}
export default meta

type Story = StoryObj

export const Families: Story = {
	render: () => ({
		template: `
			<div style="display: grid; grid-template-columns: 200px 1fr; gap: 24px; padding: 24px; color: var(--txt-primary); font-size: 14px;">
				<div>
					<code style="color: var(--txt-secondary);">${fonts.headline}</code>
					<div style="color: var(--txt-tertiary); margin-top: 4px;">--font-headline</div>
				</div>
				<div style="font-family: var(${fonts.headline}); font-size: 24px;">
					Brutalist headline display.<br/>The quick brown fox jumps over the lazy dog.
				</div>

				<div>
					<code style="color: var(--txt-secondary);">${fonts.body}</code>
					<div style="color: var(--txt-tertiary); margin-top: 4px;">--font-body</div>
				</div>
				<div style="font-family: var(${fonts.body}); font-size: 16px;">
					Body text for paragraphs and dense UI.<br/>The quick brown fox jumps over the lazy dog.
				</div>

				<div>
					<code style="color: var(--txt-secondary);">${fonts.mono}</code>
					<div style="color: var(--txt-tertiary); margin-top: 4px;">--font-mono</div>
				</div>
				<div style="font-family: var(${fonts.mono}); font-size: 14px;">
					0xa1f0... Mono surface.<br/>The quick brown fox jumps over the lazy dog.
				</div>
			</div>
		`,
	}),
}

export const Sizes: Story = {
	render: () => ({
		template: `
			<div style="display: grid; grid-template-columns: 80px 1fr; gap: 12px; align-items: baseline; padding: 24px; color: var(--txt-primary); font-family: var(--font-body);">
				${fontSizes
					.map(
						(s) => `
					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">.fz--${s}</code>
					<div style="font-size: ${s}px;">Aa Bb Cc — ${s}px</div>
				`,
					)
					.join("")}
			</div>
		`,
	}),
}

export const Weights: Story = {
	render: () => ({
		template: `
			<div style="display: grid; grid-template-columns: 80px 1fr; gap: 12px; align-items: baseline; padding: 24px; color: var(--txt-primary); font-family: var(--font-body); font-size: 18px;">
				${fontWeights
					.map(
						(w) => `
					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">.fw--${w}</code>
					<div style="font-weight: ${w};">Brutalist weight ${w}</div>
				`,
					)
					.join("")}
			</div>
		`,
	}),
}

export const LineHeights: Story = {
	render: () => ({
		template: `
			<div style="display: grid; grid-template-columns: 80px 1fr; gap: 16px; align-items: baseline; padding: 24px; color: var(--txt-primary); font-family: var(--font-body); font-size: 14px;">
				${Object.entries(lineHeights)
					.map(
						([key, value]) => `
					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">.lh--${key}</code>
					<div style="line-height: ${value}; max-width: 400px; border-left: 2px solid var(--nulo-outline); padding-left: 12px;">
						The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. ${value}× line height.
					</div>
				`,
					)
					.join("")}
			</div>
		`,
	}),
}
