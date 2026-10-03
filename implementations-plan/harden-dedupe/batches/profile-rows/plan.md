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

Finding Q-17 (a, b, c), from `audit/quality/2026-09-30-dedup-high/`. All of it lives in `apps/extension/src/wallet/services/profile/service.ts` (2,797 lines). The persisted profile row and its envelope MAC are built at seven sites, the "a degraded open must warn" rule is restated four times, and the two in-memory restore maps each hand-roll the same TTL lifecycle. This batch states each once. No persisted byte, MAC tag, event, error, await order across a lock, or buffer wipe changes. Q-17 (d), the reveal skeleton, stays out: the audit excluded it, and the adjudication in `implementations-plan/archive/profile-service-dedup/plan.md` still stands.

## Outcome & Quality Bar

- **For whom:** the next person who adds a row field or a MAC input. Today that is seven edits, and a miss surfaces only at first unlock: as a derived-only session, or as a silent close of every bearer restore. A fifth open path can also forget `onImportedKeysDegraded`, the only signal the popup has that imported keys are quarantined.
- **Excellent:**
  - A password row and its tag come from one builder. The builder reads the same `id`, slots, `dekSealed` and fingerprint bindings for the MAC and for the row, so no site can MAC one value and store another.
  - Every row-writing path is pinned by a literal known-answer vector of its persisted bytes (MAC included) under a seeded RNG, cross-checked by an independent `node:crypto` recomputation anchored on the storage key. Both are recorded on the unchanged code.
  - The four degraded tails share one helper, and a per-path table pins that each emits exactly once, with the exact payload, after the open, and never on a healthy open.
- **Good enough:** every site keeps its own guards, id allocation, lock placement and `finally` wipes, line for line. Only the MAC call plus the row literal, the open-and-warn tail, and the map lifecycle move.

## Architecture & Implementation

Read on `harden-dedupe` at `7450928c`. The file is byte-identical to recon's reading apart from one import line, so recon's line numbers hold.

### (a) Row construction

**Sites today**, each inside the facade lock:

| site | lines | guards before the row (stay at the call site, in order) | MAC inputs: id, master, dek, slots, `dekSealed`, fingerprint | after the row (stays) |
|---|---|---|---|---|
| P1 `createProfile` | MAC `:610`, row `:612-623` | `assertNotDuplicateWallet(secret, false)` `:605`; `nextUnreservedId` `:606` (seal and DEK seal ran before the lock, `:598-601`) | `id`, `secret`, `dek`, `encrypted`, `dekSealed`, `walletFingerprint` | `persistNewProfileHoldingLock` → `openSessionVerified`; outer `finally` wipes secret, entropy, dek, passhash |
| P2 `importPasswordProfile` | MAC `:2163`, row `:2164-2175` | dup-wallet `:2159`; `nextUnreservedId` `:2160`; `sealWithPasshash` `:2161`; DEK seal `:2162` | same names | persist → open; `finally` `:2180-2185` |
| P3 `commitRestoredPasswordProfileHoldingLock` | MAC `:2413-2418`, row `:2420-2433` | dup-wallet `:2393`; seal `:2397`; fresh `destinationDek` `:2403`; DEK seal `:2405`; id loop on `contains ∨ isReserved` `:2407-2410` | `id` after the loop, `plainSecret`, `destinationDek`, `sealed.encrypted`, `dekSealed`, `walletFingerprint` | `writeMarkerThenRowHoldingLock` → `onProfileAdded` → rewrap stash; catch rethrows `DuplicateWalletError`, else `restoreError` |
| P4 `changeProfilePassword` | MAC `:1168-1173` (mutates the row in place) | `getProfileOrThrowHoldingLock`; passkey refusal; `reseal`; `unsealResealedVerifiedHoldingLock`; `rekeyedDekForPasswordChangeHoldingLock` (old MAC verified, `:1085`) | `id`, `secret`, `dek`, `resealed.encrypted`, `rekeyed.newDekSealed`, `profile.walletFingerprint` | `repo.set` → `onProfileUpdated` → reopen; `finally` `:1178-1184` |
| K1 `createPasskeyProfile` | row `:763-771` | `contains ∨ isReserved` → `ProfileIdConflictError` `:757`; dup-wallet `:761` | none (passkey rows carry no MAC) | persist → open; `finally` `:778-782` |
| K2 `importPasskeyProfile` | row `:2222-2231` | `userHandle` taken → "Passkey profile already exists" `:2204`; `assertNotDuplicateCredential` `:2209`; dup-wallet `:2211`; no `userHandle` → `nextUnreservedId` `:2214-2220` | none | persist → open; `finally` `:2236-2239` |
| K3 `commitRestoredPasskeyProfileHoldingLock` | row `:2590-2598` | id taken → exists `:2574`; dup-credential `:2579`; dup-wallet `:2581`; no id → `nextUnreservedId` `:2584-2588` | none | marker-then-row → `onProfileAdded` → stash whose `expected` snapshot reads the new row `:2617-2623` |

