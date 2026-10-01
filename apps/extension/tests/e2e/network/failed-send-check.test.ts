/**
 * A send refused at the send line, after its `submitting` record: the node never saw its hash and
 * answers DROPPED, and DROPPED is never an answer. The Terms record is removed while the proof gate
 * holds the send and restored once the row has failed, so the row carries a hash nothing received.
 * From then until 150 s past the row's own `terminalAt` (the check's two minutes at 5 s, one 15 s
 * read and margin) the stored row stays as it failed, the journal page keeps its words and shows no
 * Ended row, and the account's public balance does not move. Thirty minutes cannot pass in a test, so the row is then
 * aged past the check's window and the background restarted: a check that runs takes the row up
 * from its stored `terminalAt` and, once the profile is unlocked, answers "unconfirmed", which the
 * page's State row then reads.
 *
 * @requires-proverless — the proof gate exists only in a proverless build; the agent runner refuses
 * this file without `NULO_E2E_PROVERLESS=1`. Run it with `NULO_E2E_RETRY=0`: it spends PXE state a
 * retry would find half-consumed.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { TxHash } from "@aztec-labs/stdlib/tx"
import type { Page } from "puppeteer"
import { beforeAll, expect, inject } from "vitest"
import { categoricalLabel, sendOutcome } from "@/utils/journal-state"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { type AztecTestConfig, createTestWallet, readPublicTokenBalance } from "../fixtures/aztec"
import { stopBackground } from "../fixtures/browser"
import { openPopup, test, waitForHash } from "../fixtures/extension"
import { fillSendForm, navigateByHash, refreshBalances, setActiveSendType, unlockAfterBackgroundDeath } from "../fixtures/helpers"
import { waitForSendRecord } from "../fixtures/journal"
import { LEGAL_ACCEPTANCE_KEY } from "../fixtures/legal"
import { PROOF_GATE_HOLD_MS, holdProofGate, releaseProofGate } from "../fixtures/proof-gate"
import { openSend, submitSend } from "../fixtures/send-page"
import { readLegalRecord } from "../helpers/legal-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const SPEC = "failed-send-check"
/** The check reads every 5 s for two minutes, then every 15 s: this covers both, with margin. */
const OBSERVE_PAST_TERMINAL_MS = 150_000
const SAMPLE_EVERY_MS = 5_000
/** The check's 30-minute window (`DROPPED_RESURRECTION_WINDOW_MS`) and a minute. */
const PAST_THE_WINDOW_MS = 31 * 60_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(() => {
	const assetsDir = join(inject("extensionPath") as string, "assets")
	const armed = readdirSync(assetsDir).some(
		(f) => f.endsWith(".js") && readFileSync(join(assetsDir, f), "utf8").includes("NULO_E2E_PROVERLESS_BUILD_STAMP"),
	)
	expect(
		armed,
		"The extension build is not proverless-armed, so no proof gate can hold the send. Run: " +
			"NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/failed-send-check.test.ts",
	).toBe(true)
})

async function readRecord(page: Page, id: string): Promise<OperationRecord | undefined> {
	const raw = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], `nulo:journal@${id}`)
	if (raw === undefined) return undefined
	return (typeof raw === "string" ? JSON.parse(raw) : raw) as OperationRecord
}

async function waitForRecord(
	page: Page,
	id: string,
	done: (record: OperationRecord) => boolean,
	what: string,
	timeoutMs: number,
): Promise<OperationRecord> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const record = await readRecord(page, id)
		if (record && done(record)) return record
		if (Date.now() > deadline) throw new Error(`[${SPEC}] record ${id} ${what} within ${timeoutMs} ms: ${JSON.stringify(record)}`)
		await sleep(250)
	}
}

/** Rewrites the stored row's `terminalAt`, keeping the row's stored form. */
async function ageRecord(page: Page, id: string, terminalAt: number): Promise<void> {
	await page.evaluate(
		async ({ key, at }) => {
			const raw = (await chrome.storage.local.get(key))[key]
			const row = typeof raw === "string" ? JSON.parse(raw) : raw
			const aged = { ...row, terminalAt: at }
			await chrome.storage.local.set({ [key]: typeof raw === "string" ? JSON.stringify(aged) : aged })
		},
		{ key: `nulo:journal@${id}`, at: terminalAt },
	)
}

async function waitForRow(page: Page, testId: string, text: string): Promise<void> {
	await page.waitForFunction(
		(selector: string, want: string) => document.querySelector(selector)?.textContent?.trim() === want,
		{ timeout: 15_000 },
		`[data-testid="${testId}"]`,
		text,
	)
}

const ENDED_ROW = '[data-testid="journal-detail-ended"]'

/**
 * Sends 1 token public to public while the proof gate holds it, and removes the Terms record while
 * the gate still holds, so the send line refuses after the `submitting` record. Returns the send's
 * id and the record it removed.
 */
