import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { navigateToSettings, switchAccountByAddress } from "../fixtures/helpers"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, pickFeeAndSubmitAuthwitPopup, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { waitForTxMined, type AztecTestConfig } from "../fixtures/aztec"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { isAuthRegistryEnabled, isAuthwitConsumable } from "@/wallet/utils/auth-registry"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
// Proverless shard (NULO_E2E_PROVERLESS=1): the grant + the two settings sendTxs
// collapse to fake-proof speed (on-chain mining stays real). No consume tx is issued
// (see below), so the assertions are deterministic — run with NULO_E2E_RETRY=0.

/**
 * Public-authwit SETTINGS lifecycle — behavioral coverage for the two
 * zero-e2e-coverage wallet flows `revokeAuthwits` and `setRegistryEnabled`.
 *
 * Asserted at the layer the WALLET owns: the on-chain AuthRegistry WRITES these
 * flows produce — `approved_actions[A][hash]` (grant/revoke) and `reject_all[A]`
 * (disable/enable) — read back via `isAuthwitConsumable` / `isAuthRegistryEnabled`.
 *
 * Why NOT assert a consume outcome: the e2e wallet holds BOTH session accounts, and
 * `handleSendTx` currently resolves the sender to the FIRST session account, ignoring
 * `opts.from` (dispatcher.ts:511-513 + resolveNetworkAndAccount:1191-1196). So a
 * "B consumes A's grant" tx is actually sent AS A — a self-send (`from == msg_sender`)
 * that needs no authwit, making revoke/disable invisible to the consume and the consume
 * itself vacuous. That `opts.from` clobber is a separate multi-account wallet bug,
 * classified + filed for its own focused fix in
 * implementations-plan/network-e2e-required/lessons/phase-4.md (matrix soak
 * `[F1-MATRIX] disableBlocks=false` + codex round 8). Until it is fixed, the consume
 * cannot observe public-registry enforcement here, so this test asserts the registry
 * state the wallet actually writes. A true end-to-end revoke proof (consume blocked
 * after revoke) is gated on that fix.
 */
test.skipIf(!hasConfig)(
	"authwit settings — revoke clears the on-chain grant; registry toggle flips reject_all",
	{ timeout: 1_200_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		expect(accountAddresses.length).toBe(2)
		const [ownerA, callerB] = accountAddresses as [string, string]
		const step = (m: string) => console.log(`[authwit-lifecycle] ${m}`)
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)

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
		// Grant as owner A (playground granted[0] === A): grantPublicAuthwit →
		// on-chain set_authorized(hash, true). Returns once mined.
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

		// Open A's Authwits settings, trigger a dropdown action (revoke-all or
		// registry-toggle), pick fee + submit the in-page overlay, wait for the
		// settings sendTx to leave the popup (submitted), close. Each is a proving
		// sendTx — hence the wide settle budget.
		const settingsAction = async (actionTestId: string, submitTestId: string) => {
			const walletPopup = await openPopup(ctx)
			await switchAccountByAddress(walletPopup, ownerA) // view the GRANTER's registry (ownerA = accountAddresses[0])
			await navigateToSettings(walletPopup, "advanced", "account-state", "authwits")
			await clickByTestId(walletPopup, "authwits-actions-btn")
			// revoke-all is gated on the async authwit list (`:disabled="!authwits.length"`);
			// clickByTestId waits out aria-disabled, so this auto-waits for the list to load.
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

		// The wallet's tracked authwit hash for A == the on-chain grant hash:
		// tx-request-builder passes ONE messageHash to both trackAuthwit + set_authorized.
		const readTrackedHashForA = async (): Promise<{ account: string; hash: string }> => {
			const p = await openPopup(ctx)
			const rows = await p.evaluate(async () => {
				const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
				return Object.entries(all)
					.filter(([k]) => k.startsWith("nulo:core:auth-registry@"))
					.map(([, v]) => JSON.parse(v as string) as { account: string; hash: string })
					.map((a) => ({ account: a.account, hash: a.hash }))
			})
			await p.close()
			const row = rows.find((r) => r.account === ownerA) ?? rows[0]
			if (!row) throw new Error("no tracked authwit row for the granter after grant")
			return row
		}

		// Poll the on-chain registry until `predicate` holds. The settings flows wait
		// for proven internally, but poll for robustness against submit→mine settling.
		const waitForRegistry = async (predicate: () => Promise<boolean>, label: string, timeoutMs = 180_000) => {
			const deadline = Date.now() + timeoutMs
			for (;;) {
				if (await predicate()) return
				if (Date.now() > deadline) throw new Error(`waitForRegistry timeout: ${label}`)
				await new Promise((r) => setTimeout(r, 2_000))
			}
		}

		// ── grant → approved_actions[A][hash] = 1 ──
		step("grant G1")
		await grant("1")
		const g1 = await readTrackedHashForA()
		step("assert grant wrote approved_actions[A][hash]=1")
		await waitForRegistry(() => isAuthwitConsumable(node, g1.account, g1.hash), "granted")

		// ── revoke → approved_actions[A][hash] = 0  (revokeAuthwits coverage) ──
		step("revoke all of A's authwits via settings")
		await settingsAction("authwits-revoke-all", "revoke-authwits-submit")
		step("assert revoke cleared approved_actions[A][hash]=0")
		await waitForRegistry(async () => !(await isAuthwitConsumable(node, g1.account, g1.hash)), "revoked")

		// ── disable → reject_all[A]=1; enable → reject_all[A]=0  (setRegistryEnabled coverage) ──
		step("disable registry via settings")
		await settingsAction("authwits-toggle-registry", "registry-toggle-submit")
		step("assert registry disabled (reject_all[A]=1)")
		await waitForRegistry(async () => !(await isAuthRegistryEnabled(node, ownerA)), "disabled")
		step("re-enable registry via settings")
		await settingsAction("authwits-toggle-registry", "registry-toggle-submit")
		step("assert registry re-enabled (reject_all[A]=0)")
		await waitForRegistry(() => isAuthRegistryEnabled(node, ownerA), "enabled")

		step("DONE")
	},
)
