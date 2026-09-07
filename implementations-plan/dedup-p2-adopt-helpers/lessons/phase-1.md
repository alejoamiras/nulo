# P2 dedup-p2-adopt-helpers — lessons

Base: `worktree-dedup-p1-delete` (PR #561). Scope: ledger ids X2 X3 X6 X1 E1 H3 J5 H1 C3 C8 L4 K2 M7 G2 G3 D5 L6.

## Plan audit

- `/codex high` (GPT-6 Astra, session `01a07c3e-da4b-72c2-ac4c-5c4c80a82bfb`): *conditional approve*; all conditions verified and adopted — see `plan.md` § Audit log. Two of them changed scope: **J5 skipped** (the export/import pages capture a generation without bumping it; `createRunFence.begin()` bumps on every capture, so repeated file picks would stop sharing a generation), and **X6 is encode-only in `integrity.ts`** (`Buffer.from` accepts a valid MAC with trailing garbage, `fromBase64`/`atob` rejects it; a stricter verifier is a behaviour change).
- Approval: pre-granted by the ledger README (conditional-approve with every condition adopted, scope ⊆ ids).

## Skipped ids

- **J5** — see above. Net saving would have been ~15 lines against an untested semantic change.
- **X2 in `packages/bridge-core`** (3 of the 39 sites) — bridge-core does not depend on `@nulo/wallet-core` and was outside the review scope; adding a dependency for a one-liner is not a dedup.

## Phase 1 — cross-package helpers (X2, X3, X6) ✓

- X2: 36 sites in 27 files → `errorMessageFromUnknown`; `migrator.ts`'s local `message()` deleted. The three `packages/bridge-core` sites stay (no wallet-core dependency there).
- X3: `deferred<T>()` promoted to `packages/wallet-core/src/utils/deferred.ts` (gains `reject`); adopted in `rw-guard.ts`, `execution-mutex.ts`, `session-baton.ts`, `window-manager.ts`, `background.ts` (whose `resolvePopup!()` non-null assertion disappears). `wallet/utils/offscreen.ts` left as is: its three module-level settlers would need three assignments either way, so the swap saved nothing.
- X6: `useFullBackupImport.ts` decodes via `fromBase64`; `integrity.ts` encodes via `toBase64`, decoder untouched (audit condition).
- Gate: `bun run lint` 0 · `bun run typecheck:all` 0 (after adding the `Deferred` type import the script missed) · wallet-core 244, extension-messaging 202, aztec-runtime 214 tests pass · extension targeted 260 pass.

## Phase 2 — service and utility helpers (E1, C3, C8, D5, G2, G3) ✓

- E1: `randomIdNotIn(taken, length)` beside `nextRandomId`; the three sync loops collapse to one call each (16 / 8 / 8), `getRandomHex` imports drop where it was the only use. The dApp-interaction site keeps its 128-bit note, minus the review provenance.
- C3: `requireArtifact` moved to `contract-resolver.ts`, typed over the resolver's own `Map`s; five ladders replaced, `tx-request-builder.ts` keeps only its `ResolvedInstances/Artifacts` aliases for the other helpers.
- C8: `reject(estimateId, reason)` keeps the `tryConsumeTransferEstimate <id>: ` log prefix byte-for-byte (8 sites, one still interpolating the base-fee error).
- D5: `patchAccountField<K extends "name" | "visible">` under the same tuple lock, ownership check, unchanged-value suppression and emit-after-write.
- G2 / G3: `log()` delegates with `undefined` context (→ `"sw"`); `simulate()` builds its `FunctionCall` once.
- Gate: lint 0 · extension typecheck 0 · 38 test files / 586 tests pass.

## Phase 3 — UI-side helpers (X1, H1, H3, K2, L4, L6, M7) ✓

- X1: `copyWithToast(text, openToast, successLabel, { sanitize? })` beside the primitive; 17 sites collapse to one line each (two keep `sanitize: true`); `copyAddressToClipboard`, `IncomingTrustPopup.vue` and `received-copy.ts` untouched (different guard or failure copy).
- H1: `utils/password.ts` (`isNewPasswordValid`, `newPasswordHint`) with its own test; six sites adopt it, the passkey and current-password conditions stay at the sites.
- H3: `useProfileBootstrap` keeps a module-level `createRunFence()`; the in-flight map stores each run's `isCurrent` closure, so the identity-guarded cleanup is unchanged. `runFence.ts`'s header no longer names the file as pending.
- K2: `isEmbeddedFeePayment(op: FeePathFields)` lives in wallet-bridge beside `requiresFeeSelection` (which now delegates); `materialize.ts`, `execute/index.vue` (both branches) and `OperationCard.vue` call it; a parity test pins gate ⇔ predicate over seven drafts.
- L4: `buildIncomingCardProps` in `utils/received-display.ts`; both callers keep their token/fiat lookup.
- L6 / M7: `readSavedFeeMethods()` local helper; `logs-csv.ts` calls `formatLogData` directly (its array branch was the same code).
- Gate: lint 0 · extension typecheck 0 · wallet-bridge typecheck 0 (after narrowing the parity test's draft types) · 101 extension test files / 1,420 tests · wallet-bridge 261 tests.

## Phase 4 — full local gate ✓

`bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run test` exit 0 (441 files, 5,518 tests) at 36711cea. The pre-commit hook surfaced two leftover imports (`formatArg`, `isSelfPay`) as warnings; removed before the commit was finalised.

## Codex fix loop

- **Round 1** (`/codex high`, GPT-6 Astra, session `01a07c52-b605-7cf1-bf4c-e0d0398a0c3d`): *conditional approve*. One real regression: `openEncryptedBackup` decoded the untrimmed file text with the strict `fromBase64` while the detector had validated `text.trim()`, so a protected backup padded with non-breaking spaces detected fine and then failed to decrypt (codex reproduced it under Bun). Fixed with `fromBase64(sealed.trim())` plus a regression test that seals a real backup, wraps it in U+00A0 and decrypts through `decryptBackup()`. Also applied: two missed property-access X2 sites (`useFullBackupImport.ts`, wallet-core `base/index.ts`); the `send_transaction` embedded-fee copy in `materialize.ts`; two more sync collision loops (`network/service.ts` `_fresh8`, `passkey/service.ts`) onto `randomIdNotIn`; four unused Vue import specifiers; `requireArtifact` had landed between `findFunctionByName` and its doc comment; comment trims (`patchAccountField`, `password.ts`, and review-provenance tags in `ScopeAddress.vue`, `ScopeClassId.vue`, `transfer-estimate-reuse.ts`). Tests: 33 files / 537 + wallet-core 244 pass.
- **Round 2** (resumed, same session): *"Approve — no new material findings."* Loop converged.

## Final gate (62b4acf4)

`bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run test` exit 0 (441 files, 5,519 tests).
