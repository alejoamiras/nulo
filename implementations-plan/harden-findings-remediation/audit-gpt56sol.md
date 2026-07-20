# Post-merge audit round — codex `gpt-5.6-sol` (xhigh) ×4

After merging `origin/dev` (storage-migration #246, harden-quality #220, backup #274/#275) into `fix/harden-findings`, ran **four** independent `gpt-5.6-sol` reasoning-effort=xhigh passes:

1. **Merge-eval** — verify each of the 10 conflict resolutions preserved both sides.
2. **Audit 1 — adversarial security** — attack all 14 fixes for residual bypasses.
3. **Audit 2 — correctness / regression / merge-integration** — bugs at the campaign↔dev seams.
4. **Audit 3 — crypto + data-integrity deep dive** — verify the crypto chains + storage/backup integrity.

They independently converged on the same top issues (high signal). All crypto chains were confirmed **sound** (SessionSecretBox construction, EncryptionKey/fromPassword, DappSession HMAC, and the key-vectors V1/V2/V3/V6/V7 byte-identical no-re-registration invariant).

## FIXED (this round)

| Sev | Finding | Fix |
|---|---|---|
| **CRITICAL** | **Empty-name bypass** — my prior-session `name && name !== fn.name` change treated `""` as "absent", so a dApp could scope `{function:""}`, send `{name:"", selector:<transfer>}`, and every ABI sink skipped the name↔selector bind → silent `transfer` authwit, no popup | Reverted all 5 sinks to `name !== undefined && name !== fn.name` (rejects `""`, allows genuine `undefined` selector-only); added `matchesScope` empty-function rejection (authorization side); flipped the view-executor test + added scope-enforcement pins |
| **HIGH** | **Fail-closed `ValueStorage.get()` callers uncontained** — dev made `get()` throw+preserve (superseding J's drop); `ConfigStore.load()` + `SessionManager.restore()` let the throw crash wallet startup on a malformed `nulo:config`/`nulo:core:session` (F-13's original concern, reintroduced) | `try/catch` at both callers: log, keep the raw value for repair, boot on defaults / non-restorable session |
| **HIGH** | **DappSession profile-deletion leaks inactive-profile rows** — `onProfileDeleted` filtered `getValues()`, which HIDES rows whose MAC key can't be derived (non-active profile) → deleting an inactive profile left its grants; re-import (same id+secret) reactivated them without consent | New MAC-free `DappSessionMacStorage.deleteByProfileId()` (scans raw inner rows by `profileId`); cascade uses it + emits per-row events. New `mac-storage.test.ts` pins it |
| **HIGH** | **Batched-view simulation chain-identity mismatch** — the slow arm re-fetched an UNvalidated `getNodeInfo()`; a drifted RPC could return tuple A (validated, fast arm) then B (slow arm), merging two chains into one result; slow-only batches did no check at all | Derive+`assertLiveChainIdentity`-validate `chainInfo` ONCE per tx batch and thread it into every `runSlowArm` (incl. the fallback rerun) |
| **MEDIUM** | **`SessionSecretBox.unwrap` didn't validate plaintext length** — a crafted/corrupt bearer (its own token+salt) could decrypt to a wrong-length buffer → `Fr.fromBuffer` throws → aborts init | `unwrap` enforces the 32-byte length (returns `MasterSecretBytes | null`); restore wraps `Fr.fromBuffer` in try/catch → `silentClose` (covers the `≥ modulus` case). Test added |
| **MEDIUM** | **`checkSimulationTransactions` derefs a null call element** — `simulateTx({calls:[null]})` + a grant → raw `TypeError` (F-08 "never deref raw unknown") | Validate each call is a non-null record with `to` before `matchesScope`; scope-enforcement pin added |
| **LOW** | `SessionSecretBox.unwrap` partial-decode zeroize bypass (a non-string `salt` threw after `token` was allocated, skipping zeroize) | One outer `try/finally` always zeroizes `token`/`salt` |
| **LOW** | `executeUtility` dereferenced `op.call.selector.toString()` without a presence check | Guard `to`/`selector` presence → controlled error |

## SURFACED — held for your decision (NOT auto-fixed)

- **HIGH — migration engine `migrator.ts` (dev's #246): a crafted/corrupt interrupted-journal wipes profile rows.** The resume path trusts `backup.refs` (checks only `1..maxVersion`, not registry membership or footprint). Repro (audit 3): `{version:1, refs:[profiles root], entries:{}}` + schema-version 0 → startup reports "migrated" and tombstones every profile. **I attempted a footprint-validation guard and REVERTED it** — dev's crash-recovery model legitimately allows a journal's refs to exceed the currently-registered migration's footprint (version drift; its own tests register a `noop` where the journal carries real refs), so a naive footprint check breaks legit resume (broke 7 migrator tests). A correct fix needs dev's migration-model expertise — e.g. a MAC/HMAC over the journal (only the migrator can write a valid one) or a footprint-versioning scheme. This is **dev's code + a data-integrity-critical path**; recommend a dedicated follow-up owned by the migration-engine author. Threat requires local-storage-write (already a strong compromise).
- **MEDIUM — `fast-path.ts` simulateTx fast path trusts dApp `name`/`type`/`isStatic`.** A dApp granted `allowed_view` can send a different public-static selector under that name; the node runs it. Bounded to **PUBLIC on-chain state** (readable directly from the node without a wallet), so **no confidentiality boundary is crossed** — it's a scope-integrity gap on public views. Fixing it means resolving the artifact in the fast path (defeating the optimization) for a public-data-only issue. Recommend: bind name↔selector in the fast path if the optimization can afford it, OR document that public-static scope is advisory. Deferred pending your call.
- **MEDIUM — passkey full-backup finalization depends on in-memory `pendingRestoreSecrets`.** An MV3 SW restart mid-import → `finalizeRestore` reports "No pending restore secret", the import fails but the profile is already written, and a retry collides. Pre-existing (dev's backup flow + MV3 lifecycle), larger fix (rederive/credential-bind on restart, or fall back to `unlockPasskeyProfile`). Recommend a follow-up.
- **HIGH (threat-model honesty, not a code bug) — F-11 bearer + F-12 MAC share a recoverable root.** In non-strict mode the session row recovers the master secret, which derives the DappSession HMAC key — so a **local-storage-write** attacker can mint a valid row. This is inherent to a session-only silent bearer (documented in `SessionSecretBox`'s "threat-model honesty" note). **Strict mode is the security boundary**; the campaign's F-11 scope was explicitly session-only (no external commitment / revocation epoch). No code change — surfaced for awareness.
- **HELD — F-03 chain-identity XOR collision** (`chain-identity.ts:55`): `assertLiveChainIdentity` compares the lossy `l1ChainId ^ rollupVersion`; a drifted RPC can present a colliding tuple; `chainId===0` skips the check. No sound bounded fix without persisting the exact tuple in the Network schema (a cross-cutting change beyond campaign scope). Same held item as `audit-codex-postimpl.md`.

## Gate (post-fix)
`bun run typecheck:all` 0-err · `bun run lint` exit 0 · `bun run test` **3068 passed / 1 skipped** (+4 new security pins) · migrator suite 41/41 (revert clean).

---

# Second merge (dev `fb61a63`) + codex review — round 2

Merged dev's `fb61a63` ("security-harden backup import + profile deletion" — new profile-deletion coordinator + tombstone-repository + epoch fencing). 2 conflicts; codex (`gpt-5.6-sol` xhigh) reviewed both **within dev's new deletion subsystem**.

- **Resolution 2 — `profile/service.ts` `restore()`: SOUND.** L's F-11 bearer (no passhash unseal) + dev's tombstone gate compose correctly — `restore` is single-arg on this branch, reserved-ids load before restore, and a tombstoned profile's lookup returns `undefined` → silentClose. F-11 holds; the deletion fence holds.
- **Resolution 1 — `dapp-session` `purgeForProfile`: choice CORRECT, 3 impl gaps in my `deleteByProfileId` — FIXED.** Codex confirmed the coordinator CAN purge an INACTIVE profile, so a MAC-free purge is required (dev's `getValues()` would hide the rows). But my `deleteByProfileId` had 3 gaps, now fixed by a raw, key-aware scan:
  1. It used the schema-validating `getValues()` → a **schema-invalid** row with `profileId=P` was kept-but-hidden and survived the purge.
  2. It deleted by the row's self-reported `id`, not the **storage key** → a row copied to an alias key survived and re-verified on re-import.
  3. Dropping `purgeRows` batched emits → a partial delete failure left an earlier row's wallet-SDK channel un-torn-down.
  **Fix:** new codec-free `EntityStorage.rawEntries()` (`[storageId, rawJSON]`); `DappSessionMacStorage.rowsForProfile()` matches raw `profileId` + returns the true `storageId`; `purgeForProfile` runs `purgeRows` (delete by `storageId`, emit per delete). 3 new pins in `mac-storage.test.ts`.

## SURFACED (round 2) — in dev's #276 deletion subsystem, NOT the merge resolution

- **HIGH — `SessionManager.close()` swallows a failed session-storage delete during profile deletion.** The in-memory `activeSession` clear runs AFTER the throwing `await this.session.delete()`, so if it rejects the session stays in memory while the cascade still releases the tombstone → `getActiveProfile()` can expose the deleted profile for the rest of the SW lifetime (restart is safe — the profile row is gone → `restore` silentCloses). A naive reorder of `close()` is unsafe (a half-clear leaves a stale storage session that restores later). Needs a strict `closeForDeletion(profileId)` that clears in-memory regardless of storage outcome AND propagates the failure so the tombstone is NOT released — coordinated with dev's `deleteProfile` cascade. Recommend the deletion-subsystem owner; binding F-11 bearers to a durable profile-generation nonce would also prevent same-id replay.
- **MEDIUM — fail-open tombstone clear.** `TombstoneRepository.clearIfSame()` silently no-ops for a corrupt / different-epoch tombstone, but both `deleteProfile` completion paths unconditionally release the in-memory reservation afterward → a corrupt tombstone's reservation is released without the durable tombstone being removed. `clearIfSame` should report success/failure (or throw); release the reservation only after an exact-epoch tombstone was verifiably removed. Pure dev `#276` code.

## Gate (round 2): typecheck:all 0-err · lint exit 0 · test 3107 passed / 1 skipped.
