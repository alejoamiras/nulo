import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { useToast } from "../composables/toast"
import ToastManagerBase from "./ToastManagerBase.vue"

const LONG_SUB = "123,456,789,012,345,678,901,234,567,890.123456 AVERYLONGTOKENSYMBOLNAME to 0x8c02…41fa"

const meta: Meta<typeof ToastManagerBase> = {
	title: "UI / ToastManager",
	component: ToastManagerBase,
	tags: ["autodocs"],
	render: () => ({
		components: { ToastManagerBase },
		setup() {
			const { openToast } = useToast()
			return {
				success: () =>
					openToast({
						kind: "success",
						label: "Transaction submitted",
						sub: "250 USDC to 0x8c02…41fa",
						action: { label: "View", onSelect: () => {} },
					}),
				error: () => openToast({ kind: "error", label: "Send failed", sub: "Not enough Fee Juice for the fee" }),
				long: () =>
					openToast({
						kind: "success",
						label: "Transaction submitted",
						sub: LONG_SUB,
						action: { label: "View", onSelect: () => {} },
					}),
			}
		},
		template: `
			<div style="position: relative; min-height: 220px; padding: 24px;">
				<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start;">
					<button @click="success()">Success with View (6 s, held while hovered or focused)</button>
					<button @click="error()">Error with × (stays until closed)</button>
					<button @click="long()">Long wrapped message</button>
				</div>
				<div id="toast" />
				<ToastManagerBase :bottomInset="76" />
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof ToastManagerBase>

export const Default: Story = {}
