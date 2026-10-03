---
plan: harden-dedupe / error-registry (arc 5 of 25)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/05-error-registry, stacked on hd/03-visual-shells-a
---

# error-registry: one list of the wire errors a code rebuilds as

Finding Q-20, from `audit/quality/2026-09-30-dedup-high/`. "Code X rebuilds as class X" is stated three times in `packages/extension-messaging/src/errors.ts`, and a fourth time in its test. This batch states it once. No error's class, `name`, `code`, message or details change, on either side of a port.

## Outcome & Quality Bar

- **For whom:** the next person who adds a wire error. Today that takes four edits (class, union member, switch case, test list) plus two hand-bumped counts in test names, and a missed switch case compiles, then fails an `instanceof` silently after the port.
- **Excellent:**
  - A new reconstructable error is one class plus one registry entry.
  - A test fails until every exported `WalletError` subclass is classified: rebuilt, client-local, or rebuilt as the base on purpose.
  - Every class's `name`, `code`, prototype and rebuilt message and details are pinned by literal values, before and after the refactor.
- **Good enough:** the 24 class declarations stay as they are. Each one holds frozen wire facts (literal `name`, `CODE`, default message) and its own TSDoc.

## Architecture & Implementation

All in `packages/extension-messaging/src/errors.ts` (614 lines today) and its test. No other file changes.

- **Today:**
  - 24 `WalletError` subclasses at `:50-478`.
  - `KnownWalletErrorPayload`, a 22-member union at `:480-511`, used only to type `details` per switch case.
  - `walletErrorFromPayload`'s switch at `:518-573`, with the base `WalletError` default at `:571-572`.
  - Not rebuilt: `TooManyPendingError` (`:213-219`, a pinned omission, falls to the default) and `RpcConnectError` (`:86-93`, client-local).
- **What changes:**
  - Delete the union (`:480-511`) and the switch body.
  - `CapabilityNotGrantedError` (`:179-185`) gains `static fromPayload(payload)`. Its body is today's case at `:533-536` verbatim: `new CapabilityNotGrantedError(details?.capabilityType ?? "unknown", payload.message)`, behind one documented cast of the unvalidated wire `details`. It is the one class whose constructor does not take `(message, details)`.
  - A module-private `REBUILT_AS` array of the 22 classes the switch covers today, and `BY_CODE`, a `Map` from each class's `CODE` to its class. The array's comment names the two deliberate absences.
  - `BY_CODE`'s value type is explicit: `typeof CapabilityNotGrantedError | (new (message: string, details?: never) => WalletError)`. A future constructor that *requires* typed details then fails to compile instead of hiding behind the cast.
  - `walletErrorFromPayload` becomes: look up `BY_CODE`; no entry rebuilds the base `WalletError` exactly as `:572` does; `CapabilityNotGrantedError` uses its `fromPayload`; every other class is `new C(payload.message, payload.details as never)`, under one short comment: constant-message constructors ignore both arguments, and `ScopeViolationError` ignores details. The `never` cast replaces today's `payload as KnownWalletErrorPayload`, with the same meaning: the wire's `details` is unvalidated.
  - The deleted union's comment cites "Q-01", a finding tag that the comment style bans; it leaves with the union.
  - **Comment fixes, in the lines this arc owns:** `:174-177` and `:208-211` lose the false claim that interpolated text breaks `JSON.stringify` (the stable-copy and privacy reasons stay); `:432-437` shrinks to one sentence on the WebAuthn `userHandle` / profile-id invariant.
