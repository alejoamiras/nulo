/**
 * Motion tokens visual reference.
 *
 * Demonstrates the easing curve + duration scale via animated swatches.
 * Helps spot inconsistent motion across the app.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { durations, easings } from "./tokens"

const meta: Meta = {
	title: "Design / Motion",
	tags: ["autodocs"],
	parameters: {
		layout: "fullscreen",
	},
}
export default meta

type Story = StoryObj

export const Easings: Story = {
	render: () => ({
		template: `
			<div style="padding: 24px; color: var(--txt-primary); font-family: var(--font-body);">
				<div style="margin-bottom: 16px;">
					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">${easings.bezier}</code>
					<div style="color: var(--txt-tertiary); font-size: 12px; margin-top: 4px;">cubic-bezier(0.19, 1, 0.22, 1) — used by every transition in _base.scss</div>
				</div>
				<div style="background: var(--nulo-surface); padding: 24px; border: 1px solid var(--nulo-outline); position: relative; overflow: hidden;">
					<div id="motion-swatch" style="width: 48px; height: 48px; background: var(--nulo-accent); transition: transform 1.2s var(${easings.bezier}); transform: translateX(0);"></div>
				</div>
				<div style="margin-top: 12px; color: var(--txt-secondary); font-size: 12px;">
					<button type="button" onclick="
						const el = document.getElementById('motion-swatch');
						if (!el) return;
						const cur = el.style.transform;
						el.style.transform = cur.includes('400') ? 'translateX(0)' : 'translateX(400px)';
					" style="background: var(--nulo-surface-high); color: var(--txt-primary); border: 1px solid var(--nulo-outline); padding: 8px 16px; cursor: pointer; font-family: var(--font-mono); font-size: 12px;">animate</button>
				</div>
			</div>
		`,
	}),
}

export const Durations: Story = {
	render: () => ({
		template: `
			<div style="display: grid; grid-template-columns: 120px 1fr; gap: 16px; align-items: center; padding: 24px; color: var(--txt-primary); font-family: var(--font-body);">
				${Object.entries(durations)
					.map(
						([name, value]) => `
					<div>
						<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">${name}</code>
						<div style="color: var(--txt-tertiary); font-size: 12px; margin-top: 2px;">${value}</div>
					</div>
					<div style="background: var(--nulo-surface); padding: 16px; border: 1px solid var(--nulo-outline);">
						<div class="dur-${name}" style="width: 32px; height: 32px; background: var(--nulo-accent); animation: dur-${name}-anim ${value} ease-in-out infinite alternate;"></div>
					</div>
				`,
					)
					.join("")}
				<style>
					@keyframes dur-short-anim { from { transform: translateX(0); } to { transform: translateX(200px); } }
					@keyframes dur-medium-anim { from { transform: translateX(0); } to { transform: translateX(200px); } }
					@keyframes dur-long-anim { from { transform: translateX(0); } to { transform: translateX(200px); } }
				</style>
			</div>
		`,
	}),
}
