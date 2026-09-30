/**
 * A full-backup import where one public network stalls costs only that network's row.
 *
 * The funded wallet's backup keeps its local-chain account-state item, which gains a fresh sender,
 * and carries a copy of that item relabelled to Alpha V5, first in the slice, with Alpha V5 as the
 * active network: the production shape, where the restored wallet opens on a public network. The
 * fresh extension reroutes the public dRPC origin to a stub that answers Alpha V5's identity probe
 * and blackholes every other call, so Alpha V5's PXE boot hangs while the local network restores.
 *
 * Only a restore or the Senders page registers a sender, and no balance read does, so the sender
 * read back before Continue is what proves the local network restored while Alpha V5 hung. The
 * balance read after Continue shows the wallet works there, nothing more.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Page } from "puppeteer"
import { describe, expect, inject } from "vitest"
import { CHAIN_IDS, MAINNET_L1_CHAIN_ID, MAINNET_ROLLUP_VERSION } from "@/utils/chain-ids"
import { ACCOUNT_STATE_SKIP_DEADLINE } from "@/wallet/services/account-state/normalize"
import type { AztecTestConfig } from "../fixtures/aztec"
import { type ArmedInterception, CHROME_ONLY, interceptRpc, isFirefox } from "../fixtures/browser"
import {
	clickByTestId,
	type ExtensionContext,
	launchExtension,
	openPopup,
	test,
	waitForHash,
	withTimeoutMessage,
} from "../fixtures/extension"
import { captureBalanceBaseline, navigateByHash, switchToLocalNetwork, waitForFreshBalanceRow } from "../fixtures/helpers"
import { settleClosedPopup } from "../fixtures/popup-leave"
import { accountChainId, exportPlainBackup, keepChainAccountState, type PlainBackup, sealPlainBackup } from "../helpers/backup-export"
import { readStage } from "../helpers/crash-truth"
import { gotoPopupImport, POPUP_IMPORT_SHELL, submitFullBackupImport, TEST_PASSWORD, writeBackupToTemp } from "../helpers/import-drivers"
import { pressEscape } from "../helpers/pointer-probes"
import { nodeInfoResult, startStub } from "../helpers/rpc-stub"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** The origin both public seeds dial (`DEFAULT_SEEDS` in the network service). */
const PUBLIC_RPC_ORIGIN = "https://lb.drpc.live"
const SENDERS_HASH = "#/popup/settings/advanced/account-state/senders"
const FUNDED_PUBLIC_RAW = (1000n * 10n ** 18n).toString()

type AccountStateItem = { networkId?: string; chainId?: number; senders?: Array<{ address: string }> }
type ErrorRow = { networkId?: unknown; restoreError?: unknown }

/** The funded chain's item with `sender` added, preceded by its copy relabelled to Alpha V5. */
function stalledAlphaBackup(backup: PlainBackup, funded: string, tokenAddress: string, sender: string): string {
	keepChainAccountState(backup.data, accountChainId(backup, funded), tokenAddress)
	const [local, ...rest] = backup.data["account-state"] as AccountStateItem[]
	expect(rest, "one account-state item on the funded chain").toEqual([])
	local.senders = [...(local.senders ?? []), { address: sender }]
	backup.data["account-state"] = [{ ...structuredClone(local), networkId: "alpha-v5", chainId: CHAIN_IDS.MAINNET }, local]
	backup["active-chain-id"] = CHAIN_IDS.MAINNET
	return writeBackupToTemp(sealPlainBackup(backup))
}

async function networkIdOfChain(page: Page, chainId: number): Promise<string> {
	const id = await page.evaluate(async (chain: number) => {
		const all = await chrome.storage.local.get(null)
		for (const [key, value] of Object.entries(all)) {
			if (!key.startsWith("nulo:core:networks@")) continue
			const row = JSON.parse(value as string) as { id?: string; chainId?: number }
			if (row.chainId === chain) return row.id ?? null
		}
		return null
	}, chainId)
	if (!id) throw new Error(`no seeded network serves chain ${chainId}`)
	return id
}

/** Opens View Errors, reads the log from the text the data viewer renders, and closes it. */
async function readViewedErrorLog(page: Page): Promise<Record<string, ErrorRow[]>> {
	await clickByTestId(page, "import-full-backup-view-errors-btn")
	// The viewer renders its document after it mounts; wait for text that parses.
	const shown = await page.waitForFunction(
		() => {
			const text = (document.querySelector('[data-testid="data-viewer"]') as HTMLElement | null)?.innerText ?? ""
			const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
			try {
				JSON.parse(json)
				return json
			} catch {
				return false
			}
		},
		{ timeout: 10_000, polling: 100 },
	)
	const log = JSON.parse((await shown.jsonValue()) as string) as Record<string, ErrorRow[]>
	expect(await pressEscape(page), "Escape closes the data viewer").toBe(true)
	await settleClosedPopup(page, "data-viewer")
	return log
}

function expectOnlyAlphaDeadline(log: Record<string, ErrorRow[]>, alphaId: string): void {
	expect(log).toEqual({
		"account-state": [
			expect.objectContaining({ networkId: alphaId, restoreError: expect.stringContaining(ACCOUNT_STATE_SKIP_DEADLINE) }),
		],
	})
}

/** Whether the local network's Senders page, on a second popup page opened beside the import's
 *  errors screen, lists `sender`. */
async function localNetworkListsSender(ctx: ExtensionContext, sender: string): Promise<boolean> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/general", 30_000)
	await switchToLocalNetwork(page)
	await navigateByHash(page, SENDERS_HASH)
	await page.waitForSelector('[data-testid="senders-add-btn"]', { visible: true, timeout: 10_000 })
	await page.waitForFunction(() => !document.querySelector('[data-testid="loading-state"]'), { timeout: 30_000, polling: 100 })
	const listed = await page.evaluate(
		(address: string) => !!document.querySelector(`[data-testid="sender-row"][data-sender-address="${address}"]`),
		sender,
	)
	await page.close()
	return listed
}

