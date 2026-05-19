import type { Meta, StoryObj } from "@storybook/vue3-vite"
import PopupHeader from "./PopupHeader.vue"

const meta: Meta<typeof PopupHeader> = {
	title: "UI / PopupHeader",
	component: PopupHeader,
	tags: ["autodocs"],
	argTypes: {
		closable: { control: "boolean" },
	},
	args: { closable: true },
	render: (args) => ({
		components: { PopupHeader },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px; background: var(--nulo-surface); border-top: 2px solid var(--nulo-accent);">
				<PopupHeader v-bind="args" @onClose="() => {}">
					<template #title>
						<span style="font-family: var(--font-headline); font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">Popup title</span>
					</template>
					<template #description>
						<span style="font-size: 12px; color: var(--txt-secondary);">Subtitle / description text</span>
					</template>
				</PopupHeader>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof PopupHeader>

export const Closable: Story = {}
export const NotClosable: Story = { args: { closable: false } }
export const WithTrailing: Story = {
	args: { closable: true },
	render: (args) => ({
		components: { PopupHeader },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px; background: var(--nulo-surface); border-top: 2px solid var(--nulo-accent);">
				<PopupHeader v-bind="args" @onClose="() => {}">
					<template #title>
						<span style="font-family: var(--font-headline); font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">Title</span>
					</template>
					<template #right>
						<button style="padding: 4px 8px; background: transparent; color: inherit; border: 1px solid #555; cursor: pointer;">
							edit
						</button>
					</template>
				</PopupHeader>
			</div>
		`,
	}),
}
