conditional approve (with conditions: DEK-bind the envelope MAC; define DEK lifecycle/failure semantics; register the duplicate RPC error; correct the inventories, governance claim, and canary assumptions)

### Findings

- HIGH / “MacEnvelope v2 prevents DEK transplants” / The MAC remains master-keyed, but the stated attacker already knows the shared master. They can replace A’s sealed DEK or other ciphertexts, recompute the MAC, and let A’s silent bearer restore with its old `master||dek`, masking an unrecoverable at-rest row until the next password unlock. This recreates the silent recovery-degradation problem the MAC was designed to prevent. / Derive `nulo:envelope-mac:v2` from the DEK or `master||dek`, verify it during credential unlock and bearer restore, and test an attacker holding master+B-password but not A’s DEK.

- HIGH / “DEK threading is complete and preserves single-account quarantine” / Passkey restore must retain both master and plaintext DEK between `restore()` and `finalizeRestore()`; today `pendingRestoreSecrets` retains only master. The plan also never decides whether a corrupt shared DEK blocks profile unlock or creates a partial session, yet claims the existing single-account taxonomy remains unchanged. One corrupt DEK necessarily affects every imported account. / Cache and TTL-zeroize both secrets; fail profile unlock on invalid/missing DEK, while retaining single-account errors only for individual imported-key rows. Explicitly test close, expiry, replacement, abandoned restore, and SW restart.

- HIGH / “DuplicateWalletError crosses RPC like InvalidPasswordError” / A class added to `profile/spec.ts` will be flattened into a plain `Error`. Only `WalletError` subclasses registered in `packages/extension-messaging/src/errors.ts` survive RPC with `instanceof`; otherwise the confirm-and-retry UX fails. / Add the error, code, reconstruction switch, and transport tests to `extension-messaging`.

- MEDIUM / “The inventories are complete” / There are six profile-row construction sites, not five, and nine `openSessionVerified` calls, not approximately eight. Missing either passkey restore branch or password-change reopen strands the DEK. A mutable `getDek()` reference would also be destroyed by callers following the current zeroize pattern. / Make DEK arguments required, brand imported-key APIs to accept only `ImportedKeysDek`, return accessor copies, and zeroize ActiveSession DEKs on close/replace.

- MEDIUM / “Bearer and backup carriage add zero exposure” / A passive `storage.session` reader can recover the co-stored token and wrapped `master||dek`; extension code execution is not required. This intentionally expands bearer compromise from master-only to imported-key authority. Password backups can also be downloaded plaintext, contrary to the encryption-centric rationale. / State both consequences honestly. Prefer one authenticated, discriminated `exportFullBackupMaterial` result for credentialId/master, entropy, and DEK to prevent cross-call races; consider requiring encryption for password-profile backups.

- MEDIUM / “Fingerprint adds zero linkability” / Profiles with zero accounts, disjoint networks, or deleted account rows do not already expose matching addresses. The fingerprint adds a stable equality oracle. It is nevertheless preimage-resistant and does not reduce master entropy. / Describe it as accepted marginal same-device linkability, not zero linkability; consider limiting it to password profiles because same-credential passkeys remain structurally hard-blocked.

- MEDIUM / “This is not a second carve-out” / The first freeze rewrite is already committed as `68abc4a2`; a second commit contradicts the literal “one commit / exercised once” rule even if unmerged. The new digest also invalidates every existing account-export file, including mnemonic exports whose formula did not change. / Obtain explicit owner ratification and rewrite the rule honestly. Make the spec clause byte-precise: decoded PRF and credential-ID bytes, UTF-8 labels, concatenation order, HKDF hash, output length, and reduction.

- MEDIUM / “Prefer PRF capture for the canary” / It adds fragile credential interception and leaves PRF material in test-runner strings/traces. The fixture explicitly says credentials are not portable across browser relaunches. / Prefer execution-only plus the independent V3 KAT. If testing SW restart, retain the same popup FrameTreeNode and re-run the ceremony; do not claim browser-relaunch persistence. Arc 4 is the correct placement.

### Assumption attack

Facts: ActiveSession/master-only, profile block-listing, real virtual-authenticator PRF, and V3 being the sole current passkey-output literal are verified. Misstated: six row constructors, nine session openings, typed-error transport, and universal address-based linkability.

Inferences: (1) PRF hooking is unproven and undesirable. (2) SessionSecretBox has one production consumer but is exported and has numerous direct tests. (3) Same-credential wrap-key recovery is sound and credential-ID-bound. (4) Browser-relaunch determinism is false; only same-authenticator/FrameTreeNode continuity is demonstrated.