**Verify sites:** `unsealTrustedDekHoldingLock` builds the envelope inline from the row (`:392-402`, requested `id`). `envelopeMacValid` (`:2043-2057`) builds it through `macEnvelopeV3` (`:2022-2033`).

**What changes:**

- New `apps/extension/src/wallet/services/profile/profile-row.ts`, importing only `@nulo/wallet-crypto` (`computeEnvelopeMacV3` and types) and `./spec`:
  - `macEnvelopeV3(slots, dekSealed, walletFingerprint)` moves here from the service, verbatim with its doc.
  - `envelopeMacFor(id, master, dek, slots, dekSealed, walletFingerprint)` returns `computeEnvelopeMacV3(id, master, dek, macEnvelopeV3(slots, dekSealed, walletFingerprint))`, today's expression at all four sites. Its doc states the contract: `id` is the storage key the row is written under, and it is final.
  - `newPasswordRow({ id, name, slots, dekSealed, walletFingerprint }, master, dek)` computes the tag with `envelopeMacFor`, then returns the literal in today's key order: `id, name, type, pxeGeneration, dekSealed, walletFingerprint, guard, secret, entropy, envelopeMac`. `mintPxeGeneration()` stays inside the literal, after the tag, as today.
  - `newPasskeyRow({ id, name, dekSealed, walletFingerprint, credentialId })` is synchronous and returns `id, name, type, pxeGeneration, dekSealed, walletFingerprint, credentialId`.
- P1, P2 and P3 replace their MAC line and literal with one `newPasswordRow` call at the literal's position. P3 passes `asMasterSecretBytes(plainSecret as Uint8Array<ArrayBuffer>)` and `destinationDek`, as today.
- P4 replaces its `computeEnvelopeMacV3(... this.macEnvelopeV3(...))` with `envelopeMacFor(id, secret, dek, resealed.encrypted, rekeyed.newDekSealed, profile.walletFingerprint)`. The in-place mutation order stays.
- K1, K2 and K3 replace their literal with `newPasskeyRow`.
- `unsealTrustedDekHoldingLock` replaces its inline envelope (`:392-402`) with `this.envelopeMacValid(id, row, secret, dek)`. That computes the same envelope from the same row fields against the same requested `id` (see Asks).
- `envelopeMacValid` calls the module `macEnvelopeV3`, and the private method is deleted.

**Why this is byte-identical:**

- The tag is a pure function of `(id, master, dek, five strings)`. `preimageV3` reads the envelope by property name (`packages/wallet-crypto/src/entropy-mac.ts:54-62`), and every site passes the same bindings it passes today.
- `JSON.stringify` writes the row (`packages/wallet-core/src/storage/entity_storage.ts:190`), so key order is persisted bytes. The builders keep each literal's order, and all three password and all three passkey literals share one order today.
- The RNG draw order is unchanged. The builders draw only `mintPxeGeneration`, at the same point as today (after the tag, which draws nothing). Every other draw (entropy, DEK, IVs, ids) stays at its call site.

