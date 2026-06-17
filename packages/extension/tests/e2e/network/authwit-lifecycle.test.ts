import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { navigateToSettings, switchAccount } from "../fixtures/helpers"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, pickFeeAndSubmitAuthwitPopup, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { mintPublicTokensForAccount, waitForTxMined, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
// Runs in the proverless shard pool (NULO_E2E_PROVERLESS=1): the many serial
// proofs that previously exhausted puppeteer's protocolTimeout collapse to
// fake-proof speed (kernel sim + on-chain mining stay real), so the
// RUN_AUTHWIT_E2E opt-in gate is removed and this rejoins the standard suite.
// Lifecycle is grant→consume/revoke (not sequencing/cancel) — PLAIN proverless, no barrier.

/**
 * Public-authwit LIFECYCLE: grant → consume / revoke → registry-toggle,
 * the behavioral gate for the two zero-e2e-coverage settings flows
 * (`revokeAuthwits`, `setRegistryEnabled`).
 *
 * Registry approvals are SINGLE-USE (consume burns them), so each step
 * uses a FRESH nonce and the revoke / disable negatives target an
 * UNCONSUMED grant — otherwise the negative would pass vacuously
 * ("already consumed" indistinguishable from "revoked"). Account A is
 * the owner/granter (settings actions act on A's registry); B is the
 * named caller that consumes.
 *
 * Non-vacuity: step 1 consumes G1 successfully (the mechanism works),
 * THEN step 2 revokes a fresh, never-consumed G2 and shows its consume
 * fails — the failure is attributable to the revoke, not prior use.
 */
test.skipIf(!hasConfig)(
	"authwit-lifecycle — grant/consume, revoke blocks, registry toggle blocks then restores",
	{ timeout: 1_200_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		expect(accountAddresses.length).toBe(2)
		const [ownerA, callerB] = accountAddresses as [string, string]
		const step = (m: string) => console.log(`[authwit-lifecycle] ${m}`)

		await mintPublicTokensForAccount(aztecConfig!, ownerA)

		const setInputs = async (nonce: string) => {
			await page.evaluate(
				({ token, owner, caller, n }: { token: string; owner: string; caller: string; n: string }) => {
					const setVal = (sel: string, v: string) => {
						const input = document.querySelector<HTMLInputElement>(sel)
						if (!input) return
						const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
						setter?.call(input, v)
						input.dispatchEvent(new Event("input", { bubbles: true }))
					}
					setVal('[data-testid="pg-input-tokenAddress"]', token)
					setVal('[data-testid="pg-input-authwitOwner"]', owner)
					setVal('[data-testid="pg-input-authwitCaller"]', caller)
					setVal('[data-testid="pg-input-authwitAmount"]', "1")
					setVal('[data-testid="pg-input-authwitNonce"]', n)
				},
				{ token: aztecConfig!.tokenAddress, owner: ownerA, caller: callerB, n: nonce },
			)
		}
		const selectPgAccount = async (addr: string) => {
			await page.evaluate((a: string) => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-select-account"]')
				if (!select) throw new Error("pg-select-account not present")
				select.value = a
				select.dispatchEvent(new Event("change", { bubbles: true }))
			}, addr)
		}
		// Grant as owner A (playground granted[0] === A). Returns once mined.
		const grant = async (nonce: string) => {
			await selectPgAccount(ownerA)
			await setInputs(nonce)
			const seq = await snapshotResultSeq(page)
			const popupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-grantPublicAuthwit")
			const popup = await popupP
			await waitForExecuteContent(popup)
			await approveExecute(popup)
			const res = await waitForPgResult(page, "grantPublicAuthwit", seq, 360_000)
			expect(res.status).toBe("ok")
			await waitForTxMined(aztecConfig!, String(res.resultJson).replace(/^"(.*)"$/, "$1"))
		}
		// Consume as caller B: transfer_public_to_public(A, B, 1, nonce).
		const consume = async (nonce: string): Promise<"ok" | "error"> => {
			await selectPgAccount(callerB)
			await setInputs(nonce)
			const seq = await snapshotResultSeq(page)
			const popupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-consumeAuthwit")
			const popup = await popupP
			await waitForExecuteContent(popup)
			await approveExecute(popup)
			const res = await waitForPgResult(page, "sendTx", seq, 360_000)
			return res.status
		}

		// ── Step 1: G1 grant → consume OK (burns G1) ──
		step("G1 grant")
		await grant("1")
		step("G1 consume (expect ok)")
		expect(await consume("1")).toBe("ok")

		// Open A's Authwits settings, trigger a dropdown action (revoke-all or
		// registry-toggle), pick fee + submit the in-page overlay, wait for the
		// settings sendTx to leave the popup (submitted), close. Each is a
		// proving sendTx — hence the wide settle budget.
		const settingsAction = async (actionTestId: string, submitTestId: string) => {
			const walletPopup = await openPopup(ctx)
			await switchAccount(walletPopup, "Account") // active wallet account = owner A
			await navigateToSettings(walletPopup, "advanced", "account-state", "authwits")
			await clickByTestId(walletPopup, "authwits-actions-btn")
			// revoke-all is gated on the async authwit list (`:disabled="!authwits.length"`);
			// clickByTestId now waits out aria-disabled, so this auto-waits for the list to
			// load before clicking — no action-specific wait needed.
			await clickByTestId(walletPopup, actionTestId)
			// The popup is a Vue overlay inside the wallet page (popupStore.open),
			// not a separate browser window — submit in place.
			await walletPopup.waitForSelector(`[data-testid="${submitTestId}"]`, { visible: true, timeout: 15_000 })
			await pickFeeAndSubmitAuthwitPopup(walletPopup, submitTestId)
			await walletPopup.waitForFunction(
				(id: string) => !document.querySelector(`[data-testid="${id}"]`),
				{ timeout: 360_000 },
				submitTestId,
			)
			await walletPopup.close()
		}

		// ── Step 2: G2 grant → revoke (as A) → consume FAILS (never consumed) ──
		step("G2 grant")
		await grant("2")
		step("revoke all of A's authwits via settings")
		await settingsAction("authwits-revoke-all", "revoke-authwits-submit")
		step("G2 consume (expect error — revoked)")
		expect(await consume("2")).toBe("error")

		// ── Step 3: G3 grant → registry DISABLE → consume FAILS → ENABLE → consume OK ──
		// reject_all is checked before the approval, so a disabled-registry
		// consume reverts WITHOUT burning G3 — re-enabling restores it.
		step("G3 grant")
		await grant("3")
		step("disable registry via settings")
		await settingsAction("authwits-toggle-registry", "registry-toggle-submit")
		step("G3 consume (expect error — registry disabled)")
		expect(await consume("3")).toBe("error")
		step("re-enable registry via settings")
		await settingsAction("authwits-toggle-registry", "registry-toggle-submit")
		step("G3 consume again (expect ok — approval survived the reverted consume)")
		expect(await consume("3")).toBe("ok")

		step("DONE")
	},
)
