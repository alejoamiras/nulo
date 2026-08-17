# Arc 7 — quality-quick-wins (Q-03, Q-05-narrowed, Q-06, Q-12)

[light] tier of the 2026-08-16 dual-audit **quality** remediation. Four low-blast-radius maintainability findings — the "quick wins" bucket. Zero behavior change (quality arc). One codex xhigh complete-arc-diff pass at the end.

Source of truth: `audit/quality/2026-08-16-extension-mid/findings/consolidated.md` (verified.md overrides).

| ID | Impact | Fix (commit) |
|----|--------|------|
| **Q-03** | structural | `EventHandler.invoke` swallowed every listener throw with a bare `catch {}` — no diagnostic. Added an optional `(name?, logger?)` ctor; the catch now reports via a guarded `this.#logger?.log("event-handler", Error, …)` inside a nested try/catch (a logger that itself throws can't break dispatch). Default ctor unchanged → every existing call site is untouched (3193bc61). |
| **Q-12** | local (test-gap) | The extension's `sanitizeString` (`apps/extension/src/utils/string.ts`) and `@nulo/design`'s copy silently drifted with no cross-checking test. Added `sanitize-parity.test.ts` — a FIXTURES table asserting byte-identical output from both. RED-verified against an injected divergence (3193bc61). |
| **Q-06** | architectural | Two layering smells: (1) `RequestTerminalStatus` lived in `offscreen/telemetry.ts` but was imported UP by `base-client.ts` (a lower layer) → moved to `extension-messaging/src/core/terminal-status.ts`, telemetry re-exports it. (2) `authwit-content.ts` ↔ `action.ts` formed a type cycle → extracted the neutral `CallPayload`/`EncodedCallPayload` into `call-shapes.ts`; both sides import down from it (d5f38ae2). |
| **Q-05** (narrowed) | structural | Four SW components hand-rolled the identical alarm lifecycle (name const + `create`/`clear` + boot-run + name-filtered dispatch + tick error-catch). Extracted the shared `AlarmBackedTask` primitive (`packages/wallet-core/src/utils/alarm-backed-task.ts`) with a full lifecycle unit test, and migrated the single cleanest live site (`operation-journal/gc.ts`) to prove adoption. gc's 8 sweep tests stay green (sweep untouched). |

## Prove-first / verification per finding
- **Q-03**: 6 unit tests (`event-handler.test.ts`) — a throwing listener no longer aborts the remaining listeners AND is now reported to the injected logger; a logger that throws is itself swallowed; the no-logger default path stays silent. RED-verified (pre-fix bare `catch {}` reported nothing).
- **Q-12**: RED-verified — flipping one fixture's expected output, or diverging one implementation, reds the parity table.
- **Q-06**: pure move/extract — typecheck + `dispatcher.test.ts` (reachability) + full messaging/bridge unit suites are the proof; no behavior surface touched.
- **Q-05**: `alarm-backed-task.test.ts` (6 cases: create-on-start, boot-run, `runOnStart:false` skips boot, name-filtered dispatch, tick-error caught on both boot + dispatch, stop unsubscribes+clears). gc.ts's existing 8 tests confirm the migration is behavior-preserving.

## Q-05 scope decision (narrowed) + owned follow-ups
The verified.md finding lists **four** duplicating sites. The [light] tier + ANTI-OVERENGINEERING clause (smallest safe change; no new abstraction unless ≥3 call sites benefit — here 4 do) justify extracting the primitive, but migrating all four in one arc is mid-tier surface. **Narrowed** = extract the primitive + a thorough unit test + migrate the ONE cleanest site (`gc.ts`, whose 8 tests already isolate sweep from lifecycle, so the migration is provably behavior-neutral). The primitive is the durable dedup; the remaining three migrations are mechanical and each independently testable.

**Owned, dated follow-ups (2026-08-17)** — migrate the remaining three hand-rolled sites onto `AlarmBackedTask` (each behavior-preserving, each gated by its own existing tests):
- `apps/extension/src/wallet/services/operation-journal/reaper.ts` — `JOURNAL_REAPER_ALARM_NAME` / 1-min cadence; `tick = () => this.reap()`.
- `packages/aztec-runtime/src/price/service.ts` — the price-refresh alarm; `tick = () => this.refresh()`. (Confirm its boot-run semantics match `runOnStart:true` before migrating.)
- `apps/extension/src/wallet/services/profile/session-manager.ts` — the session-sweep alarm; verify its dispatch filter + boot behavior map cleanly onto the primitive (this is the one most likely to need `runOnStart:false`).

Each follow-up is a ≤1-file diff that deletes the local alarm plumbing and delegates to a `new AlarmBackedTask({...})`, mirroring the gc.ts migration in this arc. They were split out (not silently dropped) to keep this arc [light] and each migration individually reviewable.

## Codex complete-arc-diff loop (bounded: initial + max 2 resumes)
_pending — run over the complete Arc 7 diff once Q-05 is committed._
