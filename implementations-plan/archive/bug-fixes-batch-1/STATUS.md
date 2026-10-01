# Bug-fixes batch #1 — Status

**Branch**: `feat/bug-fixes-batch-1` → PR into `dev`.
**Predecessor**: `implementations-plan/onboarding-extraction/` (PR #8, merged).

## Outcome

Five user-reported issues landed in one PR as six commits (smallest-risk first, plus one fix-up after the codex implementation review):

| Block | Commit | Surface | LOC |
|---|---|---|---|
| B5 | `c9f663b2` chore(landing): remove footer manifesto + version lines | landing | -7 |
| B4 | `d41bd17e` chore(landing): replace NUL+circle wordmark with plain NULO | landing | -32 |
| B3 | `8a29b92d` chore(brand): align extension icon to landing favicon | extension assets | net 0 (binary swap) |
| B1 | `7e5f6d8f` fix(toast): clear previous timer + surface fee-estimation failures | extension popup | +36 |
| B2 | `44fa9791` feat(networks): header chip routes to Manage Networks; popup deleted | extension popup | -66 |
| — | `defb2ffd` fix(e2e): switchToNetwork returns to /popup/general + use dispatchEvent | tests/e2e | +18 |

## Audit cycle

- **Plan v1** → Codex (xhigh, read-only) + Opus 4.7 (parallel). Both: APPROVE-WITH-FIXES. 11 corrections folded into v2.
- **v2** → Codex final pass. NO-GO on three factual gaps (B1 test surface wrong, B2 Option A premise wrong, B3 step ordering).
- **v2.1** → Codex re-pass. NO-GO on two stale references.
- **v2.1 (revised)** → Codex final pass. APPROVE / GO.
- **Implementation** → Codex review. REJECT on two real e2e flow bugs + two nits.
- **Fix-up** (`defb2ffd`) → Codex re-review. APPROVE / GO.

Two codex-flagged nits were deliberately NOT taken:
1. Commit-subject case complaint: the configured commitlint (`@commitlint/config-conventional`'s `subject-case` rule) does NOT match CLAUDE.md's literal "must be lower-case" wording. All commits passed the commit-msg hook locally.
2. Pre-existing milestone/phase tags in touched e2e files (`helpers.ts:125`, `check-derivation-parity.ts:2`): scope creep — not introduced by this branch.

Both are tracked here for the next batch.

## Gate results

- `bun run typecheck:all` — 9 packages green.
- `bun run audit:vue` — 149 test files / 1696 tests pass; landing build excluded from this gate, run separately.
- `bun run --cwd packages/landing build` — green.
- `bun run test:e2e` — 66/66 pass (6 conditionally skipped, all pre-existing).
- `bun run e2e:agent` — not run locally (requires anvil + aztec sandbox). CI's `Network e2e / Status` covers it.

## User decisions taken

- **Q1** → Option B (row-tap drills into manage detail; "Set as active network" inside the detail page).
- **Q2** → stroke=2 on viewBox=32 (33% thicker than landing favicon).
- **Q3** → "Couldn't estimate fee — retry." (proposed copy accepted).

## Follow-ups (out of scope for this batch)

- Reconcile CLAUDE.md's "Subject line must be lower-case" with the actual commitlint config (or tighten the config to match the doc).
- Sweep pre-existing milestone/phase tags out of e2e fixture comments (`helpers.ts:125`, `check-derivation-parity.ts:2`, similar).
- Consider whether `FeeCostReadout`'s idle copy ("Fee estimated after simulation") should distinguish "never started" from "failed". Deferred — toast is the primary user signal.
