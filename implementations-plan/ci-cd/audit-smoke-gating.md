# Audit — smoke gating + branch cleanup

- Bottom line: moving smoke out of `pr-quick` is the right short-term decision. The branch-protection assumption inherited from [pr-network-e2e.yml]((project root)/.github/workflows/pr-network-e2e.yml:3) is sound. The plan is not ready as-written because the `extension-ui` filter is mis-scoped, the local prune path is unsafe, and the remote prune rule "`merged PR` exists => safe" is wrong.

## 1. Gating / required-check semantics

- This part is solid. [pr-network-e2e.yml]((project root)/.github/workflows/pr-network-e2e.yml:54) already uses the correct pattern: always-triggered workflow on PRs to `main` / `dev`, conditional inner job, then a `status` job with `if: always()` and `needs: [changes, decide, network-e2e]` ([pr-network-e2e.yml:88]((project root)/.github/workflows/pr-network-e2e.yml:88)).
- GitHub’s docs are explicit on the key distinction: required checks may be `successful`, `skipped`, or `neutral`, and a job skipped by an `if:` condition reports success; a whole workflow skipped by branch/path filtering stays pending and blocks merge. That means the current `detect -> decide -> skipped inner job -> green status` shape is branch-protection-safe, while a path-filtered top-level workflow would not be.
- So: if branch protection requires `pr-smoke-e2e / status`, the proposed smoke gate is safe provided it mirrors the existing network pattern exactly. Do not require the inner `smoke` job directly.
- One future caveat: if you adopt merge queue later, both workflows will need `merge_group` added or required checks will stop reporting for queued merges.

## 2. `extension-ui` filter scope

- Disagree explicitly: this filter is neither a trustworthy "UI surface" proxy nor a clean performance tradeoff. It is underscoped and slightly overscoped.
- Too narrow: the smoke suite is not just popup paint. It exercises auth, contacts, passkey flows, network settings, account/profile storage, and SW restart behavior. The examples are obvious from the suite names alone: `auth-flows.test.ts`, `contacts.test.ts`, `passkey-paths.test.ts`, `settings-crud.test.ts`, and `sw-restart-network.test.ts`.
- That means regressions in `src/wallet/services/{profile,contact,passkey,config,window-manager,network}/**`, popup storage-key constants, and some `src/core/**` / `src/utils/**` code can break smoke without touching any listed path in the proposed filter ([smoke-gating-and-branch-cleanup.md:41]((project root)/implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md:41)).
- The reusable can also self-build Chrome when no artifact is passed ([_smoke-e2e.yml:56]((project root)/.github/workflows/_smoke-e2e.yml:56)). If the new workflow takes that route, `bun.lockb`, root/package `package.json`, shared setup actions, and build plumbing are part of the smoke surface too. The plan does not include them.
- Too broad: `src/content-script/**` does not look meaningfully exercised by the current smoke suite. That is more plausibly a network / dapp-interaction concern than a smoke concern.
- I also would not accept the behavior-matrix claim that "`network-only` changes => no smoke" ([smoke-gating-and-branch-cleanup.md:80]((project root)/implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md:80)). Smoke already contains non-live network coverage: settings CRUD, endpoint validation, and restart persistence. Network e2e does not perfectly subsume that.

## 3. Label trigger semantics

- Yes: adding `e2e:smoke` after the PR is already open will fire the workflow. GitHub documents `labeled` as a valid `pull_request` activity type, and the workflow trigger shape in the plan is sufficient for that.
- But the omission is the inverse: there is no `unlabeled` trigger. Without it, removing `e2e:smoke` does not recalculate the gate.
- Practical consequence: if someone opts in, smoke fails, and then they remove the label, the stale failing result remains until a new push or manual rerun. `pr-network-e2e.yml` already has this wart. I would not copy it without acknowledging the UX cost.

## 4. Branch-cleanup safety

- Strongest disagreement: step 3 is unsafe as written. "Tip SHA not reachable from `main`, but some merged PR exists, therefore deletion is safe" is false ([smoke-gating-and-branch-cleanup.md:129]((project root)/implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md:129)). It proves the branch name was merged once; it does not prove the current tip is merged.
- After-force-push or post-merge extra commits make that a data-loss path. If the current tip is not reachable from `main`, a historical merged PR should be informational only, not an authorization to auto-delete.
- Safer rule: only auto-delete when the current tip SHA is reachable from `main` / `dev` (whichever long-lived branch is authoritative). If not reachable, stop and require human confirmation, even if a merged PR exists for the same branch name.
- The local prune command is much worse than the remote plan. `git branch ... | xargs git branch -D` ([smoke-gating-and-branch-cleanup.md:146]((project root)/implementations-plan/ci-cd/smoke-gating-and-branch-cleanup.md:146)) bypasses the whole safety model and will happily nuke local-only WIP, archived investigation branches, and easy reflog anchors.
- "After confirmation" is not enough here. If the goal is a safe clean slate, archive before delete: print `<branch> <sha>`, optionally write `refs/archive/stale/...`, and only then prune.
- The "lost GitHub-side draft PR" concern is reasonable in principle, but in the current repo snapshot I only found open PR `#77`. Still, the script should check open PRs by exact head ref before deleting. The branch inventory block in the plan already looks stale relative to local refs, which is one more reason not to bake expectations like "`~10–11` branches" into the execution story.

## 5. Out-of-scope claim

- Deferring the fixture hardening out of this PR is the right call. The root problem is fixture architecture, not workflow wiring, and this PR’s value is CI structure.
- I would not hold `feat/ci-bringup` hostage to a 1–2 hour cleanup digression when the smoke failures are already understood at a high level and the gating workaround is operationally clear.
- But do not over-claim completion: if smoke is still roughly 50% green-on-first-try even after [`retry: 2` and `pool: "forks"`]((project root)/packages/extension/vitest.e2e.config.ts:17), then `pr-smoke-e2e / status` should not become a required check on `main` until the hardening PR lands. Gating it conditionally on `dev` is a workaround; making it required on `main` while still flaky just moves the pain.

## 6. Missing entirely

- The plan never states whether `pr-smoke-e2e` will self-build Chrome or consume a prebuilt artifact. Today [pr-quick.yml]((project root)/.github/workflows/pr-quick.yml:142) runs smoke against the `extension-chrome` artifact from `build-extension`; the proposed new workflow has no corresponding build job.
- [_smoke-e2e.yml]((project root)/.github/workflows/_smoke-e2e.yml:11) can self-build, but that changes runtime, cache needs, and what the check is actually validating. If you self-build, widen the filter to include build/dependency inputs. If you want artifact parity with `pr-quick`, you need to wire that explicitly; the current plan does not.

## Docs checked

- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows