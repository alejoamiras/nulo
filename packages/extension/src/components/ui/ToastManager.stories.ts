import type { Meta, StoryObj } from "@storybook/vue3-vite"
import ToastManager from "./ToastManager.vue"
import { useToast } from "@/composables/toast"

const meta: Meta<typeof ToastManager> = {
	title: "UI / ToastManager",
	component: ToastManager,
	tags: ["autodocs"],
	render: () => ({
		components: { ToastManager },
		setup() {
			const { openToast } = useToast()
			return {
				show: (label: string, color?: string, icon?: string) => openToast({ label, color, icon }, 60_000),
			}
		},
		template: `
			<div style="position: relative; min-height: 220px; padding: 24px;">
				<div id="toast" style="position: absolute; top: 0; left: 0; right: 0;" />
				<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start; padding-top: 56px;">
					<button @click="show('Action complete')">Show default</button>
					<button @click="show('Saved successfully', 'green', 'check-circle')">Show green</button>
					<button @click="show('Something went wrong', 'red', 'warning')">Show red</button>
					<button @click="show('Heads up', 'orange', 'info')">Show orange</button>
				</div>
				<ToastManager />
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof ToastManager>

export const Default: Story = {}
