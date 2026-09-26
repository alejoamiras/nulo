import type { Meta, StoryObj } from "@storybook/vue3-vite"
import DetailsTable from "./DetailsTable.vue"

/** The ends are the drawing's; the middles are filler, since the table shows only the ends. */
const address = (start: string, end: string) => `0x${start}${"0".repeat(56)}${end}`

const burner = {
	add: true,
	simulate: ["balance_of_private", "balance_of_public", "burn_public", "burn_private"],
	transact: ["burn_public", "burn_private"],
}

const meta: Meta<typeof DetailsTable> = {
	title: "Composite / DetailsTable",
	component: DetailsTable,
	tags: ["autodocs"],
	render: (args) => ({
		components: { DetailsTable },
		setup: () => ({ args }),
		template: '<div style="box-sizing: border-box; width: 400px; padding: 16px;"><DetailsTable v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof DetailsTable>

/** The tools app's testnet request, as the S1 drawing lists it. */
export const S1: Story = {
	args: {
		label: "12 contracts",
		anyContract: null,
		known: [
			{
				name: "Fee Juice",
				simulate: ["claim", "claim_and_end_setup", "balance_of_public"],
				add: false,
				transact: ["claim", "claim_and_end_setup"],
			},
			{ name: "Sponsored fee payer", simulate: ["sponsor_unconditionally"], add: false, transact: ["sponsor_unconditionally"] },
			{
				name: "Private fee payer",
				simulate: ["balance_of", "mint_and_pay_fee", "pay_fee"],
				add: true,
				transact: ["mint_and_pay_fee", "pay_fee"],
			},
			{ name: "Auth registry", simulate: ["set_authorized"], add: false, transact: ["set_authorized"] },
		],
		unknown: [
			{
				address: address("0c1e", "5a7f"),
				simulate: [
					"token_for",
					"portal_for",
					"exits_paused",
					"claim_public",
					"claim_private",
					"exit_to_l1_public",
					"exit_to_l1_private",
				],
				add: true,
				transact: [
					"register_token",
					"register_and_claim_public",
					"claim_public",
					"claim_private",
					"exit_to_l1_public",
					"exit_to_l1_private",
				],
			},
			{ address: address("0024", "6502"), ...burner },
			{ address: address("14c1", "ed96"), ...burner },
			{ address: address("025c", "d7e6"), ...burner },
			{ address: address("0455", "cba9"), ...burner },
			{ address: address("0643", "15fd"), simulate: [], add: true, transact: ["drip_to_public", "drip_to_private"] },
			{ address: address("0262", "176a"), simulate: ["balance_of_private", "balance_of_public"], add: true, transact: [] },
			{ address: address("14e0", "d592"), simulate: ["balance_of_private", "balance_of_public"], add: true, transact: [] },
		],
	},
}
