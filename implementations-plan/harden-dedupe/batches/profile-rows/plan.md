---
plan: harden-dedupe / profile-rows (arc 13 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/13-profile-rows, stacked on harden-dedupe
---

# profile-rows: one credential-row builder, one degraded-open tail, one restore stash

Finding Q-17 (a, b, c), from `audit/quality/2026-09-30-dedup-high/`. All of it lives in `apps/extension/src/wallet/services/profile/service.ts` (2,797 lines), plus one envelope projection in `session-manager.ts`. Today:

- The persisted profile row is built by six literals, and a seventh site mutates the row at password change.
- The envelope MAC is computed at four sites.
- The "a degraded open must warn" rule is restated four times.
- The two in-memory restore maps each hand-roll the same TTL lifecycle.

This batch states each once. No persisted byte, MAC tag, event, error, await order across a lock, or buffer wipe changes. Q-17 (d), the reveal skeleton, stays out: the audit excluded it, and the adjudication in `implementations-plan/archive/profile-service-dedup/plan.md` still stands.

## Outcome & Quality Bar

- **For whom:** the next person who adds a row field or a MAC input. Today that means six literals, four MAC calls and three envelope projections, and a miss surfaces only at first unlock: either as a derived-only session or as a silent close of every bearer restore. A fifth open path can also forget `onImportedKeysDegraded`, the only signal the popup has that imported keys are quarantined.
- **Excellent:**
  - A password row and its tag come from one builder. The tag and the row read one grouped set of bindings (`id`, slots, `dekSealed`, fingerprint), so no site can MAC one value and store another.
  - Every row-writing path is pinned by a literal known-answer vector of its persisted bytes, MAC included, under a seeded RNG. An independent `node:crypto` recomputation, anchored on the storage key, cross-checks each vector. Both are recorded on the unchanged code.
  - The four degraded tails share one helper. A per-path table pins, for each:
    - exactly one emit, with the exact payload, after the open;
    - a session that holds the real (non-zero) master and DEK;
    - silence on a healthy open.
- **Good enough:** every site keeps its own guards, id allocation, lock placement and `finally` wipes, line for line. Only these move:
  - the MAC call and the row literal;
  - the open-and-warn tail;
  - the map lifecycle;
  - three envelope projections.

## Architecture & Implementation

Read on `harden-dedupe` at `7450928c`. The file is byte-identical to recon's reading apart from one import line, so recon's line numbers hold.

### (a) Row construction: six literals, one mutation, four MAC computations

**Sites today**, each inside the facade lock:

| site | lines | guards before the row (stay at the call site, in order) | MAC inputs: id, master, dek, slots, `dekSealed`, fingerprint | after the row (stays) |
|---|---|---|---|---|
| P1 `createProfile` | MAC `:610`, row `:612-623` | `assertNotDuplicateWallet(secret, false)` `:605`; `nextUnreservedId` `:606` (seal and DEK seal ran before the lock, `:598-601`) | `id`, `secret`, `dek`, `encrypted`, `dekSealed`, `walletFingerprint` | `persistNewProfileHoldingLock` → `openSessionVerified`; outer `finally` wipes secret, entropy, dek, passhash |
| P2 `importPasswordProfile` | MAC `:2163`, row `:2164-2175` | dup-wallet `:2159`; `nextUnreservedId` `:2160`; `sealWithPasshash` `:2161`; DEK seal `:2162` | same names | persist → open; `finally` `:2180-2185` |
| P3 `commitRestoredPasswordProfileHoldingLock` | MAC `:2413-2418`, row `:2420-2433` | dup-wallet `:2393`; seal `:2397`; fresh `destinationDek` `:2403`; DEK seal `:2405`; id loop on `contains ∨ isReserved` `:2407-2410` | `id` after the loop, `plainSecret`, `destinationDek`, `sealed.encrypted`, `dekSealed`, `walletFingerprint` | `writeMarkerThenRowHoldingLock` → `onProfileAdded` → rewrap stash; catch rethrows `DuplicateWalletError`, else `restoreError` |
| P4 `changeProfilePassword` | MAC `:1168-1173` (in-place mutation, not a literal) | `getProfileOrThrowHoldingLock`; passkey refusal; `reseal`; `unsealResealedVerifiedHoldingLock`; `rekeyedDekForPasswordChangeHoldingLock` (old MAC verified, `:1085`) | `id`, `secret`, `dek`, `resealed.encrypted`, `rekeyed.newDekSealed`, `profile.walletFingerprint` | `repo.set` → `onProfileUpdated` → reopen; `finally` `:1178-1184` |
| K1 `createPasskeyProfile` | row `:763-771` | `contains ∨ isReserved` → `ProfileIdConflictError` `:757`; dup-wallet `:761` | none (passkey rows carry no MAC) | persist → open; `finally` `:778-782` |
| K2 `importPasskeyProfile` | row `:2222-2231` | `userHandle` taken → "Passkey profile already exists" `:2204`; `assertNotDuplicateCredential` `:2209`; dup-wallet `:2211`; no `userHandle` → `nextUnreservedId` `:2214-2220` | none | persist → open; `finally` `:2236-2239` |
| K3 `commitRestoredPasskeyProfileHoldingLock` | row `:2590-2598` | id taken → exists `:2574`; dup-credential `:2579`; dup-wallet `:2581`; no id → `nextUnreservedId` `:2584-2588` | none | marker-then-row → `onProfileAdded` → stash whose `expected` snapshot reads the new row `:2617-2623` |

**Return shapes (unchanged):**

- P1, P2, K1 and K2 return the row object they persisted (`:628, :2178, :776, :2234`).
- P4 returns the mutated row (`:1186`).
- P3 and K3 return `getProfileInfo(row)`, `{ id, name, type }` (`:2455, :2631`).

**Envelope projections:**

- `unsealTrustedDekHoldingLock` builds the envelope inline from the row (`:392-402`), against the requested `id`.
- `envelopeMacValid` (`:2043-2057`) builds it through `macEnvelopeV3` (`:2022-2033`).
- The bearer restore builds it inline (`session-manager.ts:617-628`), against `session.profile`.

**What changes:**

- New `apps/extension/src/wallet/services/profile/profile-row.ts`, importing only `@nulo/wallet-crypto` (`computeEnvelopeMacV3` and types) and `./spec`:
  - **`macEnvelopeV3(slots, dekSealed, walletFingerprint)`** moves here from the service. Its doc is rewritten to its real contract: it projects the five envelope fields and takes no id.
  - **`envelopeMacFor({ id, slots, dekSealed, walletFingerprint }, master, dek)`** returns `computeEnvelopeMacV3(id, master, dek, macEnvelopeV3(slots, dekSealed, walletFingerprint))`.
    - That is today's expression at all four sites.
    - The grouped input means P4's three adjacent strings cannot be swapped positionally, and the distinct `MasterSecretBytes`/`ImportedKeysDek` brands keep master and DEK apart.
    - Its doc carries the contract: `id` is the row's own storage key, bound first, and it must be final (after allocation or the restore loop). That absorbs the comments at `:607-609` and `:2411-2412`.
  - **`newPasswordRow(fields, master, dek)`** takes the same object plus `name`. It passes the object through to `envelopeMacFor`, then returns the literal in today's key order: `id, name, type, pxeGeneration, dekSealed, walletFingerprint, guard, secret, entropy, envelopeMac`.
    - `mintPxeGeneration()` stays inside the literal, after the tag.
    - The doc states that it always mints a fresh `pxeGeneration`, which absorbs P3's "fresh generation even on a same-id re-import" comment.
  - **`newPasskeyRow({ id, name, dekSealed, walletFingerprint, credentialId })`** is synchronous and returns `id, name, type, pxeGeneration, dekSealed, walletFingerprint, credentialId`, with the same `pxeGeneration` contract.
- **P1, P2 and P3** replace their MAC line and literal with one `newPasswordRow` call at the literal's position.
  - P3 keeps `asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>)` and `destinationDek`.
  - The cast gets one comment: `plainSecret` is the length-checked backup decode, branded only here.
- **P4** uses `envelopeMacFor({ id, slots: resealed.encrypted, dekSealed: rekeyed.newDekSealed, walletFingerprint: profile.walletFingerprint }, secret, dek)`. The in-place mutation order stays.
- **K1, K2 and K3** replace their literal with `newPasskeyRow`.
- **The unlock verify** (`:392-402`) becomes `this.envelopeMacValid(id, row, secret, dek)`: the same verifier, the same requested `id` and the same row fields. A missing or malformed tag still degrades. Phase 1 pins this.
- **`envelopeMacValid`** calls the module `macEnvelopeV3`, and the private method is deleted.
- **(2d) Bearer restore:** `session-manager.ts:617-628` replaces only its inline envelope with `macEnvelopeV3(profile, profile.dekSealed, profile.walletFingerprint)`.
  - `session.profile` stays the id.
  - The silent-close failure policy is untouched.
  - The change adds one import and no cycle: `profile-row.ts` imports only `@nulo/wallet-crypto` and `./spec`, and `spec.ts` imports neither file.
- **Provenance comments removed** in the lines this arc touches: "final-audit condition" (`:153`) and "the SIXTH row-construction site" (`:742-744`).

**Why this is byte-identical:**

- The tag is a pure function of `(id, master, dek, five strings)`. `preimageV3` reads the envelope by property name (`packages/wallet-crypto/src/entropy-mac.ts:54-62`), and every site passes the same bindings as today.
- `JSON.stringify` writes the row (`packages/wallet-core/src/storage/entity_storage.ts:190`), so key order and key presence are persisted bytes.
  - The builders keep each literal's order.
  - The three password literals share one order, and so do the three passkey literals.
- The RNG draw order is unchanged.
  - The builders draw only `mintPxeGeneration`, at the same point as today: after the tag, which draws nothing.
  - Every other draw (entropy, DEK, IVs, ids) stays at its call site.
  - This is a source-review note; no test can see the order of `pxeGeneration` against a draw-free tag.

### (b) Degraded-open tail

**Sites today.** Each runs `openSessionVerified(row, master, passhash, dek ?? undefined)`, then `if (!dek) emit("onImportedKeysDegraded", getProfileInfo(row))`, then `return getProfileInfo(row)`:

| site | lines | dek trust gate before it (stays) | passhash | wipes after it (stay) |
|---|---|---|---|---|
| T1 `unlockProfile` phase 3 | `:702-706` | `repo.get`, reserved, type, ciphertext compare, `unsealTrustedDekHoldingLock` | yes | `passhash` `finally` `:708-710`; outer `finally` (after the lock) `:711-717` |
| T2 `unlockPasskeyProfile` phase 3 | `:851-855` | credential bind `:828`, `repo.get`, reserved, type, `credentialId` compare, `unsealPasskeyDekHoldingLock` | none | `finally` `zeroize(dek)` `:856-858`; outer `finally` `:860-863` |
| T3 `finalizePasswordRestoreHoldingLock` | `:2726-2730` | password present, unseal, pairing check, passhash, `unsealTrustedDekHoldingLock` | yes | `finally` `:2731-2737` |
| T4 `finalizePasskeyRestoreHoldingLock` | `:2787-2791` | stash present, type, removal, TTL, `expected` snapshot and fingerprint recompute | none | `finally` `:2792-2795` |

**What changes:**

- One private `openAndWarnIfDegradedHoldingLock(row, master, passhash, dek: ImportedKeysDek | null): Promise<ProfileInfo>` holds those three statements verbatim.
- Its doc states:
  - it allocates and wipes nothing;
  - the caller holds the lock;
  - `dek` must come from a trust gate: `unsealTrustedDekHoldingLock`, `unsealPasskeyDekHoldingLock`, or finalize's snapshot compare.
- Each site becomes `return await this.openAndWarnIfDegradedHoldingLock(...)` inside its existing `try`.
  - The `await` is load-bearing. A bare `return` of the promise lets T2's, T3's and T4's `finally` zeroize `dek`, `secret` and `passhash` before `openSessionVerified` copies them. That would open a "healthy" session over a zeroed master and DEK.
  - Phase 1 pins it (the session master and DEK are non-zero and equal the oracle's), and the mutation table carries the bare-return mutant.
- Create, import and password-change opens always hold a fresh DEK, so they keep calling `openSessionVerified` directly.

### (c) Restore stash lifecycle

**Today:**

- Two private `Map`s: `pendingRestoreSecrets` (`:137-150`) and `pendingDekRewraps` (`:162-165`).
- The TTL sweep repeats its loop once per map (`:194-211`). It is called under the lock from:
  - consume `:225`;
  - lock `:919` (`now = +∞`);
  - delete `:1468`;
  - password stash `:2442`;
  - passkey stash `:2610`;
  - finalize `:2659`.
- Drop-and-wipe exists twice (`:1431-1448`), called from delete `:1494, :1497` and finalize `:2682, :2763`.
- "Take, and enforce the TTL on the taken entry" exists twice: consume `:226-237` and finalize `:2757-2765`.
- Stashes at `:2443-2447`, `:2613-2624` and `:2627`.
- Finalize reads the entry and refuses on type before removing it (`:2750-2757`).
- Consume returns the projection `{ sourceDek, destinationDek }` (`:237`), never the entry.

**What changes:**

- New `apps/extension/src/wallet/services/profile/expiring-stash.ts`: `ExpiringStash<E extends { capturedAt: number }> extends Map<string, E>`, constructed with `(ttlMs, wipe: (entry: E) => void)`, a strategy rather than flags. It adds three synchronous methods:
  - `sweep(now, exceptId?)` is today's loop: skip `exceptId`; on `now - capturedAt >= ttlMs`, delete and then wipe.
  - `take(id, now)` deletes the entry, wipes it and returns `undefined` if it has expired, and otherwise returns it.
  - `drop(id)` deletes the entry and wipes it.
- **One contract, in the class doc:**
  - A successful `take` transfers buffer ownership to the caller.
  - `drop`, an expired `take` and `sweep` wipe.
  - Expiry is checked only on these calls.
  - The inherited `delete`, `clear` and `set` do not wipe.
  - Callers serialize access (the facade lock).
- The two hand-added-TTL comments (`:229-231`, `:2758-2759`) collapse to one sentence on `take`.
- The two fields keep their names and become `ExpiringStash` instances whose `wipe` zeroizes exactly today's pair, in today's order.
- `PENDING_RESTORE_TTL_MS`, with its doc, moves above the two fields that now read it in their initializers. TypeScript refuses a static read before its declaration (TS2729). Statics initialize before any instance either way, so the value is unchanged.
- `sweepStalePendingRestore` stays as a two-line method, so its six callers and its lock doc stay.
- `dropPendingRestoreSecret` and `dropPendingDekRewrap` are deleted, and their four callers call `drop`.
- Consume keeps its own sweep call first, then `take(profileId, now)`, and still returns `{ sourceDek, destinationDek }`.
- Finalize keeps `get`, then "No pending restore secret…", then the type refusal (entry kept), then `take(id, Date.now())`. An `undefined` drops the rewrap and throws the same message: the sequence at `:2757-2765`.
- **Why `extends Map`:**
  - The frozen suite reaches into both fields with `get`, `has`, `values()` and `size`, and edits `capturedAt` on the live entry (`service.integration.test.ts:1335-1348, 1368-1371, 1396-1403`). A subclass keeps those reads valid.
  - It exposes nothing the private `Map` does not expose today.
  - The class imports nothing, and every method is synchronous, so no call can interleave.

### What stays

- Every guard, id loop, lock acquisition, `finally`, event and error string in the tables above.
- Every return shape listed above.
- Q-17 (d).
- `rpcMethods` and every public signature, including `consumeDekRewrapContext`.
- `packages/wallet-crypto`: no file changes there, source or test.
- The bearer restore's id choice and its silent-close policy.

### Complexity

`scripts/complexity-baseline/manifest.json` has no acceptance in `service.ts` or `session-manager.ts`. Every touched function shrinks, and the new functions are flat, a few lines each.

### Alternatives not taken

- **The status quo,** literals and four MAC calls left inline. The prior plan kept one row literal because "a 7-param builder loses to a 10-line literal". With a grouped-object input the builder is one call. What it buys is structural: the tag and the row read one set of bindings.
- **A builder that also writes the row.** It would pull persistence ordering (persist vs marker-then-row) into a strategy for no gain.
- **Composition instead of `extends Map` for the stash.** It would force edits to frozen reach-ins, or forwarding boilerplate.

## Security & Adversarial Considerations

- **Who reaches this code:**
  - popup RPCs (create, import, unlock, change password, restore, finalize);
  - a storage writer (attacker model A1) who edits rows at rest;
  - a hostile backup file, through `restore`.

  No dApp reaches the profile service.
- **MAC inputs stay byte-identical:**
  - the same id binding: the storage key, final, after allocation or the restore loop, inside the same lock;
  - the same master;
  - the same DEK: P3 uses the fresh `destinationDek`, never `sourceDek`;
  - the same slots;
  - the same `dekSealed`: P4 uses the new one;
  - the same fingerprint.

  The domain label `nulo:envelope-mac:v3`, the HKDF salt, the `.`-joined field order and the key derivation all live in `wallet-crypto`, which this arc does not touch. On the tests:
  - The vectors pin outputs, and the oracle pins meaning (storage key, field order, label, master‖DEK order). A wrong binding reds both.
  - The restore vector uses a backup id that collides with a live row, so it pins the tag over the re-minted id.
- **No crypto or KDF change, no migration.** CLAUDE.md says crypto rotations are never migratable. Any vector diff is a refactor bug and is never re-recorded.
- **npm surface: none.** `@alejoamiras/nulo-wallet-crypto` publishes only `packages/wallet-crypto/src/public.ts`. `entropy-mac.ts` is wallet-internal, and the arc edits no file in that package.
- **Verify sites:**
  - Every check and refusal stays at its call site.
  - The unlock verify still uses the requested `id`. The bearer restore still uses `session.profile`.
  - A missing, malformed or non-covering tag still degrades at open and still refuses at password change (`:1085-1088`, unchanged).
  - Nothing re-MACs a row that failed verification (lessons: "on a MAC failure refuse, never self-heal").
- **The degraded warning cannot be lost:**
  - The helper emits only after `openSessionVerified` resolves, so a failed open emits nothing.
  - The payload is computed after the open, so it carries `recoveryMode: true`.
  - The helper never decides trust.
- **Secret lifetimes:**
  - The builders and the tail allocate no secret, and every `zeroize` stays at its site.
  - The `return await` keeps each wipe after the open's copy.
  - The stash wipes in the same order and keeps "remove before await" in finalize (B-11).
  - Finalize's type refusal still retains the entry (`(BUG PIN)`, see Drift).
- **Await and microtask order:**
  - The password builder awaits the same `subtle.sign` the inline call awaits, and the passkey builder is synchronous.
  - The tail helper adds one async frame, so the caller's `finally` runs one microtask later. Every wipe keeps its original position relative to the lock release:
    - password unlock's wipes, and passkey unlock's master wipe, still run after `runExclusive` returns, as on base;
    - every other wipe still runs inside the lock.
  - No span here must finish in one tick (lesson from approval-scope-follow).
- **Engine-generated error text.** No malformed value reaches a moved expression:
  - The builders read fresh, typed `seal` and `sealDek` outputs.
  - The backup-controlled `profile.id` and `name` pass through as values. The id loop and the `${profileId}` interpolation do not move.
  - P4's and the bearer restore's stored fields are read as properties of a non-null row, as today.
  - Stash entries are internal.
- **Layering:** both new files sit in `wallet/services/profile/`, beside their only consumers.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `7450928c`):

1. The six literals, the P4 mutation, the four MAC computations, the three envelope projections, the four tails and the stash consumers all sit at the lines above.
2. All three password literals share one key order, and so do all three passkey literals.
3. Rows persist as `JSON.stringify(row)` with no schema (`entity_storage.ts:190`; `repository.ts:46-48` passes `undefined`).
4. Every random draw on the row paths goes through `globalThis.crypto.getRandomValues` at call time. A scratch probe (deleted) stubbed it with a counter fill and got byte-identical `createProfile` rows, `envelopeMac` included.
5. `isRecoveryMode` is true exactly when the active session has no DEK (`session-manager.ts:690-692`).
6. The suite's internal reach-ins are only those at `service.integration.test.ts:1335-1403`.
7. The existing degraded tests assert `toContain` or a boolean. None of them pins exactly-once, the payload, the order relative to the open, or the healthy path's silence.
8. `FakePasskeyService.materializeCredential` substitutes `"user-handle"` for an absent handle (`service.integration.test.ts:155-156`), so K2's generated-id branch needs a local override.

**Inferences:**

- A literal vector moves only if a binding, the key order or the draw order moved. If the oracle still holds while a vector moves, the draw order moved: investigate.

**Asks:** resolved by the plan panel. See Decisions.

## Phases

### Phase 1: pin today's bytes and events (test only)

All new cases go in one new `describe` block in `apps/extension/src/wallet/services/profile/service.integration.test.ts`, reusing its harness. Titles carry no counts. Assertions on shapes are strict (`toStrictEqual`), so a key holding `undefined` is not mistaken for an absent key. The phase is green on the unchanged code and lands in its own commit, which freezes the file for Phase 2.

1. **Row known-answer vectors.**
   - **Setup:** the counter of a seeded `vi.spyOn(globalThis.crypto, "getRandomValues")` is reset at the start of every case, before `makeService()`, and restored in `afterEach`.
   - **Pinned per path:**
     - the raw persisted string, MAC included;
     - the return shape, strictly: the row for P1, P2, P4, K1 and K2, and `{ id, name, type }` for P3 and K3.
   - **Paths:**
     - P1 `createProfile`.
     - P2 `importMnemonic` with fixed words.
     - P4 `changeProfilePassword`.
     - P3 `restore` of a password backup whose `profile.id` equals a live row's id. The stored id must differ from the backup id.
     - K1 `createPasskeyProfile`.
     - K2 `importPasskey` with a `userHandle`.
     - K2 `importPasskey` without one: a local override keeps the handle absent, and the test asserts the stored id is the generated one.
     - K3 passkey `restore`.
   - **Recording:** record each vector on the unchanged code, then confirm it under an isolated `-t` run and two full reruns.
2. **MAC oracle.**
   - **Paths:** P1 to P4.
   - **Computation:** `node:crypto` `hkdfSync("sha256", master‖dek, 0^32, "nulo:envelope-mac:v3", 64)`, then HMAC-SHA256 over `` `${storageKey}.${guard}.${secret}.${entropy}.${dekSealed}.${walletFingerprint}` ``.
   - **Inputs:**
     - The master comes from the known words, the backup pair or `PasswordSecretBox.unseal`.
     - The DEK is unsealed from `dekSealed` under `EncryptionKey.fromPasshash(getPasshash(password))` with `IMPORTED_DEK_AAD`.
   - **Assertion:** the result equals `envelopeMac`, and swapping master and DEK does not.
3. **Degraded-tail table**, one row per tail plus a healthy twin.
   - **Triggers:**
     - T1: a same-password sibling's `dekSealed` transplant; then `envelopeMac` deleted; then a non-string `envelopeMac`.
     - T2: a blinded fingerprint.
     - T3: a corrupted `envelopeMac` between restore and finalize.
     - T4: `dekSealed` swapped between restore and finalize.
   - **Degraded rows assert:**
     - exactly one emit, with the payload strictly equal to `{ id, name, type, recoveryMode: true }`;
     - order `active` then `degraded`;
     - the return equals the payload;
     - no session DEK;
     - a non-zero session master (`getProfileSecret`).
     - The missing and non-string tag rows also assert that `changeProfilePassword` refuses.
   - **Healthy twins assert:**
     - zero emits;
     - a return without `recoveryMode`;
     - a session DEK that is non-zero and equals the oracle-unsealed DEK (or the restore's destination DEK);
     - a non-zero master.
   - **Integrity delegate:** one throwing `AccountAddressInconsistencyError` on a degraded T1 open produces zero emits.
4. **Stash pins.**
   - **`(BUG PIN)` finalize's type refusal retains the entry, even at the TTL.**
     - Setup: a passkey restore, the entry aged exactly the TTL under a frozen clock, and the row's `type` edited to a third value.
     - Finalize throws "Profile type changed between restore and finalizeRestore".
     - The entry is still present with non-zero buffers, and the rewrap context is gone (it was dropped at entry).
     - This is the case where `exceptId` is observable.
   - **Consume:**
     - A live consume returns exactly `{ sourceDek, destinationDek }` (strict), both non-zero, and removes the entry.
     - A second consume returns `undefined`.
     - An expired consume wipes both buffers and removes the entry.
   - **Sweep boundary:** an entry aged exactly the TTL is wiped and removed by an unrelated sweep (`consumeDekRewrapContext` for another id).
5. **Bearer-restore envelope.** A mutant run during Phase 1 must show that `:2705-2714` ("(e) SW-restart silent restore") reds when `session-manager.ts`'s envelope projection drifts. If none does, add a pin. If no pin is feasible, drop 2d and record it as a follow-up.

**Mutation check.** Each mutant is applied by hand after Phase 2 and then reverted; the table names the red each one must produce.

The "observed" column records the run at the Phase 2 head: every mutant went red.

| mutant | expected red | observed (failing tests) |
|---|---|---|
| builder MACs the backup id instead of the loop's id | P3 vector and oracle | 1: the P3 vector case |
| builder MACs `sourceDek` | P3 vector, oracle, T3 healthy twin | 6, including the P3 vector and the T3 healthy twin |
| P4 MACs the old `dekSealed` | P4 vector and oracle | 2, including the P4 vector |
| master and DEK swapped in `envelopeMacFor` | every password vector, oracle, every healthy twin | 25 |
| two slots swapped in `macEnvelopeV3` | every password vector | 4: the four password vector cases. Compute and verify share the projection, so the round-trip tests miss the swap. The vectors and the independent oracle in the same cases both catch it; the vector assertion runs first |
| one passkey literal key reordered | the passkey vectors | 4: the four passkey vectors |
| a tail returns without `await` (T2, T3, T4 separately) | that tail's healthy twin (zeroed DEK) | 1, 4 and 2, each including its healthy twin |
| the tail emits before the open | the tail table | 7 |
| the tail drops the emit | the tail table | 12 |
| the tail inverts `!dek` | the tail table | 17 |
| `take` placed before finalize's type refusal | the type-refusal pin | 1: the pin |
| `sweep` ignores `exceptId` | the type-refusal pin | 1: the pin |
| `>` for `>=` in `take` | `:1320-1351` | 2: that test and the expired-consume pin |
| `>` for `>=` in `sweep` | the sweep-boundary pin | 1: the pin |
| the restore-secret `wipe` misses the DEK | `:1380-1406`, the sweep-boundary pin | 3 |
| the rewrap `wipe` misses the destination DEK | `:1380-1406`, the expired-consume pin | 2 |
| the bearer restore's envelope projection drifts | `:2705-2714` | 7, including `:2705-2714` |

### Phase 2: the refactor, test file untouched

1. **(a)** `profile-row.ts`, plus the six literals, P4, and the two `service.ts` envelope projections.
2. **(b)** `openAndWarnIfDegradedHoldingLock`, plus T1 to T4.
3. **(c)** `expiring-stash.ts`, plus the two fields, consume, finalize and the drop callers.
4. **(d)** the `session-manager.ts` envelope projection.

**Validation gate** (after Phase 1, after each Phase 2 commit, and at the end):

- **Commands:**
  - `bun run --cwd apps/extension test src/wallet/services/profile/`
  - `bun run lint`
  - `bun run typecheck:all`
  - `bun run test:all`
  - `bun run test:ci-gating`
  - `bun run audit:vue`
  - at the end: `implementations-plan/harden-dedupe/tools/scoped-dup.sh`, before and after
- **Pass criteria:**
  - Every command exits 0.
  - Phase 2 leaves every test file byte-identical.
  - The scoped clone count does not rise.
  - The mutation table behaves as written.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** lint, typecheck, unit and integration locally. Smoke and network e2e run on both browsers in CI, per the program gates.

## Post-implementation

1. **Audit of the arc diff:** Codex (GPT-6 Astra, xhigh) plus an independent Opus pass, as a MID batch requires.
   - **Asks:** adversarial, assumption-attack and implementation-critique. Both legs must confirm the per-site tables and each password site's MAC binding.
   - **No-over-engineering rule, verbatim:** "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - **Comment-quality rule, verbatim:** "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:**
   - Triage each finding, fix it, and commit.
   - Log the round in this arc's file under the program's `lessons/`.
   - Resume the same session.
   - Stop when a round has no material finding. At 5 rounds, park the arc.
3. **Delivery:**
   - Push, open a ready PR against its parent in the gh stack, then add both e2e labels.
   - When the program gates are green on the head SHA, with the run attempt and the shards that ran recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/13-profile-rows`, stacked on `harden-dedupe`; the driver sets the parent at delivery.

- It must land before byte-primitives. Byte-primitives' Q-15 sites (`profile/service.ts:1718, :1876-1878, :2063, :2072, :2310, :2321, :2341`) sit outside this arc's hunks but in the same file.
- It shares no file with row-lifecycle or incoming-arms.
- Code review: off.

## UI impact

None. No `.vue`, CSS or copy changes. The popup's imported-keys warning is fed by `onImportedKeysDegraded`, whose firing, payload and order Phase 1 pins.

## Drift left for the alignment arc

**No drift among the copies.** The row literals, the MAC calls, the tails and the two TTL checks agree today (recon: "none in (a)/(b)").

**Observed, kept, and recorded as program follow-ups:**

1. **Finalize's type refusal retains the stash entry.**
   - A passkey row whose `type` was edited to a third value makes finalize refuse before removing the entry (`:2750-2757`).
   - Expiry is lazy: the stashed master stays in memory until the next operation that sweeps, a lock or a delete. It can therefore outlive the TTL.
   - Pinned as a `(BUG PIN)`. Wiping it is a strictly safer cleanup, which the program routes through a panel.
2. **Several RPCs return the full persisted row** (sealed slots, `dekSealed`, `envelopeMac`, fingerprint), typed as `ProfileInfo`, to the popup:
   - create and import (`:628, :776, :2178, :2234`);
   - `changeProfileName` (`:1019`);
   - `changeProfilePassword` (`:1186`).

   `EditProfilePopup.vue:85` stores the result in Pinia. The logger's `trim` collapses a `Profile`, so a log leaks nothing. This is data minimisation only. Phase 1 pins today's returns.
3. **A redundant drop.** Finalize's expiry branch drops a rewrap context that its entry already dropped under the same lock (`:2682`, `:2763`). It is a no-op, kept verbatim.
4. **A same-id `set` over a stale entry drops it without a wipe.** A restore stash sweeps with `exceptId = id`, then `set`s over any expired same-id entry (`:2442-2443`, `:2610-2627`). Today's behaviour is kept, and it is recorded as a low lead.

## Decisions (delegated)

### Plan audit: Codex (GPT-6 Astra, xhigh) REVISE; Opus REVISE

**Confirmed by both legs:**

- the MAC bindings, including P3's post-loop id and P4's new sealed DEK;
- key order and absent keys;
- draw order;
- the unlock-verify fold;
- that the tails hold the lock;
- the stash lifetimes;
- that the seeded KAT is sound;
- that the oracle matches production.

**Findings, all adopted:**

1. **`return await` at the tails** (Opus, should-fix). A bare return lets T2, T3 and T4's `finally` zero the buffers before the open copies them; Opus probed `[7,7,7]` with the await against `[0,0,0]` without. The plan now keeps `return await`, makes the healthy twins assert real non-zero buffers, and adds the bare-return mutant.
2. **Per-path return shapes, asserted strictly** (both legs). Raw JSON and `toEqual` cannot tell a missing key from an `undefined` one, and consume's projection is part of its contract.
3. **`exceptId` is observable** (both legs). The plan's "not observable" claim was wrong: an at-TTL entry with an edited type separates the two. The case is pinned as a `(BUG PIN)`, Drift 1 now says expiry is lazy, and the stale same-id `set` is recorded as Drift 4.
4. **The fake masks the missing-`userHandle` branch** (Codex). Adopted: a local override keeps the handle absent.
5. **Re-seed before every case** (Opus). Adopted, along with an isolated `-t` recording run.
6. **Missing and non-string `envelopeMac` pins** (Opus). Adopted. They are also the condition for the unlock-verify fold.
7. **Mutation table** (both legs). The master/DEK swap is added. The "`mintPxeGeneration` before the tag" row is dropped because it proves nothing; it stays as a source-review note.
8. **Grouped `envelopeMacFor` input** (Opus). Adopted: it removes P4's positional-swap risk. P3's cast gets a one-line reason.
9. **Exact inventory counts** (Codex). Adopted: six literals plus one mutation, and four MAC computations.
10. **Comments** (both legs). Adopted as listed under What changes: the projection's contract, the id-final contract, the `pxeGeneration` invariant, removed provenance, one `take` sentence, the stash contract, and the named trust gates.
11. **Drift 2 widened** (both legs). It now includes `changeProfileName`, `changeProfilePassword` and the Pinia store; the logger's `trim` is noted.

**Ask calls:**

1. **Overturn literal-vs-builder:** yes, both legs. `newPasskeyRow` is accepted for its single field list.
2. **Fold the unlock verify:** yes, both legs, conditional on finding 6.
3. **`session-manager.ts:617-628`:** the legs split.
   - Codex: leave it. It is a separate unit with a silent-close policy.
   - Opus: include it. The Outcome names a silent bearer-restore close as the harm of a missed MAC-input edit, and this site is what produces it.
   - **Call: include it, narrowly,** as commit 2d. Only the projection changes; the id and the failure policy stay. This is gated on Phase 1 step 5.
