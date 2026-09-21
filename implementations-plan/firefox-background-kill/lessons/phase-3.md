# Phase 3 — Docs, index, lessons

## What shipped

- `apps/extension/tests/e2e/FIREFOX.md`: the background row now states the three facts that shape a kill spec
  on Firefox — no successor until the add-on's next event, the termination is polite and is declined
  silently under an open extension page, `storage.session` survives — and names the four files that remain
  Chrome-only with their reasons. The PXE-host row no longer calls background-only termination a follow-up.
- `.claude/skills/e2e-testing/SKILL.md`: § 3 is "Kill or restart the background", with the Firefox paragraph
  ahead of Chrome's six lines; the trigger words, the Chrome-only count, the liveness rule, the open-popup
  pin and ledger row 1 carry the new helper names and the helper's new home.
- `ARCHITECTURE.md` § 6, `CLAUDE.md` (the Firefox-lanes bullet) and `CI.md` (the Firefox callers) say four
  files, not ten, and why.
- `implementations-plan/index.md`; the previous plan's follow-ups 1–3 point here.

## Follow-ups (recorded, not done)

1. **A dApp call in flight when the background dies is never answered**, on either browser (phase 2's
   table). A product decision — reject pending calls when the new background boots, or leave it to the dApp's
   own timeout — for its own plan.
2. **The canaries on Firefox** (Ask A1): the seam makes it mechanical, the cost is a second real-proving
   canary per PR, and `behavior-gating.test.ts`'s `CHROME_ONLY_CANARY` plus the Firefox canary job's file list
   are workflow-side pins that would move with it.
3. **A crash, as opposed to a polite termination**, is still not reproducible on Firefox: the two Chrome-only
   "kill under an open page" pins (`sw-resilience` case 2, `backup-restore-sw-restart`) would need a way to end
   the extension process itself. Not needed by anything today.

## Gate

| Command | Result |
|---|---|
| `bun run test:ci-gating` | exit 0 |
| `bun run lint:actions` | exit 0 |
| `bun run audit:vue` | exit 0 — typecheck:all, extension tests 542 files passed / 3 skipped (6845 tests), lint, then the build |
