# deflake-round-2 — flake-class close-out A1–A5 + watch items B6–B7

- **Tier**: `/blueprint light` (rubric: 0 HIGH dimensions — fixture/test-first, no novel surface,
  low blast radius except one flagged fail-mode change, no migrations/external coupling; the
  owner's /goal predicted light). Single codex audit + per-PR iteration loops.
- **Worktree**: `deflake-round-2` (branch `worktree-deflake-round-2`, base dev @ `3eb6e83`).
- **Authorization**: the owner's /goal IS the approval — no owner gate unless a UX-visible
  product fork surfaces (none expected; the one product-adjacent candidate is a popup
  button-disabled binding, decided with codex and reported).
- **Hard rules carried from the goal**: no timeout/bound raises as fixes; gates never weakened;
  causal-signal waits only; network e2e SOLO with `NULO_E2E_RETRY=0` (+`NULO_E2E_PROVERLESS=1`
  full sweep); armed-build discipline; ledger discipline; certification per e2e-deflake Phase 6.

## Assumptions

**Facts (verified in recon.md, file:line there):**
1. vitest's default reporter swallows first-attempt errors on retry-pass — CI logs carry only
   `(retry x1)`; the two A1 flakes' first-attempt reasons are unrecoverable from CI.
2. `setTheme` and `navigateByHash` waits use Puppeteer default `'raf'` polling; the repo already
   documents rAF throttling in unfocused tabs and hardens `waitForHash` with `polling: 200`.
3. appearance Test B gates on a fixed 150ms sleep racing a multi-hop RPC/broadcast chain, and
   reads a CSS-module-mangled className; the stable `data-toggle-active` signal + a hardened
   gated-wait idiom (`togglePrivacySetting`) already exist.
4. The `"fj"|"fpc"` dead mapping exists in TWO helpers (`approveExecute`,
   `pickFeeAndSubmitAuthwitPopup`); real testids are `send-fee-method-{public|private|sponsored}`.
5. `DappInteractionService.cancelInteraction` has no in-repo caller; `execute-confirm-btn` never
   disables on cancel; fixtures click programmatically (bypass the overlay).
6. `waitForFreshBalanceRow` proves public raw only; receive-unregistered's core pin (1,025) and
   transfers' 950/50 detail asserts need private-balance proof.
7. Neither observed setup-step incident (snappy, noirup-503) would have been saved by a
   step-level retry (deterministic / sustained-outage-with-inner-retry).

**Inferences (to confirm empirically before fixing):**
- A1-B fast-fail = the 150ms sleep losing the race under CI load; A1-A slow-fail = rAF-starved
  2s waits in an unfocused page. Phase A1 reproduces BEFORE fixing (goal requirement).

**Asks resolved in-plan (no silent Asks):** the A3 sweep includes two same-class sites beyond
the goal's four (`backup-migration-roundtrip`, `send-amount-clamp`) — same class, surfaced here
and in the final report; the fixture-loop fail-soft→fail-hard change is scoped as its own
codex-signed commit; A5's public/private "exercise" = select + `data-fee-method` assert +
reject (a funded execute-flow submit is out of scope; SEND-flow submits already exercise
public/private in fee-methods.test.ts).

## Architecture & Implementation (compact, light tier)

**Stack layout (sequential landing: open PR-N after PR-(N-1) merges; branches stack locally):**

| PR | Content | Labels |
|---|---|---|
| 1 `deflake-r2/observability` | A2: shared `expectPgOk(result, page, label)` in `fixtures/playground.ts` — on status mismatch, throw with BOUNDED (≤2KB, truncation-marked) stringify of the CORRECT branch field (errorJson on error — fixes the delegated-authwit idiom's bug) + `pg-error-text` snapshot; adopt at canary + delegated-authwit sites (subsume the ad-hoc error sentinel where it stays semantically identical). Pure formatter extracted + pinned by a sandbox-free e2e-dir test. PLUS retry-attempt error surfacing: a vitest reporter/hook in the e2e configs that prints each failed attempt's error immediately (permanent fix for Fact 1). | e2e:smoke + e2e:network |
| 2 `deflake-r2/appearance` | A1: (a) repro harness FIRST — appearance file ×N under CPU load/unfocused with PR-1's attempt-error surfacing; confirm the signatures; (b) fix: `polling: 200` on `setTheme` + `navigateByHash` waits (mechanism fix, not a bound raise — bounds unchanged); replace Test B's 150ms sleep + className reads with a `data-toggle-active`-gated wait helper (togglePrivacySetting idiom); (c) re-run harness ×N zero retries. | e2e:smoke |
| 3 `deflake-r2/scan-sweep` | A3: add optional `expectedPrivateRaw` to `waitForFreshBalanceRow` (back-compat); sweep transfers:45, account-switch-isolation:325, receive-unregistered:102 (private-raw proof + keep the exact detail assert), backup-migration-roundtrip:135-158, send-amount-clamp:32; tighten transfers:128-139 detail asserts to digit-boundary/exact; fixture loops fail-soft→fail-hard as a SEPARATE commit (codex-signed). `waitForBalance` retired or narrowed to non-numeric needles. | e2e:network |
| 4 `deflake-r2/cancel-fee` | A5: re-key BOTH helpers' union to `"sponsored"|"public"|"private"`; exercise public+private via execute-flow select + `data-fee-method` assert + reject. A4: testids on `DappCancelledOverlay` (root + OK btn); a cancel driver (preferred: playground cancel action wiring the SDK's cancellationToken; fallback: direct service-client `cancelInteraction` from page context — codex fork); race test: cancel-then-approve asserts overlay visible + designed outcome. Product fork (codex): add `isInteractionCancelled` to `execute-confirm-btn`'s disabled binding (mirrors the reject guard) vs assert the silent no-op as designed. | e2e:network |
| 5 `deflake-r2/close-out` | B6: ledger watch entry updated (this campaign's canary evidence + A2 instrumentation note). B7: written design decision — fail-loud + targeted pins over blanket setup retries (Fact 7), codex-consulted. Ledger per-item status flips, e2e-testing skill lessons, index.md. **Certification (Phase 6 rules) runs on this PR**, then squash-merge + final report. | e2e:smoke + e2e:network |

**Trade-offs:** sequential-landing stack over true simultaneous stacked PRs (squash-merges
orphan stacked heads; retarget churn > pipelining value). Observability lands FIRST so A1's
repro/proof and all later failures are diagnosable. The one deliberate scope-out: funded
execute-flow public/private submits (send-flow submits already cover the fee paths).

## Security & Adversarial Considerations

- The A2 dump prints dApp-visible result/error payloads into CI logs: traced path carries only
  `{message: string}`/tx-hash strings (recon §A2); the helper truncates at a fixed bound and
  never dumps fields outside the PgResult contract — no key/witness/seed material flows through
  the playground result feed (the canary's secret-reveal reads a different channel).
- The A4 cancel driver touches the dapp-interaction surface but adds no privileges: it drives
  the EXISTING cancellationToken contract; the race test asserts the wallet refuses/ignores a
  post-cancel approve (the security-relevant direction).
- All other changes are test/fixture-only; CI gate definitions untouched.

## Phases + validation gates

Order: PR-1 → PR-5 as above. Every phase: `bun run lint` + `bun run typecheck` exit 0 before
commit; per-PR pre-push = affected-file solo runs green attempt-1 (×3 for flake-class fixes) +
`bun run test` when src/ is touched; full ARMED smoke + full SOLO network sweep before PR-3,
PR-4, PR-5 (the tree-wide ones). Each PR: codex iteration loop to approve → dual-lens review
(fixes separate commit) → gates green → squash-merge. Before PR-5's merge: codex post-impl
audit on the stack's NET diff. Any red gate: flake→rerun with root-cause note, real→fix; never
neutralize. Lessons per phase in `lessons/`.

## Decision ledger (seeds — codex audit to attack)

- Observability-first ordering (PR-1 before the A1 fix) — else A1's repro evidence is blind.
- `polling: 200` classified as MECHANISM fix, not bound raise (bounds stay 2s/5s).
- A5 exercise-without-funded-submit; A3 extra-site inclusion; fixture-loop fail-hard as
  separate signed commit; A4 product fork parked for codex.