### (b) Degraded-open tail

**Sites today** (`openSessionVerified(row, master, passhash, dek ?? undefined)`; `if (!dek) emit("onImportedKeysDegraded", getProfileInfo(row))`; `return getProfileInfo(row)`):

| site | lines | dek trust gate before it (stays) | passhash | wipes after it (stay) |
|---|---|---|---|---|
| T1 `unlockProfile` phase 3 | `:702-706` | `repo.get`, reserved, type, ciphertext compare, `unsealTrustedDekHoldingLock` | yes | `passhash` `finally` `:708-710`; outer `finally` (after the lock) `:711-717` |
| T2 `unlockPasskeyProfile` phase 3 | `:851-855` | credential bind `:828`, `repo.get`, reserved, type, `credentialId` compare, `unsealPasskeyDekHoldingLock` | none | `finally` `zeroize(dek)` `:856-858`; outer `finally` `:860-863` |
| T3 `finalizePasswordRestoreHoldingLock` | `:2726-2730` | password present, unseal, pairing check, passhash, `unsealTrustedDekHoldingLock` | yes | `finally` `:2731-2737` |
| T4 `finalizePasskeyRestoreHoldingLock` | `:2787-2791` | stash present, type, removal, TTL, `expected` snapshot and fingerprint recompute | none | `finally` `:2792-2795` |

**What changes:** one private `openAndWarnIfDegradedHoldingLock(row, master, passhash, dek: ImportedKeysDek | null): Promise<ProfileInfo>` holds those three statements verbatim. Its doc says it allocates and wipes nothing, the caller holds the lock, and `dek` must come from one of the trust gates above. Each site becomes `return await this.openAndWarnIfDegradedHoldingLock(...)`, inside the same `try`, so every `finally` keeps its scope. Create, import and password-change opens always hold a fresh DEK; they keep calling `openSessionVerified` directly.

### (c) Restore stash lifecycle

**Today:**

- Two private `Map`s: `pendingRestoreSecrets` (`:137-150`) and `pendingDekRewraps` (`:162-165`).
- The TTL sweep repeats its loop once per map (`:194-211`). It is called under the lock from consume `:225`, lock `:919` (`now = +∞`), delete `:1468`, password stash `:2442`, passkey stash `:2610` and finalize `:2659`.
- Drop-and-wipe exists twice (`:1431-1448`), called from delete `:1494, :1497` and finalize `:2682, :2763`.
- The "take, and enforce the TTL on the taken entry" check exists twice: consume `:226-237` and finalize `:2757-2765`. Each carries a comment saying the TTL had to be added by hand, because the sweep excludes that id.
- Stashes at `:2443-2447`, `:2613-2624` and `:2627`. Finalize reads the entry and refuses on type before removing it (`:2750-2757`).

**What changes:**

- New `apps/extension/src/wallet/services/profile/expiring-stash.ts`, holding `ExpiringStash<E extends { capturedAt: number }> extends Map<string, E>`. It is constructed with `(ttlMs, wipe: (entry: E) => void)`, a strategy rather than flags, and adds three synchronous methods:
  - `sweep(now, exceptId?)` is today's loop: skip `exceptId`; `now - capturedAt >= ttlMs` → delete, then wipe.
  - `take(id, now)` deletes the entry; if it has expired, it wipes it and returns `undefined`; otherwise it returns the entry.
  - `drop(id)` deletes the entry and wipes it.
- The two fields keep their names and become `ExpiringStash` instances whose `wipe` zeroizes exactly today's pair, in today's order.
- `sweepStalePendingRestore` stays as a two-line method, so its six callers and its lock doc stay. `dropPendingRestoreSecret` and `dropPendingDekRewrap` are deleted, and their four callers call `drop`.
- Consume becomes `take(profileId, now)`, keeping its own sweep call first.
- Finalize keeps `get` → "No pending restore secret…" → the type refusal (entry kept), then `take(id, Date.now())`. An `undefined` there drops the rewrap and throws the same message, the same sequence as `:2757-2765`.
- **Why `extends Map`:** the frozen suite reaches into both fields with `get`, `has`, `values()`, `size`, and edits `capturedAt` on the live entry (`service.integration.test.ts:1335-1348, 1368-1371, 1396-1403`). A subclass keeps those reads valid and exposes nothing that the private `Map` does not expose today. The class imports no lock and no service, and its doc says callers serialize access. Every method is synchronous, so no call can interleave.

