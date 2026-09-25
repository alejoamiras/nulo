import { expect, inject } from "vitest"
import { test } from "../fixtures/extension"
import { readStoredCapability } from "../fixtures/dappSession"
import { assertPgOk, PLAYGROUND_TEST_URL, requestPgBundle, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveCapabilities, readCapabilitySwitch, waitForPopup } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #08 — a partial grant. `data-scopedEvents` asks for the address book and for private
 * events on one listed contract, so both data rows start On. With the private-events row switched
 * Off, the answer and the stored grant carry the address book alone.
 */
test.skipIf(!hasConfig)(
	"cap-request-partial — a data row switched Off leaves only the other field granted",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension: ctx }) => {
		const page = ctx.playgroundPage
		const fromSeq = await snapshotResultSeq(page)
		const popupP = waitForPopup(ctx, "capabilities", { timeout: 30_000 })
		await requestPgBundle(page, "data-scopedEvents", { tokenAddress: aztecConfig!.tokenAddress })
		const popup = await popupP

		expect(await readCapabilitySwitch(popup, "address-book")).toBe(true)
		expect(await readCapabilitySwitch(popup, "private-events")).toBe(true)
		await approveCapabilities(popup, { switches: { "private-events": false } })

		const result = await waitForPgResult(page, "requestCapabilities", fromSeq, 30_000)
		await assertPgOk(page, result, "cap-request-partial:result")
		const granted = (result.resultJson as { granted?: Array<{ type: string }> })?.granted ?? []
		const addressBookAlone = { type: "data", addressBook: true }
		expect(granted.find((g) => g.type === "data")).toEqual(addressBookAlone)
		expect(await readStoredCapability(ctx, new URL(PLAYGROUND_TEST_URL).origin, "data")).toEqual(addressBookAlone)
	},
)