type RunningRetry = { label: string; continueDisabled: boolean; viewErrorsDisabled: boolean }

/** Presses Retry, reads the errors screen while it runs, then waits for it to settle. */
async function retryOnce(page: Page): Promise<RunningRetry> {
	await clickByTestId(page, "import-full-backup-retry-btn")
	const running = await page.waitForFunction(
		() => {
			const control = (id: string) => document.querySelector(`[data-testid="${id}"]`)
			const retry = control("import-full-backup-retry-btn")
			if (!retry?.hasAttribute("disabled")) return false
			return {
				label: (retry.textContent ?? "").trim(),
				continueDisabled: control("import-full-backup-continue-btn")?.hasAttribute("disabled") === true,
				viewErrorsDisabled: control("import-full-backup-view-errors-btn")?.hasAttribute("disabled") === true,
			}
		},
		{ timeout: 10_000, polling: 100 },
	)
	const seen = (await running.jsonValue()) as RunningRetry
	// A Retry is one more tail: 45 s at most, plus margin.
	await page.waitForFunction(() => !document.querySelector('[data-testid="import-full-backup-retry-btn"]')?.hasAttribute("disabled"), {
		timeout: 90_000,
		polling: 250,
	})
	return seen
}

describe.skipIf(isFirefox)(CHROME_ONLY.hangingRequest, () => {
	test("agent-runner contract: a live sandbox must be configured (no false skip)", () => {
		expect(hasConfig).toBe(true)
	})

	test.skipIf(!hasConfig)(
		"a stalled Alpha V5 costs only its own row while the local network restores, and a Retry keeps that one row",
		{ timeout: 900_000 },
		async ({ tokenReadyExtension }) => {
			const { AztecAddress } = await import("@aztec/aztec.js/addresses")
			const sender = (await AztecAddress.random()).toString()
			const funded = tokenReadyExtension.accountAddress
			const tokenAddress = aztecConfig!.tokenAddress
			const filePath = stalledAlphaBackup(await exportPlainBackup(tokenReadyExtension), funded, tokenAddress, sender)

			const stub = await startStub((method) =>
				method === "aztec_getNodeInfo" ? nodeInfoResult(MAINNET_L1_CHAIN_ID, MAINNET_ROLLUP_VERSION) : undefined,
			)
			const profileDir = mkdtempSync(join(tmpdir(), "nulo-stalled-network-"))
			let ctx2: ExtensionContext | undefined
			let armed: ArmedInterception | undefined
			try {
				ctx2 = await launchExtension({ userDataDir: profileDir })
				armed = await interceptRpc(ctx2.browser, ctx2.extensionId, PUBLIC_RPC_ORIGIN, { kind: "redirect", to: stub.url })
				const page = await gotoPopupImport(ctx2)
				await submitFullBackupImport(page, filePath, TEST_PASSWORD, POPUP_IMPORT_SHELL)
				// The restore of a real export, then the tail's 45 s bound.
				await withTimeoutMessage(
					page.waitForSelector('[data-testid="import-full-backup-continue-btn"]', { visible: true, timeout: 240_000 }),
					async () =>
						`no errors screen (hash ${await page.evaluate(() => window.location.hash)}, stage ${await readStage(page)})`,
				)
				const alphaId = await networkIdOfChain(page, CHAIN_IDS.MAINNET)
				const firstLog = await readViewedErrorLog(page)
				// Soft, so wrong error rows still report whether the local network restored.
				expect.soft(await localNetworkListsSender(ctx2, sender), "the local network's restored sender, before Continue").toBe(true)
				expectOnlyAlphaDeadline(firstLog, alphaId)
				await page.bringToFront()

				// Alpha V5 still hangs, so the Retry runs out of time again and leaves the same one row.
				expect(await retryOnce(page)).toEqual({ label: "Retrying…", continueDisabled: true, viewErrorsDisabled: true })
				expectOnlyAlphaDeadline(await readViewedErrorLog(page), alphaId)

				await clickByTestId(page, "import-full-backup-continue-btn")
				await waitForHash(page, POPUP_IMPORT_SHELL.successHash, 60_000)

				const home = await openPopup(ctx2)
				await waitForHash(home, "#/popup/general", 30_000)
				await switchToLocalNetwork(home)
				const baseline = await captureBalanceBaseline(home, funded, tokenAddress)
				await waitForFreshBalanceRow(home, {
					account: funded,
					tokenContract: tokenAddress,
					expectedPublicRaw: FUNDED_PUBLIC_RAW,
					baselineUpdatedAt: baseline,
					timeoutMs: 150_000,
				})

				// Alpha V5 reached registration: its PXE boot dialed the node after the answered probe.
				const firstProbe = stub.methods.indexOf("aztec_getNodeInfo")
				const seen = `stub saw: [${stub.methods.join(", ")}]`
				expect(firstProbe, seen).toBeGreaterThanOrEqual(0)
				expect(stub.methods.indexOf("aztec_getL1ContractAddresses"), seen).toBeGreaterThan(firstProbe)
				expect(await armed.failures(), "rpc interception failures").toEqual([])
			} finally {
				try {
					await armed?.stop()
					await ctx2?.close()
				} finally {
					await stub.close()
					rmSync(profileDir, { recursive: true, force: true })
					// The doctored file embeds the wallet's real (local-chain test) master key.
					rmSync(dirname(filePath), { recursive: true, force: true })
				}
			}
		},
	)
})
