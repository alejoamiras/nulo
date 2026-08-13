import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { navigateToSettings, switchAccountByAddress } from "../fixtures/helpers"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { approveExecute, pickFeeAndSubmitAuthwitPopup, waitForExecuteContent, waitForPopup } from "../fixtures/popups"
import { mintPublicTokensForAccount, waitForTxMined, type AztecTestConfig } from "../fixtures/aztec"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { isAuthRegistryEnabled, isAuthwitConsumable } from "@/wallet/utils/auth-registry"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
// Proverless shard (NULO_E2E_PROVERLESS=1): the grants, the two settings sendTxs, and the
// consume transfers collapse to fake-proof speed (on-chain mining stays real). Run with
// NULO_E2E_RETRY=0 to keep the gate honest.

/**
 * Public-authwit LIFECYCLE — end-to-end coverage for the two zero-e2e-coverage wallet
 * flows `revokeAuthwits` and `setRegistryEnabled`, asserted on BOTH layers:
 *   - the on-chain AuthRegistry WRITES the flows own (`approved_actions[A][hash]`,
 *     `reject_all[A]`), read via `isAuthwitConsumable` / `isAuthRegistryEnabled`; and
 *   - the ENFORCEMENT — caller B's `transfer_public_to_public(A, …)` consume, which is
 *     authorized while the public grant stands and reverts once A revokes it.
 *
 * The enforcement layer is observable only because `sendTx` now honors `opts.from`
 * (wallet-bridge fix `5d09ca3`): the consume is genuinely sent from B, so the token's
 * authwit check consults A's public registry. Before that fix the consume collapsed to a
 * self-send by A (no authwit needed); see FOLLOWUP-opts-from-clobber.md (now resolved) and
 * lessons/phase-4.md for the full classification.
 *
 * Non-vacuity: G1 consumes successfully (the mechanism works), THEN G2 is granted, revoked,
 * and its consume FAILS — the failure is attributable to the revoke, not prior use.
 */
