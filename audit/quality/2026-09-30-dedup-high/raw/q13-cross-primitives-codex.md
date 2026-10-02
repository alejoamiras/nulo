# q13-cross-primitives — codex

Scope read:

- `CLAUDE.md`, `implementations-plan/lessons.md`; `_outer.md` and relevant excerpts of `extension-shared-ui.md` and `extension-wallet.md` under `audit/quality/2026-09-30-dedup-high/raw/repo-map/`.
- `audit/quality/2026-09-30-dedup-high/raw/jscpd-production.md`; both specified prior audit reports.
- Selected source in `packages/wallet-core/src/{utils,storage,logger,ports}`, including encoding, random, serialization, locks, queues, storage implementations, and codec tests.
- Selected source in `packages/wallet-crypto/src/`, especially session/password secret boxes, encryption, and fingerprinting.
- `packages/aztec-runtime/src/account/account-export.ts`; relevant portions of `src/pxe/{client,service,opfs-store,note-schemas,async-memo}.ts`.
- Relevant portions of `packages/extension-messaging/src/{errors,zod-helpers,core/base-client,background/client,offscreen/client}.ts`.
- Relevant portions of `packages/wallet-bridge/src/{dispatcher,method-descriptors,method-scope-checkers,discovery-queue,field-address}.ts`.
- `packages/legal/src/status.ts`; `packages/design/src/internal/sanitize.ts` and its tests.
- Extension deadline and activation helpers, their immediate UI consumers, byte-encoding call sites, record guards, storage facades, logger/redaction implementation, utility files, execution mutex, balance queue, session integrity, and operation fingerprinting.

Reviewed `dev` at `910a4def`. Repository-wide production searches covered candidates A–M. History counts below are **all history / since 2026-06-01**, using `git log --format=%h -- <path>`; these measure file churn, not changes exclusively to the cited function. No files were modified.

## q13-cross-primitives-X-1: Promise deadlines have eight independent implementations

**Title:** Promise deadlines have eight independent implementations.

**Smell name:** **Duplicate Code — Fowler.** Confidence: **high**.

**Maintenance impact:** **Structural** — eight production modules across the extension, aztec-runtime, and extension-messaging. Individual files have **1–8 commits** since June; counts appear below.

**Concrete evidence:** Each instance bounds an existing promise with a timer, settles from whichever finishes first, and decides independently how to handle the timer and late operation completion.

The copies already differ in their mechanical cleanup:

- `balances.store.ts:124-138` clears its timer in both promise settlement handlers.
- `auth-guard.ts:83-90`, `Header.vue:34-44`, and the two package implementations clear it through `finally`.
- `LogsViewer.vue:189-200` never retains the timer handle.
- `importPreflight.ts:41-47` and `importChainSync.ts:111-117` race against a sleeper that cannot be cancelled when the operation finishes.

Their **outcomes legitimately differ**: typed errors, plain errors, and resolved fallback values. Those policies do not require separate timer implementations.

**Why it harms future change:** A deadline-cleanup fix or test for “operation succeeds before expiry,” “operation rejects after expiry,” or “timeout preserves the caller’s error type” must currently be implemented or checked eight times. The balance-store helper cannot serve package callers from its current location without reversing the dependency direction.

**Smallest safe refactoring:** **Extract Function / Parameterize Function** into `packages/wallet-core/src/utils/timeout.ts`, exported through `@nulo/wallet-core/utils`. Share only promise observation, timer ownership, and settlement; allow callers to supply their existing timeout error or fallback outcome.

Keep absolute-budget calculations, retries, and domain cleanup at their current call sites. In particular, OPFS quarantine and late-store closure must remain in `opfs-store.ts`; the helper must not imply cancellation of the underlying operation.

**What disappears:** Eight independently maintained deadline adapters become calls to one primitive. Their local timer declarations, timeout-promise construction, and duplicated cleanup handlers disappear; retries and domain-specific branches remain.

**Instances:**

| Location | Responsibility | Commits |
|---|---|---:|
| `apps/extension/src/stores/balances.store.ts:124-138` | Labeled rejecting deadline | 6 / 6 |
| `apps/extension/src/popup/auth-guard.ts:83-90` | Profile-lookup deadline | 3 / 3 |
| `apps/extension/src/components/Header.vue:34-44` | Lock-read fallback deadline | 7 / 7 |
| `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200` | Log-fetch deadline before smaller-batch retry | 4 / 4 |
| `apps/extension/src/composables/importPreflight.ts:41-47` | Connectivity-probe deadline | 1 / 1 |
| `apps/extension/src/composables/importChainSync.ts:111-117` | Registration deadline | 2 / 2 |
| `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135` and `:168-170` | Store-open deadline and timer cleanup | 4 / 4 |
| `packages/extension-messaging/src/core/base-client.ts:291-301` | Transport-readiness deadline | 8 / 8 |

