# Phase 1 — Record the toast keep-separate decision (docs only)

**Status:** ✓ DONE.

## What shipped
The settled verdict — **faucet + extension toasts stay SEPARATE, not unified** — recorded across the
active future-work pointers:
- `design-system-externalization-round-2/WRAP-UP.md` — "Round-3 backlog (deferred)" → "Round 3 …
  Toast: KEEP SEPARATE", with the model/context reasoning.
- `design-system-externalization/round-2-backlog.md` — header "still deferred to round 3 … toast
  unification" → "round 3 DECIDED toast stays SEPARATE"; + the `ToastManager` held-back note ("region
  unification declined in round 3").
- `design-system-externalization-round-2/plan.md` — "Round-3 debt … toast unification" → "DECLINED —
  kept separate".
- `implementations-plan/index.md` — added the round-3 entry (toast kept separate + the other 3 items).

## Decision (the why, for future readers)
Faucet `useToast` is a 4-deep QUEUE (`{id, kind, text, link?}`, `push`/`dismiss`, per-entry TTL);
the package/extension `useToast` is a SINGLE-transient singleton (`{label, icon, color}`, `openToast`
replaces). Different STATE MODELS driven by different host contexts (full web viewport with multi-step
async + explorer links vs a ~360px popup showing one quick confirmation). The faucet ALREADY reuses the
package's presentational `Toast.vue` card (codex), so unification wouldn't even save the visual — only
the queue state + region layout differ, and those are exactly the context-driven bits worth keeping
separate. Unifying would bloat the popup or regress the faucet's queue+links. Net negative → cut it.

## Intentionally left as-is
`design-system-externalization-round-2/brief.md` + `plan.md:30` (lock-4 "defer toast") are FROZEN
round-2 point-in-time artifacts — they accurately record what round 2 decided then. The round-3
resolution lives in the round-3 plan + the 4 active pointers above; rewriting historical briefs to
reflect later decisions is the doc-rot the repo's planning discipline avoids.

## Validation gate — PASS
`bun run lint` → EXIT 0 (52 pre-existing warnings). Docs-only; no app code touched; no-brand guard
runs in pre-commit; edits use repo-relative paths (no broken intra-repo links).

LESSONS_FILE=implementations-plan/design-system-externalization-round-3/lessons/phase-1.md
