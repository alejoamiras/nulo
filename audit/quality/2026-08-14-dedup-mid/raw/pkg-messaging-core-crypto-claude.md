# Quality scan: pkg-messaging-core-crypto (Claude)

Scope: `packages/extension-messaging/src`, `packages/wallet-core/src`, `packages/wallet-crypto/src`, `packages/wallet-sdk-schema-patch/src`. Focus: duplication (Duplicate Code, Shotgun Surgery, Divergent Change, Dead Code weighted highest).

---

## Finding 1: `WalletError` subclasses repeat an identical 2-line ctor tail 11 times

**Smell**: Duplicate Code (Dispensables).

**Impact bucket**: local. Blast radius: one file (`errors.ts`, 344 LOC). Change frequency: 7 commits total to the file — the pattern has been copy-pasted at least 11 times already (once per subclass added), so it recurs every time a new `WalletError` subclass is introduced (most recently `ProfileIdConflictError`, `RestoreTornError`).

**Evidence**: every subclass constructor ends with the same two statements — `this.name = "X"` then `Object.setPrototypeOf(this, X.prototype)` — right after the `super(...)` call:

- `RpcTimeoutError` — `packages/extension-messaging/src/errors.ts:52-53`
- `RpcDisconnectedError` — `errors.ts:73-74`
- `UserRejectedError` — `errors.ts:104-105`
- `JobCancelledError` — `errors.ts:130-131`
- `CapabilityNotGrantedError` — `errors.ts:158-159`
- `TooManyPendingError` — `errors.ts:180-181`
- `ValidationError` — `errors.ts:191-192`
- `InvalidPasswordError` — `errors.ts:207-208`
- `AccountAddressInconsistencyError` — `errors.ts:224-225`
- `RestoreTornError` — `errors.ts:243-244`
- `ProfileIdConflictError` — `errors.ts:266-267`

The base class itself documents the pattern as deliberate-but-repeated: `errors.ts:33-35` ("Ensure `instanceof` works... Subclasses repeat this in their ctors.").

**Why it harms future change**: every one of the (already 11, still growing) error subclasses is a copy-paste site. Nothing enforces that a 12th subclass gets both lines right — an author who forgets `setPrototypeOf` reintroduces a broken `instanceof` across the RPC boundary (the exact bug class the comment calls out), and it would only surface as a silent `instanceof WalletError` failure at a call site, not a compile error.

**Smallest safe refactoring**: Extract Function (or fold into the base) — give `WalletError`'s constructor a `name` parameter and set `this.name` there once; `Object.setPrototypeOf(this, new.target.prototype)` in the base ctor (using `new.target` instead of a hardcoded per-class `.prototype>` literal) removes the need for every subclass to repeat the prototype-fixup line at all. After the change each subclass ctor is just `super(Code.CODE, message, details)` — the 22 duplicated lines disappear.

**Instances**: `errors.ts:52-53, 73-74, 104-105, 130-131, 158-159, 180-181, 191-192, 207-208, 224-225, 243-244, 266-267`.

---

## Finding 2: The Port and sendMessage client transports re-implement the same error-shaping + response-dispatch logic

**Smell**: Duplicate Code (Dispensables), residual to an already-completed Extract Superclass. `BaseServiceClient` (`packages/extension-messaging/src/core/base-client.ts`) explicitly documents that it was created to absorb "mechanics that were duplicated and subtly drift-prone across the two forks" (`base-client.ts:10-12`) — this finding is the part that refactor left behind, in the two remaining subclasses.

**Impact bucket**: structural. Blast radius: 2 files that are the sole implementations of every popup↔SW and SW↔offscreen RPC call (`background/client.ts`, `offscreen/client.ts`). Change frequency: 4 commits each since the base-class split — every one of those touched both files in lockstep, which is exactly the Shotgun Surgery signature.

**Evidence** — five methods duplicated between the two files:

