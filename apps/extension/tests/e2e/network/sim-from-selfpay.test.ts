import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { assertPgOk, callExpectingNoPopup } from "../fixtures/playground"
import {
	createTestWallet,
	fundPublicFeeJuice,
	mintPublicTokensForAccount,
	readPublicFeeJuice,
	type AztecTestConfig,
} from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** The playground's `simulateTx (transfer)` result: `apps/playground/src/lib/simulation-summary.ts`. */
type PublicCallSummary = { contract: string; msgSender: string; selector: string | null; isStaticCall: boolean }
type FrameSummary = { contract: string; selector: string; argsHash: string; publicCalls: PublicCallSummary[]; nested: FrameSummary[] }
type SimulationSummary = {
	feePayer: string
	setupCalls: PublicCallSummary[]
	appCalls: PublicCallSummary[]
	teardownCall: PublicCallSummary | null
	entrypoint: FrameSummary
}

const lower = (s: string) => s.toLowerCase()

function framesOf(frame: FrameSummary): FrameSummary[] {
	return [frame, ...frame.nested.flatMap(framesOf)]
}

/**
 * A dApp connected to two accounts simulates a self-paid transfer FROM the second one: the
 * transfer's owner, `opts.from` and `exec.feePayer` all name it. The wallet must run the
 * simulation as that account — the fee payer in the kernel output is the second account, its
 * entrypoint frame is in the execution tree, and the transfer's public enqueue sits in the app
 * phase (not setup) — with the node's tx validation ON, so the setup allow-list is enforced.
 * Only the second account holds tokens and Fee Juice: run as the first account instead, the
 * transfer fails authorization (`authorize_once("from")`) and the payload is classified as
 * externally paid.
 */
test.skipIf(!hasConfig)(
	"sim-from-selfpay — a self-paid simulate from the second granted account runs as that account, validation on",
	{ timeout: 300_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		const config = aztecConfig as AztecTestConfig
		expect(accountAddresses).toHaveLength(2)
		const [first, second] = accountAddresses as [string, string]
		expect(lower(first)).not.toBe(lower(second))

		await mintPublicTokensForAccount(config, second)
		const { wallet, accounts, node, cleanup } = await createTestWallet(config.nodeUrl)
		try {
			const scriptAccount = accounts[0]
			if (!scriptAccount) throw new Error("expected at least one sandbox-deployed test account")
			await fundPublicFeeJuice(wallet, node, scriptAccount, config, second)
			expect(await readPublicFeeJuice(wallet, scriptAccount, second)).toBeGreaterThan(0n)

			await page.evaluate(
				({ token, recipient, from }: { token: string; recipient: string; from: string }) => {
					const setVal = (sel: string, v: string) => {
						const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(sel)
						if (!input) throw new Error(`missing ${sel}`)
						const proto =
							input instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
						Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, v)
						input.dispatchEvent(new Event("input", { bubbles: true }))
						input.dispatchEvent(new Event("change", { bubbles: true }))
					}
					setVal('[data-testid="pg-input-tokenAddress"]', token)
					setVal('[data-testid="pg-input-recipient"]', recipient)
					setVal('[data-testid="pg-input-amount"]', "1")
					setVal('[data-testid="pg-input-feePayer"]', from)
					setVal('[data-testid="pg-input-from"]', from)
					setVal('[data-testid="pg-toggle-skipValidation"]', "on")
				},
				{ token: config.tokenAddress, recipient: config.minterAddress, from: second },
			)

			const result = await callExpectingNoPopup(
				ctx,
				page,
				"simulateTx",
				() => clickByTestId(page, "pg-btn-simulateTx-transfer"),
				180_000,
			)
			await assertPgOk(page, result, "self-paid simulateTx from the second account with validation on")
			const summary = result.resultJson as SimulationSummary

			expect(lower(summary.feePayer)).toBe(lower(second))
			expect(framesOf(summary.entrypoint).map((f) => lower(f.contract))).toContain(lower(second))
			expect(summary.setupCalls).toEqual([])
			expect(summary.appCalls.map((c) => lower(c.contract))).toEqual([lower(config.tokenAddress)])
			expect(lower(summary.appCalls[0]?.msgSender ?? "")).toBe(lower(second))
		} finally {
			await cleanup()
		}
	},
)
