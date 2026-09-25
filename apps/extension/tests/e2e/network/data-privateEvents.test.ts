import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import { UNCLASSIFIED_ERROR_MESSAGE } from "@/wallet/services/wallet-sdk/error-envelope"
import { clickByTestId, test, type ExtensionContext } from "../fixtures/extension"
import { readStoredCapability } from "../fixtures/dappSession"
import {
	assertPgOk,
	callExpectingNoPopup,
	PLAYGROUND_TEST_URL,
	requestPgBundle,
	snapshotResultSeq,
	waitForPgResult,
} from "../fixtures/playground"
import { approveCapabilities, readCapabilitySwitch, waitForPopup } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #28 — getPrivateEvents is silent on default sessions (PrivateData=4 < confirmationLevel=5).
 *
 * The `data` bundle asks for private events on any contract, so that row starts Off. Switched On,
 * the answer and the stored grant carry `privateEvents: { contracts: "*" }`; left Off, neither
 * does. The call cannot tell the two apart: `data` alone grants no account, so the event scope the
 * playground sends (the token address) fails the account-scope check before any event is read,
 * and with private events Off the private-events scope check refuses it first. The wallet answers
 * both with its unclassified error, and neither opens a window.
 */

type Connected = ExtensionContext & { playgroundPage: Page }

/** The playground records the SDK's error message, which is the wallet's error JSON-encoded. */
const UNCLASSIFIED = { message: JSON.stringify(UNCLASSIFIED_ERROR_MESSAGE) }

/** Request `data`, check private events start Off, set that switch, and return the answer's `data` entry. */
async function grantData(ctx: Connected, privateEvents: boolean): Promise<Record<string, unknown> | undefined> {
	const page = ctx.playgroundPage
	const seq = await snapshotResultSeq(page)
	const popupP = waitForPopup(ctx, "capabilities", { timeout: 30_000 })
	await requestPgBundle(page, "data", { tokenAddress: aztecConfig!.tokenAddress })
	const popup = await popupP
	expect(await readCapabilitySwitch(popup, "private-events")).toBe(false)
	await approveCapabilities(popup, { switches: { "private-events": privateEvents } })
	const result = await waitForPgResult(page, "requestCapabilities", seq, 30_000)
	await assertPgOk(page, result, "data-privateEvents:requestCapabilities")
	const granted = (result.resultJson as { granted?: Array<Record<string, unknown>> })?.granted ?? []
	return granted.find((g) => g.type === "data")
}

const storedData = (ctx: Connected) => readStoredCapability(ctx, new URL(PLAYGROUND_TEST_URL).origin, "data")

async function expectRefusedSilently(ctx: Connected): Promise<void> {
	const page = ctx.playgroundPage
	const result = await callExpectingNoPopup(ctx, page, "getPrivateEvents", () => clickByTestId(page, "pg-btn-getPrivateEvents"))
	expect(result.status).toBe("error")
	expect(result.errorJson).toEqual(UNCLASSIFIED)
}

test.skipIf(!hasConfig)(
	"data-privateEvents (#28) — switched On, the grant holds private events on any contract",
	{ timeout: 150_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const held = { type: "data", addressBook: true, privateEvents: { contracts: "*" } }
		expect(await grantData(ctx, true)).toEqual(held)
		expect(await storedData(ctx)).toEqual(held)
		await expectRefusedSilently(ctx)
	},
)

test.skipIf(!hasConfig)(
	"data-privateEvents (#28) — left Off, the grant holds the address book alone",
	{ timeout: 150_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const held = { type: "data", addressBook: true }
		expect(await grantData(ctx, false)).toEqual(held)
		expect(await storedData(ctx)).toEqual(held)
		await expectRefusedSilently(ctx)
	},
)
