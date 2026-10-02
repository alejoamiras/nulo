# q10-pkg-low — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`, the supplied `_outer.md` and `packages-low.md` maps, `jscpd-production.md`, and both prior audit reports.
- `packages/wallet-core/src/{activity,base,jobs,migration,storage}/`; utilities for locking, queues, events, encoding, randomness, serialization, errors, alarms, deferred promises, and mnemonic conversion. The vendored mnemonic wordlist was excluded.
- `packages/wallet-crypto/src/`: credential boxes, derivation functions, domain separators, encoding call sites, and zeroization; relevant crypto and encoding tests.
- `packages/extension-messaging/src/core/`, background/offscreen clients and services, error reconstruction, message types, parameter wrapping, and Zod helpers.
- Targeted consumer ranges in `apps/extension/src/{popup/auth-guard.ts,stores/balances.store.ts,components/Header.vue,components/JsonViewer/LogsViewer.vue,composables/importPreflight.ts,composables/importChainSync.ts,wallet/utils/offscreen.ts,wallet/services/activity-protocol/coordinator.ts,wallet/services/profile/spec.ts}`.
- Targeted handoffs in `packages/aztec-runtime/src/pxe/{client,service,opfs-store}.ts` and extension consumers of previously extracted locks and alarm dispatchers.

Inspected `dev` at `910a4def`. No files modified. History counts below are **all commits / commits since 2026-06-01**, using the current paths without `--follow`; they measure file churn, not changes specifically to the cited function.

## q10-pkg-low-X-1: Eight consumers independently implement promise deadlines

**Title:** Repeated promise-deadline lifecycle across packages and UI.

**Smell name:** Duplicate Code — Fowler. Different error and fallback policies surround the same mechanism: race an existing operation against a timer, forward settlement, and manage the timer’s lifetime.

**Maintenance impact:** **Structural; confidence: high.** Eight files across the extension, messaging, and Aztec runtime. File histories are listed alongside the evidence.

**Concrete evidence:** These sites independently implement the same promise-versus-deadline mechanism:

| Location | Caller-specific policy | Commits |
|---|---|---:|
| `packages/extension-messaging/src/core/base-client.ts:284-301` | Reject with the request’s typed timeout error | 8 / 8 |
| `apps/extension/src/popup/auth-guard.ts:83-89` | Reject when profile lookup exhausts its budget | 3 / 3 |
| `apps/extension/src/stores/balances.store.ts:124-137` | Reject with a labeled balance-read error | 6 / 6 |
| `apps/extension/src/components/Header.vue:34-43` | Resolve `{ answered: false }` on expiry | 7 / 7 |
| `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-199` | Reject, then retry with a smaller batch | 4 / 4 |
| `apps/extension/src/composables/importPreflight.ts:39-47` | Resolve a timeout discriminant | 1 / 1 |
| `apps/extension/src/composables/importChainSync.ts:111-116` | Resolve `undefined` on expiry | 2 / 2 |
| `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135,168-170` | Reject with `ChainStoreOpenTimeoutError` | 4 / 4 |

The implementations already differ in timer ownership: messaging/auth/Header/OPFS clear the timer in `finally`; balances clears it in both settlement handlers; LogsViewer and the two import races leave the losing timer scheduled.

**Why it harms future change:** Reviewing or changing timeout cleanup requires inspecting eight independent implementations. The existing exported `withTimeout` lives inside a Pinia store, so lower packages cannot reuse it without violating dependency direction. This encourages each subsequent caller to reproduce the mechanism.

**Smallest safe refactoring:** **Extract Function / Parameterize Function** into `packages/wallet-core/src/utils/`, accepting the operation, relative budget, and timeout callback. The callback preserves each caller’s existing rejection or fallback value. Keep absolute-deadline arithmetic, retry policy, and OPFS’s abandoned-worker quarantine at their current sites. Preserve the original operation’s late-settlement observation.

