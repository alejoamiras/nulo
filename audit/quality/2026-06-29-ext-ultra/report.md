# Harden Report: quality

**Repo:** nulo (Aztec wallet monorepo) · `dev` @ `ea2d5a4`
**Date:** 2026-06-29
**Effort:** ultra (quality focus; typing + dedup lens)
**Run ID:** 2026-06-29-ext-ultra
**Models:** Opus 4.8 (Fable substitute) — Phase-1 maps + Phase-2 Claude clusters + Phase-4 Claude verifier; Codex xhigh — Phase-2 cross-model passes + Phase-3 coordinator + Phase-4 cross-family verifier
**Scope:** `packages/{extension, wallet-core, wallet-crypto, extension-messaging, aztec-runtime, wallet-bridge, design}` source (`src/**`, excluding `*.test.ts`, generated `tokens.ts`/auto-imports/`*.d.ts`, vendored `serialization.ts`, the BIP39 table). **Excluded:** `bridge-aztec`, `bridge-core`, `bridge-evm`, `faucet`, `landing`, `playground` (some appear as *additional instances* of an in-scope cross-package duplication — e.g. `faucet`/`playground` copies of `nulo-schema-patch`, `bridge-core` hex helpers — flagged but not independently audited).

---

## Executive summary

A whole-package quality audit of the extension and its six supporting packages, with an explicit lens on **type safety** and **wise deduplication** (the two axes the owner asked to prioritise). The codebase is functionally healthy and follows its own documented conventions well; the debt is concentrated in two places the lens predicted: **untyped/cast-heavy trust boundaries**, and **duplication that has already begun to drift**.

22 findings survived dedup + a two-model verification pass (21 confirmed, 1 adjusted, **0 refuted**; both verifiers independently converged on the same two corrections). They split cleanly:

- **The architectural core (cross-cutting, highest leverage):** the wallet has no uniform decode layer at its four trust seams — storage, RPC, dApp payloads, and backup all do `JSON.parse(...) as T` / `as unknown as` (Q-01); the RPC dispatch path is stringly-typed end-to-end so the dApp boundary isn't compiler-checked (Q-02); and the RPC/PXE method surface is hand-restated as passthroughs across ~30 files (Q-03). These are weeks-scale but they're the spine.
- **Drift already happening:** the capability flow is missing a `contractClasses` delta branch (Q-05), `JobError.kind` strings have diverged from their consumers (Q-07), and the `OperationKind` policy is split across 9 files (Q-04). These are the "change-amplification has a bug now" findings.
- **High-volume copy-paste with a clear factory target:** `token/functions/` (~1.3k LOC, Q-12), per-service CRUD/restore scaffolding across 7 services (Q-13), popup/approval-window lifecycle shells across 29+3 SFCs (Q-14), execution send-path scaffolding (Q-15).
- **Cheap, high-value wins:** route `profile/service.ts`'s 21 lock blocks through the `runExclusive` it already defines (Q-17); one artifact catalog in aztec-runtime (Q-18); a `bytesToHex`/`toBase64`/`fromBase64` (Q-09); branded secret-byte types (Q-06).

**Recommended priority order:** land the cheap wins first (Q-17, Q-18, Q-09, Q-07-extract, Q-19, Q-10-partial) to bank risk reduction in one PR; then the drift fixes (Q-04/Q-05 registries, Q-07 unions); then schedule the three architectural seams (Q-01/Q-02/Q-03) as deliberate, separately-reviewed efforts. None of these are correctness bugs — they are change-cost and type-safety improvements.

---

## Methodology

Map-reduce, per the harden protocol, with effort-scaled fan-out and honest deviations from the literal `ultra` spec (documented below because the spec was not followed verbatim).

