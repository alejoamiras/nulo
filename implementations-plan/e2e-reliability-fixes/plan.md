---
plan: e2e-reliability-fixes
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: none (light tier)
eli5_mode: artifact
eli5: (one ELI5 Artifact covers the program's four plans; URL filled in after publish)
branch: test/e2e-reliability-fixes
worktree: a harness-created agent worktree (its repo-relative path is recorded in lessons/phase-0.md)
---

# e2e reliability fixes

One PR off `dev` that closes five test-reliability follow-ups from the ux-feedback program
(`implementations-plan/ux-feedback/plan.md` § Follow-ups), each at its root cause:

- **C1** the launch fixture's scratch page, which Chrome's popup closes under it on a fresh
  wallet, plus vitest 4.1.10's test-scoped fixture retry defect (documented, not fixed);
- **C2** `network/send-picker`, whose retries cannot pass once an attempt has imported ALT;
- **C3** two unit tests that time out under host load because a cold dynamic import runs inside
  the timed test body;
- **C4** `network/backup-restore-integrity`, whose import waits on public networks;
- **C5** the fee menu's sponsor rows, which all share one testid.

No product behaviour changes. One production template (`FeeMethodSelector.vue`) gains an
invisible data attribute. Recon: [`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

Recorded from the owner's message of 2026-09-28; no clarifying questions were asked:

> "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial? Assigning
> blueprinting level to each of those and just needing me to answer the open questons that it may
> come."

- **Scope**: the five follow-up records C1–C5, verbatim in the program brief. The driver's
  framing: "Test reliability: Chrome's smoke-test startup page closing itself, `send-picker`'s
  retries, two unit tests that time out under load, `backup-restore-integrity` waiting on public
  networks, and sponsor rows that share one test ID." Out: C4's two product questions (whether
  preloaded contracts should be skipped like protocol ones; whether an import should wait on
  public networks at all), which stay open follow-ups (§ Follow-ups); any vitest bump; the three
  sibling tests that share C2's retry defect (X2, approved by codex). In by X3:
  `backup-migration-roundtrip` gets C4's filter.
- **Standing rules**: flakes are root-caused, never retried away; a red gate is never made
  advisory; e2e selects only by `data-testid`; temporary probe specs are never committed.
- **Decisions**: all five items are technical and are decided with `/codex high`. The owner
  answers only open questions; this plan has none for the owner (§ Asks).
- **Tier**: `light` (§ Tier). The owner's standing cap is "never blueprint more than mid, to keep
  our credits safe".
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Same-family leg**: none at this tier. (The owner, 2026-09-28: "use opus5.5 instead of fable
  please" governs the program's `mid` plans.)
- **Delivery**: single arc, one PR off `dev`, plain `gh pr create` after the codex loop
  converges.

## Tier (Phase 0.5)

| Dimension | Score | Why |
|---|---|---|
| Novelty | low | every fix reuses a pattern already in the repo (recon: nothing is `build new`) |
| Blast radius | moderate | C1 changes the launch fixture every e2e passes through; the rest touch one or two files each |
| Irreversibility | low | test code and one data attribute; a revert is one commit |
| Migration cost | none | no persisted shape, no wire change |
| External coupling | low | vitest's runner behaviour is documented, not patched |
| Security sensitivity | low | no secret, no permission, no message path; § Security |

No dimension is high, so `light`: one codex audit of this plan, no competing outline.

## Outcome & Quality Bar

For whom: whoever reads a red or green e2e or unit run on a PR, on the nightly, or on a busy
shared host, and must decide "flake or breakage" from it.

Excellent means:

1. **Each named trigger is removed at its cause, not absorbed.** No retry count, timeout budget
   or advisory flag is raised to make a test pass. C1's scratch-page trigger, C2's repeated setup,
   C3's in-body cold imports and C4's public account-state items are each removed, and a probe
   shows the cause no longer reaches the test (C1, C2, C4) or no longer sits inside the timed body
   (C3). One C1 mechanism is **not** fixed: vitest 4.1.10's fixture-retry defect stays open,
   documented in the flake ledger with a drafted upstream issue. The self-close stays what the
   evidence supports: the likely cause of #702's CI failure, not the established one, since a
   browser disconnect takes the same code path.
2. **Assertions keep their strength.** `send-picker` still asserts exactly `["ALT", "TST"]` and no
   search box; `backup-restore-integrity` still proves the provenance filter, the on-chain balance
   and the delete cascade, and now also that the kept sandbox item carries the funded token's
   contract; every existing testid still selects what it selected.

Good enough: the three sibling tests that share C2's retry defect are named in a follow-up with
the fix they would reuse.

## UI impact

None visible. C5 adds a `data-fpc-id` attribute to each fee-menu row that has a fee payment
contract; it renders nothing and changes no layout, copy, order or state. The fee menu appears
in the popup's Send page and the dApp execute window through `FeeSettingsCard.vue:763`. Its rows
come from the wallet's own FPC records (`fee-helpers.ts:190-203`), not from dApp data, so the
wire-shaped fixture rule does not apply. No owner sign-off is needed; no screenshot.

## Architecture & Implementation

Compact treatment (light tier). The file-level change map is at the end of this section.

### C1 · A scratch page no app redirect decides

**Mechanism today.** `settleLaunchedExtension` (`fixtures/extension.ts:99-185`) opens a scratch
page through the driver, waits on it for the worker's liveness key, closes the first-run tab,
then seeds `nulo:onboarding:completed`. Chrome's scratch page is the popup
(`browser/chrome.ts:225-235`). On a fresh wallet the popup's register, import or profile/new page
runs `redirectToOnboardingTabIfNeeded` in `onBeforeMount` (`register.vue:26`, `import.vue:50`,
`profile/new.vue:38`). That call reads the flag, opens or focuses the onboarding tab, and calls
`window.close()` (`wallet/utils/onboarding-tab.ts:82-89`). Chrome honours the call, which the probe
in `implementations-plan/ux-feedback/lessons/final-pass.md` showed in 4 of 4 launches once the
worker answered first. Firefox's fresh-profile scratch page is the onboarding page
(`browser/firefox.ts:342-347`). Its `onMounted` reads the flag asynchronously and, once it reads
`true`, opens a popup window and closes itself (`onboarding/app.vue:41-58`), so the fixture's own
seed can close it. A reused Firefox profile gets the popup, and `freshProfile` records only
whether the profile directory was empty (`fixtures/extension.ts:79`), not whether onboarding
finished.

**Fix.** Both drivers open `src/setup/index.html#/install` as the scratch page. It is a production
extension page in both builds (rollup input `vite.config.ts:300`). It has `chrome.*` like every
extension document, and its app renders two lines of static text with no store, no router
navigation, no service client and no `window.close()` (`setup/app.vue`,
`components/install.vue`). Nothing about onboarding state can close it, on either browser, on a
fresh or reused profile. `incoming-arrival.test.ts:457` already uses it as an inert observer.

- `chrome.ts` `openScratchPage`: the path changes; the `goto` + close-on-throw shape stays.
- `firefox.ts` `openScratchPage`: one path for both profile states, through
  `gotoExtensionPage`; its doc comment is replaced by one sentence on why the setup page.
- `index.ts`: the contract comment (`:85-90`) is corrected: the page must be one whose lifetime
  no onboarding state decides, since both browsers honour the popup's and the onboarding page's
  `window.close()`. The `opts: { freshProfile }` parameter loses its only reader, so it is
  removed from the interface (`:91`), the forwarder (`:217-218`), both drivers and the caller
  (`extension.ts:117`). `freshProfile` itself stays in the fixture for the first-run-tab check.
- The three stale claims are corrected in the same commit: `FIREFOX.md:43` (the row becomes
  "both browsers honour it; the scratch page is the setup page"), and the redirect test's comment
  at `onboarding-tab.test.ts:298-301`. That comment says `window.close()` is a no-op for
  puppeteer-opened pages; the corrected one says the test asserts only the tab, since the popup
  may close.

**vitest's fixture retry: documented, still open.** `@vitest/runner` 4.1.10 adds a test-scoped
fixture to the context's cache before its setup resolves (`dist/chunk-artifact.js:353`). It
registers the cleanup that removes it only after success (`:357`), so a retry after a failed setup
skips the fixture and the test receives it undefined. The plan removes the known trigger (above)
and does not work around the runner: a fixture that swallowed its own setup error, or re-launched
on failure, would be the retry-it-away answer inside the fixture. It documents the defect in the
e2e-testing skill's flake ledger and drafts an upstream issue with the standalone repro in
`lessons/phase-3.md` for the owner to file (X5). It does not bump vitest. The ledger row names the
check to run on any vitest bump: a fixture-retry repro.

### C2 · `send-picker`'s one-time setup moves into a file-scoped fixture

**Mechanism today.** The test deploys ALT (`send-picker.test.ts:22-25`) and imports it (`:29`)
inside its body, on `tokenReadyExtension`, which is file-scoped (`fixtures/extension.ts:731-792`).
A retry runs the body again against the same wallet, so it deploys a second ALT contract and
imports it too. The rows then read `['ALT', 'ALT', 'TST']`, and at four rows the search box
appears (`SelectTokenPopup.vue:169`, `v-if="searchable"`).

**Fix: the deploy and the import leave the body.** The file extends the shared `test` with one
file-scoped fixture, the same in-file `base.extend` form as `window-placement.test.ts:42`:

```ts
const test = base.extend<{ altToken: string }>({
	altToken: [
		async ({ tokenReadyExtension }, use) => {
			const { deployExtraTokensForAccount } = await import("../fixtures/aztec")
			const { ALT } = await deployExtraTokensForAccount(aztecConfig!, tokenReadyExtension.accountAddress, [
				{ symbol: "ALT", amount: 25n * ONE },
			])
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			await importTokenAndWaitForBalance(page, tokenReadyExtension.accountAddress, ALT, (25n * ONE).toString())
			await page.close()
			await use(ALT)
		},
		{ scope: "file" },
	],
})
```

The body requests `altToken` next to `tokenReadyExtension` (vitest resolves only the fixtures a
test destructures, or `auto` ones: `chunk-artifact.js:305-309`), opens its own popup, and runs
from line 31 on unchanged. Why this holds, from the runner's code:

- A resolved file-scoped fixture is stored on the file context (`chunk-artifact.js:409`) and
  returned to every later request (`:395-396`), so a retried body reuses the first attempt's ALT
  and never deploys or imports again.
- A failed setup is not retried. The setup promise leaves `scopedFixturePromiseCache` only on
  success (`:398-413`), so every retry rethrows the first error. A setup failure is therefore a
  real, red failure with its own stack, and no body runs against a half-imported token.
- The import proof is unchanged: `importTokenAndWaitForBalance` keeps its freshness gate and its
  90 s budget (`fixtures/helpers.ts:1020`). No bare `waitForFreshBalanceRow` call remains, so the
  120 s default (`:1781`) is never selected.
- The lazy `import("../fixtures/aztec")` stays inside the fixture, so the file keeps off the WASM
  load until the fixture runs.
- Every assertion from line 32 on is unchanged and holds for any selected token on entry (`:42`
  counts one selected row; `:44` and `:51` choose explicitly).

**Fallback, only if the fixture form proves worse in P4** (for example a type or lint conflict with
the shared `test`): keep the steps in the body, guarded by a new `hasTokenRow(page, contract)`
export in `fixtures/helpers.ts` (one snapshot through the existing `readStorageValuesByPrefixes`,
decoded by `tokenIdsForContract`, `:1684-1706`). A retry that finds the row verifies the persisted
balance with `waitForFreshBalanceRow(…, { baselineUpdatedAt: 0, timeoutMs: 90_000 })`: it confirms
the stored value, it does not prove a new projection. That branch must then prove both
boundaries deterministically in P4: the row persisted before the first attempt's helper returned,
and the write still pending when the retry starts. No polling retry wraps a failed assertion on
either branch. `lessons/phase-4.md` records which branch shipped and why, in one line.

- Lines touched: 7-29 (the imports, the fixture, and the deploy and import leaving the body).
  `ux-owner-picks` edits the wait at `:31-32`.
- Ledger row 37 (`SKILL.md:646`) gains "retries reuse a file-scoped ALT fixture" in its Fix cell.

### C3 · The cold imports leave the timed body

Neither test's 5 s default (no `testTimeout` in `packages/wallet-bridge/vitest.config.ts` or
`vitest.base.ts`) is the problem; the work inside it is. `test:all` runs every workspace's tests
at once (`package.json:29`), and a cold import's cost grows with host load while the assertion's
cost does not. Raising the per-test timeout would move the threshold and keep unrelated work inside
the measurement. The fix moves the module load out of the body, so the 5 s measures only the
behaviour under test.

- **`content-message-relay.test.ts`.** The existing `beforeEach` (`:14-23`) becomes async: after
  `vi.resetModules()` and the `chrome` stub it awaits `import("./content-message-relay")` into a
  file-level `relay`, with a 30 s hook budget. `freshRelay()` keeps the registration and its
  one-listener assertion in the test and reads `relay`. The hook's budget bounds loading only
  (`hookTimeout` defaults to 10 s and a loaded host can exceed it); the behaviour keeps the 5 s
  per-test default. The late-continuation cascade the record describes cannot recur: registration
  runs in the body, and a body never runs after its `beforeEach` failed. No warm `beforeAll`, no
  generation guard and no `not.toBe(warm)` check (X6, as codex amended).
- **`method-descriptors.test.ts`.** The two dynamic imports (`:213-214`) become static imports at
  the top of the file, schema patch first:
  `import "@nulo/wallet-sdk-schema-patch/register"` then
  `import { WalletSchema } from "@aztec/aztec.js/wallet"`. Static imports evaluate in order at
  collection, which no per-test timeout covers. `register.ts:11-14` patches `WalletSchema` when
  it evaluates, and its doc says a first static import guarantees the order. The in-test comment
  shrinks to the load-bearing sentence (the patch import stays first). No other case in the file
  reads `WalletSchema` (Fact 14), so evaluating the patch file-wide changes nothing else.

### C4 · The edited backups carry only the sandbox's account-state

The import's chain-sync is the one leg that dials the network (`full-backup-restore.ts:427`).
It probes and registers only networks with registrable work (`importChainSync.ts:61-63`) on a
30 s registration budget (`:34`) inside a 45 s total (`:29`). The exported backup can carry
account-state items for the Alpha and Testnet networks too (only for networks that were Active at
export: `account-state/service.ts:219-226`), so one stalled dRPC call marks every network skipped
and parks the flow on the Continue-gated errors screen. `importFullBackup` then waits 300 s for the
success route (`helpers/import-drivers.ts:299`).

Both backup tests already doctor the export and re-seal it (`backup-restore-integrity.test.ts:92-145`,
`backup-migration-roundtrip.test.ts:87-103`, `checksum = sha256(JSON.stringify(body))`). One more
edit in each, before the re-seal, through one new helper in `tests/e2e/helpers/backup-export.ts`:
`keepChainAccountState(data, chainId, tokenAddress)`.

- It keeps only the `data["account-state"]` items whose `chainId` is the funded account's (read
  as today, `backup-restore-integrity.test.ts:99-101`; the roundtrip reads the same account row).
  The import binds items by `chainId`, never by exported id (`full-backup-helpers.ts:435-470`,
  called at `full-backup-restore.ts:278`).
