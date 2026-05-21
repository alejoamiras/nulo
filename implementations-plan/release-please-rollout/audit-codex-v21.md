# Re-review — release-please rollout v2.1

## Verdict
APPROVE-WITH-FIXES

## Resolution of v2 NO-GO items
- Release PR CI (GITHUB_TOKEN chaining): fixed. Using `actions/create-github-app-token@v1` for `release-please-action` is the right mechanism to make Release PRs trigger normal `pull_request` CI.
- resolve safety on manual republish: unfixed. The in-step validation is better, but `resolve.if` still skips the job entirely when `workflow_dispatch` is run with an empty `tag`, so it does not fail loudly.
- environment: production restoration: fixed.
- CLAUDE.md staleness: fixed.
- component-no-space: fixed.
- dry_run restoration: fixed in intent, but the workflow snippet still says “header unchanged from v2,” so the actual `workflow_dispatch.inputs.dry_run` addition must be explicit in implementation.

## New issues (if any)
1. `workflow_dispatch` with empty `tag` still no-ops green. Because `resolve` is gated by `github.event.inputs.tag != ''`, the job never runs, downstream jobs skip, and `status` can still pass. Move the empty-tag validation to a job that always runs on `workflow_dispatch`, or broaden `resolve.if` to run on all `workflow_dispatch` events and fail inside the script.
2. The plan’s wording says App commits are “auto-signed (web-flow).” The important claim is App-authenticated bot verification, not web-flow signing. That is a wording bug, not an architecture blocker.
3. `dry_run` is described as restored, but the shown workflow excerpt does not actually show the input block being added. Make that explicit in the final YAML.

## Implementation greenlight
no-go + items:
- Fix the `resolve.if` logic so empty `workflow_dispatch.tag` fails loudly.
- Add `workflow_dispatch.inputs.dry_run` explicitly in the workflow header.
- Tighten the signing wording to “App-authenticated bot-verified commits,” not “web-flow.”

Sources: [release-please-action README](https://github.com/googleapis/release-please-action), [GitHub workflow triggering docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow), [GitHub commit signature verification docs](https://docs.github.com/github/authenticating-to-github/managing-commit-signature-verification/about-commit-signature-verification).