- **Phase 1 (map):** 7 parallel per-package mapper agents (Opus) → `raw/repo-map/<pkg>.md`. Each proposed clusters + typing/dedup hotspots; ~40 clusters total.
- **Phase 2 (map/audit):** **14 Claude (Opus) area passes + 6 Codex (xhigh) package-group passes** over the ~40 clusters, plus a dedicated cross-package agent. Each agent got the shared rules (`raw/_quality-prompt.md`) + the relevant map(s). Raw → `raw/*-claude.md` (14) + `raw/codex-*.md` (6).
- **Phase 2.5 (cross-rebuttal):** **folded** into the cross-cutting agent (which source-verified cross-package claims) + the Phase-3 coordinator's disagreement resolution. No separate rebuttal/Round-2 pass was run.
- **Phase 3 (reduce):** one Codex-xhigh coordinator over all 20 raw files → `findings/consolidated.md`. Deduped by root cause (full instance lists), resolved cross-model splits, weighted by scope × blast-radius × change-frequency (6-month `git log` samples), surfaced the cross-cutting group.
- **Phase 4 (verify):** **2 bucketed verifiers** (1 Claude over all 22 + instance spot-checks; 1 Codex cross-family on the 5 single-source + 3 highest-blast findings) rather than a per-finding agent pair → `findings/verified.md` (+ `verified-claude.md`, `verified-codex.md`).
- **Phase 5 (report):** this document + a quality-adapted HTML companion.

