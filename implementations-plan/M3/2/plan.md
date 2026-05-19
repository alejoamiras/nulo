# M3.2 — Extract `@nulo/wallet-crypto` (~3-4 days)

## Context & prerequisite

Prerequisite: **M3.1 done** (`@nulo/wallet-core` extracted and imported by extension).

M2.6 crypto test vectors already exist in `src/wallet/crypto/key-vectors.test.ts`. Those vectors must pass **before and after** this extraction — any vector regression during M3.2 means the derivation path changed and keys could be bricked.

## What goes in `@nulo/wallet-crypto`

The crypto primitives that implement the security-critical derivation chains. No Chrome APIs. No Vue. Aztec math libraries (`@aztec/stdlib/keys`, `@aztec/foundation`) are used for `deriveSigningKey` — these are math, not runtime infrastructure.

| Source tree (current) | Moves to |
|---|---|
| `src/wallet/services/profile/encryption/encryption-key.ts` | `packages/wallet-crypto/src/encryption-key.ts` |
| `src/wallet/services/profile/encryption/encryption-key.test.ts` | `packages/wallet-crypto/src/encryption-key.test.ts` |
| `src/wallet/services/profile/password-secret-box.ts` | `packages/wallet-crypto/src/password-secret-box.ts` |
| `src/wallet/services/profile/password-secret-box.test.ts` | `packages/wallet-crypto/src/password-secret-box.test.ts` |
| `src/wallet/services/passkey/credential.ts` | `packages/wallet-crypto/src/passkey-credential.ts` |
| `src/wallet/crypto/key-vectors.test.ts` | ❌ stays in `@nulo/extension` — see note below |

**`key-vectors.test.ts` stays in extension**: line 71 imports `AccountType` from `@/wallet/services/account/spec`. Since `account/spec.ts` stays in extension, the test cannot be wholesale moved to wallet-crypto. After M3.2, update `key-vectors.test.ts` in extension to import the moved crypto types from `@nulo/wallet-crypto`:
```ts
// Updated imports in key-vectors.test.ts after M3.2:
import { EncryptionKey } from "@nulo/wallet-crypto"
import { PasskeyCredential } from "@nulo/wallet-crypto"
import { PASSKEY_PRF_LABEL } from "@nulo/wallet-crypto"
import { AccountType } from "@/wallet/services/account/spec"  // stays as-is
```
The test continues to run as part of the extension's test suite, not wallet-crypto's.

