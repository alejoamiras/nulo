# Phase 4 — Throwaway-repo rehearsal (done for real, after the fact)

Originally skipped via the fallback (no human gate to create the repo while AFK). The user later asked for it explicitly: *"There is zero chance this works as soon as merged. I'm sure we will find multiple bugs."* They were right.

## Setup
Throwaway `alejoamiras/nulo-release-rehearsal` (private, since deleted/optional). **Orchestration-focused**: a faithful transform of `release.yml` — `release-please` / `auto-unstick` / `resolve` / `attach-assets` / `sync-main-to-dev` / `status` kept verbatim (same `needs`/`if`/`outputs`/`env`), the heavy jobs (lint/test/build/smoke/deploys/verify) stubbed to `echo + exit 0` with their `needs`/`if` preserved so the **DAG + skip-propagation are real**. App token → `GITHUB_TOKEN`; `./.github/actions/setup-bun` → `oven-sh/setup-bun@v2`; "Allow Actions to create PRs" enabled.

## Findings

### Bug #1 — REAL (fixed + ported to PR #149 as a4780a5f)
`gh pr edit --add-label "autorelease: tagged"` **fails** (`'autorelease: tagged' not found`) if the label isn't already defined in the repo. On a repo that has never completed a release the label doesn't exist (the v4 abort means release-please never created it). On the rehearsal's fresh repo the tag got pushed, then the relabel crashed → **no release, chain skipped, release stuck**. Prod survives only by luck (the label exists from past manual unsticks) — fragile. Same latent failure in `sync`'s conflict path (`needs-manual-resolution`). **Fix:** `gh label create <label> --force` (idempotent) before the add, in both `relabelPr` (auto-unstick) and `flagConflict` (sync). This is exactly the class of bug unit tests can't catch (it lives in the un-mocked CLI I/O boundary) — the whole reason the rehearsal mattered.

### Bug #2 + #3 — harness artifacts (NOT product bugs)
- The stubbed `attach-assets` I wrote dropped `actions/checkout`, so `gh release upload` ran outside a git repo. The **real** `attach-assets` checks out (release.yml:275) — fixed the stub only.
- A `git commit --amend` during setup left the throwaway's `dev` pointing at the pre-amend root, so `dev`/`main` had no common history and `gh pr create` refused. The real repo's `dev`/`main` share extensive history (main is promoted from dev). Recreated `dev` at main's root — fixed the harness only.

## Validated end-to-end (all green after the fix)
| Scenario | Result |
|---|---|
| Flag OFF (staged default) | auto-unstick runs but no-ops; whole chain skips; `status` passes — "today's behavior" |
| Flag ON, full path | auto-unstick → tag + release + relabel → resolve → chain → attach (3 assets) → deploys → verify-live → **sync opens a MERGEABLE main→dev PR** |
| Sync CONFLICT | sync **job** succeeds (exit 0); **PR** is `CONFLICTING` + `needs-manual-resolution` label (auto-created by the fix) — surfaced, never silent, never auto-merged |
| `workflow_dispatch` republish (v0.4.0) | `release-please`/`auto-unstick` skip, `resolve`/`attach` run, **`sync-main-to-dev` SKIPS** — codex Critical-1 (no re-sync on republish) holds |
| `status` aggregator | passes on the success paths; a CONFLICTING sync does NOT fail it (sync is advisory) |

## Takeaway
The "near-one-click" claim is now empirically true **for the orchestration** — but it required the rehearsal to get there: the missing-label crash would have stuck the very first real flag-on release. The staged rollout (flag OFF first) would have masked it until the flip; the rehearsal surfaced it before any of that. Worth every minute.

## Caveats still standing
The rehearsal stubbed the real build/e2e/deploys (those pass in this repo's own CI) and used `GITHUB_TOKEN` (the real repo uses the GitHub App). So the App-token signing/CI-cascade behavior + the tightened permissions on the *real* reusable workflows are still first-exercised on the first real release. Lower risk now, but not zero.
