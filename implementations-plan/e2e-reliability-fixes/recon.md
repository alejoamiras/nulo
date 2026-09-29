# Recon · e2e-reliability-fixes

Read-only recon at `624117cd` (`origin/dev`). One reader, no subagents: five small items, each in
one or two files. Every path is repo-relative.

## Reuse map

| # | Capability needed | Existing code (file:line) | Verdict |
|---|---|---|---|
| C1 | An extension page with `chrome.*` that no app logic closes or replaces, present in the production build of both browsers | `apps/extension/src/setup/index.html`, a rollup input (`apps/extension/vite.config.ts:297-301`, inherited by `vite.chrome.config.mts:15` and `vite.firefox.config.mts:15` through `mergeConfig`). Its app renders a static install or update component (`src/setup/app.vue`, `src/components/install.vue`: two lines of text) with no store, no service client, no `chrome.*` call, no `window.close()`. `src/setup/pages/` does not exist, so `#/install` matches no route and nothing navigates. `src/onboarding/index.ts:3` calls it "a placeholder with no stores". Already used as an inert observer page by `tests/e2e/network/incoming-arrival.test.ts:457` | **reuse-as-is** |
| C1 | A test-only extension document behind a `VITE_NULO_E2E_*` flag | The build-armed pattern (`.claude/skills/e2e-testing/SKILL.md` § "Adding a build-armed feature"; the leakage grep in `.github/workflows/_build-extension.yml:117-144`). No test-only HTML entry exists today | not needed: the setup page already is the inert document; a new rollup input would need its own conditional entry and leakage grep |
| C1 | The scratch-page hook on each driver | `openScratchPage` in `tests/e2e/fixtures/browser/chrome.ts:225-235` and `firefox.ts:342-347`, contract at `index.ts:85-91`, forwarder at `index.ts:217-218`; caller `fixtures/extension.ts:107-126` | **adapt** (path change; the `freshProfile` option loses its only use) |
| C1 | Documenting vitest 4.1.10's test-scoped fixture retry defect | The flake ledger, `.claude/skills/e2e-testing/SKILL.md` § 5 (rows 1-37); the retry-policy section at `:154-166`; the precedent of a drafted upstream issue kept in a plan (`implementations-plan/third-party-notices/lessons/upstream-issue.md`) | **adapt** (one ledger row + a drafted issue in `lessons/`) |
| C2 | One-time setup a retried body does not repeat | A file-local `base.extend` fixture, precedent `tests/e2e/network/window-placement.test.ts:42`; `@vitest/runner` 4.1.10 keeps a resolved file-scoped value on the file context (`dist/chunk-artifact.js:395-396`, `:409`) and rethrows a failed setup to every retry (`:398-413`) | **reuse-as-is** (pattern: a file-scoped `altToken` fixture over `tokenReadyExtension`) |
| C2 | Fallback only: knowing whether the wallet already holds a token contract | `tokenIdsForContract` + `readStorageValuesByPrefixes` over `nulo:core:tokens@` rows, private in `tests/e2e/fixtures/helpers.ts:1684-1706`, used by `readScopedBalanceRows` (`:1732-1737`) | **adapt** only if the fixture form fails (export `hasTokenRow`) |
| C2 | Deploy + import + freshness-gated balance wait | `deployExtraTokensForAccount` (`fixtures/aztec.ts:708-731`), `importTokenAndWaitForBalance` (`fixtures/helpers.ts:1007-1022`, 90 s at `:1020`), `waitForFreshBalanceRow` (`:1757`, 120 s default at `:1781`) | **reuse-as-is** (inside the fixture) |
| C3 | Loading a module outside the timed test body | Async hooks that import (`src/wallet/services/dapp-session/integrity.test.ts:8`, `src/wallet/services/execution/fast-path.test.ts:82`); for the relay, the existing `beforeEach` (`content-message-relay.test.ts:14-23`) becomes async and awaits the fresh import after `vi.resetModules()`; static top-of-file imports of `@aztec/*` in `packages/wallet-bridge/src/dispatcher.test.ts:10` | **reuse-as-is** (pattern) |
| C4 | Editing an exported backup and re-sealing it | `backup-restore-integrity.test.ts:92-145` already parses the export, rewrites slices and recomputes `checksum` as `sha256(JSON.stringify(body))`; `backup-migration-roundtrip.test.ts:87-103` does the same. The account-state slice is `data["account-state"]`, bound by `chainId` at `src/composables/full-backup-restore.ts:278` | **adapt** (one helper, `keepChainAccountState`, in `tests/e2e/helpers/backup-export.ts`, called by both before the re-seal) |
| C4 | Proving no public dial on restore | `interceptRpc` + `hits()`/`failures()` (`tests/e2e/fixtures/browser/index.ts:31-38`, `:117`; Firefox `firefox.ts:702`); public origins read from the build's seeded `nulo:core:networks@` rows (`src/wallet/services/network/spec.ts:7`), never from the backup, which carries no network rows (`full-backup-restore.ts:252`) | **reuse-as-is** (probe only, uncommitted) |
| C4 | The funded account's chain id | `backup-restore-integrity.test.ts:99-101` | **reuse-as-is** |
| C5 | Every consumer of the sponsor testid | exact: `FeeMethodSelector.test.ts:77`, `:88`, `selectFeeMethod` (`tests/e2e/fixtures/helpers.ts:1339-1346`); built from the subtitle: `pickFee` (`src/popup/pages/send.integration.test.ts:247-248`) | **reuse-as-is** (the testid stays verbatim, so all keep working) |
| C5 | A per-row identity in the fee menu | `:key="method.fpc?.id ?? method.type"` (`FeeMethodSelector.vue:55`); `FeeMethodOption.fpc.id` (`fee-helpers.ts:41`); saved picks resolve by `fpc.id` (`fee-privacy.ts:6-8`) | **reuse-as-is** (bind the same value to a data attribute) |
| C5 | Qualifying a shared testid by a data attribute | `select-token-row` + `data-symbol` (`SelectTokenPopup.vue`, selected at `network/send-picker.test.ts:36`); `send-fee-method-trigger` + `data-fee-method` (`FeeMethodSelector.vue:43-44`) | **reuse-as-is** (convention) |