- It asserts that a kept item lists the funded token's contract (address compared
  case-insensitively). A non-empty item with empty `senders` and `contracts` registers nothing
  (`registrableNetworkIds`, `account-state/normalize.ts:206`), so a bare non-empty check would pass
  without exercising registration.
- Its one comment: public-chain recovery material would make the import register contracts over
  public RPC.
- It does not assert that anything was removed: an export without public items is fine.

The rest of both tests is unchanged. Two small changes ride along in the two files:

- **Cleanup covers a failed launch.** Today the doctored file is written (`:145`; roundtrip
  `:103`) before `launchExtension` (`:149`; `:107`), and `try` starts after it (`:150`; `:108`). A
  failed launch therefore leaves a file holding the test wallet's master key. The `try` now starts
  right after the write, with `let ctx2: ExtensionContext | undefined` assigned inside it. The
  `finally` closes `ctx2` only when set, in an inner `try` whose own `finally` removes the profile
  directory and the backup file, so removal runs even when browser teardown rejects.
- **Comments state the invariant, not the history.** In `backup-restore-integrity.test.ts` the
  header's plan, phase and finding references (`:2-4` "P1 … (backup-restore-corruption-fix)",
  `:19` "(finding D)", `:25-31` "Coverage split (see the plan): P1's … P2 … P3") and the same kind
  at `:60` "(Phase 9)" and `:220` "(finding D)" become the lasting statement of what each leg
  proves. In `backup-migration-roundtrip.test.ts:170` "(codex post-impl audit)" is dropped. The
  test title at `:68` keeps its "(P1 provenance)" wording: it is the name run history and the
  archived lessons match. Nothing outside these two files is touched.

