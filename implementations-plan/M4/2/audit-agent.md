# M4.2 — Plan agent audit

Date: 2026-04-26

**No BLOCKING.** Memo correctly absorbed prior audit BLOCKERs. Recommendation (Design B) sound.

**SHOULD-FIX**
- Variant 2 (non-extractable CryptoKey in IndexedDB) dismissal too brief. Explicitly collapse: attacker reading `chrome.storage.session` likely has script execution in SW, so non-extractable key buys nothing — they call `decrypt`. Write reasoning out so next reviewer doesn't relitigate.
- Design B UX cost needs measurement gate, not assertion. Lock screen renders synchronously while PBKDF2 runs → 1s spinner on every popup re-open after SW idle. Worst kind of latency. Commit to beta measurement gate.
- Add prework #6: inventory `getActive()` / `getSecret()` callers that assume cross-restart liveness.
- Add Step 1.5: verify popup currently routes `(persisted profile + no active session)` → lock screen for password profiles too, not just passkey.
- Add regression test: pre-M4.2 persisted Session containing `passhash` cannot silently bypass re-auth (even if migrator hasn't run).
- Threat-model row reword: "opaque session record" leaks metadata. Use: "only encrypted profile ciphertext + metadata (active profile id, since timestamp) — no key material."

**NIT**
- Variant 4 forward-reference (userVisibleOnly-style upstream tracking).
- Two more popup-side `getPasshash` callsites at `popup/pages/import.vue:265` + `popup/pages/settings/security/export/full.vue:139`. Out-of-scope, document.
- M4.2 should add explicit pointer "M4.8 owns the in-flight passkey request question."
- Test 4 ("M2.6 vectors unchanged") — phrase as "no regression" assertion.
- SECURITY.md M4.2 row update wording when this lands.
