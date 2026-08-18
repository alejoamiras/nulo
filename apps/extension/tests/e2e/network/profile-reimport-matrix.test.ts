/**
 * Delete → import matrix, SAME browser session — the regression surface of the
 * PXE incarnation-fence deadlock (fix: aztec-runtime service.ts, this PR).
 *
 * The gap this closes: the backup-restore e2es exercise delete → re-import,
 * but their re-import lands in a FRESH extension context — a fresh offscreen
 * document whose in-memory profile-lifecycle map is empty, so the deleted
 * predecessor's tombstone can never fence the successor. The user-reported
 * deadlock needs the OPPOSITE: delete + import while the SAME offscreen
 * document survives, where the tombstone (`deleted(G1)`) meets the successor's
 * fresh-generation ops. Un-fixed, every PXE op then failed forever ("capture
 * is stale") — fee juice rendered "—", FPC discovery and token registration
 * died — until the offscreen restarted.
 *
 * Matrix: (A) FULL-BACKUP re-import of the just-deleted profile — the
 * tombstone-collision leg. Restore is the flow that PRESERVES the profileId
 * (profile/service.ts restore: keeps the backup's id while it's free — and a
 * just-deleted id is free — while minting a fresh pxeGeneration; a plain
 * secret import mints a RANDOM id and can never collide, verified empirically
 * by this test's first draft). (B) a DIFFERENT plain secret — the fresh-id
 * clean-successor leg. Both legs prove post-import PXE health with the two op
 * families the bug killed: a READ (the gas card renders an FJ amount, never
 * the failed-read em-dash) and a WRITE (token import registers the contract
 * and toasts).
 */
import { rmSync } from "node:fs"
import { dirname } from "node:path"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { launchExtension, test, waitForHash } from "../fixtures/extension"
import {
	captureSoleProfileId,
	getAccountAddress,
	importToken,
	resetProfile,
	switchToLocalNetwork,
	waitForProfilePurged,
} from "../fixtures/helpers"
import {
	LOCAL_L1_CHAIN_ID,
	POPUP_IMPORT_SHELL,
	TEST_PASSWORD,
	buildSyntheticBackup,
	deriveNuloAccountAddress,
	gotoPopupImport,
	importFullBackup,
	importSeed,
	makeRecoveryTriple,
	writeBackupToTemp,
} from "../helpers/import-drivers"
import { readProfileGen } from "../helpers/crash-truth"
import type { Page } from "puppeteer-core"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** The gas card's public column must converge to a real FJ amount. The failed-read
 *  state renders an em-dash ("— FJ") — the exact user-visible symptom of the
 *  fence deadlock — so the wait requires a DIGIT before the unit. On timeout,
 *  dump the card's actual state + recent console errors so a red run explains
 *  itself instead of demanding a rerun with eyes on the browser. */
async function waitForGasBalanceRendered(page: Page, ctx: Awaited<ReturnType<typeof launchExtension>>): Promise<void> {
	try {
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="gas-balance-public"]')
				return !!el && /\d(\.\d+)?\s*FJ$/.test(el.textContent?.trim() ?? "")
			},
			{ timeout: 240_000, polling: 500 },
		)
	} catch (err) {
		const probe = await page
			.evaluate(() => ({
				hash: location.hash,
				gasText: document.querySelector('[data-testid="gas-balance-public"]')?.textContent?.trim() ?? null,
				skeleton: !!document.querySelector('[data-testid="gas-skeleton-public"]'),
			}))
			.catch(() => "page-probe-failed")
		throw new Error(
			`gas balance never rendered a digit: ${JSON.stringify(probe)}; recent console errors: ${JSON.stringify(ctx.consoleErrors.slice(-12))}`,
			{ cause: err },
		)
	}
}

/** Import a recovery phrase through the real popup-import UI, land on general,
 *  switch to the sandbox network, and wait for the active account to settle. */
async function importAndSettle(ctx: Awaited<ReturnType<typeof launchExtension>>, words: string[]): Promise<Page> {
	const page = await gotoPopupImport(ctx)
	await importSeed(page, words.join(" "), TEST_PASSWORD, POPUP_IMPORT_SHELL)
	await waitForHash(page, "#/popup/general", 30_000)
	await switchToLocalNetwork(page)
	await page.waitForFunction(async () => !!(await chrome.storage.local.get("nulo:ui:activeAccount"))["nulo:ui:activeAccount"], {
		timeout: 240_000,
		polling: 500,
	})
	return page
}

test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
	expect(hasConfig).toBe(true)
})

