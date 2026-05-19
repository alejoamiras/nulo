# M4.11 — Encrypted profile-scoped metadata at rest (DEFERRED, ASPIRATIONAL)

> **Status**: deferred indefinitely. **No implementation plan, no audits, no PR**.
>
> This document exists so the milestone slot has a placeholder. Re-open when the criteria below are met.

## What it would do

Encrypt profile-scoped metadata at rest in `chrome.storage.local`:
- Contacts (`nulo:core:contacts`)
- dApp sessions (`nulo:core:dappSessions`)
- Tokens (`nulo:core:tokens`)
- Token balances (`nulo:core:token-balances`)
- Transaction history (`nulo:core:txs`)
- Networks (`nulo:core:networks`) — possibly excluded; debatable
- Auth registry (`nulo:core:auth-registry`)

Each profile would have a derived encryption key (from the master secret via HKDF + a `profile-metadata-v1` label) used to AES-GCM encrypt every record before write + decrypt on read.

## Why deferred

1. **High implementation cost**: every read/write path across 7+ services needs an encrypt/decrypt seam. M4.7's per-collection migrators provide the seam for the schema change, but the wrap layer is its own engineering effort.
2. **Threat-model marginal**: the threat is "attacker reads disk while wallet is unlocked" — same-machine, browser-running, password-known. Most attackers in this position can read process memory anyway.
3. **No user-facing pull**: zero feature requests, zero compliance mandates currently driving this.
4. **Performance impact**: every record op pays AES-GCM round-trip cost. Negligible per record but cumulative across batch reads.
5. **Migration complexity**: existing plaintext records would need a one-shot encrypt-on-first-read migrator (cleanly handled by M4.7's pattern, but still surface area).

## Re-open criteria (any one is sufficient)

1. **Compliance mandate**: enterprise pilot, regulatory requirement, or audit finding requires metadata-at-rest encryption.
2. **High-value targeted attack**: post-mortem of a real incident shows disk-read attack as the actual breach vector.
3. **User feature request volume**: ≥ 5 unrelated requests for "wallet contents on disk" privacy.
4. **Compliance window**: prep for an SOC2 / similar audit pulls metadata-at-rest into scope.
5. **Major release pivot**: enterprise-mode / multi-tenant feature where metadata-at-rest becomes a checkbox feature.

## What's in place that makes M4.11 cheaper-than-cradle when revisited

- **M2.6 crypto vectors** pin the KDF chain. Adding a `nulo:profile-metadata:v1` label is a vector extension, not a new derivation chain.
- **`@nulo/wallet-crypto`** has `EncryptionKey`, `PasswordSecretBox`, and (post-M4.6) `zeroize`. M4.11 adds a `MetadataKey` class derived from the master secret.
- **M4.7 migration registry** is the right seam for the encrypt-on-first-read migrator.
- **EntityStorage / ValueStorage** are easy to wrap with an `EncryptingStorage` decorator.

When M4.11 reopens, the plan should be a small one (~1 week of execution).

## Estimated cost when reopened

- Plan + audit: 1 day.
- Implementation (`EncryptingStorage` wrapper + 7 service wirings + M2.6 vector + migrator): ~3-5 days.
- Test + QA: ~1-2 days.
- Total: 1 week.

(The original architecture plan estimated "weeks" for M4.11. That's likely overestimate when the M4 foundation is in place.)

## Pointers

- Architecture plan: `architecture/plan/03-final-plan-v3.md:232`
- Risk register entry: `architecture/plan/02-final-plan.md:299` (R11 — different concern; ignore)
- Threat model: `SECURITY.md` "Threat model" section — disk-read row.

## Open questions when reopened

1. **Networks**: include or exclude? RPC URLs aren't sensitive in themselves, but a custom RPC URL might fingerprint the user.
2. **Profile-metadata key derivation**: HKDF from master secret (Design A) vs separate user-input key (Design B). Default A.
3. **Migration UX**: 7 collections × 100s-1000s rows per collection on a user with heavy history. Encrypt-on-first-read keeps it lazy; one-shot encrypt-all is simpler but blocks boot. Default lazy.
4. **Tests**: M2.6-style vector for the new HKDF label + round-trip per collection.