1. `makeRemoteError` — byte-identical body `return remoteErrorFromResponseContent(content)`.
   - `packages/extension-messaging/src/background/client.ts:134-136`
   - `packages/extension-messaging/src/offscreen/client.ts:113-115`
2. `makeTimeoutError` — identical shape, only the interpolated string differs (`` `RPC '${meta.methodName}' timed out after ${meta.timeoutMs}ms` `` vs `` `Offscreen request timed out: ${meta.methodName}` ``), both building `new RpcTimeoutError(..., { requestId, methodName })`.
   - `background/client.ts:138-143`
   - `offscreen/client.ts:117-122`
3. `makeSendFailureError` — identical shape, `new RpcDisconnectedError(..., { requestId, methodName, cause: meta.cause === undefined ? undefined : String(meta.cause) })` word-for-word.
   - `background/client.ts:145-151`
   - `offscreen/client.ts:124-130`
4. `makeDisconnectError` — byte-identical: `return new Error(CLIENT_DISCONNECTED_MESSAGE)`.
   - `background/client.ts:153-155`
   - `offscreen/client.ts:132-134`
5. `onMessage` — same envelope-validate-then-dispatch shape (`type !== Response && type !== Event` guard, `logWarn` on invalid, `handleResponse`/`handleEvent` dispatch with an identical `logDebug("Event received", event, payload)` line); offscreen's version adds one extra `message.from !== this.service` clause.
   - `background/client.ts:86-98`
   - `offscreen/client.ts:68-85`

The offscreen file's own comment names the intent: `offscreen/client.ts:107-108` — "Typed error shaping — parity with the background transport."

