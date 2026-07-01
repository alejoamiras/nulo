# Round-2 audit — opus (fable-role, adversarial, read-only)

Agent `a3d2383e`. Verdict: **SHIP-WITH-FIXES** — "leak #1 fix is correct and complete; the by-id guard and Q-02 protocol each hide a real trap the plan doesn't carve out." Converged independently with codex on both big traps + added 3 refinements.

## Concerns (severity-ranked)

- **HIGH-1 — `deleteToken` guard breaks the profile-deletion cascade.** `token/service.ts:525-531` `onProfileDeleted → deleteToken(token.id)` deletes the *deleted* profile's tokens; `deleteToken(id)` has no `profileId` param so a guard's only source is `requireActiveProfile`. Deleting an INACTIVE profile → throws on the first token → cascade aborts → orphaned rows = a NEW cross-profile residue. Active-profile deletion is also at risk: `deleteProfile` removes the repo row at `profile/service.ts:568` *before* emitting at `:570`, so `requireActiveProfile` may already throw. Fix: route the cascade through an unguarded internal delete (guard only the read getters), AND assert inactive-profile cascade *completion* in the suite. (= codex BLOCKER; opus adds the active-profile-order angle.)
- **HIGH-2 — "ADD-only oracle" proves the wrong invariant.** `derive*` reads only capability/exemptReason/routing/scopeCheck (`method-descriptors.ts:226-272`); an optional `argSchema?` feeds none → FROZEN_* parity stays green with zero edits, so the oracle diff says NOTHING about arg-validation. The real risk: scope checkers read raw `args` positionally right after enforcement (`dispatcher.ts:359-382`; `method-scope-checkers.ts` does `args[0] as X`/`String(args[0])`) → a coercing pre-enforcement parse changes what checkers see (fail-open); a schema stricter than tolerance breaks dApps — many methods take optional trailing args (`registerSender` `:1134`; `simulateTx/profileTx/executeUtility/sendTx` opts `:569,1172,1181,1191`). `argSchema` MUST be optional (else all 19 rows edit); validation non-mutating + optionality-exact; **the adversarial-bypass suite + dispatcher tests are the proof, not the oracle diff.** (= codex #4; opus adds argSchema-optional + optional-trailing-arg tolerance.)
- **MED-1 — internal gate contradiction.** R1 gates each PR on "isolation suite green," but R1.0 says #1/#2/#3 are RED until R1.4/R1.5 — can't both hold for R1.1–R1.4. Needs per-phase quarantine or a split gate.
- **MED-2 — leak#1 fix must query the token service, not the in-memory Map.** `token-balance/service.ts:259` `backup()` skips `ensureInitialized()`, and `this.tokens` is cleared/reloaded on profile switch (`:174-182`) → filtering the Map could drop ALL balances (empty backup). Filter via `tokenService.getTokensRaw(profile.id)`. Also `balance-projector.ts:111` `getTokenRaw` has NO `.catch` (unlike `:64`) → a stale foreign balance throws the batch once the guard lands.
- **MED-3 — backup-import codec pin inverted (R5).** "Never LAXER" is right for RPC/dApp but backup import needs "never STRICTER" or old backups fail to import — a tolerance change violating decision #4.

## What's solid (independently verified)
- Leak#1 is a real **plaintext** leak (`full.vue:136-141` plaintext; `handleEncrypt` optional/user-password, not per-profile-key).
- **Transitive filter is complete + correct:** token ids are one GLOBAL sequence (`token/service.ts:176`, restore `:547`) → `balance.token ∈ active-profile-token-ids` is an exact partition (no cross-profile id collision; cross-chain same-profile kept; orphans safely dropped).
- **No sibling backup leak:** token-balance is the only profile-private store with an unfiltered `backup()`; `config.getProps()` is unfiltered but global-by-design (one-line note).
- **By-id gap IS dApp-unreachable** (the 4 token methods + `revokeAuthwits` absent from `METHOD_REGISTRY`) ⇒ low urgency, don't ship a cascade regression to close it.
- `revokeAuthwits` account-check low-risk (`RevokeAuthwitsPopup.vue:99` passes same-account ids). Sequencing sound (R0 first, R6 last).

## Reconciliation (all adopted)
| # | Adopted into |
|---|---|
| HIGH-1 | R1.4 — internal cascade delete independent of `requireActiveProfile`; assert active AND inactive profile cascade completion. |
| HIGH-2 | R6 items 5–6 — `argSchema?` optional, non-mutating, optionality-exact; adversarial-bypass + dispatcher tests are the proof. |
| MED-1 | R1.0 — `test.fails()` pins for #1/#2/#3, flipped to `test` in the fixing phase; suite green every phase. |
| MED-2 | R1.5 — filter via `tokenService.getTokensRaw(profile.id)`; add `.catch` to `balance-projector.ts:111`. |
| MED-3 | R5 — backup-import codec "never STRICTER"; RPC/dApp "never laxer". |
| config note | Security § — `config.getProps()` global-by-design, not a leak. |

**Both legs converged → SHIP-WITH-FIXES; all fixes folded into `plan.md`.** No RECONSIDER/BLOCKER remains open.
