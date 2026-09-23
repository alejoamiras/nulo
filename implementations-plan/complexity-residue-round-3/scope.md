# Complexity residue — round 3: justify in place, refactor on merit

**Status: completed 2026-09-02** — PRs #521–#527 (plans 1–5), manifest 49 → 35, all in the accepted
form under the fail-closed ratchet; both BUG PINs flipped. Records per plan in
`implementations-plan/{harness-fixtures,fuzz-runner,operator-gates,justified-baseline,faucet-journal-bugs}/`.

Commissioned by the owner after round 2 closed at 49 directives (see
[complexity-residue-round-2/scope.md](../complexity-residue-round-2/scope.md)). The owner's framing,
2026-09-02, verbatim: *"I don't want to force going to zero … I don't want to force the code to do
something just because of a vanity metric. … those hard functions should stay as-is and instead of
having an ignore that says 'refactor when touched' should justify briefly (one-liners, or two) why
they are being ignored."*

So the category "refactor when touched" is retired. Every one of the 49 was adjudicated by a fresh
codex session (xhigh, read every function; conditional approve) and reconciled by Claude against the
code: **14 REFACTOR on merit** — the code genuinely reads or tests better under budget, never just
scores lower — and **35 ACCEPT** — the function stays as-is and its directive carries a specific
1–2 line justification. Codex also found the round-2 category rationale "scores mirror scenario
matrices" wrong for 12 harness entries (they are scanners, predicates, parsers, cleanup aggregates)
and "run-once tooling" wrong for `live-intent`'s verify/promote (independent, non-broadcasting
security gates bundled into one function each). **Target: manifest 49 → 35, all 35 justified.**

This file is the binding list; the driving /goal references it. Tiers as in round 2: **BL/C** =
blueprint + characterization pins committed first · **BL/E** = blueprint over existing suites ·
every plan runs the codex iteration loop (plan audit → per-PR review until approve; ONE resumed
codex session per plan).

## Order (strictly sequential — the tooling flip is LAST so every survivor is justified in one PR)

### 1 · harness-fixtures (BL/E, 2 PRs) — 49 → 43
- **PR-a — dedups + seams** (5): `tests/e2e/fixtures/helpers.ts:1318` + `:1402` — ONE
  browser-side `(account, token)` storage join, evaluated by both `captureBalanceBaseline` and
  `waitForFreshBalanceRow`'s `readRows` (the Node side derives `max(updatedAt)` from the rows; the
  evaluated function must stay self-contained — Puppeteer serializes it); `network/account-switch-isolation.test.ts:103`
  — reuse the file's own `resolveActiveTriple` (line ~222) instead of the inlined copy, extract the
  held/record polling; `import-dead-rpc.test.ts:102` — pure `planBatchReplies(body, answer)` →
  `{ replies, blackhole, wasBatch }`, unit-tested for the blackhole-whole-batch semantics, socket
  handling untouched; `network/backup-restore-sw-restart.test.ts:169` — extract the stuck-outcome
  diagnosis / residue read / recovery probe so the crash→rollback→retry headline path reads flat.
  Gates: account-balance-orphans · balance-row-reconciliation · backup-roundtrip-e2e-import ·
  profile-reimport-matrix · account-switch-isolation · backup-restore-sw-restart · import-dead-rpc.
- **PR-b — global-setup stages** (1): `tests/e2e/global-setup.ts:232` (81) → `setup` coordinates
  `reconcilePriorLock` / `ensureAnvil` / `ensureAztec` / `ensureDevServer` (+ faucet), one
  provisioning/failure path instead of the repeated `project.provide` + skip blocks. This is the
  parallel-safe runner every network spec boots through: no characterization possible, so the gate
  is the FULL network suite on CI (sharded) plus one local sequential run of ≥ 4 specs incl. a
  reuse-path boot (`bun run e2e:agent` twice in a row) and the `E2E_REQUIRE_SETUP=1` fail-loud path.
  Update `tests/e2e/README.md` + the `e2e-testing` skill where they describe setup.

### 2 · fuzz-runner (BL/E, 1 PR) — 43 → 41
- `stores/balances.store.fuzz.test.ts:123` (103) + `:208` (29): a fuzz-world driver (mock setup,
  operation dispatch, drain, probes) with `runTape` as the readable coordinator, and
  `assertWorldInvariants(world)` as the independently testable model oracle. Equivalence proof:
  the suite's fixed-seed runs (`numRuns`, seed) produce identical failure/success on the pre- and
  post-refactor tree; the printed seed/path reproduction contract stays. Gates: the fuzz suite ×5,
  `balances.store` unit suites, account-balance-orphans · balance-row-reconciliation.

