/**
 * E2E helpers for driving the @nulo/playground page.
 *
 * The playground exposes a stable testid surface (see packages/playground/README.md).
 * These helpers wrap the common patterns:
 *   - clicking buttons by name (`pg-btn-{action}`)
 *   - filling inputs by name (`pg-input-{name}`)
 *   - waiting for a result row to settle (using monotonic `data-result-seq`)
 *   - asserting deterministic absence of an approval popup (no new browser target)
 */
import type { Page } from "puppeteer"
import { inject } from "vitest"
import { clickByTestId, patchPagePolling, replaceInputValue, type ExtensionContext } from "./extension"
import { dumpDeepDiagnostics } from "./journal"

export const PLAYGROUND_TEST_URL = (() => {
	try {
		return inject("playgroundUrl")
	} catch {
		return process.env.PLAYGROUND_URL ?? "http://localhost:5174/"
	}
})()

/**
 * Open a fresh playground tab on the test-mode URL (`?test=1` disables localStorage
 * persistence and the protocol log so the DOM stays minimal).
 */
export async function openPlayground(ctx: ExtensionContext): Promise<Page> {
	const page = await ctx.browser.newPage()
	patchPagePolling(page)
	const url = PLAYGROUND_TEST_URL.endsWith("/") ? `${PLAYGROUND_TEST_URL}?test=1` : `${PLAYGROUND_TEST_URL}/?test=1`
	await page.goto(url, { waitUntil: "domcontentloaded" })
	await page.waitForSelector('[data-testid="pg-status"]', { timeout: 30_000 })
	return page
}

/** Click a playground button by its `pg-btn-{name}` testid. */
export async function clickPgButton(page: Page, name: string): Promise<void> {
	await clickByTestId(page, `pg-btn-${name}`)
}

/** Set a playground input value via the v-model-aware `replaceInputValue`. */
export async function setPgInput(page: Page, name: string, value: string): Promise<void> {
	await replaceInputValue(page, `[data-testid="pg-input-${name}"]`, value)
}

/** Read the current `data-status` of the playground header pill. */
export async function getPgStatus(page: Page): Promise<string> {
	return page.evaluate(() => document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status") ?? "")
}

/** Snapshot the current result feed length (highest `data-result-seq`). 0 if empty. */
export async function snapshotResultSeq(page: Page): Promise<number> {
	return page.evaluate(() => {
		const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="pg-result"]')]
		const seqs = rows.map((r) => Number(r.getAttribute("data-result-seq") ?? "0"))
		return seqs.length === 0 ? 0 : Math.max(...seqs)
	})
}

export type PgResult = { seq: number; method: string; status: "ok" | "error"; resultJson?: unknown; errorJson?: unknown }

/**
 * Wait for the next result row matching `method` to settle (status="ok"|"error").
 * Pass `fromSeq` (snapshot taken before the action) so we ignore previous rows
 * with the same method. Returns the parsed JSON result/error.
 */
export async function waitForPgResult(page: Page, method: string, fromSeq: number, timeout = 30_000): Promise<PgResult> {
	const handle = await page
		.waitForFunction(
			(m: string, after: number) => {
				const rows = [...document.querySelectorAll<HTMLElement>(`[data-testid="pg-result"][data-method="${m}"]`)]
				for (const r of rows) {
					const seq = Number(r.getAttribute("data-result-seq") ?? "0")
					const status = r.getAttribute("data-status") ?? ""
					if (seq > after && (status === "ok" || status === "error")) {
						return {
							seq,
							method: m,
							status,
							resultJson: r.getAttribute("data-result-json") ?? "",
						}
					}
				}
				return null
			},
			{ timeout, polling: 200 },
			method,
			fromSeq,
		)
		.catch(async (err) => {
			// DIAGNOSTIC (throwaway soak): the dApp result never settled. Capture the
			// playground rows present + the journal/SW trail so a settle-timeout shows
			// WHETHER the reject/exec terminalized the journal but never reached the
			// dApp promise, vs never terminalized at all.
			const rows = await page
				.evaluate(() =>
					[...document.querySelectorAll('[data-testid="pg-result"]')].map((r) => ({
						seq: r.getAttribute("data-result-seq"),
						method: r.getAttribute("data-method"),
						status: r.getAttribute("data-status"),
					})),
				)
				.catch(() => "pg rows read failed")
			console.error(`[pg-diag] waitForPgResult(${method}, after ${fromSeq}) TIMEOUT — pg rows: ${JSON.stringify(rows)}`)
			await dumpDeepDiagnostics(page, `waitForPgResult(${method})`)
			throw err
		})
	const raw = (await handle.jsonValue()) as { seq: number; method: string; status: "ok" | "error"; resultJson: string }
	const parsed: PgResult = {
		seq: raw.seq,
		method: raw.method,
		status: raw.status,
	}
	const json = raw.resultJson
	try {
		const value = json ? JSON.parse(json) : undefined
		if (raw.status === "ok") parsed.resultJson = value
		else parsed.errorJson = value
	} catch {
		// non-JSON payload — leave as raw string
		if (raw.status === "ok") parsed.resultJson = json
		else parsed.errorJson = json
	}
	return parsed
}

/**
 * Run `action` and assert NO new approval popup target opens within `timeoutMs`.
 *
 * Combines:
 *   - `browser.targets()` count snapshot before/after — any new target
 *     (popup, content script, page) shows up here regardless of how it
 *     was created.
 *   - `waitForPgResult(method, fromSeq)` so we know the dApp call completed.
 *
 * Throws if a popup target appears OR the result doesn't land in time.
 */
export async function callExpectingNoPopup(
	ctx: ExtensionContext,
	page: Page,
	method: string,
	action: () => Promise<void>,
	timeoutMs = 30_000,
): Promise<PgResult> {
	const fromSeq = await snapshotResultSeq(page)
	// Only count user-visible page targets; profileTx and other proof-generating
	// methods spawn worker bundles (thread.worker.js) which are NOT popups.
	const isPagePopup = (url: string) => url.startsWith("chrome-extension://") && url.includes("/src/popup/index.html")
	const popupsBefore = new Set(
		ctx.browser
			.targets()
			.filter((t) => t.type() === "page" && isPagePopup(t.url()))
			.map((t) => t.url()),
	)

	await action()
	const result = await waitForPgResult(page, method, fromSeq, timeoutMs)

	const newPopups = ctx.browser
		.targets()
		.filter((t) => t.type() === "page" && isPagePopup(t.url()) && !popupsBefore.has(t.url()))
		.map((t) => t.url())
	if (newPopups.length > 0) {
		throw new Error(`Expected no popup but ${newPopups.length} new popup target(s) appeared: ${newPopups.join(", ")}`)
	}
	return result
}
