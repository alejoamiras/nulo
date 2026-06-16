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
 * `minQueued` thresholds. Runs the count IN the browser via `waitForFunction`
 * (robust to frame-readiness + fast polling), unlike a Node-side poll loop.
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
	await page.waitForFunction(
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
	await page.waitForFunction(
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
	await page.waitForFunction(
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
}