### 3 · operator-gates (BL/C, 1–2 PRs) — 41 → 35
- `packages/bridge-core/scripts/live-intent.ts:305/306` `verify` (91L, 61) → thin ordered
  coordinator over named gates: intent-committed, tree-clean, source-commit-unchanged, identity,
  signer, artifact digests, candidate readbacks, spend caps. `:487/488` `promote` (91L, 35) →
  ordered stages: digest-required, gate, fpc-required, symlink rejection, read-once + byte pin,
  faucet-candidate derivation, zero-seed, temp-write + rename + re-hash, receipt. **Order and
  fail-closed wording are the spec** — every `STOP` message preserved verbatim; pins = unit tests
  of the pure gates with injected `run`/`git`/`cast`/RPC probes (never a broadcast; codex's own
  condition). `scripts/ci-cd/test-soak/lib.ts:291/307` `compareSummaries`/`checkSide` → named
  validators returning problems; `checkSide` takes explicit inputs instead of mutating outer state;
  existing `test-soak` tests zero-edit green plus the new validator tests.

### 4 · justified-baseline (BL light, 1 PR) — manifest stays 35, every directive rewritten
- **Directive form**: `// biome-ignore lint/complexity/<rule>: accepted at score N — <one specific
  sentence>` (`accepted at N lines — …` for the length rule). Drafts for all 35 are in the ACCEPT
  table below; tighten at the line, never a category label.
- **Scanner** (`scripts/complexity-baseline/scan.ts`): a budget-rule directive whose reason does not
  match the accepted form is `forbidden` — that rejects the legacy `baseline (` text, the generator
  marker, block comments and every broad form. Each acceptance is anchored to the first declaration
  under it (read through a paired directive, a doc block, blanks), and that declaration line must be
  unique in its file. Both `check.ts` (local, pre-commit) and `scripts/ci-cd/complexity-baseline.test.ts`
  (CI) inherit it.
