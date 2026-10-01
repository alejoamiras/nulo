# Plan — gate smoke e2e behind a label + clean up stale remote branches

## Why

Two unrelated tasks, bundled because they share a goal: get the repo to a clean, predictable baseline before we declare CI done.

1. **Smoke e2e is too flaky for the always-on lane.** Despite four targeted skips + `retry: 2` + vitest `pool: forks` isolation, local runs are ~50% green-on-first-try. The underlying issue is cross-file Chrome cleanup (orphan processes from file N inheriting into file N+1) — a real fixture-level bug, not something cosmetic. Hardening the fixture is its own engineering investigation (~1–2 h) and shouldn't block CI bring-up. The pragmatic move is to take smoke out of `pr-quick`'s always-on path and gate it the same way we gate `pr-network-e2e` — automatic on main-targeted PRs, automatic on PRs touching UI surface, manual via a label otherwise.
2. **Remote has many stale branches** from past milestones (`brutalist-redesign/*`, `m2.1-d/*`, `m6/phase-*`, `e2e/network-playground/pr-*`, half a dozen `fix/*` and `feat/*` from merged work). Now that `main` + `dev` are the only long-lived branches, prune everything else for clarity. Anyone reviewing PR lists or branch dropdowns sees only the meaningful ones.

## 1. Smoke gating

### Design (mirrors `pr-network-e2e.yml`) **[R-Codex]**

New workflow `.github/workflows/pr-smoke-e2e.yml`:

```
on:
  workflow_dispatch:
  pull_request:
    branches: [main, dev]
    types: [opened, reopened, synchronize, labeled, unlabeled]  # [R-Codex#4]

jobs:
  changes:         # paths-filter for "smoke-touching surface" (R-Codex#2, broader than original UI)
  decide:          # gate on base/label/filter/dispatch
  build:           # builds extension-chrome artifact (R-Codex#6 — smoke needs it)
  smoke:           # uses ./.github/workflows/_smoke-e2e.yml with artifact_name: extension-chrome-smoke
  status:          # aggregator (includes decide.result to avoid the actionlint-style hole)
```

The `unlabeled` trigger is also added to `pr-network-e2e.yml` in the same diff so both workflows behave consistently (today, removing `e2e:network` leaves stale failing checks).

Gating logic (same shape as `pr-network-e2e.yml`):

```
needs: changes
if: >
  github.event_name == 'workflow_dispatch'
  || github.base_ref == 'main'
  || contains(github.event.pull_request.labels.*.name, 'e2e:smoke')
  || (github.base_ref == 'dev' && needs.changes.outputs['smoke-surface'] == 'true')
```