**Why it harms future change**: these five methods form the entire error-value vocabulary for both transports. A future change to the wire error contract (e.g. adding a structured `cause` chain, or changing what `RpcTimeoutError`'s details carry) has to be made twice, in two files that have no compiler-enforced link to each other — a maintainer who edits one and forgets the other produces a transport where popup↔SW errors and SW↔offscreen errors silently diverge in shape, which is exactly the class of drift the `BaseServiceClient` extraction was built to kill for the *other* half of these classes.

**Smallest safe refactoring**: Pull Up Method. `makeRemoteError` and `makeDisconnectError` are already 100% identical — move them verbatim into `BaseServiceClient` as concrete (non-abstract) methods; subclasses no longer declare them. For `makeTimeoutError`/`makeSendFailureError`, Extract Function a shared `buildRpcError(ErrorClass, message, meta)` helper (or Template Method: pull the method up and parameterize only the message-template string via a new `protected abstract timeoutMessage(meta): string` hook) — the duplicated `{ requestId, methodName, cause: ... }` details-object construction disappears from both files. `onMessage`'s common validate+dispatch tail can similarly move to a shared `protected dispatchIncoming(message)` in the base, with the differing guard clause (`message.from !== this.service`) passed in as a predicate hook.

**Instances**: `background/client.ts:86-98, 134-136, 138-143, 145-151, 153-155` and `offscreen/client.ts:68-85, 113-115, 117-122, 124-130, 132-134`.

---

## Finding 3: `applyNuloSchemaPatch` repeats the same install-or-validate block for each of its 3 custom RPC methods

**Smell**: Duplicate Code (Dispensables), verging on Shotgun Surgery for the next addition.

**Impact bucket**: local today (blast radius: one function in one file, 2 commits total), but the file is the single documented extension point for new Nulo-custom wallet-sdk RPCs (`packages/wallet-sdk-schema-patch/README.md`, referenced from the root `CLAUDE.md` "Custom RPC schema patch" section as *the* place to add one) — so every future custom RPC addition is a guaranteed 4th copy of this block.

**Evidence**: `applyNuloSchemaPatch` (`packages/wallet-sdk-schema-patch/src/apply.ts:51-112`) has three back-to-back blocks with an identical skeleton — `if ("<method>" in schema) { const existing = target.<method>; if (existing !== <EXPECTED_SCHEMA>) { const items = existing?.def?.input?.def?.items; if (<shape check>) { throw new Error(...) } } } else { target.<method> = <EXPECTED_SCHEMA> }`:

- `registerToken` block — `apply.ts:55-74`
- `isTokenRegistered` block — `apply.ts:76-90`
- `grantPublicAuthwit` block — `apply.ts:92-111`

Only the method name, the expected-schema constant, and the specific `items`/output shape predicate differ; the presence check, the `!==` identity short-circuit, the `.def.input.def.items` traversal, the throw-with-explanatory-message structure, and the else-branch install are repeated verbatim three times.

**Why it harms future change**: the file's own doc comment (`apply.ts:1-29`) and the root `CLAUDE.md` both frame this as *the* place a new Nulo-custom RPC gets added — meaning the next one (a documented, expected future edit, not a hypothetical) is written by copy-pasting one of these three ~20-line blocks and editing the method name, schema constant, and shape predicate. Any slip in that copy-paste (e.g. reusing `existing?.def?.output?.def?.type !== "void"` for a method that should check `"string"`) silently weakens the signature-drift guard for exactly the case it exists to catch — an upstream `@aztec/wallet-sdk` release that ships a same-named-but-differently-shaped method.

**Smallest safe refactoring**: Replace Conditional with a data table + one shared function. Extract Function `installOrValidate(schema, methodName, expectedSchema, isShapeValid: (existing) => boolean)` that does the present/absent branch + throw once; call it three times with a `{ name, expected, isShapeValid }` literal per method (or drive it off an array and a loop). The three ~20-line blocks collapse to three ~4-line declarations plus one shared ~15-line function — and a 4th custom RPC becomes a one-entry addition instead of a fourth copy-pasted block.

**Instances**: `packages/wallet-sdk-schema-patch/src/apply.ts:55-74, 76-90, 92-111`.

---

## Finding 4: `EntityStorage`'s four enumeration methods each re-derive the same root-prefix filter loop

**Smell**: Duplicate Code (Dispensables).

**Impact bucket**: structural. Blast radius: one file, but `EntityStorage` is the storage primitive nearly every persisted entity in the extension is built on (~65 call sites across `apps/extension` + `packages` reference its `getAll`/`getValues`/`getKeys`/`rawEntries` family). Change frequency: 4 commits to the file, each of which is a case study in the risk — `rawEntries` was added later as a fourth near-copy of the same loop rather than reusing `getAll`/`getValues`.

**Evidence** — all four methods on `packages/wallet-core/src/storage/entity_storage.ts` independently recompute `const path = \`${this.root}@\`` , call `await this.storage.get()` with no keys (the documented all-entries fetch), and filter+strip by `path`:

- `getAll` — `entity_storage.ts:106-116` (loop over `Object.entries(res)`, `decodeRow`, push `[key, entity]` tuples)
- `getKeys` — `entity_storage.ts:118-124` (`Object.keys(res).filter(...).map(...)`)
- `getValues` — `entity_storage.ts:126-136` — **byte-identical to `getAll` except it pushes `entity` instead of `[k.substring(path.length), entity]`**
- `rawEntries` — `entity_storage.ts:149-162` (same `path`-fetch-filter shape, with its own inline `JSON.parse` instead of `decodeRow`, per its documented raw/codec-free contract)

**Why it harms future change**: `getAll` and `getValues` are two copies of the same 10-line loop with a one-token difference in what gets pushed — any future change to the row-selection logic (e.g. tightening the prefix match to avoid a `foo@` vs `foo-bar@` collision, or adding a limit/cursor) has to be made in up to four places in this file to stay consistent, and nothing enforces that `getKeys` (implemented via `.filter/.map` on raw keys) and `getAll`/`getValues` (implemented via a manual loop with `decodeRow`) stay behaviorally aligned as the file evolves.

**Smallest safe refactoring**: Extract Function — a private `private rowsUnderRoot(res: Record<string, unknown>): Array<[string, unknown]>` (or an async generator over `this.storage.get()`) that does the `path` computation + prefix filter + key-strip once. `getAll`/`getValues` become one-line `.map` calls over it that layer in `decodeRow`; `getKeys` becomes a `.map(([k]) => k)` over the same source. `rawEntries` keeps its distinct raw-`JSON.parse` step (that divergence is deliberate per its own doc comment) but still reuses the shared prefix-filter helper for the `path`/fetch/filter part it currently duplicates.

**Instances**: `entity_storage.ts:106-116, 118-124, 126-136, 149-162`.

---

## Non-findings

- **Lock (`utils/lock.ts`) vs ReadWriteGuard (`utils/rw-guard.ts`) sharing a "force-release with debug log" skeleton** (repo-map candidate #3) — considered and downgraded from "solid finding" to non-finding. The two classes solve genuinely different concurrency problems with different data structures: `Lock` is a single-flag mutex with an array-based FIFO queue and re-arms one scalar timer on *every* `enter()`; `ReadWriteGuard` tracks live readers in a `Map<symbol, timestamp>`, has separate reader/writer `Deferred` waiter queues, and re-arms its force-release timer to the *oldest remaining* token with recursive rescheduling. Only the surface vocabulary (a `name?`/`logger?` ctor, a `MAX_*_MS` constant, an error-level "force-released" log line) is shared — extracting a common base would need to abstract two materially different waiter/token representations for ~10-15 shared lines each, which is not a net win. Real but too weak to report as a solid finding.
- **`jobs/error.ts`'s `normalizeError`/`JobError` vs `errors.ts`'s `WalletError`** (repo-map's "minor/lower-confidence" note) — both build a hostile-input-safe error envelope, but target genuinely different shapes for different trust boundaries (`JobError` for the storage-persisted job record, `WalletErrorPayload` for the RPC wire) with different serialization rules (BigInt suffix, `__error` discriminant) called out explicitly as "deliberate divergences" in `jobs/error.ts:67-69`. Not a merge candidate.
- **`background/service.ts` vs `offscreen/service.ts`** — both extend `BaseService` and implement the same abstract-method seam (`wrapResponse`/`rawSend`/`sendEvent`/`subscribe`), but the bodies are transport-specific (Port fan-out to N clients with connect/disconnect bookkeeping vs. one `sendMessage` broadcast + keepalive interval) with no duplicated logic between them — this is the base class doing its job, not residual duplication.
- **`password-secret-box.ts` vs `session-secret-box.ts`** (wallet-crypto) — both wrap a master secret, but deliberately use different KDFs for different reasons (PBKDF2 password-stretching vs. HKDF over a random token), documented explicitly at `session-secret-box.ts:11-14` as "NOT built on PasswordSecretBox/EncryptionKey" on purpose. No duplication.
- **`EncryptionKey` (wallet-crypto) vs `SessionSecretBox`'s local `deriveWrapKey`** — both do AES-GCM encrypt/decrypt with an IV, but via different key-derivation primitives (PBKDF2 vs HKDF) and different framing (`EncryptionKey` prepends a version byte; `SessionSecretBox` packs `iv||ciphertext` with AAD binding) — different wire formats, not a refactor target.
- **`wallet-sdk-schema-patch`'s three `z.function({...})` schema constants** — structurally similar `z.function` declarations but each encodes a genuinely distinct RPC signature (arity, arg types, return type); not duplication, just three necessarily-different type declarations.
- **`EntityStorage.decodeRow`'s two failure branches** (JSON-syntax-drop vs codec-validation-keep) — superficially similar `try/catch` + `console.error` shape but deliberately different recovery behavior (delete vs. keep), documented as intentional at `entity_storage.ts:46-60`. Not duplication.
- **General dead-code sweep** — no unreferenced exports found in the audited production files; the package barrels (`extension-messaging`, `wallet-core`) are intentionally empty re-export points per the repo map, and every subpath export has live call sites outside this cluster (extension/faucet/playground), which is out of this cluster's trace scope to fully verify but no in-cluster orphan surfaced.
