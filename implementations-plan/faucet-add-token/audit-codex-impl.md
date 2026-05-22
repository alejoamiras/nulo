# Codex post-implementation adversarial audit — faucet-add-token

Model: GPT-5.x via `codex exec` (xhigh). Date: 2026-05-22.
Session ID: `019e513e-de51-7a62-adbb-a846ff866bf8`
CODEX_DIR: `/var/folders/p9/5vbplm5s6p5bjy78gdqnh0500000gn/T/codex-Wsd9c3OB`

## Verdict

> I do not see the original popup-bypass anymore: `registerToken` now routes through `DappInteractionService.execute()` and `isConfirmationNeeded()` has an unconditional `register_token` branch, so a `Transactions`-level session still prompts. The problems I do see are in the implementation around that path.

## Findings

### HIGH

**H1** — Confirm button clickable before popup init completes. The footer/button render unconditionally in `execute/index.vue`; `tokenMetadataLoading` only flips inside `init()` AFTER operations are materialized. `approve()` has no `initComplete` / `operations.length > 0` guard. A fast click can therefore approve `[]`; `approveInteraction()` happily detaches and executes the empty list. D7 is not enforced from first paint.

**H2** — `TokenCard.vue` stacks untracked `setTimeout(addToken.reset, 3000)` calls. Button is only disabled while status is `submitting`, so an earlier timer can fire during a later submission and reset the composable back to `idle`. Defeats the re-entrancy guard in `useFaucetAddToken`; with rapid clicks the user can admit concurrent add-token flows.

### MEDIUM

**M1** — The B2 "preserve the dApp-supplied account for journal/audit" fix did not actually land. The comment in `handleRegisterToken` says `args[0]` is forwarded and used for journal/audit, but the implementation immediately calls `resolveNetworkAndAccount()` and substitutes the first authorized session account instead of the caller's account. Storage is still profile+chain, so not a privilege escalation, but it is a contract/audit mismatch and can fail unnecessarily when the chosen "first" account is stale while the requested authorized account is fine.

**M2** — Server-side "`registerToken` is not allowed in `batch`" is still unenforced. `handleBatch()` redispatches each leg unconditionally, so a raw protocol client can bypass the dApp-side Zod block. `wallet-bridge/README.md` documents this as a protocol truth, not a client-library convention.

**M3** — Schema-patch drift story is overstated. Only `dispatcher.test.ts` is pinned and only the extension copy is imported. Faucet and playground copies are side-effect imported from production code but nothing in the test suite proves those copies are still correct or first-imported. The three files have already drifted in comments.

**M4** — Faucet e2e harness is only partially closed. The faucet spawn path exists in `global-setup.ts`, but the only new register-token e2e drives the playground (faucet-driven spec was deferred). The new `FAUCET_DEV_PORT` / `FAUCET_URL` path is not actually exercised. Also: the abrupt-exit handler in `global-setup.ts` kills playground/node/anvil but omits faucet while still clearing the lockfile — if interrupted, the detached faucet leaks with no PID record left to reap.

### Confirmed non-issues

- Popup gate itself does fire correctly.
- `tokenMetadataLoading` clears in `finally`, no stuck-true deadlock.
- `FAUCET_DIR` resolves correctly to `packages/faucet`.
- `strictPort` change fails loudly by timeout if Vite lands on the wrong port.
- `register_token` is not the only `AppState` op (`aztec_getAddressBook` also is) — pre-existing.
- The extra `parseTokenInterface` in execution is redundant but acceptable: keep execution authoritative; popup preview is not a full executability proof anyway.
- Existing sessions survive the deprecation sweep cleanly; dropped methods fail as unsupported rather than misrouting.

## PRE-MERGE FIXES (codex's distilled list)

1. Disable `Confirm` until execute-popup init is complete and at least one operation has been materialized; do not rely only on `tokenMetadataLoading`.
2. Replace the faucet add-token auto-reset with one tracked, cleared timer so old timers cannot reset a newer submission.
3. Either preserve/validate the dApp-supplied account for `registerToken` as promised, or explicitly change the contract/comments/tests to say the wallet chooses an authorized session account.
4. Decide whether `registerToken` is truly "not in batch"; if yes, reject it in the bridge and add the missing regression test.

## DEFERRED

- Reachability tests for the faucet and playground schema-patch copies/import sites.
- Faucet child leak in the e2e abrupt-exit path; real faucet-driven network e2e that consumes `faucetUrl`.
- Duplicate-token short-circuit before journal creation in `token/service.ts`.
- Thread previewed token-interface data through approval to avoid reparsing after Allow.

## Adopted

All four PRE-MERGE items implemented in this PR. DEFERRED items filed as follow-up issues:
- `faucet-schema-patch-drift-tests`
- `faucet-e2e-driven-spec` + `e2e-abrupt-exit-faucet-cleanup`
- `register-token-dedupe-short-circuit` (mirrors Opus H2)
- `register-token-popup-preview-threading`
