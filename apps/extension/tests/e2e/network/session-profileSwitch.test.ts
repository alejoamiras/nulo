import { expect, inject } from "vitest"
import { clickByTestId, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import { approveDiscover, approveVerify, waitForPopup } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const PROFILE_B_PASSWORD = "SecondProfilePw123!"

/**
 * N-04 pin — live dApp channels are PROFILE-BOUND.
 *
 * Connect the playground under profile A, then switch to a new profile B
 * inside the same session (lock → auth's profile pill → New profile → create,
 * which activates B — the first in-session profile switch ever driven in
 * e2e). The A-era encrypted channel must observe the standard disconnect
 * (identical signal to an explicit disconnect), a post-switch call must
 * reject rather than answer from B's world, and a fresh connect under B must
 * succeed through discovery — proving the teardown didn't wedge the origin.
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
		const wallet = await ctx.browser.newPage()
		await wallet.goto(`chrome-extension://${ctx.extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
		await waitForHash(wallet, "#/popup/general")
		await clickByTestId(wallet, "header-lock")
		await wallet.waitForSelector('[data-testid="auth-profile"]', { visible: true, timeout: 15_000 })
		await clickByTestId(wallet, "auth-profile")
		await wallet.waitForSelector('[data-testid="select-profile-new-btn"]', { visible: true, timeout: 10_000 })
		await clickByTestId(wallet, "select-profile-new-btn")

		await wallet.waitForSelector('[data-testid="register-name-input"]', { visible: true, timeout: 10_000 })
		await replaceInputValue(wallet, '[data-testid="register-name-input"]', "Profile B")
		await replaceInputValue(wallet, '[data-testid="register-password-input"]', PROFILE_B_PASSWORD)
		await replaceInputValue(wallet, '[data-testid="register-password-confirm-input"]', PROFILE_B_PASSWORD)
		await clickByTestId(wallet, "register-submit-btn")
		// Creation activates B — this is the switch. The wallet lands home.
		await waitForHash(wallet, "#/popup/general", 90_000)

		// ── The A-era channel observes the standard disconnect ──
		await playground.waitForSelector('[data-testid="pg-status"][data-status="disconnected"]', { timeout: 20_000 })

		// A post-switch call cannot ride the dead channel: the SDK-side wallet
		// handle rejects immediately (same contract as explicit disconnect —
		// nothing of B is observable).
		const callRejected = await playground.evaluate(() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="pg-btn-getAccounts"]')
			if (!btn) return "no-button"
			btn.click()
			return "clicked"
		})
		expect(callRejected).toBe("clicked")
		const realAccounts = await playground.evaluate(
			() =>
				[...document.querySelectorAll('[data-testid="pg-account-item"]')].filter((el) => el.getAttribute("data-account-id")).length,
		)
		expect(realAccounts).toBe(0)

		// ── Reconnect under B goes through fresh discovery + verification ──
		const discoverPopup = waitForPopup(ctx, "discover")
		await clickByTestId(playground, "pg-btn-connect")
		await approveDiscover(await discoverPopup)
		const verifyPopup = waitForPopup(ctx, "verify")
		await approveVerify(await verifyPopup)
		await playground.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })

		await wallet.close()
	},
)
