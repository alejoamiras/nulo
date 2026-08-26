/**
 * Tests for the journal record → terminal-state display mapping.
 *
 * Pin every documented `JobError.kind` + the live catch-alls
 * `ExecutionService.normalizeError` actually emits. The mapping is
 * UX-locked (3 visual states); these tests guard against silent drift
 * if someone changes the kind→state routing.
 */

import { describe, expect, test } from "vitest"
import { KNOWN_JOB_ERROR_KINDS } from "@nulo/wallet-core/jobs"
import type { OperationKind, OperationRecord } from "@/wallet/services/operation-journal/spec"
import {
	ACTIVITY_FEED_KINDS,
	buildJournalTerminalCardProps,
	categoricalLabel,
	humanizeErrorKind,
	journalTerminalDisplay,
	sanitizeJournalSubtitle,
} from "./journal-state"

function recordWith(overrides: Partial<OperationRecord> = {}): OperationRecord {
	return {
		id: "00",
		kind: "dapp_execute",
		origin: "dapp",
		profileId: "p1",
		progress: { stage: "failed" },
		error: { kind: "unknown", message: "generic", normalizedRaw: null },
		terminalAt: 1_000,
		attempts: 0,
		createdAt: 0,
		updatedAt: 1_000,
		...overrides,
	}
}

