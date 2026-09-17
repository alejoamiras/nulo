/**
 * A switch to another profile while a popup Send is still proving cancels that send, and the other
 * profile never inherits it.
 *
 * Profile B is created, and profile A unlocked again, before the send starts: creating a profile
 * takes longer than the proof gate can hold. With A's transfer parked at `proving`, the user locks
 * through the dialog, picks B on the lock screen and unlocks it; only then is the gate released.
 * Back on A, the record is `cancelled` and the feed holds no transaction, and B has no send at all.
 *
 * A deliberate departure from `account-switch-live-session`, where the send finishes: an account
 * switch keeps the session that approved the send, and a profile switch ends it.
 *
 * @requires-proverless — the proof gate exists only in a proverless build; the agent runner refuses
 * this file without `NULO_E2E_PROVERLESS=1`. Run it with `NULO_E2E_RETRY=0`: it spends on-chain and
 * PXE state that a retry would find half-consumed.
 */
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { TEST_PASSWORD } from "../fixtures/constants"
import { clickByTestId, clickSelector, openPopup, test, waitForHash, withTimeoutMessage } from "../fixtures/extension"
import {
	createAndActivateProfile,
	ensureUnlocked,
	lockThroughConfirmDialog,
	lockWallet,
	readSessionRow,
	refreshBalances,
	sendTransfer,
} from "../fixtures/helpers"
import { type SendRecordView, readSendRecords, waitForSendRecord } from "../fixtures/journal"
import { PROOF_GATE_HOLD_MS, holdProofGate, releaseProofGate } from "../fixtures/proof-gate"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const PROFILE_B_PASSWORD = "SecondProfilePw123!"

/** Pick `profileId` on the lock screen and unlock it. */
async function unlockProfile(page: Page, profileId: string, password: string): Promise<void> {
	await page.waitForSelector('[data-testid="auth-profile"]', { visible: true, timeout: 15_000 })
	await clickByTestId(page, "auth-profile")
	const row = `[data-testid="select-profile-row"][data-profile-id="${profileId}"]`
	await page.waitForSelector(row, { visible: true, timeout: 10_000 })
	await clickSelector(page, row)
	// The picker empties once the switch is admitted and the profile to unlock is persisted.
	await withTimeoutMessage(
		page.waitForFunction(() => !document.querySelector('[data-testid="select-profile-row"]'), { timeout: 10_000 }),
		async () =>
			`unlockProfile: the picker did not admit the switch to ${profileId} (sends: ${JSON.stringify(await readSendRecords(page).catch(() => []))})`,
	)
	await ensureUnlocked(page, password)
	await waitForHash(page, "#/popup/general", 30_000)
}

test.skipIf(!hasConfig)(
	"profile-switch-sweeps-transfer — locking and unlocking another profile cancels a proving transfer",
	{ timeout: 360_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as AztecTestConfig
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 15_000)
		const profileA = (await readSessionRow(page))?.profile ?? ""
		expect(profileA).not.toBe("")

		const profileB = await createAndActivateProfile(page, "Profile B", PROFILE_B_PASSWORD)
		await lockWallet(page)
		await unlockProfile(page, profileA, TEST_PASSWORD)
		await refreshBalances(page)

		await holdProofGate(page)
		// Settles true only on the "submitted" toast, which needs a broadcast.
		const submitted = sendTransfer(page, { fromType: "public", toType: "public", amount: "1", destination: config.minterAddress }).then(
			() => true,
			() => false,
		)
		let send: SendRecordView
		let reopened: Page
		try {
			send = await waitForSendRecord(page, (r) => r.kind === "transfer" && r.stage === "proving", 180_000)
			expect(send.profileId).toBe(profileA)
			expect(await lockThroughConfirmDialog(page)).toMatchObject({
				description: "1 transaction is still running. Locking cancels it.",
			})
			await waitForSendRecord(page, (r) => r.id === send.id && r.stage === "cancelled", 30_000)
			// The journal tells a popup about records only while a session is open, and the lock
			// cancels after the session closed: this popup still counts the send as in flight, and its
			// picker refuses on that cached count before reading the journal. A reopened popup reads it.
			reopened = await openPopup(tokenReadyExtension)
			await unlockProfile(reopened, profileB, PROFILE_B_PASSWORD)
			const gateHoldsUntil = (send.enteredProveAt ?? Number.NaN) + PROOF_GATE_HOLD_MS
			expect(Date.now(), "B must be unlocked while the proof gate still holds A's send").toBeLessThan(gateHoldsUntil)
		} finally {
			await releaseProofGate(page)
		}

		// Switching back takes far longer than a released proverless proof needs to reach the network.
		await lockWallet(reopened)
		await unlockProfile(reopened, profileA, TEST_PASSWORD)
		const records = await readSendRecords(reopened)
		expect(records.find((r) => r.id === send.id)?.stage).toBe("cancelled")
		expect(records.filter((r) => r.profileId === profileB)).toEqual([])
		await reopened.waitForSelector('[data-testid="tx-terminal-card"]', { visible: true, timeout: 30_000 })
		expect(await reopened.evaluate(() => document.querySelectorAll('[data-testid="tx-card"]').length)).toBe(0)
		expect(await submitted, "the Send flow must never report the transfer as submitted").toBe(false)
	},
)
