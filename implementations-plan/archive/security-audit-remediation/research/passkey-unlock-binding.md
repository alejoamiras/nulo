# Research: Passkey unlock binding (F-007)

**Assessment**: Genuinely 4 lines + 1 test. No hidden complexity.

## The exact mirror (`exportPlain` binding check)

`packages/extension/src/wallet/services/profile/service.ts:656-660`:
```typescript
const recovery = await this.passkeyCoordinator.recoverFromCredentialData(credentialData)
try {
    if (recovery.credentialId !== profile.credentialId) {
        throw new Error("Invalid profile id")
    }
}
```

This is the canonical pattern: compare `recovery.credentialId` against the profile's stored `credentialId`. Throws plain `Error("Invalid profile id")`.

## Where the new check goes in `unlockPasskeyProfile`

File: `packages/extension/src/wallet/services/profile/service.ts`
Insertion site: **immediately after line 311** (where `recovery` is obtained), **before** Phase 3 re-enters the lock at line 313+.

BEFORE (current state):
```typescript
// Phase 2 — WebAuthn prompt, UNLOCKED.
const recovery = await this.acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)

// Phase 3 — re-enter lock, revalidate credentialId, open session.
try {
    await this.lock.enter()
    const current = await this.repo.get(id)
    // ...
```

AFTER (4-line insertion):
```typescript
const recovery = await this.acquireRecovery(...)

// NEW BINDING CHECK
if (recovery.credentialId !== snapshot.credentialId) {
    throw new Error("Invalid profile id")
}

// Phase 3 — re-enter lock, revalidate credentialId, open session.
try {
    await this.lock.enter()
    // ...
```

Phase 3's existing rotation check at lines 323-326 (`current.credentialId !== snapshot.credentialId`) stays as a safety net.

## Error type + IPC

- Plain `Error("Invalid profile id")` (matches `exportPlain`)
- Round-trips through `@nulo/extension-messaging` via `getErrorMessage(error)` (from `@nulo/wallet-core/utils`)
- Arrives at popup as `new Error("Invalid profile id")` (generic Error, NOT a `WalletError` subclass)
- Existing test confirms the message-string at line 329: `.rejects.toThrow(/Invalid profile id/)`

## Test scaffold (`service.integration.test.ts:321-330`)

```typescript
test("exportPlain passkey rejects credentialData for a different credential", async () => {
    // Bind safety: if the popup hands back a `PasskeyCredentialData`
    // whose id doesn't match the profile's stored credentialId, the
    // service must throw rather than return whichever credentialId
    // happens to be in storage.
    const { service } = await makeService()
    const profile = await service.createPasskeyProfile("PK")
    const wrongCred = fakeCredentialData("cred-OTHER", profile.id)
    await expect(service.exportPlain(profile.id, undefined, wrongCred)).rejects.toThrow(/Invalid profile id/)
}, 30_000)
```

Adaptation for `unlockPasskeyProfile`:
1. Create passkey profile (stores `credentialId: cred-${id}`)
2. Call `unlockPasskeyProfile(id, wrongCred)` where `wrongCred.id !== cred-${id}`
3. Assert `.rejects.toThrow(/Invalid profile id/)`

Test infrastructure already exists: `fakeCredentialData()` + `FakePasskeyService`.

## Adjacent passkey paths

- `unlockPasskeyProfile` — **THE TARGET** (Path A: caller-supplied credentialData)
- `createPasskeyProfile` (lines 214-259): NEW profile, no binding risk
- `importPasskey` (lines 337-346): first-time import, one-way binding
- `restore()` passkey branch (lines 900-961): ALREADY has the binding check at line 916 (`recovery.credentialId !== masterKey`)

Conclusion: `unlockPasskeyProfile` is the ONLY missing site.

## Risk analysis

**Legitimate cases where check would fire**:
- Credential rotation: user deletes old passkey + imports new one under same profile. But this flow re-creates the profile with a new id; Phase 3's rotation check (line 323-326) already catches.
- Popup bug supplying wrong credential: **this is the security hole being patched**.
- Race during Phase 2: user authenticator takes minutes; profile re-created in between. New binding check catches the credential mismatch precisely; Phase 3's lock catches the profile mismatch.

No legitimate user-facing edge case breaks. Pure tightening.

## Total cost

- Patch: 4 lines
- Test: 1 new test file or 1 new test in `service.integration.test.ts`
- Hours: < 1
