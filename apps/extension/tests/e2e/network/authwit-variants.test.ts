import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test, waitForHash, type ExtensionContext } from "../fixtures/extension"
import {
	assertPgOk,
	callExpectingNoPopup,
	PLAYGROUND_TEST_URL,
	type PgBundle,
	requestPgBundle,
	snapshotResultSeq,
	waitForPgResult,
} from "../fixtures/playground"
import {
	approveCapabilities,
	approveExecute,
	readCapabilitySwitch,
	rejectExecute,
	setConnectedAppAuthorizations,
	waitForExecuteContent,
	waitForPopup,
} from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * createAuthWit. A call intent inside the granted transaction or simulation scope signs without a
 * window only while the app's authorizations switch is On; while it is Off the call opens the
 * confirmation window, titled "Authorization". The switch starts On for a request that lists its
 * contracts and Off for one that reaches any contract, and Settings can turn it off later.
 *
 * AUDIT (F-01): an inner hash is attacker-chosen and cannot be matched against a scope, so it
 * opens the confirmation window whatever the switch says. Raw `Fr` is rejected in the dispatcher
 * and isn't reachable through wallet-sdk public types — covered in unit tests, not here.
 */

type Connected = ExtensionContext & { playgroundPage: Page }

/** Connect `bundle` on the token, check the authorizations switch starts at `expectDefault`,
 *  approve with `switchTo` if given, and require the request's answer to be `ok`. */
async function connect(ctx: Connected, bundle: PgBundle, expectDefault: boolean, switchTo?: boolean): Promise<void> {
	const page = ctx.playgroundPage
	const seq = await snapshotResultSeq(page)
	const popupP = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
	await requestPgBundle(page, bundle, { tokenAddress: aztecConfig!.tokenAddress })
	const popup = await popupP
	await popup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 60_000 })
	expect(await readCapabilitySwitch(popup, "authorizations")).toBe(expectDefault)
	const account = await popup.$eval('[data-testid="cap-account-item"]', (row) => row.getAttribute("data-account-id"))
	await approveCapabilities(popup, {
		accounts: [account!],
		...(switchTo !== undefined ? { switches: { authorizations: switchTo } } : {}),
	})
	await assertPgOk(page, await waitForPgResult(page, "requestCapabilities", seq, 30_000), `${bundle}:requestCapabilities`)
}

/** Click `button` and expect the confirmation window; `decide` answers it. Returns the dApp's result. */
async function signThroughWindow(ctx: Connected, button: string, decide: (popup: Page) => Promise<void>) {
	const page = ctx.playgroundPage
	const seq = await snapshotResultSeq(page)
	const popupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
	await clickByTestId(page, button)
	const popup = await popupP
	await waitForExecuteContent(popup)
	expect(await popup.$eval('[data-testid="execute-op-title"]', (el) => el.textContent?.trim())).toBe("Authorization")
	await decide(popup)
	return waitForPgResult(page, "createAuthWit", seq, 30_000)
}

const signWithoutWindow = (ctx: Connected) =>
	callExpectingNoPopup(ctx, ctx.playgroundPage, "createAuthWit", () =>
		clickByTestId(ctx.playgroundPage, "pg-btn-createAuthWit-callIntent"),
	)

test.skipIf(!hasConfig)(
	"authwit-callIntent — a request listing its contracts starts On: the call intent signs without a window",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		await connect(ctx, "transaction-listed", true)
		await assertPgOk(ctx.playgroundPage, await signWithoutWindow(ctx), "listed:callIntent")
	},
)

test.skipIf(!hasConfig)(
	"authwit-callIntent — a request reaching any contract starts Off: the call intent asks, titled Authorization",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		await connect(ctx, "transaction", false)
		const rejected = await signThroughWindow(ctx, "pg-btn-createAuthWit-callIntent", rejectExecute)
		expect(rejected.status).toBe("error")
		const confirmed = await signThroughWindow(ctx, "pg-btn-createAuthWit-callIntent", (popup) => approveExecute(popup))
		await assertPgOk(ctx.playgroundPage, confirmed, "any:callIntent:confirmed")
	},
)

test.skipIf(!hasConfig)(
	"authwit — switched On for any contract: the call intent signs silently, an inner hash still asks, Settings Off asks again",
	{ timeout: 240_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		await connect(ctx, "transaction", false, true)
		await assertPgOk(ctx.playgroundPage, await signWithoutWindow(ctx), "any-on:callIntent")

		const inner = await signThroughWindow(ctx, "pg-btn-createAuthWit-innerHash", (popup) => approveExecute(popup))
		await assertPgOk(ctx.playgroundPage, inner, "any-on:innerHash")

		const settings = await openPopup(ctx)
		await waitForHash(settings, "#/popup/general")
		await setConnectedAppAuthorizations(settings, new URL(PLAYGROUND_TEST_URL).host, false)
		await settings.close()
		const asked = await signThroughWindow(ctx, "pg-btn-createAuthWit-callIntent", (popup) => approveExecute(popup))
		await assertPgOk(ctx.playgroundPage, asked, "settings-off:callIntent")
	},
)