## q13-cross-primitives-X-2: Canonical byte encoders remain bypassed at sixteen sites

**Title:** Canonical byte encoders remain bypassed at sixteen sites.

**Smell name:** **Duplicate Code — Fowler**, specifically incomplete adoption of an existing shared primitive. Confidence: **high** for equivalence of the listed operations; **moderate** for maintenance priority.

**Maintenance impact:** **Structural** — ten caller files across three workspaces, plus existing wallet-core helpers. Churn ranges from **1 to 25 commits since June** among the callers.

**Concrete evidence:** The listed sites independently convert byte sequences to standard padded base64 or lowercase zero-padded hex, or decode base64 using `atob`, despite equivalent exported helpers in `packages/wallet-core/src/utils/encoding.ts:10-39`.

Two sites duplicate a larger operation: drawing 16 random bytes and rendering 32 hex characters. `getRandomHex(32)` already implements that contract in `packages/wallet-core/src/utils/random.ts:9-15`.

This is partial adoption within individual modules:

- `passkey-ceremony.ts` uses shared base64 helpers but separately encodes its user handle as hex.
- `account-export.ts` imports shared base64 helpers but separately encodes its checksum as hex.
- `SessionSecretBox.wrapPair` creates and wipes an additional Buffer solely to encode its token, although the shared encoder accepts the original byte view.

The existing encoding tests cover Buffer parity, high bytes, large inputs, and the distinction between a logical view and its whole backing buffer.

**Why it harms future change:** Completing the existing Buffer-independent encoding work requires inspecting ten modules for byte-view semantics and temporary-buffer ownership. Fixes or compatibility checks added to the canonical encoders do not cover these bypasses. The nonce functions also retain separate implementations of a contract wallet-core already owns.

**Smallest safe refactoring:** **Substitute Algorithm / Replace Inline Code with Function Call** using the existing `bytesToHex`, `toBase64`, `fromBase64`, and `getRandomHex` exports from `@nulo/wallet-core/utils`, the lowest package every listed caller may import.

Preserve logical-view versus whole-buffer semantics explicitly. For the two random-generation functions, retain their domain names if useful, delegating to `getRandomHex(32)`.

This finding **does not propose mechanically replacing Buffer-based base64 decoders**: `fromBase64` uses stricter malformed-input semantics. Those require a separate compatibility decision.

**What disappears:** Two manual random-byte-to-hex implementations, the PXE pair’s manual base64 encoding/decoding, and the remaining codec-specific Buffer conversions. `wrapPair` can additionally remove its encoding-only `tokenCopy` and associated inner `finally`. Most single-line conversions remain single-line helper calls; this is chiefly removal of independently maintained implementations.

**Instances:** Sixteen bypass sites are grouped below; the three consecutive profile fields and three session fields each count separately.

| Locations | Shared replacement | Commits |
|---|---|---:|
| `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:49-53` | `getRandomHex(32)` | 3 / 3 |
| `apps/extension/src/wallet/services/profile/spec.ts:105-108` | `getRandomHex(32)` | 11 / 11 |
| `apps/extension/src/wallet/utils/passkey-ceremony.ts:139` | `bytesToHex` | 4 / 4 |
| `packages/aztec-runtime/src/account/account-export.ts:80` | `bytesToHex` for the digest result | 4 / 4 |
| `packages/wallet-crypto/src/wallet-fingerprint.ts:36-37` | `bytesToHex` | 1 / 1 |
| `apps/extension/src/popup/pages/settings/security/export/full.vue:348` | `toBase64` | 17 / 17 |
| `apps/extension/src/wallet/services/profile/service.ts:1718`, `apps/extension/src/wallet/services/profile/service.ts:1876-1878`, `apps/extension/src/wallet/services/profile/service.ts:2063` | `toBase64` — five sites | 25 / 25 |
| `packages/wallet-crypto/src/session-secret-box.ts:91-102` | `toBase64` — fields at lines 96, 97, 98 | 3 / 3 |
| `packages/aztec-runtime/src/pxe/client.ts:208` | `toBase64` | 13 / 12 |
| `packages/aztec-runtime/src/pxe/service.ts:817` | `fromBase64` | 26 / 25 |

Existing shared owners: `packages/wallet-core/src/utils/encoding.ts:10`, `packages/wallet-core/src/utils/encoding.ts:21`, `packages/wallet-core/src/utils/encoding.ts:34` (**1 / 1**); `packages/wallet-core/src/utils/random.ts:9` (**5 / 4**).

## q13-cross-primitives-X-3: Profile activation waiters duplicate their watcher lifecycle

**Title:** Profile activation waiters duplicate their watcher lifecycle.

