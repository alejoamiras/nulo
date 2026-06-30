# Cross-cutting QUALITY findings (typing + dedup spanning ≥2 packages)

`/harden quality` (ultra) — Phase-2 cross-package cluster. Scope: smells whose blast
radius crosses a package boundary in the chain
`wallet-core → wallet-crypto → extension-messaging → aztec-runtime → wallet-bridge → extension`
(plus the `design`, `faucet`, `playground`, `bridge-core` siblings where a shared
type/helper leaks). Per-package-local smells are deferred to the per-cluster agents.
All line refs verified against source on branch `dev-quality`.

8 findings. Ranked by maintenance impact (architectural → cosmetic).

---

### XC1 "Trust-the-wire" typing — unvalidated `JSON.parse(...) as T` at every cross-process boundary
- Smell: Stringly/loosely-typed boundary + Schema/Type Drift (analog: "Trust-the-wire" — a typed lie at a serialization seam where the declared `T` is asserted, never checked).
- Lens: typing
- Maintenance impact: architectural
- Blast radius: 3 packages (wallet-core storage, extension-messaging RPC decode, aztec-runtime PXE rehydration) — the read path for **all** persisted state AND **all** cross-process RPC results in the wallet.
- Instances:
  - **Storage boundary (wallet-core):** `packages/wallet-core/src/storage/entity_storage.ts:49` `return JSON.parse(raw as string) as T` — every persisted entity row read back as an unchecked cast; `parseOrDelete` guards only `JSON.parse` *syntax*, not *shape*. `packages/wallet-core/src/storage/value-storage.ts:21` `return JSON.parse(res[this.root] as string)` — same, no validation at all.
  - **RPC decode boundary (extension-messaging):** `packages/extension-messaging/src/core/decode.ts:15` `(JSON.parse(result) as T)` (success-path fallback decode, wired by both transport clients via `base-client`). `packages/extension-messaging/src/utils.ts:28` `return res as T` (`unwrapParams` — the positional-tuple type asserted, never checked).
  - **PXE rehydration boundary (aztec-runtime) — INCONSISTENT:** `packages/aztec-runtime/src/pxe/client.ts` validates results with `<Schema>.parseAsync(result)` on ~16 methods (the disciplined pattern) BUT skips it on three: `:92` `getNoteSchemas` → `(result ?? {}) as Record<string, Record<string, NoteSchema>>`; `:144` `getNotes` → `(await z.array(NoteDaoSchema).parseAsync(result)) as unknown as NoteDao[]` (double-cast laundering POJOs to class instances); `:194` `getBlockTimestamp` → `Number(result)`.
- Evidence: The storage wrappers and the RPC decode both declare a generic `<T>` and hand it back from a raw `JSON.parse` with zero runtime validation. aztec-runtime proves the *correct* pattern exists (per-method zod `parseAsync`) but applies it unevenly — the two SW-only PXE methods (`getNoteSchemas`/`getBlockTimestamp`) and `getNotes` bypass the discipline every sibling method follows.
- Why it harms future change: A forward-incompatible storage shape or a wire-format change silently produces a structurally-wrong `T` that type-checks everywhere downstream; the failure surfaces far from the boundary as an "impossible" undefined-property access deep in a service. The aztec-runtime inconsistency means a reviewer can't trust "the client validates results" as an invariant — they must check each method. No single seam owns "parse + validate", so hardening it is a shotgun edit.
- Refactoring: Introduce Parameter Object / Replace-cast-with-schema — give `EntityStorage<T>`/`ValueStorage<T>` an optional `schema?: ZodType<T>` (or a `codec`) so the storage seam validates on read, mirroring the zod discipline aztec-runtime already uses on the RPC seam; finish the aztec-runtime rehydration so all 21 methods validate uniformly. Collapses three independent "trust the wire" policies into one validated-codec contract.
- Effort: days
- Confidence: high

---