Asks: Warn+confirm, two arcs, and pre-production redefinition are clear. Clarify that passkey same-credential restore remains a hard block and therefore cannot exercise the promised duplicate-confirm flow.

### Sound

The 512-bit reduction math holds: min-entropy approaches `log2(Fr)` (~253.6 bits) and bias becomes negligible. Credential-rooted random DEKs structurally close the master-only sibling attack; the new labels are distinct. The competing hard-block outline was rightly rejected. Error-driven retry is better than a check-only RPC, and a single combined bearer wrap is simpler than two co-stored wraps once MAC binding and zeroization are fixed.
---
_Round 1 transcript (codex gpt-5.6-sol, xhigh, fresh session). Verdict: conditional approve. All conditions adopted into plan rev 2 — see the decision ledger. The final fresh-context pass is recorded below when run._
reject (with blocking findings: restoring the source DEK lets an allowed backup clone defeat per-profile isolation)

### Ranked findings

- HIGH / “Restore reseals the same DEK; fix A carries the entire isolation guarantee” / Restore A into B under a different password, then both profiles possess DEK D. If A later imports a new key, a storage reader knowing only B’s password can unseal D from B and decrypt A’s new row. They can also forge A’s MAC v2. This recreates the target attack without password reuse. [The plan explicitly preserves D](implementations-plan/key-model-v2-hardening/plan.md:116). / Mint a destination DEK on restore and service-side decrypt/reseal every imported-key backup row from source DEK→destination DEK before activation. Test that B cannot decrypt an A-only key imported after cloning. Otherwise duplicate backup coexistence must hard-block, contrary to the owner’s choice.

- HIGH / “MAC verifies at unlock while DEK-unseal fails soft” / No DEK means no MAC key. The plan does not define whether verification is skipped or fails; a corrupt MAC alone could also profile-block derived funds, contradicting A4. / Specify: core decrypt/pairing failure blocks; DEK-unseal or MAC failure opens derived-only, discards the DEK, emits a user-visible warning, and clears/persists no bearer. Bearer restore requires both DEK and valid MAC or silently closes.

- MEDIUM / “Throwing-zone duplicate check is safe; passkey duplicate credentials are structurally blocked” / The password restore check is deliberately outside `runExclusive`, creating a real check→write race. Passkey `userHandle` is optional, and current restore generates a new ID when absent, so credential-ID duplication is not structurally blocked. / Check fingerprint and commit under one lock, explicitly rethrow the typed error, and scan passkey rows by `credentialId`. Reuse the already-returned `credentialData` across confirm/retry; the extra service-side retry stash is unnecessary.

- MEDIUM / “P4 criteria mechanically encode the design” / Add explicit tests for source-DEK→fresh-DEK restore rewrap, healthy/degraded MAC behavior at both verify sites, DEK zeroization on close/replace/expiry, and absent-userHandle credential duplication. Also, `deriveDekWrapKey()` requires adding `"deriveKey"` to the current HKDF key usages. Facts need narrowing: V8 is another passkey-sensitive pin, and password `restore()` only flattens errors inside its persistence zone. Owner ratification of the freeze amendment remains a legitimate blocking governance gate.

Fail-soft resolution: Agree, once the state machine above is explicit. Preserving derived-fund access is preferable; no-bearer contains persistence, but an invisible log is insufficient to make degradation “loud.”

Canary resolution: Agree with execution-only, narrowly. Raw-WebCrypto V3 is genuinely independent of wallet HKDF wiring after the PRF boundary, but it cannot detect a consistently miswired WebAuthn ceremony. Existing ceremony unit pins plus the execution canary are adequate; revise the “exactly closes” claim.

Sound: 512-bit reduction math; credential-rooted random DEKs for independent creations; fixed 32+32 atomic bearer; MAC v2 keying/preimage; six row sites, nine opens, RPC reconstruction, and origin/dev freeze facts.
---
_Final fresh-context pass, round 1 on rev 2 (NEW codex session, full decision trail). Verdict: reject — the clone-divergence blocker + conditions, ALL adopted into rev 3 (fresh destination DEK + row rewrap at restore; explicit degradation state machine; dup check + commit under one lock + credentialId scan; "deriveKey" HKDF usage; fact narrowings; V3-claim scoping). Both rev-2 disagreement resolutions endorsed. The inline file link above was rewritten to repo-relative; it refers to rev 2's DEK-minting bullet. Re-verdict on rev 3 appended below._
conditional approve (with conditions: define the transient source-DEK rewrap handoff/lifetime; remove contradictory rev-2 instructions; owner ratifies the KDF-spec amendment)

