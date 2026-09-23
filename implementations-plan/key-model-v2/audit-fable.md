# Fable audit — key-model-v2 (Round 1, independent top-tier Claude planning agent)

> Verdict: conditional approve (C1–C7) — all conditions adopted into plan.md rev 2 (decision ledger L2–L6, L10–L15). Paths repo-relative.

## Verdict

**conditional approve** (with conditions: (C1) add `account-integrity/coordinator.ts` to the change map and resolve its formula duplication + pre-session-open l1ChainId lookup constraint — or adopt the simpler l1ChainId-on-Account-row alternative; (C2) add `changeProfilePassword` entropy reseal to §C/§H; (C3) enforce the entropy↔master paired invariant at the backup **restore** boundary, not just as a unit test; (C4) add `profile-reimport-matrix.test.ts` + `import-drivers.ts:deriveNuloAccountAddress` + the epoch-3 fixture literals to the test change map; (C5) rewrite the entropy-preservation paragraph honestly (253.5-bit ceiling, reduce step does narrow); (C6) reframe I2 as hardcoded seed l1ChainIds, never probe-at-seed, fail-closed on missing l1ChainId; (C7) decide imported-keys slice optionality + import chainId-binding semantics + imported-row tamper UX before P5.)

## HIGH findings

**H1. The integrity coordinator duplicates the seed formula and is absent from the entire plan.** `apps/extension/src/wallet/services/account-integrity/coordinator.ts:52-56` — the default `DeriveAddress` hand-codes `poseidon2Hash([master, account.chainId, account.type, account.index])` ("Mirrors AccountService.deriveAccountSecret exactly"), and production constructs the coordinator **without** an injected override (`apps/extension/src/wallet/runtime.ts:254`). If P2 ships as written, every account created under v2 fails coordinator re-derivation at the next unlock/boot → integrity block persisted, session withheld — profile bricked. Coordinator unit tests inject fake `derive` fns, so P2's unit gate will not catch the stale default. Second-order constraint: `verifyBeforeSessionOpen` runs **before** the session opens, and NetworkService reads are `requireActiveProfile`-gated — a NetworkService-backed lookup cannot be naively reused there. Simpler alternative: persist `l1ChainId` on the **Account row** at creation (tampering fails closed like a tampered `index`); deletes the injected-lookup abstraction from both call sites and dissolves the ordering problem.

**H2. `changeProfilePassword` reseals only `{guard, secret}`** (`profile/service.ts:698-701`). Under store-both the sealed `entropy` must be resealed in the same operation, atomic with the existing pre-persist integrity verify (service.ts:718). If missed: exportMnemonic breaks after rotation, and the recovery-phrase entropy remains decryptable with the **retired** password.

**H3. Store-both creates a tamper split the restore path never checks.** The full-backup checksum is "integrity, not auth"; `master-key` + `entropy` are independently tamperable; a doctored backup yields a profile whose displayed recovery words derive a **different** master than the one in use. At restore, verify `deriveMasterFromMnemonic(words(entropy)) == master-key`; reject on mismatch. This attack does not exist under Outline B — acknowledge in the trade-offs.

**H4. Second canary-class cross-phase break, plus a formula-coupled helper recon declared nonexistent.** `tests/e2e/network/profile-reimport-matrix.test.ts:46,89,111` (P6 gate) drives `importPlainKey` through the UI P4 deletes and asserts via `deriveNuloAccountAddress`. `apps/extension/tests/e2e/helpers/import-drivers.ts:223-232` hand-codes the v1 formula and feeds `import-paths.test.ts`, `import-dead-rpc.test.ts`, `backup-migration.test.ts` (P4 smoke gate). Recon's "only formula-coupled test is the canary" is **false**.

## MEDIUM findings

**M1.** The entropy-preservation claim is wrong twice: the master is an `Fr` capped at log2(r) ≈ 253.5 bits in **both** outlines; the mod-r reduce maps 2^256 phrase-space onto ~2^253.5 masters (~5.66 preimages per master). Harmless cryptographically, but "no narrowing" / "256-bit master" must go. Verified correct: the 512-bit-reduce bias bound and `fromBufferReduce` 64-byte semantics. Side note: passkey-credential.ts:75 reduces a **256-bit** HKDF output — the higher-skew case; negligible-impact backlog note.

**M2.** I2 misframed and its remedy harmful: seeded networks (incl. local) build with **no probe** (`getOrInitNetworks` → `_buildNetwork`, DEFAULT_SEEDS) — offline safety is load-bearing. Hardcode `l1ChainId` in `DEFAULT_SEEDS` (1 / 11155111 / 31337); custom networks capture from the existing `_getChainId` probe. Specify fail-closed on a row missing `l1ChainId` — no silent 0 default.

