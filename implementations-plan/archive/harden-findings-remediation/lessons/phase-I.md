# Phase I — DappSession row integrity + MAC (F-12, Low) — MID

Branch: `fix/hf-i-dappsession-mac` off `fix/harden-findings`.

## The bug
`DappSessionService` persists `DappSession {sessionId, origin, chainId, profileId, accounts, grants, confirmationLevel, version}` via `EntityStorage<DappSession>("nulo:core:dappSessions", chrome.storage.local)`. `chrome.storage.local` is tamperable (other extensions, disk). An attacker editing a row to ADD `grants` mints capabilities the user never approved.

## Design — codex consult (restored, gpt-5.5 high) verdict adopted
**Per-row HMAC behind a narrow row-integrity signer boundary.** Minimal robust design (one MAC over the whole namespace is more fragile under concurrent/partial writes; per-row gives clean fail-closed: validate → canonicalize → verify → else discard).

1. **Primitive**: HMAC-SHA256 via `crypto.subtle.deriveKey` (HKDF) → a **non-extractable** `CryptoKey`, usages `["sign","verify"]`, `info = "nulo:dappsession-mac:v1"` with profile context in the info/payload for domain separation. (Length-extension is moot for HMAC.)
2. **Boundary — a small row-integrity signer service** (do NOT hand `DappSessionService` the master secret):
   ```ts
   signDappSession(profileId, bytes): Promise<Uint8Array>   // mac
   verifyDappSession(profileId, bytes, mac): Promise<boolean>
   ```
   It depends on the session/profile manager, caches only the non-extractable derived `CryptoKey` while unlocked. `DappSessionService` calls sign/verify, never sees HKDF or the master secret.
3. **Canonicalization**: build a FRESH object with ONLY the 8 signed fields, **Zod-parse** (reject unknown/invalid, clamp `confirmationLevel` enum/range), recursively sort keys, UTF-8 JSON no whitespace. Arrays order-sensitive (reordering = tampering) unless the schema declares them unordered; if `grants` is semantically a set, sort by a stable canonical rep before signing. Reject `undefined`/`NaN`/`BigInt`/dates/functions/prototype weirdness.
4. **Write path** (`storage.set`): compute `mac = sign(profileId, canonical(row))`; persist `{...row, mac}`.
5. **Read path** (`get`/`getValues`): Zod-validate → canonicalize → `verify`; **missing or invalid `mac` → DROP the row** (fail-closed). No legacy verifier, no "repair" from stored contents. `mac` is **mandatory for v1**.
6. **Lock-at-load**: if the wallet is locked (no derived key) → return **empty** (fail-closed). Callers must tolerate "no sessions while locked" and trigger unlock/reconnect (verify no flow silently widens grants on empty).
7. **Existing rows**: **wipe-and-reseed** (no prod users) — they have no `mac` → dropped on first read; the dApp reconnects.

## Invariants
- A storage-tampered row (added/modified `grants`, swapped `sessionId`, cross-profile copy) fails `verify` → dropped; cannot mint grants.
- The MAC key is per-profile, non-extractable, never persisted beside the rows.
- No plaintext master secret reaches `DappSessionService`.
- Locked read → empty, never a broadened/ungated grant.

## Negative tests
- wallet-core / integrity-signer unit: sign→verify round-trips; a flipped byte in `bytes` or `mac` → verify false; canonical JSON is stable across key-insertion-order permutations of the same row.
- dapp-session service: a row with a tampered `grants` → dropped on `getValues`; a row missing `mac` → dropped; a valid row → returned; locked (no key) → `getValues` empty. (BUG-PIN: assert reordering `grants` is rejected if order-sensitive.)
- adversarial: cross-profile replay (row signed under profile A read under profile B) → dropped.

## Delivered (matches the codex design; two grounded adjustments)
- **`integrity.ts`** — pure `canonicalizeDappSession` (stable key-sorted whitespace-free JSON; rejects non-finite/bigint) + `signDappSession`/`verifyDappSession` (HMAC-SHA256, base64, WebCrypto constant-time `verify`, never throws). **Signs the WHOLE row minus `mac`** (not a hand-picked field subset) — the actual `DappSession` fields (`id, profileId, chainId, dappMetadata, permissions, accounts, confirmationLevel, expiry, verificationHash?, trustedVerification?, accountAliases?, capabilityGrants?, capabilityRejections?`) differ from the plan's assumed 8, and signing everything is strictly more robust (any tamper detected).
- **`ProfileService.deriveDappSessionMacKey(profileId)`** — HKDF from `getSecret` (Fr master secret) → **non-extractable** HMAC key `["sign","verify"]`, domain-sep `info="nulo:dappsession-mac:v1"`. Raw secret + HKDF stay inside ProfileService; the IKM is `zeroize`d. Propagates `getSecret`'s "Profile locked" throw.
- **`DappSessionMacStorage`** (`mac-storage.ts`) — a MAC-verifying wrapper over `EntityStorage<DappSession>` presenting the exact subset DappSessionService uses (get/getValues/set/contains/delete). Signs on write; on read a tampered/no-`mac` row is **dropped + quarantine-deleted**, a **locked** row is **hidden but NOT deleted** (verifies after unlock). **Adjustment vs the plan's `entity_storage.ts` location:** the MAC needs profile + master-secret context the *generic* `EntityStorage` has no business holding, so it lives at the DappSession layer (per codex) — `entity_storage.ts` is untouched.

**Gate results (non-e2e, green):** integrity 6 · dapp-session 33 (composition fake updated with a stable MAC key) · full test 2673 · typecheck:all 0 · lint 0-err.

## Gate (plan.md Unit I — strengthened): `bun run --filter '@nulo/wallet-core' test` + `bun run test` + `bun run lint` + **`NULO_E2E_PROVERLESS=1 bun run e2e:agent` with a real dApp grant→reconnect** (a bad MAC/key bricks every reconnect — smoke-only too weak). Layers: lint · unit · network-e2e.
