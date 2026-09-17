import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { assertPgOk, setPgInput, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup, waitForPopupClosed } from "../fixtures/popups"
import { getAccountAddress, hasTxCardByHash, switchAccountByAddress, waitForTxCardByHash } from "../fixtures/helpers"
import { readDappExecuteRecords } from "../fixtures/journal"
import { type AztecTestConfig, mintPublicTokensForAccount, waitForTxMined } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const lower = (s: string) => s.toLowerCase()
const SCOPE_FOLLOW_LOCK = "nulo:scope-follow"
const TERMINAL_STAGES = new Set(["succeeded", "failed", "cancelled"])
const WORKED_STAGES = ["simulating", "proving", "submitting", "succeeded"]

type LockHolder = Window & { __releaseScopeLock?: () => void }

/** The History page's feed root, scoped to `address`. Home renders its feed root only when the
 *  account has activity or a token, so the feed assertions live on History, which always does. */
async function gotoHistoryAs(page: Page, address: string): Promise<void> {
	if (!(await page.evaluate(() => window.location.hash.includes("/popup/activity")))) {
		await page.evaluate(() => {
			window.location.hash = "#/popup/activity"
		})
		await waitForHash(page, "#/popup/activity", 10_000)
	}
	await page.waitForFunction(
		(want: string) =>
			(document.querySelector('[data-testid="activity-feed-root"]')?.getAttribute("data-active-account") ?? "").toLowerCase() ===
			want,
		{ timeout: 30_000, polling: 200 },
		lower(address),
	)
}

async function waitForActiveAccountPointer(page: Page, address: string, timeout = 30_000): Promise<void> {
	await page.waitForFunction(
		async (want: string) => {
			const r = await chrome.storage.local.get("nulo:ui:activeAccount")
			return typeof r["nulo:ui:activeAccount"] === "string" && r["nulo:ui:activeAccount"].toLowerCase() === want
		},
		{ timeout, polling: 200 },
		lower(address),
	)
}

/** A dApp record the wallet accepted after `knownIds` were snapshotted, past the queue. */
async function waitForNewDappExecuteWorked(page: Page, knownIds: string[]): Promise<void> {
	await page.waitForFunction(
		async (known: string[], worked: string[]) => {
			type Row = { id?: string; kind?: string; progress?: { stage?: string } }
			const parse = (raw: unknown): Row | undefined => {
				try {
					return typeof raw === "string" ? JSON.parse(raw) : (raw as Row)
				} catch {
					return undefined
				}
			}
			const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
			return Object.entries(all).some(([k, raw]) => {
				const r = k.startsWith("nulo:journal@") ? parse(raw) : undefined
				return r?.kind === "dapp_execute" && !!r.id && !known.includes(r.id) && worked.includes(r.progress?.stage ?? "")
			})
		},
		{ timeout: 60_000, polling: 250 },
		knownIds,
		WORKED_STAGES,
	)
}

/**
 * Two granted accounts on one session: the wallet looks at A, the dApp sends as B. The execute
 * window names the mismatch as an account one. Confirming moves the wallet to B; declining first
 * leaves it on A; and a follow that finds the scope-follow lock held by another extension page
 * waits behind it without holding the approval, then completes on release.
 *
 * Post-confirm assertions read storage or a freshly opened popup — the wallet has no cross-window
 * propagation, so a popup that is open through Confirm keeps its old scope by design.
 */