async function sendWithoutTerms(page: Page, destination: string): Promise<{ id: string; accepted: unknown }> {
	await openSend(page)
	await setActiveSendType(page, "send-from-type", "public")
	await setActiveSendType(page, "send-to-type", "public")
	await fillSendForm(page, { amount: "1", destination })
	await submitSend(page, { expect: "send" })

	const send = await waitForSendRecord(page, (r) => r.kind === "transfer" && r.stage === "proving", 180_000)
	const accepted = await readLegalRecord(page)
	expect(accepted, "the launch seeds an accepted Terms record").toBeDefined()
	await page.evaluate((key) => chrome.storage.local.remove(key), LEGAL_ACCEPTANCE_KEY)
	const gateHoldsUntil = (send.enteredProveAt ?? Number.NaN) + PROOF_GATE_HOLD_MS
	expect(Date.now(), "the Terms record must be gone while the gate still holds the send").toBeLessThan(gateHoldsUntil)
	return { id: send.id, accepted }
}

test.skipIf(!hasConfig)(
	`${SPEC} — a send the node never received stays not confirmed, and nothing moves`,
	{ timeout: 540_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as AztecTestConfig
		const account = tokenReadyExtension.accountAddress
		const { wallet, accounts, node, cleanup } = await createTestWallet(config.nodeUrl)
		try {
			const reader = accounts[0]
			if (!reader) throw new Error("expected at least one sandbox-deployed test account")
			const balance = () => readPublicTokenBalance(wallet, reader, config.tokenAddress, account)
			const balanceBefore = await balance()

			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general", 15_000)
			await refreshBalances(page)

			await holdProofGate(page)
			const { id, accepted } = await sendWithoutTerms(page, config.minterAddress).finally(() => releaseProofGate(page))
			const restoreTerms = () =>
				page.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), {
					key: LEGAL_ACCEPTANCE_KEY,
					value: accepted,
				})
			const failed = await waitForRecord(page, id, (r) => r.progress.stage === "failed", "did not fail", 60_000).finally(restoreTerms)

			expect(failed.progress, "the row failed after its submitting record, with the hash it tried to send").toMatchObject({
				stage: "failed",
				from: "submitting",
				txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/i),
			})
			expect(sendOutcome(failed)).toBe("checking")
			const expected = categoricalLabel(failed).label
			const terminalAt = failed.terminalAt ?? Number.NaN

			await navigateByHash(page, `#/popup/journal/${id}`, 10_000)
			await waitForRow(page, "journal-detail-category", expected)

			let samples = 0
			let sampledAt: number
			do {
				await sleep(SAMPLE_EVERY_MS)
				const at = `${Math.round((Date.now() - terminalAt) / 1_000)} s past terminalAt`
				expect((await readRecord(page, id))?.progress, `the stored row changed ${at}`).toEqual(failed.progress)
				const shown = await page.evaluate(
					(ended: string) => ({
						category: document.querySelector('[data-testid="journal-detail-category"]')?.textContent?.trim() ?? null,
						ended: document.querySelector(ended) !== null,
					}),
					ENDED_ROW,
				)
				expect(shown, `the journal page changed ${at}`).toEqual({ category: expected, ended: false })
				expect(await balance(), `the public balance moved ${at}`).toBe(balanceBefore)
				samples += 1
				sampledAt = Date.now()
			} while (sampledAt < terminalAt + OBSERVE_PAST_TERMINAL_MS)
			console.log(`[${SPEC}] ${samples} samples, the last ${Math.round((sampledAt - terminalAt) / 1_000)} s past terminalAt`)

			const { txHash } = failed.progress as { txHash: string }
			expect((await node.getTxReceipt(TxHash.fromString(txHash))).status, "the node's own answer for the hash").toBe("dropped")

			await ageRecord(page, id, Date.now() - PAST_THE_WINDOW_MS)
			await page.close()
			await stopBackground(tokenReadyExtension)
			const reopened = await openPopup(tokenReadyExtension)
			await unlockAfterBackgroundDeath(reopened)
			const answered = await waitForRecord(
				reopened,
				id,
				(r) => r.progress.stage === "failed" && r.progress.check !== undefined,
				"was not answered",
				60_000,
			)
			expect(answered.progress, "the window's last read, after the restart and the unlock").toEqual({
				...failed.progress,
				check: "unconfirmed",
			})
			await navigateByHash(reopened, `#/popup/journal/${id}`, 10_000)
			await waitForRow(reopened, "journal-detail-state", "Unconfirmed")
			await waitForRow(reopened, "journal-detail-context", categoricalLabel(answered).context)
			expect(await reopened.$(ENDED_ROW), "the Ended row, once the check answered").not.toBeNull()
			expect(await balance(), "the public balance moved after the restart").toBe(balanceBefore)
		} finally {
			await cleanup()
		}
	},
)