`smoke-surface` paths-filter **[R-Codex#2]** — corrected after the audit caught the original `extension-ui` was wrongly scoped. Smoke exercises auth, contacts, passkey paths, settings CRUD, SW restart, endpoints — not just popup paint. Includes services smoke actually touches + root config + build inputs (the workflow can self-build via the reusable):

```yaml
smoke-surface:
  # Popup + components (UI shell)
  - 'packages/extension/src/popup/**'
  - 'packages/extension/src/components/**'
  - 'packages/extension/src/composables/**'
  - 'packages/extension/src/stores/**'
  - 'packages/extension/src/design/**'
  - 'packages/extension/src/assets/styles/**'
  - 'packages/extension/manifest/**'
  # Wallet services that smoke exercises (auth/profile/contact/passkey/config/window-manager/network metadata)
  - 'packages/extension/src/wallet/services/profile/**'
  - 'packages/extension/src/wallet/services/contact/**'
  - 'packages/extension/src/wallet/services/passkey/**'
  - 'packages/extension/src/wallet/services/account/**'
  - 'packages/extension/src/wallet/services/account-state/**'
  - 'packages/extension/src/wallet/services/config/**'
  - 'packages/extension/src/wallet/services/window-manager/**'
  - 'packages/extension/src/wallet/services/network/**'
  - 'packages/extension/src/wallet/services/token/**'
  - 'packages/extension/src/wallet/services/token-balance/**'
  - 'packages/extension/src/wallet/services/dapp-session/**'
  - 'packages/extension/src/wallet/storage/**'
  - 'packages/extension/src/wallet/config/**'
  - 'packages/extension/src/wallet/index.ts'
  # Cross-cutting helpers the popup + services share
  - 'packages/extension/src/setup/**'
  - 'packages/extension/src/core/**'
  - 'packages/extension/src/utils/**'
  - 'packages/extension/src/shims/**'
  - 'packages/extension/src/types/**'
  # wallet-core / wallet-crypto / extension-messaging — all are used at the storage/auth boundary
  - 'packages/wallet-core/**'
  - 'packages/wallet-crypto/**'
  - 'packages/extension-messaging/**'
  - '!packages/{wallet-core,wallet-crypto,extension-messaging}/**/*.md'
  # Build inputs (smoke self-builds via the reusable when no artifact is passed)
  - 'packages/extension/vite.chrome.config.mts'
  - 'packages/extension/vite.firefox.config.mts'
  - 'packages/extension/package.json'
  - 'packages/extension/scripts/check-rp-id.ts'
  - 'package.json'
  - 'bun.lockb'
  - 'tsconfig.json'
  # Smoke harness itself
  - 'packages/extension/tests/e2e/*.test.ts'
  - '!packages/extension/tests/e2e/network/**'
  - 'packages/extension/tests/e2e/fixtures/**'
  - 'packages/extension/tests/e2e/global-setup-smoke.ts'
  - 'packages/extension/vitest.e2e.config.ts'
  # Workflow + reusable + composite actions that affect smoke
  - '.github/workflows/_smoke-e2e.yml'
  - '.github/workflows/_build-extension.yml'
  - '.github/workflows/pr-smoke-e2e.yml'
  - '.github/actions/setup-bun/**'
  - '.github/actions/setup-puppeteer/**'
```

Explicitly excluded: `src/content-script/**` (network/dApp concern, not smoke), `src/offscreen/**` (PXE/runtime), `src/wallet/services/{execution,fpc,dapp-interaction,interaction,task,note,passkey-credential,…}` (network e2e covers those).

### Changes to `pr-quick.yml`

- Drop the `smoke-e2e` job entirely.
- Drop `smoke-e2e` from the `status` aggregator's `needs:` list.
- Keep `build-extension` (release flow + ad-hoc dependency on the chrome-artifact output).

### New label

`gh label create "e2e:smoke" --color "BFD4F2" --description "Force-run smoke e2e on a dev-targeted PR"`. Naming is symmetric with `e2e:network`. The existing `skip:smoke-e2e` label drops from the plan (irrelevant in the new model — you opt *in*, not out).

### Behavior matrix after the change **[R-Codex#2 — corrected]**

| PR target | Touched files | Default smoke behavior | Label override |
|---|---|---|---|
| `dev` | docs only | does **not** run | add `e2e:smoke` to force |
| `dev` | anything in the `smoke-surface` filter (UI shell, popup-exercised services, wallet-core/crypto/messaging, build inputs, harness) | runs automatically | label not needed |
| `dev` | only `execution` / `fpc` / `dapp-interaction` / `offscreen` / `content-script` (network-e2e-only surfaces) | does **not** run | add `e2e:smoke` if you want to double-check |
| `main` (any PR) | any | always runs | n/a |
| `workflow_dispatch` | n/a | runs | n/a |

Note: smoke is **not** a strict subset of network e2e's coverage. Smoke covers settings CRUD, endpoint validation, SW restart persistence, auth flows — none of which are owned by network e2e. So the "only network-touching" case is genuinely no-smoke-needed; everything else (the vast majority of UI-affecting PRs) should run smoke.

### Documentation updates

- `implementations-plan/ci-cd/plan.md` §3.1 + §3.2: update the wiring description.
- `.github/README.md`: refresh the status-check matrix + the labels table.
- `.github/PULL_REQUEST_TEMPLATE.md`: update the smoke-e2e checklist line.

### Status-check renaming consequence **[R-Codex#5]**

Now `pr-quick / status` no longer transitively requires smoke. `pr-smoke-e2e / status` joins `pr-network-e2e / status` as a *conditional* check that always reports (skipped-via-`if` still completes successfully under GitHub's required-check rules).

For branch protection (Phase 5 of the bring-up plan):
- Required on `main`: `pr-quick / status`, `pr-network-e2e / status`. **`pr-smoke-e2e / status` is NOT yet required** — codex correctly flagged that requiring a still-flaky check on `main` just shifts the pain. Add it to the required list once the fixture-cleanup follow-up PR ships and smoke is reliably green over a 10-run sample.
- Required on `dev`: `pr-quick / status` only. Smoke + network remain advisory on `dev` regardless.

`pr-network-e2e` and `pr-smoke-e2e` running conditionally on `dev` means a status check that "didn't trigger" reports as **no-context-found**, not as a green check. GitHub's required-checks rule treats not-yet-reported as blocking. The same trick that works for `pr-network-e2e` works here: the workflow always runs at least the `detect → status` skeleton, which always emits a green `status` check even when the `smoke` job inside skipped.

This is already the shape of `pr-network-e2e.yml` (decided + skipped path emits status: pass). Mirror it 1:1.

## 2. Branch cleanup

### Current state (remote)

```
origin/brutalist-redesign/post-rebrand
origin/chore/e2e/parallel-agent-isolation
origin/docs/improvement-pass
origin/e2e/passkey-coverage/pr-1
origin/feat/backup-creating-status
origin/feat/passkey-modal-export-import
origin/fix/backup-import-handoff
origin/fix/button-loading-spinner-color
origin/fix/fee-estimation-init-race
origin/fix/network-test-flakes
origin/m2.1-d/session-manager
origin/feat/ci-bringup    ← KEEP (this PR)
origin/main               ← KEEP
origin/dev                ← KEEP
```

Plus local-only branches that don't exist on origin anymore (`brutalist-redesign/post-rebrand.pre-merge-20260424`, `e2e/network-playground/pr-*` x3, `m6/phase-*` x2) — those should also be pruned locally.

### Safety check before deletion **[R-Codex#4 — corrected]**

Codex caught the original "merged PR exists → safe" rule was wrong: force-pushes and post-merge commits can leave the current tip unreachable even when the branch *name* was merged at some past point. Corrected rules:

For each remote branch *other than* `main`, `dev`, `feat/ci-bringup`:

1. **AUTO-DELETE** when the tip SHA is reachable from `origin/main` OR `origin/dev` (`git merge-base --is-ancestor <sha> origin/<branch>`). Reachable means the work is incorporated; deletion is lossless.
2. **REPORT + SKIP** in every other case, regardless of historical PR state. A merged PR for the same branch name is *informational* only — it doesn't authorize deletion. Alejo eyeballs the list and decides per-branch.
3. **Also report** any branch that is the head ref of an open PR (`gh pr list --state open --head <branch>`). These get manual decisions even if they'd otherwise qualify under (1).

Implementation: a bash script at `scripts/ci-cd/prune-stale-branches.sh` with three modes:

- `prune-stale-branches.sh` (default, dry-run): prints every branch + its category (`AUTO-DELETE`, `SKIP-UNREACHABLE`, `SKIP-OPEN-PR`).
- `prune-stale-branches.sh --execute`: deletes the `AUTO-DELETE` set. Never deletes the others.
- `prune-stale-branches.sh --force <branch>`: explicit one-off override for a specific branch Alejo confirmed manually.

### Execution

```bash
# Dry-run shows what would be deleted
bash scripts/ci-cd/prune-stale-branches.sh

# Actually delete the auto-safe set (after Alejo confirms)
bash scripts/ci-cd/prune-stale-branches.sh --execute

# Manual override for a specific branch Alejo confirmed
bash scripts/ci-cd/prune-stale-branches.sh --force feat/some-merged-by-rebase
```

**Local pruning [R-Codex#4]**: instead of the unsafe `xargs git branch -D` from the original draft, the script does **archive-before-delete**:

1. For each local-only branch that isn't `main` / `dev` / `feat/ci-bringup`, write `refs/archive/local-stale/<branch>` → tip SHA.
2. Print the archive ref so Alejo can recover with `git checkout refs/archive/local-stale/<branch>` if needed later.
3. *Then* delete the branch.

Archive refs are local-only (not pushed) and easy to garbage-collect later (`git update-ref -d refs/archive/local-stale/...`) once Alejo is sure nothing was lost.

### Documentation

Add a one-liner to `.github/README.md`: "Branches: only `main` (stable) and `dev` (integration) are long-lived. Feature branches are deleted on merge."

Also consider: enabling **GitHub auto-delete head branches on merge**. `gh repo edit alejoamiras/nulo --delete-branch-on-merge`. This stops new clutter from re-accumulating.

## 3. Validation plan

For the smoke gating:

1. Land the changes on `feat/ci-bringup` itself.
2. Confirm `pr-smoke-e2e` triggers on this PR (because it touches `tests/e2e/*.test.ts` — that's in `extension-ui`).
3. Confirm `pr-quick` no longer runs smoke (just lint+typecheck+units+build).
4. Open a follow-up docs-only PR to `dev` after merge. Confirm `pr-smoke-e2e / status` reports green without actually running smoke (the skipped path).
5. Add `e2e:smoke` label to that docs PR. Confirm `pr-smoke-e2e` now runs the suite.

For branch cleanup:

1. Dry-run produces a list of ~10–11 branches to delete + their merged/unmerged status.
2. Alejo eyeballs the list, confirms (or hand-edits exceptions).
3. Execute. Verify with `git branch -a`.

## 4. Files added / changed **[R-Codex]**

```
.github/workflows/pr-smoke-e2e.yml         (new — mirrors pr-network-e2e.yml; includes build job for artifact parity, R-Codex#6)
.github/workflows/pr-network-e2e.yml       (edit — add `unlabeled` to pull_request types, R-Codex#4)
.github/workflows/pr-quick.yml             (edit — drop smoke job + drop from status aggregator)
.github/README.md                          (edit — refresh matrix + labels table; add branches note)
.github/PULL_REQUEST_TEMPLATE.md           (edit — adjust smoke-e2e checklist)
implementations-plan/ci-cd/plan.md         (edit — §3.1, §3.2, §13 file list)
implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md  (this plan)
implementations-plan/ci-cd/audit-smoke-gating.md  (codex's audit response — appended)
scripts/ci-cd/prune-stale-branches.sh      (new — archive-before-delete, tip-reachable safety rule)
```

GitHub-side:

- New label `e2e:smoke`.
- Drop unused label `skip:smoke-e2e`.
- `gh repo edit --delete-branch-on-merge` (one-time).

## 5. Out of scope

- The actual fixture-cleanup fix for smoke flakes (the "proper" fix described in the conversation). Tracked separately; will be a follow-up PR once this PR lands.
- Touching the `_smoke-e2e.yml` reusable workflow itself — its inputs/outputs don't change, only its callers do.
- Network e2e gating — unchanged.

## 6. Open questions for Alejo

1. **Smoke gate on `dev` PRs**: is "auto-trigger when UI surface changes + label override" the right default? Alternative: smoke never auto-triggers on `dev` (label-only). My read: auto-trigger is right — most UI-affecting PRs deserve a smoke check, and the label is for the edge cases.
2. **`extension-ui` filter scope**: I included `tests/e2e/fixtures/**` because changes to fixtures can affect smoke behavior, but those changes also affect network e2e, so there's some overlap. Acceptable, or want it narrower?
3. **Existing branches to keep besides main/dev/feat/ci-bringup**: any I should not delete? (Default: only those three.)
