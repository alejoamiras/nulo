# /harden security — focused pass on the release tooling

Gauntlet step 3. Scoped to the branch's release tooling (not a whole-repo sweep — that's an interactive `/harden`). Lead item was codex post-impl Should-fix 3 (token least-privilege).

## Token least-privilege (release.yml) — FIXED
- **Top-level `permissions:` dropped from `contents/pull-requests/issues: write` → `contents: read`.** Previously EVERY job without its own block (resolve, the reusable lint/test/build/smoke/network-e2e callers, refresh-landing, deploy-faucet, verify-live, status, publish-*) inherited a write-capable `GITHUB_TOKEN`. They only need read (checkout; artifact + cache ops require no `permissions:` scope). A compromised build/test step can no longer write to the repo with the ambient token.
- **Write escalated explicitly on the four jobs that write:** release-please (`contents+pull-requests+issues: write` — its documented set; uses the App token regardless), auto-unstick (`contents+pull-requests: write`), attach-assets (`contents: write`), sync (`contents+pull-requests: write`).
- **Reversed the `/code-review`-round `issues: write` addition.** That was over-cautious: GitHub's `pull-requests: write` scope explicitly covers labels + comments + merges on PRs, and auto-unstick/sync operate on PRs (not standalone issues). So `issues: write` was unnecessary — removed from both. (Net of the two gauntlet rounds: the label ops are correctly covered by `pull-requests: write` alone.)

## Adversarial sweep (the rest) — no change needed
- **Injection**: the `*-run.ts` CLI shell-outs use Bun's `$` (auto-escapes interpolations); gh/git args are safe. No `eval`, no string-built shell.
- **Trigger abuse**: auto-unstick fires only on a merged `autorelease: pending` Release PR at `github.sha` (base main) — an attacker can't add that label without write access. sync is push-only + sha-pinned. Neither is reachable via PR comments/forks.
- **Secrets**: deploy hooks + the App key are `secrets.*` (never hardcoded/logged); the auto-unstick/sync tokens come from `secrets.GITHUB_TOKEN` / the App token. No secret is echoed.
- **Supply chain**: no new runtime deps; the scripts use only Bun + gh/git already present. The faucet build reads its own `package.json` + git sha (build-time, local).
- **CSP**: Phase 3 removed the faucet/playground inline node-polyfill `<script>` — strictly fewer inline scripts (a CSP improvement, not a regression).

## Caveat (staged-validated, like the rest)
`release.yml` doesn't run on the feature-branch PR, so the tightened permissions are not exercised in PR CI. If a job turns out to need a scope I pruned, the first real release surfaces it (job fails loud) and the fix is a one-line per-job grant. Consistent with this effort's ship-then-observe posture. `contents: read` is the standard release-workflow floor, so the risk is low.

## Gate
`bun run lint:actions` → exit 0; `scripts/release/` 85 pass / 0 fail (unchanged — no logic touched, only YAML permissions).