- **Why one uniform call is byte-identical** (this corrects recon's "no-arg classes need per-class rebuild"):
  - The four constant-message classes (`ChainNotSupportedError` `:305-312`, `TermsAcceptanceRequiredError` `:334-341`, `SessionEndedError` `:348-355`, `OperationNotRecordedError` `:362-369`) declare no constructor parameters, so `new C(message, details)` ignores both, just as today's `new C()` does.
  - `ScopeViolationError` (`:193-199`) takes only `message`, so the extra `details` is dropped exactly as at `:538`.
  - `JobCancelledError` and `DuplicateWalletError` already receive `(message, details)` today.
  - A probe confirmed the typing: `new (message: string, details?: never) => WalletError` accepts all 21 non-`fromPayload` classes, including the two with typed `details`; `unknown` does not. The Codex audit's in-memory comparison of this dispatch against the switch matched on 3,552 combinations (prototype keys, non-string codes, malformed details, default messages).
- **What stays:** every class body, `toPayload`, `WalletErrorPayload`, `remoteErrorFromResponseContent`, `JournaledRejection`, `journalIdOf`, the disconnect and receiver-gone helpers, and every export name. `walletErrorFromPayload` keeps its signature. The module gains no export.
- **Complexity:** the switch is not in the complexity manifest, and the new function is a few flat lines.
- **Alternative not taken:** a `defineWalletError(code, name)` class factory. It would also shrink the 24 constructors, but it rewrites every class declaration, loses the per-class TSDoc and static extras (`MESSAGE`, `LEGACY_MESSAGE`, `forMethod`), and widens the diff over the classes `instanceof` depends on. A plain object keyed by code was rejected too: `"constructor"` and `"__proto__"` resolve on `Object.prototype`, which a `Map` does not.

### Consumers that pin identity or wire bytes (all unchanged by this arc)

- **Reconstruction and serialization:** `packages/extension-messaging/src/core/base-client.ts:318` (both transport clients), `core/error-response.ts:29` (`toPayload` into the envelope), `packages/wallet-bridge/src/dispatcher.ts:180` (message-only operation results), fed by `apps/extension/src/wallet/services/execution/rpc-cancel.ts:89-97`, which lets five classes ride the code channel.
- **`instanceof` after a port** (popup, windows, the offscreen client): `apps/extension/src/popup/pages/auth.vue:119,121,128`; `popup/utils/transfer-failure-copy.ts:22,23,32`; `popup/utils/cancellable-rejection.ts:27`; `popup/windows/{capabilities/index.vue:328,discover/index.vue:110,execute/index.vue:525}`; `popup/pages/settings/security/export/full.vue:162`; `composables/full-backup-restore.ts:198,548`; `composables/useProfileCreateFlow.ts:89`; `composables/useProfileImportFlow.ts:116,216`; `packages/aztec-runtime/src/pxe/client.ts:160`.
- **`instanceof` in the background:** `apps/extension/src/wallet/services/` `wallet-sdk/error-envelope.ts` (15 branches, `:39-182`), `wallet-sdk/background.ts:1353`, `wallet-sdk/queued-journal.ts:273`, `dapp-interaction/service.ts:344,602`, `execution/execution-lane.ts:335`, `execution/mark-failed-unless-cancelled.ts:36-37`, `account-integrity/coordinator.ts:120`, `account-state/service.ts:149,198`, `profile/service.ts:1050,1121,2462,2541`, `token-balance/balance-projector.ts:160`, and `apps/extension/src/wallet/utils/create-passkey-profile.ts:50`.
- **The dApp wire:** `error-envelope.ts` writes `walletErrorCode` from each class's `CODE` (`:44-226`) and `ChainNotSupportedError.MESSAGE` (`:76`); `execution/service.ts:725` compares `TermsAcceptanceRequiredError.CODE`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:17` re-exports `PxeStoreKeyMissingError.CODE`, and `pxe/service.ts` embeds `PXE_STORE_KEY_MISSING` in its message.
- **Tests pinning literals:** `packages/extension-messaging/src/errors.test.ts`; `apps/extension/src/wallet/base/errors.test.ts`; `wallet-sdk/error-envelope.test.ts`; `execution/rpc-cancel.test.ts`; `execution/service.composition.test.ts`; `dapp-interaction/service.test.ts`; `apps/extension/src/wallet/utils/serialization.test.ts`; `popup/utils/transfer-failure-copy.test.ts`; `popup/pages/send-submit.test.ts`; `packages/wallet-bridge/src/dispatcher.test.ts`; the `background`, `offscreen` and `core` tests in `extension-messaging`; and the e2e files `cancel-mid-prove`, `concurrent-sendtx`, `connect-unserved-chain`, `legal-acceptance-wall`. All of them must pass unedited.

## Security & Adversarial Considerations

- **Trust boundary.** The payload arrives over an internal port from the background or offscreen document, and reaches dApps only through `error-envelope.ts`, which this arc does not touch. The refactor adds no data to any message, detail or log line.
- **Constant messages stay constant.** `SessionEndedError`, `TermsAcceptanceRequiredError`, `OperationNotRecordedError` and `ChainNotSupportedError` must never carry wire text: their envelopes promise to name nothing a dApp could probe. The characterization table rebuilds each from a payload with a foreign message and details and pins the constant message and `undefined` details.
- **Hostile codes.** A `code` of `"__proto__"`, `"constructor"`, `"toString"` or `"hasOwnProperty"` must rebuild as the base `WalletError` with the code kept, as the switch does today. The `Map` guarantees it; the table pins it.
- **Details stay unvalidated, as today.** The one cast moves from the union to the call site and into `CapabilityNotGrantedError.fromPayload`; neither validates nor widens what is read. Validating the wire is a behaviour change, out of scope.
- **npm surface:** none. `@nulo/extension-messaging` is private and not staged by `scripts/publish/packages.ts`, and no published entry re-exports these classes.
- **Layering:** the registry sits in the file that defines every class, the only package with `WalletError` subclasses; no new import.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `0abf63a3`):

