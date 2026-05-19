# M4.2 — audit-diff (post-dual-audit; DECISION MEMO)

Date: 2026-04-26

## No BLOCKERs requiring memo reshape (both audits agreed memo direction is sound)

## Codex BLOCKER (internal contradiction — needs rewrite)

- Memo lines 42 + 65 contradict on non-extractable `CryptoKey` alternative. Memo first says "same problem at a different layer," then later says "per-installation non-extractable key is the mandatory Design A fallback." **Fix**: rewrite section to distinguish (a) wrap-key derived from passhash/PRF (relocates the problem) vs (b) non-extractable HKDF/AES-GCM CryptoKey in IndexedDB (separate origin partition; attacker reading `chrome.storage.session` likely has script execution in SW so calling decrypt is the threat). End conclusion stays: Design B is recommended.

## Codex SHOULD-FIX

- Prework lines 67-83: not all 5 items are "safe to do now." `SessionToken` abstraction (line 73) and M2.6 vector (line 83) are NOT design-agnostic. Design B doesn't need a token at all. SECURITY.md update (line 82) shouldn't pre-announce an unapproved path. **Fix**: keep safe prework to inventory/TODO/test scaffolding; defer `SessionToken` + SECURITY.md edits until decision is final.

## Plan agent SHOULD-FIX

- Variant 2 (non-extractable CryptoKey in IndexedDB) dismissal too brief — explicitly write the threat-model collapse argument so next reviewer doesn't relitigate.
- Design B UX cost: needs measurement gate. Lock screen renders synchronously while PBKDF2 runs → 1s spinner on every popup re-open after SW idle. Commit to beta measurement gate.
- Add prework #6: inventory cross-restart liveness assumers (callers of `getActive()` / `getSecret()`).
- Add Step 1.5: verify popup currently routes `(persisted profile + no active session)` → lock screen for password profiles too, not just passkey.
- Add regression test: pre-M4.2 persisted Session containing `passhash` cannot silently bypass re-auth (even if migrator hasn't run).
- Threat-model row reword: "opaque session record" leaks metadata. Use: "only encrypted profile ciphertext + metadata (active profile id, since timestamp) — no key material."

## NITs to absorb

- Variant 4 forward-reference (userVisibleOnly-style upstream tracking).
- Two more popup-side `getPasshash` callsites at `popup/pages/import.vue:265` + `popup/pages/settings/security/export/full.vue:139`. Out-of-scope, document.
- M4.2 should add explicit pointer "M4.8 owns the in-flight passkey request question."
- Test 4 ("M2.6 vectors unchanged") — phrase as "no regression" assertion.
- SECURITY.md M4.2 row update wording when this lands.

## Recommended execution-time absorption

1. **Memo revision**: rewrite Variant 2 section to spell out the threat-model collapse argument.
2. **Tighten prework**: keep inventory + annotation; defer SessionToken sketch + SECURITY.md update until Design B is approved.
3. **UX measurement gate**: when Design B execution starts, stand up beta measurement of PBKDF2-on-SW-restart frequency.
4. **Pre-execution**: when Design B is approved, plan v1 absorbs Step 1.5 + regression test + threat-model row wording.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — memo-level revisions; awaiting product decision on passhash design before transition to execution plan.