### XC2 `MethodsMap`'s `any[]` propagates loose RPC typing through dispatch into the dApp boundary
- Smell: Speculative Generality / generic-that-enforces-nothing (`Record<string, (...:any[])=>unknown>`) → forces Stringly-Typed dispatch downstream.
- Lens: typing
- Maintenance impact: architectural
- Blast radius: 3 packages — the root type in `wallet-core/base` is inherited by every generic in `extension-messaging` (43 consumers of `./background`) and re-manifested as `args: unknown[]` in `wallet-bridge`'s dispatcher (the dApp trust boundary).
- Instances:
  - **Root (wallet-core):** `packages/wallet-core/src/base/index.ts:11` `export type MethodsMap = Record<string, (...params: any[]) => unknown>` (the sole `any` in the public surface; biome-ignored, variance-justified). `:14` `MethodsSpec` keys off `Parameters<T[M]>` — compile-time fiction once on the wire.
  - **Dispatch core (extension-messaging):** `packages/extension-messaging/src/core/base-service.ts:111` `params as unknown[]`; `:124-125` `invoke` = `(this as unknown as Record<string, (...args: unknown[]) => unknown>)[method](...params)` — the central RPC invoke is fully untyped.
  - **dApp boundary (wallet-bridge):** `packages/wallet-bridge/src/dispatcher.ts:275` `dispatch(methodName: string, args: unknown[], ...)`; the wire→Operation builders `:1078` `buildNetworkOperation(kind, args: unknown[], ...)` and `:1127` `buildAccountOperation(...)` hand-index `args[N] as SomeOp["field"]` per branch (~33 casts in `dispatcher.ts`, incl. `as unknown as` at `:731,:740,:748,:754,:758,:881,:1146`).
