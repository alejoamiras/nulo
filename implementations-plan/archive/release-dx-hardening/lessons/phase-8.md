# Phase 8 — Teachable cold-readable runbook (DOC PRIORITY)

The user's explicit ask ("I was not able to understand much; the next agent should read from there and learn"). Consolidation + cold-read pass, not a from-scratch write — phases 1–7 each updated their own doc section as they landed.

## What changed (CLAUDE.md § Release runbook)
Restructured from "manual procedure with automation bolted on as callouts" → **happy-path-first, cold-readable**:
- **NEW "#### Start here"** front matter: a plain-language "what a release is", a **division-of-labor table** (what / who / current state — flags the one ⚠️ manual step: the flag-OFF unstick), the **6-step end-to-end happy path** (state-aware: step 3 branches on `AUTO_UNSTICK_ENABLED`), and the **one-time flip** payoff ("after the flip a release is steps 1, 2, 5 only").
- **NEW "#### Troubleshooting — when X fails"** table: 9 symptom→cause→fix rows (skipped chain, auto-unstick red/no-op, missing assets, verify-live red, faucet chainId error, sync conflict, no sync PR, reopened old Release PR).
- **NEW "#### Staged-rollout switches"** table: `AUTO_UNSTICK_ENABLED` + `verify-live`-in-`status`, each with default / flip-when / how — the "ship inert, observe one release, promote" rule in one place.
- The detailed Stable / Prerelease / After-a-cut sections are kept verbatim as the **reference + fallback**, now explicitly framed as such.
- Promoted the bold pseudo-header "Why the manual unstick is required" → a real `####` so the happy-path anchor link resolves.

## Cross-phase doc-drift caught by the cold-read (the point of the pass)
§ Stable step 2 still read "`BREAKING CHANGE:` → major" — but Phase 2 set `bump-minor-pre-major: true`, which caps a breaking change to a **minor** bump (`0.23` → `0.24`, never auto-`1.0.0`) while in 0.x. Fixed to say so + note `1.0.0` is a deliberate manual `Release-As:`. (Phase 2 updated the config + its own notes but missed this CLAUDE.md line — exactly the drift Phase 8 exists to catch.)

## CI.md
Already accurate from the incremental phase-5/6/7 updates (the `push:main` flow paragraph now lists auto-unstick, deploys, verify-live, and the sync job). The teachable *runbook* deliverable is CLAUDE.md; CI.md stays the pipeline *reference*. No further edit needed.

## Test-repo teardown
N/A — the fallback path never created a test repo (the human gate to create it was never granted; built on the branch instead).

## Gate — cold-read self-containment check: PASS
A fresh reader can execute a stable release from the "Start here" section alone — the 6-step happy path is self-contained, names every artifact, and points one click down to the exact paste-commands for the (currently manual) unstick. `bun run lint:actions` green; brand/path guard clean; all four new/promoted anchors present.

## Next (the closing gauntlet, per the plan + loop)
All phases ✓ → `/code-review max --fix` → codex post-impl audit → `/harden security` → wrap-up.
