NOTE FOR CODEX: This is a DEFENSIVE hardening review of our own code, commissioned by the code owner, so we can fix weaknesses before release. Report weaknesses with concrete traces and recommended fixes. You run in a read-only sandbox: do NOT try to write files. Output your FULL report as your response text (it will be saved as raw/c02-profile-session-unlock-codex.md by the orchestrator). Ignore the 'Write your report to …-claude.md' line at the end. Where the instructions say to read SECURITY-PROMPT.md, read audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT-codex.md instead.

You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c02-profile-session-unlock — unlock/lock, session bearer, passkey binding, integrity, profile deletion

Repo maps: `raw/repo-map/extension-services-secrets.md`, `raw/repo-map/wallet-crypto.md` (§2 callers), `raw/repo-map/extension-messaging.md` (§3 sender auth).

Source files (read all, in full):
- `apps/extension/src/wallet/services/profile/{service.ts, session-manager.ts, spec.ts, repository.ts, tombstone-repository.ts, restore-pending-repository.ts, profile-deletion-state.ts, passkey-recovery-coordinator.ts, require-active-profile.ts, client.ts}`
- `apps/extension/src/wallet/services/passkey/{service.ts, spec.ts, check-rp-id.ts, client.ts}`
- `apps/extension/src/wallet/utils/{passkey-ceremony.ts, create-passkey-profile.ts, passkey-label.ts}` (whatever exists)
- `apps/extension/src/wallet/services/account-integrity/{coordinator.ts, blocked-repository.ts, types.ts}`
- `apps/extension/src/wallet/services/profile-deletion/{coordinator.ts, types.ts}`
- `apps/extension/src/wallet/config/{config.ts, store.ts}`, `apps/extension/src/wallet/services/config/service.ts`
- `apps/extension/src/components/passkey/*.vue` and `apps/extension/src/popup/windows/passkey/*` (ceremony UI: what it receives, what it returns)
- `apps/extension/src/onboarding/**` pages/composables that create/import/unlock (secret handling only)
- Tests as behaviour evidence: `profile/service.integration.test.ts` (skim for unlock/lock/strict-mode cases), `session-manager.test.ts`, `session-manager.fence.test.ts`.

Specific questions:
1. Trace password unlock and passkey unlock end to end: where the credential enters (RPC param over a Port), what is derived, what lands in memory vs chrome.storage.session vs local. Does ANY secret-equivalent (passhash, PRF, bearer token, master) ever reach chrome.storage.local, a log, an error message, an event payload, or the popup?
2. `strictSecurityMode`: when OFF, a bearer is persisted in chrome.storage.session. Enumerate every reader of that bearer and every path that should invalidate it (lock, TTL alarm, profile switch, profile delete, password change, restore, integrity block, SW restart). Find any path that leaves a valid bearer behind.
3. Session TTL: alarm-based. What happens when the alarm API fails, the SW is dead at expiry, or the clock is manipulated? Is there a fallback check on read?
4. Passkey PATH A (in-page modal) vs PATH B (window): who validates that the credential used belongs to the target profile (credentialId equality) and can a caller supply a credential for profile B to unlock profile A? Does `materializeCredential` accept caller-supplied PRF bytes from the popup (i.e., is the popup a trusted party for PRF)? What stops a compromised popup from replaying captured PRF output?
5. Envelope MAC v3 verify sites: is the MAC verified BEFORE any field of the profile row is used for a security decision, on every read path (unlock, silent restore, export, password change, restore, integrity)? Any read path that skips verification?
6. Password change / reseal: atomicity — can a crash mid-change leave a row whose guard/secret/entropy/dekSealed disagree? Is the old bearer invalidated?
7. `exportMnemonic`/`exportPlain`/`exportBackupMaterial`/`getProfileDekSealed`: authorization (password re-check? confirmProfileOperation?), what they return to the popup, and whether a locked-but-tombstoned profile can be exported.
8. Account-integrity coordinator: can a blocked state be cleared by storage tamper; is the "session withheld" state honoured by every consumer (dApp dispatcher, execution)? Can a mismatch on one chain block or leak across profiles?
9. Profile deletion cascade: ordering, epoch fence, what survives (PXE store, session entries, dApp sessions, MAC keys). Can a delete be aborted leaving a half-purged profile that still unlocks?
10. Multi-profile: two profiles from the same phrase share the master. Enumerate every master-derived key or MAC and check whether sibling profile A can read/fabricate anything of profile B (the DEK is the stated separator — verify every place it is actually mixed in).
11. RP-ID / host_permissions coupling for the passkey ceremony; any way a web page can trigger or intercept a ceremony.

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c02-profile-session-unlock-claude.md`.
