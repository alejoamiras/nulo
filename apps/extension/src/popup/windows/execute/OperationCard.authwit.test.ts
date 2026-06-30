/**
 * Audit F2 regression pin: the execute card must SURFACE what an
 * `add_public_authwit` grant authorizes (spender / method / contract /
 * args) on its primary approval surface — never the opaque
 * "add public authwit" label. A blind approval for a persisted on-chain
 * spend authorization is the phishing vector the audit flagged.
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OperationCard from "./OperationCard.vue"

const SPENDER = "0xspender000000000000000000000000000000000000000000000000000000aa"
const TOKEN = "0xtoken0000000000000000000000000000000000000000000000000000000bb"
const OWNER = "0xowner0000000000000000000000000000000000000000000000000000000cc"

function authwitOp() {
	return {
		kind: "send_transaction" as const,
		networkId: "net-1",
		accountAddress: OWNER,
		account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
		feeSettings: { paymentMethod: { kind: "fj" } },
		actions: [
			{
				kind: "add_public_authwit" as const,
				content: {
					kind: "call" as const,
					caller: SPENDER,
					contract: TOKEN,
					method: "transfer_public_to_public",
					args: [OWNER, SPENDER, "999", "1"],
				},
			},
		],
	}
}

// Render AddressDisplay's :address prop as text so we can assert on it;
// stub the rest of the auto-registered visual children to plain slots.
const stubs = {
	AddressDisplay: { props: ["address"], template: '<span class="addr">{{ address }}</span>' },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: true,
	MaterialIcon: true,
	AmountCard: true,
	FeeSettingsCard: true,
	JsonViewer: true,
}

describe("OperationCard — add_public_authwit (audit F2)", () => {
	test("renders the spender, contract and args — not the opaque label", () => {
		const w = mount(OperationCard, {
			props: { op: authwitOp() as never, index: 0 },
			global: {
				stubs,
				// Auto-imported template helpers aren't resolved in an isolated mount.
				mocks: {
					trimAddress: (a: string) => a,
					humanizeMethodName: (m: string) => m,
					humanizeOperationKind: (k: string) => k,
					parseTransferIntent: () => ({ kind: "unverified" }),
				},
			},
		})
		const html = w.html()
		// The dangerous fields are on the primary surface.
		expect(w.find('[data-testid="execute-authwit-spender"]').exists()).toBe(true)
		expect(html).toContain(SPENDER)
		expect(html).toContain(TOKEN)
		expect(w.find('[data-testid="execute-authwit-args"]').exists()).toBe(true)
		// The recipient + amount (args) are visible.
		expect(html).toContain("999")
		// And the opaque fallback label is NOT used.
		expect(html).not.toContain("add public authwit")
	})

	test("encoded_call content still surfaces the spender (defensive, no opaque label)", () => {
		const op = authwitOp()
		;(op.actions[0] as { content: unknown }).content = {
			kind: "encoded_call",
			caller: SPENDER,
			to: TOKEN,
			selector: "0xdeadbeef",
			args: [],
		}
		const w = mount(OperationCard, {
			props: { op: op as never, index: 0 },
			global: {
				stubs,
				mocks: {
					trimAddress: (a: string) => a,
					humanizeMethodName: (m: string) => m,
					humanizeOperationKind: (k: string) => k,
					parseTransferIntent: () => ({ kind: "unverified" }),
				},
			},
		})
		const html = w.html()
		expect(w.find('[data-testid="execute-authwit-spender"]').exists()).toBe(true)
		expect(html).toContain(SPENDER)
		expect(html).not.toContain("(encoded_call)")
	})
})
