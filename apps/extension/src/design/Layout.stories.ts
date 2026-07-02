/**
 * Layout tokens visual reference.
 *
 * The popup runs at fixed dimensions (--base-width × --base-height)
 * with an optional bottom-nav clearance. This panel surfaces the
 * actual chrome the wallet renders at.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { borders, layout } from "./tokens"

const meta: Meta = {
	title: "Design / Layout & Borders",
	tags: ["autodocs"],
	parameters: {
		layout: "fullscreen",
	},
}
export default meta

type Story = StoryObj

export const PopupChrome: Story = {
	render: () => ({
		template: `
			<div style="padding: 24px; color: var(--txt-primary); font-family: var(--font-body);">
				<div style="display: grid; grid-template-columns: 200px 1fr; gap: 12px; align-items: center; margin-bottom: 24px;">
					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">${layout.baseWidth}</code>
					<div style="color: var(--txt-tertiary); font-size: 12px;">popup width</div>

					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">${layout.baseHeight}</code>
					<div style="color: var(--txt-tertiary); font-size: 12px;">popup height</div>

					<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">${layout.navClearance}</code>
					<div style="color: var(--txt-tertiary); font-size: 12px;">bottom-nav clearance</div>
				</div>

				<div style="display: flex; align-items: flex-start; gap: 24px;">
					<div style="position: relative; width: var(${layout.baseWidth}); height: var(${layout.baseHeight}); background: var(--nulo-surface); border: 2px solid var(--nulo-outline); overflow: hidden;">
						<div style="position: absolute; top: 0; left: 0; right: 0; padding: 12px; background: var(--nulo-surface-high); font-family: var(--font-mono); font-size: 11px; color: var(--txt-secondary); border-bottom: 1px solid var(--nulo-outline);">popup chrome</div>
						<div style="position: absolute; bottom: 0; left: 0; right: 0; height: var(${layout.navClearance}); background: var(--nulo-surface-low); border-top: 1px solid var(--nulo-outline); display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 11px; color: var(--txt-secondary);">nav clearance</div>
					</div>
					<div style="font-size: 12px; color: var(--txt-tertiary); max-width: 320px;">
						The popup renders at exactly <code style="color: var(--txt-primary);">var(${layout.baseWidth})</code> × <code style="color: var(--txt-primary);">var(${layout.baseHeight})</code>. When the bottom nav is mounted, <code style="color: var(--txt-primary);">--nav-clearance</code> reserves space at the bottom so content doesn't sit underneath it.
					</div>
				</div>
			</div>
		`,
	}),
}

export const Borders: Story = {
	render: () => ({
		template: `
			<div style="display: grid; grid-template-columns: 200px 1fr; gap: 16px; align-items: center; padding: 24px; color: var(--txt-primary); font-family: var(--font-body);">
				${Object.entries(borders)
					.map(
						([name, varName]) => `
					<div>
						<code style="color: var(--txt-secondary); font-family: var(--font-mono); font-size: 12px;">${name}</code>
						<div style="color: var(--txt-tertiary); font-size: 12px; margin-top: 2px;">${varName}</div>
					</div>
					<div style="display: flex; gap: 12px;">
						<div style="width: 80px; height: 40px; background: var(--nulo-surface); border: 1px solid var(${varName});"></div>
						<div style="width: 80px; height: 40px; background: var(--nulo-surface); border: 2px solid var(${varName});"></div>
					</div>
				`,
					)
					.join("")}
			</div>
		`,
	}),
}