**Smell name:** **Duplicate Code — Fowler**, with **Extract Composable** as the Vue-specific refactoring. Confidence: **high** for duplication; **moderate** for priority.

**Maintenance impact:** **Local** — two helper modules, each with **1 / 1 commits**. Their immediate consumers are the authentication and import pages. Lower priority than the broader findings above.

**Concrete evidence:** Both helpers:

1. Resolve immediately when `isLogined` and the expected profile ID match.
2. Otherwise create a timer and watch the same readiness fields.
3. Repeat the readiness predicate inside the watcher.
4. Stop the watcher on timeout, or clear the timer and stop the watcher on success.

`awaitProfileActivation` adds a legitimate bootstrap-failure signal and typed errors. Its comment correctly rejects composing two independent live watchers with `Promise.race`; that does not require duplicating the common watcher lifecycle.

Production consumers are `apps/extension/src/popup/pages/auth.vue:164` and `apps/extension/src/popup/pages/import.vue:69-75`.

**Why it harms future change:** Changing what constitutes completed activation, or fixing watcher settlement/cleanup, requires parallel edits to the unlock and import helpers. The shared readiness contract is currently maintained by matching two implementations.

**Smallest safe refactoring:** **Extract Composable / Parameterize Function** into `apps/extension/src/composables/internal/profile-activation-wait.ts`, as a C0 helper receiving reactive getters. Share the readiness predicate and single watcher/timer lifecycle; parameterize the timeout error and optional profile-specific failure result.

Keep both public wrappers and their existing policies: unlock observes bootstrap failure immediately; import retains its timeout-driven recovery behavior. This Vue-dependent helper belongs in the extension’s composable layer, not wallet-core.

**What disappears:** One duplicated watcher/timer implementation and the second implementation of the readiness predicate. Distinct errors and recovery policies remain.

**Instances:**

- `apps/extension/src/composables/unlockWait.ts:33-61`.
- `apps/extension/src/composables/waitForProfileActive.ts:30-47`.

## Non-findings considered

