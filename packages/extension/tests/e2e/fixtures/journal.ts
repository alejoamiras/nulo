/**
 * Journal-truth e2e helpers.
 *
 * The wallet's durable operation journal (`nulo:journal@<id>` records in
 * `chrome.storage.local`) is the SOURCE OF TRUTH for transaction state in e2e
 * assertions. The rendered `tx-awaiting-card` is a LAGGING PROJECTION of it:
 * RecentActivityView filters terminal ops out, so the card unmounts on
 * `succeeded`, and a freshly-opened popup paints the card asynchronously after
 * the journal already reflects the state. Asserting on the card therefore races
 * the render (and the proverless fast-completion); asserting on the journal does
 * not. Read these from any extension-context page (popup/SW) — `chrome.storage`
 * is shared across extension contexts.
 *
 * Stage groups mirror `@nulo/wallet-core/jobs` `JobStage`
 * (`queued|pending|simulating|proving|submitting|succeeded|failed|cancelled`):
 *   - QUEUED  : waiting behind the per-session FIFO baton (not yet claimed).
 *   - ACTIVE  : claimed + in-flight, non-terminal (pending/simulating/proving/submitting).
 *   - WORKED_OR_DONE : reached real work or finished OK, NOT errored — the honest
 *     "the wallet accepted + processed my tx" signal that tolerates the proverless
 *     fast-path (`succeeded`) while still failing on `failed`/`cancelled`.
 * The string sets are duplicated inside `page.evaluate`/`waitForFunction`
 * closures because those run in the browser and cannot close over module scope.
 */
import { execSync } from "node:child_process"
import type { Page } from "puppeteer"

/** Non-terminal, claimed stages — "an op is in flight right now". */
export const ACTIVE_STAGES = ["pending", "simulating", "proving", "submitting"] as const
/** Waiting behind the FIFO baton, not yet claimed. */
export const QUEUED_STAGES = ["queued"] as const

export type DappExecuteView = { id: string; stage: string; sessionId?: string }
export type InFlightCounts = { active: number; queued: number; total: number }

/**
 * Snapshot every `dapp_execute` journal record as `{id, stage, sessionId}`.
 * The shared, typed replacement for the inline `chrome.storage.local` reads that
 * were copy-pasted across concurrency tests.
 */
export async function readDappExecuteRecords(page: Page): Promise<DappExecuteView[]> {
	return page.evaluate(async () => {
		const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
		const out: { id: string; stage: string; sessionId?: string }[] = []
		for (const [k, raw] of Object.entries(all)) {
			if (!k.startsWith("nulo:journal@")) continue
			try {
				const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
					id?: string
					kind?: string
					progress?: { stage?: string }
					sessionId?: string
				}
				if (r?.kind === "dapp_execute") out.push({ id: r.id ?? "", stage: r.progress?.stage ?? "?", sessionId: r.sessionId })
			} catch {
				// Skip unparseable / non-record entries.
			}
		}
		return out
	})
}

/**
 * Evaluate in the SERVICE-WORKER context (always an extension context, so
 * `chrome.storage` is defined) rather than the passed page. Critical because the
 * `waitForPgResult` callers (F1/F2) pass the PLAYGROUND page — a plain web page
 * where `chrome.storage` is undefined — and because the SW survives a wedged
 * playground renderer (F1). Returns a marker string if there's no live SW worker.
 */
async function swEvaluate<A extends unknown[], R>(page: Page, fn: (...a: A) => R | Promise<R>, ...args: A): Promise<R | string> {
	const target = page
		.browser()
		.targets()
		.find((t) => t.type() === "service_worker" && t.url().includes("chrome-extension://"))
	if (!target) return "<no service_worker target>"
	const worker = await target.worker()
	if (!worker) return "<service_worker has no worker handle>"
	return worker.evaluate(fn, ...args)
}

/**
 * Full `dapp_execute` records (every field), trimmed only by JSON. The lean
 * `{id,stage,sessionId}` view hides the claim metadata the F3 queued-stall
 * diagnosis needs — `queuedJournalId`, stage timestamps, any `error`. Read from
 * the SW context (via {@link swEvaluate}) so it works for the playground-page
 * callers (F1/F2) too. Allowlisted to `dapp_execute` (NOT a `get(null)` dump).
 */
