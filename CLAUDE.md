# CLAUDE.md

Operating rules for AI assistants (and any contributor) working in this repository. This file is the **ruleset**, not the architecture. For architecture, read [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Pointers — read these once before you start

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — process boundaries, message flow, storage versioning, offscreen lifecycle, session model, concurrency, account contract, fee model, test taxonomy.
- `packages/<name>/README.md` — per-package purpose, file map, scripts, testing, key invariants.
- [`apps/extension/tests/e2e/README.md`](./apps/extension/tests/e2e/README.md) — e2e suite layout, parallel-safe agent runner, helper conventions.
- [`apps/extension/tests/COMPOSITION-TESTS.md`](./apps/extension/tests/COMPOSITION-TESTS.md) — **normative** rules for the `*.composition.test.ts` layer (drive the real service graph in-process against dumb fakes): when to use it, the hard limits (shallow PXE **and** bb-free **and** no simulate/prove), the failure taxonomy. Read before adding a composition test.
- [`implementations-plan/README.md`](./implementations-plan/README.md) — planning archive, when to add to it, the milestone-vocabulary key.

## Working in this repo

- **Bun** is the package manager. No yarn/npm/pnpm. Pinned to `1.3.14` via `package.json#packageManager` + `setup-bun` action.
- **Biome** handles lint + format. Layer-import rules are enforced via `noRestrictedImports` overrides in [`biome.json`](./biome.json); violations fail `bun run lint`.
- **Commitlint** enforces Conventional Commits (`feat:`, `fix:`, `chore:`, …). Subject line must be lower-case.
- **Pre-commit hook** (`.githooks/pre-commit`) runs `biome check --staged` followed by `scripts/check-no-brand.sh` (legacy brand and absolute-path guard). **Commit-msg hook** validates the message. Both auto-install on `bun install` via the `prepare` script.
- **`bun run audit:vue`** is the one-shot pre-PR gate. It runs, in order, `typecheck:all → test → lint → build`. It does NOT run e2e — those are separate (`test:e2e` for smoke, `e2e:agent` for network).
- **`noExplicitAny`** is enforced as an error. Use `unknown` and cast at usage sites. Suppress with `// biome-ignore lint/suspicious/noExplicitAny: <reason>` only at genuinely untyped boundaries.

## Branching + merging

- `dev` is the **default branch** and the integration lane. Feature work happens on short-lived branches off `dev` (named `feat/...`, `fix/...`, `chore/...`, `refactor/...`, `docs/...`, `test/...`, `deps/...`) and lands via **squash-merge** PRs — dev's history stays essentially linear, one commit per merged feature PR. **The one exception is the post-release `chore: sync main → dev` PR, which is MERGE-committed** (not squashed) so `main`'s release commit stays in `dev`'s ancestry — the prerelease version-anchor needs it. So `dev` carries a periodic sync merge commit; everything else is a squash.
- `main` is the **stable branch**. main advances via two PR types — both use a **merge commit** (not squash):
  - `release: promote dev → main` PRs land the next release-candidate set of features.
  - `chore: release @nulo/extension X.Y.Z` PRs are opened by **release-please** after every push to main. Merging one creates the tag + GitHub Release; the release workflow then attaches built artifacts + git-cliff notes + redeploys the landing.
  Read main's own timeline via `git log main --first-parent`.
- **Merge type is enforced per branch via GitHub rulesets**: dev allows `squash` **and** `merge` (merge is reserved for the post-release sync PR — see above; feature PRs still squash by convention + the merge-button default), main allows only `merge`. The repo-level toggle has both enabled, and the per-branch ruleset narrows what's selectable at PR-merge time. (dev's `merge` was added for the prerelease-fix: a squash-only ruleset HARD-blocks the history-preserving sync — not bypassable by `--admin` or a bypass actor; see `implementations-plan/release-prerelease-fix/`.)
- Both branches require **signed commits** (SSH or GPG — the merge's squash commit is GitHub web-flow-signed, CLI or UI). **Both `dev` and `main` require all three status gates — `quality-status`, `network-e2e-status`, and `smoke-e2e-status`** (the *produced* check-run names — a GitHub Actions normal job's check-run is named its bare job `name:`, with no `Workflow /` prefix). Verified against the live `required_status_checks.checks`, each app_id-pinned to GitHub Actions. Smoke is **required** on both, not advisory.
- **Branch-up-to-date is NOT required on `dev`** (legacy branch protection's `strict` flag is off; `main` keeps `strict: true`). A new dev commit does not invalidate your PR's green CI, so you don't need to re-run the 25-min Network e2e every time someone else merges. The required checks only have to be green on your PR's own commits.
- **Force-pushes and branch deletions are blocked.** Use a feature branch + PR for everything.
- **Why `--admin` used to be needed on *every* PR (fixed 2026-06-24):** branch protection required the contexts `Quality / Status` / `Network e2e / Status` / `Smoke e2e / Status`, but the workflows produce **bare** check-run names (`quality-status`, …) — the `Workflow /` prefix only appears for reusable `uses:` jobs, so `Quality / Status` was a hand-typed phantom that could never match. The required gates hung `Expected — Waiting for status to be reported` forever → `mergeStateStatus=BLOCKED` → every merge forced `--admin`. The fix renamed the three aggregator jobs to unique bare names and re-pointed `required_status_checks.checks` to them (`implementations-plan/required-check-mismatch/`). **Two gates exist, and they're independent:** the status checks above, AND `required_signatures`. For a **self-authored** squash GitHub signs the squash on your behalf, so signatures don't independently block (verified: a self-authored signed PR now merges with a plain `gh pr merge --squash`, no `--admin`). Keep your branch commits signed anyway (a dropped SSH agent → unsigned → can still block non-author merges). `--admin` (and the raw `PUT .../merge` API) bypass **both** gates — emergency/admin-only, never a routine path. When you genuinely must bypass: `gh pr merge <n> --squash --admin --delete-branch` (the squash still lands `verified=true`).
- **PR title becomes the squash commit subject on dev.** Write PR titles as real Conventional Commits — `feat(send): ...`, `fix(passkey): ...`, `chore(deps): ...`. The PR body becomes the commit body.
- **PR-title length: keep the title ≤ ~93 chars.** On squash-merge GitHub appends ` (#NN)` to the subject, and `commitlint`'s `header-max-length` (100) is enforced in `Quality / Status` and is **NOT** skipped on `dev`/`dev-quality` promotes (only on PRs to `main`). A 94-char title becomes a 101-char commit subject → red commitlint that you can't fix without rewriting history (force-push, blocked on protected branches). So budget for the `(#NN)` suffix: `len(title) + len(" (#NN)") ≤ 100`. The same applies to any direct commit on a long-running branch (e.g. `dev-quality`) that a promote PR later re-lints over its whole range — keep every subject ≤ 100. Fixing an already-merged over-length subject means amending + force-pushing the arc branch, which is only an option on non-protected branches.
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

### Custom RPC schema patch (`registerToken`)

`registerToken` is added to `@aztec/wallet-sdk`'s `WalletSchema` at runtime via three identical inline files: `apps/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`, `apps/faucet/src/lib/nulo-schema-patch.ts`, `apps/playground/src/lib/nulo-schema-patch.ts`. Each is **side-effect only** (no exports) and is imported as the first import in the module that constructs the wallet-sdk client. Drift between the three copies is pinned by [`packages/wallet-bridge/src/dispatcher.test.ts`](./packages/wallet-bridge/src/dispatcher.test.ts) (reachability test imports the extension's copy and asserts shape). When adding a new Nulo-custom RPC, update all three copies AND add a paired reachability assertion. See [`packages/wallet-bridge/README.md`](./packages/wallet-bridge/README.md) "Custom RPC methods" for the full contract.