test.skipIf(!hasConfig)(
	"delete → full-backup re-import in one session: the same-id successor boots past the tombstone (PXE reads + writes work)",
	{ timeout: 900_000 },
	async () => {
		const ctx = await launchExtension()
		const { masterBase64: master, entropyBase64 } = await makeRecoveryTriple()
		// A derivation-consistent account row is mandatory: the integrity coordinator
		// re-derives every account before activating an imported profile.
		const accountAddress = await deriveNuloAccountAddress(master, LOCAL_L1_CHAIN_ID)
		const backupPath = writeBackupToTemp(buildSyntheticBackup({ masterBase64: master, entropyBase64, accountAddress }))
		try {
			// ── 1. First incarnation: restore the backup, verify baseline health. ─
			let page = await gotoPopupImport(ctx)
			await importFullBackup(page, backupPath, TEST_PASSWORD, POPUP_IMPORT_SHELL)
			// The synthetic backup carries no active-network pointer, so the app's
			// fallback may land on a seeded public network — pin the sandbox
			// explicitly (the synthetic row is named "Local Network").
			await switchToLocalNetwork(page)
			const firstProfileId = await captureSoleProfileId(page)
			const firstGen = await readProfileGen(page)
			// The pin's own precondition: the predecessor generation must EXIST and
			// belong to this profile — without this, the later not-equal assert
			// passes vacuously against undefined.
			expect(firstGen?.id).toBe(firstProfileId)
			expect(firstGen?.gen).toBeTruthy()
			expect(await getAccountAddress(page)).toBe(accountAddress)
			await waitForGasBalanceRendered(page, ctx)

			// ── 2. Delete the profile (the real settings reset flow) ────────────
			await resetProfile(page)
			await waitForProfilePurged(page, firstProfileId)
			await page.close()

			// ── 3. SAME SESSION re-import of the SAME backup. The offscreen
			//      document survived, so its lifecycle map still holds the
			//      predecessor's `deleted(gen)` tombstone — and restore KEEPS the
			//      backup's now-free profileId while minting a FRESH generation,
			//      forcing the successor's ops through the tombstone. ────────────
			page = await gotoPopupImport(ctx)
			await importFullBackup(page, backupPath, TEST_PASSWORD, POPUP_IMPORT_SHELL)
			await switchToLocalNetwork(page)
			expect(await getAccountAddress(page)).toBe(accountAddress)
			// Same-id precondition — what makes this leg hit the tombstone. If
			// restore ever stops reusing a free backup id, this leg silently stops
			// exercising the fence — fail loudly instead.
			expect(await captureSoleProfileId(page)).toBe(firstProfileId)
			// Fresh-mint precondition (the fence's OTHER input): the successor
			// carries a DIFFERENT pxeGeneration than the erased incarnation — a
			// restore that ever reused the generation would sail past the
			// tombstone as a same-gen replay instead of exercising the
			// deleted(different-gen) pass-through this leg exists for.
			const secondGen = await readProfileGen(page)
			expect(secondGen?.gen).toBeTruthy()
			expect(secondGen?.gen).not.toBe(firstGen?.gen)

			// ── 4. The regression assertions. Un-fixed, the fence rejected every
			//      op without the retryable marker: the gas READ stuck on "— FJ"
			//      and the registerContract WRITE below failed outright, forever
			//      (until an offscreen restart). ───────────────────────────────────
			await waitForGasBalanceRendered(page, ctx)
			await importToken(page, aztecConfig!.tokenAddress)

			// No stale-rejection console assertion here: PXE rejections log offscreen-side and never
			// reach the popup's error-event collector (post-impl audit) — the digit-render + token-import
			// assertions above are the real proof. Page errors stay asserted (popup-side truth).
			expect(ctx.pageErrors).toEqual([])
		} finally {
			rmSync(dirname(backupPath), { recursive: true, force: true })
			await ctx.browser.close()
		}
	},
)

test.skipIf(!hasConfig)(
	"delete → import a DIFFERENT secret in one session: the fresh profile is fully functional",
	{ timeout: 900_000 },
	async () => {
		const ctx = await launchExtension()
		try {
			// ── 1. First incarnation (kept lean — its health is leg A's job) ────
			let page = await importAndSettle(ctx, (await makeRecoveryTriple()).words)
			const firstAddress = await getAccountAddress(page)
			const firstProfileId = await captureSoleProfileId(page)

			// ── 2. Delete, then import a DIFFERENT secret in the same session:
			//      fresh profileId, so no tombstone collision — the leg pins that
			//      the clean-successor path stays healthy alongside leg A. ───────
			await resetProfile(page)
			await waitForProfilePurged(page, firstProfileId)
			await page.close()

			page = await importAndSettle(ctx, (await makeRecoveryTriple()).words)
			expect(await getAccountAddress(page)).not.toBe(firstAddress)
			expect(await captureSoleProfileId(page)).not.toBe(firstProfileId)

			await waitForGasBalanceRendered(page, ctx)
			await importToken(page, aztecConfig!.tokenAddress)

			// No stale-rejection console assertion here: PXE rejections log offscreen-side and never
			// reach the popup's error-event collector (post-impl audit) — the digit-render + token-import
			// assertions above are the real proof. Page errors stay asserted (popup-side truth).
			expect(ctx.pageErrors).toEqual([])
		} finally {
			await ctx.browser.close()
		}
	},
)