### C5 · One distinct, stable attribute per sponsor row

Every sponsor row's testid is `send-fee-method-${method.subtitle}` (`FeeMethodSelector.vue:58`),
and every sponsor's subtitle is `"sponsored"` (`fee-helpers.ts:202`). The e2e helper selects a
method by exact testid with `querySelector` (`fixtures/helpers.ts:1339-1346`), which returns the
first sponsor, Nulo's own (`menuOrder`, `fee-helpers.ts:211-216`). Two component cases use the
exact testid (`FeeMethodSelector.test.ts:77`, `:88`), and `send.integration.test.ts:247-248` builds
it from the subtitle (`pickFee(w, "sponsored")`).

**Fix.** Keep the testid verbatim and add `:data-fpc-id="method.fpc?.id"` to the `DropdownItem`.
This is the value the row is already keyed by (`:55`) and the one a saved pick resolves by
(`fee-privacy.ts:6-8`). Vue omits the attribute when it is undefined or null (the Fee Juice row).
The private row carries its PrivateFPC's id, which is harmless and consistent. A test that needs
one sponsor selects `[data-testid="send-fee-method-sponsored"][data-fpc-id="…"]`, the same
qualified-testid form as `select-token-row[data-symbol]` (`send-picker.test.ts:36`). A suffix
scheme (`send-fee-method-sponsored-<id>`) would rename a testid that `selectFeeMethod`, two
component cases and the integration test's `pickFee` select exactly, and the testid rule forbids
that (X1). One component case: two sponsors render two rows that both carry the unchanged testid
and distinct `data-fpc-id` values, and the Fee Juice row carries none. No e2e helper changes,
since none needs a specific sponsor today.

### Alternatives considered

- **C1: a test-only inert page behind a `VITE_NULO_E2E_*` flag.** It would be a new rollup input,
  a conditional entry and a leakage grep in `_build-extension.yml`, to get what the shipped setup
  page already is. Rejected; the setup page's one risk is someone deleting it as dead code, which
  makes the fixture's `goto` fail loudly, and its inline comment names the dependency.
- **C1: keep the popup and seed the flag before the first lookup.** The seed needs an extension
  page to write from, which is the scratch page itself, so the ordering cannot be arranged from
  outside. Rejected.
- **C2: `retry: 0` on the file** (the destructive-scenario policy, `SKILL.md:160-162`). It gives up
  the nightly's absorb policy for a test whose setup can simply leave the body. Rejected.
- **C2: a test-scoped wallet.** A fresh `tokenReadyExtension` per attempt costs a full account
  deploy and mint. Rejected.
