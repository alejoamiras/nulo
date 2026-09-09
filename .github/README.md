# `.github/` — CI configuration

This directory holds the GitHub Actions wiring. The contributor-facing guide lives at [`../CI.md`](../CI.md); the original plan + audits live in [`../implementations-plan/ci-cd/`](../implementations-plan/ci-cd/).

## Status check matrix

These `status` aggregators are what branch protection on `main` / `dev` requires. Branch protection matches the **produced check-run name**, which for a normal GitHub Actions job is its bare `name:` — there is no `Workflow / Status` form (that only exists for reusable `uses:` jobs). The old required contexts `Quality / Status` etc. were hand-typed phantoms that never matched a produced check, hanging every required gate `Expected` and forcing `--admin` on every merge; the aggregators were renamed to unique bare names and the required contexts re-pointed (2026-06-24 — see [`CI.md`](../CI.md#branch-protection) + [`../implementations-plan/required-check-mismatch/`](../implementations-plan/required-check-mismatch/)).

| Workflow | Required check-run | Required on | Runs when | What it checks |
|---|---|---|---|---|
| `pr-quick.yml` | `quality-status` | dev + main | every PR to `main` / `dev` | commitlint, lint, typecheck, units, chrome+firefox build |
| `pr-extension-smoke-e2e.yml` | `extension-smoke-e2e-status` | dev + main (after each branch's cut-over; legacy `smoke-e2e-status` until then) | PR to `main`, OR `e2e:extension-smoke` label, OR `smoke-surface` paths-filter | chrome build + puppeteer smoke (18 files, 67 tests, 7 quarantined) |
| `pr-extension-network-e2e.yml` | `extension-network-e2e-status` | dev + main (after each branch's cut-over; legacy `network-e2e-status` until then) | PR to `main`, OR `e2e:extension-network` label, OR `extension-network` paths-filter | full network e2e (anvil + Aztec sandbox + playground) |
| `bridge-contracts.yml` | `bridge-contracts-status` (not required yet) | — | when `contracts/bridge/**`, `packages/bridge-core/**` or the workflow change | forge hermetic + halmos + keystone nargo + hub artifact parity + sole-consumer guard + the sandbox integration suite (`integration`) + the hub's TXE tests (`txe`) |
| `pr-tools-e2e.yml` | `tools-e2e-status` (not required yet) | — | when the tools graph, the bridge contracts or `packages/bridge-core/**` change, OR the `e2e:tools` label | the tools browser suite (Playwright, embedded wallet-sdk test wallet, injected L1 wallet) in 4 shards, one sandbox each |
| `actionlint.yml` | `Status` (not required) | — | when `.github/workflows/**` or shell scripts change | actionlint + shellcheck |
| `release.yml` | `status` (not required) | — | manual `workflow_dispatch` only | full quality bar + build + smoke against artifact + (optional) tag + GitHub Release |
| `nightly.yml` | `status` (not required) | — | schedule (03:23 UTC daily) + manual dispatch | full quality bar incl. network suite → prerelease GitHub Release from dev (`v<ver>-nightly.<YYDDD>`) |

Each required check-run is `app_id`-pinned to GitHub Actions in `required_status_checks.checks`, so only a check produced by Actions (not a same-named check from another app) can satisfy the gate.

## Reusable workflows + composite actions

Reusables live as `.github/workflows/_*.yml` and are called from top-level workflows. Each is parameterized (`ref`, etc.) and has at least two callers.

| Reusable | Callers |
|---|---|
| `_lint-and-typecheck.yml` | `pr-quick`, `release`, `nightly` |
| `_unit-tests.yml` | `pr-quick`, `release`, `nightly` |
| `_build-extension.yml` | `pr-quick`, `release`, `nightly` |
| `_extension-smoke-e2e.yml` | `pr-extension-smoke-e2e`, `release`, `nightly` |
| `_extension-network-e2e.yml` | `pr-extension-network-e2e`, `release` (stable channel only), `nightly` |

Composite actions live in `.github/actions/` and are shared step fragments used inside jobs.

| Composite | Purpose |
|---|---|
| `setup-bun` | checkout + bun + install cache + `bun install --frozen-lockfile` |
| `setup-aztec` | Foundry + Aztec CLI matching the `@aztec/aztec.js` version |
| `setup-puppeteer` | warm `~/.cache/puppeteer` |
| `setup-accelerator-server` | download + SHA-256 verify + install the headless `accelerator-server` binary (Linux x86_64) for CI proving. Used by `_extension-network-e2e.yml`. See [CI.md](../CI.md#accelerator-in-ci). |

## Triggers cheat-sheet

- Push a commit on a feature branch → no CI runs; local pre-commit hook handles biome + commitlint.
- Open a PR to `dev` → `pr-quick` runs. `pr-extension-smoke-e2e` and `pr-extension-network-e2e` run only if their paths-filter trips OR their respective label is on the PR.
- Open a PR to `main` → `pr-quick`, `pr-extension-smoke-e2e`, `pr-extension-network-e2e` all run unconditionally.
- Add `e2e:extension-smoke` or `e2e:extension-network` to an open PR → that workflow fires a fresh run immediately (`labeled` is a subscribed event type; no push needed). Removing the label re-evaluates the gate (`unlabeled`).
- Click "Run workflow" on `release.yml` → manual release (must supply `version` + `channel`).
- Every night at 03:23 UTC → `nightly.yml` builds current dev and publishes a prerelease GitHub Release (skips itself when dev HEAD already has tonight's nightly; manual dispatch offers `force` + `dry_run`).

## Labels

| Label | Effect |
|---|---|
| `e2e:extension-smoke` | Force the smoke e2e suite to run on this PR (auto-runs when `smoke-surface` filter trips). |
| `e2e:extension-network` | Force the network e2e suite to run on this PR (auto-runs when `extension-network` filter trips). |

## Branches

Only `main` (stable) and `dev` (integration) are long-lived. Feature branches are auto-deleted on merge (`gh repo edit --delete-branch-on-merge`). See [`CI.md`](../CI.md) for the branch model + release flow.