test.skipIf(!hasConfig)(
	"execute-scope-account — confirming as another account moves the wallet there, declining keeps it, the lock is real",
	{ timeout: 900_000, retry: 0 },
	async ({ dappConnectedExtensionWithFirstTwoAccountsCap }) => {
		const ctx = dappConnectedExtensionWithFirstTwoAccountsCap
		const { playgroundPage: page, accountAddresses } = ctx
		const config = aztecConfig as AztecTestConfig
		expect(accountAddresses).toHaveLength(2)

		let wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		const active = lower(await getAccountAddress(wallet))
		const a = accountAddresses.find((x) => lower(x) === active)
		const b = accountAddresses.find((x) => lower(x) !== active)
		if (!a || !b) throw new Error(`active account ${active} is not one of the granted ${accountAddresses.join(", ")}`)
		await mintPublicTokensForAccount(config, b)

		await setPgInput(page, "tokenAddress", config.tokenAddress)
		await setPgInput(page, "recipient", config.minterAddress)
		await setPgInput(page, "amount", "1")
		await setPgInput(page, "from", b)

		/** Drive a send as B and wait for the window to name the account mismatch. */
		const sendAsB = async () => {
			const seq = await snapshotResultSeq(page)
			const execPopupP = waitForPopup(ctx, "execute", { timeout: 30_000 })
			await clickByTestId(page, "pg-btn-sendTx-default")
			const execPopup = await execPopupP
			await waitForExecuteContent(execPopup)
			const from = await execPopup.evaluate(
				() => document.querySelector('[data-testid="execute-op-from-account"]')?.getAttribute("data-account-address") ?? "",
			)
			expect(lower(from)).toBe(lower(b))
			await execPopup.waitForSelector('[data-testid="execute-scope-banner"][data-state="account"]', { timeout: 30_000 })
			return { seq, execPopup }
		}
		const settle = async (seq: number, label: string): Promise<string> => {
			const result = await waitForPgResult(page, "sendTx", seq, 300_000)
			await assertPgOk(page, result, label)
			const txHash = (result.resultJson as { txHash?: string }).txHash
			if (typeof txHash !== "string") throw new Error(`${label}: no txHash in ${JSON.stringify(result.resultJson)}`)
			await waitForTxMined(config, txHash)
			return txHash
		}

		// ── (i) Follow: the pointer moves to B and the next popup opens there.
		await wallet.close()
		const follow = await sendAsB()
		await approveExecute(follow.execPopup)
		await waitForPopupClosed(follow.execPopup, 60_000)

		wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		expect(lower(await getAccountAddress(wallet))).toBe(lower(b))

		// Switching while B's send is still running must go through: the send is the dApp's, not
		// the wallet's own transfer. Whether the window is caught depends on proving speed, so the
		// outcome is logged; the switch itself is asserted either way.
		await wallet.waitForSelector('[data-testid="tx-awaiting-card"]', { timeout: 10_000 }).catch(() => null)
		const stage = await wallet.evaluate(
			() => document.querySelector('[data-testid="tx-awaiting-card"]')?.getAttribute("data-stage") ?? null,
		)
		const caught = stage !== null && !TERMINAL_STAGES.has(stage)
		console.info(
			`[execute-scope-account] switch during B's send: ${caught ? `caught at stage "${stage}"` : "window missed, send already settled"}`,
		)
		await switchAccountByAddress(wallet, a)
		await gotoHistoryAs(wallet, a)
		await switchAccountByAddress(wallet, b)
		await gotoHistoryAs(wallet, b)

		const followHash = await settle(follow.seq, "execute-scope-account:follow")
		await waitForTxCardByHash(wallet, followHash, 120_000)
		console.log("✓ follow: the wallet moved to B and shows the transaction there")

		// ── (ii) Decline: the pointer stays on A; the transaction is B's alone.
		await switchAccountByAddress(wallet, a)
		await gotoHistoryAs(wallet, a)
		await wallet.close()
		const declined = await sendAsB()
		await clickByTestId(declined.execPopup, "execute-scope-action-btn")
		await declined.execPopup.waitForSelector('[data-testid="execute-scope-banner"][data-state="account-declined"]', { timeout: 10_000 })
		await approveExecute(declined.execPopup)
		await waitForPopupClosed(declined.execPopup, 60_000)

		wallet = await openPopup(ctx)
		await waitForHash(wallet, "#/popup/general", 30_000)
		expect(lower(await getAccountAddress(wallet))).toBe(lower(a))
		const declinedHash = await settle(declined.seq, "execute-scope-account:declined")
		await switchAccountByAddress(wallet, b)
		await gotoHistoryAs(wallet, b)
		await waitForTxCardByHash(wallet, declinedHash, 120_000)
		await switchAccountByAddress(wallet, a)
		await gotoHistoryAs(wallet, a)
		// Let a late feed refresh settle before asserting the absence.
		await new Promise((r) => setTimeout(r, 3_000))
		expect(await hasTxCardByHash(wallet, declinedHash)).toBe(false)
		console.log("✓ decline: the wallet stayed on A; the transaction shows only under B")

		// ── (iii) Lock contention: another extension page holds the follow's lock. The approval
		// still resolves and the send runs; the follow queues behind the holder, the window stays
		// open, and the pointer moves only once the holder lets go.
		await wallet.evaluate(
			(name: string) =>
				new Promise<void>((held) => {
					navigator.locks.request(
						name,
						() =>
							new Promise<void>((release) => {
								;(window as LockHolder).__releaseScopeLock = release
								held()
							}),
					)
				}),
			SCOPE_FOLLOW_LOCK,
		)
		const knownIds = (await readDappExecuteRecords(wallet)).map((r) => r.id)
		const contended = await sendAsB()
		await approveExecute(contended.execPopup)

		await wallet.waitForFunction(
			async (name: string) => {
				const state = await navigator.locks.query()
				return (state.pending ?? []).filter((lock) => lock.name === name).length === 1
			},
			{ timeout: 30_000, polling: 250 },
			SCOPE_FOLLOW_LOCK,
		)
		await waitForNewDappExecuteWorked(wallet, knownIds)
		expect(contended.execPopup.isClosed()).toBe(false)
		expect(lower(await getAccountAddress(wallet))).toBe(lower(a))
		console.log("✓ contention: the send runs and the follow waits behind the held lock")

		await wallet.evaluate(() => (window as LockHolder).__releaseScopeLock?.())
		await waitForPopupClosed(contended.execPopup, 60_000)
		await waitForActiveAccountPointer(wallet, b)
		await settle(contended.seq, "execute-scope-account:contended")
		console.log("✓ contention: released, the window closed and the pointer moved to B")

		expect(ctx.consoleErrors).toEqual([])
	},
)
