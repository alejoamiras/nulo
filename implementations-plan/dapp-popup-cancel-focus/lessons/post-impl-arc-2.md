# Post-implementation codex loop — arc 2

## Arc gate (before the loop), 2026-09-05
- `bun run typecheck:all` → exit 0 (all 14 workspaces).
- `bun run lint` → exit 0.
- `bun run test`: two full runs at vitest's default worker count reported 1–2 failures, ALL of them
  30 s timeouts in `profile/service.integration.test.ts` (a different test each time), plus 5–7
  "Failed to start forks worker … Timeout waiting for worker to respond" — i.e. files that never
  ran. Load average on the shared machine was 12–13 during both runs (other sessions + the terminal
  rendering); the same tests pass alone in about a second. Re-run with
  `bun run --cwd apps/extension test --maxWorkers=3` → **437 files, 5467 tests, exit 0, 77 s**.
- `bun run build` (chrome) → `✓ built in 2.28s`, exit 0.

Lesson: on this shared machine the default fork count starves PBKDF2-heavy integration tests and
even worker start-up. `--maxWorkers=3` is the reliable form of the same gate; the earlier parallel
`audit:vue` failure in arc 1 was the same phenomenon.

## Codex loop
Session `01a07379-5b97-7262-935b-ef00f6fe94d2` (GPT-6 Astra, `high`, read-only) over
`git diff worktree-dapp-popup-cancel-focus...HEAD -- apps packages` with plan.md, recon.md, the arc-1 loop
log, the arc map, the adversarial ask and the no-over-engineering + comment-quality rules.

### Round 1 — `findings` (one Medium, two Low; no correctness bug)
1. **[Medium] Nested interactive controls.** The card's wrapper carried `role="button"` + `tabindex`
   while containing the focusable Cancel `<button>` — a W3C ACT violation (button roles may not have
   focusable descendants). Adopted, as codex proposed: the card has NO ARIA role; the whole-card click
   stays as a pointer convenience; a dedicated sibling `<button aria-label="Show the approval window"
   data-testid="tx-awaiting-focus">` (icon `expand`) in the actions slot is the accessible control,
   rendered only at `queued`. The wrapper's keydown handler is gone (a native button handles
   Enter/Space). Tests: both click paths emit `focus` once each; no `[role="button"]`; the two buttons
   are siblings (neither contains the other); Cancel's click emits only `cancel`; inert past `queued`.
2. **[Low] Two failure branches unpinned.** The timeout-during-lookup manager test now installs an
   impostor handle under the same id before releasing the lookup and asserts no `create` and the
   impostor untouched (identity, not membership). The focus-RPC denial test is parameterized over
   "another profile active" and "wallet locked" (`getActiveProfile → undefined`).
3. **[Low] Comment trimming.** The card's event-wiring narration cut to two sentences (why no ARIA
   role); the handler comment reduced to "Focus is best-effort: queued requests may have no popup, and
   RPC failures stay silent." Bonus from "looks fine": the `centerOn` positive case uses odd dimensions
   to cover rounding.

Codex confirmed: `openAndAwait` still returns synchronously with both fences; a contract-violating
rejected lookup rejects the request (never falls back to creation); centering is signed and rounds;
`focus` options match the Chrome API; only execution interactions carry `queuedJournalId` and their
payload has the validated session's `profileId`; the RPC is target-scoped, no caller binding; no
layout regression from the wrapper; both journal sites wired and the client disconnected.

Gotcha while fixing: an HTML comment placed before the root `<div>` inside `<template>` makes the SFC a
two-root fragment, so `@vue/test-utils`' `wrapper.attributes()` / `wrapper.trigger()` no longer address
the div. Notes about the template go in the script docblock.

Re-validation: `src/components/composite/activity src/popup/components/modules/general
src/wallet/services/dapp-interaction src/wallet/services/window-manager` → 16 files, 244 tests, exit
0; extension typecheck 0 errors (after annotating the `test.each` fixture — TS7024 on an `as const`
tuple of async fns); biome clean on the touched files.
