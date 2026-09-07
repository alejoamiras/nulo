---
plan: dedup-p2-adopt-helpers
tier: light
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p2-adopt-helpers (branch worktree-dedup-p2-adopt-helpers, on top of worktree-dedup-p1-delete / PR #561)
ledger: implementations-plan/dedup-ledger (phase P2)
status: codex conditional-approve 2026-09-07, every condition adopted below — approved per the ledger README's pre-approval rule; implementing
---

# P2 — adopt the helper that already exists

Seventeen ledger findings (X2 X3 X6 X1 E1 H3 J5 H1 C3 C8 L4 K2 M7 G2 G3 D5 L6; J5 skipped after audit, see the log) share one shape: a
helper exists, and a call site re-typed it inline. This phase replaces every such copy with an import.
No behaviour changes, no new abstractions beyond four tiny helpers the ledger already calls for, ≈−290
net lines. Scope is exactly those ids; a finding that turns out unsafe on contact is skipped and logged.

## Architecture & Implementation

**Reuse vs new** (from `recon.md`): 11 rows reuse existing code as-is or by delegation; 4 add a helper
next to an existing sibling; 2 are in-file hoists.

New or moved helpers, each in the lowest layer that already has every consumer above it:

| Helper | Home | Contract |
|---|---|---|
| `deferred<T>(): PromiseWithResolvers<T>` | `packages/wallet-core/src/utils/deferred.ts`, exported from `@nulo/wallet-core/utils` (promoted from `rw-guard.ts`'s module-private copy) | `{ promise, resolve, reject }`; no platform polyfill assumed |
| `copyWithToast(value, openToast, successLabel, opts?)` | `apps/extension/src/utils/clipboard.ts` beside `copyToClipboard` | fixes the failure toast (`Couldn't copy`, `warning`, 3 000 ms); `opts.sanitize` passes through. `copyAddressToClipboard` is left untouched (its falsy guard and `Couldn't copy address` label differ). The two sites with different failure copy (`IncomingTrustPopup.vue`, `received-copy.ts`) stay inline |
| `isNewPasswordValid(password, repeated)`, `newPasswordHint(password, repeated)` | `apps/extension/src/utils/password.ts` (new, pure) | valid ⇔ `password.length >= 8 && password === repeated`; hint = the existing 4-branch string verbatim |
| `randomIdNotIn(taken: (id) => boolean, length = 8)` | `apps/extension/src/wallet/services/id-allocators.ts` beside `nextRandomId` | sync sibling for in-memory maps, used at all three E1 sites (the dApp-interaction loop runs inside a lock over a sync `Map`; no `await` is added there); lengths stay 16 / 8 / 8; `nextRandomId` unchanged |
| `requireArtifact(instances, artifacts, address)` | moved to `execution/contract-resolver.ts`, exported | throws exactly `"Contract not found"` / `"Contract artifact not found"` |
| `buildIncomingCardProps(inc, token, amountFiat)` | `apps/extension/src/utils/received-display.ts` beside `receivedLabel` / `resolveReceivedType`, which both callers already import | pure; callers keep their own token/fiat lookup |
| `isEmbeddedFeePayment(op: DraftOperation)` | `packages/wallet-bridge/src/operation-validation.ts`, extracted from `requiresFeeSelection`'s inline booleans; re-exported by the popup shim `popup/windows/execute/operation-validation.ts` | `requiresFeeSelection`, `dapp-interaction/materialize.ts`, both `execute/index.vue` branches and `OperationCard.hasEmbeddedFee` call it; `!== undefined`, default-entrypoint and `!isSelfPay` preserved; a parity test pins gate ⇔ predicate |

Call-site rewrites (no new code): X2 → `errorMessageFromUnknown` at 39 sites (wallet-core sites import
`../utils/errors`; every other package imports `@nulo/wallet-core/utils`); X6 → `toBase64`/`fromBase64`
(encoding only in `integrity.ts`, see the audit log); H3 → `createRunFence()` in `useProfileBootstrap`,
keeping the module-level fence and the promise-identity cleanup (the in-flight map stores the run's
`isCurrent` closure instead of a generation number); E1 → `randomIdNotIn` at all three sites; C8 → a private `reject(estimateId, reason)` mirroring
`OperationEstimateReuse`; G2 → `log()` delegates to `logWithContext(undefined, …)`; G3 → hoist the
`FunctionCall`; D5 → private `patchAccountField`; L6 → local `readMap(key)`; M7 → `formatLogData`.

**Critical flow that must not change:** `dapp-session/integrity.ts` (X6) keeps its `Buffer.from(mac, "base64")`
decoder: `fromBase64` is strict where `Buffer` is permissive (a valid MAC with trailing garbage verifies
today and would stop verifying), and a stricter verifier is a behaviour change this phase may not make.
Only the encoder (`toBase64`) is adopted there. `useFullBackupImport`'s decode is safe to swap: its input
was already screened through `fromBase64` in `full-backup-helpers.ts:42`.

**Alternative not taken:** native `Promise.withResolvers()` for X3. TS 6.0.3 types it and Chrome/Bun
ship it, but the Firefox build's floor is not pinned in the manifest; a wallet-core export costs six lines
and needs no platform assumption.

## Phases

### Phase 1 — cross-package helpers (X2, X3, X6) ✓

Replace the 39 inline error ternaries (delete `migrator.ts`'s local `message()`), the 6 deferred-promise
copies (new `deferred.ts` + `rw-guard.ts` adoption), and the 2 `Buffer` base64 sites.

**Validation gate** — commands, from the worktree root:
`bun run lint && bun run typecheck:all && bun run --cwd packages/wallet-core test && bun run --cwd packages/extension-messaging test && bun run --cwd packages/aztec-runtime test && (cd apps/extension && bun --bun vitest run src/wallet/services/execution/execution-mutex.test.ts src/wallet/services/wallet-sdk/session-baton.test.ts src/wallet/services/window-manager/window-manager.test.ts src/wallet/services/dapp-session/integrity.test.ts src/composables/useFullBackupImport.test.ts src/wallet/utils/offscreen.test.ts src/wallet/services/wallet-sdk)`.
Pass: every command exit 0. Layers: lint/typecheck + unit.

### Phase 2 — service and utility helpers (E1, C3, C8, D5, G2, G3) ✓

`patchAccountField` keeps everything both methods do today: the profile/chain ownership check under the
tuple lock, unchanged-value suppression, and emit-after-write ordering.

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (cd apps/extension && bun --bun vitest run src/wallet/services/task src/wallet/services/window-manager src/wallet/services/dapp-interaction src/wallet/services/execution/tx-request-builder.pins.test.ts src/wallet/services/execution/authwit-discoverer.test.ts src/wallet/services/execution/helpers/batched-view-simulation.test.ts src/wallet/services/execution/transfer-estimate-reuse.test.ts src/wallet/services/account src/wallet/logger src/wallet/services/token)`.
Pass: exit 0 each. Layers: lint/typecheck + unit.

### Phase 3 — UI-side helpers (X1, H1, H3, K2, L4, L6, M7) ✓

**Validation gate**: `bun run lint && bun run --cwd apps/extension typecheck && (cd apps/extension && bun --bun vitest run src/utils src/components/header-copy-address.test.ts src/composables src/popup/windows/execute src/popup/components/modules/general src/popup/components/modules/activity src/popup/components/modules/send src/popup/pages/settings src/components/composite/import src/components/JsonViewer) && bun run --cwd packages/wallet-bridge test`.
Pass: exit 0 each; new `password.test.ts` and the extended `clipboard.test.ts` green. Layers:
lint/typecheck + unit + component.

### Phase 4 — full local gate

**Validation gate**: `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0 each, quoted
in the transcript. No e2e locally (CI's smoke + network run on the PR).

## Security & Adversarial Considerations

- **Threat surface unchanged.** No trust boundary moves; every rewrite is a call-site substitution of a
  helper with identical semantics for the inputs those sites produce.
- **X6 / `integrity.ts`** is the one crypto-adjacent site (HMAC over a dApp session row). Decoding
  changes, the comparison does not; the `try/catch` stays so malformed input verifies `false`. Covered by
  `integrity.test.ts`, which must keep its malformed-MAC case green.
- **X2** never changes what reaches a log line: the helper returns the same string the ternary did for
  `Error`, string, `null`, `undefined` and everything else. Logging policy (CLAUDE.md) is untouched.
- **X1** keeps `sanitize: true` on the address wrapper; the general helper defaults `sanitize` to
  `false`, exactly what the 17 sites pass today.
- **Supply chain**: no dependency added or bumped.

## Assumptions

**Facts (verified in the worktree)**
1. `errorMessageFromUnknown` — `packages/wallet-core/src/utils/errors.ts:8`; `@nulo/wallet-core`'s
   `package.json` exports `./utils` → `src/utils/index.ts`. 39 inline ternary sites in 30 files.
2. `nextRandomId(storage, length = 8)` — `apps/extension/src/wallet/services/id-allocators.ts:39`;
   `TaskService.startNewTask` (`task/service.ts:103`) and `WindowManager.openAndAwait`
   (`window-manager.ts:64`) return synchronously; `DappInteractionService.requestCapabilities` is async.
3. `createRunFence()` — `src/composables/runFence.ts:13`, adopted by `popup/network-switch.ts` and
   `RecentActivityView.vue`.
4. `copyToClipboard` — `src/utils/clipboard.ts:30`; `copyAddressToClipboard` —
   `src/components/header-copy-address.ts:11`, its only caller `Header.vue`. 17 `copyToClipboard(` SFC
   sites.
5. `toBase64`/`fromBase64` — `packages/wallet-core/src/utils/encoding.ts:21,34`.
6. `requireArtifact` — `execution/tx-request-builder.ts:546`, module-private.
7. `formatLogData` — `src/components/JsonViewer/logs-format.ts:44`.
8. TypeScript 6.0.3 (`packages/wallet-core/node_modules/typescript/package.json`); `lib` is `["ESNext", "DOM", "WebWorker"]`.
9. `requiresFeeSelection` — `packages/wallet-bridge/src/operation-validation.ts:29` already computes the
   embedded-fee booleans inline; `dapp-interaction/materialize.ts:84` repeats them.
10. `receivedLabel` / `resolveReceivedType` — `apps/extension/src/utils/received-display.ts:30,45`; `logs-csv.ts` lives under `components/JsonViewer/`.

**Inferences (unverified — the audit should attack these)**
- Seventeen copy sites pass the identical failure toast (grep-confirmed); `IncomingTrustPopup.vue` and
  `received-copy.ts` differ and stay inline.
- `useProfileImportFlow`'s extra `!repeatedPassword.value` check is implied by
  `password === repeated && password.length >= 8`, so the shared predicate is equivalent.
- The `background.ts:779-783` deferred site has no reject path that the shared helper would change.

**Asks** — none open. The README's owner decisions pre-answer tier, review setting, delivery and approval.

## Post-implementation

1. `code_review` is `off`: `/code-review` is NOT run.
2. **Codex audit** (`/codex high`, GPT-6 Astra): send the net diff `git diff worktree-dedup-p1-delete...HEAD -- . ':!implementations-plan'`,
   this plan, `recon.md`, the ledger rows, an adversarial/security ask, and — verbatim — the two rules:
   *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
   configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If
   code works and is clear, leave it alone."* and *"Audit the comments for value per character. Flag any
   comment that narrates what the code visibly does, restates its line, references implementation plans /
   phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
   invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future
   reader, human or LLM, pays to re-read: they must be few, dense, and exact."* Tell codex not to run the
   vitest e2e configs.
3. **Fix loop**: verify each claim against the tree, apply accepted fixes, commit, log the round in
   `lessons/phase-N.md`, RESUME the same codex session with the fix diff. Repeat until a round reports no
   new material findings (quote it). Still material after 3 rounds → surface and hold.
4. **Delivery** (below) — the first and only time a PR is opened for this phase.

## Delivery

Single arc = this branch, one PR, stacked on P1: `gh stack submit --auto --open` from this worktree
(the stack metadata is mirrored into this worktree's gitdir), then `gh pr edit <n>` with the ledger title
`refactor: adopt the shared helpers that call sites re-typed inline` and a body listing ids addressed,
ids skipped with reasons, net LOC, the Phase 4 gate output and the codex rounds. Then
`gh pr checks <n> --watch`; red = flake → re-run once, red again → fix or hold. Green → README row P2 =
`open #<n> · green`, `agent-worktree status`, print `LESSONS_FILE=implementations-plan/dedup-p2-adopt-helpers/lessons/phase-4.md`.
**Never merge**; the owner lands the stack bottom-up.

## Audit log

**Codex plan audit** (`/codex high`, GPT-6 Astra, session `01a07c3e-da4b-72c2-ac4c-5c4c80a82bfb`): *conditional approve*. Every condition verified against the tree and adopted:

| Finding | Verified | Decision |
|---|---|---|
| X1: `copyAddressToClipboard` guards falsy input and uses a different failure label; a one-line delegate would change copy | yes (`header-copy-address.ts:11-18`) | wrapper left untouched; `IncomingTrustPopup.vue` and `received-copy.ts` (different failure copy) stay inline; `ScopeAddress`/`ScopeClassId` keep `sanitize: true` via `opts` |
| L4 sibling is `utils/journal-state.ts:329`, not `recent-activity-rows.ts`; M7 file is under `JsonViewer/`; TS is 6.0.3 | yes | helper homed in `utils/received-display.ts` next to the two functions both callers import; paths and version corrected |
| E1: all three loops are synchronous; the dApp-interaction one runs inside a lock, so an `await` would be wrong | yes (`dapp-interaction/service.ts:371`) | `randomIdNotIn` at all three sites, lengths preserved |
| J5 ≠ H3: the pages capture without incrementing and bump on edit/unmount; `begin()` increments on every capture, so repeated file picks would stop sharing a generation | yes (`accounts/import.vue:39-56`) | **J5 skipped** — preserving its semantics defeats the saving; logged in lessons |
| X6: `Buffer.from` is permissive, `fromBase64` (atob) strict; a valid MAC with trailing garbage verifies today and would not after the swap | yes (`integrity.ts:58`, `encoding.ts:30-34`) | decoder kept; only `toBase64` adopted in `integrity.ts`; `useFullBackupImport` decode swapped (input pre-screened) |
| K2: the predicate already exists inline in wallet-bridge's `requiresFeeSelection` and is repeated in `materialize.ts` | yes | `isEmbeddedFeePayment` extracted in wallet-bridge, used by the gate, `materialize.ts`, `execute/index.vue`, `OperationCard.vue`; parity test added |
| D5: the two methods check stored ownership under the tuple lock, suppress unchanged values, emit after write | yes (`account/service.ts:306`) | `patchAccountField` keeps all of it |
| Gates: `src/components/LogsViewer` matches nothing; Phase 1 should also run `offscreen.test.ts` and the wallet-sdk tests | yes | fixed |

Rejected: none. Owner ask surfaced: none (no behaviour-change exception requested).

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` is already driving this phase
and supersedes a plan-local seed. For a fresh session picking up only this phase:

```
/goal All four phases marked ✓ in implementations-plan/dedup-p2-adopt-helpers/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p2-adopt-helpers/lessons/phase-N.md` printed per phase; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p2-adopt-helpers with base worktree-dedup-p1-delete only after the loop converged, `gh pr checks` all green, no merge command run.
```
