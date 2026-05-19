# Auditor brief — CI/CD bring-up plan for `alejoamiras/nulo`

You are reviewing a proposed CI/CD plan for a multi-package Bun monorepo that ships a Chrome + Firefox MV3 browser extension wallet. The plan lives at `implementations-plan/ci-cd/plan.md` in this repository. Read it in full before forming opinions.

## Context the plan author already knows (do not re-research)

- Bun is the package manager (no yarn/npm/pnpm). Lockfile is `bun.lockb`.
- Biome handles lint + format. Layer-import rules enforced via `noRestrictedImports` per package.
- Commitlint enforces Conventional Commits (`feat:`, `fix:`, etc., lower-case subjects).
- 8 workspace packages: `wallet-core`, `wallet-crypto`, `extension-messaging`, `aztec-runtime`, `wallet-bridge`, `extension`, `playground`, `landing`. Only `@nulo/extension` is shippable; the others are internal at version `0.1.0`.
- Layer hierarchy: `wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`. `wallet-bridge` deliberately does **not** depend on `aztec-runtime`.
- Vitest configs in `packages/extension/`:
  - `vitest.config.ts` — unit + component
  - `vitest.e2e.config.ts` — smoke (no Aztec sandbox)
  - `vitest.e2e.network.config.ts` — network (anvil + aztec sandbox + playground)
  - `vitest.e2e.all.config.ts` — both
- Network e2e is driven by `packages/extension/scripts/e2e/agent.sh` which allocates fresh ports, builds the wallet with `VITE_LOCAL_NETWORK_RPC_URL` stamped in, and runs the network suite. The agent is the parallel-safe path; sandbox processes are tracked via a lockfile at `.e2e-state/`.
- Network suite currently **46/66 passing**. 18 known failures are bucketed into 5 root-cause clusters in `implementations-plan/network-test-triage/plan.md`. The known-failure cluster is **not** an infra regression and is being separately triaged.
- Repo is **private + GitHub Free**. Branch protection rules and rulesets are **not available** until the repo goes public or upgrades to Pro. Plan author has flagged this as Open Question #1.
- Reference CI lives at `(aztec-accelerator source tree)/.github/`. The plan author already mined this for patterns (paths-filter, status aggregator, reusable workflows, composite actions, release workflow with auto-updater, dependabot config).
- Extension version is currently `0.14.9`. It's bumped today via manual `chore: bump extension to X.Y.Z` commits. Plan replaces this with `release.yml`.

## What we need from you

Read `implementations-plan/ci-cd/plan.md`. Then return a structured review covering:

1. **Showstoppers** — anything in the plan that would actually break in CI (wrong API field, missing step, race condition, security hole). Concrete pointer + fix.
2. **Sequencing risk** — phases that should be reordered or split. Justify in terms of revert-blast-radius.
3. **Missing gates** — checks the plan omits that you would expect for a wallet-grade extension (e.g., SBOM, CSP regression detection, license check, manifest version monotonicity check). Recommend at most 3; rank by ROI.
4. **Over-engineering** — anything we could cut without losing safety. Specifically check the matrix size, the number of reusable workflows, and the release flow's complexity.
5. **`pull_request_target` security** — review §3.2's use of `pull_request_target` for label-triggered network e2e. Is the gating logic safe against the "evil PR adds a malicious workflow that runs with secrets" attack? If not, propose the fix.
6. **Network e2e baseline handling** — the plan keeps the network suite `continue-on-error: true` until known failures drop to ≤6. Is this the right exit criterion? Alternatives?
7. **Changelogen choice** — the plan picked `changelogen` over `git-cliff`, `changesets`, `release-please`, `semantic-release`. Argue against the choice if you'd pick differently for this specific shape (single shippable artifact, Conventional Commits, manual workflow_dispatch release).
8. **Release post-bump strategy** — the plan does **not** open an automatic post-release "bump source" PR (unlike the accelerator reference). Argue for or against that choice.
9. **Open Question recommendations** — for each of the 8 open questions in §11, give your one-sentence recommendation.

## Style

- Be specific. Point at files + line numbers wherever possible.
- Disagree explicitly when you disagree. We want strong opinions.
- Keep the response under ~1500 words. Bullet-dense, no filler.
- If the plan is fine in some section, say "OK" — don't pad.
- Do not implement anything. Audit only.
