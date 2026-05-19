/**
 * Input variant matrix.
 *
 * The brutalist underline is the single canonical visual; the legacy
 * boxed `default` variant was removed.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Input from "./Input.vue"

const meta: Meta<typeof Input> = {
	title: "UI / Input",
	component: Input,
	tags: ["autodocs"],
	argTypes: {
		size: {
			control: "select",
			options: ["medium", "small", "mini"],
		},
		type: {
			control: "select",
			options: ["text", "password", "number"],
		},
		disabled: { control: "boolean" },
		error: { control: "boolean" },
		autofocus: { control: "boolean" },
		clearable: { control: "boolean" },
		label: { control: "text" },
		leftText: { control: "text" },
		icon: { control: "text" },
		placeholder: { control: "text" },
		maxLength: { control: "number" },
	},
	args: {
		size: "medium",
		placeholder: "Type something",
	},
	render: (args) => ({
		components: { Input },
		setup: () => ({ args }),
		data: () => ({ value: "" }),
		template: '<div style="width: 360px; padding: 20px;"><Input v-bind="args" v-model="value" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof Input>

export const Default: Story = {}
export const WithLabel: Story = { args: { label: "Profile name" } }
export const WithLeftText: Story = { args: { leftText: "0x", placeholder: "address…" } }
export const WithIcon: Story = { args: { icon: "search", placeholder: "Search" } }
export const Password: Story = { args: { type: "password", label: "Password", placeholder: "Enter password" } }
export const NumberInput: Story = { args: { type: "number", placeholder: "0" } }
export const ErrorState: Story = { args: { error: true, label: "Invalid", placeholder: "Try again" } }
export const Disabled: Story = { args: { disabled: true, placeholder: "Read-only" } }
export const Clearable: Story = {
	args: { clearable: true, placeholder: "Has clear button" },
	render: (args) => ({
		components: { Input },
		setup: () => ({ args }),
		data: () => ({ value: "Already typed" }),
		template: '<div style="width: 360px; padding: 20px;"><Input v-bind="args" v-model="value" /></div>',
	}),
}
export const WithMaxLength: Story = { args: { maxLength: 16, label: "Short alias", placeholder: "16 char limit" } }

export const Small: Story = { args: { size: "small" } }
export const Mini: Story = { args: { size: "mini" } }

/** Side-by-side sizes — the canonical "look at all sizes at once" view. */
export const SizeMatrix: Story = {
	render: () => ({
		components: { Input },
		template: `
			<div style="display: flex; flex-direction: column; gap: 16px; padding: 20px; min-width: 360px;">
				<div>
					<code style="display:block; margin-bottom: 4px;">medium (default)</code>
					<Input size="medium" placeholder="Medium input" />
				</div>
				<div>
					<code style="display:block; margin-bottom: 4px;">small</code>
					<Input size="small" placeholder="Small input" />
				</div>
				<div>
					<code style="display:block; margin-bottom: 4px;">mini</code>
					<Input size="mini" placeholder="Mini input" />
				</div>
			</div>
		`,
	}),
}

/** Side-by-side states — focus/error/disabled. */
export const StateMatrix: Story = {
	render: () => ({
		components: { Input },
		template: `
			<div style="display: flex; flex-direction: column; gap: 16px; padding: 20px; min-width: 360px;">
				<div>
					<code style="display:block; margin-bottom: 4px;">default</code>
					<Input placeholder="Type something" />
				</div>
				<div>
					<code style="display:block; margin-bottom: 4px;">error</code>
					<Input :error="true" placeholder="Failed" />
				</div>
				<div>
					<code style="display:block; margin-bottom: 4px;">disabled</code>
					<Input :disabled="true" placeholder="Locked" />
				</div>
			</div>
		`,
	}),
}