### What stays

- Every guard, id loop, lock acquisition, `finally`, event and error string in the tables above.
- Q-17 (d).
- `rpcMethods` and every public signature, including `consumeDekRewrapContext`.
- `packages/wallet-crypto`: no file changes there, source or test.
- `session-manager.ts:617-628`, the bearer-restore envelope literal (see Asks).
- The create and import paths still return the full row object they persisted (see Drift).

### Complexity

`scripts/complexity-baseline/manifest.json` has no acceptance in this file. Every touched function shrinks, and the new functions are flat, a few lines each.

### Alternatives not taken

- **The status quo,** literals and seven MAC calls left inline. The prior plan kept one row literal because "a 7-param builder loses to a 10-line literal". With a grouped-object input the builder is one call, and what it buys is structural: the tag and the row read one set of bindings. That pays for itself on the boundary this file guards (see Asks).
- **A builder that writes the row too.** It would pull lock and persistence ordering (persist vs marker-then-row) into a strategy for no gain; persistence stays at the call sites.
- **Composition instead of `extends Map` for the stash.** It would force edits to frozen reach-ins, or forwarding boilerplate.

## Security & Adversarial Considerations

- **Who reaches this code.** Popup RPCs: create, import, unlock, change password, restore, finalize. A storage writer (attacker model A1) who edits rows at rest. A hostile backup file, through `restore`. No dApp reaches the profile service.
- **MAC inputs stay byte-identical.** Same id binding (the storage key, final, after allocation or the restore loop, inside the same lock), same master, same DEK (P3 uses the fresh `destinationDek`, never `sourceDek`), same slots, same `dekSealed` (P4 uses the new one), and the same fingerprint. The domain label `nulo:envelope-mac:v3`, the HKDF salt, the `.`-joined field order and the key derivation live in `wallet-crypto`, which this arc does not touch.
  - The vectors pin outputs, and the oracle pins meaning (storage key, field order, label). A wrong binding reds both.
  - The restore vector uses a backup id that collides with a live row, so it pins the tag over the re-minted id, not the backup's id.
- **No crypto or KDF change, no migration.** CLAUDE.md says crypto rotations are never migratable. Any non-zero vector diff is a refactor bug, and it is never re-recorded.
- **npm surface: none.** `@alejoamiras/nulo-wallet-crypto` publishes only `packages/wallet-crypto/src/public.ts` (account derivation, `EncryptionKey`, `Passhash`). `entropy-mac.ts` is wallet-internal, and the arc edits no file in that package.
- **Verify sites.**
  - Every check before a MAC verify, and every refusal, stays at its call site.
  - The unlock verify still uses the requested `id`, never `row.id`; the EntityStorage key guard keeps them equal on a readable row.
  - A MAC failure still degrades at open and still refuses at password change (`:1085-1088`, unchanged). Nothing re-MACs a row that failed verification (lessons: "on a MAC failure refuse, never self-heal").
- **The degraded warning cannot be lost.** The helper emits only after `openSessionVerified` resolves, so a failed open still emits nothing, as today. The payload is computed after the open, so it carries `recoveryMode: true`. The helper never decides trust: it receives a gated `dek` or `null`.
- **Secret lifetimes.**
  - The builders and the tail allocate no secret; they read caller-owned buffers, and every `zeroize` stays at its site.
  - The stash wipes in the same order. It keeps "remove before await" in finalize (B-11) and leaves an entry in place on finalize's type refusal (pinned, see Drift).
  - It gains no getter that returns a buffer beyond what `Map` already offers inside the class.
