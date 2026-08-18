# key-model-v2 — recovery-phrase-centric key model + NULO-ACCOUNT-KDF v2

**Status:** DRAFT — pending dual audit (codex + fable) and owner approval.
**Tier:** `/blueprint mid` (rubric: security sensitivity HIGH; novelty/blast/irreversibility/migration/external-coupling low-med — pre-production, no users, no migrations).
**eli5_mode:** Artifact (URL recorded in § Seeds once published; source `eli5.html` in this dir).
**Worktree/branch:** `key-model-v2` / `worktree-key-model-v2`. Recon: [recon.md](recon.md).

## Summary

Pre-production window, one coordinated break. Two halves:

1. **Product model** — make the export taxonomy match the key hierarchy. Wallet level: the 24-word **Recovery Phrase** becomes the only secret export (plain "Secret Key" export + import deleted; Full Backup untouched). Account level: new **Export Account / Import Account** (Nulo-format JSON, encrypted + plaintext variants) for the per-account keys — the thing EVM users expect "private key" to mean.
2. **NULO-ACCOUNT-KDF v2** — adopt the real BIP-39 PBKDF2 step (empty passphrase default; the words stop being a raw re-encoding of the master), derive the account seed from `l1ChainId` (not the XOR composite) under a dedicated Nulo domain tag, replace the borrowed `IVSK_M` separator in seed→signingKey with a Nulo constant, and validate mnemonic imports at the service boundary. Every derived address changes; this is the deliberate, licensed, one-time pre-launch baseline redefinition.

Non-goals: passphrase ("25th word") UI (the KDF supports it with `""` default; adding UI later is non-breaking), foreign-account import (non-Nulo artifacts), BIP-32/SLIP-0010 (rejected — see ledger), any storage migration (pre-production: none are written), faucet/landing changes.

## Success criteria

- A fresh profile is entropy-originated; its 24 words re-display from stored entropy; the same words re-import to the same accounts (KAT-pinned end-to-end: words → entropy → master → seed → address).
- Wallet-level UI offers exactly: Recovery Phrase, Full Backup. No plain/encrypted Secret Key export or import surfaces remain.
- An account exported on machine A imports on machine B (same extension build) and can sign; a tampered export or tampered stored key fails closed.
- All gates green: `bun run audit:vue`, `bun run test:e2e`, `bun run e2e:agent` (including the updated frozen-account canary, prover-ON).

---

## Architecture & Implementation

### A. NULO-ACCOUNT-KDF v2 (the crypto spine)

```
entropy (32B CSPRNG) ⇄ 24 words                    existing codec, packages/wallet-core/src/utils/mnemonic.ts (unchanged)
seed64  = PBKDF2-HMAC-SHA512(NFKD(words.join(" ")), "mnemonic" + passphrase(""), 2048, 64B)   [BIP-39 standard]
master  = Fr.fromBufferReduce(seed64)               idiom precedent: passkey-credential.ts:75
account = poseidon2HashWithSeparator([master, l1ChainId, type, index], NULO_ACCOUNT_SEED_SEP)
signing = sha512ToGrumpkinScalar([account, NULO_SIGNING_ROOT_SEP])          (was: DomainSeparator.IVSK_M)
secret  = deriveSecretKeyFromSigningKey(signing)    upstream 5.0.1, one-way — hierarchy unchanged
… deriveKeys(secret) → frozen artifact/descriptor → address                 (all unchanged)
```