export async function readDappExecuteRecordsFull(page: Page): Promise<unknown[] | string> {
	return swEvaluate(page, async () => {
		const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
		const out: unknown[] = []
		for (const [k, raw] of Object.entries(all)) {
			if (!k.startsWith("nulo:journal@")) continue
			try {
				const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
					kind?: string
					id?: string
					sessionId?: string
					progress?: { stage?: string }
					error?: { code?: unknown }
					attempts?: number
					createdAt?: number
					updatedAt?: number
					terminalAt?: number | null
					title?: string
				}
				if (r?.kind === "dapp_execute") {
					// Project DIAGNOSTIC fields only — never accountAddress / txHash /
					// profileId / networkId / error body. Keeps the queued-stall
					// disambiguators (stage + createdAt/updatedAt + attempts/terminalAt)
					// + a truncated sessionId for correlation; keeps identifiers/PII out
					// of CI artifacts (the dump is uploaded on failure).
					out.push({
						id: r.id,
						stage: r.progress?.stage,
						attempts: r.attempts,
						createdAt: r.createdAt,
						updatedAt: r.updatedAt,
						terminalAt: r.terminalAt,
						title: r.title,
						errorCode: r.error?.code,
						sid8: typeof r.sessionId === "string" ? r.sessionId.slice(0, 8) : undefined,
					})
				}
			} catch {
				// Skip unparseable entries.
			}
		}
		return out
	})
}

/**
 * The service-worker's own log trail — `LoggerStore` debounce-flushes it to
 * `chrome.storage.session["nulo:logs"]` every 2s (`wallet/logger/store.ts:80`).
 * Reading it from the test side surfaces HOW FAR execution got — did `acquireSlot`
 * run, did `executionMutex.acquire` resolve, was the journal claim attempted — for
 * the F3 stall whose state otherwise lives only in SW memory. NO production change.
 * `match` filters to execution-relevant sources/data (allowlist, not a full dump).
 */
export async function readSwLogTrail(page: Page, opts: { limit?: number; match?: string } = {}): Promise<unknown[] | string> {
	const { limit = 50, match = "" } = opts
	return swEvaluate(
		page,
		async (lim: number, m: string) => {
			const res = (await chrome.storage.session.get("nulo:logs")) as Record<string, unknown>
			const logs = (res["nulo:logs"] as { source?: string; data?: unknown[]; timestamp?: number }[] | undefined) ?? []
			const re = m ? new RegExp(m, "i") : null
			const hit = re ? logs.filter((l) => re.test(l.source ?? "") || re.test(JSON.stringify(l.data ?? []))) : logs
			return hit.slice(-lim)
		},
		limit,
		match,
	)
}

/**
 * OUT-OF-BAND target inventory (SW alive? offscreen doc present? page count?),
 * read from the BROWSER-level target cache (`page.browser().targets()`), which
 * survives a wedged PAGE renderer — the F1 case where every in-page `page.evaluate`
 * read hangs the full `protocolTimeout`. Synchronous + cached, so it cannot hang.
 */
export function captureTargetInventory(page: Page): string[] | string {
	try {
		return page
			.browser()
			.targets()
			.map((t) => `${t.type()} ${t.url().split("?")[0].slice(0, 90)}`) // drop query params (requestId/sessionId)
	} catch (err) {
		return `target inventory FAILED: ${err instanceof Error ? err.message : String(err)}`
	}
}

/**
 * Off-CDP-thread resource snapshot (top processes by CPU). Settles the
 * resource-starvation question with DATA instead of assumption (the prior arc's
 * mistake) — and runs via Node `child_process`, NOT CDP, so it works regardless
 * of browser/page state. Bounded (5s) + best-effort.
 */
export function captureResourceSnapshot(): string {
	try {
		return execSync("ps -A -o %cpu,%mem,rss,comm | sort -rn | head -12", { timeout: 5_000, encoding: "utf8" })
	} catch (err) {
		return `resource snapshot FAILED: ${err instanceof Error ? err.message : String(err)}`
	}
}

/** Race a promise against a bounded timeout, resolving to a marker string on
 *  timeout so a wedged in-page read (frozen CDP) can never extend the dump past
 *  `ms` (audit M4 — the hang-hook must not turn a 30s failure into a job-killer). */
async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T | string> {
	return Promise.race([p, new Promise<string>((res) => setTimeout(() => res(`<${what} timed out after ${ms}ms>`), ms))])
}