**Deviations from literal `ultra`** (the spec's `ultra` = 4 agents/cluster + Round-2 push-back + per-finding verification): at ~40 clusters across 7 packages that is 160+ cluster agents, impractical to drive faithfully. The constants that were **kept**: cross-model (Claude + Codex) coverage on every area, the typing/dedup lens in every prompt, a Codex-xhigh cross-family coordinator, and independent two-model verification. What was **scaled down**: per-cluster agent count (1 Claude + shared Codex per area, not 2+2), the rebuttal pass (folded into coordinator), and verification granularity (bucketed, not per-finding). **Operational note:** 2 of the first 7 Phase-2 Claude agents derailed (returned 0 tool-uses echoing system text); both were relaunched with a hardened imperative-first prompt and produced normal results — no finding was lost.

**Confidence calibration:** "high" = cross-model `both` convergence AND source-verified at the cited lines. Single-source (`claude-only`) findings were re-read by the Codex verifier specifically; those that held are also "high" (Q-16/17/19). Density: 22 findings / ~40 clusters ≈ 0.55 per cluster (below the ~1.2 target — consistent with a healthy codebase + an aggressive negative list, not under-coverage; see NOT-pursued).

---

## Findings

Sorted by priority (scope × blast radius × change-frequency). `[A]`=architectural `[S]`=structural `[L]`=local `[C]`=cosmetic. Full exhaustive instance lists live in `findings/consolidated.md`; key instances shown here.

### [A] Q-01: No uniform decode layer at the storage / RPC / dApp / backup seams
**Impact:** architectural · blast radius 8 files / 30+ casts-or-unchecked-parses · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Schema/Type Drift + Stringly-Typed Boundary (typing)
**Key instances:** `wallet-core/storage/entity_storage.ts:49`, `value-storage.ts:21`; `extension-messaging/core/decode.ts:15`, `utils.ts:22,28`; `aztec-runtime/pxe/client.ts:90-93,144,191-195`; `extension/composables/useFullBackupImport.ts:165,201-214,…`; `useDappInteractionPayload.ts:16,86`.
**Description:** Every trust boundary returns `JSON.parse(...) as T` / `res as T` / `unknown`-asserted-to-a-caller-generic. aztec-runtime *proves the right pattern* (zod rehydration on 16 PXE methods) then skips it on 3.
**Why it matters:** storage migrations, RPC result changes, dApp payload changes, and backup-v3 changes all compile while stale/malformed data is treated as a trusted domain object; failures surface far from the boundary.
**Fix:** Introduce Codec / Replace Cast With Schema — storage constructors accept a parser/schema; messaging/dApp/backup decode by method/interaction kind; make PXE result validation uniform. **Effort: weeks** (do it seam-by-seam).

### [A] Q-02: RPC dispatch is stringly-typed end-to-end (the real downstream `MethodsMap` issue)
**Impact:** architectural · blast radius 6 files / 100+ dispatch casts · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Generic-That-Enforces-Nothing + Stringly-Typed Dispatch (typing)
**Key instances:** `wallet-core/base/index.ts:11`; `extension-messaging/core/base-service.ts:111,125,130`; `wallet-bridge/dispatcher.ts:275,328,…,1078-1162`; `method-scope-checkers.ts:58-190`.
**Description:** Split resolved: `MethodsMap = Record<string,(...params:any[])=>unknown>` is *locally justified* (a variance constraint that doesn't widen concrete `ServiceSpec` inference — so it is NOT itself a finding). The smell is downstream: `extension-messaging` invokes via `this as Record<string,fn>`, and `wallet-bridge` accepts `methodName: string, args: unknown[]` then hand-indexes `args[N] as ...` in builders + scope checkers.
**Why it matters:** changing/reordering an RPC's args is not compiler-checked at the **dApp trust boundary**; builder, scope-checker, and enforcement code can silently diverge.
**Fix:** an `RpcRequest` discriminated union derived from the method descriptors; narrow once at dispatch, then pass typed tuples downstream. **Effort: weeks.**

### [A] Q-03: RPC/PXE surfaces are hand-restated as passthroughs
**Impact:** architectural · blast radius 30 files / 110+ service forwards + 7 PXE surfaces · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code + Shotgun Surgery (dedup)
**Key instances:** 21 `extension/src/wallet/services/*/client.ts` (each `return this.request("m", ...args)`); the PXE method list restated 7× across `aztec-runtime/pxe/{spec,ipxe,subset,proxy,client,service}.ts`.
**Description:** clients mechanically re-implement a surface `Methods` already defines; PXE repeats its method list as `Methods`, `IPXE`, subset keys, proxy methods, client methods, service registry, and impls (validation/rehydration bodies hand-written per method too).
**Why it matters:** every new/renamed method is a multi-file edit with string-literal drift risk; PXE is the worst because bodies are per-method.
**Fix:** a typed `ServiceClient` proxy/factory derives passthroughs; one PXE descriptor table derives `IPXE` + proxy forwarding + RPC names + zod metadata. **Effort: days.**

### [A] Q-04: `OperationKind` policy + Draft/Executable models are split
**Impact:** architectural · blast radius 9 files / 25+ switches-or-casts · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Switch Statements + Parallel Type Hierarchy (mixed)
**Key instances:** `dapp-interaction/materialize.ts:44-61,76-147`, `service.ts:293-294`; `execution/service.ts:377-453`, `operation-planner.ts:105-139`, `contract-resolver.ts:85-107`; `popup/windows/execute/{types.ts:33-58,index.vue,OperationCard.vue}`.
**Description:** `Operation` is a discriminated union, but materialization uses `MaterializedOperation & Record<string,unknown>` then `as unknown as Operation` (verbatim at `service.ts:294`); the popup keeps a better `DraftOperation` duplicate. Access-level, materialization, session-validation, execution-dispatch, and UI each switch over the same kind strings.
**Why it matters:** adding an operation kind needs coordinated edits across 5 sites; a missed access-level entry silently falls back to `AccessLevel.None`.
**Fix:** Replace Conditional With Registry — a shared `OperationPolicy` table keyed by `OperationKind`, one shared `DraftOperation` + `assertExecutableOperation` at the model seam. **Effort: days.**

### [A] Q-12: Token-function ABI matchers + kinds are copy-paste catalogs
**Impact:** architectural · blast radius 12 files / ~1.3k LOC · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code + Shotgun Surgery (dedup)
**Key instances:** `extension/src/wallet/services/token/functions/{balance-of-private,balance-of-public,get-name,get-symbol,get-decimals,transfer-private,transfer-public,transfer-public-to-private,transfer-private-to-public}.ts` (+ `service.ts:322-450`, `spec.ts`, `utils.ts`). `get-name.ts ≡ get-symbol.ts` byte-for-byte modulo one token; the AztecAddress ABI struct literal is copied verbatim 12×.
**Why it matters:** an Aztec ABI predicate change or a new token capability needs synchronized edits across 9 modules + service blocks + specs + utils. The repo already models the right shape next door in `fpc/handlers/` (`IFpcHandler` + `getFpcHandler`).
**Fix:** one `TokenFnDescriptor` table with shared ABI builders, scoring, candidate predicates, pack/unpack hooks. **Effort: days.**

### [A] Q-15: Execution send-paths duplicate slot/journal scaffolding + Aztec payload normalization
**Impact:** architectural · blast radius 5 files / 10 repeated blocks · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code + Long Method (dedup)
**Key instances:** `execution/dapp-send-executor.ts:150-162,204-254,291-417,444-604`; `transfer-executor.ts:130-237`; `operation-planner.ts:166-250`; the 10-arg `recordTransaction` closure byte-identical at `dapp-send-executor.ts:230-246` & `386-402`.
**Why it matters:** the slot→journal→cancel→finally ordering is **load-bearing on the concurrency/cancel path** (the arc that just shipped hardened exactly this). A drifted copy can leak a mutex slot → wedged lane, or mis-record a tx.
**Fix:** Form Template Method — `lane.withExecutionSlot(...)` owns journal/cancel/finally; one shared `recordTransaction` builder; shared `parseAztecPayloadParts`. **Effort: days.** (Higher-than-usual care: preserve the verbatim ordering invariants.)

### [S] Q-05: Capability request flow erases the `Capability` union + mirrors enforcement
**Impact:** architectural-leaning structural · blast radius 4 files / 6 cap types × 4 policy sites · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code + Type Erasure (mixed)
**Key instances:** `wallet-bridge/capabilities.ts:16-20`; `dispatcher.ts:173-236,694-916`; `method-scope-checkers.ts:42-190`.
**Description:** `capabilities?: unknown[]` / `granted: unknown[]` / `Record<string,unknown>` force `as unknown as AccountsCapability` etc.; coverage predicates in `dispatcher.ts` hand-mirror enforcement in `method-scope-checkers.ts`. **The drift is already real: `contractClasses` is missing from the delta branches (4 of 6 types handled).**
**Fix:** parse once to `Capability[]`; a `Capability["type"]`-keyed table for `parse`/`covers`/`delta`/`merge`/`enrich`/`check`. **Effort: days.**

### [S] Q-06: Secret bytes + wire encodings are primitive-typed
**Impact:** architectural-leaning structural · blast radius 8 files · change-freq warm — **Confidence: high** — **Found by: both** — **Smell:** Primitive Obsession + Stringly-Typed (typing)
**Key instances:** `wallet-crypto/{encryption-key,password-secret-box,passkey-credential,zeroize}.ts`; propagates into `extension/.../profile/{spec.ts:22-35,250-262, service.ts, session-manager.ts}`.
**Description:** passhash, salt, master secret, ciphertext, guard, credential-id, PRF output, user-handle are all bare `ArrayBuffer`/`Uint8Array`/`Buffer`/`string` — mutually assignable. The overloaded `masterKey: string` (`spec.ts:250-262`) carries a base64 master key for password restore but a credentialId for passkey restore, in the same slot.
**Why it matters:** a backup/import/profile refactor can swap encodings or byte-roles and still type-check; errors appear only at decrypt/restore time. (This is the owner's explicit branding ask.)
**Fix:** branded types — `Passhash`, `MasterSecretBytes`, `Salt`, `Base64Ciphertext`, `Base64CredentialId`, …; split restore payloads by profile type. **Effort: days** (type-only; KDF vectors stay green).

### [S] Q-07: Error taxonomies + projection are split and stringly-typed
**Impact:** structural · blast radius 9 files · change-freq warm — **Confidence: high** — **Found by: both** — **Smell:** Stringly-Typed + Duplicate Code (mixed)
**Key instances:** `wallet-core/jobs/types.ts:73-82`, `jobs/error.ts`, `utils/errors.ts`; `extension-messaging/errors.ts:16-20,220-246`, both clients' `makeRemoteError`; `extension/utils/journal-state.ts:105,164-266`.
**Description:** `JobError.kind` is bare `string` and **already drifted** — producers emit `transfer`/`dapp_execute`/`network_unreachable` (none in the documented 9-value comment), so token-import kinds hit none of the 3 hand-maintained switches and degrade to the default "Error" label. `WalletErrorPayload.details?: unknown` forces per-code casts; `getErrorMessage` and `jobs/error.extractMessage` duplicate hostile-input handling; `makeRemoteError` byte-identical across both messaging clients.
**Fix:** `KnownJobErrorKind | (string & {})`; make `WalletErrorPayload` a code-keyed discriminated union; extract `errorMessageFromUnknown` + `remoteErrorFromResponseContent`. **Effort: days** (the extractions alone are hours — see cheapest-fixes).

### [S] Q-10: Design prop contracts bypass token unions; extension wrappers re-copy them
**Impact:** structural · blast radius 14 design components + 2 extension wrappers / 542 `color=` + 59 `variant=` call sites · change-freq warm — **Confidence: high** — **Found by: both** — **Smell:** Primitive Obsession + Shotgun Surgery (mixed)
**Key instances:** older primitives `design/src/core/{Flex,Text,Icon,MaterialIcon}.vue` + `ui/{Button,Input,Badge,Banner,Checkbox,Toggle,Popover,Tooltip}.vue` type variant/size/color as bare `string` (or `Checkbox` array-form all-`any`) while `tokens.ts` already exports `ColorToken`/`FontSize`/… unions; `Button` indexes `$style[props.variant]` unguarded; `extension/src/components/ui/{Button,SubPageHeader}.vue` re-declare+forward the base contract in untyped JS.
**Why it matters:** 600+ call sites get zero autocomplete/typo protection; wrappers silently drop new base props.
**Fix:** migrate old primitives to typed `defineProps<{}>()` over the token unions; export base prop types; wrappers extend host-only props + forward a typed `baseProps`. **Effort: days** (`Checkbox` + `ButtonVariant/Size` first — hours).

### [S] Q-11: Design severity/status color vocabulary is duplicated
**Impact:** structural · blast radius 5 files / 4 vocabularies · change-freq warm — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code + Primitive Obsession (dedup)
**Instances:** `design/src/ui/{Badge,Banner,Toast,ToastManagerBase}.vue` + `composables/toast.ts` — the same status-color idea spelled `info|warning|error|purple`, `info|done|warning|error`, `ok|error|info`, and raw `red|green|orange`.
**Fix:** a shared `SeverityTone` + token map in the design contract; renderers keep layout, share names+colors. **Effort: days.**

### [S] Q-13: Entity restore / id-allocation / ownership guards / cascades reimplemented per service
**Impact:** structural · blast radius 10 files / 60+ scaffold sites · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Boilerplate-Per-Consumer + Duplicate Code (dedup)
**Key instances:** all 7 entity services (`token`, `token-balance`, `fpc`, `network`, `account`, `auth-registry`, `contact`, `incoming-transfer`) repeat `restore()` `try/catch→toRestoreError→Restored<T>[]`, `array_max(...)+1` id allocation, `while contains getRandomHex`, profile-ownership guards (~24×), and `onProfileDeleted`/`purgeRows` cascades (6×). Two repository classes already prove the extraction.
**Fix:** shared `restoreRows<T>()` + id-allocator strategies + a `ProfileScopedRepository` base (`requireOwned`, profile-delete cascade). **Effort: days.**

### [S] Q-14: Popup + dApp approval windows duplicate lifecycle shells
**Impact:** structural · blast radius 29 popups + 3 dApp windows · change-freq hot — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code + Shotgun Surgery (dedup)
**Key instances:** `popup/windows/{execute,capabilities,discover}/index.vue` repeat interaction/profile client setup + session wait + auth redirect + beforeunload-reject + completion cleanup + processing-error UI; ~26 `*Popup.vue` repeat connect-on-show/disconnect-on-hide + Enter-key handler + error-tooltip block.
**Why it matters:** a cancellation / beforeunload / disconnect-ordering / keyboard-submit fix must be applied across many SFCs (they already drift).
**Fix:** a dApp-window shell (session/cancel/beforeunload) + a `usePopupEntity` composable + FormPopup-level submit/error handling. **Effort: days.**

### [S] Q-16: `AppServices` lies about lazily-assigned clients
**Impact:** structural · blast radius 1 type + ~43 popup reads · change-freq warm — **Confidence: high** — **Found by: claude (Codex-verifier-confirmed)** — **Smell:** Temporal Coupling + Lying Types (typing)
**Instances:** `extension/src/utils/core.ts:44-50,75-77,132-139`.
**Description:** `AppServices` declares `network`/`transaction`/`account` as required clients, but `createAppServices()` initialises them `null as unknown as Client` until unlock. The lie is self-documented in core.ts's own JSDoc.
**Fix:** type the lazy clients `Client | undefined` (or split eager/lazy) + asserted accessors at real chokepoints. **Effort: days** (mechanical but ~43 read sites).

### [S] Q-17: `profile/service.ts` defines `runExclusive` but bypasses it in 21 lock blocks
**Impact:** structural · blast radius 1 facade / 21 lock pairs · change-freq warm — **Confidence: high** — **Found by: claude (Codex-verifier-confirmed)** — **Smell:** Duplicate Code (dedup)
**Instances:** helper at `profile/service.ts:113-120`; 21 inline `lock.enter()/…/finally lock.leave()` bypasses (`143/148 … 1057/1106`). *(Corrected from "22" — the 22nd pair is `runExclusive`'s own body.)*
**Why it matters:** a lock-behaviour/telemetry/reentrancy change is a 21-site edit; one missed `finally` wedges every profile RPC.
**Fix:** route the facade lock sections through `runExclusive` (keep an outer `finally` only where zeroization needs it). **Effort: hours** — *cheapest high-value*.

### [S] Q-18: aztec-runtime duplicates artifact class-id work across loaders
**Impact:** structural · blast radius 2 files / 4 artifacts double-loaded+double-hashed · change-freq cold — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code (dedup)
**Instances:** `aztec-runtime/pxe/known-artifacts.ts:13-21,40-68` + `note-schemas.ts:3-8,66-83` both import the 4 artifacts and `getContractClassFromArtifact`-hash them under two caches.
**Why it matters:** an artifact-alias / class-id change can leave note schemas keyed differently than known-artifact resolution.
**Fix:** one catalog loader owns artifact + class-id + optional instance + note-schema metadata. **Effort: hours** — *cheapest high-value*.

### [S] Q-19: PXE factory modes + chain coordinates are primitive/repeated
**Impact:** structural · blast radius 3 files / 10 sites · change-freq cold — **Confidence: high** — **Found by: claude (Codex-verifier-confirmed)** — **Smell:** Boolean Blindness + Data Clump (mixed)
**Instances:** `aztec-runtime/pxe/chain-runtime.ts:26-40,103-117`; `service.ts:127,156-180`; `artifact-registry.ts:13-17`.
**Description:** `ProductionPxeFactoryOptions` allows illegal `required`/`proverless` boolean combos (caught only by a runtime throw); `(profileId,chainId)` is encoded both as `profileId:chainId` and `pxe/profile/chain`; `NetworkInfo` names two different shapes.
**Fix:** discriminated-union factory modes; a `ChainCoordinates` key codec; remove/rename the unused registry `NetworkInfo`. **Effort: hours** — *cheapest high-value*.

### [S] Q-08: `nulo-schema-patch.ts` triplicated across apps
**Impact:** structural · blast radius 3 files / 9 schema mutations · change-freq cold — **Confidence: moderate** — **Found by: both** — **Smell:** Duplicate Code + Untyped Boundary (mixed)
**Instances:** `extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts:47-118`; `faucet/src/lib/…`; `playground/src/lib/…` (latter two out of audit scope but part of the same dup). Bodies `diff`-confirmed identical; each uses `(WalletSchema as any)`×3.
**Why it matters:** a 4th custom RPC or an upstream schema change is a 3-copy edit; faucet/playground drift isn't caught by the extension-only reachability pin.
**Fix:** extract `applyNuloSchemaPatch(schema)` (or generate the 3 files from one source), preserving the "don't export wallet-bridge to third-party dApps" constraint. **Effort: days** (moderate — the constraint is real; this is the documented tradeoff, re-surfaced because the duplication is real maintainability debt).

### [S] Q-09: Hex/Base64 encoders duplicated and divergent
**Impact:** structural · blast radius 8 files / 15+ encoding sites · change-freq warm — **Confidence: high** — **Found by: both** — **Smell:** Duplicate Code (dedup)
**Instances:** byte→hex loops at `wallet-crypto/encryption-key.ts:114`, `wallet-core/utils/random.ts:7-9`, `bridge-core/{content-hash,recovery-crypto}.ts`, `extension/utils/full-backup-helpers.ts:19`, `extension/wallet/utils/passkey-ceremony.ts:17-23`; base64 split between `btoa`/`atob` loops and `Buffer.from(...)`. *(Verifier note: the loop body is genuinely triplicated; `getRandomHex` the function is not.)*
**Fix:** `bytesToHex` / `toBase64` / `fromBase64` in `@nulo/wallet-core/utils`. **Effort: hours** — *cheapest high-value*.

### [L] Q-20: Config store uses reflective double-casts instead of a schema
**Impact:** local · blast radius 2 files · change-freq warm — **Confidence: moderate** — **Found by: claude** — **Smell:** Reflective Access + Schema/Type Drift (typing)
**Instances:** `extension/src/wallet/config/store.ts:14,35,47-52`, `config.ts`.
**Description:** config loads as `Record<string,unknown>` and validates by `typeof src[key] === typeof dst[key]`; union literals (theme, defaultExplorer) are only checked as strings, so a corrupt/migrated out-of-union string loads as valid.
**Fix:** a zod schema as the source of `Config`/`ConfigProp` + persisted validation (matches the service graph's idiom). **Effort: hours.**

### [L] Q-21: Host-utility seam has two real drifts (not a broad adapter failure)
**Impact:** local · blast radius 4 files / 2 drifts · change-freq warm — **Confidence: moderate** — **Found by: both** — **Smell:** Schema/Type Drift + Duplicate Code (mixed)
**Instances:** `extension/src/core/adapters/chrome-browser-api.ts:136-137`; `wallet-core/ports/runtime-port.ts:52-54`; `extension/src/utils/files.ts:71-72`; `extension/src/utils/general.{js,d.ts}`.
**Description:** split resolved — the broad "Chrome adapter is unsafe" hypothesis was **falsified** (its `as unknown as` casts are localized, correct compatibility shims; popup utils may use `chrome.*`). The two real drifts: `lastError` is re-shimmed outside the port (`files.ts:72` `as any`) duplicating `RuntimePort.lastError`, and `general.js` has a hand-maintained `.d.ts` shadow.
**Fix:** reuse `RuntimePort.lastError`; migrate `general.js`→`.ts` and delete the declaration shadow. **Effort: hours.**

### [C] Q-22: Cross-package documentation drift (version, architecture, crypto constants)
**Impact:** cosmetic · blast radius ~7 docs/comments · change-freq cold — **Confidence: moderate** — **Found by: claude** — **Smell:** Comment Drift (mixed)
**Instances (corrected):** `aztec-runtime/README.md:62`, `pxe/service.ts:362`, `wallet-bridge/README.md:284`, `execution/helpers/batched-view-simulation.ts:91,355` say Aztec `4.2.0` while deps pin `5.0.0-rc.1`; `wallet-crypto/README.md:17` + `encryption-key.ts:2` say PBKDF2 250k while source is `600_000`; `extension-messaging/README.md` omits the `core/` correlator + states stale disconnect behavior. *(Removed the unverifiable "wallet-core README `types:[]`" instance — both verifiers caught it.)*
**Why it matters:** stale architecture maps + security-relevant KDF cost mislead future maintainers + audit agents.
**Fix:** one doc sweep; optionally a doc-lint pin on the PBKDF2 iteration text. **Effort: hours.**

---

## Cheapest high-value fixes (land these first — all hours-scale, no public API change)

1. **Q-17** — route `profile/service.ts`'s 21 lock blocks through the existing `runExclusive` (structural risk reduction; mind zeroization paths).
2. **Q-18** — one aztec-runtime artifact catalog (kills double class-id hashing + cache drift).
3. **Q-19** — `ProductionPxeFactoryOptions` → discriminated union (eliminates illegal mode states).
4. **Q-09** — `bytesToHex`/`toBase64`/`fromBase64` in wallet-core/utils (broad cleanup, removes byte casts).
5. **Q-07 (partial)** — extract `remoteErrorFromResponseContent` + `errorMessageFromUnknown` (deletes duplicated error projection).
6. **Q-10 (partial)** — type `Checkbox` + `ButtonVariant`/`ButtonSize` first (immediate design-contract wins ahead of the full token migration).
7. **Q-21** — `general.js`→`.ts` + centralize `lastError`.
8. **Q-20** — replace config reflection with a zod schema.

**Coupled fixes (ship together):** Q-04 + Q-05 (both are "replace kind/type switches with a keyed registry" — share the pattern). Q-06 + Q-09 (branded secret types land cleanest on top of the shared encoders). Q-10 + Q-11 (design token-union typing + shared severity vocabulary).

---

## Findings NOT pursued (dropped during reduce/verify, with reasoning)

- **`MethodsMap` base `any[]` alone** — locally justified variance constraint; the real issue is the downstream untyped dispatch (Q-02).
- **`useFormState`** — casts are encapsulated mapped-type builder mechanics; public inference is precise.
- **`useEntityCrud<T>` + settings `*-helpers.ts`** — CRUD mechanics already centralized; remainder is genuine per-entity formatting/sort logic.
- **"Chrome adapter is unsafe"** — falsified; casts are localized compat shims. Only the `lastError` dup + `general.js` shadow kept (Q-21).
- **Fee-strategy similarity** — real but parity-test-guarded + lower leverage than execution slot/payload dup (Q-15); revisit when adding a fee kind.
- **`Flex`/`Text`/`Icon` class-builder boilerplate** — incidental similarity; abstraction would be noisier than inline.
- **Two toast renderers** — intentional faucet-item vs extension-singleton split; only the shared severity vocabulary scored (Q-11).
- **`Input.vue` modelValue cast cascade** — concrete but explicitly pinned to preserve a broad model contract; lower value than the public token props.
- **`ClockPort.TimerHandle = unknown`** — small local adapter friction; insufficient blast radius.
- **Empty root barrels / dead export paths, vendored `serialization.ts`, BIP39 table, test/fake casts** — cosmetic or deliberate boundary/data choices.
- **PXE IndexedDB delete-wrapper dup + `[SYNC-DEBUG]` blocks** — real local cleanup, lower priority than the PXE method surface (Q-03/Q-19).

## Cross-cutting observations

- **The wallet trusts its own wire.** Q-01/Q-02/Q-06/Q-07 are one theme at four seams: data crossing a boundary (storage, RPC, dApp, crypto/backup) is cast to a domain type instead of *decoded* into one. The codebase already contains the antidote in two places (aztec-runtime's zod rehydration; operation-journal's hand-rolled `safeParse`) — the work is making it uniform, not inventing it. This is the single highest-leverage architectural investment.
- **"Describe the surface once."** Q-02/Q-03/Q-04/Q-05/Q-12/Q-13/Q-19 are all *one list maintained in N places* (RPC methods, PXE methods, operation kinds, capability types, token functions, entity CRUD, factory modes). The repo already demonstrates the descriptor/registry pattern (`fpc/handlers`, the two repository classes, `defineRpcMethods`); these findings are about extending it to the surfaces that still hand-restate.
- **Drift is not hypothetical here.** Three findings (Q-05 `contractClasses`, Q-07 `JobError.kind`, Q-10 wrapper props) have *already* drifted in `dev`. These are the strongest candidates because the change-amplification cost is being paid now.
- **Typing axis is `any`-clean but cast-heavy.** Several packages (wallet-crypto, token/assets, execution) have zero `any`; the debt is `as`/`as unknown as` narrowing at boundaries + primitive obsession, which a decode layer + branded types remove at the root.
