# Round-2 audit — codex (xhigh, read-only)

Session `019f1e7a`. Verdict: **SHIP-WITH-FIXES**. Full response below, then reconciliation.

---

## codex response

**SHIP-WITH-FIXES**

1. **BLOCKER: token guard can break legitimate profile deletion.** `token/service.ts:525` calls `deleteToken(token.id)` while deleting rows for an explicit `profile.id`. If `deleteToken(id)` becomes active-profile guarded at `:271`, deleting an inactive profile can throw and leave tokens/balances behind. Fix by extracting a private `deleteTokenRow(token)`/`deleteOwnedToken(token, profileId)` used by cascades; keep public RPC fail-closed. Add an inactive-profile deletion test.

2. **HIGH: token-balance export filter is necessary but not fully FK-complete.** `token-balance/service.ts:259` should filter by active-profile token ids; orphan/deleted-token balances should be dropped (consistent with restore already dropping unmapped rows in `useFullBackupImport.ts:377`). But `TokenBalanceRaw` has both `token` and `account` (`spec.ts:5`), so a corrupt/malicious row with an active-profile token id and foreign account would still export. Stronger predicate: token is active-profile owned, and `account` belongs to the active profile on that token's `chainId`.

3. **HIGH: leak is not "protected downstream."** `full.vue` builds `backup.data` in plaintext at `:127-141`; encryption is optional/later at `:162-165`; download can be plain JSON at `:173-177`. The leak is plaintext in the unencrypted artifact and still present inside optional ciphertext if encrypted. Phrase the finding that way.

4. **HIGH: Q-02 "ADD-only" proves table parity, not arg safety.** Derivations ignore extra fields, so D7/XOR + scope-checker identity won't widen if `derive*` stays as-is (`method-descriptors.ts:226-270`). The trap is dispatch behavior: `dispatcher.ts:334-430` enforces then casts raw `args`; handlers like `isTokenRegistered` stringify `args[0]` at `:397`; batch recurses at `:529-550`. Schemas must run before capability/scope AND before handler destructuring, be exact tuple / no-rest / no coercive `String()`, and validate every batch leg by its own method schema.

5. **MED: preserve-backup line is export-only.** Do not add restore FK validation or schema-version changes in R1/R5. Export filtering is fine; changing `TokenBalanceService.restore()` tolerance at `service.ts:264-270` is the deferred backup/migration work.

**What's Solid:** by-id token gap IS dApp-unreachable on this HEAD (wallet-sdk exposes token state only via `isTokenRegistered` → `getTokens(profileId, chainId)`, `background.ts:94-99`, not `getToken*`). `revokeAuthwits` adding `authwit.account === account` is well-scoped (UI callers pass matching account, `RevokeAuthwitsPopup.vue:96-100`). Sequencing mostly right (R0 first, Q-02 last); tighten R1 isolation suite with inactive-profile deletion + mixed token/account FK export cases.

---

## Reconciliation (all 5 adopted)

| # | Sev | Adopted into | Change |
|---|-----|--------------|--------|
| 1 | BLOCKER | R1.4 | Split `deleteToken`: private cascade method (explicit profileId) + guarded public RPC. New inactive-profile-deletion test. |
| 2 | HIGH | R1.5 | Export predicate = token active-profile-owned **AND** account active-profile-owned on that chainId. |
| 3 | HIGH | Security §, R1.5 | Reworded: the leak is **plaintext** (export can be unencrypted JSON), not "maybe protected." |
| 4 | HIGH | R6 (new item 5) | Schema runs before enforcement + before destructuring; exact tuple, no rest/coercion; per-batch-leg validation; pinned in adversarial-bypass. |
| 5 | MED | R1.5, R5 | Export-only fix; do NOT touch `restore()` tolerance (deferred). |

Confirmed-solid (no change needed): by-id gap dApp-unreachable; `revokeAuthwits` account-check well-scoped; R0-first/Q-02-last sequencing. Isolation-suite tightening folded into R1.0.