/**
 * Best-effort diagnostic: dump the `dapp_execute` journal records to the console
 * with a label. The journal waiters below call this ONLY when they time out (via
 * {@link awaitOrDump}), so the success path is never perturbed (observer-effect
 * safe). A CI failure then shows the journal state at the hang ("stuck at queued"
 * vs "all terminalized but the dApp promise never settled") instead of a bare
 * TimeoutError. If the read itself throws (frozen CDP — F1/Mode 2), that is logged
 * too, distinguishing a browser freeze from a journal-visible hang. Always
 * followed by {@link dumpDeepDiagnostics} for the worker/target/resource picture.
 */
export async function dumpJournal(page: Page, label: string): Promise<void> {
	try {
		const recs = await withTimeout(readDappExecuteRecords(page), 10_000, "journal read")
		console.error(`[journal-diag] ${label}: ${typeof recs === "string" ? recs : `${recs.length} record(s): ${JSON.stringify(recs)}`}`)
	} catch (err) {
		console.error(
			`[journal-diag] ${label}: journal read FAILED (likely frozen CDP / Mode 2): ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	await dumpDeepDiagnostics(page, label)
}

/**
 * The deep timeout dump: full records + SW log trail (in-page, bounded so a frozen
 * CDP can't hang it) + out-of-band target inventory + off-thread resource snapshot.
 * Every part is independently guarded — a failure in one never blocks the others,
 * and the whole thing is capped well under the runner budget. Failure-path only.
 */
export async function dumpDeepDiagnostics(page: Page, label: string): Promise<void> {
	// The two in-page reads run CONCURRENTLY so the whole deep dump is bounded by a
	// SINGLE ~10s window (not summed) — a frozen CDP can't stretch the failure budget.
	const [full, trail] = await Promise.all([
		withTimeout(
			readDappExecuteRecordsFull(page).catch((e) => `<full read failed: ${e instanceof Error ? e.message : String(e)}>`),
			10_000,
			"full records",
		),
		withTimeout(
			readSwLogTrail(page, { match: "exec|dapp|lane|mutex|claim|baton|offscreen|slot|queue" }).catch(
				(e) => `<sw-log read failed: ${e instanceof Error ? e.message : String(e)}>`,
			),
			10_000,
			"sw-log trail",
		),
	])
	console.error(`[diag-deep] ${label} full dapp_execute: ${typeof full === "string" ? full : JSON.stringify(full)}`)
	console.error(`[diag-deep] ${label} sw-log trail: ${typeof trail === "string" ? trail : JSON.stringify(trail)}`)
	console.error(`[diag-deep] ${label} targets: ${JSON.stringify(captureTargetInventory(page))}`)
	console.error(`[diag-deep] ${label} resources:\n${captureResourceSnapshot()}`)
}

/** Await a journal-wait promise; on rejection (e.g. TimeoutError) dump the
 *  journal state via {@link dumpJournal}, then re-throw unchanged. */
async function awaitOrDump(page: Page, label: string, p: Promise<unknown>): Promise<void> {
	try {
		await p
	} catch (err) {
		await dumpJournal(page, label)
		throw err
	}
}

/**
 * Snapshot in-flight counts over `dapp_execute` records (optionally scoped to a
 * `sessionId`). `active` excludes terminal + queued; `queued` is the FIFO-blocked
 * count. Use for exact-count assertions; use {@link waitForInFlight} to wait.
 */
export async function countInFlight(page: Page, opts: { sessionId?: string } = {}): Promise<InFlightCounts> {
	const recs = await readDappExecuteRecords(page)
	const scoped = opts.sessionId ? recs.filter((r) => r.sessionId === opts.sessionId) : recs
	const active = new Set<string>(ACTIVE_STAGES)
	return {
		active: scoped.filter((r) => active.has(r.stage)).length,
		queued: scoped.filter((r) => r.stage === "queued").length,
		total: scoped.length,
	}
}

/**
 * Wait until in-flight counts over `dapp_execute` records meet `minActive` /
 * `minQueued` / `minInFlight` thresholds. Runs the count IN the browser via
 * `waitForFunction` (robust to frame-readiness + fast polling).
 *
 * Thresholds:
 *   - `minActive`  : records in a CLAIMED, working stage (pending/simulating/proving/submitting).
 *   - `minQueued`  : records waiting behind the FIFO baton (`queued`).
 *   - `minInFlight`: records that are non-terminal regardless of claim state (active + queued).
 *
 * Two canonical shapes:
 *   - APPROVED-boundary (`{ minActive: 1, minQueued: 1 }`, pair with a held proof
 *     gate): "one tx executing at `proving` while a second waits on the baton".
 *   - REJECT/queued-boundary (`{ minInFlight: 2, minQueued: 1 }`): "two txs are in
 *     flight, at least one queued" — used BEFORE approval, where the claimed tx is
 *     still `queued` (the queued→pending transition happens at execution start, not
 *     popup-open), so there is no `active` record yet.
 */
export async function waitForInFlight(
	page: Page,
	opts: { minActive?: number; minQueued?: number; minInFlight?: number; sessionId?: string; timeout?: number } = {},
): Promise<void> {
	const { minActive = 0, minQueued = 0, minInFlight = 0, sessionId, timeout = 30_000 } = opts
	const wait = page.waitForFunction(
		async (sid: string | null, minA: number, minQ: number, minIF: number) => {
			const active = new Set(["pending", "simulating", "proving", "submitting"])
			const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
			let a = 0
			let q = 0
			for (const [k, raw] of Object.entries(all)) {
				if (!k.startsWith("nulo:journal@")) continue
				try {
					const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
						kind?: string
						progress?: { stage?: string }
						sessionId?: string
					}
					if (r?.kind !== "dapp_execute") continue
					if (sid && r.sessionId !== sid) continue
					const s = r.progress?.stage
					if (s && active.has(s)) a++
					else if (s === "queued") q++
				} catch {
					// Skip unparseable entries.
				}
			}
			return a >= minA && q >= minQ && a + q >= minIF
		},
		{ timeout, polling: 200 },
		sessionId ?? null,
		minActive,
		minQueued,
		minInFlight,
	)
	await awaitOrDump(page, `waitForInFlight(minActive=${minActive},minQueued=${minQueued},minInFlight=${minInFlight})`, wait)
}

/**
 * Wait until the journal holds at least one `dapp_execute` record in EACH of the
 * given stages simultaneously. Use for deterministic ordering snapshots — e.g.
 * `["proving", "queued"]` = "T1 held mid-prove while T2 waits behind it on the
 * execution mutex" (pair with a held proof gate so the active tx parks at
 * `proving` rather than racing through it).
 */
export async function waitForDappExecuteStagesPresent(page: Page, stages: string[], opts: { timeout?: number } = {}): Promise<void> {
	const { timeout = 30_000 } = opts
	const wait = page.waitForFunction(
		async (required: string[]) => {
			const present = new Set<string>()
			const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
			for (const [k, raw] of Object.entries(all)) {
				if (!k.startsWith("nulo:journal@")) continue
				try {
					const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as { kind?: string; progress?: { stage?: string } }
					if (r?.kind === "dapp_execute" && r.progress?.stage) present.add(r.progress.stage)
				} catch {
					// Skip unparseable entries.
				}
			}
			return required.every((s) => present.has(s))
		},
		{ timeout, polling: 200 },
		stages,
	)
	await awaitOrDump(page, `waitForDappExecuteStagesPresent(${stages.join(",")})`, wait)
}

/**
 * Wait until at least one `dapp_execute` journal record has reached real work or
 * finished OK (`simulating`/`proving`/`submitting`/`succeeded`) — the honest
 * "the wallet accepted + is processing/finished my tx" signal. Tolerates the
 * proverless fast-path (`succeeded`); never satisfied by `failed`/`cancelled`.
 *
 * The journal-truth replacement for the old `waitForSendTxActiveStage`, which
 * watched the `tx-awaiting-card` DOM and raced both the popup render and the
 * proverless fast-completion (the card is gone once the op terminalizes).
 */
export async function waitForDappExecuteWorked(page: Page, options: { timeout?: number } = {}): Promise<void> {
	const { timeout = 30_000 } = options
	const wait = page.waitForFunction(
		async () => {
			const workedOrDone = new Set(["simulating", "proving", "submitting", "succeeded"])
			const all = (await chrome.storage.local.get(null)) as Record<string, unknown>
			for (const [k, raw] of Object.entries(all)) {
				if (!k.startsWith("nulo:journal@")) continue
				try {
					const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as { kind?: string; progress?: { stage?: string } }
					if (r?.kind === "dapp_execute" && r.progress?.stage && workedOrDone.has(r.progress.stage)) return true
				} catch {
					// Skip unparseable entries.
				}
			}
			return false
		},
		{ timeout, polling: 250 },
	)
	await awaitOrDump(page, "waitForDappExecuteWorked", wait)
}
