# Findings — Adversarial Review of key-model-v2 (#417..#429)

**Mode**: black-hat, report-only. No fixes applied. No external-model consults.
**Scope**: `feat/kdf-v2-core` → `kdf-v2-profile-cuts` → `kdf-v2-account-io` →
`kdf-v2-passkey-512` → `kdf-v2-dek-isolation` → `kdf-v2-assurance`, plus merged arcs
#421–#425 at the crypto seams. Reviewed at worktree HEAD `8a816ac3` (contains the full stack).

**Evidence**: executable harnesses in [`harness/`](./harness/) (all green unless stated),
plus the repo's own suites re-run as ground truth: wallet-crypto 110/110,
extension-messaging 188/188, profile-service integration 113/113.

---

## Verdict table

| ID | Hypothesis | Verdict |
|---|---|---|
| H1 | Generated 24-word phrases guessable / weakly sourced / reusable | **REFUTED** (exploited nothing; harness green) |
| H2 | Unsalted passhash fast-path downgrades offline crack cost | **REFUTED** (already fixed by F-11; measured) |
| H3 | Passkey ceremony semantics abusable | **REFUTED** (2 informational notes) |
| H4 | Messaging seam accepts forged/replayed payloads into derivation | **REFUTED** (1 note) |
| H5 | Parsers adopt hostile input silently | **REFUTED** (2001-input storm: zero semantic accepts) |
| H6 | Storage tamper escapes the degradation state machine | **PARTIAL** — T5 residual reproduced (MEDIUM); new T7 LOW |
| H7 | Race interleavings break seal/session invariants | **CLEAN** (probe + full suite green) |
| H8 | v2 reduces security vs v1 somewhere concrete | **NO DOWNGRADE FOUND** (see §H8) |
| H9 | Secrets survive in memory/logs beyond policy | **PARTIAL** — logs clean; heap forensics deferred (rationale) |
| H10 | Chain-id fail-open path exists | **REFUTED** (fail-closed at all 3 layers) |
| H11 | An accepted risk is exploitable beyond its argument | **ACCEPTANCES HOLD** (re-attacked) |
| H12 | Full-chain derivation diverges from independent recomputation | **ALL STEPS AGREE** |

---

## New findings

### F-1 (MEDIUM, reproduced) — Full-envelope swap = identity adoption in a zero-account profile
Codex's documented residual, now **executable evidence**
(`harness/h6-h7-tamper-matrix.audit.test.ts`, row T5):

> `[H6/T5 residual] full-envelope swap outcome: UNLOCKED as profile <A-id> named "A" — attacker-controlled identity adoption`

