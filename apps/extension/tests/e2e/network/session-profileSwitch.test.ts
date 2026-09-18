import { expect, inject } from "vitest"
import { extensionUrl, gotoExtensionPage, newPage } from "../fixtures/browser"
import { clickByTestId, test, waitForHash } from "../fixtures/extension"
import { createAndActivateProfile } from "../fixtures/helpers"
import { approveDiscover, approveVerify, waitForPopup } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const PROFILE_B_PASSWORD = "SecondProfilePw123!"

/**
 * N-04 pin — live dApp channels are PROFILE-BOUND.
 *
 * Connect the playground under profile A, then switch to a new profile B
 * inside the same session (lock → auth's profile pill → New profile →
 * create, which activates B). The A-era encrypted channel must observe the
 * standard disconnect (identical signal to an explicit disconnect), and a
 * fresh connect under B must go through full discovery + verification —
 * proving the teardown killed the channel without wedging the origin.
 */
test.skipIf(!hasConfig)(
	"session-profileSwitch — switching profiles disconnects the dApp; reconnect under B works",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest }) => {
		const ctx = dappConnectedExtensionPerTest
		const playground = ctx.playgroundPage

		const statusBefore = await playground.evaluate(() =>
			document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status"),
		)
		expect(statusBefore).toBe("connected")

		// ── In-session switch: lock → pick "new profile" from auth → create B ──
		const wallet = await newPage(ctx.browser)
		await gotoExtensionPage(wallet, extensionUrl(ctx.extensionId, "/src/popup/index.html"))
		await waitForHash(wallet, "#/popup/general")
		// Creation activates B — this is the switch. The wallet lands home.
		await createAndActivateProfile(wallet, "Profile B", PROFILE_B_PASSWORD)

		// ── The A-era channel observes the standard disconnect ──
		await playground.waitForSelector('[data-testid="pg-status"][data-status="disconnected"]', { timeout: 20_000 })

		// ── Reconnect under B goes through fresh discovery + verification ──
		// Arm the verify wait BEFORE approving discovery: the SW can open the
		// verify window faster than a post-approval snapshot, which would
		// classify it preExisting and hang the wait (see fixtures/extension.ts).
		const discoverPopup = waitForPopup(ctx, "discover")
		const verifyPopup = waitForPopup(ctx, "verify")
		await clickByTestId(playground, "pg-btn-connect")
		await approveDiscover(await discoverPopup)
		await approveVerify(await verifyPopup)
		await playground.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })

		await wallet.close()
	},
)
