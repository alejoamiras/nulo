/**
 * Account-switch cross-account isolation — Phase 0 HARNESS + Phase 1 GATE.
 *
 * Two tests live here. The FIRST (Phase 0) proves the deterministic race
 * harness works end-to-end. The SECOND (Phase 1 — Gate 1, plan §7) uses that
 * harness to prove the real containment invariant: account A's incoming note
 * AND A's settled extension transaction never render in account B's feed, and
 * reappear when we switch back to A (a positive control that proves we
 * suppressed a leak, not the feature). Containment is UI-side — a foreign
 * record still PERSISTS in `chrome.storage.local`; the assertion is on the
 * rendered feed cards, never on storage.
 *
 * Phase 0 proves ONLY that the deterministic race harness itself works
 * end-to-end, so Phase 1 can trust it:
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
 *
 * @requires-proverless — formal marker scanned by scripts/e2e/agent.sh; the
 * beforeAll below is the belt for direct-vitest invocations that bypass it.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, expect, inject } from "vitest"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import {
	captureBalanceBaseline,
	createSecondAccount,
	getAccountAddress,
	refreshBalances,
	sendTransfer,
	switchAccountByAddress,
	waitForFreshBalanceRow,
	waitForTxConfirmation,
} from "../fixtures/helpers"
import { holdIncomingPoll, readIncomingPollStatus, releaseIncomingPoll, waitForIncomingPollPhase } from "../fixtures/incoming-poll-gate"
import type { AztecTestConfig } from "../fixtures/aztec"
import type { Page } from "puppeteer"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined

// Arming preflight (hard abort, file-level): the incoming-poll gate exists in
// the bundle ONLY under a proverless-armed build; against an unarmed dist this
// file's polls time out after minutes with no hint why. Scan the loaded dist
// for the compile-time stamp and fail in seconds with the remedial command
// instead. beforeAll (not a sibling test) so the expensive tests never start.
beforeAll(() => {
	const extensionPath = inject("extensionPath") as string
	const assetsDir = join(extensionPath, "assets")
	const armed = readdirSync(assetsDir).some(
		(f) => f.endsWith(".js") && readFileSync(join(assetsDir, f), "utf8").includes("NULO_E2E_PROVERLESS_BUILD_STAMP"),
	)
	expect(
		armed,
		"The extension build at EXTENSION_PATH is NOT proverless-armed — the incoming-poll gate is compiled out, " +
			"and every test in this file would silently time out. Rebuild + run with: " +
			"NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts",
	).toBe(true)
})
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
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		if (!aztecConfig) throw new Error("unreachable — skipIf guards hasConfig")

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 30_000)

		const accountA = await getAccountAddress(page)
		expect(accountA).toBe(tokenReadyExtension.accountAddress)

		// ── Resolve the active (profile, network, account) triple the gate arms
		//    on (the same persisted keys incoming-transfers.test.ts reads).
		//    contract is the fixture's token.
		const triple = await resolveActiveTriple(page)
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
		expect(await driveScanUntilHeld(page, txHash)).toBe(true)
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
		const record = await pollIncomingRecordByHash(page, txHash)
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

/** Resolve the active `(profileId, networkId, accountAddress)` triple the gate
 *  arms on, from the same persisted keys the Phase-0 harness reads. Throws with
 *  the observed shape if any leg is missing. */
async function resolveActiveTriple(page: Page): Promise<{ profileId: string; networkId: string; account: string }> {
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
	return { profileId: triple.profileId, networkId: triple.networkId, account: triple.account }
}

/** Drive the extension PXE forward until a scan discovers the note and parks at
 *  `discovery-held` for `txHash`: at most 40 refreshes, each followed by up to 15
 *  status reads 300 ms apart (the sleep follows every miss, none follows the hit). */
async function driveScanUntilHeld(page: Page, txHash: string): Promise<boolean> {
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
	return held
}

/** The incoming record correlated by `txHash`, polled up to 25 times 200 ms apart. */
async function pollIncomingRecordByHash(page: Page, txHash: string): Promise<StoredIncomingRecord | null> {
	let record: StoredIncomingRecord | null = null
	for (let i = 0; i < 25 && !record; i++) {
		record = await findIncomingRecordByHash(page, txHash)
		if (record) break
		await new Promise((r) => setTimeout(r, 200))
	}
	return record
}

/** Deliver a real private note to `toAddress` from an independent EmbeddedWallet
 *  (a genuine third-party sender) and return the mined tx hash — the SAME value
 *  the extension's note scanner reports as `note.txHash`, so the caller can arm
 *  the incoming-poll gate for it. */
async function deliverPrivateNoteTo(
	nodeUrl: string,
	contract: string,
	toAddress: string,
	amount: bigint,
	minterAddress: string,
): Promise<string> {
	const { createTestWallet, createSponsoredFeeOptions, mintPrivateTokens } = await import("../fixtures/aztec")
	const { wallet, node, cleanup } = await createTestWallet(nodeUrl)
	try {
		const feeOptions = await createSponsoredFeeOptions(wallet)
		return await mintPrivateTokens(wallet, node, contract, toAddress, amount, minterAddress, feeOptions)
	} finally {
		await cleanup()
	}
}