**What disappears:** Eight timer-race implementations become one shared implementation and eight calls; seven duplicate settlement/cleanup mechanisms disappear. OPFS quarantine and domain-specific retry branches remain.

**Instances:** `packages/extension-messaging/src/core/base-client.ts:284`; `apps/extension/src/popup/auth-guard.ts:83`; `apps/extension/src/stores/balances.store.ts:124`; `apps/extension/src/components/Header.vue:34`; `apps/extension/src/components/JsonViewer/LogsViewer.vue:189`; `apps/extension/src/composables/importPreflight.ts:41`; `apps/extension/src/composables/importChainSync.ts:115`; `packages/aztec-runtime/src/pxe/opfs-store.ts:124`.

## q10-pkg-low-X-2: Three crypto modules independently encode the same versioned frame

**Title:** Versioned AES-GCM envelope framing is triplicated.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Structural; confidence: high.** Three crypto modules independently maintain a persisted binary layout. Histories: `encryption-key.ts` **7 / 6**, `imported-account-key-box.ts` **2 / 2**, `imported-keys-dek-box.ts` **1 / 1**.

**Concrete evidence:** All three construct and parse `version(1 byte) || IV(12 bytes) || ciphertext`:

- `packages/wallet-crypto/src/encryption-key.ts:52-56,68-77`: allocates `13 + ciphertext.length`, writes version `0`, and slices at offsets `1` and `13`.
- `packages/wallet-crypto/src/imported-account-key-box.ts:48-54,65-71`: repeats the layout with version `1`, base64 encoding, and its own envelope validation.
- `packages/wallet-crypto/src/imported-keys-dek-box.ts:41-49,55-62`: repeats version `1`, the same offsets, allocation, and validation.

`nonce-uniqueness.test.ts:26-27` already recognizes these three as one frame family. Their key derivations, AAD requirements, error messages, and plaintext validation are distinct.

**Why it harms future change:** A framing or decoder-maintenance change must be applied and reviewed three times. Each implementation independently embeds the same offset contract, so extracting cryptographic policy is unnecessary to eliminate this maintenance cost.

**Smallest safe refactoring:** **Extract Function / Parameterize Function** into an internal `packages/wallet-crypto/src/versioned-frame.ts`: shared packing and validated splitting, parameterized by version and preserving caller-specific errors. Keep key derivation, AES operations, AAD, and buffer ownership in the existing modules. Verify byte compatibility with existing frames and retain the nonce tests.

**What disappears:** Three allocation/write sequences and three header/slicing implementations collapse into one packing function and one parsing function. No credential classes or public APIs need merging.

**Instances:** `packages/wallet-crypto/src/encryption-key.ts:52,68`; `packages/wallet-crypto/src/imported-account-key-box.ts:48,65`; `packages/wallet-crypto/src/imported-keys-dek-box.ts:41,55`.

## q10-pkg-low-X-3: Credential derivations duplicate master reduction and scratch cleanup

**Title:** Mnemonic and passkey derivations repeat the same reduction-and-wipe operation.

**Smell name:** Duplicate Code — Fowler.

**Maintenance impact:** **Local; confidence: high.** Two production functions in two crypto modules. Histories: `mnemonic-master.ts` **1 / 1**; `passkey-credential.ts` **6 / 5**.

**Concrete evidence:** Both implementations copy 64 derived bytes into a `Buffer`, reduce through `Fr.fromBufferReduce`, return a branded fresh master buffer, and wipe both scratch buffers in `finally`:

- `packages/wallet-crypto/src/mnemonic-master.ts:50-61`.
- `packages/wallet-crypto/src/passkey-credential.ts:85-99`.

The passkey implementation explicitly refers to the mnemonic implementation’s `seed64Copy` pattern. The preceding PBKDF2 and HKDF operations differ; the post-derivation operation does not.

