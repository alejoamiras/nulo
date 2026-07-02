/**
 * `FormPopup` composite stories.
 *
 * `FormPopup` teleports to `#popup`. The Storybook preview already
 * creates the teleport roots, so stories render directly. Set
 * `show: true` for each story so the popup is visible without an
 * external trigger.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import FormPopup from "./FormPopup.vue"

const meta: Meta<typeof FormPopup> = {
	title: "Composite / FormPopup",
	component: FormPopup,
	tags: ["autodocs"],
	argTypes: {
		show: { control: "boolean" },
		title: { control: "text" },
		submitLabel: { control: "text" },
		submitDisabled: { control: "boolean" },
		submitLoading: { control: "boolean" },
		submitVariant: {
			control: "select",
			options: ["primary", "primary_outline", "secondary", "ghost", "cta", "cta_outline", "cta_destructive"],
		},
		bodyGap: { control: "text" },
	},
	args: {
		show: true,
		displaceIdx: 1,
		title: "Add endpoint",
		submitLabel: "Add endpoint",
	},
	render: (args) => ({
		components: { FormPopup },
		setup: () => ({ args }),
		template: `
			<div style="position: relative; min-height: 480px; background: var(--app-bg);">
				<FormPopup v-bind="args">
					<div style="display: flex; flex-direction: column; gap: 14px;">
						<label style="font-size: 12px; color: var(--txt-secondary);">
							Label (optional)
							<input style="width: 100%; padding: 12px 0; border: none; border-bottom: 1px solid var(--nulo-border); background: transparent; color: var(--txt-primary); font-size: 15px;" placeholder="Backup" />
						</label>
						<label style="font-size: 12px; color: var(--txt-secondary);">
							RPC URL
							<input style="width: 100%; padding: 12px 0; border: none; border-bottom: 1px solid var(--nulo-border); background: transparent; color: var(--txt-primary); font-size: 15px;" placeholder="https://rpc.example.com" />
						</label>
					</div>
				</FormPopup>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof FormPopup>

export const Default: Story = {}

export const SubmitDisabled: Story = { args: { submitDisabled: true } }

export const SubmitLoading: Story = { args: { submitLoading: true } }

export const Destructive: Story = {
	args: {
		title: "Delete contact",
		submitLabel: "Delete",
		submitVariant: "cta_destructive",
	},
}

export const WithHelpText: Story = {
	render: (args) => ({
		components: { FormPopup },
		setup: () => ({ args }),
		template: `
			<div style="position: relative; min-height: 480px; background: var(--app-bg);">
				<FormPopup v-bind="args">
					<div style="display: flex; flex-direction: column; gap: 14px;">
						<input style="width: 100%; padding: 12px 0; border: none; border-bottom: 1px solid var(--nulo-border); background: transparent; color: var(--txt-primary); font-size: 15px;" placeholder="Field" />
					</div>
					<template #belowSubmit>
						<p style="font-size: 12px; color: var(--txt-tertiary); text-align: center; padding: 0 20px; margin: 0;">
							We'll probe the RPC and confirm it matches this chain before saving.
						</p>
					</template>
				</FormPopup>
			</div>
		`,
	}),
}

export const WithErrorRow: Story = {
	render: (args) => ({
		components: { FormPopup },
		setup: () => ({ args }),
		template: `
			<div style="position: relative; min-height: 480px; background: var(--app-bg);">
				<FormPopup v-bind="args">
					<div style="display: flex; flex-direction: column; gap: 14px;">
						<input style="width: 100%; padding: 12px 0; border: none; border-bottom: 1px solid var(--nulo-border); background: transparent; color: var(--txt-primary); font-size: 15px;" placeholder="Field" />
					</div>
					<template #aboveSubmit>
						<div style="display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: rgba(255, 73, 73, 0.08);">
							<span style="font-size: 12px; font-weight: 600; color: var(--red);">RPC didn't respond. Check the URL.</span>
						</div>
					</template>
				</FormPopup>
			</div>
		`,
	}),
}

export const WithSecondaryAction: Story = {
	render: (args) => ({
		components: { FormPopup },
		setup: () => ({ args: { ...args, title: "Edit endpoint", submitLabel: "Save" } }),
		template: `
			<div style="position: relative; min-height: 480px; background: var(--app-bg);">
				<FormPopup v-bind="args">
					<div style="display: flex; flex-direction: column; gap: 14px;">
						<input style="width: 100%; padding: 12px 0; border: none; border-bottom: 1px solid var(--nulo-border); background: transparent; color: var(--txt-primary); font-size: 15px;" placeholder="Field" />
					</div>
					<template #belowSubmit>
						<button style="width: 100%; padding: 12px 0; background: transparent; color: var(--txt-primary); border: 2px solid var(--nulo-outline); cursor: pointer; font-family: var(--font-headline); font-size: 13px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;">
							Reset changes
						</button>
					</template>
				</FormPopup>
			</div>
		`,
	}),
}
