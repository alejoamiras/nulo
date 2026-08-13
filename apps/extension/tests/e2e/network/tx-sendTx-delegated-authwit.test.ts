import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { approveCapabilities, approveExecute, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { waitForDappExecuteWorked } from "../fixtures/journal"
import { deployDelegatedPullRig, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Delegated-authwit DISCOVERY — the flow that sat silently broken for months
 * (the stub override never engaged, so any dApp op needing a call authwit
 * failed at estimate; no test noticed because none exercised discovery).
 *
 * Shape: the playground registers a Crowdfunding consumer + its pull token
 * with the wallet, then sends `donate(amount)` with NO witness attached. The
 * consumer pulls the donor's tokens via `transfer_in_private`
 * (msg.sender = crowdfunding ≠ from = donor), so the token asserts a call
 * authwit against the DONOR's account. The wallet's folded estimate must
 * DISCOVER that need in its stubbed first sim (the CallAuthorizationRequest
 * offchain effect), sign the witness, and verify it in the validated rebuild.
 *
 * WHY SKIPPED ON THE LOCAL SANDBOX (env-gated, not deleted): the
 * `Crowdfunding` consumer calls the canonical `PublicChecks` standard
 * contract (0x031b75e2…), which real testnet has but the local native Aztec
 * network does NOT genesis-seed (verified: `node.getContract(PublicChecks)`
 * is undefined; publishing post-genesis is a documented collision). So the
 * pull can't execute locally — an infra gap, not a wallet gap. This test
 * WROTE ITS OWN VALUE by catching the init-wrap discovery bug during
 * development (fixed in `probedFirstSimOpts` / `isInitWrapped`). Full
 * on-chain coverage of the folded delegated discovery lives in B1's
 * real-testnet canary (single-sim-estimates/lessons/phase-B1.md, shape 3,
 * where PublicChecks IS deployed); the wallet-side witness attachment is
 * pinned in `discovery-probe.test.ts` + the fold pins in
 * `strategies-structural.test.ts`. Set `NULO_E2E_STANDARD_CONTRACTS=1` to run
 * this against a network that publishes the standard contracts (e.g. testnet).
 */
const hasStandardContracts = process.env.NULO_E2E_STANDARD_CONTRACTS === "1"
test.skipIf(!hasConfig || !hasStandardContracts)(
	"tx-sendTx-delegated — folded discovery finds the pull authwit, signs it, real proof submits",
	{ timeout: 420_000 },
	async ({ dappConnectedExtensionPerTest: dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant the combined bundle: transaction (send + popup flow) AND
		// contracts (registerContract for the dApp's own contracts).
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "transaction-contracts"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const capPopupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const capPopup = await capPopupP
		await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
		const accountIds = await capPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
		)
		const accountAddress = accountIds[0]!
		await approveCapabilities(capPopup, { accounts: [accountAddress] })
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Rig: upstream Token + Crowdfunding consumer; donor (the extension's
		// dApp account) gets a private balance the consumer will pull from.
		const { pullTokenAddress, consumerAddress } = await deployDelegatedPullRig(aztecConfig!, accountAddress)

		// Fetch both instances from the node — the dApp side registers them
		// (instance + bundled artifact) like any real dApp introducing its own
		// contracts.
		const { createAztecNodeClient } = await import("@aztec/aztec.js/node")
		const { AztecAddress } = await import("@aztec/aztec.js/addresses")
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)
		const serialize = (v: unknown) =>
			JSON.stringify(v, (_k, x) => {
				if (typeof x === "bigint") return x.toString()
				if (x && typeof x === "object" && "toString" in x && typeof x.toString === "function") {
					const ctor = Object.getPrototypeOf(x)?.constructor?.name
					if (ctor === "Fr" || ctor === "AztecAddress" || ctor === "EthAddress") return x.toString()
				}
				return x
			})
		const tokenInstance = await node.getContract(AztecAddress.fromStringUnsafe(pullTokenAddress))
		const consumerInstance = await node.getContract(AztecAddress.fromStringUnsafe(consumerAddress))
		if (!tokenInstance || !consumerInstance) throw new Error("Rig instances not found at node")

		await page.evaluate(
			({ consumer, tokenJson, consumerJson }: { consumer: string; tokenJson: string; consumerJson: string }) => {
				const setVal = (sel: string, v: string) => {
					const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)
					if (!el) return
					const proto =
						el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
					const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
					setter?.call(el, v)
					el.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-consumerAddress"]', consumer)
				setVal('[data-testid="pg-input-amount"]', "100")
				setVal('[data-testid="pg-input-delegatedTokenInstance"]', tokenJson)
				setVal('[data-testid="pg-input-delegatedConsumerInstance"]', consumerJson)
			},
			{
				consumer: consumerAddress,
				tokenJson: serialize(tokenInstance),
				consumerJson: serialize(consumerInstance),
			},
		)

		// Fire: registerContract ×2 (silent on default sessions) + sendTx.
		const seqTx = await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 60_000 })
		await clickByTestId(page, "pg-btn-sendTx-delegated")
		let execPopup: Awaited<typeof execPopupP>
		try {
			execPopup = await execPopupP
		} catch (e) {
			// The dApp-side `safe()` wrapper swallows pre-sendTx failures into the
			// playground's error banner — surface it instead of a blind timeout.
			const dappError = await page.evaluate(() => document.querySelector('[data-testid="pg-error-text"]')?.textContent ?? "")
			throw new Error(`execute popup never opened; playground lastError: "${dappError}" (${(e as Error).message})`)
		}
		await waitForExecuteContent(execPopup)

		// The estimate that produced this popup ran the FOLDED pipeline and had
		// to discover the pull authwit — an undiscovered witness aborts the
		// validated rebuild and the popup never reaches its fee content.
		const ops = await execPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="execute-op-item"]')].map((el) => el.getAttribute("data-op-kind")),
		)
		expect(ops).toEqual(["aztec_sendTx"])

		await approveExecute(execPopup)

		const walletPopup = await openPopup(dappConnectedExtension)
		await waitForDappExecuteWorked(walletPopup)

		// `txHash` at the dApp = the node accepted a real proof that CARRIED the
		// discovered witness (a missing/wrong witness fails at prove time, before
		// submit). Same submit-level assertion as tx-sendTx-default.
		const result = await waitForPgResult(page, "sendTx", seqTx, 300_000)
		await assertPgOk(page, result, "tx-sendTx-delegated-authwit.test:result")
		expect(typeof (result.resultJson as { txHash?: string } | undefined)?.txHash).toBe("string")
	},
)