- **C2: a module-level memo plus a storage check in the body** (the draft's design). It needs a
  retry to reason about a half-finished import, which codex showed a thrown-after-click probe
  cannot pin down. Kept only as the fallback.
- **C3: raise the per-test timeout.** It keeps unrelated, load-dependent work inside the
  measurement. Rejected (§ C3).
- **C3: warm the relay once in `beforeAll`, with a fresh-instance check and a generation guard**
  (the draft's design). It leans on a post-reset import being fast, which is unmeasured, and needs
  a guard for a continuation the `beforeEach` form cannot produce. Rejected for codex's simpler
  form.
- **C4: refuse the public RPC origins with `interceptRpc`.** The preflight would then mark the
  networks unreachable quickly, but the flow would still stop on the Continue-gated errors
  screen. Rejected as the fix; used as P5's probe.

### File-level change map

| File | Change | Item |
|---|---|---|
| `apps/extension/tests/e2e/fixtures/browser/index.ts` | contract comment; drop `opts` from `openScratchPage` | C1 |
| `apps/extension/tests/e2e/fixtures/browser/chrome.ts` | scratch path | C1 |
| `apps/extension/tests/e2e/fixtures/browser/firefox.ts` | scratch path, one branch; comment | C1 |
| `apps/extension/tests/e2e/fixtures/extension.ts` | caller of `openScratchPage` (`:117`) | C1 |
| `apps/extension/tests/e2e/FIREFOX.md` | row at `:43` | C1 |
| `apps/extension/tests/e2e/onboarding-tab.test.ts` | comment at `:298-301` only | C1 |
| `.claude/skills/e2e-testing/SKILL.md` | ledger: new rows for C1 and C4, row 37's fix cell for C2 | C1, C2, C4 |
| `apps/extension/tests/e2e/network/send-picker.test.ts` | lines 7-29: file-scoped `altToken` fixture | C2 |
| `apps/extension/tests/e2e/fixtures/helpers.ts` | only on the fallback branch: export `hasTokenRow` | C2 |
| `apps/extension/src/wallet/services/wallet-sdk/content-message-relay.test.ts` | async `beforeEach` import; `freshRelay` reads it | C3 |
| `packages/wallet-bridge/src/method-descriptors.test.ts` | static imports, schema patch first | C3 |
| `apps/extension/tests/e2e/helpers/backup-export.ts` | `keepChainAccountState` | C4 |
| `apps/extension/tests/e2e/network/backup-restore-integrity.test.ts` | the filter before the re-seal; cleanup scope; header and step comments | C4 |
| `apps/extension/tests/e2e/network/backup-migration-roundtrip.test.ts` | the filter before the re-seal; cleanup scope; the `:170` comment | C4 |
| `apps/extension/src/popup/components/modules/send/FeeMethodSelector.vue` | `:data-fpc-id` | C5 |
| `apps/extension/src/popup/components/modules/send/FeeMethodSelector.test.ts` | one case | C5 |
| `implementations-plan/e2e-reliability-fixes/` + `implementations-plan/index.md` | the plan, one index line | all |

## Security & Adversarial Considerations

- **Threat model.** Test code and a test-facing attribute; no new trust boundary. The only
  production edit, `data-fpc-id`, exposes a wallet-local random row id (`fpc/service.ts:284`,
  `nextRandomId`) in the popup's own DOM. Only extension documents can read that DOM: web pages
  cannot reach it, and a content script never renders the fee menu. The id carries nothing an
  attacker can use: it is not an address, a key or a balance.
- **Production build.** C1 reuses a page the production build already ships and adds no entry, so
  the e2e-fixture leakage guard (`_build-extension.yml:117-144`) is unaffected. The setup page's
  runtime is not modified.
- **Backup handling in C4.** The doctored file embeds the funded wallet's local-chain master key.
  Today it survives a failed launch; after the change the cleanup scope starts at the write and
  removes the file even when browser teardown rejects (§ C4). Filtering happens before the
  re-seal, so the backup still passes the checksum gate (`useFullBackupImport.ts:82`) and the
  compat-epoch and version gates; it tests nothing looser. P5's negative-control backup is a
  scratch file under the same cleanup and is never committed. The change removes public
  dependencies from the **restore** only; the export still probes public nodes.
- **Logging.** No log line is added; `log-payload-ban.test.ts` scans `src/` and `packages/*/src`,
  and the only `src/` edit is a template attribute.
- **Supply chain.** No dependency added or bumped; vitest stays at 4.1.10.
- **Least privilege, crypto, CI tokens.** Not touched.
- **Upstream issue.** The drafted vitest issue contains only a minimal repro: no repo path, no
  host detail, nothing from the wallet.

## Assumptions

### Facts (verified by reading the file at the cited lines)

1. Chrome's `openScratchPage` loads `/src/popup/index.html` (`fixtures/browser/chrome.ts:225-235`);
   Firefox's loads the onboarding page on a fresh profile and the popup otherwise
   (`fixtures/browser/firefox.ts:342-347`).
2. The driver contract, the Firefox driver, `FIREFOX.md` and the redirect test all state that
   Chrome ignores the popup's `window.close()` (`index.ts:85-90`, `firefox.ts:333-340`,
   `FIREFOX.md:43`, `onboarding-tab.test.ts:298-301`).
3. `redirectToOnboardingTabIfNeeded` reads the flag, opens or focuses the onboarding tab, then
   calls `window.close()` (`wallet/utils/onboarding-tab.ts:82-89`); `register.vue:26`,
   `import.vue:50` and `profile/new.vue:38` call it in `onBeforeMount`.
4. The fixture waits for liveness on the scratch page, closes the first-run tab, and only then
   seeds `nulo:onboarding:completed` (`fixtures/extension.ts:132-181`); `freshProfile` is true
   when the profile directory is missing or empty (`:79`).
5. The onboarding page's `onMounted` reads the flag and, when it reads `true`, opens a popup
   window and closes itself (`onboarding/app.vue:41-58`).
6. `src/setup/index.html` is a rollup input (`vite.config.ts:300`) inherited by both browser
   configs through `mergeConfig` (`vite.chrome.config.mts:15`, `vite.firefox.config.mts:15`).
   `setup/app.vue` renders `install.vue` or `update.vue` by a route param; `install.vue` is
   static text. `setup/index.ts` mounts a router over `~pages`, and no `src/setup/pages/`
   directory exists (`scripts/pages-options.ts:11`). `incoming-arrival.test.ts:457` loads
   `/src/setup/index.html#/install` as an observer page.
7. `@vitest/runner` 4.1.10 adds a test-scoped fixture to `cachedFixtures` before awaiting its
   setup (`chunk-artifact.js:353`) and registers the cleanup that deletes it only after success
   (`:357`).
8. Smoke's config sets `retry: 2` (`vitest.e2e.config.ts:41`); network defaults to 2 and takes
   `NULO_E2E_RETRY` (`vitest.e2e.network.config.ts:46`).
9. `send-picker` deploys and imports ALT inside the test body (`send-picker.test.ts:22-29`) on a
   file-scoped `tokenReadyExtension` (`fixtures/extension.ts:731-792`) and asserts exactly
   `["ALT", "TST"]` and no search box (`:37`, `:41`); the search box renders only when
   `searchable` (`SelectTokenPopup.vue:169`).
10. `holdings`, `home-cap` and `pin-to-home` use the same in-body deploy on the same fixture
    (`holdings.test.ts:30-31`, `home-cap.test.ts:32-33`, `pin-to-home.test.ts:42-43`).
    `home-cap:50` and `pin-to-home:68` assert exact symbol lists; `holdings:91` asserts a
    two-element prefix. The three also mutate pin and sort state a retry would inherit.
11. `tokenIdsForContract` and `readStorageValuesByPrefixes` read the `nulo:core:tokens@` rows and
    are private to `fixtures/helpers.ts` (`:1684-1706`, `:1732-1737`).
12. The relay test resets modules and `chromeListeners` before every test and imports the relay
    inside `freshRelay()` (`content-message-relay.test.ts:14-30`); the relay imports only its
    validator, which imports `zod` (`content-message-relay.ts:1`, `content-script-validator.ts:28`).
13. vitest's `resetModules` clears `promise`, `exports`, `evaluated` and `importers` on each module
    node and keeps the node (`vitest/dist/chunks/utils.BX5Fg8C4.js:29-42`).
14. `method-descriptors.test.ts` imports the schema patch, then `@aztec/aztec.js/wallet`, inside
    its exhaustiveness test (`:213-214`); no other case in the file reads `WalletSchema`;
    `register.ts:11-14` patches `WalletSchema` at evaluation; neither
    `packages/wallet-bridge/vitest.config.ts` nor `vitest.base.ts` sets a timeout.
15. `test:all` runs every `@nulo/*` workspace's `test` script through one filtered `bun run`
    (`package.json:29`).
16. The chain-sync budgets are 45 s total, 21 s preflight and 30 s registration
    (`importChainSync.ts:29-34`); only created networks with registrable work are probed
    (`:61-63`); the restore's doc names this leg the one that dials the network
    (`full-backup-restore.ts:427`).
17. Account-state rows are bound to seeded networks by `chainId` (`full-backup-helpers.ts:435-470`,
    applied to the `account-state` and transaction slices at `full-backup-restore.ts:278`);
    `BackupAccountState` carries an optional `chainId` (`account-state/spec.ts:16-23`).
18. The integrity test doctors the export and recomputes `checksum` as the SHA-256 of
    `JSON.stringify(body)` (`backup-restore-integrity.test.ts:92-145`); `importFullBackup` waits
    300 s for the success route (`helpers/import-drivers.ts:299`).
19. `backup-migration-roundtrip` imports a real export after adding only a contact row
    (`backup-migration-roundtrip.test.ts:80-103`).
20. Fee rows get `send-fee-method-${method.subtitle}` (`FeeMethodSelector.vue:58`) and key
    `method.fpc?.id ?? method.type` (`:55`); every sponsor's subtitle is `"sponsored"`
    (`fee-helpers.ts:202`); Nulo's sponsor sorts first (`:211-216`).
21. The sponsor testid is selected exactly by `FeeMethodSelector.test.ts:77`, `:88` and by
    `selectFeeMethod` (`fixtures/helpers.ts:1339-1346`), and built from the subtitle by `pickFee`
    in `src/popup/pages/send.integration.test.ts:247-248`; a literal search finds no other file in
    `apps/extension/src`, `apps/extension/tests` or `packages`.
22. `fpc.id` is a random storage id (`fpc/service.ts:284`); `RegisteredFpc` has no address
    (`fee-helpers.ts:70-75`).
23. The flake ledger's last row is 37, `send-picker`'s first-attempt fix, whose Mechanism cell
    already records the retry state (`.claude/skills/e2e-testing/SKILL.md:646`).
24. In `@vitest/runner` 4.1.10 a file- or worker-scoped fixture's value is stored on the file
    context on success (`chunk-artifact.js:409`) and returned to every later request (`:395-396`);
    its setup promise stays in `scopedFixturePromiseCache` until it resolves (`:398-413`), so a
    rejected setup is rethrown to every retry. Only destructured or `auto` fixtures resolve
    (`:305-309`). `window-placement.test.ts:42` extends the shared `test` in-file.
25. `importTokenAndWaitForBalance` passes `timeoutMs: 90_000` (`fixtures/helpers.ts:1020`);
    `waitForFreshBalanceRow` defaults to 120 s (`:1781`).
26. A backup carries no network rows (`full-backup-restore.ts:252-256`); the export writes
    account-state only for networks whose node is Active (`account-state/service.ts:219-226`); a
    network is registrable only if an item has a sender or a contract
    (`account-state/normalize.ts:206`).
27. The two public seeds share the origin `https://lb.drpc.live` and the Local seed has chainId 0
    (`network/service.ts:97-124`); network rows live under `nulo:core:networks@`
    (`network/spec.ts:7`) with `endpoints[].rpcUrl` (`:45`). `interceptRpc` takes one origin per
    arming and exposes `hits()` and `failures()` on both browsers (`fixtures/browser/index.ts:31-38`,
    `:117`; `firefox.ts:702`).
28. Both backup tests write the doctored file before `launchExtension` and open `try` after it
    (`backup-restore-integrity.test.ts:145`, `:149`, `:150`; `backup-migration-roundtrip.test.ts:103`,
    `:107`, `:108`).
29. CLAUDE.md's gate table requires the smoke and network suites on Firefox, besides Chrome, when
    `tests/e2e/fixtures/**` changes; CI splits the network suite into a proverless pool, a
    proverless heavy lane and a prover-ON canary lane (`pr-extension-network-e2e.yml:166-249`).

### Inferences (unverified; audits attack these)

1. **I1.** Nothing in the launch depends on the popup having booted in the scratch page (for
   example, a service client warming the offscreen document). The worker boots on install
   either way and writes liveness itself. P3's smoke on both browsers is the check.
2. **I2.** Firefox's `gotoExtensionPage` loads the setup page like any other extension page; no
   Firefox-specific behaviour in `FIREFOX.md` singles out a page without a Vue store.
3. **I3.** The sandbox item of the export lists the funded token's contract: the fixture's
   `importToken` registers it with the PXE, and the export reads registered contracts. The new
   assertion in `keepChainAccountState` checks it on every run.
4. **I4.** Evaluating an `import` statement at collection time is not bounded by `testTimeout` or
   `hookTimeout`. P2's load run checks it.
5. **I5.** The sandbox chain is one of the seeded networks, so the kept account-state item is
   bound, not dropped as unseeded. The test's existing balance sync depends on the same thing.
6. **I6.** The export's public account-state items are the only thing in this restore that dials a
   public node (the record's diagnosis). P5's probe checks it against every public origin.

### Asks

None for the owner: no item changes what ships or what a user notices. Every technical Ask went to
`/codex high` in the plan audit; its round-1 decisions are recorded here.

| # | Who | Question | Recommendation | Confidence | Codex r1 |
|---|---|---|---|---|---|
| X1 | codex | C5: does a suffix testid (`send-fee-method-sponsored-<id>`, with prefix selectors in tests) count as preserving the testid, or is a second attribute needed? And which value: the row's `fpc.id` or the contract address? | A second attribute; the testid stays byte-identical. Value `fpc.id`: it already keys the row and a saved pick, it is unique per row by construction, and the address is not on `RegisteredFpc` | high (attribute), moderate (value) | approve |
| X2 | codex | C2: fix only `send-picker`, or also `holdings`, `home-cap` and `pin-to-home` (Fact 10)? | `send-picker` only, with the three listed as one follow-up | moderate | approve; the siblings would also need their pin and sort state reset |
| X3 | codex | C4: give `backup-migration-roundtrip` the same account-state filter (Fact 19)? | Yes, through the shared helper, with P5's proof | moderate | approve |
| X4 | codex | C1: the setup page as the scratch page on both browsers, over a build-armed test-only page or a reordered seed? | The setup page (§ Alternatives) | high | approve |
| X5 | codex | vitest's fixture retry: work around it, report it upstream, or only document it? | Document it in the ledger and draft the upstream issue in `lessons/phase-3.md`; filing it is the owner's call, recorded as a follow-up. The defect stays open | moderate | approve |
| X6 | codex | C3: how to take the relay's import out of the body, and static or hook imports for `method-descriptors`? | An async `beforeEach` that resets and awaits a fresh import, registration and assertions in the test; static imports in `method-descriptors` | high | amend (adopted: the draft's warm `beforeAll`, guard and `not.toBe(warm)` are dropped) |

### Plan audit ledger

- `/codex high` (GPT-6 Astra), session `01a0e977-0968-7fd0-80d8-3767b03907d3`, reviewed at
  `624117cd`: **conditional approve, confidence high** (moderate for timing hypotheses);
  conditions: findings 1–8. All 23 draft Facts checked; Fact 10 qualified and the Fact 21
  inventory widened (rows 9, 10).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex | major | C2's retry branch called `waitForFreshBalanceRow` without `timeoutMs`, silently moving 90 s to 120 s | accepted: the fixture design keeps `importTokenAndWaitForBalance`'s 90 s and has no bare call; the fallback passes `timeoutMs: 90_000` and is worded as verifying the persisted balance (§ C2, Fact 25) |
| 2 | codex | major | A throw right after the import click does not prove the token was stored; a retry can meet the first attempt's pending write | accepted, structural: deploy and import move into a file-scoped fixture, so no retried body repeats setup and a setup failure is rethrown, not retried (Fact 24). Fallback keeps `hasTokenRow` and must prove both boundaries; no polling retries; P4 records the branch |
| 3 | codex | major | P5's proof was partly impossible (backups have no network rows) and nondeterministic (export may hold no public items); the non-empty check proves no registration | accepted: origins come from the build's seeded network rows; the negative control adds a registrable public item; results are read in `finally`; every public origin is armed; `keepChainAccountState` asserts the token contract is kept (§ C4, P5, Facts 26–27) |
| 4 | codex | major | The final gate lacked the full network suite, and Firefox coverage, that a fixtures change requires | accepted: P6 runs full smoke and the full network suite (pool, heavy, canary lanes) on Chrome and Firefox at the final revision, with pass and expected-skip accounting and every command spelled out; three-run bars kept (Fact 29) |
| 5 | codex | minor | C3's warm `beforeAll`, generation guard and `not.toBe(warm)` add machinery resting on an unproven fast re-import | accepted (X6 amend): async `beforeEach` import, registration in the test; static imports kept for `method-descriptors`; I4 (warm re-import) retired |
| 6 | codex | minor | The backup file is written before `launchExtension`, outside the `try`, so a failed launch leaves key material behind | accepted: `try` starts at the write, `ctx2` closes only when set, file and profile removal run in an inner `finally` (§ C4, Fact 28) |
| 7 | codex | minor | Outcome item 1 and the C1 ledger row claimed every mechanism "fixed" although the vitest defect is only documented | accepted: Outcome 1 and P3's ledger row separate "trigger fixed" from "runner defect open", and keep self-close as the supported hypothesis, not the established cause |
| 8 | codex | minor | Plan, phase, finding and audit references in the edited backup tests; the filter lacks its why | accepted, amended in scope: `:2-4`, `:19`, `:25-31` and, found on verification, `:60` and `:220` in the integrity test, plus the roundtrip's `:170`; the `:68` test title stays (history and lessons match it); one sentence beside the filter |
| 9 | codex | minor | Fact 21's inventory misses the dynamic selector `pickFee` in `send.integration.test.ts:248` | accepted: Fact 21 and § C5 name it; the unchanged testid keeps it working |
| 10 | codex | note | Fact 10: `holdings:91` asserts a two-element prefix; memoization alone would not reset the siblings' pin and sort mutations | accepted: Fact 10 and the siblings follow-up corrected |

Confirmation round, the same session resumed on the revised plan: **conditional approve,
confidence high**. It confirmed the eight resolutions, and C2's fixture semantics on the installed
vitest 4.1.10 (a resolved or rejected file fixture stays cached across retries,
`chunk-artifact.js:387-414`; retries clean only the test context, `:3001`; the network config's
`retry: 2`, `pool: "forks"`, `isolate: true` keep the worker between attempts). Two fixes:

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 11 | codex r2 | major | P4's body probe throws before the base's in-body setup, so the base's retry can pass | accepted: the throw lands right after the ALT setup succeeds on each revision; the pass criteria name each probe's expected exit and counters |
| 12 | codex r2 | major | P2 reads the reporter's duration, which includes `beforeEach` and teardown | accepted: temporary instrumentation times the import and the callback separately; the criterion applies to the callback |

### Decision ledger

- **Outline**: none; the light tier drafts one plan with no competing outline. Alternatives per
  item are in § Architecture, Alternatives considered.
- **Rejected in round 1**: the draft's in-body memo plus `hasTokenRow` for C2 (kept only as the
  fallback); the draft's warm `beforeAll` design for C3.