/** Wait until the rendered activity-feed root declares `address` as its active
 *  account (`data-active-account`).
 *
 *  Surface choice: the History page (`activity.vue`) feed root is gated ONLY on
 *  `appStore.isLogined`, so it deterministically reflects the switched account
 *  in BOTH the leaking (pre-fix) and contained (post-fix) states. The home
 *  Recent-Activity widget's root is instead conditional on there being activity
 *  and VANISHES for a contained fresh account — waiting on it for account B
 *  would false-timeout once containment lands. This surface therefore can't
 *  invert the gate's meaning. (The Recent-Activity surface + the `tx-awaiting`
 *  in-flight card are a SEPARATE parametrized run per plan §7; the History page
 *  does not render awaiting cards.) */
async function waitForFeedScope(page: Page, address: string, timeoutMs = 30_000): Promise<void> {
	try {
		await page.waitForFunction(
			(want: string) => document.querySelector('[data-testid="activity-feed-root"]')?.getAttribute("data-active-account") === want,
			{ timeout: timeoutMs, polling: 150 },
			address,
		)
	} catch {
		const observed = await page
			.evaluate(
				() => document.querySelector('[data-testid="activity-feed-root"]')?.getAttribute("data-active-account") ?? "<no feed root>",
			)
			.catch(() => "<read failed>")
		throw new Error(`feed root data-active-account: expected "${address}" but observed "${observed}" after ${timeoutMs}ms`)
	}
}

/** Navigate the popup to the History page and wait for its route + feed root to
 *  reflect `expectScope`. Hash-nav (not a nav-tab click) mirrors
 *  `incoming-transfers.test.ts` and avoids depending on the bottom-nav layout. */
async function gotoHistory(page: Page, expectScope: string): Promise<void> {
	await page.evaluate(() => {
		window.location.hash = "#/popup/activity"
	})
	await waitForHash(page, "#/popup/activity", 10_000)
	await waitForFeedScope(page, expectScope)
}