1. The 24 subclasses, the 22-member union and the switch sit at the lines above, all in `errors.ts`; no other file declares a `WalletError` subclass.
2. Only `CapabilityNotGrantedError` reshapes its arguments on rebuild (`errors.ts:536`); `ScopeViolationError` drops `details` because its constructor has one parameter (`:196`, `:538`); the four constant classes take none (`:309`, `:338`, `:352`, `:366`).
3. The test's identity list covers 18 classes (`errors.test.ts:187-241`) and names counts in its titles (`:243`, `:252`). It omits `DuplicateInitializationError`, `UnsupportedMethodError`, `TermsAcceptanceRequiredError`, `RecoveryModeError`, `DuplicateWalletError` and `RpcConnectError`, and it compares `code` against `X.CODE`, so an edited `CODE` would pass.
4. `TooManyPendingError` rebuilding as the base is pinned by `errors.test.ts:263-274`.
5. The `never`-typed constructor shape typechecks against the real classes; the `unknown` shape fails on `JobCancelledError` and `DuplicateWalletError` (scratch probe, deleted).

**Inferences:**

- No consumer reads a class off the registry, since none can see it; everything goes through `walletErrorFromPayload`, whose input and output are unchanged.

**Asks:** none.

## Phases

### Phase 1: pin today's bytes (test only)

Replace the `instances` block (`errors.test.ts:180-261`) with one table of all 24 subclasses: constructor, literal `name`, literal `code` string, and its wire class (rebuilt, client-local, or base). Assert:

- **Completeness:** every exported `WalletError` subclass from `import * as errors` is in the table, and no table row is missing from the module.
- **Identity:** prototype, `instanceof WalletError`, `name` and `code` on direct construction.
- **Rebuild:** each rebuilt class from a payload with foreign text and details, again message-only (the operation-result channel), and again with `null` details, pinning constructor identity, `name`, `code`, message and details as today's switch produces them. That includes the constant and scope-drop rows. `CapabilityNotGranted` adds rows for an empty and a non-string `capabilityType` beside an unrelated detail field, pinning `??` (not `||`) and the fresh `{ capabilityType }` object.
- **Base fallback:** the four hostile codes above, representative non-string codes, `RPC_CONNECT_FAILED` and `TOO_MANY_PENDING` (its existing pin stays).
- **Independence:** expected constructors and values are written out in the test, never derived from the production registry.
- **Folded in:** the standalone `UserRejectedError` round-trip and the message-only test at `:140` are subsumed and removed; the default-message tests stay. The bug-pin comment at `:264` becomes one sentence stating the compatibility constraint.

Titles carry no counts. The phase is green against the unchanged switch, in its own commit, so the test file is frozen before Phase 2.

### Phase 2: the registry

Make the `errors.ts` change above with the test file untouched.

**Validation gate (after each phase):**

- **Commands:** `bun run --cwd packages/extension-messaging test`, `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`.
- **Pass criteria:** all exit 0; phase 2 leaves every test file outside `errors.ts` byte-identical (`git diff --stat` shows `errors.ts` alone).
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** lint, typecheck, unit; the e2e lanes run in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `hd/03-visual-shells-a` (gh stack on base `harden-dedupe`), then add both e2e labels. When the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/05-error-registry`, stacked on `hd/03-visual-shells-a` (arc 4 follows it; see Decisions). Code review: off.

## UI impact

None.

## Drift left for the alignment arc

- **`TooManyPendingError` does not survive a port** (`errors.test.ts:263-274`). Rebuilding it is a behaviour change; it stays a pinned omission and a program follow-up.
- **`packages/wallet-bridge/src/operation-result.ts:12-18` says one class rides the code channel**; `rpc-cancel.ts:89-93` sends five. A stale comment outside this package; a follow-up, not this arc.

## Decisions (delegated)

### Plan audit, Codex round 1 (GPT-6 Astra, xhigh): REVISE

All four findings were adopted:

1. **Should-fix: an explicit `BY_CODE` value type.** Adopted: an inferred union could absorb a constructor that requires typed details and let the `never` cast hide it.
2. **Nit: boundary rows in the existing table** (`null` details, empty or non-string `capabilityType` beside an unrelated field, non-string codes, `RPC_CONNECT_FAILED`). Adopted: they pin `??` against `||`, the fresh details object and the fallback, at no extra suite.
3. **Nit: fold overlapping tests in Phase 1.** Adopted: the table subsumes them; default-message tests and the `TooManyPendingError` pin stay because foreign-message rebuilds do not exercise defaults.
4. **Nit: comments.** Adopted: the bug pin's comment would cite a deleted union and a report; the `JSON.stringify` claim is false; the `ProfileIdConflictError` history is one sentence's worth.

The audit's case table: six exceptions to a plain `new C(message, details)` (`CapabilityNotGranted` picks `capabilityType ?? "unknown"` into fresh details; `ScopeViolation` drops details; the four constant classes ignore both), all preserved by this design; the other 16 cases pass both arguments unchanged.

### Stack order

Arc 5 now stacks on arc 3 and arc 4 follows it: this is an independent single-file arc that can be built while arc 4's harness work is pending, which keeps builds at most one arc ahead.
