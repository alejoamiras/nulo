# Phase 7 — advisory CI lanes

Recon done ahead of implementation, by parallel readers over `.github/**` plus a critic pass. Everything below was re-read at `file:line` before being written down; the two places the readers were wrong are called out as such.

## The trap that would have taken down a required gate

`concurrency.group` in `pr-extension-smoke-e2e.yml` is `pr-extension-smoke-e2e-${{ github.workflow }}-${{ github.head_ref || github.ref }}`, with `cancel-in-progress: true`. **`github.workflow` is the workflow's `name:` field, not its filename.** So the group has two parts a copied file must change: the literal prefix and the `name:`. Leave both stale — the obvious outcome of copying the file as a starting point — and the Firefox lane shares a cancellation group with the **required** Chrome lane, and cancels it.

(A reader first reported this as an unconditional collision. It is not: the literal prefix already distinguishes the two files today. It is still the sharpest edge in the phase, because the prefix is exactly what a copy-paste leaves behind.)

## Facts that change the plan's shape

- **`_extension-network-e2e.yml` has four callers, not three.** `pr-extension-network-e2e.yml`, `nightly.yml`, `release.yml` — and `extension-network-e2e-soak.yml:83`, which no reader had on its list. The soak passes no `browser`, so the new input's `default: chrome` is load-bearing for it too.
- **`_build-extension.yml` already loops both dists** (`for d in apps/extension/dist/chrome apps/extension/dist/firefox`), so the release negative-grep needs no Firefox work.
- **A new workflow file is not inert.** `pr-quick.yml`'s `workflows` filter matches `.github/workflows/**`, which sets `needs-extension-build` and `needs-tools-build`, so arc 6's own PR runs `build-chrome` and `build-tools` inside the **required** `quality-status`. `needs-firefox-build` stays false — it omits `WORKFLOWS` deliberately.
- **`actionlint.yml` carries `branches: [main, dev]`**, so it does not fire on a stacked PR targeting a parent feature branch.
- **The repo is public**, so runner minutes are free and 21 workflow files trips no documented cap. The real constraint is the account-wide run-start throttle: two more PR workflows mean more job starts per PR.

## Two ways to red the required gate while "only touching Firefox"

1. **A `/firefox/i` denylist in `behavior-gating.test.ts`.** `pr-quick.yml:348` legitimately lists `build-firefox` in `quality-status.needs` — the Chrome-side build of the Firefox zip. A blanket name match reds the required check on day one. The assertion has to be an **exact-equality pin on each required aggregator's `needs`**, not a pattern.
2. **Namespacing `setup-puppeteer`'s existing cache key.** Editing the Chrome key or its restore prefix in place cold-misses every required lane. The Chrome step stays byte-identical under `if: inputs.browser == 'chrome'`; Firefox gets its own step. An unguarded Firefox install also adds a download to every Chrome run.

`behavior-gating.test.ts` must land in the **same commit** as the new YAML — it reads the workflow files, so a split commit throws ENOENT.

## Where the advisory jobs attach

- `nightly.yml`: outside both `publish-nightly.needs` and `status.needs`.
- `release.yml`: never in `attach-assets.needs` — note the wildcard guard at `release.yml:262`.
- Neither Firefox lane may produce a check-run named `quality-status`, `extension-smoke-e2e-status` or `extension-network-e2e-status`.

## Where the names are written down outside `.github/`

Executable: `scripts/ci-cd/behavior-gating.test.ts`, `decide-gate.test.ts`, `required-checks.ts`, `required-checks.test.ts`. Prose: `CLAUDE.md`, `CI.md`, `.github/README.md`, `SECURITY.md`, `apps/extension/tests/e2e/README.md`, and the `e2e-testing` + `aztec-update` skills. Phase 8 owns the prose.

## Ordered by risk to the Chrome gates

1. `behavior-gating.test.ts` — runs inside the required check; exact-equality pin, same commit as the YAML.
2. `setup-puppeteer/action.yml` — `inputs.browser`, Chrome step untouched under an `if:`.
3. `_extension-smoke-e2e.yml` — input, env, `build:${{ inputs.browser }}`, `dist/${{ inputs.browser }}`, browser-suffixed log name. Do not disturb the `NULO_E2E_ARTIFACT_RUN` lines; flipping them disarms the migration fixture on the required lane.
4. `_extension-network-e2e.yml` — input and env only. Restructuring the `VITE_NULO_PRESTO_REQUIRED` block would disable Chrome's Presto hard-fail.
5. The two new `pr-extension-*-e2e-firefox.yml` — distinct `name:` **and** concurrency prefix, self-referencing path filters, own aggregator names.
6. New `.github/actions/setup-geckodriver/` on the `setup-presto-server` template. Its single-member tar assertion is copied from a Presto tarball; geckodriver's member count is unverified from here and may need a different check.
7. `nightly.yml`, `release.yml`, docs.

## Noted, not taken

`_extension-network-e2e.yml` has a probe grep around lines 286/289 that a reader called vacuous. Unrelated to Firefox; out of scope for this plan rather than fixed in passing.
