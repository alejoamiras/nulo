# Phase 3 — docs for the behaviour, and arc 1's codex loop

## What landed

- `ARCHITECTURE.md` §8 — "When the background dies under a connected dApp": the reply, why the relay stays
  untouched (recovery from a *cold* background rides on the heartbeat; "at once" is the attached background),
  the four stated limits, and the deliberate asymmetry with F-B16's clean loss for a queued discovery.
- `.claude/skills/e2e-testing/SKILL.md` — §3 gains the same-page reconnect recipe (`unlockAfterBackgroundDeath`
  → `reconnectPlayground`, alarms cleared before the kill) and the Firefox wake nuance; ledger row 32 names the
  fingerprint (`did not settle within 30000 ms (background alive now: true)`), the mechanism and the fix.
- `apps/extension/tests/e2e/FIREFOX.md` — row 1 records that a connected dApp's heartbeat is an event that
  wakes the event page, and why the in-flight call is rejected within seconds there.

## Gate

- `cd ROOT && bun run audit:vue` → exit 0 (typecheck ∥ `Test Files 544 passed | 3 skipped (547)`, `Tests 6881
  passed | 4 skipped | 7 todo (6892)` ∥ lint, then the Chrome build).
- `cd ROOT && bun run test:ci-gating` → exit 0.

## Arc 1 codex loop (GPT-6 Astra at `high`, read-only, under tmux, `CODEX_ACCOUNT=best` → `alejo-gmail`)

### Round 1 — session `01a0c64e-33fd-77f0-9291-ec3514deb65a`, verdict **changes required**

| # | Finding (codex) | Verified | Disposition |
|---|---|---|---|
| M1 | `stale-session.ts:44` — a new session-id existence oracle: an approved page that names a chosen id gets `session-disconnected` for an absent id but silence for another tab's live id (reproduced by codex through the real handlers and a MessageChannel) | True — the plan's "other tab's live id → forwarded" row created it | **Adopted.** `sessionKnownTo(handler, sessionId, tabId)` is tab-bound: a session is known only to the tab that holds it, so absent and other-tab ids get the same sender-local reply and the owning tab is never written to (the SDK would only have PONGed it). Ledger D22; the two other-tab rows of the Phase 2 table revised. Pinned by "indistinguishable to the sender — no liveness oracle" and the tab-binding table tests. Codex's "test through actual content-script ports" is covered by the ping-pong port pins plus the wrapper-level oracle test; a full port harness was not built |
| M2 | `inflight-call-background-death.test.ts:80` — the rejection deadline was logged, not asserted: `waitForPgResult` got the whole budget after the click, so a slow round-trip could let a heartbeat-driven answer pass the 3 s proof | True | **Adopted.** The wait gets `since + budget − now`, and `elapsedMs ≤ budgetMs` is asserted (all three tests) |
| M3 | `background.transport.test.ts` — the malformed and passthrough cases could not tell the wrapper from the SDK's own filtering; the encrypted-message spy cannot show an unknown PING was not forwarded | True | **Adopted.** The SDK's `initialize` is stubbed to hand the transport its own listener wrapped in a spy (`sdkListener`); forwarded / not forwarded is asserted on it in every case; the malformed envelope is a `discovery-request` with a non-string `sessionId`, which the SDK would dispatch (`handleDiscoveryRequest` spied) |
| L1 | `ARCHITECTURE.md` — "no unapproved page can be reached" ignores the tab-wide approval broadcast (an unapproved iframe can hold a port); the no-heartbeat dApp's "next call at once" needs "after attachment"; the F-B16 history | True on both wordings | **Adopted** (reworded to "closes the matching port if it holds one, ignores the reply otherwise"; the attached-only qualification). The pointer to the queued-discovery plan stays — ARCHITECTURE already cites plans by path (§6) — with the behavioural distinction leading |
| L2 | `SKILL.md:423` / `FIREFOX.md:28` — "on every kill" includes idle-up, which opens a popup; the heartbeat runs only with a call pending | True | **Adopted**: the two no-popup kills, "suggestive, one end-of-budget sample", "a dApp with a call pending" |
| L3 | `background.transport.test.ts:90` — two new `noExplicitAny` suppressions for the global stubs | True | **Adopted**: `vi.stubGlobal` + `vi.unstubAllGlobals()` |

Codex also ran the 40 touched unit tests and targeted Biome checks (green); no builds, e2e or workflows.

**Round-1 gates.** lint 0, typecheck 0; `stale-session` + `background.transport` + `ping-pong` + `background.admission`
+ `scripts/e2e` → 10 files / 131 tests. New mutation checks: (d) the schema check removed → "a malformed
content-script envelope is dropped — even one the SDK would otherwise dispatch" red; (e) the tab binding removed
(`getSession(id) !== undefined`) → the two `sessionKnownTo` tab tests, "its id sent from another tab is answered in
that tab only" and "no liveness oracle" red — 5 failed / 22 passed with both applied, all green after the revert.
E2E (spec and `background.ts` changed): the whole Phase 2 battery re-run, all green with the deadline now asserted —
network Chrome `Test Files 6 passed | 1 skipped (7)`, `Tests 9 passed | 1 skipped (10)` (the Firefox restart spec),
rejection 1 803 ms / 5 016 ms / 15 ms; network Firefox `Test Files 7 passed (7)`, `Tests 10 passed (10)`, 6 410 ms /
5 218 ms / 251 ms; smoke Chrome `5 passed | 1 skipped`, smoke Firefox `4 passed | 2 skipped` (the same declared skips
as Phase 2). Committed as `fix(wallet-sdk): bind the dead-session reply to the sender's tab; assert the e2e deadline`
(`10a912cd`).

### Round 2 — the same session resumed on the fix diff, verdict **approve** — converged

Quoted: *"approve — No new material findings. **Confidence: high.** Tab binding preserves honest traffic:
navigation/bfcache retains the tab identity; an independent popup establishes its own session; forwarding through
an opener's port still uses the opener's content script. Verification and profile teardown remain consistent. The
test accesses private `transport` and `handleMessage`. Renaming `transport` throws; renaming `handleMessage` breaks
discovery/key-exchange tests. Replacing `initialize` could mask future initialization-only changes, but matches the
installed one-line implementation. The deadline measures observation time, including 200 ms polling and driver
latency. It is conservative near the boundary; the reported idle-up results leave substantial margin. No
heartbeat-based false pass remains. Reworded docs and new comments introduce no material issue. Independently reran
the four unit files: 42 tests passed."*

Two rounds; the hard stop at three was not reached. Codex's one caution — a stubbed `initialize` would not see a
future initialization-only change in the SDK — is accepted: the stub reproduces the installed one line, and a rename
of either field it reaches into fails loudly (the wrapper is never attached, or every discovery case reds).

**Phase 3 gate, re-run on the post-fix tree** (the ✓ rests on this run): `bun run audit:vue` → exit 0 (`Test Files
544 passed | 3 skipped (547)`, `Tests 6883 passed | 4 skipped | 7 todo (6894)`, Chrome build green);
`bun run test:ci-gating` → exit 0 (132 pass, 0 fail).

## Arc boundary

`gh stack init worktree-firefox-arc-closeout` (the command adopts an existing branch; the plan's `--adopt` flag does
not exist on this `gh stack`), then `gh stack add firefox-arc-closeout-canaries` for arc 2.