test.skipIf(!hasConfig)(
	"authwit-lifecycle — grant/consume, revoke blocks consume + clears slot, registry toggle",
	{ timeout: 1_200_000 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		expect(accountAddresses.length).toBe(2)
		const [ownerA, callerB] = accountAddresses as [string, string]
		const step = (m: string) => console.log(`[authwit-lifecycle] ${m}`)
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)

		// A is the transfer `from` in each consume — fund A so a non-revoked consume
		// can actually move tokens (otherwise it reverts on insufficient balance,
		// masking the authwit-enforcement signal).
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
		// Grant as owner A: grantPublicAuthwit → on-chain set_authorized(hash, true). Mined on return.
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
			await assertPgOk(page, res, "authwit-lifecycle.test:res")
			await waitForTxMined(aztecConfig!, String(res.resultJson).replace(/^"(.*)"$/, "$1"))
		}
		// Consume as caller B: transfer_public_to_public(A, B, 1, nonce). sendTx now honors
		// `from: B`, so this genuinely exercises A's public authwit. Asserts the MINED outcome
		// — a revoked/blocked consume reverts at sequencing; the NO_WAIT dApp result is
		// `{ txHash, ... }`, so pull the hash out of either shape.
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
			if (res.status !== "ok") return "error"
			const rj = res.resultJson
			const inner = rj && typeof rj === "object" && "txHash" in rj ? (rj as { txHash: unknown }).txHash : rj
			const hashSrc = inner && typeof inner === "object" && "hash" in inner ? (inner as { hash: unknown }).hash : inner
			const txHash = String(hashSrc ?? "").replace(/^"(.*)"$/, "$1")
			if (!/^0x[0-9a-fA-F]+$/.test(txHash)) return "error"
			try {
				await waitForTxMined(aztecConfig!, txHash)
				return "ok"
			} catch {
				return "error"
			}
		}

		// Open A's Authwits settings, trigger a dropdown action (revoke-all or registry-toggle),
		// pick fee + submit the in-page overlay, wait for the settings sendTx to leave the popup,
		// close. Each is a proving sendTx — hence the wide settle budget.
		const settingsAction = async (actionTestId: string, submitTestId: string) => {
			const walletPopup = await openPopup(ctx)
			await switchAccountByAddress(walletPopup, ownerA) // view the GRANTER's registry (ownerA = accountAddresses[0])
			await navigateToSettings(walletPopup, "advanced", "account-state", "authwits")
			await clickByTestId(walletPopup, "authwits-actions-btn")
			// revoke-all is gated on the async authwit list (`:disabled="!authwits.length"`);
			// clickByTestId waits out aria-disabled, so this auto-waits for the list to load.
			await clickByTestId(walletPopup, actionTestId)
			await walletPopup.waitForSelector(`[data-testid="${submitTestId}"]`, { visible: true, timeout: 15_000 })
			await pickFeeAndSubmitAuthwitPopup(walletPopup, submitTestId)
			await walletPopup.waitForFunction(
				(id: string) => !document.querySelector(`[data-testid="${id}"]`),
				{ timeout: 360_000 },
				submitTestId,
			)
			await walletPopup.close()
		}

		// All of A's tracked authwit hashes. The wallet's tracked hash == the on-chain grant
		// hash (tx-request-builder passes ONE messageHash to both trackAuthwit + set_authorized).
		const trackedHashesForA = async (): Promise<{ account: string; hash: string }[]> => {
			const p = await openPopup(ctx)
			const rows = await p.evaluate(async () => {
				const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
				return Object.entries(all)
					.filter(([k]) => k.startsWith("nulo:core:auth-registry@"))
					.map(([, v]) => JSON.parse(v as string) as { account: string; hash: string })
					.map((a) => ({ account: a.account, hash: a.hash }))
			})
			await p.close()
			return rows.filter((r) => r.account === ownerA)
		}

		// Poll the on-chain registry until `predicate` holds. The settings flows wait for
		// proven internally, but poll for robustness against submit→mine settling.
		const waitForRegistry = async (predicate: () => Promise<boolean>, label: string, timeoutMs = 180_000) => {
			const deadline = Date.now() + timeoutMs
			for (;;) {
				if (await predicate()) return
				if (Date.now() > deadline) throw new Error(`waitForRegistry timeout: ${label}`)
				await new Promise((r) => setTimeout(r, 2_000))
			}
		}

		// ── Step 1: G1 grant → on-chain approved → consume OK (the mechanism works) ──
		step("G1 grant")
		await grant("1")
		const [g1] = await trackedHashesForA()
		expect(g1).toBeDefined()
		step("assert G1 on-chain approved")
		await waitForRegistry(() => isAuthwitConsumable(node, g1.account, g1.hash), "G1 granted")
		step("G1 consume (expect ok)")
		expect(await consume("1")).toBe("ok")

		// ── Step 2: G2 grant → revoke → slot cleared + consume FAILS (non-vacuous) ──
		step("G2 grant")
		await grant("2")
		// G2 is the freshly-granted, still-consumable row (G1 was burned by its consume).
		let g2hash: string | undefined
		for (const r of await trackedHashesForA()) {
			if (await isAuthwitConsumable(node, r.account, r.hash)) {
				g2hash = r.hash
				break
			}
		}
		expect(g2hash).toBeDefined()
		step("revoke all of A's authwits via settings")
		await settingsAction("authwits-revoke-all", "revoke-authwits-submit")
		step("assert revoke cleared G2's slot")
		await waitForRegistry(async () => !(await isAuthwitConsumable(node, ownerA, g2hash as string)), "G2 revoked")
		step("G2 consume (expect error — revoked)")
		expect(await consume("2")).toBe("error")

		// ── Step 3: registry DISABLE → reject_all set; ENABLE → cleared (setRegistryEnabled) ──
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
