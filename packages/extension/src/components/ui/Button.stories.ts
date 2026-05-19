/**
 * Button variant matrix.
 *
 * Storybook 10 CSF (Component Story Format) with Vue 3.
 *
 * Pattern reference for all `*.stories.ts` files:
 *   - Colocated next to `<Name>.vue`.
 *   - One default export with `meta` (component + argTypes).
 *   - Named exports for each visual permutation.
 *   - Global SCSS, Pinia, teleport roots, chrome stub from
 *     `.storybook/preview.ts`.
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Button from "./Button.vue"

const meta: Meta<typeof Button> = {
	title: "UI / Button",
	component: Button,
	tags: ["autodocs"],
	argTypes: {
		variant: {
			control: "select",
			options: ["primary", "primary_outline", "secondary", "ghost", "text", "cta", "cta_outline", "cta_destructive"],
		},
		size: {
			control: "select",
			options: ["large", "medium", "small", "mini", "dynamic", "micro"],
		},
		disabled: { control: "boolean" },
		loading: { control: "boolean" },
		wide: { control: "boolean" },
		leftIcon: { control: "text" },
		rightIcon: { control: "text" },
		link: { control: "text" },
	},
	args: {
		variant: "primary",
		size: "medium",
	},
	render: (args) => ({
		components: { Button },
		setup: () => ({ args }),
		template: '<Button v-bind="args">Click me</Button>',
	}),
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: "primary" } }
export const PrimaryOutline: Story = { args: { variant: "primary_outline" } }
export const Secondary: Story = { args: { variant: "secondary" } }
export const Ghost: Story = { args: { variant: "ghost" } }
export const TextLink: Story = { args: { variant: "text" } }
export const Cta: Story = { args: { variant: "cta" }, parameters: { layout: { width: 360 } } }
export const CtaOutline: Story = { args: { variant: "cta_outline" }, parameters: { layout: { width: 360 } } }
export const CtaDestructive: Story = { args: { variant: "cta_destructive" }, parameters: { layout: { width: 360 } } }

export const Large: Story = { args: { size: "large" } }
export const Small: Story = { args: { size: "small" } }
export const Mini: Story = { args: { size: "mini" } }

export const Disabled: Story = { args: { disabled: true } }
export const Loading: Story = { args: { loading: true } }
export const DisabledAndLoading: Story = { args: { disabled: true, loading: true } }

export const Wide: Story = {
	args: { wide: true },
	parameters: { layout: { width: 400 } },
}

export const WithLeftIcon: Story = { args: { leftIcon: "copy" } }
export const WithRightIcon: Story = { args: { rightIcon: "arrow-right" } }
export const WithBothIcons: Story = { args: { leftIcon: "copy", rightIcon: "arrow-right" } }

export const AsLink: Story = { args: { link: "/popup/general" } }

/** Side-by-side matrix of every variant × medium size — the canonical "look at all variants at once" view. */
export const VariantMatrix: Story = {
	render: () => ({
		components: { Button },
		template: `
			<div style="display: flex; flex-direction: column; gap: 12px; padding: 20px; min-width: 360px;">
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">primary</code>
					<Button variant="primary">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">primary_outline</code>
					<Button variant="primary_outline">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">secondary</code>
					<Button variant="secondary">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">ghost</code>
					<Button variant="ghost">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">text</code>
					<Button variant="text">Action</Button>
				</div>
				<hr style="border: 1px solid var(--nulo-outline); margin: 8px 0;" />
				<code>cta family (full-width)</code>
				<Button variant="cta">cta</Button>
				<Button variant="cta_outline">cta_outline</Button>
				<Button variant="cta_destructive">cta_destructive</Button>
			</div>
		`,
	}),
}

/** Side-by-side matrix of every size at variant=primary. */
export const SizeMatrix: Story = {
	render: () => ({
		components: { Button },
		template: `
			<div style="display: flex; flex-direction: column; gap: 12px; padding: 20px;">
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">large</code>
					<Button size="large">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">medium</code>
					<Button size="medium">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">small</code>
					<Button size="small">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">mini</code>
					<Button size="mini">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">dynamic</code>
					<Button size="dynamic">Action</Button>
				</div>
				<div style="display: flex; align-items: center; gap: 12px;">
					<code style="min-width: 160px;">micro</code>
					<Button size="micro">Action</Button>
				</div>
			</div>
		`,
	}),
}
