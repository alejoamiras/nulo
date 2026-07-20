# Q-06 Implementation Plan

## Hard Limits

Do not edit KDF, iterations, AES-GCM framing, passkey HKDF labels, or vector fixtures. The frozen oracle is `apps/extension/src/wallet/crypto/key-vectors.test.ts`, not the path named in the prompt. It pins `getPasshash`, PBKDF2 `600_000`, AES-GCM layout, passkey HKDF, and signing-key derivation.

Default stance: do not change persisted `chrome.storage.session` shape or backup schema v2. Split the internal/RPC restore payload, but keep the v2 backup `"master-key"` field as-is unless the owner explicitly approves a schema migration.

## PR A: Branded Types, Type-Only

Use nominal type aliases with `unique symbol` brands in `packages/wallet-crypto/src/secret-types.ts`, exported from `index.ts`. Do not use classes: they change runtime identity and can break Web Crypto, `Buffer`, `Fr.fromBuffer`, and `zeroize`. Do not use `zod.brand()`: this package currently has no zod dependency and Q-06’s safe half must be zero-runtime.

Core seven brands:

| Brand | Runtime type | Minted at | Consumed at |
|---|---:|---|---|
| `Passhash` | `ArrayBuffer` | `EncryptionKey.getPasshash`; session restore decode after slicing pooled `Buffer` | `EncryptionKey.fromPasshash`, `PasswordSecretBox.*WithPasshash`, `SessionSecretUnsealer`, `SessionManager.open` |
| `MasterSecretBytes` | `Uint8Array<ArrayBuffer>`; `Buffer<ArrayBuffer>` allowed structurally | `Fr.random().toBuffer`, `PasswordSecretBox.unseal*`, passkey `deriveMasterSecret`, base64 import after length check, mnemonic entropy | `PasswordSecretBox.seal*`, `SessionManager.open`, `Fr.fromBuffer`, `getMnemonic`, export base64 |
| `Salt` | `ArrayBuffer` | SHA-256 digest of AES IV in `encryption-key.ts`; SHA-256 digest of passkey KDF label + credential id in `passkey-credential.ts` | PBKDF2/HKDF derive calls |
| `Base64Ciphertext` | `string` | `PasswordSecretBox.sealInternal` via `toBase64`; encrypted backup output | `EncryptedProfileSecret.guard`, `EncryptedProfileSecret.secret`, decrypt/import paths |
| `Base64CredentialId` | `string` | `passkey-ceremony.ts` rawId encoding; backup v2 passkey `"master-key"` after profile-type narrowing | passkey get options, profile `credentialId`, restore passkey arm |
| `Base64SecretPrf` | `string` | `passkey-ceremony.ts` PRF result encoding | `PasskeyCredential.create` HKDF IKM decode |
| `HexUserHandle` | `string` | `ProfileRepository.generateUniqueId` and WebAuthn assertion `userHandle` hex decode | passkey create options, passkey profile id binding |

Zeroization stays unchanged. `zeroize<T extends Uint8Array | ArrayBuffer | undefined | null>` remains structurally compatible with branded bytes. Branded strings are still immutable and not zeroizable; keep existing comments where base64 strings escape.

Important adversarial note: Q-06’s seven brands do not include the password backup `"master-key"` base64 plain master secret. Do not lie and call it `Base64Ciphertext`. Either add a small eighth brand, `Base64MasterSecret`, or accept that this one RPC/import boundary remains primitive until decoded into `MasterSecretBytes`. My recommendation is to add `Base64MasterSecret` in PR B, documented as restore-specific.

## PR B: Split Restore Shape

Introduce:

```ts
type RestoreSecret =
  | { type: "password"; masterKey: Base64MasterSecret }
  | { type: "passkey"; credentialId: Base64CredentialId }
```

If owner refuses the eighth brand, use `masterKey: string` only at the import/RPC edge and immediately decode into `MasterSecretBytes`.

Change `Methods.restore` from:

```ts
restore(profile, masterKey, password?, credentialData?)
```

to:

```ts
restore(profile: ProfileInfo, secret: RestoreSecret, password?: string, credentialData?: PasskeyCredentialData)
```