- HIGH / Source→destination rewrap lacks an implementable ownership path / `ProfileService.restore()` runs before `AccountService.restoreImportedKeys()`, when imported-key rows are unavailable. Yet rev 3 says the source DEK is zeroized during restore and `pendingRestoreSecrets` retains only the destination DEK. The later slice cannot be decrypted. / Define a TTL-bound, memory-only rewrap context for both profile types, consumed atomically by `restoreImportedKeys`; cover empty slice, partial failure, rollback, expiry, finalize, and SW death cleanup. Alternatively pass the slice into the profile restore boundary.

- MEDIUM / Authoritative sections still contradict rev 3 / The header still says “Rev 2”; the file map still specifies “throwing-zone dup check/passkey rethrow + retry stash”; and P4 still says “restore reseal pre-commit (SAME bytes)” plus “passkey rethrow/stash.” An implementer following P4 could recreate both rejected designs. / Replace these with locked check+commit, UI-held credential retry, and source→destination rewrap.

- GATE / KDF freeze amendment / Explicit owner ratification remains open as the plan correctly requires.
---
_Re-verdict (resumed final-pass session, on rev 3): conditional approve. Conditions 1 (rewrap-context lifetime) and 2 (rev-2 leftover sweep) adopted into rev 4; condition 3 (owner ratifies the KDF-spec amendment) is the approval-gate ask itself. Loop closed._
FAIL (blocking: uncleared 64-byte HKDF reduction copy)

- HIGH / [passkey-credential.ts:79](packages/wallet-crypto/src/passkey-credential.ts:79) / `Buffer.from(new Uint8Array(masterBits))` creates a separate 64-byte, master-equivalent OKM copy, but the `finally` at line 87 wipes only `masterBits`. The anonymous copy survives until GC; the new zeroize test wipes its own named input and cannot catch this production leak. / Store the reduction buffer in a variable and zero both buffers in `finally`, matching `mnemonic-master.ts`’s `seed64Copy` pattern.

- LOW / [passkey-credential.ts:71](packages/wallet-crypto/src/passkey-credential.ts:71) / The old 256-bit reduction’s “~2^-1.6 relative bias” claim is inaccurate. Residues have five or six preimages: a 20% high/low skew (`2^-2.322`), with 253.415-bit min-entropy. / Use those exact figures.

Everything else survived attack: full 64-byte big-endian reduction is wired; manual RFC 5869 Extract/Expand matched Node `hkdfSync`, WebCrypto, the JSON, and V3 exactly ([RFC 5869](https://www.rfc-editor.org/rfc/rfc5869.html), [WebCrypto HKDF](https://www.w3.org/TR/WebCryptoAPI/#hkdf)); the independently hashed spec digest is exactly `29eca1…166d`; no live stale V3 pin or missed dependent fixture was found. V8 and V11 are unaffected. Wallet-master production reductions are both 64 bytes; other grep hits are unrelated faucet deployer parsing.

Relevant typechecks passed. Vitest could not start because the read-only sandbox rejected its cache/temp writes.
---
_P1 rider round 1 (FAIL: un-wiped 64-byte OKM copy) — fixed 987cd239; re-verdict: PASS. Absolute sandbox paths in the finding links refer to passkey-credential.ts lines 71/79 pre-fix._
FAIL (blocking: v2 primitives do not enforce their fixed-size secret contracts)

- MEDIUM / `session-secret-box.ts:99` / `wrapPair` accepts malformed component lengths. A 1-byte DEK is silently zero-padded and later returned as a valid branded 32-byte DEK. The test checks only decrypted total length, so misses this. Fix: reject unless `master.length === 32 && dek.length === 32`; test 31/33-byte inputs.

- MEDIUM / `entropy-mac.ts:78` / The claimed unambiguous `master || dek` boundary is not enforced. Brands erase at runtime and the exported mint helpers accept arbitrary lengths, allowing distinct `(master, dek)` splits of identical bytes to derive the same MAC key. Healthy current origins are 32 bytes, so this does not enable a master-holder forgery today, but the primitive’s security contract is incomplete. Fix: reject non-32-byte inputs before concatenation and add boundary tests.

- LOW / `session-secret-box.ts:100` / The secret pair is populated before entering `try/finally`; an overlong `set()` or RNG failure leaves the copied secret unzeroized. Fix: validate first and place all copying/allocation after entry into the protected block.

The hierarchy, HKDF labels, AAD, v1↔v2 key domains, constant-time verification, and independent Node/WebCrypto derivations otherwise checked out. Direct probes reproduced both independent KATs and master-with-wrong-DEK rejection.
PASS

No new material findings.

---
_P3 rider round 1 (FAIL: fixed-size contracts unenforced in wrapPair + macKeyV2, pair copy outside the protected block) — all fixed 8432bd07 (32-byte guards + boundary tests + copy inside try); re-verdict: PASS._