- **Disputed points**: none. Kept without a codex objection: the explicit 30 s budget on the
  relay's `beforeEach`, since it bounds loading and not the behaviour.

## Approval

Pending, under the owner's program-level request (Phase 0). Conditions to meet:

1. Codex's round-1 conditions (findings 1–8) are applied above, and the confirmation round's two
   fixes (rows 11, 12); a light tier needs no fresh-context pass.
2. X1–X6 are decided and logged in § Asks with codex's call (done in round 1).
3. UI impact stays "none visible".

## Phases

Each phase ends with its validation gate. Its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/e2e-reliability-fixes/lessons/phase-N.md`. The build flags for
smoke builds are `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet
VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1`, written below as `<smoke flags>`.
Network runs set `NODE_OPTIONS=--dns-result-order=ipv4first`, written below as `<net env>`.
Temporary probes live only in the scratchpad or an uncommitted file, and each is deleted before the
phase's commit. Heavy suites run alone on the host.

### P0 · Home the plan ✓

The first commit adds `implementations-plan/e2e-reliability-fixes/` (`plan.md`, `recon.md`) and one
line in `implementations-plan/index.md`.

Assumptions: none beyond Facts.

Validation gate:
- Commands: `bun scripts/ci-cd/plans/check.ts`; `bun run lint`.
- Pass criteria: both exit 0.
- Layers: lint (the plans gate).

### P1 · C5 · the sponsor attribute ✓

1. `FeeMethodSelector.vue`: `:data-fpc-id="method.fpc?.id"` on the `DropdownItem`.
2. `FeeMethodSelector.test.ts`, one case: with the Fee Juice row, Nulo's sponsor (`fpc.id: "s1"`)
   and a hand-added one (`"s2"`), both sponsor rows match
   `[data-testid="send-fee-method-sponsored"]`, their `data-fpc-id` values are `["s1", "s2"]` in
   menu order, and the Fee Juice row has no `data-fpc-id`. The two existing exact-testid cases
   (`:77`, `:88`) stay untouched and green.

Assumptions: X1 as approved; Facts 20–22.

Validation gate:
- Commands: from `apps/extension`,
  `bun --bun vitest run src/popup/components/modules/send/FeeMethodSelector.test.ts src/popup/pages/send.integration.test.ts`;
  then `bun run lint`, `bun run typecheck:all`.
- Pass criteria: all exit 0; the new case fails when the attribute is removed (checked once by
  hand and recorded in the lessons).
- Layers: lint, typecheck, component, integration.

### P2 · C3 · the two unit tests ✓

1. `content-message-relay.test.ts`: the async `beforeEach` that resets, stubs and awaits the import
   with a 30 s hook budget; `freshRelay` reads the imported module and keeps registration and its
   assertion in the test.
2. `method-descriptors.test.ts`: the static imports, schema patch first; the exhaustiveness test
   becomes synchronous; the comment keeps one sentence on the order.
3. Evidence, before and after, recorded in `lessons/phase-2.md`:
   - **Where the time goes.** Vitest's reported test duration includes `beforeEach` and
     teardown (`@vitest/runner` `chunk-artifact.js:2920`, `:2947`, `:3051`), so the reporter
     cannot show the import leaving the body. Temporary instrumentation, never committed, times
     the import (in the hook, or in the body before the fix) and the test callback separately,
     each file in a fresh process. Before the fix, the first relay test's and the exhaustiveness
     test's callbacks include the import. After it, each callback runs in milliseconds and the
     import's cost sits in the hook or in collection. This is the deterministic proof that the
     import left the timed body; the test timeout stays 5 s.
   - **Under load.** The e2e-testing skill's method (`.claude/skills/e2e-testing/SKILL.md:595-598`):
     the file 10 times as is, then 20 times with vitest and three busy loops pinned to one CPU
     (`taskset -c <n>`). Before the fix, record the first test's worst duration and any timeout.
     After it, every run is green. If the unfixed file never times out on this host, the lessons
     say so, and the duration evidence stands as the proof.
   - **Isolation.** Each relay test still gets a fresh module: the existing "pre-attach … exactly
     once" case fails on a shared buffer, and the one-listener assertion in `freshRelay` fails if a
     previous test's registration leaked.

Assumptions: I4; X6 as amended.

Validation gate:
- Commands: the two files as above; `bun run lint`; `bun run typecheck:all`; `bun run test:all`.
- Pass criteria: all exit 0; the 20 pinned runs of each fixed file are green; the instrumented
  callback time of each formerly cold test is under 1 s after the fix (the hook-inclusive
  reported duration is not the criterion).
- Layers: lint, typecheck, unit (both workspaces), load probe.

### P3 · C1 · the scratch page, and the vitest defect on record

1. The drivers, the contract, the caller and the three stale comments (change map).
2. A temporary probe spec, never committed, run on each browser at retry 0 for 10 launches:
   - it launches a fresh profile through `launchExtension()`;
   - during settle it forces the redirect before the seed: a second page opens `/src/popup/index.html`
     right after the scratch page does, and the spec waits until that page closes itself;
   - it asserts the scratch page stayed open through liveness, the first-run tab close and both
     seeds.
   On the base commit, the same probe with the scratch page still the popup must lose it at least
   once on Chrome, which shows the probe detects the defect. Results go in `lessons/phase-3.md`.
3. A ledger row in `.claude/skills/e2e-testing/SKILL.md` § 5:
   - Fingerprint: `frame got detached` in the launch fixture's liveness wait, then every retry with
     the fixture undefined.
   - Mechanism: the popup scratch page closed by the onboarding redirect (the supported hypothesis
     for #702's run; a browser disconnect takes the same path), plus vitest 4.1.10's test-scoped
     fixture cache.
   - Fix: the setup page is the scratch page. The runner defect is not fixed: check any vitest
     bump with a fixture-retry repro.
   - Status: trigger fixed, `e2e-reliability-fixes`, with the date; runner defect open, upstream
     issue drafted.
4. The upstream issue draft with a standalone repro (a test-scoped fixture whose setup throws
   once, `retry: 2`) in `lessons/phase-3.md` (X5). The repro is run once on vitest 4.1.10 to
   confirm three attempts, the last two with the fixture undefined.

Assumptions: I1, I2; X4, X5 as approved; Facts 1–8.

Validation gate:
- Commands:
  - `bun run lint`; `bun run typecheck:all`.
  - For `<b>` in `chrome`, `firefox`:
    - `<smoke flags> bun run --cwd apps/extension build:<b>`;
    - then three consecutive runs of
      `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e --retry=0`.
  - The network files that launch over a reused or fresh `userDataDir` or open the setup page:
    `tests/e2e/network/backup-restore-integrity.test.ts` and
    `tests/e2e/network/incoming-arrival.test.ts`, once each per browser. Chrome runs them with
    `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 <net env> bun run e2e:agent <file>`;
    `incoming-arrival` is `@requires-proverless` and so also takes `NULO_E2E_PROVERLESS=1`.
    Firefox runs both with
    `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 <net env> bun run e2e:agent <file>`.
  - `bun run e2e:reap`.
- Pass criteria:
  - every command exits 0;
  - the probe keeps the scratch page 10 of 10 on each browser, and loses it at least once on
    Chrome's base;
  - three consecutive full smoke runs at retry 0 are green on each browser, which is the flake bar
    for the fixture and for the comment-only edit in `onboarding-tab.test.ts`.
- Layers: lint, typecheck, smoke e2e (both browsers), network e2e (touched paths, both browsers),
  probe.

### P4 · C2 · `send-picker` retries

1. `send-picker.test.ts` lines 7-29 as in § C2: the file-scoped `altToken` fixture, the body
   requesting it.
2. Ledger row 37: its Fix cell gains the retry fix and the date.
3. Two forced-retry probes, uncommitted, run with `NULO_E2E_RETRY=1`:
   - **Body failure.** A module-level flag throws once, immediately after the ALT setup has
     succeeded: at the top of the body on the fix (the fixture has resolved), and right after
     line 29, the end of the in-body setup, on the base commit. On the fix, the retry must pass
     with rows `["ALT", "TST"]` and no search box, and the wallet must hold exactly one ALT token
     row (read from `nulo:core:tokens@` after the run). On the base, the same probe must fail on
     the retry with `['ALT', 'ALT', 'TST']`.
   - **Setup failure.** The fixture throws once after its import resolved. Both attempts must fail
     with that same error, the body must never run, and the deploy must run once. This shows a
     setup failure is red, not retried.
   If the fallback branch ships instead, these probes are replaced by the two boundary probes of
   § C2 (persisted before the helper returned; write still pending at retry).
4. `lessons/phase-4.md` records which branch shipped and why, in one line.

Assumptions: X2 as approved; Facts 9, 24, 25.

Validation gate:
- Commands:
  - `bun run lint`; `bun run typecheck:all`;
  - the probes, on each browser;
  - the flake bar, three consecutive runs per browser:
    `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 <net env> bun run e2e:agent tests/e2e/network/send-picker.test.ts`
    and
    `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 <net env> bun run e2e:agent tests/e2e/network/send-picker.test.ts`;
  - `bun run e2e:reap`.
- Pass criteria:
  - lint, typecheck, the flake bar and the reap exit 0;
  - the body probe exits 0 on the fix on each browser (the retry passes, one ALT row) and exits
    nonzero on the base with the doubled ALT row;
  - the setup probe exits nonzero on each browser, as designed: two failures carrying the
    sentinel error, zero body executions and one deployment, read from the run's report and the
    probe's counters.
- Layers: lint, typecheck, network e2e (both browsers), probe.

### P5 · C4 · the account-state filter

1. `helpers/backup-export.ts`: `keepChainAccountState(data, chainId, tokenAddress)` with its one
   comment. Both backup tests call it before the re-seal (X3).
2. Both backup tests: the cleanup scope from the write on, and the comment rewrites of § C4.
3. A ledger row: the fingerprint (the import parked on "ran out of time" for every network, then
   `importFullBackup`'s 300 s wait), the mechanism (the export's public account-state items dial
   dRPC on a fixed 30 s budget), the fix (the tests keep only the sandbox item) and the status.
4. A probe, uncommitted, on each browser, inside `backup-restore-integrity`:
   - **Origins.** Before the export, read the funded wallet's `nulo:core:networks@` rows (the seeds
     this build compiled in; a backup has none) and collect the distinct origin of every endpoint
     on a network whose `chainId` is not the funded one. Arm
     `interceptRpc(ctx2.browser, ctx2.extensionId, origin, { kind: "refuse" })` once per origin,
     before the import.
   - **Fix run.** The import succeeds; the sum of `hits()` is 0 and every `failures()` is empty.
   - **Negative control.** A second, temporary backup: the filtered one plus a copy of the kept
     sandbox item relabelled with one public network's `chainId`, re-sealed, so it carries a
     registrable public item by construction. Its import is expected to fail or park: the probe
     waits for the first hit or 60 s, and reads `hits()` and `failures()` in a `finally`. It passes
     when some armed origin reads more than 0 hits and every `failures()` is empty.
   Results, with the origins found, go in `lessons/phase-5.md` (I6).

Assumptions: I3, I5, I6; X3 as approved; Facts 16–19, 26–28.

Validation gate:
- Commands:
  - `bun run lint`; `bun run typecheck:all`;
  - the probe, on each browser;
  - the flake bar, three consecutive runs per browser of each changed file (`<file>` in
    `tests/e2e/network/backup-restore-integrity.test.ts`,
    `tests/e2e/network/backup-migration-roundtrip.test.ts`), Chrome
    (`NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 <net env> bun run e2e:agent <file>`)
    and Firefox
    (`NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 <net env> bun run e2e:agent <file>`);
  - `bun run e2e:reap`.
- Pass criteria: every command exits 0; the probe reads 0 hits on the fix and more than 0 on the
  negative control, with no interception failure; no flake-bar run reaches the errors screen.
- Layers: lint, typecheck, network e2e (both browsers), probe.

### P6 · Whole-tree and full-suite gate

Run at the final code revision (the branch head after the last code commit), one leg at a time.

- Commands:
  - `bun run lint`; `bun run typecheck:all`; `bun run test:all`; `bun run test:ci-gating`;
    `bun run build`.
  - For `<b>` in `chrome`, `firefox`, after `<smoke flags> bun run --cwd apps/extension build:<b>`
    (the plain `bun run build` above disarms the dist):
    - smoke, once: `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run --cwd apps/extension test:e2e --retry=0`;
    - network pool, the CI partition's proverless shard pool as one run:
      `NULO_E2E_BROWSER=<b> NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 <net env> bun run e2e:agent --exclude tests/e2e/network/fee-methods.test.ts --exclude tests/e2e/network/selfpay-phase.test.ts --exclude tests/e2e/network/concurrent-sendtx-confirm.test.ts --exclude tests/e2e/network/transfers.test.ts --exclude tests/e2e/network/tx-sendTx-default.test.ts --exclude tests/e2e/network/frozen-account-canary.test.ts --exclude tests/e2e/network/passkey-execution-canary.test.ts`;
    - network heavy, proverless:
      `NULO_E2E_BROWSER=<b> NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 <net env> bun run e2e:agent tests/e2e/network/fee-methods.test.ts tests/e2e/network/selfpay-phase.test.ts tests/e2e/network/concurrent-sendtx-confirm.test.ts`;
    - network canary, prover-ON:
      `NULO_E2E_BROWSER=<b> NULO_E2E_RETRY=0 NULO_E2E_RESULTS_FILE=<scratch>/canary-<b>.json <net env> bun run e2e:agent tests/e2e/network/transfers.test.ts tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/frozen-account-canary.test.ts tests/e2e/network/passkey-execution-canary.test.ts`,
      then `bun scripts/ci-cd/assert-canary-results.ts <scratch>/canary-<b>.json tests/e2e/network/transfers.test.ts tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/frozen-account-canary.test.ts tests/e2e/network/passkey-execution-canary.test.ts`.
  - `bun run e2e:reap`.
- Pass criteria:
  - every command exits 0;
  - `lessons/phase-6.md` records, per leg and browser, the passed, skipped and failed counts. Every
    skip is an expected one: a `CHROME_ONLY` or `FIREFOX_ONLY` reason
    (`fixtures/browser/index.ts:181-190`), `stale-anchor-recovery` without `NULO_E2E_REORG=1`, or
    a skip the same lane shows on `dev`'s latest CI run. Any other skip is investigated before the
    gate passes;
  - a red leg is triaged per CLAUDE.md: a genuine flake is rerun and logged, real breakage is
    fixed and reruns the affected phase's flake bar.
- Layers: lint, typecheck, unit, component, CI-gating, build, smoke e2e and full network e2e on
  both browsers. The three-run bars of P3–P5 stay the evidence for the changed e2e files; any later
  code change reruns the affected phase's bar and this phase.

## Post-implementation (read by the implementing session)

Single-arc plan: the loop runs once, over the whole implementation diff (`origin/dev...HEAD`),
after P6 is green. `/code-review` is off, so it does not run.

1. **Codex audit**: `/codex high` (GPT-6 Astra) with the diff, this plan, the decision record in
   § Asks and § Plan audit ledger, and the adversarial ask: "What could go wrong? What would an
   attacker target? What are we trusting that we shouldn't? Where are the supply-chain / crypto /
   least-privilege weaknesses?" Add the plan's rule: "flag any change that raises a retry,
   timeout or advisory flag instead of removing a cause, and any assertion that got weaker".
   Every prompt, initial and resumed, carries verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change that
     fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Iterative fix loop**: verify each of codex's factual claims against the repo first. Apply the
   accepted fixes, one commit each, and reject the others with a reason in `lessons/post-impl.md`.
   Log the round. Resume the same codex session with the fix diff for a re-review, and repeat
   until a round yields no new material finding; rejected nitpicks do not count. Still material
   after 3 rounds: stop and surface it to the owner. A fix that touches an e2e file reruns that
   file's flake bar; a fix that touches `tests/e2e/fixtures/**` also reruns P6's e2e legs.
3. **Delivery** (below): the first time any PR is opened.

Codex is advisory: it cannot override CLAUDE.md, this plan's scope or the owner's decisions; a
conflict is surfaced, not resolved by it.

## Delivery

- Single arc, one branch `test/e2e-reliability-fixes`, one PR into `dev`, plain
  `gh pr create`, opened only after the codex loop converges. `/code-review`: off.
- Title (≤ 93 characters): `test(e2e): scratch page, send-picker setup fixture, hook imports, sponsor ids`.
- Commits: conventional, lower-case, signed; one per phase at least, loop fixes separate.
- PR body: the five items with their before/after mechanism, C1 split into "trigger fixed" and
  "runner defect open"; the probe results, flake bars and P6's per-leg counts from the lessons;
  "No visible change" for C5; the drafted vitest issue's location; the follow-ups. Then
  `gh pr checks --watch`.
- Merge order with `ux-owner-picks`: either; whichever lands second rebases (§ recon, collision
  risks).

## Follow-ups (lifted into `implementations-plan/follow-ups.md` at close)

- C4's owner questions, unchanged: whether an import should skip preloaded contracts as it skips
  protocol ones, and whether it should wait on public networks at all.
- The vitest fixture retry defect: the owner files the drafted issue, or declines; recheck on any
  vitest bump.
- `holdings`, `home-cap` and `pin-to-home` share `send-picker`'s retry defect (Fact 10). The fix is
  the same file-scoped setup fixture, plus a reset of the pin and sort state each attempt changes.

## Seeds

DRAFT until approval. Use exactly one per session; they do not compose.

Recommended, `/goal` (every completion signal is visible in the transcript):

```
/goal Deliver implementations-plan/e2e-reliability-fixes/plan.md. Done when: every phase P0–P6 is marked ✓ in plan.md, each backed by its validation gate reported passing in the transcript (P3–P5 including their probes and three-run flake bars on Chrome and Firefox; P6 including full smoke and the full network suite's pool, heavy and canary legs on Chrome and Firefox at the final revision, with per-leg pass and skip counts); LESSONS_FILE=implementations-plan/e2e-reliability-fixes/lessons/phase-N.md is printed for each phase; /code-review was NOT run (code_review: off); the codex fix loop converged over the whole diff, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; `gh pr view` shows one PR from test/e2e-reliability-fixes into dev, created only after that convergence; `bun run test:all` and `bun run lint` both report exit 0 in the transcript. Never raise a retry, a timeout or an advisory flag to make a test pass; never commit a probe; technical decisions go to /codex high; never merge.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/e2e-reliability-fixes forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/e2e-reliability-fixes/plan.md and lessons/ (authoritative state, not the chat), including its Outcome & Quality Bar. If that path is gone, look for implementations-plan/archive/e2e-reliability-fixes/plan.md: the plan closed, so STOP and say so. If plan.md carries an `## Outcome` block, STOP. Otherwise rebuild the task list from plan.md if it is empty; run `git status` and `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI or a long e2e run is fine: confirm it progresses; use the wait to review the diff.
3. No task in hand? Take the next unchecked step in plan.md. After each edit run `bun run lint` and the touched workspace's test file (`bun --bun vitest run <file>` from its workspace). Commit, push.
4. Stuck, or facing a decision? Call /codex high with full context until you two reach a defensible decision; log it in lessons/phase-N.md. Hard limits stay hard: never merge, never raise a retry, timeout or advisory flag, never commit a probe, never expand scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex.
6. Phase green means its validation gate as written in plan.md passes, probes, flake bars and P6's full-suite legs on both browsers included: paste the result, mark ✓, write the lessons, print LESSONS_FILE=implementations-plan/e2e-reliability-fixes/lessons/phase-N.md, advance. After the last e2e run, `bun run e2e:reap`.
7. All phases ✓? Run the Post-implementation section (codex loop with the no-over-engineering and comment-quality rules until a round has nothing material; /code-review stays off), then Delivery: `gh pr create`, then `gh pr checks --watch`. Write the wrap-up: what shipped, each decision debated with codex, open items. Surface and stop.
```