In `ProfileService.restore`, first assert `secret.type === profile.type`. Password branch decodes `secret.masterKey`, keeps the existing 32-byte length check, seals with `PasswordSecretBox`, writes password profile, and still does not open a session. Passkey branch uses `secret.credentialId` for both ceremony targeting and the credential binding check: `recovery.credentialId !== secret.credentialId` remains the P0 guard.

Every write/read site to update:

| Site | Change |
|---|---|
| `apps/extension/src/wallet/services/profile/spec.ts:240-262` | Replace dual-role docs with `RestoreSecret` contract. |
| `apps/extension/src/wallet/services/profile/client.ts:104-110` | Send `RestoreSecret` object. |
| `apps/extension/src/wallet/services/profile/service.ts:840-994` | Switch on `secret.type`, not overloaded `masterKey`. |
| `apps/extension/src/composables/useFullBackupImport.ts:245-287` | Read v2 `"master-key"`, construct `{type:"password", masterKey}` or `{type:"passkey", credentialId: masterKey}` before calling client. |
| `apps/extension/src/popup/pages/settings/security/export/full.vue:116-132` | No persisted schema change by default; still writes `"master-key": key`. Update comments only if useful. |
| Tests in `service.integration.test.ts` and `useFullBackupImport.test.ts` | Replace positional string expectations with discriminated object expectations. |

Session shape is not part of this split. `SessionManager.open` writes `{profile, passhash?, since, lockedAt?}` at `session-manager.ts:202-218`; `restore` reads it at `335-413`; `refresh` and `clearPasshash` also rewrite it. Do not modify those fields for Q-06. If someone proposes a persisted session split, stop and ask owner: ephemeral old sessions can be silently closed, but that must be explicit.

## Behavior-Preservation Tests

Add deterministic integration coverage in `apps/extension/src/wallet/services/profile/service.integration.test.ts`, reusing `FakeBrowserApi`, `makeServiceFromExistingApi`, and `FakePasskeyService`.

Test name 1: `restore/finalize password profile survives simulated SW restart via chrome.storage.session`.

Flow: create service with strict mode off, call `restore(password profile, {type:"password", masterKey}, "pass1234")`, call `finalizeRestore`, assert active profile id, assert `SESSION_STORAGE_ROOT` has a passhash, construct a fresh `ProfileService` over the same `FakeBrowserApi`, and assert `getActiveProfile()` returns the restored id. This catches asymmetric write/read changes in the persisted session restore path.

Test name 2: `restore/finalize passkey profile round-trips across simulated SW restart without silent activation`.

Flow: create a passkey profile to get deterministic credential id, lock and delete it, call `restore(passkey profile, {type:"passkey", credentialId}, undefined, fakeCredentialData(...))`, finalize, assert active. Then construct a fresh service over the same `FakeBrowserApi`. Expected behavior, per `session-manager.ts:351-355`, is no active profile because WebAuthn requires user gesture, and the persisted session record remains. Then call `unlockPasskeyProfile(out.id, fakeCredentialData(credentialId, out.id))` and assert it opens. If owner expects silent passkey restore, that is a product/security change, not Q-06.

Run gates: `bun run typecheck`, `bun run --cwd packages/wallet-crypto test`, `bun run --cwd apps/extension test -- src/wallet/crypto/key-vectors.test.ts src/wallet/services/profile/service.integration.test.ts`.

## Decision Ledger

Facts: profile password records store `guard` and `secret` strings, passkey records store `credentialId` string at `spec.ts:18-29`. Session persists optional base64 passhash at `spec.ts:31-54` and `session-manager.ts:202-218`. Cold restore currently only rehydrates password profiles, while passkey profiles short-circuit at `session-manager.ts:351-355`. Full backup v2 writes `"master-key"` at `full.vue:127-143` and import reads it at `useFullBackupImport.ts:201-287`.

Inferences: branding can be type-only if all brands are minted at existing trust boundaries with identity casts. The restore split does not require changing backup v2 or `chrome.storage.session`.

Asks: approve adding `Base64MasterSecret`, or accept one primitive restore edge. Confirm no backup schema v3 for this finding. If persisted shape changes are requested anyway, choose tolerate-old-v2 versus reject-with-message for backups, and silent-close versus tolerate-old for session records.