- **Await and microtask order.**
  - The password builder awaits the same `subtle.sign` the inline call awaits, and the passkey builder is synchronous.
  - The tail helper adds one async frame. Open, emit and return stay contiguous in it, and everything sits inside the facade lock. The only effect is that a caller's `finally` runs one microtask later, over local buffers nothing else can reach.
  - No span here must finish in one tick (lesson from approval-scope-follow).
- **Engine-generated error text.** No malformed value reaches a moved expression:
  - The builders read fresh, typed outputs of `seal` and `sealDek`.
  - The backup-controlled `profile.id` and `name` pass through as values. The id loop and the `${profileId}` interpolation inside `wallet-crypto` do not move.
  - P4's stored `profile.walletFingerprint` is read as a property of a non-null row, as today.
  - Stash entries are internal.
  So no engine can name a different variable than it does today.
- **Layering.** Both new files sit in `wallet/services/profile/`, beside their only consumer. `profile-row.ts` imports what the service already imports; `expiring-stash.ts` imports nothing.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `7450928c`):

1. The seven row sites, four MAC calls, two verify sites, four tails and the stash consumers sit at the lines above (`service.ts`; the file differs from recon's reading by one import line).
2. All three password literals share one key order, as do all three passkey literals (`:612-623, :2164-2175, :2420-2433`; `:763-771, :2222-2231, :2590-2598`).
3. Rows persist as `JSON.stringify(row)` with no schema (`entity_storage.ts:190`; `repository.ts:46-48` passes `undefined`), so key order is persisted bytes.
4. Every random draw on the row paths goes through `globalThis.crypto.getRandomValues` at call time: `service.ts:590`, `spec.ts:106`, `wallet-crypto` `encryption-key.ts:43` and `imported-keys-dek-box.ts:35,41`, and `wallet-core` `random.ts:13`. A scratch probe (deleted) stubbed it with a counter fill and got byte-identical `createProfile` rows across two service instances, `envelopeMac` included.
5. `isRecoveryMode` is true exactly when the active session has no DEK (`session-manager.ts:690-692`), so the degraded payload is `{ id, name, type, recoveryMode: true }`.
6. The suite's internal reach-ins are only those at `service.integration.test.ts:1335-1403`. No other file touches the maps, `macEnvelopeV3`, `envelopeMacValid` or the drop helpers.
7. The existing degraded tests assert `toContain` or a boolean (`:647, :707, :739, :756, :2678, :2916`). None pins exactly-once, the payload, the order relative to the open, or the healthy path's silence.
8. `entropy-mac.ts` is not exported by `packages/wallet-crypto/src/public.ts`.

**Inferences:**

- A literal vector moves only if a binding, the key order or the draw order moved. If the oracle still holds while a vector moves, the draw order moved; investigate before touching anything.
- No caller depends on the private methods being deleted, because they are `private` and only the suite's listed reach-ins read internals.

**Asks** (for the plan panel):

1. **Overturn the prior "literal beats builder" call** (`implementations-plan/archive/profile-service-dedup/plan.md`, Phase 5 gate outcome) for the row literals. Recommendation: yes, on the grouped input and the shared MAC bindings argued above. The finding's own evidence is that two commits each edited every copy.
2. **Fold the unlock verify site (`:392-402`) into `envelopeMacValid`.** Recommendation: yes. It is the same envelope restated in the same file, and the finding's harm ("a new MAC input means N edits") covers it.
3. **Leave `session-manager.ts:617-628`, the bearer-restore envelope, out.** Recommendation: leave it. It is outside Q-17's instances and in another unit, so it goes to follow-ups. Importing `macEnvelopeV3` there would be a one-line follow-up.

## Phases

### Phase 1: pin today's bytes and events (test only)

All new cases go in one new `describe` block in `apps/extension/src/wallet/services/profile/service.integration.test.ts`, which reuses its harness. Titles carry no counts. The phase must be green on the unchanged code, and it lands in its own commit, which freezes the file for Phase 2.

1. **Row known-answer vectors.**
   - **Setup:** a seeded RNG, `vi.spyOn(globalThis.crypto, "getRandomValues")` with a counter fill, restored in `afterEach`. A fresh `makeService()` per path.
   - **What is pinned:** the raw persisted string of each row as a literal (MAC included), and the method's return value deep-equal to the parsed row.
   - **Password paths:**
     - `createProfile`.
     - `importMnemonic` with fixed words.
     - `changeProfilePassword`: the row after the change.
     - `restore` of a password backup whose `profile.id` equals a live row's id: the loop must re-mint. Assert the stored id differs from the backup id.
   - **Passkey paths:**
     - `createPasskeyProfile` via credential data.
     - `importPasskey` with and without a `userHandle`.
     - `restore` of a passkey backup.
   - **Recording:** record each vector on the unchanged code, then rerun twice to confirm stability.
2. **MAC oracle.**
   - **Paths:** each password path above.
   - **Computation:** recompute the tag with `node:crypto` (`hkdfSync("sha256", master‖dek, 0^32, "nulo:envelope-mac:v3", 64)`, then HMAC-SHA256) over `` `${storageKey}.${guard}.${secret}.${entropy}.${dekSealed}.${walletFingerprint}` ``.
     - `storageKey` is the row's key suffix.
     - The master comes from the known words or backup pair, or from `PasswordSecretBox.unseal` for `createProfile`.
     - The DEK is unsealed from the row's `dekSealed` under `EncryptionKey.fromPasshash(getPasshash(password))` with `IMPORTED_DEK_AAD`.
   - **Assertion:** the recomputed tag equals `envelopeMac`. The oracle reads nothing from `profile-row.ts` or the service, so it is the independent half of the pin.
3. **Degraded-tail table**, one row per tail:
   - **Triggers:**
     - T1: a same-password sibling's `dekSealed` transplanted into the row. It unseals cleanly and only the MAC catches it, so it also covers the moved verify site.
     - T2: a blinded fingerprint.
     - T3: a corrupted `envelopeMac` between restore and finalize.
     - T4: `dekSealed` swapped between restore and finalize.
   - **Each degraded open:** exactly one `onImportedKeysDegraded`, with a payload deep-equal to `{ id, name, type, recoveryMode: true }`; the event order is `active` then `degraded`; the returned info deep-equals the payload; `getProfileDek` is `undefined`.
   - **Each healthy twin** (the success-path control): zero emits, a return without `recoveryMode`, and the DEK present.
   - **A degraded open that fails:** an integrity delegate throwing `AccountAddressInconsistencyError` on T1 gives zero emits.
4. **Stash pins.**
   - **Finalize type refusal keeps the entry:** after a passkey restore, editing the row's `type` to a third value makes finalize throw "Profile type changed between restore and finalizeRestore". The `pendingRestoreSecrets` entry is still present with non-zero buffers, and the rewrap context is already gone (dropped at entry).
   - **Consume:** a live consume returns both buffers non-zero and removes the entry, and a second consume returns `undefined`. An expired consume wipes both buffers and removes the entry; this extends `:3011-3032`'s scenario in a new case.
   - **Sweep boundary:** under a frozen `Date.now`, a passkey stash entry aged exactly the TTL is wiped and removed by an unrelated sweep (`consumeDekRewrapContext` for another id). Today only `take`'s boundary is pinned (`:1320-1351`).

**Mutation check** (applied by hand in a scratch commit after Phase 2, each reverted; the expected red named):

| mutant | expected red |
|---|---|
| builder MACs the backup id instead of the loop's id | P3 vector and oracle |
| builder MACs `sourceDek` | P3 vector, oracle, and the T3 healthy twin |
| P4 MACs the old `dekSealed` | P4 vector and oracle |
| two slots swapped in `macEnvelopeV3` | every password vector, and every healthy twin |
| one literal key reordered | that path's vector |
| `mintPxeGeneration` moved before the tag | none expected (it draws after the only draws that feed the tag), so the probe confirms the vectors stay put |
| the tail emits before the open, or drops the emit, or inverts `!dek` | the tail table |
| `take` placed before finalize's type refusal | the stash pin |
| `>` for `>=` in `take` | `:1320-1351` |
| `>` for `>=` in `sweep` | the sweep-boundary pin |
| the wrong buffer pair in a `wipe` strategy | `:1380-1406` and the consume pin |

`sweep` skipping `exceptId` is not observable, because `take` enforces the same TTL on that id with the same outcome. It is checked by reading the code.

### Phase 2: the refactor, in three commits, test file untouched

1. **(a)** `profile-row.ts`, plus the seven row sites, P4 and the two verify sites.
2. **(b)** `openAndWarnIfDegradedHoldingLock`, plus T1 to T4.
3. **(c)** `expiring-stash.ts`, plus the two fields, consume, finalize and the drop callers.

**Validation gate** (after Phase 1, after each Phase 2 commit, and at the end):

- **Commands:**
  - `bun run --cwd apps/extension test src/wallet/services/profile/`
  - `bun run lint`
  - `bun run typecheck:all`
  - `bun run test:all`
  - `bun run test:ci-gating`
  - `bun run audit:vue`
  - at the end only: `implementations-plan/harden-dedupe/tools/scoped-dup.sh`, before and after
- **Pass criteria:**
  - Every command exits 0.
  - Phase 2 leaves every test file byte-identical (`git diff --stat` lists `service.ts` and the two new files only).
  - The scoped clone count does not rise, and the row-literal clone is gone.
  - The mutation table behaves as written.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** lint, typecheck, unit and integration locally. Smoke and network e2e run on both browsers in CI, per the program gates; unlock, restore and import flow through them.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, plus an independent Opus pass, as a MID batch requires.
   - **Asks:** the adversarial, assumption-attack and implementation-critique asks; both must confirm the per-site tables, and the MAC binding of each password site in particular.
   - **No-over-engineering rule, verbatim:** "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - **Comment-quality rule, verbatim:** "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the gh stack, then add both e2e labels. When the program gates are green on the head SHA (with the run attempt and the shards that ran recorded, both browsers' prover-on canaries included), squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/13-profile-rows`, stacked on `harden-dedupe` (the driver sets the parent at delivery). It must land before byte-primitives, whose Q-15 sites in `profile/service.ts` (`:1718, :1876-1878, :2063, :2072, :2310, :2321, :2341`) sit outside this arc's hunks but in the same file. It shares no file with row-lifecycle or incoming-arms. Code review: off.

## UI impact

None. No `.vue`, CSS or copy changes. The popup's imported-keys warning is fed by `onImportedKeysDegraded`, whose firing, payload and order Phase 1 pins.

## Drift left for the alignment arc

- **No drift among the copies.** The row literals, the MAC calls, the tails and the two TTL checks agree today (recon: "none in (a)/(b)").
- **Observed, kept, and recorded as program follow-ups:**
  - **Finalize's type refusal keeps the stash entry.** A passkey row whose `type` was edited to a third value makes finalize refuse before removing the entry, so the stashed master stays in memory until the TTL, a lock or a delete (`:2750-2757`). Phase 1 pins it. Wiping it is a strictly safer cleanup, which the program routes through a panel, not this arc.
  - **Create and import RPCs return the full persisted row** (sealed slots, `dekSealed`, `envelopeMac`, fingerprint) typed as `ProfileInfo`, to the popup (`:628, :776, :2178, :2234`). A data-minimisation follow-up; Phase 1 pins today's return.
  - **A redundant drop.** Finalize's expiry branch drops a rewrap context that its entry already dropped under the same lock (`:2682`, `:2763`). It is a no-op, kept verbatim.
  - **An adjacent envelope copy.** `session-manager.ts:617-628` builds the bearer-restore envelope inline (Ask 3).

## Decisions (delegated)