**Scope boundary — what stays in `@nulo/extension`:**
- `src/wallet/services/passkey/spec.ts` — the `PASSKEY_PRF_LABEL` constant is referenced by wallet-crypto. Import from crypto package after move, OR inline the constant in crypto (it's just a string).
- `src/wallet/services/profile/repository.ts` — uses EncryptionKey but also has storage deps → stays in extension
- `src/wallet/services/profile/session-manager.ts` — uses PasswordSecretBox + SessionStore → stays in extension
- `src/wallet/services/passkey/service.ts` — uses PasskeyCredential + WindowManager → stays in extension

### Critical: passkey derivation labels (two separate constants — do NOT conflate)

There are TWO distinct domain-separator labels in the passkey derivation chain. Earlier plan drafts incorrectly described these as a single constant; they are not.

**Label 1 — `PASSKEY_PRF_LABEL` (exported, currently in `passkey/spec.ts:4`):**
```ts
export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
```
This is the `eval` argument passed to WebAuthn's PRF extension. It is the INPUT to the passkey authenticator's HMAC-based PRF. Key-vectors test V8 (`key-vectors.test.ts:183`) explicitly locks this value: `expect(PASSKEY_PRF_LABEL).toBe("nulo:profile:v1")`.

**Label 2 — `PASSKEY_KDF_LABEL` (internal, `passkey/credential.ts:8`):**
```ts
const PASSKEY_KDF_LABEL = te.encode("nulo:kdf:v1")
```
This is the HKDF `info` parameter that mixes into the derived salt (along with the PRF output and credentialId). Not exported; lives inside `credential.ts`.

**Label 3 — `PASSKEY_MASTER_LABEL` (also internal, `passkey/credential.ts:9`):**
```ts
const PASSKEY_MASTER_LABEL = te.encode("nulo:master:v1")
```

After M3.2, `credential.ts` moves to wallet-crypto along with its two internal constants (KDF_LABEL, MASTER_LABEL — they already live inside credential.ts, no separate file needed). `spec.ts` STAYS in extension; it only exports `PASSKEY_PRF_LABEL` which is used by the passkey service's WebAuthn call site.

**Decision**: move `PASSKEY_PRF_LABEL` to wallet-crypto's `src/constants.ts` as the single source of truth, value `"nulo:profile:v1"`. The extension's `passkey/spec.ts` re-exports it so existing imports keep working. The two internal labels (KDF, MASTER) remain inside `credential.ts` as `te.encode(...)` calls with their current values.

**DO NOT CHANGE ANY OF THE THREE VALUES.** They are HKDF domain separators. Any change bricks every existing passkey wallet. M2.6 vector V8 is the regression guard for `PASSKEY_PRF_LABEL`.

## Derivation invariants (guardrails — from architecture plan)

Do not change without migration + test vectors:
- `PASSKEY_PRF_LABEL = "nulo:profile:v1"` — WebAuthn PRF eval label (exported)
- `PASSKEY_KDF_LABEL = "nulo:kdf:v1"` — internal HKDF info (in credential.ts)
- `PASSKEY_MASTER_LABEL = "nulo:master:v1"` — internal master-secret HKDF info (in credential.ts)
- AES-GCM ciphertext format `[version byte][12b IV][ct]` — in EncryptionKey
- PBKDF2 iteration count — in PasswordSecretBox

M2.6 vectors pin all of these. **Run `bun run test` in wallet-crypto before committing the PR** and confirm every M2.6 vector passes.

## New package scaffold

### `packages/wallet-crypto/package.json`
```json
{
  "name": "@nulo/wallet-crypto",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@aztec/foundation": "4.2.0-nightly.20260413",
    "@aztec/stdlib": "4.2.0-nightly.20260413"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "jsdom": "^26.1.0"
  }
}
```

**Aztec deps are PEER/DIRECT** because `deriveSigningKey` from `@aztec/stdlib/keys` and `Fr` from `@aztec/foundation/curves/bn254` are used in the signing key derivation vector. These are pure math — no WASM, no node deps. They compile and test in jsdom.

### `packages/wallet-crypto/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ESNext", "DOM"],
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

`"types": []` — no chrome-types, no webworker — keeps the package browser-agnostic (Web Crypto API is in `DOM`).

### `packages/wallet-crypto/vitest.config.ts`
```ts
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
  },
})
```

### `packages/wallet-crypto/src/index.ts`
```ts
export { EncryptionKey } from "./encryption-key.js"
export { PasswordSecretBox } from "./password-secret-box.js"
export { PasskeyCredential } from "./passkey-credential.js"
export { PASSKEY_PRF_LABEL } from "./constants.js"
```

### `packages/wallet-crypto/src/constants.ts`
```ts
/** `eval` argument passed to the WebAuthn PRF extension. Domain-separates
 *  this wallet from any other site using the same passkey. Locked by M2.6
 *  vector V8. DO NOT CHANGE — changing this bricks all existing passkey wallets. */
export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
```

The two INTERNAL labels (`PASSKEY_KDF_LABEL = "nulo:kdf:v1"`, `PASSKEY_MASTER_LABEL = "nulo:master:v1"`) remain inside `passkey-credential.ts` as module-private `te.encode(...)` calls. They are not exported and do not move to `constants.ts`.

## Changes in `@nulo/extension`

### `package.json`
```json
{
  "dependencies": {
    "@nulo/wallet-core": "workspace:*",
    "@nulo/wallet-crypto": "workspace:*"
  }
}
```

### Import migrations in extension

| Old import | New import |
|---|---|
| `from "@/wallet/services/profile/encryption/encryption-key"` | `from "@nulo/wallet-crypto"` |
| `from "@/wallet/services/profile/password-secret-box"` | `from "@nulo/wallet-crypto"` |
| `from "@/wallet/services/passkey/credential"` | `from "@nulo/wallet-crypto"` |
| `from "@/wallet/services/passkey/spec"` (PRF_LABEL only) | `from "@nulo/wallet-crypto"` |

Affected files (~6):
- `src/wallet/services/profile/repository.ts` — imports EncryptionKey
- `src/wallet/services/profile/session-manager.ts` — imports PasswordSecretBox
- `src/wallet/services/profile/service.ts` — imports both
- `src/wallet/services/profile/passkey-recovery-coordinator.ts` — imports PasskeyCredential
- `src/wallet/services/passkey/service.ts` — imports PasskeyCredential + PASSKEY_PRF_LABEL
- `src/wallet/crypto/key-vectors.test.ts` — stays in extension; update its imports to `@nulo/wallet-crypto`

### `src/wallet/services/passkey/spec.ts` — re-export the constant
```ts
// Keep the constant re-exported so any external code that already imports from this path doesn't break:
export { PASSKEY_PRF_LABEL } from "@nulo/wallet-crypto"
```

## Test strategy

**Before M3.2**: Run `bun run test` in extension — record all M2.6 vector results.

**M3.2 test migration**:
1. `encryption-key.test.ts` → moves with `encryption-key.ts`. Run as `bun run test` in `packages/wallet-crypto/`.
2. `password-secret-box.test.ts` → moves with it.
3. `passkey-recovery-coordinator.test.ts` — stays in extension (tests the coordinator, not crypto primitives directly).
4. `key-vectors.test.ts` → stays in extension but update its imports:
   - `from "@/wallet/services/profile/encryption/encryption-key"` → `from "@nulo/wallet-crypto"`
   - `from "@/wallet/services/passkey/credential"` → `from "@nulo/wallet-crypto"`
   - `from "@/wallet/services/passkey/spec"` (PRF_LABEL) → `from "@nulo/wallet-crypto"`
   - `from "@/wallet/services/account/spec"` (AccountType) → stays as-is

**After M3.2**: Run `bun run test` in `packages/extension/` — every vector in `key-vectors.test.ts` must pass byte-for-byte. The test runs as an extension integration test, exercising wallet-crypto primitives via the new package path.

**Deferred vectors** (V4, V7b, V10, P2 — require bb.js WASM poseidon2): these are documented as deferred in the M2.6 test file. They stay deferred; M3.2 does not add WASM infrastructure to wallet-crypto. If WASM tests are needed later, add a separate `vitest.e2e.config.ts` with a custom pool worker.

## Verification cadence

**Step 0 (pre-extraction refactor — decouple Buffer global):** `passkey/credential.ts:25` and `password-secret-box.ts:127` use the `Buffer` global, which exists in extension only because `@aztec/*` transitively pulls `@types/node`. Wallet-crypto's `"types": []` tsconfig rejects this. Before the extraction PR, add `import { Buffer } from "buffer"` at the top of both files. Verify M2.6 vectors still pass byte-for-byte (bytes are unchanged; only the type import is different). This is a pure-typecheck fix — no behavior change.

1. Run M2.6 vectors in current extension → record baseline output
2. Create wallet-crypto scaffold
3. Move files (crypto primitives first, then tests)
4. Update extension imports
5. `bun run typecheck` — zero errors in both packages
6. `bun run test` in `packages/wallet-crypto/` — all M2.6 vectors pass
7. `bun run test` in `packages/extension/` — no regressions
8. `bun run build` — extension builds clean
9. Smoke: unlock wallet, verify passkey flow still works

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | **M2.6 vector regression**: derivation path changes silently during file move | LOW | Vectors run before + after; any diff is a blocker |
| 2 | **`@aztec/stdlib/keys` has node deps that break jsdom**: deriveSigningKey may pull in node-specific code | MED | Vector V7a already passes in current jsdom vitest; if it breaks, check if a dep changed or import paths diverged |
| 3 | **PASSKEY_PRF_LABEL re-export chain**: if spec.ts re-exports from wallet-crypto and something imports from spec.ts transitively, the indirection must be stable | LOW | Simple re-export; no logic |
| 4 | **`passkey-recovery-coordinator.ts` still in extension**: it imports PasskeyCredential. After move, it uses `@nulo/wallet-crypto` — verify the type shapes survive the import change | LOW | Same type definition, different path |
| 5 | **`credentials.ts` file rename** (`credential.ts` → `passkey-credential.ts`): import paths in coordinator must update | LOW | Handled in import migration step |

## Size estimate

3-4 days:
- 0.5 day: vector baseline + scaffold
- 1 day: file moves + import migrations
- 0.5 day: typecheck + test verification
- 0.5 day: build + smoke test
- 0.5 day: buffer for Aztec dep surprises