// Icon-name regression pin (Phase 1 codex/opus audit).
// v0.15.3 shipped invented icon names (`circle-minus`, `refresh-cw`) that
// don't exist in `assets/icons.json`. Icon.vue silently rendered empty SVG.
// These tests assert the canonical names actually present in the icon set,
// so a future regression to an invented name fails CI.
describe("journalTerminalDisplay — icon names match assets/icons.json", () => {
	test("cancelled → `cancel`", () => {
		const op = recordWith({ progress: { stage: "cancelled" }, error: null })
		expect(journalTerminalDisplay(op)?.icon).toBe("cancel")
	})
	test("interrupted → `refresh-circle`", () => {
		const op = recordWith({ error: { kind: "stuck_proving", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.icon).toBe("refresh-circle")
	})
	test("failed → `close-circle`", () => {
		const op = recordWith({ error: { kind: "network", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.icon).toBe("close-circle")
	})
})

describe("journalTerminalDisplay — non-terminal / success short-circuits", () => {
	test("non-terminal record (terminalAt=null) returns null", () => {
		const op = recordWith({ progress: { stage: "proving", enteredProveAt: 0 }, terminalAt: null, error: null })
		expect(journalTerminalDisplay(op)).toBeNull()
	})

	test("succeeded record returns null (TransactionCard handles those)", () => {
		const op = recordWith({ progress: { stage: "succeeded", txHash: "0xabc" }, error: null })
		expect(journalTerminalDisplay(op)).toBeNull()
	})
})

describe("journalTerminalDisplay — Cancelled state", () => {
	test("progress.stage === 'cancelled' → cancelled state with cancel icon", () => {
		const op = recordWith({ progress: { stage: "cancelled" }, error: null })
		expect(journalTerminalDisplay(op)).toEqual({
			state: "cancelled",
			subtitle: "Cancelled",
			icon: "cancel",
			color: "gray",
		})
	})

	test("error.kind === 'user_rejected' → cancelled state (late reject from popup)", () => {
		const op = recordWith({ error: { kind: "user_rejected", message: "rejected", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.state).toBe("cancelled")
	})
})

describe("journalTerminalDisplay — Interrupted state (3 kinds)", () => {
	test("error.kind === 'sw_restart_post_prove' → interrupted (amber, refresh-circle)", () => {
		const op = recordWith({ error: { kind: "sw_restart_post_prove", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)).toEqual({
			state: "interrupted",
			subtitle: "Transaction was interrupted",
			icon: "refresh-circle",
			color: "amber",
		})
	})

	test("error.kind === 'stale_on_resume' → interrupted", () => {
		const op = recordWith({ error: { kind: "stale_on_resume", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.state).toBe("interrupted")
	})

	test("error.kind === 'stuck_proving' → interrupted", () => {
		const op = recordWith({ error: { kind: "stuck_proving", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.state).toBe("interrupted")
	})
})

describe("journalTerminalDisplay — Failed state (catch-all + per-kind subtitles)", () => {
	test("error.kind === 'network' → 'Network error'", () => {
		const op = recordWith({ error: { kind: "network", message: "boom", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)).toEqual({
			state: "failed",
			subtitle: "Network error",
			icon: "close-circle",
			color: "red",
		})
	})

	test("error.kind === 'simulation' → 'Simulation failed'", () => {
		const op = recordWith({ error: { kind: "simulation", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Simulation failed")
	})

	test("error.kind === 'prover' → 'Couldn't generate proof'", () => {
		const op = recordWith({ error: { kind: "prover", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Couldn't generate proof")
	})

	test("error.kind === 'popup_bound' → generic 'Transaction failed'", () => {
		const op = recordWith({ error: { kind: "popup_bound", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Transaction failed")
	})

	test("(N-15) error.kind === 'duplicate_initialization' → the honest init-race subtitle", () => {
		const op = recordWith({ error: { kind: "duplicate_initialization", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Account already initialized — retry after sync")
	})

	test("error.kind === 'transfer' (executeTransfer catch-all) → generic 'Transaction failed'", () => {
		const op = recordWith({ kind: "transfer", error: { kind: "transfer", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Transaction failed")
	})

	test("error.kind === 'dapp_execute' (executeAztecSendTx catch-all) → generic 'Transaction failed'", () => {
		const op = recordWith({ error: { kind: "dapp_execute", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Transaction failed")
	})

	test("error.kind === 'unknown' → generic 'Transaction failed'", () => {
		const op = recordWith({ error: { kind: "unknown", message: "...", normalizedRaw: null } })
		expect(journalTerminalDisplay(op)?.subtitle).toBe("Transaction failed")
	})

	test("future / unrecognized kind → Failed with generic copy (no crash, no silent drop)", () => {
		const op = recordWith({ error: { kind: "future_phase_3_kind", message: "...", normalizedRaw: null } })
		const result = journalTerminalDisplay(op)
		expect(result?.state).toBe("failed")
		expect(result?.subtitle).toBe("Transaction failed")
	})

	test("failed with error=null (FSM invariant violation) → Failed with generic copy (defensive)", () => {
		// FSM forbids `failed` without an error envelope, but the mapping
		// is defensive against the case anyway — better generic copy than
		// a thrown exception in the popup.
		const op = recordWith({ error: null })
		const result = journalTerminalDisplay(op)
		expect(result?.state).toBe("failed")
		expect(result?.subtitle).toBe("Transaction failed")
	})
})

// ── ACTIVITY_FEED_KINDS classification ────────────────────────────────

describe("ACTIVITY_FEED_KINDS classification", () => {
	test("anchors the current classification — every kind is deliberately assigned", () => {
		// If you add a new `OperationKind`, this test forces an explicit
		// "render in the activity feed or somewhere else?" decision.
		// Updating the anchor is the right way to extend; silently leaving
		// the new kind out is the wrong way.
		const allKinds: OperationKind[] = ["transfer", "dapp_execute", "token_import"]
		const activityKinds = allKinds.filter((k) => ACTIVITY_FEED_KINDS.has(k))
		const nonActivityKinds = allKinds.filter((k) => !ACTIVITY_FEED_KINDS.has(k))
		expect(activityKinds.sort()).toEqual(["dapp_execute", "transfer"].sort())
		expect(nonActivityKinds).toEqual(["token_import"])
	})
})

// ── buildJournalTerminalCardProps ─────────────────────────────────────

const TEST_TOKEN_BY_ID = (id: number) =>
	id === 42 ? { symbol: "USDC", decimals: 6 } : id === 7 ? { symbol: "ETH", decimals: 18 } : undefined
const TEST_CTX = { tokenById: TEST_TOKEN_BY_ID }

function transferRecord(overrides: Partial<OperationRecord> = {}): OperationRecord {
	return recordWith({
		kind: "transfer",
		tokenId: 42,
		amountRaw: "1500000", // 1.5 USDC at 6 decimals
		recipientAddress: "0xrecipient",
		...overrides,
	})
}

describe("buildJournalTerminalCardProps", () => {
	test("transfer + cancelled → title=token symbol, icon=arrow, originLabel=null, amount formatted", () => {
		const props = buildJournalTerminalCardProps(transferRecord({ progress: { stage: "cancelled" }, error: null }), TEST_CTX)
		expect(props).not.toBeNull()
		expect(props?.title).toBe("USDC")
		expect(props?.activityIcon).toBe("arrow-narrow-up-right")
		expect(props?.originLabel).toBeNull()
		expect(props?.amount).toBe("1.5")
		expect(props?.amountSymbol).toBe("USDC")
		expect(props?.state).toBe("cancelled")
	})

	test("transfer + failed → title=token symbol, state=failed, amount present", () => {
		const props = buildJournalTerminalCardProps(
			transferRecord({ error: { kind: "network", message: "rpc down", normalizedRaw: null } }),
			TEST_CTX,
		)
		expect(props?.title).toBe("USDC")
		expect(props?.state).toBe("failed")
		expect(props?.amount).toBe("1.5")
	})

	test("transfer with unknown tokenId → title falls back to 'Transfer', no amount block", () => {
		// Codex audit catch: balanceFormatted(undefined, …) silently renders "0",
		// which would surface as a fake "0 USDC" ghost. Guard requires both amountRaw
		// AND token resolved; missing token → no amount.
		const props = buildJournalTerminalCardProps(transferRecord({ tokenId: 999 }), TEST_CTX)
		expect(props?.title).toBe("Transfer")
		expect(props?.amount).toBeNull()
		expect(props?.amountSymbol).toBeNull()
	})

	test("dapp_execute → title=humanized method, icon=zap, originLabel=subtitle, no amount", () => {
		const props = buildJournalTerminalCardProps(
			recordWith({
				kind: "dapp_execute",
				title: "swap_tokens_for_exact_tokens",
				subtitle: "uniswap.example",
				progress: { stage: "failed" },
				error: { kind: "simulation", message: "...", normalizedRaw: null },
			}),
			TEST_CTX,
		)
		expect(props?.title).toBe("Swap Tokens For Exact Tokens")
		expect(props?.activityIcon).toBe("zap")
		expect(props?.originLabel).toBe("uniswap.example")
		expect(props?.amount).toBeNull()
		expect(props?.state).toBe("failed")
	})

	test("dapp_execute with no title → fallback to 'Transaction'", () => {
		const props = buildJournalTerminalCardProps(
			recordWith({ kind: "dapp_execute", title: undefined, error: null, progress: { stage: "cancelled" } }),
			TEST_CTX,
		)
		expect(props?.title).toBe("Transaction")
	})

	test("dapp_execute with schemeful subtitle → originLabel bracketed (sanitize widening)", () => {
		// `op.subtitle` is dApp-controlled. A malicious dApp setting its
		// origin to `https://evil.com` must surface in the terminal-card
		// originLabel as `[https://evil.com]` — the user reads it as plain
		// text, not as a clickable link. Audit-fixes P1 pinning.
		const props = buildJournalTerminalCardProps(
			recordWith({
				kind: "dapp_execute",
				title: "swap",
				subtitle: "https://evil.com",
				progress: { stage: "failed" },
				error: { kind: "network", message: "x", normalizedRaw: null },
			}),
			TEST_CTX,
		)
		expect(props?.originLabel).toBe("[https://evil.com]")
	})

	test("non-activity kind (token_import) → null (footgun guard)", () => {
		// The helper must not produce an activity-feed card for kinds whose
		// home surface is elsewhere. Accidental callers get a clean null
		// instead of a malformed card.
		const props = buildJournalTerminalCardProps(
			recordWith({
				kind: "token_import",
				progress: { stage: "failed" },
				error: { kind: "network", message: "x", normalizedRaw: null },
			}),
			TEST_CTX,
		)
		expect(props).toBeNull()
	})

	test("non-terminal record → null (caller pre-filters; defensive belt)", () => {
		const props = buildJournalTerminalCardProps(transferRecord({ terminalAt: null, progress: { stage: "simulating" } }), TEST_CTX)
		expect(props).toBeNull()
	})

	test("succeeded record → null (succeeded surfaces via TransactionService, not this card)", () => {
		const props = buildJournalTerminalCardProps(
			transferRecord({ progress: { stage: "succeeded", txHash: "0xabc" }, error: null }),
			TEST_CTX,
		)
		expect(props).toBeNull()
	})
})

// dApp-controlled `subtitle` is the origin/name stored at session-discover
// time. The journal detail page renders it; if a malicious dApp set its
// origin to an http(s) URL string, the bare value could be visually
// confusable with a link. `sanitizeJournalSubtitle` brackets URL-shaped
// values so the UI can render the text plainly without it reading as
// "tap to open."
describe("sanitizeJournalSubtitle — URL-shape defense", () => {
	test("null / undefined / empty → null", () => {
		expect(sanitizeJournalSubtitle(null)).toBeNull()
		expect(sanitizeJournalSubtitle(undefined)).toBeNull()
		expect(sanitizeJournalSubtitle("")).toBeNull()
	})
	test("plain dApp name → returned verbatim", () => {
		expect(sanitizeJournalSubtitle("uniswap.example")).toBe("uniswap.example")
		expect(sanitizeJournalSubtitle("My DApp")).toBe("My DApp")
	})
	test("https URL → bracketed", () => {
		expect(sanitizeJournalSubtitle("https://evil.com/?steal=secret")).toBe("[https://evil.com/?steal=secret]")
	})
	test("http URL → bracketed", () => {
		expect(sanitizeJournalSubtitle("http://localhost:3000/app")).toBe("[http://localhost:3000/app]")
	})
	test("case-insensitive URL match", () => {
		expect(sanitizeJournalSubtitle("HTTPS://EVIL.COM")).toBe("[HTTPS://EVIL.COM]")
	})
	test("string containing http but not prefix → unchanged", () => {
		expect(sanitizeJournalSubtitle("see https://docs for help")).toBe("see https://docs for help")
	})
	test("chrome-extension:// scheme → bracketed (broader-than-http coverage)", () => {
		expect(sanitizeJournalSubtitle("chrome-extension://abcdef")).toBe("[chrome-extension://abcdef]")
	})
	test("aztec:// scheme → bracketed", () => {
		expect(sanitizeJournalSubtitle("aztec://something")).toBe("[aztec://something]")
	})
	test("custom scheme with digits and pluses → bracketed", () => {
		expect(sanitizeJournalSubtitle("a1b+x://x")).toBe("[a1b+x://x]")
	})

	// Widened to `scheme:` (no `//` required) per audit-fixes plan P1 + codex
	// audit feedback. Catches mailto / tel / javascript / data / chrome-extension
	// + the malformed `http:evil` shape that the original `scheme://` regex
	// missed. Tradeoff documented below: plain-text values with a leading
	// `<word>:` (timestamps, versions, CSS pairs) WILL also bracket — accepted
	// because callers only pass dApp-controlled origin fields, where
	// noise-bracketing is safer than missing a real schemeful value.
	test("mailto: → bracketed (widened from scheme:// to scheme:)", () => {
		expect(sanitizeJournalSubtitle("mailto:abc@example.com")).toBe("[mailto:abc@example.com]")
	})
	test("tel: → bracketed", () => {
		expect(sanitizeJournalSubtitle("tel:+15555550100")).toBe("[tel:+15555550100]")
	})
	test("javascript: → bracketed (XSS-shaped value)", () => {
		expect(sanitizeJournalSubtitle("javascript:alert(1)")).toBe("[javascript:alert(1)]")
	})
	test("data: → bracketed (data-URI-shaped value)", () => {
		expect(sanitizeJournalSubtitle("data:text/plain;base64,aGV5")).toBe("[data:text/plain;base64,aGV5]")
	})
	test("malformed http:evil (no //) → bracketed", () => {
		expect(sanitizeJournalSubtitle("http:evil")).toBe("[http:evil]")
	})
	test("chrome-extension:abc (no //) → bracketed", () => {
		expect(sanitizeJournalSubtitle("chrome-extension:abc")).toBe("[chrome-extension:abc]")
	})

	// Documented false-positive trade-offs. The widened regex accepts these
	// (and brackets them). Callers feed dApp-controlled origin fields, where
	// over-bracketing is benign — these test cases just pin the trade-off so
	// a future "tighten the regex" PR doesn't accidentally break the
	// schemeful coverage we intentionally widened to.
	test("digit-prefixed value (timestamp 12:34) → unchanged (RFC 3986 scheme requires ALPHA first)", () => {
		expect(sanitizeJournalSubtitle("12:34")).toBe("12:34")
	})
	test("(FALSE POSITIVE PIN) word-with-colon 'note:' → bracketed", () => {
		// `note:` matches the regex (starts with alpha, followed by colon).
		expect(sanitizeJournalSubtitle("note:")).toBe("[note:]")
	})
	test("(FALSE POSITIVE PIN) CSS-like 'color:red' → bracketed", () => {
		expect(sanitizeJournalSubtitle("color:red")).toBe("[color:red]")
	})

	// 12:34 starts with a digit, not alpha — RFC 3986 scheme grammar requires
	// ALPHA first. The pin above verifies it passes through unchanged.
})

// User-facing labels for error.kind. Whitelist source-of-truth: verified
// against `wallet-core/jobs/types.ts` documented values + `failedSubtitleFor`
// switch in this file + reaper.ts emissions + execution/service.ts normalizeError
// call sites. `stuck_queued` is critical — the reaper emits it on queued-record
// time-out and pinning it here ensures the raw kind never leaks into the
// "Reason" row on the journal-detail page (codex post-impl audit H2 + opus C1).
describe("humanizeErrorKind — JobError.kind → user-facing label", () => {
	test("network → 'Network'", () => {
		expect(humanizeErrorKind("network")).toBe("Network")
	})
	test("simulation → 'Simulation'", () => {
		expect(humanizeErrorKind("simulation")).toBe("Simulation")
	})
	test("prover → 'Proof generation'", () => {
		expect(humanizeErrorKind("prover")).toBe("Proof generation")
	})
	test("popup_bound → 'Popup closed'", () => {
		expect(humanizeErrorKind("popup_bound")).toBe("Popup closed")
	})
	test("dapp_execute → 'App' (we never use 'dApp' in user-facing copy)", () => {
		expect(humanizeErrorKind("dapp_execute")).toBe("App")
	})
	test("transfer → 'Transfer'", () => {
		expect(humanizeErrorKind("transfer")).toBe("Transfer")
	})
	test("sw_restart_post_prove → 'Browser restart'", () => {
		expect(humanizeErrorKind("sw_restart_post_prove")).toBe("Browser restart")
	})
	test("stale_on_resume → 'Stale on resume'", () => {
		expect(humanizeErrorKind("stale_on_resume")).toBe("Stale on resume")
	})
	test("stuck_proving → 'Stuck proving'", () => {
		expect(humanizeErrorKind("stuck_proving")).toBe("Stuck proving")
	})
	test("(REGRESSION PIN) stuck_queued → 'Stuck queued'", () => {
		// reaper emits this on queued-record time-out (reaper.ts:192,
		// reaper.test.ts:102 + :136). Pre-fix it leaked the raw kind into
		// the UI. Codex post-impl audit H2 + opus C1.
		expect(humanizeErrorKind("stuck_queued")).toBe("Stuck queued")
	})
	test("user_rejected → 'User rejected'", () => {
		expect(humanizeErrorKind("user_rejected")).toBe("User rejected")
	})
	test("unknown → 'Unknown'", () => {
		expect(humanizeErrorKind("unknown")).toBe("Unknown")
	})
	test("any unrecognized kind → 'Error'", () => {
		expect(humanizeErrorKind("metadata_fetch")).toBe("Error")
		expect(humanizeErrorKind("totally_new_kind")).toBe("Error")
		expect(humanizeErrorKind("")).toBe("Error")
	})
})

describe("categoricalLabel — B2 failure category + context for journal/[id].vue", () => {
	function failed(kind: string): OperationRecord {
		return recordWith({ progress: { stage: "failed" }, error: { kind, message: "", normalizedRaw: null } })
	}

	test("user_rejected → 'You rejected'", () => {
		const { label, context } = categoricalLabel(failed("user_rejected"))
		expect(label).toBe("You rejected")
		expect(context).toBe("You stopped this transaction.")
	})
	test("popup_bound → 'Popup closed early'", () => {
		expect(categoricalLabel(failed("popup_bound")).label).toBe("Popup closed early")
	})
	test("simulation / prover / stuck_proving / stuck_queued → 'Stopped before broadcast'", () => {
		for (const kind of ["simulation", "prover", "stuck_proving", "stuck_queued"]) {
			expect(categoricalLabel(failed(kind)).label).toBe("Stopped before broadcast")
		}
	})
	test("sw_restart_post_prove / stale_on_resume → 'Interrupted mid-flight' + check explorer hint", () => {
		for (const kind of ["sw_restart_post_prove", "stale_on_resume"]) {
			const { label, context } = categoricalLabel(failed(kind))
			expect(label).toBe("Interrupted mid-flight")
			expect(context).toContain("check the explorer")
		}
	})
	test("network → 'Network error'", () => {
		expect(categoricalLabel(failed("network")).label).toBe("Network error")
	})
	test("transfer / dapp_execute → 'Reported by app'", () => {
		for (const kind of ["transfer", "dapp_execute"]) {
			expect(categoricalLabel(failed(kind)).label).toBe("Reported by app")
		}
	})
	test("unknown / unrecognized → 'Error'", () => {
		expect(categoricalLabel(failed("unknown")).label).toBe("Error")
		expect(categoricalLabel(failed("metadata_fetch")).label).toBe("Error")
	})
	test("no error envelope → 'Error' fallback", () => {
		// op without error.kind defaults to "unknown" → fallback case.
		const op = recordWith({ progress: { stage: "failed" }, error: null })
		expect(categoricalLabel(op).label).toBe("Error")
	})

	test("(SANITIZE-INVARIANCE PIN) categoricalLabel ignores op.subtitle even if dApp injects an evil-shaped string", () => {
		// The helper must NOT pull strings from op.subtitle. If a future
		// refactor accidentally wires the context line to op.subtitle, the
		// previously-sanitized dApp-controlled string would render raw.
		const op = recordWith({
			progress: { stage: "failed" },
			error: { kind: "simulation", message: "", normalizedRaw: null },
			subtitle: "http://evil.example/danger",
		})
		const { label, context } = categoricalLabel(op)
		expect(label).not.toContain("evil")
		expect(context).not.toContain("evil")
		expect(context).not.toContain("http")
	})
})

describe("KNOWN_JOB_ERROR_KINDS taxonomy coverage", () => {
	// Every known kind must drive a non-empty, non-throwing UI label through both
	// chokepoint helpers — adding a kind without a UX path surfaces here, not as a
	// blank card in production. Token-import kinds intentionally hit the generic
	// default; the assertion is non-empty, not bespoke.
	const failedWith = (kind: string): OperationRecord =>
		recordWith({ progress: { stage: "failed" }, error: { kind, message: "x", normalizedRaw: null } })

	test("every known kind humanizes to a non-empty string, never throws", () => {
		for (const kind of KNOWN_JOB_ERROR_KINDS) {
			expect(() => humanizeErrorKind(kind)).not.toThrow()
			expect(humanizeErrorKind(kind).length).toBeGreaterThan(0)
		}
	})

	test("every known kind drives a non-empty categoricalLabel, never throws", () => {
		for (const kind of KNOWN_JOB_ERROR_KINDS) {
			expect(() => categoricalLabel(failedWith(kind))).not.toThrow()
			expect(categoricalLabel(failedWith(kind)).label.length).toBeGreaterThan(0)
		}
	})
})