- **E — Record guards:** Enumerated the array-rejecting helpers in `usePinnedTokens.ts:24`, `scan-episodes.ts:32`, wallet-bridge’s `dispatcher.ts:307`, `method-scope-checkers.ts:395`, and `method-descriptors.ts:115`, plus `fee-send-selection.ts:14-15`. These are tiny language-level predicates; no concrete coordinated policy change justified a separate finding. The permissive capability-display guards and legal’s prototype-checking `isPlainObject` have different contracts.
- **F — Error subclasses:** Extending `Error` outside `WalletError` is not itself duplicated wire-error machinery. Local timeout, cancellation, capacity, and file-size sentinels have distinct consumers. No finding merely for their separate class definitions.
- **G — Locks and queues:** `BalanceJobQueue` already delegates collection mechanics to wallet-core `Queue`. `ExecutionMutex` adds abortable admission and per-origin capacity accounting; `DiscoveryQueue` handles discovery expiry, coalescing, and badge state. They are not interchangeable queue implementations. `coalesce` implements bounded debounce, not single-flight.
- **G — Watchdogs:** `Lock` expires one ownership ticket; `ReadWriteGuard` expires individually aged reader tokens and reschedules for surviving readers. Their common timer syntax does not establish one duplicated release policy.
- **H — Canonicalization:** Session MACs use recursively sorted JSON; account exports use a frozen ordered field-pair array; operation fingerprints use a typed, length-prefixed encoding; wallet-core serialization projects runtime types. Consolidating these formats would change their contracts.
- **I — Storage:** The migration-aware UI facade, storage re-export barrel, injected storage primitives, and MAC-verifying decorator provide distinct behavior. No duplicated storage engine established. Test-build storage gates were excluded.
- **J — Logging/redaction:** Key-name redaction resides in the extension logger; interfaces reside in wallet-core, and transport forwarding delegates to the logger. No second production redaction-key policy found. The accepted recursive walker complexity is not a finding.
- **K — Validation:** `zod-helpers.ts` provides boundary parsing, not reusable address/field definitions. The inspected runtime schemas reuse upstream `AztecAddress.schema` and `Fr.schema`. `isValidHex`, modulus-bounded field-address validation, and `canonicalSlotHex` perform different jobs.
- **D/L — Small utilities:** Sleep expressions, independent retry schedules, decimal ordinals, and countdown padding do not establish a shared change-prone policy. `debounce` and bounded `coalesce` have different contracts.
- **M — Design assets:** Tokens are a re-export, not an independently maintained token definition. Mirrored font binaries fall under the supplied generated/vendored-asset exclusion.
- **C — Offscreen creation:** `offscreen.ts:313-347` joins document creation with a READY-message gate and lifecycle cleanup; it is not another plain promise-deadline adapter.
- **B — Decoder compatibility:** Buffer-based decoders in profile/account/session/password/MAC paths were inspected but excluded from the mechanical codec refactoring because `atob` rejects inputs Buffer accepts. The SVG-string `btoa` call and upstream-compatible Buffer serialization branches are also outside the byte-view substitution finding.
- **Prior fixes:** The earlier missing `Lock.withLock`, keyed serialization, PXE async memoization, alarm dispatch, transport-error shaping, and `WalletError` constructor consolidation now have shared implementations. They are not re-reported.
- **Prior sanitizer finding:** **2026-08-16 Q-12 is fixed as recommended** by `apps/extension/src/utils/sanitize-parity.test.ts`, which imports both implementations and compares shared fixtures. No recurring finding.

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/utils/console-sniffer.ts:12-18` — An early `console.warn("early warning")`, emitted before forwarding hooks exist, is buffered without its method. After hooks are installed, a `console.info("ready")` flushes that warning through the **info** hook. An isolated in-memory execution of the source reproduced both records as `info`; the original log level is lost. Confidence: **high**.

## Cross-rebuttal (codex on claude)

**1. Overconfident / wrong in Claude’s findings**

Source conclusions below have **high confidence**; refactoring priority is a judgment call.

- **q13-cross-primitives-C-1 — Partially.** Encoder reuse is warranted, but decoder replacement changes accepted inputs, not merely where errors occur (`packages/wallet-core/src/utils/encoding.ts:30-35`). Also, `apps/extension/src/wallet/utils/passkey-ceremony.ts:24-26` adapts `BufferSource`, preserving offsets and lengths; it is not a same-shape alias that can simply disappear.
- **q13-cross-primitives-C-2 — Partially.** The seven serialization sites are real duplication that my first pass missed. Preserve their caller-facing rejection policies. The suggested `KeyedLock` replacement also loses idle-entry eviction: compare `apps/extension/src/composables/usePinnedTokens.ts:95-98` with `packages/wallet-core/src/utils/keyed-lock.ts:49-70`.
- **q13-cross-primitives-C-3 — Agree on duplication; disagree with the bug framing.** `Promise.race` observes its losing promise’s rejection, including at `apps/extension/src/components/JsonViewer/LogsViewer.vue:195`; extra `.catch()` is not required for that purpose. Uncleared timers survive until their finite expiry, rather than constituting demonstrated permanent leaks.
- **q13-cross-primitives-C-4 — Disagree as an eligible finding.** The supplied scope explicitly excludes both font directories at `audit/quality/2026-09-30-dedup-high/raw/repo-map/_outer.md:75-77`. Moreover, `apps/extension/scripts/store-art.ts:14` reads the design copy, contradicting the claim that store-art and the build read different copies.
- **q13-cross-primitives-C-5 — Partially.** The predicates repeat, but “drift” is unproven: permissive storage decoding is explicitly documented at `apps/extension/src/wallet/services/dapp-session/spec.ts:71-74` and `apps/extension/src/wallet/services/transaction/spec.ts:170-173`. Two precisely named helpers could consolidate mechanics; differing acceptance rules alone do not establish a maintenance defect.
- **q13-cross-primitives-C-6 — Partially.** The nonce functions and outbound hex conversions duplicate existing helpers. However, `apps/extension/src/wallet/utils/passkey-ceremony.ts:139` **encodes** hex; only line 41 decodes it. A new `hexToBytes` helper is not supported by multiple decoder instances. Merge the confirmed sites with C-1’s incomplete-codec-adoption root cause.
- **q13-cross-primitives-C-7 — Disagree as framed.** Uppercase pins are **not dropped**: `apps/extension/src/composables/usePinnedTokens.ts:38-39` lowercases before validation. The proposed family also mixes transaction hashes (`apps/extension/src/popup/pages/send-submit.ts:10-11`), modulus-bounded addresses, variable-length fields, and configurable-length validation. No common change obligation is demonstrated.

**2. What Claude missed that I found**

- **q13-cross-primitives-X-2:** One additional confirmed codec bypass: `packages/wallet-crypto/src/wallet-fingerprint.ts:36-37` hex-encodes a digest through Buffer instead of `bytesToHex`.
- **q13-cross-primitives-X-3:** `apps/extension/src/composables/unlockWait.ts:33-61` and `apps/extension/src/composables/waitForProfileActive.ts:30-47` duplicate activation readiness and watcher/timer settlement. Their distinct failure policies should remain parameters or wrappers around shared lifecycle mechanics.
- **Incidental bug, unnumbered:** `apps/extension/src/utils/console-sniffer.ts:12-18` buffers arguments without their original log level. I reproduced an early warning being replayed through the next **info** hook; this is a concrete wrong-result counter-example.

**3. What BOTH of us missed**

No additional findings established during this light pass.