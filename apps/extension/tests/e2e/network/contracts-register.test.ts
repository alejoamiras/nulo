import { inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #21 — registerContract is silent on default sessions
 * (PxeState=3 < confirmationLevel=5).
 *
 * The dApp must pass a real ContractInstance. We fetch it directly from the
 * local Aztec node via createAztecNodeClient + getContract, JSON-stringify it,
 * inject into pg-input-contractInstance, then click the button.
 */
test.skipIf(!hasConfig)(
	"contracts-register — silent path registers contract instance",
	{ timeout: 120_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant contracts cap with canRegister
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "basic"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		await approveCapabilities(await popupP)
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Fetch the deployed token's instance directly from the node
		const { createAztecNodeClient } = await import("@aztec/aztec.js/node")
		const { AztecAddress } = await import("@aztec/aztec.js/addresses")
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)
		const instance = await node.getContract(AztecAddress.fromStringUnsafe(aztecConfig!.tokenAddress))
		if (!instance) throw new Error("Could not fetch token instance from node")

		// Inject instance JSON into the playground
		const instanceJson = JSON.stringify(instance, (_k, v) => {
			if (typeof v === "bigint") return v.toString()
			if (v && typeof v === "object" && "toString" in v && typeof v.toString === "function") {
				const ctor = Object.getPrototypeOf(v)?.constructor?.name
				if (ctor === "Fr" || ctor === "AztecAddress" || ctor === "EthAddress") return v.toString()
			}
			return v
		})
		await page.evaluate((json: string) => {
			const input = document.querySelector<HTMLTextAreaElement>('[data-testid="pg-input-contractInstance"]')!
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
			setter?.call(input, json)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}, instanceJson)

		const result = await callExpectingNoPopup(dappConnectedExtension, page, "registerContract", async () => {
			await clickByTestId(page, "pg-btn-registerContract")
		})
		// Strict "ok": the playground calls through the real wallet-sdk Wallet, whose
		// proxy validates the response with z.void() — so this also pins the 5.0.1
		// return-shape conformance (a non-undefined result rejects client-side even
		// though registration succeeded wallet-side). The old ["ok","error"] tolerance
		// masked exactly that bug.
		await assertPgOk(page, result, "contracts-register:result")
	},
)
