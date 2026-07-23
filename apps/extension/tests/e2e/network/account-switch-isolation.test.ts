/**
 * Account-switch cross-account isolation — Phase 0 HARNESS.
 *
 * This file will grow the full isolation assertions in Phase 1 (a real
 * third-party note lands under account A while account B is active and must
 * NOT surface in B's feed). Phase 0 proves ONLY that the deterministic
 * race harness itself works end-to-end, so Phase 1 can trust it:
 *
 *   - a real private note is delivered to account A and mined,
 *   - the bidirectional incoming-poll gate parks A's scan AFTER PXE discovery
 *     and BEFORE the locked commit (`discovery-held`),
 *   - NOTHING is committed while the scan is held (the record for that tx hash
 *     is absent),
 *   - releasing the gate lets the parked scan finish (`committed`) and A's
 *     incoming record THEN appears.
 *
 * Gate contract lives in `src/e2e/chrome-storage-incoming-poll-gate.ts`; the
 * test-side driver in `../fixtures/incoming-poll-gate.ts`. Requires a
 * PROVERLESS build (`NULO_E2E_PROVERLESS=1`) — that's the only build where the
 * gate is compiled in. Run zero-retry (`NULO_E2E_RETRY=0`): the file-scoped
 * `tokenReadyExtension` mutates on-chain + PXE state, so a retry would re-run
 * against a half-consumed sandbox.
 */
import { expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { getAccountAddress, refreshBalances } from "../fixtures/helpers"
import { holdIncomingPoll, readIncomingPollStatus, releaseIncomingPoll, waitForIncomingPollPhase } from "../fixtures/incoming-poll-gate"
import type { AztecTestConfig } from "../fixtures/aztec"
import type { Page } from "puppeteer"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** Minimal projection of the persisted incoming record we correlate on. */
type StoredIncomingRecord = { txHash?: string; accountAddress?: string; hidden?: boolean }

/** Scan `chrome.storage.local` for the committed incoming record whose
 *  `txHash` matches. Returns null while none exists. Storage-level (not DOM)
 *  because the incoming card exposes no per-hash `data-testid` — correlating in
 *  the DOM would require a text-based selector, which the e2e selector rule
 *  forbids. The record's `txHash` is `note.txHash.toString()`, the SAME value
 *  the delivery helper returns, so the correlation is exact. */
async function findIncomingRecordByHash(page: Page, txHash: string): Promise<StoredIncomingRecord | null> {
	return page.evaluate(async (want: string) => {
		const all = await chrome.storage.local.get(null)
		for (const [key, value] of Object.entries(all)) {
			if (!key.startsWith("nulo:core:incoming-transfers@")) continue
			if (typeof value !== "string") continue
			try {
				const rec = JSON.parse(value) as { txHash?: string; accountAddress?: string; hidden?: boolean }
				if (rec && rec.txHash === want) return rec
			} catch {
				// Non-JSON value under this root — ignore.
			}
		}
		return null
	}, txHash)
}

test.skipIf(!hasConfig)(
	"phase-0 harness: incoming-poll gate holds A's scan after discovery, releases into a committed record",
	{ timeout: 300_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		if (!aztecConfig) throw new Error("unreachable — skipIf guards hasConfig")

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 30_000)

		const accountA = await getAccountAddress(page)
		expect(accountA).toBe(tokenReadyExtension.accountAddress)

		// ── Resolve the active (profile, network, account) triple the gate arms
		//    on. profileId lives under `nulo:ui:lastActiveProfile`; the active
		//    network id under `nulo:core:active-network@<profileId>` (same reads
		//    incoming-transfers.test.ts uses). contract is the fixture's token.
		const triple = await page.evaluate(async () => {
			const profileId = (await chrome.storage.local.get("nulo:ui:lastActiveProfile"))["nulo:ui:lastActiveProfile"]
			const account = (await chrome.storage.local.get("nulo:ui:activeAccount"))["nulo:ui:activeAccount"]
			let networkId: string | null = null
			if (typeof profileId === "string") {
				const activeKey = `nulo:core:active-network@${profileId}`
				const activeId = (await chrome.storage.local.get(activeKey))[activeKey]
				if (typeof activeId === "string") networkId = activeId
			}
			return {
				profileId: typeof profileId === "string" ? profileId : null,
				account: typeof account === "string" ? account : null,
				networkId,
			}
		})
		if (!triple.profileId || !triple.networkId || !triple.account) {
			throw new Error(`could not resolve active (profile, network, account): ${JSON.stringify(triple)}`)
		}
		expect(triple.account).toBe(accountA)
		const contract = aztecConfig.tokenAddress

		// ── Deliver a real private note to A from an independent EmbeddedWallet
		//    and capture the mined tx hash. The token was imported (and thus
		//    auto-trusted) by the `tokenReadyExtension` fixture, so once the scan
		//    commits, the record persists visible.
		const AMOUNT = 25n * 10n ** 18n
		const { createTestWallet, createSponsoredFeeOptions, mintPrivateTokens } = await import("../fixtures/aztec")
		let txHash: string
		const { wallet, node, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
		try {
			const feeOptions = await createSponsoredFeeOptions(wallet)
			txHash = await mintPrivateTokens(wallet, node, contract, accountA, AMOUNT, aztecConfig.minterAddress, feeOptions)
		} finally {
			await cleanup()
		}
		expect(txHash).toMatch(/^0x[0-9a-fA-F]+$/)
		console.log(`✓ Delivered private note to A (${accountA.slice(0, 10)}…) in tx ${txHash}`)

		// ── Arm the gate BEFORE the extension PXE has synced the note. The next
		//    scan of (profile, network, A, contract) that DISCOVERS a note
		//    carrying this txHash parks after discovery, before the locked commit.
		await holdIncomingPoll(page, {
			profileId: triple.profileId,
			networkId: triple.networkId,
			accountAddress: accountA,
			contract,
			txHash,
		})

		// ── Drive the extension PXE forward until a scan discovers the note and
		//    parks at the gate. `refreshBalances` advances the popup PXE sync
		//    (each fires a simulateTx); the incoming scheduler (30s cadence) then
		//    discovers the just-synced note and — because the gate is armed for
		//    exactly this note — parks in `scanContract`.
		let held = false
		for (let i = 0; i < 40 && !held; i++) {
			await refreshBalances(page)
			for (let j = 0; j < 15 && !held; j++) {
				const status = await readIncomingPollStatus(page)
				if (status?.phase === "discovery-held" && status.txHash === txHash) {
					held = true
					break
				}
				await new Promise((r) => setTimeout(r, 300))
			}
		}
		expect(held).toBe(true)
		// Belt-and-suspenders: the fixture wait confirms the exact phase+hash.
		await waitForIncomingPollPhase(page, "discovery-held", txHash, 5_000)
		console.log("✓ Scan parked at discovery-held for A's note")

		// ── While held, NOTHING is committed: no incoming record for this hash.
		const whileHeld = await findIncomingRecordByHash(page, txHash)
		expect(whileHeld).toBeNull()
		console.log("✓ No incoming record committed while the scan is held")

		// ── Release → the parked scan finishes its locked commit → `committed`.
		await releaseIncomingPoll(page)
		await waitForIncomingPollPhase(page, "committed", txHash, 20_000)
		console.log("✓ Gate reported committed after release")

		// ── A's incoming record THEN appears, correlated by the exact tx hash,
		//    owned by A, and visible (auto-trusted token).
		let record: StoredIncomingRecord | null = null
		for (let i = 0; i < 25 && !record; i++) {
			record = await findIncomingRecordByHash(page, txHash)
			if (record) break
			await new Promise((r) => setTimeout(r, 200))
		}
		expect(record).not.toBeNull()
		expect(record?.accountAddress).toBe(accountA)
		expect(record?.hidden).toBe(false)
		console.log("✓ A's incoming record committed after release (correlated by tx hash)")

		// Repo convention: no unexpected console / page errors across the flow.
		expect(tokenReadyExtension.consoleErrors).toEqual([])
		expect(tokenReadyExtension.pageErrors).toEqual([])

		await page.close()
	},
)