Nothing is `build new`. The new symbols are the file-local `altToken` fixture and
`keepChainAccountState` (a few lines shared by the two backup tests); `hasTokenRow` appears only on
C2's fallback branch.

## Conventions to match

- e2e selects only by `data-testid`; a data attribute may qualify a testid (the two precedents
  above). Existing testids stay verbatim (CLAUDE.md § testid preservation rule).
- Flake fixes are root-caused and certified at retry 0; the ledger row records fingerprint,
  mechanism, fix and status (`SKILL.md` § 5). A per-test `retry` is never added to hide a flake
  (`SKILL.md:163`).
- Unit and component tests run under `bun --bun vitest run` from the owning workspace
  (`apps/extension/package.json:24`, `packages/wallet-bridge/package.json:12`); `test:all` runs
  every `@nulo/*` workspace's `test` at once (`package.json:29`), which is where the host load
  comes from.
- Complexity: cognitive ≤ 15 everywhere including tests; no suppression. None of the edits
  approaches it.
- Comments say why or state an invariant; no plan or phase references.

## Collision and dedup risks

- **`ux-owner-picks` touches `network/send-picker.test.ts`** (the wait at lines 31-32, `openSend`)
  **and the fee menu** (the default payer). C2 edits only lines 7-29 of `send-picker.test.ts` (the
  imports, the file-scoped fixture, and the deploy and import leaving the body); C5 edits one attribute line in `FeeMethodSelector.vue`
  (after `:58`) and adds one case to `FeeMethodSelector.test.ts`. The default payer lives in
  `buildFeeMethods`' order (`fee-helpers.ts:209-216` comment), which C5 does not touch. Whichever
  PR lands second rebases; the expected conflict is at most a context overlap near
  `send-picker.test.ts:29-31`. This forecast is unverified: line distance does not guarantee a
  clean merge (codex r1), so the second PR rereads the other's hunk.
- **`.claude/skills/e2e-testing/SKILL.md` § 5 is shared**: this plan appends ledger rows and
  amends row 37's status; another package may append too. Append only, never renumber.
- **The same retry defect as C2 exists in three siblings**: `network/holdings.test.ts:30-31`,
  `network/home-cap.test.ts:32-33`, `network/pin-to-home.test.ts:42-43` deploy extra tokens in the
  test body on the file-scoped wallet; `home-cap:50` and `pin-to-home:68` assert exact symbol
  lists, `holdings:91` a two-element prefix, and all three mutate pin or sort state a retry
  inherits. Out of scope (X2, approved by codex); they would reuse C2's fixture form plus a state
  reset.
- **The same public-network exposure as C4 exists in `network/backup-migration-roundtrip.test.ts`**
  (`:80-103`, a real export imported unfiltered). In scope by X3 (approved): it calls the same helper.
- **The popup-as-scratch assumption is written in four places**: the driver contract
  (`fixtures/browser/index.ts:85-90`), the Firefox driver (`firefox.ts:333-340`), `FIREFOX.md:43`,
  and the redirect test's comment (`onboarding-tab.test.ts:298-301`). All four say Chrome ignores
  the popup's `window.close()`; the probe in `implementations-plan/ux-feedback/lessons/final-pass.md`
  (4 of 4 launches) says it does not. C1 corrects each.