- **Constants**: `NULO_ACCOUNT_SEED_SEP` and `NULO_SIGNING_ROOT_SEP` are u32s derived as the first 4 bytes (big-endian) of `sha256("nulo:account-seed:v2")` / `sha256("nulo:signing-root:v2")` — reproducible provenance, values pinned in KATs. A unit test asserts neither collides with any exported upstream `DomainSeparator` value.
- **PBKDF2 home**: new `packages/wallet-crypto/src/mnemonic-master.ts` (`deriveBip39Seed(words, passphrase="")` → 64B via `self.crypto.subtle.deriveBits`, and `deriveMasterFromMnemonic(words)` → `MasterSecretBytes`). wallet-core's `mnemonic.ts` stays a pure word codec (layer boundary: wallet-core → wallet-crypto). WebCrypto PBKDF2 already runs in the MV3 SW (encryption-key.ts:15-31); SHA-512 is a param change, no new dependency.
- **2048 iterations is the BIP-39 spec constant**, not our brute-force defense — our entropy is 256-bit CSPRNG; the at-rest defense remains PBKDF2-SHA256/600k + AES-GCM (unchanged).
- **Passkey path untouched** (independent HKDF chain; converges on the same `MasterSecretBytes` shape).
- **Entropy-preservation analysis** (the owner's named concern): entropy source is 32 CSPRNG bytes (256-bit) — `Fr.random()` is no longer in the master path, so the master's input entropy *rises* from ~253.5 to 256 bits. PBKDF2 is entropy-preserving. `Fr.fromBufferReduce` on 512 uniform bits mod r (~2^253.5) has statistical bias ≤ 2^-258 — cryptographically negligible. No step narrows the keyspace; auditors are explicitly asked to attack this claim.

### B. Chain identity in derivation

- `Network` row gains a persisted **`l1ChainId`** field (spec + `_buildNetwork` seed paths + `addNetwork`/`addEndpoint`/`updateEndpoint` threading + `restore()` guard). `_getChainId()`'s XOR composite **stays** as the storage-scoping key everywhere (`Account.chainId`, `accountRowId`, purge fan-out, node cache, drift check) — recon §3.3/3.4: conflating the two ripples far outside scope.
- `AccountService` resolves `l1ChainId` via a narrow injected lookup (`(chainIdComposite) => l1ChainId`, backed by NetworkService rows) at `deriveAccountSecret`/`getAccountContract` time — callers cannot feed a mismatched pair.
- Local networks: `l1ChainId` is probed from the node at enrollment (anvil: 31337) instead of the composite-0 convention; the composite stays 0 for local scoping/drift-skip semantics. Rollup upgrades (version bumps) no longer re-derive accounts; testnet↔mainnet↔local stay separated by L1 id.
- `chain-ids.ts`: promote the testnet L1/rollup pair to named exports; faucet's independent pin untouched (no wallet derivation there).

### C. Profile storage: store-both (sealed entropy + sealed master)

- `Profile` (password variant) gains `entropy?: Base64Ciphertext` sealed under the same password box as `secret` (the derived master). Rationale (recon §3.7): unlock already pays one PBKDF2-600k; the silent bearer-restore path cannot re-run a mnemonic KDF; `exportMnemonic` reads entropy directly.
- `createProfile`: generate 32B entropy (CSPRNG — plain random bytes, NOT `Fr.random()`; entropy is pre-PBKDF2 and needs no field bound) → derive master → seal both.
- `importMnemonic`: service-boundary validation **before any persistence** — exactly 24 words, all on the wordlist, checksum valid → entropy → derive master → seal both.
- `exportMnemonic`: words from stored entropy. Profiles without entropy (passkey; hypothetical legacy) → clear "not available" error; pre-production there are no legacy rows in the wild.
- `exportPlain` continues returning the **derived master** (backup `master-key` semantics unchanged — recon §3.6); backup format gains an `entropy` slice/field so restored profiles keep phrase re-display; **`CURRENT_COMPAT_EPOCH` 3→4** (old blobs must reject: their account rows would fail integrity re-derivation under KDF v2).
- Paired invariant test: for any stored profile, `deriveMasterFromMnemonic(getMnemonic(unsealed entropy)) == unsealed master`.

### D. Product cuts (wallet level)

- Delete `export/key.vue` wholesale + its nav row (`export/index.vue:47`) + `security/index.vue:203` copy; `exportPlain` **stays** as an internal service method (Full Backup dependency — recon §3.1). `exportEncrypted` service method + UI cut (pending Ask A1).
- Delete `importPlain` end-to-end (service+spec+client+UI+tests — recon §3.2). Delete `importEncrypted` + `public_key` import surface (pending Ask A1).
- `useProfileImportFlow` / `ImportMethodPicker` / `ImportSecretForm` / both `import.vue` shells trimmed to seed + full-backup + passkey.
- Copy: "Seed Phrase" → "Recovery Phrase" across the SFCs recon mapped (no i18n layer; inline edits).

### E. Export/Import Account (account level)

- **Export JSON v1** (plaintext variant):
  ```json
  { "format": "nulo-account-export", "version": 1, "regime": "<regime id>",
    "l1ChainId": 31337, "address": "0x…", "signingKey": "0x…64hex",
    "secretKey": "0x…64hex", "checksum": "<sha256 of canonical payload>" }
  ```
  Field elements as `0x`-hex **inside the typed envelope** (Aztec-native convention; the envelope prevents the bare-hex masquerade problem). `secretKey` is informational/interop (derivable from `signingKey`); import requires only `signingKey` and **verifies** `secretKey` if present. Checksum = integrity, not auth (backup-format framing).
- **Encrypted variant**: same payload wrapped via `EncryptionKey.fromPassword` AES-GCM with a **new** guard constant (`ACCOUNT_EXPORT_GUARD` — never reuse `ENCRYPTION_GUARD`, recon reuse-map) + version byte. New branded types (`Base64AccountExportCiphertext` etc.) per secret-types convention.
- **Import** (Nulo-format only): parse with size cap + schema validation (input is HOSTILE) → regime id must match the build's regime → recompute address from `signingKey` via `NuloAccount.fromSigningKey` + frozen descriptor → must equal the file's `address` → store.
- **`NuloAccount.fromSigningKey(signingKey, logger)`** — new factory in `nulo-account.ts`: derives `secretKey` internally, then runs the existing key-agnostic tail (privacy keys, instance, CompleteAddress). The private ctor already accepts everything (recon reuse-map).
- **Storage**: `AccountType.Imported = 1` (own index sequence — free, per-type index math). New root `nulo:core:imported-account-keys` (EntityStorage; row id mirrors `accountRowId`), value = signing key encrypted under `HKDF(master, "nulo:imported-account-key:v1")` AES-GCM — unlock-gated, travels inside Full Backup because master does. Registered in `BACKUP_SLICE_REGISTRY` as a normal root slice + footprint coverage (recon §3.8: unregistered roots are rejected/silently-lose-keys).
- **Signing path**: `getAccountContract`'s type guard becomes a branch — `Nulo_v1` → derive (unchanged); `Imported` → load + decrypt key → `fromSigningKey` → **assert constructed address == row.address, else fail closed** via the `raiseRuntimeMismatch` pattern (recon §3.9 — the integrity coordinator deliberately skips imported rows, so this branch owns their tamper detection). `ensureDefaultAccount` excludes `Imported` from the candidate pool (recon §3.10).
- **UI**: Export = 4th icon on Manage Accounts rows → popup (password confirm → variant pick → reveal/`downloadFile`); Import = sibling entry next to "Add account" → popup (paste/file + password if encrypted). Imported accounts get a persistent badge + copy: "Not covered by your recovery phrase — keep its export file safe."

### F. Freeze/vector reconciliation

- **Regime record**: in-place redefinition of the launch baseline (pending Ask A2): `kdf: "nulo-account-kdf-v2"`, new **`kdfDigest`** field = sha256 of a canonical formula-spec string (committed alongside), threaded into the `ack` string; `address-freeze.test.ts` literals updated in the same reviewed commit. This closes recon §4's "no mechanical tripwire for KDF changes" gap.
- **Vectors**: regenerate seed→signingKey reference vectors via a re-parameterized copy of the regime-b generator (published-tarball posture, Nulo separator injected — provenance documented in the reference dir). **New** KAT set: account-seed formula vectors `(master, l1ChainId, type, index) → seed` + one full-chain vector (words → address), generated by an independent script under `implementations-plan/key-model-v2/reference/`, never from the wallet's own helpers. BIP-39 trezor vectors now assert the seed64 column (mnemonic.test.ts already carries it unasserted).
- **Canary** (`frozen-account-canary.test.ts`): stage-1 recompute updated to the v2 formula (l1ChainId=31337 local), and its master capture **reworked** — `revealSecretKey(plain)` dies with the UI; capture master + entropy from the Full Backup JSON instead.

### G. Data & control flow (critical paths)

- Create: onboarding → `createProfile` → entropy+master sealed → session opens with master Fr → accounts derive per B.
- Re-import: words → validate → PBKDF2 → master → same addresses (KAT-pinned).
- Import account: file → validate/decrypt → address recompute check → key sealed to imported-root → row written → signing loads via the Imported branch.
- Restore: backup (epoch 4) → master-key + entropy slices → profile reseeded → derived accounts re-derive; imported accounts' key root restores as a slice.

### H. File-level change map (net)

| Area | Files |
|---|---|
| wallet-crypto | + `mnemonic-master.ts`(+test), + `nulo-separators.ts`(+non-collision test), ~ `account-derivation.ts`(+test/vectors), + account-export envelope module(+test), ~ `secret-types.ts` (new brands) |
| wallet-core | ~ `mnemonic.test.ts` (checksum-rejection + trezor seed column), codec itself unchanged |
| aztec-runtime | ~ `nulo-account.ts` (`fromSigningKey`), ~ `address-freeze.ts`+test (kdf label, kdfDigest, ack), derivation-vectors regenerated |
| extension: network | ~ `network/spec.ts` (+`l1ChainId`), ~ `network/service.ts` (threading), ~ `utils/chain-ids.ts` |
| extension: account | ~ `account/spec.ts` (`Imported=1`, import RPC), ~ `account/service.ts` (seed v2, lookup dep, import/export RPCs, branch, default-pool), + imported-keys repository, ~ client.ts |
| extension: profile | ~ `profile/spec.ts` (+entropy), ~ `profile/service.ts` (create/importMnemonic/exportMnemonic; − importPlain; − exportEncrypted per A1), ~ client.ts |
| extension: backup | ~ registry (epoch 4, entropy handling, imported-keys slice), ~ footprint coverage |
| extension: UI | − `export/key.vue`; ~ export/index, security/index, ImportMethodPicker, ImportSecretForm, useProfileImportFlow, both import.vue; + AccountExportPopup, + AccountImportPopup, ~ accounts/index.vue, ~ NewAccountPopup footer copy |
| tests/e2e | ~ canary (formula + capture), − plain/encrypted import-export legs, + account export/import smoke, ~ helpers (`revealSecretKey` retired, `importPlainKey` deleted) |
| docs | CLAUDE.md (§ freeze note pointer), ARCHITECTURE.md (KDF v2, profile row), UPDATE.md if touched, `implementations-plan/index.md` |

### I. Trade-offs & alternatives not taken

1. **PBKDF2 vs entropy-as-master** — see Competing Outline B below; chosen for standard semantics + free future passphrase + dissolving the ≥r import bug. Cost: profile schema fork (entropy field), one-way words.
2. **Store-both vs derive-on-unlock** — store-both chosen (bearer-restore path structurally can't re-KDF; unlock latency already budgeted once).
3. **l1ChainId persisted vs reverse-lookup vs re-probe** — persisted field chosen (general; the lookup table breaks custom networks; re-probe makes account creation network-dependent).
4. **Dedicated signing-root separator vs keeping IVSK_M** — dedicated chosen: this plan already re-derives every address, and it's the only chance to get clean domain separation; cost is regenerating seed→signingKey reference vectors with a re-parameterized generator (published-tarball posture retained). Keeping IVSK_M preserved third-party provenance but froze the wart permanently.
5. **In-place regime redefinition vs append-new-id** — in-place recommended (nothing shipped under nulo-v5; append implies a rotation that never happened). Ask A2.
6. **Imported-key storage: own root + HKDF(master) envelope vs rows on the Account entity** — own root chosen (Account rows stay secret-free; backup slice granularity; footprint discipline).
7. **BIP-32/SLIP-0010** — rejected (xpub semantics don't map to Aztec's address model; hardened-only ≈ our poseidon fan-out; no ecosystem standard exists to conform to; published KATs are our interop story).

---

## Competing Outline B — "minimal-crypto" (for the audits to weigh)

Same product model (cuts + Export/Import Account), same l1ChainId + domain tags + validation + regime/kdfDigest work, but **no PBKDF2**: entropy stays the master verbatim (words ⇄ master bijection preserved).

- Pros: no profile schema change (no entropy field), `exportMnemonic` keeps working for any password profile, smaller P3, one fewer KDF in the spec.
- Cons: mnemonic semantics stay nonstandard ("looks like BIP-39, isn't"); no passphrase option ever without another address-breaking change; the ≥-modulus import rejection (~81% of foreign 24-word phrases; and a validity constraint even on our own space) must be re-added and lived with; master input entropy stays ~253.5 bits (vs 256).
- Shared costs either way: compat-epoch bump (addresses change from the seed-formula change alone), vectors/canary/regime work identical.

Draft's position: Outline A (PBKDF2). The audits are asked to argue this fork explicitly.

---

## Phases

### Phase 1 — KDF v2 primitives (packages)
`mnemonic-master.ts` (PBKDF2-SHA512 + trezor-vector tests), `nulo-separators.ts` (+ upstream non-collision test), `account-derivation.ts` v2 separator + regenerated reference vectors (re-parameterized generator, provenance documented), wallet-core checksum-rejection tests (verify + enforce `getEntropy` checksum behavior — Inference I1), regime record + kdfDigest + address-freeze test literals.
**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0, new KATs green with pinned values committed. Layers: lint/typecheck/unit.

### Phase 2 — chain identity + account-seed v2 (extension services)
Network `l1ChainId` field + threading; chain-ids exports; AccountService seed formula v2 + l1ChainId lookup dependency; new account-seed KAT + full-chain vector (+ generator under `reference/`); canary recompute line updated (runs in P6).
**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0; account/network unit+integration suites green; full-chain KAT green. Layers: lint/typecheck/unit/integration.

### Phase 3 — profile entropy model
Entropy-originated `createProfile`; `importMnemonic` boundary validation (24 words/wordlist/checksum, pre-persistence) + PBKDF2 + store-both; `exportMnemonic` from entropy; profile spec field; paired invariant test; backup entropy handling + `CURRENT_COMPAT_EPOCH` 4; restore path.
**Validation gate** — commands: `bun run lint && bun run typecheck:all && bun run test` (includes `profile/service.integration.test.ts`). Pass: exit 0; create→export-words→re-import→same-address integration test green; epoch-3 blob rejection test green. Layers: lint/typecheck/unit/integration.

### Phase 4 — product cuts + copy
Delete `export/key.vue` + importPlain end-to-end (+ encrypted-key surface per A1); flow/composable trims; copy renames; unit/component test rewrites; e2e helper retirement + smoke-test updates.
**Validation gate** — commands: `bun run audit:vue && bun run test:e2e`. Pass: both exit 0; smoke suite green with the reworked backup/import specs. Layers: typecheck/unit/component/build + smoke e2e.

### Phase 5 — Export/Import Account
`NuloAccount.fromSigningKey`; export envelope (plaintext + encrypted, new guard); `AccountType.Imported`; imported-keys root + HKDF envelope; import/export RPCs; signing branch with fail-closed address assert; default-pool exclusion; backup slice + footprint coverage; UI popups + badge + copy; component tests; new smoke e2e (export→import round-trip in fresh profile, tamper rejection).
**Validation gate** — commands: `bun run audit:vue && bun run test:e2e`. Pass: both exit 0; round-trip + tamper smoke green. Layers: typecheck/unit/component/build + smoke e2e.

### Phase 6 — reconciliation + network e2e
Canary rework (Full-Backup capture path, v2 recompute, prover-ON); docs (ARCHITECTURE.md KDF section, CLAUDE.md pointer updates, index.md); full network suite.
**Validation gate** — commands: `bun run e2e:agent` then `bun run audit:vue`. Pass: network suite green including `tests/e2e/network/frozen-account-canary.test.ts` prover-ON; audit:vue exit 0. Layers: full e2e-live-network + fast layers. (Per owner memory: run the network suite solo on the host; re-run before triaging any failure.)

---

## Security & Adversarial Considerations

- **Threat model**: attacker-supplied account-export files and backup blobs (parse with size caps + schema validation, treat as HOSTILE per migration-framework convention); tampered `chrome.storage.local` rows (imported-key branch fail-closes on address mismatch; derived rows keep coordinator coverage); clipboard exfil of revealed secrets (reuse F-14 scrub composables); malicious/drifted RPC endpoint (existing composite drift check retained; its XOR-collision limitation documented — protocol-level tx binding via `chainInfoFrom` keeps exact-pair replay protection; out of scope to redesign here); a compromised popup calling service RPCs (boundary validation lives service-side, not UI-side).
- **Entropy preservation (owner's named ask)**: 256-bit CSPRNG entropy → PBKDF2 (preserving) → reduce bias ≤ 2^-258. No user-chosen entropy anywhere; no silent keyspace narrowing. Auditors: attack this chain specifically.
- **Cryptography**: WebCrypto (`self.crypto.subtle`) PBKDF2-HMAC-SHA512 — platform-native, no new library; `@aztec/foundation` 5.0.1 (exact-pinned) poseidon2/sha512ToGrumpkinScalar/Fr; AES-GCM via existing `EncryptionKey`. **No new dependencies** → supply-chain surface unchanged (7-day min-age + frozen lockfile regime untouched).
- **Domain separation**: all new hash uses carry dedicated Nulo constants with documented derivation; non-collision vs upstream separators mechanically tested; new AES-GCM envelope gets its own guard constant (never reuse `ENCRYPTION_GUARD`).
- **Input validation at trust boundaries**: mnemonic import (word count/wordlist/checksum, pre-persistence); account import (schema, size cap, regime match, address recompute, checksum, optional-secretKey consistency); backup import (existing checksum→epoch→version gate; epoch bump rejects pre-v2 blobs).
- **Secret handling**: zeroize-in-`finally` conventions for all new intermediates (seed64, entropy buffers, decrypted signing keys); secrets never logged; plaintext export variant gated behind password confirm + explicit warnings; encrypted variant is the default-selected path.
- **Least privilege / CI**: no workflow or token changes; no new endpoints.

## Assumptions

**Facts** (verified — recon.md carries file:line for each): the full current derivation chain (§1); `exportPlain`'s Full-Backup dependency and `importPlain`'s deletability (§3.1-2); `l1ChainId` not persisted, XOR non-invertible (§3.3); coordinator's non-Nulo_v1 skip and `getAccountContract`'s type throw; `NuloAccount`'s key-agnostic ctor; PBKDF2 already in the SW via WebCrypto; existing KATs pin only seed→address (§4); no hardcoded mnemonics/addresses in tests (parent sweep); canary's formula recompute + `revealSecretKey` capture; store-both rationale (bearer restore, unlock phasing); backup epoch/registry mechanics.

**Inferences** (unverified — auditors, attack these):
- **I1**: `getEntropy` may not reject a bad checksum today (round-trip tests only). P1 verifies and enforces.
- **I2**: local-network enrollment can probe `l1ChainId` (anvil 31337) — the local path may currently skip node probing entirely. P2 verifies; fallback is probe-at-first-account-creation.
- **I3**: upstream `DomainSeparator` enum is importable for the non-collision test.
- **I4**: `mnemonic.test.ts`'s carried trezor seed-column values are usable as-is for the PBKDF2 KAT.
- **I5**: `gh stack` extension is installed (checked at delivery; install if missing).

**Asks** (owner decision at approval — nothing else is silently assumed):
- **A1**: Cut the "Encrypted Key" surface (`exportEncrypted` UI+method, `importEncrypted`/`public_key` import) together with the Secret Key page. **Recommended: yes** (third mechanism, redundant with Full Backup, semantics murkier under store-both).
- **A2**: Regime record handling: in-place redefinition of the `nulo-v5` entry (+ test literals, one reviewed commit) vs appending a new regime id. **Recommended: in-place** (nothing shipped; append implies a rotation that never happened).

Settled by owner in-conversation (recorded, not asks): 24-word-only import; Nulo-format-only account import; encrypted + plaintext export variants; network e2e final gate + smoke on UI phases; no `/harden` scheduled; no passphrase UI this plan; Export/Import Account in scope.

## Decision ledger

| # | Decision | Source | Status |
|---|---|---|---|
| L1 | PBKDF2 adopted (Outline A over B) | draft; owner direction "real BIP-39" | pending audit |
| L2 | Store-both (entropy + master) | recon §3.7 | pending audit |
| L3 | l1ChainId persisted on Network row; composite stays the scoping key | recon §3.3-3.4 | pending audit |
| L4 | Dedicated signing-root separator (drop IVSK_M) + regenerated reference vectors | draft trade-off I.4 | pending audit |
| L5 | kdfDigest added to regime; in-place baseline redefinition | recon §4; Ask A2 | pending owner |
| L6 | Imported accounts: own root, HKDF(master) envelope, backup slice registered, fail-closed signing branch, default-pool exclusion | recon §3.8-3.10 | pending audit |
| L7 | Account-export field elements as 0x-hex inside typed envelope; wallet-level secrets never bare hex | prior owner discussion | settled |
| L8 | Owner's class-ID observation: cross-rollup address collision is implausible across protocol generations (different circuits ⇒ different class IDs), but WITHIN one extension major the frozen artifact is shared across compatible chains (sandbox+testnet) — which is exactly what l1ChainId-in-KDF separates. rollupVersion excluded (upgrade footgun). | owner + recon §6 | settled |
| L9 | BIP-32/SLIP-0010 rejected | prior codex-backed analysis | settled |

(Audit outcomes appended here: adopted/rejected per finding, plus final verdicts.)

## Delivery — arcs → stacked PRs

Multi-arc, `gh stack`, base `dev`:

| Arc | Branch | Phases | Stacks on |
|---|---|---|---|
| 1 `kdf-v2-core` | worktree-key-model-v2 (adopted layer 1) | P1 + P2 | dev |
| 2 `profile-entropy-cuts` | `key-model-v2-profile` | P3 + P4 | arc 1 |
| 3 `account-export-import` | `key-model-v2-accounts` | P5 + P6 | arc 2 |

`gh stack init --adopt` at start; `gh stack add` at each arc boundary; `gh stack submit --draft --auto` early so CI runs per arc; PR titles as Conventional Commits ≤93 chars; ready after the post-impl loop converges. `gh stack merge` is the owner's call, never autonomous.

## Post-implementation (self-contained — the implementing session executes THIS, in order)

1. Run `/code-review max --fix` on the full implementation diff. Skim the applied fixes for unintended changes, then commit them **separately** from implementation commits (identifiable as code-review-applied).
2. Codex post-impl audit (`/codex` at xhigh): send (a) the net diff from the plan baseline (before code-review cleanups), (b) a separate summary of the code-review-applied commits, (c) this plan.md + decision ledger, (d) the adversarial/security ask — including the entropy-preservation attack ask — and (e) this rule verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. Iterative fix loop: verify codex's factual claims against the repo before acting; apply accepted fixes; commit; log consult + verdict in `implementations-plan/key-model-v2/lessons/`; RESUME the same codex session with the fix diff for re-review. Repeat until a round yields no new material findings (rejected nitpicks ≠ churn). Still material after 3 rounds → stop and surface to the owner (scope smell).
4. Delivery per the Delivery section: `gh stack submit`/`sync`, `gh pr edit` proper bodies (Conventional-Commit titles, ≤93 chars), mark arc PRs ready. Merging is the owner's call. Update `implementations-plan/index.md`.

## Seeds (DRAFT — finalized after approval; run inside this worktree)

ELI5 Artifact: (URL recorded here at publish; source `eli5.html` in this dir.)

### Recommended: /goal
```
/goal All six phases marked ✓ in implementations-plan/key-model-v2/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as defined in plan.md reported passing in the transcript; for each phase the agent printed LESSONS_FILE=implementations-plan/key-model-v2/lessons/phase-N.md in the transcript; /code-review max --fix complete with fixes committed separately; the codex post-impl fix loop converged (a resumed codex pass reporting no new material findings, quoted in the transcript); the three-arc gh stack exists on GitHub with arc PRs ready (gh stack view output in the transcript); bun run audit:vue, bun run test:e2e, and bun run e2e:agent all report exit 0 in the transcript.
```

### Alternative: /loop 15m
```
/loop 15m Drive implementations-plan/key-model-v2 forward. Never idle waiting for my input. Each firing: (1) Read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if PRs exist, gh stack view + gh pr view --json statusCheckRollup (no --watch). (2) Waiting on CI is fine if it's progressing (gh run watch up to 10 min; stuck → log as blocked in lessons). Use waits to review the diff or prep the next phase. (3) No task in hand? Pick the next pending step from plan.md. After each meaningful edit run bun run lint + the touched package's tests; commit; gh stack push / gh stack sync as needed. (4) Stuck or facing a decision you'd normally bring to me? Call /codex at xhigh, reach a defensible decision, act, log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, publish, deploy, or expand scope beyond plan.md — surface and hold. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase green = its validation gate as written in plan.md passes; paste the result, mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/key-model-v2/lessons/phase-N.md, advance; at arc boundaries gh stack add per the Delivery table. (7) All phases ✓? Execute plan.md's Post-implementation section verbatim, then write the wrap-up report (what shipped, each contentious decision with ELI5 context, open items) and stop. Keep the ASCII checklist visible each firing (plan.md is the source of truth).
```