**Why it harms future change:** Changes to the Aztec buffer adapter or scratch-buffer ownership must be duplicated across both credential paths. The shared `zeroize` function centralizes how to erase a buffer, but neither which buffers the reduction creates nor when they become disposable.

**Smallest safe refactoring:** **Extract Function** into an internal `packages/wallet-crypto/src/master-reduction.ts`, with an explicit ownership contract: consume and wipe the supplied derived bytes, wipe the temporary `Buffer`, and return caller-owned `MasterSecretBytes`. Each credential path retains its existing KDF and passes its result to this helper. Preserve output bytes and runtime buffer type.

**What disappears:** Two copies of the Buffer conversion, field reduction, branding, and two-buffer `finally` block become one implementation and two calls.

**Instances:** `packages/wallet-crypto/src/mnemonic-master.ts:52`; `packages/wallet-crypto/src/passkey-credential.ts:88`.

## q10-pkg-low-X-4: Incarnation nonce generators bypass the existing random-hex utility

**Title:** Two incarnation generators reimplement `getRandomHex(32)`.

**Smell name:** Duplicate Code — Fowler; incomplete adoption of an existing shared function.

**Maintenance impact:** **Local; confidence: high.** Two extension consumers plus the existing core utility. Histories: coordinator **3 / 3**, profile spec **11 / 11**, `random.ts` **5 / 4**.

**Concrete evidence:** Each path generates 16 cryptographically random bytes and returns exactly 32 lowercase, zero-padded hexadecimal characters:

- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:48-53`, `mintNonce`.
- `apps/extension/src/wallet/services/profile/spec.ts:104-108`, `mintPxeGeneration`.
- Existing implementation: `packages/wallet-core/src/utils/random.ts:9-14`, called with `32`, delegates encoding to `encoding.ts:10-14`.

The coordinator uses spread/map/join; the profile spec uses `Array.from`. These are semantic copies despite their different syntax.

**Why it harms future change:** The random-byte and hex-format contract has three implementation sites. A runtime compatibility fix or encoding correction in the shared utility does not reach either incarnation generator.

**Smallest safe refactoring:** **Substitute Algorithm / Replace Function Body**: retain the domain names and replace both bodies with `getRandomHex(32)` imported from `@nulo/wallet-core/utils`. No new abstraction is needed.

**What disappears:** Two random-byte allocation/fill implementations and two hand-written hexadecimal conversion pipelines.

**Instances:** `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:49`; `apps/extension/src/wallet/services/profile/spec.ts:105`; `packages/wallet-core/src/utils/random.ts:9`.

## Non-findings considered

- **Prior 2026-08-14 Q-01, Q-05, Q-07, Q-14:** `Lock.withLock`, the exhaustive passthrough installer, shared transport-error construction, and base-owned error prototype setup now exist. The earlier findings are not repeated.
- **Prior 2026-08-16 Q-03, Q-05, Q-06, Q-08:** the event primitive has an optional error reporter; `AlarmDispatcher` and `KeyedLock` are adopted by the inspected consumers; terminal status now lives in messaging `core/`.
- **Lock versus ReadWriteGuard watchdogs:** the current implementations enforce different ownership and expiry policies: one acquisition ticket versus individually aged reader tokens. Shared timer syntax does not justify merging them.
- **SessionSecretBox versus versioned crypto frames:** the session bearer stores its version outside the binary payload and packs `IV || ciphertext`; its pair-validation and null-return contract also differ. It is excluded from X-2.
- **PBKDF2/HKDF/domain-label repetition:** these operations intentionally define distinct cryptographic domains. X-3 extracts only the identical reduction and buffer-ownership tail.
- **Blanket replacement of Buffer base64 decoding:** `fromBase64` uses strict `atob` semantics; Buffer decoding accepts inputs that it rejects. A mechanical substitution would change behavior.
- **PXE base64 conversions:** both sides were opened and overlap with core encoding helpers, but these short conversion expressions alone have less maintenance impact than the numbered findings.
- **Offscreen creation’s promise race:** it coordinates creation, readiness messages, timeout fencing, and document teardown. It is excluded from the ordinary deadline extraction.
- **EntityStorage, ValueStorage, and migration staging:** malformed-row behavior differs deliberately—hide-and-retain, throw, and staged fail-closed reads. Their similar storage syntax is insufficient for a common implementation.
- **Serialization versus job-error normalization:** the shared Error projection is already extracted; bigint representation and job discriminants intentionally differ.
- **Accepted complexity directives, service/client/spec separation, storage facades, and framework registration:** no findings based solely on these conventions. No dead-code claim is made.
- **Token-clone report:** no rows explicitly identify the three assigned package paths. The findings above come from source inspection and semantic comparison.

## Incidental bugs noticed (for the bugs run)

- `packages/wallet-core/src/utils/event-handler.ts:40-48` — register listeners A then B; A removes itself during `invoke()`. Splicing the live callback array shifts B into the already-visited index, so B never receives that event. An in-memory reproduction against the actual class returned `["first"]` instead of `["first","second"]`. **Confidence: high.**

## Cross-rebuttal (codex on claude)

**Overconfident / wrong in Claude’s findings**

- **q10-pkg-low-C-1 — Partially agree (high confidence).** The parallel union/switch creates maintenance cost, but “9 hand-written round-trips” understates coverage: `packages/extension-messaging/src/errors.test.ts:245-253` already loops over 16 classes. Testing only the proposed registry’s entries cannot detect a class omitted from that registry. Registration must also distinguish intentionally client-local errors (`errors.ts:77-81`) from wire errors. The existing `TooManyPendingError` omission is explicitly pinned at `errors.test.ts:256-266`.

- **q10-pkg-low-C-2 — Partially agree (high confidence).** The nonce mints and encoding expressions duplicate existing helpers, but decoder replacement is not behavior-preserving merely because exceptions are caught: strict `fromBase64` (`packages/wallet-core/src/utils/encoding.ts:29-38`) can reject strings previously accepted by Buffer. The claimed removal of `wallet-crypto/globals.d.ts` is incorrect: `passkey-credential.ts:54,88` and `mnemonic-master.ts:52` still require Buffer independently of these codecs. Narrow the finding to compatible substitutions; treat decoder-policy changes separately.

- **q10-pkg-low-C-3 — Agree with narrower scope (high confidence).** The three versioned framing implementations are duplicates, matching X-2. Their output bytes and validation errors are not identical: `packages/wallet-crypto/src/encryption-key.ts:68-77` expects version zero and distinguishes length from format errors. SessionSecretBox’s unversioned payload should remain outside this extraction. The churn characterization is also wrong: `session-secret-box.ts` changed on 2026-09-15 after its July creation.

- **q10-pkg-low-C-4 — Partially agree (high confidence).** The deadline extraction is justified, but the late-rejection argument overstates the divergence: `Promise.race` already attaches rejection handlers to its input promises; the extra `request.catch` at `apps/extension/src/popup/auth-guard.ts:84` is unnecessary for observing that race’s loser. Timer cleanup is the concrete difference. The report also enumerates seven deadline sites despite calling them six.

**What Claude missed that I found**

- **q10-pkg-low-X-3 — Duplicate Code (high confidence):** `packages/wallet-crypto/src/mnemonic-master.ts:52-60` and `passkey-credential.ts:88-98` repeat Buffer conversion, field reduction, result branding, and two-buffer cleanup. Claude’s justified separation of KDF domains does not rebut extracting this identical post-derivation operation.
- **q10-pkg-low-X-1 — Additional instance (high confidence):** `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135,168-170` contains another ordinary deadline race. Only that mechanism belongs in the helper; its abandoned-worker quarantine at `:137-157` must remain local.

**What BOTH of us missed**

No additional quality finding established in this light pass.