Overwriting every sealed field of password profile A with same-password profile B's row
(keeping A's id/name) unlocks cleanly: B's guard opens under the shared password, B's
secret+entropy pass the pairing check, B's authentic MAC verifies because the MAC preimage
(`guard.secret.entropy.dek`) and key (`HKDF(master‖dek)`) carry **no profile identity**, and
with zero derived accounts the integrity containment is vacuous.

**Bounded by**: attacker needs storage WRITE *and* an existing credential for a sibling of
the target — at which point they can unlock the sibling outright. What is lost is
*attribution and containment*, not secrecy: "profile A" silently becomes wallet B.
**Fix direction already on the table** (owner decision pending since #419): bind profileId
into the AAD/MAC/HKDF info via a backed-up random `profileCryptoId`; requires an on-disk
format bump — free pre-production. This reproduction is the argument for doing it now.

### F-2 (LOW, new) — Unauthenticated `walletFingerprint` lets a storage writer blind the duplicate guard
Reproduced (row T7): corrupting the plaintext fingerprint field makes a duplicate-phrase
re-import complete with **no warning** (`threw=false`). The guard compares candidate-master
fingerprints against stored values pre-unlock, so the field must be readable without
credentials — but it does not need to be *unauthenticated*: adding `walletFingerprint` to the
envelope-MAC preimage (a v3 grammar) would make blinding detectable at the next unlock while
preserving the pre-unlock read. Impact today: silent loss of a safety UX net, not key
material. Same threat family and fix vehicle as F-1.

### F-3 (INFORMATIONAL)
- Zero-scalar signing keys import fine (`Fq.fromString("0x00…0")` succeeds). Harmless:
  address derives deterministically, user must confirm it, such an account cannot sign.
  A scalar≠0 check would be one line if wanted.
- PATH-B passkey request ids are 8 hex chars (32 bits) carried in the window URL. Reachable
  only from extension context (F-09 gate), single-pending map, 5-min TTL — brute force is
  impractical, but `getRandomHex(32)` (128 bits) costs nothing.
- `strictSecurityMode=false` (opt-out) persists a `master‖dek` bearer in
  `chrome.storage.session` until TTL — inherent to silent restore, honestly documented in
  `session-secret-box.ts`. Default is `true` (no bearer).

---

## Answers to the owner's three questions

**1. Does this work reduce security?** No downgrade found anywhere I could measure (H8).
The stack replaces v1's model — where the words were *"a raw re-encoding of the master"* —
with real BIP-39 PBKDF2, true-L1 chain identity under owned domain separators, a one-way
signing-root hierarchy, canonical-scalar import checks, and credential-rooted DEK isolation
for imported keys. Every delta I probed is an improvement or quantified-neutral
(reduce bias ≤ 1e-9 bits on the 64-byte input; passkey path widened to match in #426).
Two honest non-security notes: recovery without Nulo software now requires reimplementing
the documented KDF chain (it was custom before too — just simpler), and 12-word imports are
rejected (product cut; arguably a security positive).

**2. Can an attacker guess users' generated 24 words?** No (H1). Generation is a single
call site — `crypto.getRandomValues(new Uint8Array(32))` — through a structurally canonical
2048-word list (unique, sorted, pinned by all 24 official BIP-39 vectors). Import validates
on the canonical form the KDF itself uses, so no validate/derive split-brain exists
(NBSP/multi-space/case/padding variants derive identically; hostile inputs fail closed).
Guessing means inverting a 256-bit CSPRNG. The only cheap confirmation oracle is the
documented partial-phrase case (23/24 words → 8 checksum-valid completions against the
stored fingerprint) — inherent, honestly documented, re-attacked in H11 and left standing.

**3. Is the passkey/KDF derivation correctly done?** Yes, by differential evidence (H12):
every step — seed64, master, accountSeed, signingKey, secretKey, address — matches an
independently generated reference vector, and the ceremony layer binds credentials to
profiles at every consumption site (unlock F-007, export, restore). PRF handling follows
the WebAuthn L3 spec (public eval salt; per-credential separation comes from the
authenticator); the wallet-side HKDF salt binds the credential id.

---

## Defenses confirmed live (not just argued)

- Authentic sibling `dekSealed` transplant → derived-only unlock + degraded event + no bearer (T4).
- MAC-field-only corruption → DEK preserved; password change REFUSES; export escape hatch intact (T6).
- Wrong-password, slot tamper, cross-profile transplant, ≥modulus scalars, hostile base64:
  all fail closed across every parser and box (H5 matrix).
- Sender auth rejects content-script/web-origin senders at the port boundary (F-09 suite).
- Chain identity: seeded rows must equal in-code constants; customs probe-match at creation;
  derivation re-validates canonicality independently; integrity digest covers l1ChainId.

## Deferred, with rationale

- **H9 CDP heap forensics**: skipped. The unit-level zeroize posture is already test-pinned
  (including Fr copy behavior), V8 string interning makes any scan produce unactionable
  GC-copy noise, and no log/redaction leak was found statically. Revisit only if a specific
  lifetime question arises that buffers-level tests cannot answer.

LESSONS_FILE=implementations-plan/adversarial-key-model-review/findings.md
