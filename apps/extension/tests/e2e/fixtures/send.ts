import type { Page } from "puppeteer"
import type { AztecTestConfig } from "./aztec"
import { clickByTestId, type ExtensionContext } from "./extension"
import { assertPgOk, setPgInput, snapshotResultSeq, waitForPgResult } from "./playground"
import { approveExecute, waitForExecuteContent, waitForPopup } from "./popups"

/**
 * One default `sendTx` of 1 token from the connected account to the minter, approved in the execute
 * window and asserted `ok` — the round trip that needs a live PXE host. `label` names the caller in
 * a failure; `popupTimeoutMs` covers a cold PXE boot before the window can open.
 */
export async function sendDefaultTx(
	ctx: ExtensionContext,
	page: Page,
	config: AztecTestConfig,
	label: string,
	opts: { popupTimeoutMs?: number } = {},
): Promise<void> {
	await setPgInput(page, "tokenAddress", config.tokenAddress)
	await setPgInput(page, "recipient", config.minterAddress)
	await setPgInput(page, "amount", "1")
	const seq = await snapshotResultSeq(page)
	const popupP = waitForPopup(ctx, "execute", { timeout: opts.popupTimeoutMs ?? 60_000 })
	await clickByTestId(page, "pg-btn-sendTx-default")
	const popup = await popupP
	await waitForExecuteContent(popup, 60_000)
	await approveExecute(popup, { approvableTimeoutMs: 120_000 })
	await assertPgOk(page, await waitForPgResult(page, "sendTx", seq, 300_000), label)
}