test.skipIf(!hasConfig)(
	"cross-account isolation: A's incoming + settled tx never render in B's feed",
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		if (!aztecConfig) throw new Error("unreachable — skipIf guards hasConfig")
		const contract = aztecConfig.tokenAddress

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 30_000)

		const accountA = await getAccountAddress(page)
		expect(accountA).toBe(tokenReadyExtension.accountAddress)

		// ── (1) Seed a real EXTENSION-side settled tx for A. The independent-
		//    wallet mint below only makes an INCOMING row (never a
		//    TransactionService row), so a separate extension tx is required to
		//    test that stale SETTLED history is contained too (plan §7). A
		//    public→public self-transfer is the proven-cheap shape on the
		//    `tokenReadyExtension` fixture (see `transfers.test.ts`) — no FeeJuice
		//    needed (SponsoredFPC pays). The unique amount `7` keys the settled
		//    `tx-card`.
		const SETTLED_AMOUNT = "7"
		{
			const baseline = await captureBalanceBaseline(page, accountA, aztecConfig!.tokenAddress)
			await waitForFreshBalanceRow(page, {
				account: accountA,
				tokenContract: aztecConfig!.tokenAddress,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: baseline,
				timeoutMs: 60_000,
			})
		}
		await sendTransfer(page, { fromType: "public", toType: "public", amount: SETTLED_AMOUNT, destination: accountA })
		await waitForTxConfirmation(page, { amount: SETTLED_AMOUNT, fromType: "public", toType: "public" })
		console.log(`✓ A has a settled extension tx (amount ${SETTLED_AMOUNT})`)

		// ── (2) Create account B (creation self-selects B), then switch back to A
		//    so the note below is delivered + discovered while A is active.
		const accountB = await createSecondAccount(page)
		expect(accountB).not.toBe(accountA)
		await page.evaluate(() => {
			window.location.hash = "#/popup/general"
		})
		await waitForHash(page, "#/popup/general", 10_000)
		await switchAccountByAddress(page, accountA)
		console.log(`✓ Created B (${accountB.slice(0, 10)}…) and switched back to A`)

		// ── (3) Deliver a real private note to A from an independent wallet and
		//    drive it to `committed` via the gate — the exact proven Phase-0 flow.
		//    We commit while A is active (option b), NOT across the switch: the
		//    gate's safety timeout is only 15s and an account switch can restart
		//    the SW (dropping the parked scan), which would make a hold-across-
		//    switch race flaky. Committing first, then switching, tests the same
		//    privacy invariant (a persisted foreign record must not surface in B)
		//    without that fragility. The live-broadcast-during-switch race is the
		//    zero-timing unit pin's job (`useIncomingTransfers.test.ts`, plan §7).
		const triple = await resolveActiveTriple(page)
		expect(triple.account).toBe(accountA)

		const AMOUNT = 31n * 10n ** 18n
		const txHash = await deliverPrivateNoteTo(aztecConfig.nodeUrl, contract, accountA, AMOUNT, aztecConfig.minterAddress)
		expect(txHash).toMatch(/^0x[0-9a-fA-F]+$/)
		console.log(`✓ Delivered private note to A in tx ${txHash}`)

		await holdIncomingPoll(page, {
			profileId: triple.profileId,
			networkId: triple.networkId,
			accountAddress: accountA,
			contract,
			txHash,
		})

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
		await waitForIncomingPollPhase(page, "discovery-held", txHash, 5_000)
		await releaseIncomingPoll(page)
		await waitForIncomingPollPhase(page, "committed", txHash, 20_000)

		let record: StoredIncomingRecord | null = null
		for (let i = 0; i < 25 && !record; i++) {
			record = await findIncomingRecordByHash(page, txHash)
			if (record) break
			await new Promise((r) => setTimeout(r, 200))
		}
		expect(record?.accountAddress).toBe(accountA)
		expect(record?.hidden).toBe(false)
		console.log("✓ A's incoming note committed (persisted, visible)")

		// ── (4) BASELINE on A: both cards MUST render on A's History feed. This
		//    proves the data is present + renderable, so a later 0-count on B is
		//    genuine containment (not "the card never rendered" for some other
		//    reason). It also brackets the positive control at step 8.
		await gotoHistory(page, accountA)
		// POLLED, not instant: the incoming list re-renders by array replacement
		// on every refresh, so a raw count read can land inside a sub-frame child
		// swap and see 0 while the DOM is stably populated 250ms on either side
		// (instrumented 2026-07-27: records + both card counts stable across 15s
		// of samples while an instant $$ read 0 — see the siloing-hardening
		// lessons). A single poll asserting BOTH counts covers the same baseline;
		// the containment assertions below stay instant — they assert ZERO, and
		// the armed MutationObserver catches any flash a count read could miss.
		await page.waitForFunction(
			() =>
				document.querySelectorAll('[data-testid="tx-incoming-card"]').length >= 1 &&
				document.querySelectorAll('[data-testid="tx-card"]').length >= 1,
			{ timeout: 30_000 },
		)
		console.log("✓ Baseline: A's incoming + settled cards render on A's feed")

		// ── (5) Arm a MutationObserver (plan §7) that records any incoming/awaiting
		//    card present WHILE the feed root declares a given scope. It runs
		//    across the switch, so it catches a created-then-removed flash under B
		//    (the one-tick window the synchronous switch-clear must eliminate) — a
		//    plain post-settle count can't. Installed while A is active, so A-scope
		//    hits are expected + ignored; only B-scope hits are leaks.
		await page.evaluate(() => {
			const w = window as unknown as { __isoLeaks: string[]; __isoObserver?: MutationObserver }
			w.__isoLeaks = []
			const record = () => {
				const scope = document.querySelector('[data-testid="activity-feed-root"]')?.getAttribute("data-active-account")
				if (!scope) return
				for (const sel of ["tx-incoming-card", "tx-awaiting-card"]) {
					if (document.querySelector(`[data-testid="${sel}"]`)) w.__isoLeaks.push(`${sel}@${scope}`)
				}
			}
			w.__isoObserver = new MutationObserver(record)
			w.__isoObserver.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["data-active-account"],
			})
			record()
		})

		// ── (6) Switch to B and assert containment. B is fresh, so its feed shows
		//    NO cards — A's incoming + settled are contained UI-side even though
		//    both still persist in `chrome.storage.local`.
		await switchAccountByAddress(page, accountB)
		await waitForFeedScope(page, accountB)
		// Let any reconnect-replay / late broadcast settle before the counts.
		await new Promise((r) => setTimeout(r, 3_000))

		expect((await page.$$('[data-testid="tx-incoming-card"]')).length).toBe(0)
		expect((await page.$$('[data-testid="tx-awaiting-card"]')).length).toBe(0)
		expect((await page.$$('[data-testid="tx-card"]')).length).toBe(0)

		const leaks = await page.evaluate(() => {
			const w = window as unknown as { __isoLeaks: string[]; __isoObserver?: MutationObserver }
			w.__isoObserver?.disconnect()
			return w.__isoLeaks ?? []
		})
		expect(leaks.filter((e) => e.endsWith(`@${accountB}`))).toEqual([])
		console.log("✓ B's feed shows NO A activity (incoming + settled contained)")

		// ── (7) POSITIVE CONTROL: switch back to A — both cards MUST reappear.
		//    Proves we suppressed a leak, not the feature itself.
		await switchAccountByAddress(page, accountA)
		await waitForFeedScope(page, accountA)
		// Polled for the same reason as the step-4 baseline: positive counts must
		// tolerate the list's array-replacement re-render windows.
		await page.waitForFunction(
			() =>
				document.querySelectorAll('[data-testid="tx-incoming-card"]').length >= 1 &&
				document.querySelectorAll('[data-testid="tx-card"]').length >= 1,
			{ timeout: 30_000 },
		)
		console.log("✓ Positive control: A's cards reappear on switch-back")

		// ── (8) No unexpected console / page errors across the whole flow.
		expect(tokenReadyExtension.consoleErrors).toEqual([])
		expect(tokenReadyExtension.pageErrors).toEqual([])

		await page.close()
	},
)