- **Manifest** pins each acceptance as `{file, rule, anchor, accepted, sentence}`. Tree and manifest
  must match entry by entry (added / removed / moved / re-stamped / reworded all fail until
  regenerated). On a PR the CI mirror also ratchets head against the base branch's manifest: on the
  same Biome no added entry, no raised stamp, and no move (a signature edit or file move keeping
  the declaration NAME, rule, stamp and sentence pairs as a move, refused unless the PR carries the
  owner's `baseline:move-approved` label; a copied sentence on a differently named function, or any
  edit to an anonymous callback's line, is an add) — a hand-edited row matches the tree but not the
  base, and a `rules` summary that disagrees with the entries is refused. The base is
  the pull_request event's exact `base.sha`; a base that predates entries is ratcheted on per-rule
  totals derived from the head entries.
- **Generator** (`generate.ts`): for a function newly over budget it inserts
  `JUSTIFICATION REQUIRED (observed score N): refactor, or replace this line with "accepted at score N — <why>"`
  — which the scanner refuses — and exits 1 without writing the manifest. It never re-stamps.
  `--adopt` is accepted only when the manifest's pinned Biome differs from the installed one; a
  manifest without entries is refused (no shape migration hatch).
- **Rescore audit** (`rescore.ts`, CI in `test:ci-gating` + `bun run baseline:rescore`): one sibling
  copy per accepted file with all its directives removed, originals + copies in ONE Biome run,
  pairing by file → rule → sorted line; `observed !== accepted` fails in either direction, a stale
  directive fails, an unsuppressed offender in an original fails. The stdin approach was dropped —
  Biome's stdin mode prints code, not diagnostics.
- NOT built: copy-paste / generic-phrase detectors (over-engineering; review catches prose).
- Docs: CLAUDE.md § Complexity budgets (no "refactor when touched"; the accepted form; the marker;
  the audit), the residue ledger artifact, this file's ACCEPT table = the 35.

### 5 · faucet-journal-bugs (BL/C, 1–2 PRs) — the two BUG PINs preserved in round 1
- **Bug A — stale `fuel` spread in useDeposit** (`apps/faucet/src/composables/useDeposit.ts` +
  `deposit-flow.ts`): journal patching is shallow, nested `fuel` patches are wholesale replacements,
  and several callbacks spread a STALE captured `fuel`: the public-fjwc PROPOSED write drops the
  pre-send `claimAttemptAt`; the direct-FJ `latchFuel` can resurrect a cleared `setupInsufficiency`.
  Pinned by `useDeposit.characterization.test.ts` "(BUG PIN) PROPOSED write drops the pre-send
  claimAttemptAt" (snapshot `fjwc-latch-patches`) — see
  [deposit-decomposition/plan.md](../deposit-decomposition/plan.md) item 8. Fix shape is a codex
  back-and-forth: read-current-then-patch at each site vs deep-merging `fuel` in the journal's
  patcher (which changes every other `fuel` write's semantics) — pick the one that cannot regress
  the clean-latch reading elsewhere. The pin flips to the fixed behavior in the same PR.
- **Bug B — the reverted-hash trap in useBridgeJournal** (`apps/faucet/src/composables/useBridgeJournal.ts`
  ~889–940): a terminal `reverted` receipt RETAINS `claimTxHash`, so every Retry re-enters the
  receipt path and can never resend, while the card copy says "You can retry from this card".
  Pinned by `useBridgeJournal.stages.test.ts` "(e) (BUG PIN) the reverted-hash trap" — see
  [journal-engine-decomposition/plan.md](../journal-engine-decomposition/plan.md) item 3. The keep
  was deliberate for hash-scoped landed provenance (`reportRevertedClaim`), so the fix is adjudicated
  with codex: clear the hash on a TERMINAL revert only (dropped-debounce and proposed/pending paths
  untouched, sent-claim monotonicity preserved) vs keep the hash and allow a fresh send with the new
  hash superseding. The pin flips; the F11 generation fence stays AS IT IS (hardening is out of
  scope).
- Gates: faucet unit suites (`useDeposit.characterization`, `useBridgeJournal.stages`,
  `useFuel.pins`, `fuelClaim.precedence.pins`) + faucet e2e `bridge-smoke` · `fuel-smoke`.

## REFACTOR (14) — the code must read or test better, or it becomes ACCEPT

| file:line | rule · score | shape |
|---|---|---|
| `apps/extension/src/stores/balances.store.fuzz.test.ts:123` | cognitive 103 | fuzz-world driver; `runTape` = coordinator |
| `apps/extension/src/stores/balances.store.fuzz.test.ts:208` | cognitive 29 | `assertWorldInvariants(world)` model oracle |
| `apps/extension/tests/e2e/fixtures/helpers.ts:1318` | cognitive 28 | shared browser-side `(account, token)` join |
| `apps/extension/tests/e2e/fixtures/helpers.ts:1402` | cognitive 32 | same join; polling reads as policy |
| `apps/extension/tests/e2e/global-setup.ts:232` | cognitive 81 | stage coordinator (`reconcilePriorLock`, `ensureAnvil`, `ensureAztec`, `ensureDevServer`) |
| `apps/extension/tests/e2e/import-dead-rpc.test.ts:102` | cognitive 26 | pure batch parser / reply planner |
| `apps/extension/tests/e2e/network/account-switch-isolation.test.ts:103` | cognitive 17 | reuse `resolveActiveTriple`; extract polling |
| `apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts:169` | cognitive 18 | extract stuck-outcome diagnosis + residue reads |
| `packages/bridge-core/scripts/live-intent.ts:305` | 91 lines | `verify` = ordered gate coordinator |
| `packages/bridge-core/scripts/live-intent.ts:306` | cognitive 61 | same |
| `packages/bridge-core/scripts/live-intent.ts:487` | 91 lines | `promote` = ordered stage coordinator |
| `packages/bridge-core/scripts/live-intent.ts:488` | cognitive 35 | same |
| `scripts/ci-cd/test-soak/lib.ts:291` | cognitive 41 | named validators returning problems |
| `scripts/ci-cd/test-soak/lib.ts:307` | cognitive 31 | `checkSide` with explicit inputs |

Marginal by score (18, 26 — `backup-restore-sw-restart`, `import-dead-rpc`): kept in REFACTOR
because the extraction is small and exposes the scenario; if the PR-a diff shows otherwise, move
them to ACCEPT with a justification and say so in the PR body.

## ACCEPT (35) — stays as-is; the directive carries this reason (codex drafts; the sentence at the line + `manifest.json`'s anchor/stamp entry are the record)

| file:line | accepted at | reason |
|---|---|---|
| `apps/extension/src/components/JsonViewer/creator.js:7` | 154 lines | one declarative CodeMirror theme value; splitting selector groups would only fragment it |
| `apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts:140` | score 19 | the fake implements Chrome storage's null / string / string[] lookup contract; those branches are its API |
| `apps/extension/src/stores/activity.store.ts:103` | 122 lines | one Pinia closure owns the scoped slices and the ABA-safe mutation fences shared by every action |
| `apps/extension/src/utils/amount.ts:237` | score 22 | sign, truncation, padding, zero trimming and separators are the integer-formatting algorithm itself |
| `apps/extension/src/utils/log-payload-ban.test.ts:154` | score 41 | a lexer state machine: comment, quote, regex and template-interpolation precedence must stay together |
| `apps/extension/src/utils/log-payload-ban.test.ts:417` | score 17 | one scan preserves per-file lexical state, source offsets, call windows and deduplication |
| `apps/extension/src/wallet/logger/utils.ts:177` | score 45 | the ordered recursive shape walker IS the redaction policy; extraction would scatter security precedence |
| `apps/extension/src/wallet/services/backup/footprint-coverage.test.ts:76` | score 17 | the loops enumerate every row-transform DSL clause into its required samples |
| `apps/extension/src/wallet/services/backup/row-map-migration.ts:158` | score 24 | hostile-JSON cloning keeps primitive, prototype, accessor, array-index and recursion checks adjacent |
| `apps/extension/src/wallet/services/backup/row-map-migration.ts:298` | score 39 | clause order and presence guards ARE the row-transform DSL interpreter semantics |
| `apps/extension/src/wallet/services/backup/row-map-migration.ts:339` | score 23 | the explicit source-type × destination-type matrix defines the permitted coercions |
| `apps/extension/src/wallet/services/execution/fee/fee-strategy-clamp-properties.test.ts:56` | score 19 | each generated tuple must branch between rejection and the complete postcondition set |
| `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:118` | score 21 | the ordered single-shot validation ladder is the reuse-authorization checklist |
| `apps/extension/src/wallet/services/execution/operation-fingerprint.ts:31` | score 25 | recursive type-tagged encoding must reject unsupported shapes while canonicalizing arrays and objects |
| `apps/extension/src/wallet/services/incoming-transfer/service.scenarios.test.ts:94` | score 30 | clearing a chain atomically covers records, trust, cursors and outbox under one scope predicate |
| `apps/extension/tests/e2e/fixtures/extension.ts:624` | score 19 | in-browser diagnostic scanning exactly the account/network roots in serialized or object form |
| `apps/extension/tests/e2e/fixtures/extension.ts:1006` | score 29 | the predicate implements Puppeteer's exact exists / visible / hidden selector semantics in-page |
| `apps/extension/tests/e2e/fixtures/journal.ts:41` | score 16 | one tolerant in-browser journal scan projecting the exact lean record view |
| `apps/extension/tests/e2e/fixtures/journal.ts:174` | score 18 | one tolerant scan applies the diagnostic allowlist before data crosses into CI artifacts |
| `apps/extension/tests/e2e/fixtures/journal.ts:404` | score 26 | parse, session filter, stage classification and three threshold checks form one polling predicate |
| `apps/tools/src/lib/errors.ts:39` | score 21 | ordered overlapping message predicates are the error-classification precedence policy |
| `apps/tools/src/lib/phase-clock.ts:26` | score 22 | pending / active / failed / done transitions specify the latest-attempt temporal reducer |
| `packages/bridge-core/scripts/deploy-sandbox.ts:117` | 197 lines | shared live handles make L1/L2 deployment, wiring and optional smoke one auditable sandbox recipe |
| `packages/bridge-core/scripts/deposit-testnet.ts:73` | 155 lines | the deploy → deposit → claim → withdraw proof shares ephemeral addresses and secrets in one custody trace |
| `packages/bridge-core/scripts/discover-mainnet-fuel.ts:78` | 87 lines | one evidence transcript links identity checks, pool discovery, quotations and the winning manifest block |
| `packages/bridge-core/scripts/discover-mainnet-fuel.ts:79` | score 32 | the nested fee-tier cross-product and failed-quote reporting are the discovery matrix |
| `packages/bridge-core/scripts/fpc-dust-canary-mainnet.ts:71` | score 23 | the live canary binds fee sizing, deposit evidence, repriced retries and balance-delta acceptance |
| `packages/bridge-core/scripts/relay-claim-testnet.ts:60` | 93 lines | offline validation, wallet setup, contract registration and submission form one ordered custody procedure |
| `packages/bridge-core/scripts/relay-claim-testnet.ts:61` | score 22 | the wrong-recipient canary and the bounded claim retry are explicit security outcomes of that procedure |
| `packages/wallet-core/src/base/topology.ts:53` | score 29 | validation, layered Kahn traversal and cycle detection are one conventional topological algorithm |
| `packages/wallet-core/src/utils/serialization.ts:27` | score 23 | upstream-compatible replacer dispatch defines the JSON wire form of each supported runtime type |
| `scripts/ci-cd/test-soak/cli.ts:145` | score 19 | one temp lifecycle owns hooks, the child group, reporter evidence, early failures and guaranteed cleanup |
| `scripts/ci-cd/test-soak/cli.ts:281` | score 25 | the flat CLI grammar, terminator, typed runtime and required-field checks are the parser specification |
| `scripts/ci-cd/test-soak/cli.ts:317` | score 16 | one coordinator binds two launch modes to provenance capture and summary emission |
| `scripts/ci-cd/test-soak/lib.ts:171` | score 22 | nested reporter traversal keeps file failures, duplicate test identities, status counts and messages together |

Rules that survive this round unchanged: never raise a ceiling, never hand-edit `manifest.json`,
never add a suppression outside the accepted form; a NEW accept above score 35 needs owner
sign-off; never refactor a function into worse shape to hit the number.