- Evidence: One deliberate `any[]` escape hatch at the base means the type system enforces nothing about RPC params anywhere up the chain. extension-messaging is honest about it (runtime safety = the `rpcMethods` Set + integer/shape guards, not types); wallet-bridge re-derives the same untyped positional contract independently as `args: unknown[]` + a wall of field casts.
- Why it harms future change: Adding or reordering a method's params is a silent, type-unchecked change at three layers — the compiler can't catch a `args[0]`/`args[1]` transposition in `buildAccountOperation`, and the dApp-facing boundary (highest trust gradient) is exactly where this looseness lands. Each new RPC method repeats the hand-indexed-cast ritual.
- Refactoring: Introduce a per-method `RpcRequest` discriminated union (`{ method: "x"; args: [A, B] } | …`) derived from the `Methods` type, so `buildOperation` becomes an exhaustive switch and most `args[N] as T` casts collapse. The base `MethodsMap` `any[]` can stay (it's the constraint escape hatch) as long as the *call sites* narrow through the DU instead of re-casting.
- Effort: weeks (touches the dispatcher's whole handler cascade)
- Confidence: high

---

### XC3 `ServiceClient` passthrough boilerplate — 21 near-identical subclasses restating their `Methods` type
- Smell: Duplicate Code / Boilerplate-per-consumer (Middle Man — each method body is a pure `return this.request("name", ...args)` forward).
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 packages — base in `extension-messaging`, 21 subclasses in `extension`.
- Instances: Base `ServiceClient` in `packages/extension-messaging/src/core/base-client.ts` (+ `background/client.ts`, `offscreen/client.ts`). The 21 subclasses (all `extends ServiceClient<Methods, Events> implements ServiceSpec<Methods, Events>`): `packages/extension/src/wallet/services/{account,account-state,auth-registry,config,contact,dapp-interaction,dapp-session,execution,fpc,incoming-transfer,log-viewer,logger,network,note,operation-journal,passkey,profile,task,token,token-balance,transaction}/client.ts`. Representative: `contact/client.ts` has 8 methods, each `foo(...a): Promise<T> { return this.request("foo", ...a) }` — mechanically restating the `Methods` tuple the class already `implements`.
- Evidence: Every client method is a one-line forward to `this.request(<sameName>, ...args)`. The `implements ServiceSpec<Methods, Events>` clause already binds the class to the exact signature set; the bodies add nothing but a string literal that must match the method name. EventHandler field declarations (`onContactAdded = new EventHandler<…>()`) are the only non-mechanical part.
- Why it harms future change: Adding/renaming one RPC method = edit `spec.ts` + `service.ts` + the passthrough in `client.ts`, three times the surface, with the `this.request("name")` string as an un-typo-checked third source of truth. Hundreds of LOC across 21 files exist only to satisfy a shape the type system already knows.
- Refactoring: Replace the hand-written passthroughs with a typed proxy/`createClient<Methods, Events>(spec)` factory on the base (a `Proxy` whose `get` returns `(...a) => this.request(prop, ...a)`, typed via `ServiceSpec`), keeping the explicit EventHandler fields where event typing needs them. Erases the per-method bodies while preserving the `defineRpcMethods` fail-closed surface.
- Effort: days
- Confidence: high

---

### XC4 PXE method shape declared 5× in aztec-runtime + a 6th `Pick` seam in the extension
- Smell: Duplicate Code / Shotgun Surgery (one RPC change ripples to 5 declarations + the subset pin + the extension seam).
- Lens: dedup + typing
- Maintenance impact: structural
- Blast radius: 2 packages — `aztec-runtime/pxe` (5 internal declarations + subset pin) and `extension/wallet/services/pxe` (the `ShallowPxe` `Pick` seam).
- Instances: The same ~21 methods are declared in `packages/aztec-runtime/src/pxe/spec.ts` (`Methods` type, 21 entries `:32-80`), `packages/aztec-runtime/src/pxe/ipxe.ts` (`IPXE` interface, 18-method network-curried subset), `packages/aztec-runtime/src/pxe/proxy.ts` (`PXEProxy` body), `packages/aztec-runtime/src/pxe/client.ts` (`PxeServiceClientBase` body + per-method zod, `:76-201`), `packages/aztec-runtime/src/pxe/service.ts` (`PxeService` body + per-method zod). `packages/aztec-runtime/src/pxe/subset.ts` pins only the `IPXE ≡ subset ⊂ Methods` boundary via compile-time asserts and explicitly concedes full mapped-type derivation is "a larger step." 6th touch point: `packages/extension/src/wallet/services/pxe/shallow-port.ts:24` `ShallowPxe = Pick<IPXE, "getContractInstance" | "getContractArtifact" | "getContracts" | "registerContract">`.
- Evidence: `spec.ts:32-80` and `client.ts:76-201` enumerate the identical method list with identical signatures; `ipxe.ts`/`proxy.ts` restate the network-curried form; `service.ts` restates the host form. The extension's `shallow-port.ts` then re-derives a 4-method slice via `Pick`. Adding one RPC = edit 5 aztec-runtime files + update the `subset.ts` allowlist (the extension `Pick` is at least drift-guarded by typecheck).
- Why it harms future change: The single biggest maintainability surface in aztec-runtime — a new PXE method or a signature tweak is a 5-file shotgun edit with the per-method zod schemas as a parallel hand-maintained source of truth on top.
- Refactoring: Derive `IPXE`/`PXEProxy` from `Methods` via a mapped type (strip the `network` param, promisify); table-drive or generate the per-method zod rehydration map keyed off `Methods`. The `Pick`-based extension seam is the correct idiom and should stay. Collapses 5 declarations to 1 + derivations.
- Effort: days
- Confidence: high

---

### XC5 `nulo-schema-patch.ts` triplicated byte-for-byte across three apps
- Smell: Duplicate Code (cross-package; bodies byte-identical, only JSDoc headers differ) + untyped boundary (`as any`).
- Lens: dedup + typing
- Maintenance impact: structural
- Blast radius: 3 packages (`extension`, `faucet`, `playground`) + a cross-package pin test in `wallet-bridge`.
- Instances: `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts` (119 LOC), `packages/faucet/src/lib/nulo-schema-patch.ts`, `packages/playground/src/lib/nulo-schema-patch.ts`. `diff` confirms the executable bodies are identical — the only deltas are the header comment (extension carries the full rationale; faucet/playground point back to it). Each uses `(WalletSchema as any)` ×3 to mutate the SDK schema. Cross-package coupling: pinned by the reachability assertion in `packages/wallet-bridge/src/dispatcher.test.ts`, which imports the **extension's** copy to detect drift.
- Evidence: Three identical side-effect modules add `registerToken`/`isTokenRegistered`/`grantPublicAuthwit` to `@aztec/wallet-sdk`'s `WalletSchema`. CLAUDE.md documents the triplication as intentional (sharing via `wallet-bridge` was rejected to avoid widening its public contract to third-party dApp consumers). The drift cost is real and acknowledged: adding a 4th custom RPC = edit 3 files + the pin test.
- Why it harms future change: A new Nulo-custom RPC, or an upstream zod-shape change at the SDK boundary, must be hand-mirrored across three copies; the pin test catches drift only between the extension copy and wallet-bridge's expectation, not faucet/playground drift. The `as any` triple-cast is the package's densest untyped-boundary spot.
- Refactoring: Extract a shared *typed* `applyNuloSchemaPatch(schema)` helper (even if it lives in a tiny leaf consumed by all three, keeping the mutation logic in one place and typing the `WalletSchema` mutation) so the three call sites shrink to a one-line import + invoke. Kills both the drift surface and the `as any`. (Note: this revisits the documented "no shared module" decision — flag as a trade-off, not a free win.)
- Effort: hours (extension+wallet-bridge in scope; faucet/playground are separate apps and out of this audit's primary scope but share the same module).
- Confidence: high

---

### XC6 Hex-encoding loop triplicated across three packages (resolves the mapper disagreement)
- Smell: Duplicate Code (the inline `byte → 2-char hex` loop, hand-rolled 3×).
- Lens: dedup
- Maintenance impact: local
- Blast radius: 3 packages (`wallet-crypto`, `wallet-core`, `bridge-core`).
- Instances: `packages/wallet-crypto/src/encryption-key.ts:114` `[...hashArray].map((b) => b.toString(16).padStart(2, "0")).join("")` (in `getHashHex`); `packages/wallet-core/src/utils/random.ts:9` `for (const b of bytes) hex += b.toString(16).padStart(2, "0")` (in `getRandomHex`); `packages/bridge-core/src/content-hash.ts:43` `for (const b of digest) hex += b.toString(16).padStart(2, "0")`. Related BigInt variant: `bridge-core/src/content-hash.ts:30` `n.toString(16).padStart(64, "0")`.
- Evidence: **Resolving the cross-map disagreement** — wallet-core's map claimed "no dup" because it grepped for duplicate *function definitions* of `getRandomHex` (correctly: that function is single-sourced, ~15 importers). wallet-crypto's map claimed "triplicated" because it grepped the *loop body*. Both are right about different things: the `getRandomHex` **function** is not duplicated, but the byte-to-hex **loop body** is hand-rolled three times across these three packages. `bridge-core` already depends on `wallet-crypto` (it imports `EncryptionKey` in `recovery-crypto.ts:55`) and transitively on `wallet-core/utils`, so a shared helper is reachable.
- Why it harms future change: Trivial-but-real — three independent copies of a primitive that should be one. A correctness fix (e.g. handling a non-byte input) must be applied thrice; drift is silent.
- Refactoring: Extract one `bytesToHex(bytes)` into `@nulo/wallet-core/utils` (already a dep of all three) and call it from `getHashHex`, `getRandomHex`, and `content-hash`. Extract-Function across packages.
- Effort: hours
- Confidence: high

---

### XC7 Stringly-typed error `kind` (wallet-core `JobError`) parallels the typed `WalletError` codes — and has already drifted
- Smell: Primitive Obsession / Stringly-Typed (a domain category modeled as bare `string`) + Divergent Change (two independent error-category vocabularies for overlapping concepts across packages).
- Lens: typing
- Maintenance impact: structural
- Blast radius: 3 packages — `JobError` defined in `wallet-core`, `kind` strings produced/consumed in `extension`, conceptually parallel to `WalletError` codes in `extension-messaging` (and the raw `normalizeError(_, kind)` plumbing also lives in wallet-core).
- Instances:
  - **Definition:** `packages/wallet-core/src/jobs/types.ts:82` `kind: string` — the documented category set (`user_rejected | popup_bound | sw_restart_post_prove | stale_on_resume | stuck_proving | network | simulation | prover | unknown`) lives only in the `:74-81` doc comment. `packages/wallet-core/src/jobs/error.ts:38` `normalizeError(raw, kind = "unknown")` — `kind` is a free `string` param.
  - **Producers (extension) — already off-vocabulary:** `execution/execution-lane.ts:260` `normalizeError(err, "dapp_execute")`, `execution/transfer-executor.ts:245` `normalizeError(error, "transfer")`, `execution/mark-failed-unless-cancelled.ts:35` `normalizeError(error, "dapp_execute")`. These pass **operation kinds** (`dapp_execute`/`transfer`), NOT any of the documented **error categories**.
  - **Consumer (extension):** `utils/journal-state.ts:105` `if (stage === "cancelled" || op.error?.kind === "user_rejected")` — branches on `"user_rejected"`, a value the producers above never emit.
  - **Parallel typed vocabulary (extension-messaging):** `errors.ts` models the *same conceptual space* (user rejected, cancelled, network…) as typed `WalletError` subclass `CODE` constants (`USER_REJECTED`, `JOB_CANCELLED`, …) reconstructed via the `walletErrorFromPayload` `switch` `:221`. No `KnownJobErrorKind` type exists anywhere (grep: 0 hits).
- Evidence: The same error-category concept is modeled twice across packages — once as a *typed* discriminated registry (`WalletError` codes, exhaustively switched) and once as a *bare string* (`JobError.kind`). The string side has already silently drifted: the doc says one set, producers emit a different set, and the consumer checks for a third value that the traced producers never write.
- Why it harms future change: The producer/consumer/doc mismatch is the textbook cost of a stringly-typed field — `journal-state.ts:105`'s `"user_rejected"` branch's reachability can't be verified by the compiler, and resume/retry policy keying off `kind` is built on values no one guarantees. Adding a category is uncoordinated across three sites.
- Refactoring: Replace bare `string` with an open discriminated union `type JobErrorKind = "user_rejected" | "stuck_proving" | … | (string & {})` in `wallet-core/jobs/types.ts`, type `normalizeError`'s param to it, and reconcile the producer call sites (they're currently passing the wrong vocabulary). Consider deriving the known set from, or aligning it with, the `WalletError` code constants so the two error taxonomies stop diverging.
- Effort: days
- Confidence: high

---

### XC8 Cross-package documentation drift — stale aztec version, wrong PBKDF2 iterations, stale file-maps
- Smell: Schema/Type Drift analog applied to docs (Comment Drift) — committed docs misstate the code they describe; one cross-cutting doc-quality finding.
- Lens: other (doc quality)
- Maintenance impact: cosmetic (but security-adjacent: one drifted value is a crypto constant)
- Blast radius: 5 packages' READMEs/comments vs source (`aztec-runtime`, `wallet-bridge`, `wallet-crypto`, `extension-messaging`, `wallet-core`).
- Instances:
  - **Aztec version (actual pin is `5.0.0-rc.1` everywhere):** `packages/aztec-runtime/README.md:62` "Every `@aztec/*` dep is at the same version (currently `4.2.0`)"; `packages/aztec-runtime/src/pxe/service.ts:362` comment cites `@aztec/pxe@4.2.0`; `packages/wallet-bridge/README.md:284` "pin `@aztec/wallet-sdk` version exactly (`4.2.0` today)". (Related stale inline upstream-source refs in extension: `execution/helpers/batched-view-simulation.ts:91,355` cite `@aztec/pxe@4.2.0`/`@aztec/constants@4.2.0`.)
  - **PBKDF2 iterations:** `packages/wallet-crypto/README.md:17` says "PBKDF2 (SHA-256, **250k** iterations)"; source `packages/wallet-crypto/src/encryption-key.ts:2` is `PBKDF2_ITERATIONS = 600_000`. A security-critical constant misstated 2.4× low.
  - **Stale file-maps:** `packages/extension-messaging/README.md:17-24` lists `background/service.ts`, `background/client.ts`, `zod-helpers.ts` but has **0 mentions** of the entire `core/` subdir (`base-client`, `base-service`, `rpc-methods`, `decode`, `initialization` — the extracted shared correlator); the README also still claims the offscreen client "rejects with raw strings" (no longer true — it emits typed `WalletError`s). `packages/wallet-core` README claims `"types": []` while `tsconfig.json:11` is `"types": ["node"]`.
  - **Stale code comment:** `packages/wallet-crypto/src/password-secret-box.test.ts:132` references a non-existent `spec.ts` ("drive-by change to spec.ts" — the GUARD lives in `password-secret-box.ts`).
- Evidence: Multiple committed docs across the chain contradict their own source. The aztec-version drift recurs in 3+ packages (a single upstream bump that updated `package.json` but not the prose); the PBKDF2 drift is the dangerous one — a future reader auditing the KDF cost reads `250k` and is wrong about the wallet's actual security parameter.
- Why it harms future change: Docs are the first thing the next contributor (or a future Claude session) reads; drifted docs actively mislead. The PBKDF2 case could cause a real security misjudgement; the stale extension-messaging file-map hides the package's actual architecture (the shared `core/` correlator).
- Refactoring: One sweep — fix the version strings to `5.0.0-rc.1`, the PBKDF2 line to `600k`, regenerate the two stale file-maps, drop the dead `spec.ts` comment. Cheap. Optionally add a CI doc-lint pinning the PBKDF2 README number to the source constant so a future bump can't re-drift the security-critical value.
- Effort: hours
- Confidence: high

---

## Out-of-focus notes (correctness/security-adjacent — flagged, not scored as quality)

- **XC7 may hide a latent correctness bug** (not just a typing smell): the traced `normalizeError` producers emit `"dapp_execute"`/`"transfer"`, while `journal-state.ts:105` gates a "user-cancelled" UI/state path on `error.kind === "user_rejected"`. If user cancellation does NOT flow through a `normalizeError(_, "user_rejected")` call somewhere I didn't trace (e.g. it goes via `JobCancelledSentinel` → `JobCancelledError` and a separate `stage === "cancelled"` write instead), that `error.kind` branch may be dead. Worth a correctness-focus confirmation that some producer actually writes `kind: "user_rejected"`.
- **XC1 aztec-runtime `getNotes` double-cast** (`client.ts:144` `as unknown as NoteDao[]`) is documented as safe (consumers only read data props, never class methods) — but it is a standing trap: the first consumer to call a `NoteDao` *method* on a rehydrated POJO gets a runtime `undefined is not a function`. Boundary correctness item, not pure quality.

## Summary
8 confirmed cross-package smells (3 architectural, 3 structural, 1 local, 1 cosmetic). Highest-value: **XC1 "trust-the-wire" unvalidated `JSON.parse(...) as T`** spanning the storage seam (wallet-core), the RPC decode seam (extension-messaging), and the unevenly-validated PXE rehydration seam (aztec-runtime) — the read path for all persisted + all cross-process data, with the correct zod-validation pattern already proven in aztec-runtime but applied nowhere uniformly.