**M3.** Epoch-3 literals in fixtures marked "unaffected" by recon: `import-drivers.ts` (`buildSyntheticBackup` `"compat-epoch": 3`) and `passkey-backup.test.ts:135`. P3's bump breaks them; P3's gate runs no e2e. Map explicitly.

**M4.** I4 false: `mnemonic.test.ts` carries exactly one seed value, truncated (127 hex chars), and trezor seed vectors use passphrase `"TREZOR"`, not `""`. Source fresh official vectors + a separate `""` KAT.

**M5.** Imported-keys backup slice must be `optional: true` (a mandatory slice rejects every backup without imported accounts). Hostile epoch-4 backups can carry type-1 rows with no key slice → zombie accounts; decide reject/drop/quarantine.

**M6.** Account-import semantics underspecified: which composite `chainId` the imported row gets; what if the file's `l1ChainId` matches no local network; regime-id is the wrong discriminator (validity depends on `artifactSha256/classId/descriptorDigest`, and the plan itself redefines the label in place) — carry the digests in the envelope.

**M7.** Fail-closed via `raiseRuntimeMismatch` bricks the whole profile for an imported-row tamper. Quarantine-the-account is arguably right for external key material. Missing owner Ask.

**M8.** No gate proves an imported account can sign — P5 smoke is node-free; P6 adds no imported-account network leg. Add one or downgrade the criterion.

**M9.** Standard BIP-39 salt = shared upstream secret on phrase reuse: a phrase reused from MetaMask/BTC yields the seed64 other wallets compute/store — Nulo's master derivable with zero Nulo secrets. Standard model, but record it and discourage reuse in UI copy.

## LOW findings

- **L1.** Separator non-collision test must cover **both** upstream spaces — `DomainSeparator` (sha512 context) and `GeneratorIndex` (poseidon context) — plus mutual distinctness of the two Nulo constants.
- **L2.** Plaintext export's `secretKey` field is extra secret surface with no import need. Drop or make an Ask.
- **L3.** Import must reject non-canonical `signingKey` (≥ Grumpkin modulus), never reduce; pin the checksum canonicalization.
- **L4.** One HKDF key covering all imported-key rows lets ciphertext transplants survive until the address assert; bind row identity via AAD or per-row HKDF info (mirror pxe-store-key's salt-with-id shape).
- **L5.** `array_max([])` returns 0 and the `length > 0` guard is cross-type — first Imported account gets index 1 when derived accounts exist. Recon's "free per-type sequence" imprecise.
- **L6.** I1 already resolved: `getEntropy` throws "Invalid checksum" (mnemonic.ts:2150-2157). Pin a mnemonic canonicalization contract (trim/lowercase/single-space) shared between validation and the KDF.
- **L7.** address-freeze.ts:9-18 "editing a historical entry is forbidden" — the A2 in-place redefinition must update the module's own rules text in the same commit. Recon's "private ctor" wrong (ctor public). "~81%" is ~82.3% — cosmetic.

## Assumption attack summary

**Facts:** mostly verified; two material misses inherited from recon (H1 coordinator duplicate; H4 formula-coupled surfaces). **Inferences:** I1 resolved-benign; I2 misframed (M2); I3 true for DomainSeparator; I4 false (M4); I5 operational. **Asks:** A1 sound; A2 sound but incomplete (L7); missing siblings: M5/M6/M7/L2.

## The A/B fork

**Pick A**, honestly costed. B's advantages are larger than the draft admitted: one sealed secret kills H2/H3 *structurally*; words re-display for every password profile; P3 shrinks; I4 vanishes. B's disadvantages are permanent: field-bounded generation forever, ~82% foreign-phrase rejection with an unexplainable error, "looks like BIP-39, isn't" as a forever liability, passphrase impossible without a second address-breaking event. Security identical (~253.5-bit ceiling either way). A wins **conditional on** C2/C3 (dual-secret consistency closed) and C5 (honest entropy story).

## Phase/gate soundness

P1 sound once M4 fixed. P2 not landable as scoped (H1 + H4 helper are invisible to its gates). P3 blind to the epoch-fixture breakage (M3) unless mapped. P4 inherits M3 + H4 smoke-helper updates. P5 cannot prove "can sign" (M8); M5 decision must precede it. P6 inherits the reimport-matrix surprise (H4).

## What looks fine (verified)

`Fr.fromBufferReduce` 64-byte semantics + bias bound; poseidon2 separator-prepend + arity change cleanly separating v2 from v1; compat-epoch hard-reject mechanics; exportPlain-not-deletable / importPlain-deletable; XOR non-invertibility + composite as scoping key; PBKDF2-SHA512 as a WebCrypto param change, zero new deps; store-both rationale (bearer-restore path verified incl. the documented ≥r throw); `NuloAccount.fromSigningKey` feasibility; the type guard staying fail-closed with the enum widened; the delivery/post-impl protocol being executable as written.
