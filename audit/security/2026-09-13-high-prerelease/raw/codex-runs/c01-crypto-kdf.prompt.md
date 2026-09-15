NOTE FOR CODEX: This is a DEFENSIVE hardening review of our own code, commissioned by the code owner, so we can fix weaknesses before release. Report weaknesses with concrete traces and recommended fixes. You run in a read-only sandbox: do NOT try to write files. Output your FULL report as your response text (it will be saved as raw/c01-crypto-kdf-codex.md by the orchestrator). Ignore the 'Write your report to …-claude.md' line at the end. Where the instructions say to read SECURITY-PROMPT.md, read audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT-codex.md instead.

You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c01-crypto-kdf — the cryptography package and its derivation chain

Repo maps to read: `raw/repo-map/wallet-crypto.md`, `raw/repo-map/00-workspace.md` (§4 versions).

Source files (read all, in full):
- `packages/wallet-crypto/src/*.ts` (all non-test files: encryption-key, password-secret-box, session-secret-box, passkey-credential, entropy-mac, imported-account-key-box, imported-keys-dek-box, mnemonic-master, derive-account-seed, account-derivation, pxe-store-key, wallet-fingerprint, nulo-separators, secret-types, zeroize, constants)
- `packages/wallet-crypto/ATTACK-SURFACE.md`, `packages/wallet-crypto/README.md`
- `packages/aztec-runtime/src/account/account-export.ts` (uses EncryptionKey)
- `packages/wallet-core/src/utils/{mnemonic.ts (logic only, lines ~2050-2190), random.ts, encoding.ts}`
- Tests as evidence of intended behaviour: `packages/wallet-crypto/src/{nonce-uniqueness,reduction-entropy,password-secret-box,entropy-mac,session-secret-box}.test.ts`, `apps/extension/src/wallet/crypto/key-vectors.test.ts`
- Threat model + prior in-house review: `implementations-plan/key-model-v2/plan.md` §A–C and its "Security & Adversarial Considerations"; `implementations-plan/adversarial-key-model-review/findings.md`; `implementations-plan/key-model-v2-hardening/plan.md` summary.

Specific questions to answer with evidence (findings or explicit non-findings):
1. `EncryptionKey.encrypt`: PBKDF2 salt = SHA-256(IV) with a per-call random IV. Is key derivation per-encryption (600k PBKDF2 per call)? Does deriving the salt from the IV weaken anything (salt/IV coupling, multi-target attacks across ciphertexts)? Is the AAD binding sufficient for every caller?
2. `getPasshash` = unsalted SHA-256(password), used as PBKDF2 base key. Where is the passhash held/transported (RPC params? session?) and could it leak (logs, error messages, storage)? Is any comparison on secrets non-constant-time where it matters?
3. HKDF with all-zero fixed salt in `entropy-mac.ts` and `imported-account-key-box.ts` — is the info string sufficient domain separation? Any collision between HKDF info strings across modules? Can two different (chainId, address) produce the same info string (delimiter injection via `|`)?
4. `SessionSecretBox`: bearer wraps master‖dek with a random token stored ALONGSIDE the ciphertext in chrome.storage.session. Evaluate the stated threat model; is there any path where the bearer survives lock / profile switch / strict-mode flip?
5. `PasskeyCredential`: deterministic salt from credentialId; HKDF from PRF output. Cross-profile / cross-credential key separation; `userHandle` binding; what happens if a different RP presents a same-credential PRF?
6. KDF v2: `Fr.fromBufferReduce` over 64-byte PBKDF2 output; `poseidon2HashWithSeparator([master, l1ChainId, type, index], SEP)`; separator provenance; `assertCanonicalL1ChainId` bounds; `type`/`index` domain (could index collide across types? negative/NaN?).
7. `computeWalletFingerprint` = SHA-256(label‖master) stored in plaintext — quantify what it leaks (the 23/24-word oracle) and whether it enables anything beyond the documented tradeoff.
8. `zeroize` effectiveness: find secret buffers that are NOT zeroized on every exit path (including exceptions) inside this package; `Fr`/`GrumpkinScalar` internals that copy.
9. Nonce/IV reuse anywhere; any key reused across AES-GCM and HMAC; any place a ciphertext version byte is ignored.
10. Randomness: every `getRandomValues` call and any place `Math.random` or a non-CSPRNG feeds a secret/id.

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c01-crypto-kdf-claude.md`.
