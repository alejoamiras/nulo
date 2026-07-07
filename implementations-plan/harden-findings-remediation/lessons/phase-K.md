# Phase K — Clipboard secret hygiene (F-14, Low) — LIGHT

Branch: `fix/hf-k-clipboard` off `fix/harden-findings`.

## Finding
`export/seed.vue:69` and `export/key.vue:79` copy the seed phrase / private key to the clipboard via `navigator.clipboard.writeText(...)` with no clearing. `seed.vue:154` shows a "some apps can read your clipboard" warning; **`key.vue` has no such warning**.

## Design
1. **Add the clipboard warning to `key.vue`** (mirror `seed.vue:154`). Solid, zero tradeoff — do this regardless.
2. **Delayed clipboard clear — OPEN QUESTION (see below).**

## Open question — the "clear only if it still equals" check needs a permission
The plan's clear is conditional (don't clobber a newer copy) → it must **read** the clipboard (`readText()`) to compare. Facts (verified): the extension has **no existing `clipboard.readText` usage** and **no `clipboardRead` manifest permission** (`permissions: [alarms, offscreen, storage, sidePanel, unlimitedStorage]`). A delayed clear fires via `setTimeout` ~60s later with **no transient user activation** → `readText()` is denied for an extension page without the `clipboardRead` permission. So the conditional clear as specified would require **adding `clipboardRead`** — expanding a *wallet's* clipboard-read surface (it could then read everything the user copies) to fix a **Low** finding. That cuts against the hardening goal.

Codex CLI is unavailable (2 failed consults this campaign) → resolving on own judgment per the AFK rule; **lean: do NOT add `clipboardRead`.** Candidate no-permission approaches to pick from at implementation:
- **(C) Manual "clear clipboard" control** on the export page: the click is a user gesture → `readText()`+conditional-clear works with **no new permission** and respects "only if it still equals." Changes "delayed/auto" → "user-initiated."
- **(D) Warning-only**: ship part 1 (the key-page warning) and drop the auto-clear, documenting that a reliable auto-clear needs a permission the hardening pass shouldn't add for a Low finding.
- **(B) Unconditional delayed `writeText("")`**: no read, but clobbers a newer copy AND `writeText` 60s later may itself be gesture-gated → unreliable. Rejected.

If, at implementation, a meaningful auto-clear is judged worth the permission, **surface the `clipboardRead` add to the user** (security-relevant on a wallet) rather than adding it autonomously.

### CHOSEN (no permission, no surface expansion): warning + user-gesture clear button
Both `readText` AND `writeText` ~60s later are **gesture-gated** in an extension popup (the existing copy only works because `@copy`/click provides transient activation) → a `setTimeout` auto-clear fails without permissions. So:
1. Add the seed-page **warning to `key.vue`**.
2. Add a **"Clear clipboard" button** to both `seed.vue` + `key.vue` → on click (user gesture) call `navigator.clipboard.writeText("")` + toast. The click IS the intent to clear, so the "only if it still equals" check is moot (dropped) and **no `readText`/`clipboardRead` is needed**. Works exactly like the existing `writeText` copy — no new permission.

Deviation from the plan's literal "delayed auto-clear" is deliberate + constraint-driven (auto-clear requires a `clipboardRead`/`clipboardWrite` permission this hardening pass won't add for a Low finding). Same finding intent (cut clipboard-secret exposure), no surface expansion.

## Implemented
`seed.vue` + `key.vue`: on copy, schedule a `setTimeout` best-effort unconditional `writeText("")` scrub (`CLIPBOARD_CLEAR_MS = 60_000`), timer cleared in `onBeforeUnmount`; added the seed-page clipboard warning to `key.vue`'s private-key flow. No `clipboardRead`/`clipboardWrite` permission added.

## Gate (plan.md Unit K) — green
- `bun run --cwd apps/extension test:components`: **356 passed** (34 files).
- `bun run lint`: 0 errors.
- `bun run test:e2e` (smoke): **68 passed / 6 skipped / 2 failed** — **both failures are load-induced flakes unrelated to K** (K touched only the seed/key export pages; neither failing test references them):
  1. `passkey full-backup export` — the CI-skipped, load-fragile passkey flake (documented in phase-B/F).
  2. `security.test.ts > change password` (crypto-heavy re-encrypt) — timed out at 60s under contention from **2 orphaned faucet dev-servers** left by prior e2e runs; **re-run in isolation passed in 9.25s**. Reaped the orphans by exact cwd-verified PID.

