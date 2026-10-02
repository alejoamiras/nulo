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

## What shipped

- **`setup-geckodriver`** on the `setup-presto-server` template. geckodriver 0.37.1's tarball does hold exactly one regular member named `geckodriver`, so the single-member check carried over unchanged. One deliberate difference: the three pins (version, tarball SHA-256, binary SHA-256) live **in the action**, not in its callers — both reusable e2e workflows install it, and a bump that reached one and not the other would be silent. Mozilla ships a detached `.asc` rather than a checksum sidecar; the lanes do not verify it, so the pins are the integrity check. The action exports `GECKODRIVER`, which the driver already reads.
- **`setup-puppeteer`**: `inputs.browser`, Chrome's cache step untouched under `if: inputs.browser == 'chrome'`. Firefox gets its own cache of `~/.cache/puppeteer/firefox`, keyed `…-firefox-for-puppeteer-<bun.lock hash>` with **no** restore prefix — Chrome restores by the prefix `<os>-puppeteer-`, so a Firefox key beginning that way could be restored into, or evict, a required lane's cache. Firefox itself is whatever the locked Puppeteer pins (`stable_153.0.4` under 25.8.0): `bun x puppeteer browsers install firefox` from `apps/extension` resolves that revision, not "latest".
- **The two reusable workflows** take `browser` (default `chrome`), export it as `NULO_E2E_BROWSER`, validate it before anything is paid for, build `build:${BROWSER}`, grep `dist/${BROWSER}`, and name their log artifacts per browser. The value reaches `run:` blocks through `env`, never by interpolation.
- **`pr-extension-{smoke,network}-e2e-firefox.yml`** were generated from the Chrome callers and then had the copied commentary stripped. Distinct `name:` **and** concurrency prefix (the trap above), own filenames plus `setup-geckodriver/**` in the filters, `pull-requests: read` on `changes` alone, the canary without `frozen-account-canary`. **Drafts skip**: the draft test is the gate's first branch (`if … elif …`) rather than an early `exit`, because `decide-gate.test.ts` lifts the gate's `if … fi` block out of the YAML and executes it — an `exit 0` above the block would have been invisible to the one test that runs the real script.
- **`nightly.yml`** gains four `network-e2e*-firefox` jobs and `smoke-firefox-against-artifact`; **`release.yml`** gains `smoke-firefox-against-artifact`. None is in any `needs`. A red advisory job still turns the run red while `status` stays green, which the docs now say.
- **Artifact mode on Firefox.** The release and nightly smokes run the production bundle, where the Chrome driver blackholes the price host with `--host-resolver-rules`. Firefox has no such flag; the driver passes a `data:` PAC through the W3C `proxy` capability that sends only `api.coingecko.com` to a dead port. First exercised for real by the nightly — it is on the post-merge checklist for that reason.

## What pins it

`behavior-gating.test.ts`: each Firefox filter equals its Chrome twin's, re-pointed at its own file, plus geckodriver; every Firefox suite job has the Chrome job's `uses`, `exclude_files`, `retry`, and `test_files` minus the Chrome-only canary; the PR lanes hold no write scope; **no job in `nightly.yml` or `release.yml` waits on a job whose `with.browser` is `firefox`** (structural, so it cannot false-positive on `build-firefox` the way a name match would); the two required aggregators' `needs` are pinned by exact equality; the shared `browser` input defaults to `chrome`; the Firefox cache key does not start with Chrome's restore prefix. `decide-gate.test.ts` runs both Firefox gates through the existing table and adds the draft case.

## Gate

`bun run lint:actions` exit 0; `bun run test:ci-gating` exit 0 (127 passed, 2 skipped). No workflow was dispatched from the branch.

## Arc 6 boundary — codex fix loop (GPT-6 Astra, `high`) — converged in two rounds

- **Round 1 → no required-check regression, six findings, all verified and taken.** (1) [Medium] "Blocks no release" was too strong: `release.yml` has one `release` concurrency group with `cancel-in-progress: false`, so the advisory Firefox smoke holds the slot until it ends — it cannot fail this publish, it can delay the next. Not restructured (a separate workflow is new surface); the comments and docs now say exactly that. (2) [Medium] The PR lanes add fifteen jobs (nine suites, six control) that queue against the required lanes for the same runners; separate concurrency groups stop cancellation, not contention. Unmeasurable from here — documented, and on the owner's hand-off list next to the account's run-start throttle history. (3) [Medium] **The parity test could pass with four shards gone**: it compared files, retry and browser, so a Firefox matrix cut to `1/5` stayed green. It now compares each suite job's whole `with` against `{...chrome, browser: "firefox"}` and `uses`/`strategy`/`needs`/`if`/`secrets` by equality, and pins the gate's `env.DRAFT` binding (the draft tests feed a synthetic `DRAFT`, so deleting the binding left them green). (4) [Low] The probe scan ran under `always()` with the unvalidated `browser` in a path; it now requires the validation step's success. (5) [Low] `FIREFOX.md` omitted that smoke does not build, and artifact mode's PAC. (6) [Low] The cache comment claimed separate prefixes prevent eviction; they prevent cross-restore only — the quota is shared.
- **Round 2 → "No new material findings. The fixes introduce no identified required-check regression. Confidence: high for the static review; workflow execution remains unverified."** One [Low] wording point taken: a job timeout bounds execution, not time queued for a runner, so the release-slot delay is not capped at 20 minutes.

Commits: `3f3c20f2` and the wording follow-up.

