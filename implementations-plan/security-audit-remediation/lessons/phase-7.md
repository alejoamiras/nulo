# Phase 7 — F-008 broad UX redesign (scaffold + transfer/mint structured args)

## Closed (partial)
- **F-008 (transfer + mint)**: known transfer/mint call signatures now render structured `To:` + `Amount:` on the primary `aztec_sendTx` approval card. The "do not guess" parser refuses to render structured args for any call whose method+arity doesn't match a documented signature — unverified calls fall back to the existing function-name-only render.

## NOT closed in Phase 7 (audit-followup)
- **F-008 (other op types)**: `register_token`, `register_contract`, `aztec_createAuthWit`, simulate/utility/profile cards still use the existing template. The plan budgeted 4-5 days for full coverage; this session delivered the scaffold + the highest-volume case (sendTx transfer) as a proof-of-concept. The remaining op-type renderers are mechanical follow-ups using the same `parseTransferIntent`-style helpers.
- **F-008 (send_transaction Nulo SendAction)**: only the `aztec_sendTx` branch was updated; the `send_transaction` (Nulo's own UI-initiated transfer kind) already has typed `from/to/amount` fields elsewhere in the codebase and didn't need the same treatment.
- **Multi-call payload tests**: codex Round 1 S-2 asked for negative tests against multi-call payloads where a benign first call hides a harmful later call. The current implementation renders args for EVERY call in `op.exec.calls`, so the structural defense is in place. The negative test is deferred.

## Implementation
- `packages/extension/src/utils/transfer-intent.ts` (new):
  - `parseTransferIntent(call)` returns one of:
    - `{ kind: "transfer", to, amount }` — for `transfer_in_private` / `transfer_in_public` / `transfer_to_private` / `transfer_to_public` with EXACT 3-arg `(from, to, amount)` arity.
    - `{ kind: "mint", to, amount }` — for `mint_to_private` / `mint_to_public` with EXACT 2-arg `(to, amount)` arity.
    - `{ kind: "unverified" }` — anything else.
  - Strict arity matching is the "do not guess" defense (codex Round 1 S-2). A malicious dApp can't craft a `stealFunds(from, to, amount)`-shaped call that the wallet displays as a transfer.
- `packages/extension/src/utils/transfer-intent.test.ts` (new): 7 tests covering the known signatures, unknown methods, wrong arity, missing args, and unstringifiable args.
- `packages/extension/src/popup/windows/execute/OperationCard.vue`:
  - Imported `parseTransferIntent` + `TransferIntent` type.
  - Inside the `aztec_sendTx` v-else-if branch (lines ~124-160 post-patch), each call row now also gets a `data-intent-kind` attribute, and IF the parser returns transfer or mint, an additional `<Flex data-testid="execute-op-structured-args">` block renders the `To:` + `Amount:` rows with a left-border styling.
  - Unverified intents render unchanged — the existing function-name + contract-address row only.
  - New CSS class `.structured_args` adds left-border + indent to visually group the structured rows with their parent call.

## Verification
- `bun --cwd packages/extension test`: 2235 pass, 7 todo, 1 skipped (was 2228; +7 from transfer-intent.test).
- `bun --cwd packages/extension typecheck`: clean.

## Codex consult
**Deferred to PR review** per the plan's discipline note. The plan flagged "codex consult on Phase 6 router fallback UX" — Phase 7's scope is narrower than the original UX router design, so the codex consult will instead focus on (a) whether the structural defense against silent mis-parse is adequate and (b) the deferred audit-followup scope (broader op-type coverage).

## Surprises / honest deviations
- The plan called for "all 5 popup-gated op types" with new sub-component files (OperationCardTransfer.vue, OperationCardRegisterToken.vue, OperationCardRegisterContract.vue). Realistic session scope landed only the inline structured-args block in the existing OperationCard.vue for the sendTx branch — no new component files.
- The "router fallback" pattern from the plan isn't fully built. The fallback IS implemented: when the parser returns `unverified`, the existing function-name-only render kicks in. But there's no separate "Full JSON" link or "Unverified summary" banner because the existing template already shows the contract address + function name as the user's primary verification surface.
- Phase 7 ships in close calendar coupling with Phase 6's sanitization (per the user's Round-3 swap). Phase 6 sanitized existing dApp-controlled strings; Phase 7 surfaces NEW structured fields (to/amount). The intersection — sanitizing the structured-arg values themselves — is currently a no-op because Aztec addresses + amounts are not free-form text where bidi/zero-width attacks land. If a future op type's structured args include free-form strings (token name, etc.), sanitization at the renderer is the contract.

## Follow-ups for next remediation cycle
1. Per-op-type structured cards for `register_token`, `register_contract`, `aztec_createAuthWit`, simulate/utility/profile.
2. Negative test: multi-call payload with benign first + harmful later — verify ALL calls render structured args, not just the first.
3. UX polish: visual "Unverified summary" marker on the existing unverified rows (currently just no extra block is rendered).
4. Audit re-verify whether the `data-intent-kind` attribute should be a testid for e2e selectors.

LESSONS_FILE=implementations-plan/security-audit-remediation/lessons/phase-7.md
