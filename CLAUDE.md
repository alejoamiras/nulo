# CLAUDE.md

Operating rules for AI assistants (and any contributor) working in this repository. This file is the **ruleset**, not the architecture. For architecture, read [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Pointers — read these once before you start

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — process boundaries, message flow, storage versioning, offscreen lifecycle, session model, concurrency, account contract, fee model, test taxonomy.
- `packages/<name>/README.md` — per-package purpose, file map, scripts, testing, key invariants.
- [`packages/extension/tests/e2e/README.md`](./packages/extension/tests/e2e/README.md) — e2e suite layout, parallel-safe agent runner, helper conventions.
- [`implementations-plan/README.md`](./implementations-plan/README.md) — planning archive, when to add to it, the milestone-vocabulary key.

## Working in this repo

- **Bun** is the package manager. No yarn/npm/pnpm. Pinned to `1.3.13` via `package.json#packageManager` + `setup-bun` action.
- **Biome** handles lint + format. Layer-import rules are enforced via `noRestrictedImports` overrides in [`biome.json`](./biome.json); violations fail `bun run lint`.
- **Commitlint** enforces Conventional Commits (`feat:`, `fix:`, `chore:`, …). Subject line must be lower-case.
- **Pre-commit hook** (`.githooks/pre-commit`) runs `biome check --staged` followed by `scripts/check-no-brand.sh` (legacy brand and absolute-path guard). **Commit-msg hook** validates the message. Both auto-install on `bun install` via the `prepare` script.
- **`bun run audit:vue`** is the one-shot pre-PR gate. It runs, in order, `typecheck:all → test → lint → build`. It does NOT run e2e — those are separate (`test:e2e` for smoke, `e2e:agent` for network).
- **`noExplicitAny`** is enforced as an error. Use `unknown` and cast at usage sites. Suppress with `// biome-ignore lint/suspicious/noExplicitAny: <reason>` only at genuinely untyped boundaries.

## Branching + merging

- `dev` is the **default branch** and the integration lane. Feature work happens on short-lived branches off `dev` (named `feat/...`, `fix/...`, `chore/...`, `refactor/...`, `docs/...`, `test/...`, `deps/...`) and lands via **squash-merge** PRs. dev's history stays linear — one commit per merged PR.
- `main` is the **stable branch**. main advances via two PR types — both use a **merge commit** (not squash):
  - `release: promote dev → main` PRs land the next release-candidate set of features.
  - `chore: release @nulo/extension X.Y.Z` PRs are opened by **release-please** after every push to main. Merging one creates the tag + GitHub Release; the release workflow then attaches built artifacts + git-cliff notes + redeploys the landing.
  Read main's own timeline via `git log main --first-parent`.
- **Merge type is enforced per branch via GitHub rulesets**: dev allows only `squash`, main allows only `merge`. The repo-level toggle has both enabled, but the per-branch ruleset narrows what's selectable at PR-merge time.
- Both branches require **signed commits** (SSH or GPG — GitHub's web-flow signature on UI-merges satisfies this) and a passing **`Quality / Status`** required check before merge.
- **Force-pushes and branch deletions are blocked.** Use a feature branch + PR for everything. Admin bypass via the ruleset's pull-request bypass-mode is reserved for catch-22 cases (e.g., a required check whose name was renamed since the PR opened).
- **PR title becomes the squash commit subject on dev.** Write PR titles as real Conventional Commits — `feat(send): ...`, `fix(passkey): ...`, `chore(deps): ...`. The PR body becomes the commit body.
- **Promote PR naming**: `release: promote dev → main` followed by a short content summary in parentheses, e.g. `release: promote dev → main (biome schema bump, lockfile refs migration)`. Becomes the merge commit subject on main — write it like a release note.

## Dependency policy

See [`SECURITY.md`](./SECURITY.md) "Dependency policy" for the full version. TL;DR:

- **`minimumReleaseAge = 604800`** (7 days) in `bunfig.toml` — blocks fresh npm publishes. CVE bypass: edit `bunfig.toml` `minimumReleaseAgeExcludes`, install, follow-up PR removes the exclude.
- **`bun audit`** runs advisory in CI (`_lint-and-typecheck.yml`). Surfaces npm advisories in the step summary; does NOT block PRs today.
- **Bun bug #25305**: `bun update --latest` doesn't apply the gate to transitives. Workaround for bulk re-resolves: delete `bun.lock` first.
- **`@aztec/*` outside the policy** — exact-pinned, bumped manually with the (deferred) class-id + address invariant fixture.
- **Renovate** runs via the Mend hosted App against `renovate.json` at repo root. 7-day age gate (mirrors Bun's), weekly Monday schedule, no auto-merge, Aztec line + `puppeteer` family disabled, `@types/node` capped at `<25`. Config validator runs in CI. The full Renovate policy lives in `SECURITY.md`.
- **Bun-version Renovate PRs need manual sync**: Renovate bumps `package.json#packageManager` but NOT `.github/actions/setup-bun/action.yml`. Existing CI (`_lint-and-typecheck.yml`) won't catch the drift — review the PR's diff for both files.

## Package boundaries

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2 for the layer hierarchy. Short version:

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  aztec-runtime  →  wallet-bridge  →  extension
```

Each package can import only the layers below it. `wallet-bridge` deliberately does NOT depend on `aztec-runtime`. `wallet-core` has `chrome.*` banned via biome `noRestrictedGlobals`.

## Extension component model (L0–L6)

Six layers, low → high. A layer can import only from layers below it. Enforced via `biome.json` `noRestrictedImports` overrides.

```
[L0] design tokens     src/design/tokens.ts
                       Pure typed reflection of CSS vars.

[L1] core primitives   src/components/core/
                       Flex, Icon, MaterialIcon, Text. No chrome.*.

[L2] ui primitives     src/components/ui/
                       Button, Input, Toggle, Tooltip, ...
                       Cannot import service clients, stores, or @/utils/core.

[L3] composites        src/components/composite/
                       FormPopup, EntityForm, SecretRevealCard, AmountCard, ...
                       Same ban as L2 — no service clients, stores, or @/utils/core.

[L4] feature modules   src/popup/components/modules/
                       BalanceView, FeeSettingsCard, TokenCard, ContactRow, ...
                       Service-bound. Cannot import L5 pages or L6 windows.

[L5] popups + windows  src/popup/components/popups/, src/popup/windows/
                       Orchestration. May own service-client lifecycle.

[L6] pages             src/popup/pages/
                       Orchestration. May own service-client lifecycle.
```

Service-bound visual components (Header, AddressDisplay, GlobalLoader, NotificationManager, Popup, PopupCard, JsonViewer, LogsViewer) live flat in `src/components/` or in their own subdir, NOT in `core/`, `ui/`, or `composite/`.

## Composables (C0 / C1)

```
[C0] pure utilities    src/composables/  (no chrome.*, no service clients)
                       useTicker, syncedRef, ...

[C1] service hooks     src/composables/
                       useFormState, useEntityCrud<T>, useFeeEstimation,
                       useDappInteractionPayload, useSecretCountdown, ...
                       Receive a connected client (or "do-the-thing" fn) from the parent.
                       NEVER call .connect() / .disconnect() themselves.
                       Expose dispose() that the parent calls in onBeforeUnmount.
```

**When to extract a composable vs a pure helper:**

- Pure function with no Vue reactivity → `*.ts` helper colocated with the parent.
- Reactive state, computed, watch, or service subscriptions → composable in `src/composables/`.
- Owns a service-client connection? Composable receives the *connected* client; the parent owns connect/disconnect.

## Vue component test conventions

- Colocate `<Name>.test.ts` next to `<Name>.vue`. No `__tests__/` dirs.
- Mount via `@vue/test-utils`'s `mount`; stub auto-registered children (`Spinner`, `Icon`, etc.) via `global.stubs`.
- For store consumers, `createTestingPinia()` from `@pinia/testing`.
- `chrome.*` is stubbed by `tests/vitest.setup.ts:88-113` — no per-test setup needed.

**Coverage minimums:**

- L1 / L2 primitives: ≥5 cases (props, events, slots, edge cases).
- L3 composites: ≥10 cases.
- Composables: ≥10 cases (lifecycle, error paths, dispose).
- L4 / L5 / L6: not required (covered by e2e + manual smoke). Optional for complex pieces.

**Pre-existing bug pinning:** when extracting a function or component, preserve any pre-existing buggy behavior verbatim. Document via a test pin if the bug is behaviorally surprising:

```ts
test("(BUG PIN) replaces only the FIRST underscore in operation kind", () => {
  // humanize.ts has a single .replace("_", " ") which leaves later underscores.
  // Preserved verbatim during the extraction; tracked separately for fix.
  expect(humanize("aztec_get_chain_info")).toBe("aztec get_chain_info")
})
```

Run component tests via `bun run test:components` (filtered to `src/components/`); they also run via `bun run test`.

## testid preservation rule

Every extraction preserves all `data-testid` attributes verbatim. New components inherit testids from the parent template — they are NOT invented during structural moves. e2e selectors depend on exact testid stability.

When adding new interactive elements, add a `data-testid` rather than relying on placeholder, label, or role queries. Querying by placeholder is a common source of e2e flake.

**E2E selector rule (strict):** e2e tests select **only** by `data-testid`. Never by `aria-label`, text content, role, placeholder, class, or DOM structure. If an element doesn't have a testid, add one BEFORE writing the test. Text-based selectors look fine until copy changes, i18n lands, or a Vue refactor reshuffles the tree — then every test that touched the element breaks at once. The `waitForToast` helper is the one explicit exception (toasts are intentionally text-asserted as a content check, not a click target).

## Cleanup order in `onBeforeUnmount`

Do NOT reorder these:

```ts
onBeforeUnmount(() => {
  profileService.disconnect()
  interactionService.disconnect()
  executionService.disconnect()        // ← BEFORE timer clear
  feeEstimation.dispose()              // ← composable's dispose, AFTER service.disconnect()
  for (const t of Object.values(estimateTimers)) clearTimeout(t)
  window.removeEventListener("beforeunload", reject)
})
```

Composables MUST NOT own their own `onUnmounted`. They expose `dispose()` that the parent calls in the existing slot.

## Vue SFC ordering convention

Components follow execution-order-based ordering. Code reads in the order it runs.

**Block order:**

```vue
<route lang="json">        <!-- 1. Route meta (pages only) -->
</route>

<script setup>             <!-- 2. Script -->
</script>

<template>                 <!-- 3. Template -->
</template>

<style module>             <!-- 4. Styles -->
</style>
```

**Inside `<script setup>` — ordered by execution flow:**

```javascript
/** 1. Imports (grouped with comment headers) */
/** Services */
import { TokenServiceClient } from "@/wallet/services/token/client"

/** Components */
import Navigation from "./Navigation.vue"

/** Utils */
import { formatAddress } from "@/utils/string"

/** 2. Macros (compiler-processed first) */
const emit = defineEmits(["update:modelValue"])
const props = defineProps({ ... })
defineExpose({ inputEl })

/** 3. Store instantiation */
const appStore = useAppStore()
const cacheStore = useCacheStore()

/** 4. Composables */
const { openToast } = useToast()
const { handleExternalLink } = useExternalLink()

/** 5. Router/Route */
const route = useRoute()
const router = useRouter()

/** 6. Reactive state (refs, reactive, computed) */
const isLoading = ref(true)
const items = ref([])
const itemCount = computed(() => items.value.length)

/** 7. Service clients + event subscriptions */
const tokenService = new TokenServiceClient()
tokenService.onTokenUpdated.add(onTokenUpdated)
function onTokenUpdated(token) { ... }

/** 8. Functions/Handlers */
const handleClick = () => { ... }
const handleSubmit = async () => { ... }

/** 9. Watchers (watch, watchEffect) */
watch(() => props.modelValue, (val) => { ... })
watchEffect(() => { ... })

/** 10. Lifecycle hooks (in execution order) */
onBeforeMount(async () => { ... })
onMounted(() => { ... })
onBeforeUnmount(() => { ... })
onUnmounted(() => { ... })
```

This order mirrors Vue's execution flow: imports → macros → setup deps → state → external subs → handlers → watchers → lifecycle.

## Common patterns

**Route meta for auth:**

```vue
<route lang="json">
{ "meta": { "isAuthRequired": true } }
</route>
```

**Config service for settings:**

```js
const configService = new ConfigServiceClient()
const value = await configService.getValue("externalLinks")
await configService.setValue("stealthMode", true)
```

**Confirmation dialogs:**

```js
cacheStore.confirm.title = "Confirm Action?"
cacheStore.confirm.description = "Description text"
cacheStore.confirm.confirm_text = "Yes"
cacheStore.confirm.callback = () => { /* action */ }
popupStore.open("confirm")
```

**Toast notifications:**

```js
const { openToast } = useToast()
openToast({ label: "Message", icon: "copy" }, 2_000)
```

**Auto-imports** (vite config) — no explicit imports needed for: Vue APIs (`ref`, `computed`, `watch`, lifecycle hooks), Vue Router (`useRoute`, `useRouter`), composables in `src/composables/`, stores in `src/stores/`, components in `src/components/`.

## Code-comment style

- **Default: no comment.** Identifiers carry intent. If removing a comment wouldn't confuse a future reader, don't write it.
- **Add a comment when removing it would surprise a reader** — a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior dictated by an external spec.
- **Comments explain WHY/INVARIANT, not WHAT.** "Re-derive the passhash here because the session was closed during restore" — yes. "This is the password hash." — no.
- **No milestone, plan, PR, phase, or stage tags.** Not `M4.10`, `A11.1`, `pre-A11`, `phase 4b`, `PR-2`, `Stage D`. The repo's milestone history is in [`implementations-plan/`](./implementations-plan/README.md); inline code talks about live behavior, not history.
  - **Exception** — `AUDIT [A-Z]\d+` markers stay. They mark security-relevant decisions and pair with concrete tests.
  - **Exception** — `phase N` documentation that describes live runtime behavior (`packages/wallet-core/src/base/`, service startup phases) stays. The ban is on milestone vocabulary, not on the word "phase".
- **Live cross-references are OK** only when the target is load-bearing for behavior:
  - `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md`
  - `implementations-plan/network-test-triage/plan.md`
- **TSDoc shape for public APIs** — `/** ... */` block above exports. One-line summary, optional follow-up paragraph. `@param` only when the parameter name doesn't say it. `@returns` only when the return type doesn't say it.
- **Inline comments are full sentences** with terminal punctuation. Soft cap 100 chars; break at sentence boundaries.
- **`// biome-ignore`** in handwritten code must carry a reason: `// biome-ignore lint/X: <reason>`. Suppression without a reason is a lint warning; generated files (e.g. `src/types/auto-imports.d.ts`, `src/types/components.d.ts`) carry bare `// biome-ignore lint: disable` headers — leave those alone.
- **No factual descriptions of what the code does.** Well-named identifiers cover that. Comments describe *why*, *invariants*, or *external constraints*.
- **No referencing the current task, PR, or caller** ("used by X", "added for the Y flow", "handles issue #123"). That belongs in the PR description and rots in the codebase.

## Implementation plans

Plans + audit transcripts under [`implementations-plan/`](./implementations-plan/README.md) are committed artifacts. They get read by future contributors and future Claude sessions that have no idea who you are or where you cloned the repo. A few rules:

- **No personal absolute paths.** Never write home-directory-rooted paths (macOS `~/...` expansions, Linux `~/Projects/...` expansions, Windows user-profile paths) in any plan file, audit transcript, or status doc. Use repo-relative paths (`packages/extension/src/popup/app.vue:164`) — they survive the clone and they don't leak whose machine the plan was written on.
- **No machine-specific paths in general.** Temp-file paths (system scratch dirs, macOS folder containers, Linux tmpdirs) belong in transient terminal output, never in committed planning docs. Quote the conversation context instead ("the codex review transcript saved at this session's CODEX_DIR") or paste the response inline.
- **The same rule applies to file links in audit reports.** When recording a codex / opus audit, rewrite paths to repo-relative before committing — e.g. `[plan.md](implementations-plan/<topic>/plan.md)` rather than an absolute path that includes a username segment.
- **OK to reference outside repos by name when load-bearing.** E.g. "the Rabby reference implementation" or "the aztec-accelerator native app". Don't include the clone path on your machine.

## Quality gates — local and CI

### Locally (before opening a PR)

| When | Command |
|---|---|
| After any code change | `bun run lint` + `bun run typecheck` (or let the pre-commit hook do it). |
| Before opening any UI PR | `bun run audit:vue` (typecheck → unit + component tests → lint → build). |
| When editing the popup, contracts, or anything user-visible | `bun run test:e2e` (smoke; no Aztec sandbox). |
| When touching dApp / network / PXE behavior | `bun run e2e:agent` (network suite; owns anvil + aztec + playground per worktree — parallel-safe). |
| When editing Storybook stories or component visuals | `bun run --cwd packages/extension build-storybook`. |

`audit:vue` excludes e2e tests (`packages/extension/vitest.config.ts:68`). Smoke and network e2e are separate gates.

### In CI (server-side enforcement)

Configured in [`.github/`](./.github/). The full contributor guide is at [`CI.md`](./CI.md); the quick reference is at [`.github/README.md`](./.github/README.md).

- **Every PR**: `Quality / Status` aggregates commitlint, lint, typecheck, units, build. **Required check** on `main` + `dev`.
- **`Smoke e2e / Status`**: runs on PRs to `main` (always), on PRs to `dev` whose diff touches the `smoke-surface` filter, or on PRs labeled `e2e:smoke`. Status emits pass when skipped. Currently advisory; will become required once the smoke fixture-cleanup follow-up PR lands.
- **`Network e2e / Status`**: same shape as smoke, with the `extension-network` filter and `e2e:network` label. **Required check** on `main`.
- **Workflow-level**: actionlint + shellcheck run when workflow YAML or shell scripts change.

### Branches + releases

- `main` — stable. Required checks enforced via branch protection.
- `dev` — day-to-day integration. Required checks enforced.
- Feature branches → PR into `dev`.
- Promote `dev → main` via PR when ready.
- **Releases are driven by release-please** (with a workaround). See [§ Release runbook](#release-runbook) below for the full per-release procedure. Short version: release-please opens a Release PR on every push to `main`; merging the PR is supposed to auto-tag + create the GitHub Release + run the publish chain, but `release-please-action@v4` has an open bug ([googleapis/release-please-action#1205](https://github.com/googleapis/release-please-action/issues/1205) + [googleapis/release-please#2712](https://github.com/googleapis/release-please/issues/2712)) that aborts the auto-publish phase. Until that's fixed upstream, every release needs a 45-second manual unstick + `workflow_dispatch` republish. Human `chore: bump extension to X.Y.Z` commits remain **deprecated**. Config files: `.github/release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`. Workflow: `.github/workflows/release.yml`.

### Release runbook

Per-release procedure for shipping a stable release from `main` (e.g. `0.20.3`). Total time: ~20 min, of which ~45 seconds is manual.

**Prerequisites** (one-time, already done):
- GitHub App `nulo-release-bot` installed on the repo with `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY` repo secrets wired.
- `CLOUDFLARE_PAGES_DEPLOY_HOOK` repo secret set (used by the workflow's `refresh-landing` job).

**Steps:**

1. **Get the work onto `main`.** Promote `dev → main` via the usual `release: promote dev → main (...)` PR. Merge-commit (per `main`'s ruleset).
2. **Wait for the Release PR.** The push to `main` triggers `release.yml`. release-please opens a Release PR titled `chore(main): release X.Y.Z` (version chosen automatically from Conventional Commits since the last tag — `feat:` → minor, `fix:` → patch, `BREAKING CHANGE:` → major). Review the auto-generated `CHANGELOG.md` diff in the PR.
3. **Merge the Release PR via the UI** (merge commit).
4. **Wait for the post-merge `release.yml` run.** It will run release-please-action again. **Expected: it aborts with `⚠ There are untagged, merged release PRs outstanding - aborting` and the downstream gates + publish jobs all skip.** This is the v4 bug.
5. **Manual unstick** (~45 seconds — paste into terminal):
   ```bash
   # Replace VERSION + MERGE_COMMIT + PR_NUM
   VERSION=0.20.3
   MERGE_COMMIT=$(gh pr view <PR_NUM> --json mergeCommit -q '.mergeCommit.oid')
   git fetch origin main
   git tag -a "v$VERSION" "$MERGE_COMMIT" -m "Release $VERSION"
   git push origin "v$VERSION"
   gh pr edit <PR_NUM> --add-label "autorelease: tagged" --remove-label "autorelease: pending"
   gh release create "v$VERSION" --title "v$VERSION" --notes "Filled by publish run." --target main
   ```
6. **Trigger the publish chain via `workflow_dispatch`:**
   ```bash
   gh workflow run release.yml --ref main \
     -f tag="v$VERSION" -f dry_run=false \
     -f run_network_e2e=true -f publish_marketplaces=false
   ```
   This runs `lint+typecheck → unit-tests → network-e2e → build chrome+firefox → smoke-against-artifact → attach-assets` (zips + SHASUMS + git-cliff body overlay). ~15-25 min.
7. **Cloudflare landing redeploy.** The workflow's `refresh-landing` step only fires on the `push:main` path, not on `workflow_dispatch`. Either:
   - Push a no-op commit to `main` (e.g. a CLAUDE.md update) to re-trigger `release.yml` and let `refresh-landing` run, OR
   - Curl the `CLOUDFLARE_PAGES_DEPLOY_HOOK` value directly (the secret is also exposed in the repo's Cloudflare Pages dashboard).
8. **Verify**: `gh release view v$VERSION --json assets -q '[.assets[] | .name]'` should list `nulo-chrome-X.Y.Z.zip`, `nulo-firefox-X.Y.Z.zip`, `SHASUMS256.txt`.

**Why the manual unstick is required (the v4 bug):**

`release-please-action@v4` runs both "open Release PR" and "tag + publish merged Release PR" phases. The publish phase looks for a previously-created GitHub Release that matches the merged PR's manifest entry — when no such release exists yet (because the publish phase is supposed to be the one creating it), it logs `⚠ Expected 1 releases, only found 0` and bails with the "outstanding" error instead of creating the release itself. Both the original action issue ([#1205](https://github.com/googleapis/release-please-action/issues/1205)) and the upstream tool issue ([release-please#2712](https://github.com/googleapis/release-please/issues/2712)) are open with no fix.

**All versions are affected** (verified by source-level inspection):
- `release-please-action@v3.7.13` (bundles release-please 15.13.0): same abort logic in `base.ts` + `manifest.ts`. Also 18 months unmaintained.
- `release-please-action@v4` (bundles release-please 17.3.0): current. Hits the bug.
- `release-please-action@v5.0.0` (bundles release-please 17.6.0): Node 24 runtime bump + minor unrelated fixes. Same abort path. Active issues confirm the deadlock on v5.

Downgrading to v3 also requires renaming our `target-branch:` input back to `default-branch:` — not worth the churn for no actual fix.

The manual unstick (tag + `autorelease: tagged` label + empty GitHub Release) places the repo in the state the action's publish phase *expects* to find. The follow-up `workflow_dispatch` then exercises the publish chain end-to-end via our `always() && needs.X.result == 'success'` guards (which require the explicit tag input to bypass `release-please` entirely).

**Things that DO work without manual intervention:**
- release-please opens correctly-titled Release PRs (after the `group-pull-request-title-pattern` fix in [`release-please-config.json`](.github/release-please-config.json)).
- The Release PR's CI runs normally (App-token triggers the PR-quick workflow → `Quality / Status`).
- The Release PR's commits are bot-verified (App-authenticated → satisfies `main`'s signed-commits rule).
- The `workflow_dispatch` publish chain runs all gates + builds + smoke + attach-assets end-to-end.

## What this file is NOT

- Not the architecture overview — see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- Not the per-package surface — see each `packages/<name>/README.md`.
- Not the e2e infrastructure doc — see [`packages/extension/tests/e2e/README.md`](./packages/extension/tests/e2e/README.md).
- Not the planning archive — see [`implementations-plan/README.md`](./implementations-plan/README.md).