## Extension component model (L0–L6)

Six layers, low → high. A layer can import only from layers below it. Enforced via `biome.json` `noRestrictedImports` overrides.

**L0–L2 are externalized to `@nulo/design`** (round 1 + round 2 — see `implementations-plan/design-system-externalization/` and `implementations-plan/design-system-externalization-round-2/`). The framework-/host-agnostic primitives live in the shared package and are consumed by the extension via a custom `unplugin-vue-components` resolver (`apps/extension/scripts/design-resolver.ts`), so templates use `<Flex>`/`<Text>`/`<Badge>` unchanged. `src/design/tokens.ts` re-exports `@nulo/design/tokens`; `_base.scss`/`_flex.scss`/`_text.scss` are gone — the wallet's base stylesheet is now `@nulo/design/base.css`. The package has NO auto-import, so its SFCs use explicit imports. **Resolver discipline:** a name enters `NULO_DESIGN_COMPONENTS` only when its extension-local SFC is DELETED; the three host-coupled holdouts (`Button` → RouterLink, `SubPageHeader` → router/history, `ToastManager` → app-shell toast root) keep a thin LOCAL extension wrapper that renders the package base (`Button`/`SubPageHeaderBase`/`ToastManagerBase`), so their bare tags resolve to the wrapper, NOT the resolver. The `toast`/`outside` composables live in `@nulo/design/composables/*`; the extension keeps `composables/{toast,outside}.js` as named re-export shims so its explicit + auto-import call sites are untouched.

```
[L0] design tokens     @nulo/design (token-contract.ts → generated tokens.ts + base.css + fonts).
                       Extension src/design/tokens.ts re-exports the package.

[L1] core primitives   @nulo/design/core: Flex, Icon, MaterialIcon, Text. No chrome.*.

[L2] ui primitives     @nulo/design/ui — ALL migrated: Badge, Banner, BrutalistTitle, Button,
                       Checkbox, Input, LoadingState, Popover, SectionLabel, Spinner, SubPageHeaderBase,
                       Toggle, Tooltip, ToastManagerBase (+ AppButton/Card/Tag/Toast faucet primitives).
                       The 3 host-coupled ones keep a thin LOCAL extension wrapper in src/components/ui/
                       (Button, SubPageHeader, ToastManager) rendering the package base.
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

Service-bound visual components (Header, AddressDisplay, GlobalLoader, NotificationManager, Popup, PopupCard, JsonViewer, LogsViewer, PasskeyCeremonyDialog in `components/passkey/`) live flat in `src/components/` or in their own subdir, NOT in `core/`, `ui/`, or `composite/`. Cross-shell ones (e.g. `PasskeyCeremonyDialog`, consumed by both the popup and onboarding shells) MUST live under `src/components/`, never `src/popup/**`, so onboarding can import them without crossing the `@/popup/**` layer ban.

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

## Keyboard & focus order

The primary Tab sequence must follow the visual/DOM order of the *fields*. A few hard rules (a positive `tabindex` anywhere on a screen silently corrupts the WHOLE document's tab order into two passes — every implicit-0 field becomes reachable only after every positive one):

- **Never use a positive `tabindex`.** Focusable custom widgets (a `<div role="...">` like `Toggle`, `DropdownItem`) get `tabindex="0"` (or `-1` when disabled/locked), never `"1"`. A `<div>` needs an explicit `tabindex` to be focusable at all — so change `"1"`→`"0"`, don't *remove* it.
- **Custom focusable widgets need keyboard activation.** A `<div @click>` is mouse-only; add `@keydown.enter.prevent` + `@keydown.space.prevent` (and `role`/`aria-*`) so it's operable by keyboard, matching click.
- **Secondary in-field controls are `tabindex="-1"`.** A show/hide-password button, a clear (`×`) button, an inline copy — anything that sits *between* two logical fields in the DOM — must be out of the Tab path (still mouse/AT-clickable) so Tab flows field → field. (Icon-only `<Icon @click>` SVGs are NOT tabbable, so they need no fix; only real `<button>`s do.) This is a **deliberate, owner-accepted tradeoff**: the show/hide-password toggle is `tabindex="-1"` (mouse + screen-reader reachable, not Tab-reachable) — a known WCAG-2.1.1 gap accepted in favor of the field→field flow. Don't "fix" it by restoring positive/0 tabbing without re-confirming.
- **Grouped mutually-exclusive choices use a roving tablist**, not N separate tab stops: `role="tablist"` + each option `role="tab"` with `:tabindex="active ? 0 : -1"`, and ←/→ switch + move focus. This collapses a segmented control (e.g. the create-profile Password/Passkey toggle) to ONE Tab stop between the fields around it.
- **Never key navigation off a `tabindex` literal.** `DropdownRoot` selects items via a stable `[data-dropdown-item]` attribute, NOT `[tabindex="1"]`, so changing an item's tabindex can't silently break arrow-nav.

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

- **No personal absolute paths.** Never write home-directory-rooted paths (macOS `~/...` expansions, Linux `~/Projects/...` expansions, Windows user-profile paths) in any plan file, audit transcript, or status doc. Use repo-relative paths (`apps/extension/src/popup/app.vue:164`) — they survive the clone and they don't leak whose machine the plan was written on.
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
| When editing Storybook stories or component visuals | `bun run --cwd apps/extension build-storybook`. |

`audit:vue` excludes e2e tests (`apps/extension/vitest.config.ts:68`). Smoke and network e2e are separate gates.

### In CI (server-side enforcement)

Configured in [`.github/`](./.github/). The full contributor guide is at [`CI.md`](./CI.md); the quick reference is at [`.github/README.md`](./.github/README.md).

- **Every PR**: `quality-status` aggregates commitlint, lint, typecheck, units, build. **Required check** on `main` + `dev`. Branch-up-to-date is NOT enforced on `dev` (the legacy `strict` flag is off), so a new dev commit doesn't invalidate a green PR — you only re-run CI on your own pushes. (The check-run is the bare job name `quality-status`; the old required context `Quality / Status` was a phantom that never matched — see § Branching.)
- **`smoke-e2e-status`**: runs on PRs to `main` (always), on PRs to `dev` whose diff touches the `smoke-surface` filter, or on PRs labeled `e2e:smoke`. Status emits pass when skipped. **Required check on both `dev` and `main`** (the produced bare name; verified against the live `required_status_checks.checks`).
- **`network-e2e-status`**: same shape as smoke, with the `extension-network` filter and `e2e:network` label. **Required check on both `dev` and `main`** (verified against the live `required_status_checks.checks`). Each shard installs `accelerator-server` (Linux x86_64 binary from `alejoamiras/aztec-accelerator` releases, SHA-256-pinned in `_network-e2e.yml`) and enforces native bb proving via `VITE_NULO_ACCELERATOR_REQUIRED=1` baked into the wallet build. Silent fallback to WASM is a hard fail. Rollback: set `vars.NULO_E2E_DISABLE_ACCELERATOR=1` (Settings → Actions → Variables) or use the `workflow_dispatch` input `disable_accelerator: true`. See [CI.md § Accelerator in CI](./CI.md#accelerator-in-ci).
- **Workflow-level**: actionlint + shellcheck run when workflow YAML or shell scripts change.

> **⚠️ The quality gates are non-negotiable — NEVER weaken them to merge faster.** Unit tests (inside `quality-status`), `Network e2e`, and `Smoke e2e` are *the* safety net that lets this repo move fast without shipping breakage. **Do not** convert a failing one to `advisory` / `continue-on-error` / `neutral` / `|| true`, **do not** make a check report success-on-failure, and **do not** remove one from a branch's required set — not to get a green rollup, not to dodge a `--admin`, not for any "we're in a hurry" reason. A red check means exactly one of two things: a **genuine flake → re-run it**, or **real breakage → fix it**. Silencing the signal to merge faster is precisely the wrong trade and destroys the gate's entire purpose. (Smoke is now **required** on both branches; its fixtures can still flake, so treat a red smoke like any other gate — flake → re-run, real breakage → fix — never neutralize it.) If a red check blocks a CLI merge, re-run the flake or fix the breakage — never neutralize the check.

### Branches + releases

- `main` — stable. Required checks enforced via branch protection.
- `dev` — day-to-day integration. Required checks enforced.
- Feature branches → PR into `dev`.
- Promote `dev → main` via PR when ready.
- **Releases are driven by release-please** (with a workaround). See [§ Release runbook](#release-runbook) below for the full per-release procedure. Two flows: **stable** auto-opens a Release PR on every push to `main`; **prereleases** (rc) are cut manually via `gh workflow run release-prerelease.yml --ref dev`. Both flows hit `release-please-action@v4`'s open abort bug ([googleapis/release-please-action#1205](https://github.com/googleapis/release-please-action/issues/1205) + [googleapis/release-please#2712](https://github.com/googleapis/release-please/issues/2712)) — each release needs a 45-second manual unstick + `workflow_dispatch` republish. Human `chore: bump extension to X.Y.Z` commits remain **deprecated**. Config files: `.github/release-please-config.json` + `.release-please-manifest.json` (stable), `.github/release-please-prerelease-config.json` + `.release-please-prerelease-manifest.json` (prerelease), `CHANGELOG.md`. Workflows: `.github/workflows/release.yml` (stable + publish chain), `.github/workflows/release-prerelease.yml` (rc PR opener).

### Release runbook

Two flows: **stable** (from `main`, tagged `vX.Y.Z`) and **prerelease** (from `dev`, tagged `vX.Y.Z-rc[.N]`). Both share the same v4 abort bug + manual unstick pattern.

#### Start here — what a release is, and what you actually do

A **stable release** turns the current `main` into a published `vX.Y.Z`: a GitHub Release with the built Chrome + Firefox zips + `SHASUMS256.txt`, the landing (`nulo.sh`) and faucet (`faucet.nulo.sh`) redeployed, and a `main → dev` back-sync PR opened. Most of it is automated by [`release.yml`](.github/workflows/release.yml); this table is the **current** division of labor (it shifts as the [staged rollout](#staged-rollout-switches) proceeds):

| What | Who | Current state |
|---|---|---|
| Open the Release PR (version bump + `CHANGELOG`) | release-please | ✅ automatic |
| **Tag + GitHub Release after you merge the Release PR** (the "unstick") | `auto-unstick` job **if `AUTO_UNSTICK_ENABLED=on`**, else **you** | ⚠️ **flag OFF → you do the 45s manual unstick** |
| Gates → build chrome+firefox → smoke → attach zips/SHASUMS | publish chain | ✅ automatic |
| Redeploy landing + faucet | `refresh-landing` + `deploy-faucet` | ✅ automatic (faucet hook unset → its CF dashboard Git-integration still deploys it) |
| Confirm the live sites serve THIS release | `verify-live` | ✅ automatic (advisory — see switches) |
| Open the `main → dev` back-sync PR (+ prerelease-manifest re-baseline) | `sync-main-to-dev` | ⚠️ automatic **only when `AUTO_UNSTICK_ENABLED=on`** (it gates on `push` + `attach-assets` success; the flag-OFF manual `workflow_dispatch` unstick is neither → **flag OFF = you open the sync manually**, see § After a stable cut). You review + **merge-commit** it, NOT squash — see step 5. |

**The happy path (stable), end to end:**

1. **Promote `dev → main`** — open a `release: promote dev → main (…)` PR, merge it (merge-commit, per `main`'s ruleset).
2. **Merge the Release PR** — release-please opens `chore(main): release X.Y.Z` within ~1 min; review the `CHANGELOG.md` diff, merge it via the UI (merge-commit).
3. **Unstick** — that merge re-triggers `release.yml`, which **aborts** on the [v4 bug](#why-the-manual-unstick-is-required-the-v4-bug):
   - **`AUTO_UNSTICK_ENABLED=on`** → the `auto-unstick` job tags + publishes automatically; nothing to do, skip to 4.
   - **flag OFF (current default)** → run the **[manual unstick](#stable-release-from-main)** below (§ Stable steps 5–6: a ~45s paste + a `workflow_dispatch` republish).
4. **Wait for the publish chain** (~15–25 min): gates → build → smoke → `attach-assets` → landing/faucet deploys → `verify-live`.
5. **Merge-commit the back-sync PR (NOT squash)** — `sync-main-to-dev` opens `chore: sync main → dev`. **Merge it with a merge commit** (`gh pr merge <n> --merge`) so `main`'s release commit stays in `dev`'s ancestry — a squash drops it and re-breaks the next rc cut (this was the [prerelease-fix](implementations-plan/release-prerelease-fix/plan.md)). `dev`'s ruleset now allows `merge` alongside `squash`. The merge carries the bot's manifest-rebaseline commit onto `dev`, but that commit is written via the Contents API under the App token → GitHub-**signed** (verified), so classic `required_signatures` is satisfied with **no `--admin`**. Labeled `needs-manual-resolution`? Resolve the conflict on the sync branch first, then merge-commit.
6. **Verify** — `gh release view v$VERSION --json assets -q '[.assets[].name]'` lists the two zips + `SHASUMS256.txt`.

> **One-time flip to near-one-click:** once a flag-OFF release proves the wiring (step 3 manual, everything else automatic), `gh variable set AUTO_UNSTICK_ENABLED -b on`. After that a stable release is **steps 1, 2, 5 only** (promote → merge Release PR → merge-commit the sync PR); the unstick + publish are hands-off. The detailed sections below are the reference + the fallback for when automation is off or red — see [§ Troubleshooting](#troubleshooting--when-x-fails).

> **Auto-unstick (staged rollout — variable flipped ON 2026-07-03).** `release.yml` has an `auto-unstick` job that does the 45-second manual unstick (§ steps 5–6 below) automatically: on the post-merge `push:main` where release-please aborted, it detects the merged `autorelease: pending` Release PR at `github.sha`, creates the tag + empty release, relabels the PR, and lets `resolve` continue the publish chain in the SAME run. **It is gated by the repo variable `vars.AUTO_UNSTICK_ENABLED`; the in-code default is OFF** (unset, or anything other than `on`/`true`/`1`, = off) as a kill-switch. **The variable is now `on`** — flipped 2026-07-03 after v0.24.0 proved the flag-off wiring — so the next release self-unsticks. (When the var is OFF the job no-ops, `unstuck=false`, and the manual unstick below is required; `gh variable set AUTO_UNSTICK_ENABLED -b off` reverts instantly.) The logic + every guard (idempotent re-tag, fail-closed on a wrong-SHA tag, no-op on a non-Release-PR push) live in unit-tested `scripts/release/auto-unstick*.ts`. **The manual procedure below remains the documented fallback and the source of truth** for what the automation does. To turn it back off: `gh variable set AUTO_UNSTICK_ENABLED -b off` (or delete the variable).

**Prerequisites** (one-time, already done):
- GitHub App `nulo-release-bot` installed on the repo with `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY` repo secrets wired.
- `CLOUDFLARE_PAGES_DEPLOY_HOOK` repo secret set (used by the workflow's `refresh-landing` job).

#### Stable release (from `main`)

Per-release procedure for shipping a stable release. Total time: ~20 min, of which ~45 seconds is manual.

1. **Get the work onto `main`.** Promote `dev → main` via the usual `release: promote dev → main (...)` PR. Merge-commit (per `main`'s ruleset).
2. **Wait for the Release PR.** The push to `main` triggers `release.yml`. release-please opens a Release PR titled `chore(main): release X.Y.Z` (version chosen automatically from Conventional Commits since the last tag — `feat:` → minor, `fix:` → patch). **While in `0.x`, `bump-minor-pre-major: true` caps a `BREAKING CHANGE:` to a *minor* bump (`0.23.0` → `0.24.0`, never auto-`1.0.0`)** — a `1.0.0` cut is a deliberate manual `Release-As: 1.0.0` footer. Review the auto-generated `CHANGELOG.md` diff in the PR.
3. **Merge the Release PR via the UI** (merge commit).
4. **Wait for the post-merge `release.yml` run.** It will run release-please-action again. **Expected: it aborts with `⚠ There are untagged, merged release PRs outstanding - aborting` and the downstream gates + publish jobs all skip.** This is the v4 bug.
5. **Manual unstick** (~45 seconds — paste into terminal):
   ```bash
   PR_NUM=<the Release PR number>
   VERSION=<e.g. 0.20.3>
   MERGE_COMMIT=$(gh pr view "$PR_NUM" --json mergeCommit -q '.mergeCommit.oid')
   git fetch origin main
   git tag -a "v$VERSION" "$MERGE_COMMIT" -m "Release $VERSION"
   git push origin "v$VERSION"
   gh pr edit "$PR_NUM" --add-label "autorelease: tagged" --remove-label "autorelease: pending"
   gh release create "v$VERSION" --verify-tag --title "v$VERSION" --notes "Filled by publish run."
   ```
6. **Trigger the publish chain via `workflow_dispatch`:**
   ```bash
   gh workflow run release.yml --ref main \
     -f tag="v$VERSION" -f dry_run=false \
     -f run_network_e2e=true -f publish_marketplaces=false
   ```
   This runs `lint+typecheck → unit-tests → network-e2e → build chrome+firefox → smoke-against-artifact → attach-assets` (zips + SHASUMS + git-cliff body overlay). ~15-25 min. Pass `run_network_e2e=true` to opt in (default is `false` on workflow_dispatch).
7. **Cloudflare landing + faucet redeploy — automatic on ANY stable publish path** (`push:main` AND `workflow_dispatch`). The `refresh-landing` + `deploy-faucet` jobs carry `always() && !cancelled()` guards (fixed 2026-07-03, `implementations-plan/release-pipeline-hardening/`). They used to lack `always()` and so silently skipped whenever a `workflow_dispatch` ancestor (`network-e2e` / `release-please` / `auto-unstick`) skipped — which stranded `nulo.sh` on the prior version after every manual-unstick publish. If a deploy is stale anyway (a CDN miss, or you want to force one), re-fire it with the break-glass workflow — **one command, no CF token, no account id**: `gh workflow run refresh-landing.yml` (optional `-f target=landing|faucet|both`).
8. **Verify**: `gh release view v$VERSION --json assets -q '[.assets[] | .name]'` should list `nulo-chrome-X.Y.Z.zip`, `nulo-firefox-X.Y.Z.zip`, `SHASUMS256.txt`.

#### Prerelease (rc) from `dev`

Per-rc procedure. Same v4 bug as stable; same ~45 second unstick. Network-e2e is OFF by default for prereleases — opt in if you want to gate this rc on it.

1. **Land features on dev as usual** via the standard feat:/fix: PR flow.
2. **Cut the rc manually:**
   ```bash
   gh workflow run release-prerelease.yml --ref dev
   ```
   No auto-fire on push:dev — rc cuts are explicit decisions. Within ~30 sec, release-please opens a Prerelease PR titled `chore(dev): release X.Y.Z-rc[.N]`.
   - First rc of a new minor: `v0.21.0-rc` (no number suffix).
   - Second cut, same minor: `v0.21.0-rc.1`. Third: `v0.21.0-rc.2`. Counter auto-increments per release-please's prerelease versioning strategy.
3. **Review + merge the Prerelease PR via the UI** (squash, per `dev`'s ruleset).
4. **Expected: same v4 abort.** `release-prerelease.yml` doesn't have a downstream publish chain at all — the unstick + publish steps live below.
5. **Manual unstick** (~45 seconds — paste into terminal, mind the `--prerelease` flag):
   ```bash
   PR_NUM=<the Prerelease PR number>
   VERSION=<e.g. 0.21.0-rc or 0.21.0-rc.1>
   MERGE_COMMIT=$(gh pr view "$PR_NUM" --json mergeCommit -q '.mergeCommit.oid')
   git fetch origin dev
   git tag -a "v$VERSION" "$MERGE_COMMIT" -m "Release $VERSION"
   git push origin "v$VERSION"
   gh pr edit "$PR_NUM" --add-label "autorelease: tagged" --remove-label "autorelease: pending"
   gh release create "v$VERSION" --verify-tag --prerelease --title "v$VERSION" --notes "Filled by publish run."
   ```
   Notes:
   - `--prerelease` marks the GitHub Release as prerelease (NOT shown as Latest).
   - `--verify-tag` confirms the tag exists; we don't pass `--target` because `target_commitish` is ignored when the tag already exists per the GitHub Releases API.
6. **Trigger the publish chain via the STABLE workflow's escape hatch:**
   ```bash
   gh workflow run release.yml --ref dev \
     -f tag="v$VERSION" -f dry_run=false \
     -f publish_marketplaces=false
   # Add -f run_network_e2e=true if you want to gate this rc on the
   # 30-45 min network e2e suite. Off by default for prereleases.
   ```
   - **Use `--ref dev` for a prerelease, NOT `--ref main`.** `--ref` picks BOTH the `release.yml` definition AND the reusable workflows it calls (`_build-extension.yml` etc., resolved at the caller's ref). Those must match the **layout of the tag's code**. Since #186 moved `packages/extension → apps/extension` on `dev` but `main` is still pre-restructure (`packages/extension`), a prerelease tag cut from `dev` (apps/ layout) built via `--ref main` fails with `ENOENT: Could not change directory to "packages/extension"`. `dev`'s workflow has the matching `apps/extension` paths. (Once #186 promotes to `main` at the next stable cut, `main` and `dev` reconverge and `--ref main` works again — but the safe rule is: **publish a prerelease with the ref of the branch it was cut from.**)
   - Pass the prerelease tag explicitly; the workflow's `resolve` job verifies the tag exists and detects `is_prerelease=true` from the `-` in the version string.
7. **Cloudflare hook is intentionally skipped** for prereleases — the landing points at stable releases only. No manual step.
8. **Verify:**
   ```bash
   gh release view "v$VERSION" --json isPrerelease,assets \
     -q '{prerelease:.isPrerelease, assets:[.assets[].name]}'
   ```
   Expected: `prerelease=true`, three assets.

#### After a stable cut promotes to `main`

The prerelease manifest (`.release-please-prerelease-manifest.json`) tracks the rc series independently and must be re-baselined to the new stable version. Otherwise the next rc series starts from a stale base + release-please can reopen old Release PRs on the drift ([release-please#2172](https://github.com/googleapis/release-please/issues/2172)).

> **Automated (`sync-main-to-dev` job).** `release.yml` now opens this PR for you. On the `push:main` that published a stable release, the `sync-main-to-dev` job branches from `origin/main`, writes the prerelease-manifest re-baseline, and opens ONE `chore: sync main → dev` PR (App-token-opened so dev's CI fires) that **combines both steps below**. It never local-merges: it lets GitHub compute mergeability — a clean PR is left for you to **merge-commit** (NOT squash — the merge keeps `main`'s release commit in `dev`'s ancestry, which the prerelease anchor needs); a CONFLICTING/UNKNOWN one is labeled `needs-manual-resolution` + commented (surfaced, never silent). It's **push-only** (a `workflow_dispatch` republish of an old tag never re-syncs) and **advisory** (post-publish — a sync hiccup reds only its own job, never the shipped release). The logic lives in unit-tested `scripts/release/open-sync-pr*.ts`. **You still review + merge-commit the PR** (`--merge`, NOT squash — the bot's manifest commit is written via the Contents API under the App token, so it's GitHub-signed and satisfies `required_signatures` with no `--admin`); the steps below are the manual fallback (and what the job automates) if it's ever red or disabled.

**Manual two-step procedure (order matters) — the fallback the job automates:**

1. **First, merge `main` back into `dev`** via the usual flow so `dev`'s `package.json` + `CHANGELOG.md` reflect the new stable version. (Without this, release-please sees a manifest/source drift on dev and can reopen merged PRs.)
2. **Then, open a small PR to `dev`** updating `.release-please-prerelease-manifest.json` to match (e.g. `{ ".": "0.21.0" }`). Merge it.
3. Next `gh workflow run release-prerelease.yml` will cut the next rc series from the correct base.

#### Why the manual unstick is required (the v4 bug)

`release-please-action@v4` runs both "open Release PR" and "tag + publish merged Release PR" phases. The publish phase looks for a previously-created GitHub Release that matches the merged PR's manifest entry — when no such release exists yet (because the publish phase is supposed to be the one creating it), it logs `⚠ Expected 1 releases, only found 0` and bails with the "outstanding" error instead of creating the release itself. Both the original action issue ([#1205](https://github.com/googleapis/release-please-action/issues/1205)) and the upstream tool issue ([release-please#2712](https://github.com/googleapis/release-please/issues/2712)) are open with no fix.

**All versions are affected** (verified by source-level inspection):
- `release-please-action@v3.7.13` (bundles release-please 15.13.0): same abort logic in `base.ts` + `manifest.ts`. Also 18 months unmaintained.
- `release-please-action@v4` (bundles release-please 17.3.0): current. Hits the bug.
- `release-please-action@v5.0.0` (bundles release-please 17.6.0): Node 24 runtime bump + minor unrelated fixes. Same abort path. Active issues confirm the deadlock on v5.

Downgrading to v3 also requires renaming our `target-branch:` input back to `default-branch:` — not worth the churn for no actual fix.

The manual unstick (tag + `autorelease: tagged` label + empty GitHub Release) places the repo in the state the action's publish phase *expects* to find. The follow-up `workflow_dispatch` then exercises the publish chain end-to-end via our `always() && needs.X.result == 'success'` guards (which require the explicit tag input to bypass `release-please` entirely).

**Things that DO work without manual intervention:**
- release-please opens correctly-titled Release PRs (after the `group-pull-request-title-pattern` fix in [`release-please-config.json`](.github/release-please-config.json)).
- The Release PR's CI runs normally (App-token triggers the PR-quick workflow → `quality-status`).
- The Release PR's commits are bot-verified (App-authenticated → satisfies `main`'s signed-commits rule).
- The `workflow_dispatch` publish chain runs all gates + builds + smoke + attach-assets end-to-end.

#### Troubleshooting — when X fails

| Symptom | Likely cause | Fix |
|---|---|---|
| Post-merge `release.yml` skipped everything; no tag, no assets | v4 abort + `AUTO_UNSTICK_ENABLED` off (expected today) | Run the [manual unstick](#stable-release-from-main) (§ Stable 5–6). Consider flipping the flag for next time. |
| `auto-unstick` job **red** with "refusing to re-point" | a `vX.Y.Z` tag already exists at a DIFFERENT commit | Fail-closed by design — it won't move a tag. Investigate the tag/commit mismatch, delete/fix the bad tag, then `workflow_dispatch` republish. |
| `auto-unstick` ran, `unstuck=false`, chain still skipped | flag off (no-op by design), OR HEAD isn't a merged `autorelease: pending` Release PR | If you expected it ON: confirm `vars.AUTO_UNSTICK_ENABLED=on` AND the Release PR actually merged at `github.sha`. |
| Release exists but assets are missing | an upload failed mid-`attach-assets` | Re-run just the publish chain: `gh workflow run release.yml --ref main -f tag=vX.Y.Z -f dry_run=false`. |
| `verify-live` **red** but the release shipped | CDN lag, or a real deploy miss | It's advisory — open `nulo.sh` / `faucet.nulo.sh`. The faucet's `index.html` `nulo-build` meta must equal `/build.json` `buildId`; if not, re-fire the deploy hook. |
| Faucet shows "No network configured for chainId …" | faucet built/deployed against a stale chain identity | Chain id is single-sourced in `apps/faucet/src/lib/chain-constants.ts` (no env override). Redeploy from current `main`. |
| `sync-main-to-dev` PR labeled `needs-manual-resolution` | `dev` diverged from `main` since the release | Resolve the conflict on the sync branch (usually `CHANGELOG.md` / `bun.lock`), then **merge-commit** it (`--merge`, NOT squash — preserves release-commit ancestry on `dev`; the bot's manifest commit is App-signed so no `--admin`). |
| No `sync-main-to-dev` PR appeared | push-only + stable-only; a `workflow_dispatch` republish never syncs | Expected on a republish. For a genuine cut, check the job ran on the `push:main` and read its log. |
| release-please reopened an OLD Release PR | prerelease-manifest drift after a stable cut | Re-baseline `.release-please-prerelease-manifest.json` to the new stable version — the `sync-main-to-dev` PR does this; just merge it. |

#### Staged-rollout switches

Two pieces ship **guarded** and get promoted only after they're proven on a real release. Flip them deliberately, one at a time — the rule is *ship inert/advisory, observe one real release, then promote*:

| Switch | What it gates | Default | Flip when | How |
|---|---|---|---|---|
| `vars.AUTO_UNSTICK_ENABLED` | the `auto-unstick` job acting vs no-op | code-default **off**; **var flipped ON 2026-07-03** (v0.24.0 proved the flag-off path) | ✅ done — next stage: flip the in-code default ON after one clean auto-unstick release | `gh variable set AUTO_UNSTICK_ENABLED -b on` (back: `-b off`, or delete the var) |
| `verify-live` ∈ `status` aggregator | whether a failed live-check fails the release | **advisory** (not in `status`) | after the first clean real release shows it green | one-line `release.yml` edit: add `verify-live` to the `status` job's `needs` + its result loop |

The manual procedures above remain the permanent fallback regardless of switch state.

## What this file is NOT

- Not the architecture overview — see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- Not the per-package surface — see each `packages/<name>/README.md`.
- Not the e2e infrastructure doc — see [`apps/extension/tests/e2e/README.md`](./apps/extension/tests/e2e/README.md).
- Not the planning archive — see [`implementations-plan/README.md`](./implementations-plan/README.md).
