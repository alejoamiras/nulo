# QUALITY audit — `packages/wallet-core` (typing + dedup lens)

Scope: `packages/wallet-core/src/**` excluding `*.test.ts`, the bip39 static word
table (`utils/mnemonic.ts:1-2050`), and vendored code. wallet-core is the bottom
layer of the stack, so loose types here propagate to every package above; blast
radius is measured across the whole repo where the loose decl forces casts/branches
in consumers.

---

### WC-Q1 `EntityStorage<T>` / `ValueStorage<T>` return an unvalidated `T` at the persistence boundary
- Smell: Primitive Obsession (loose boundary typing) + Boilerplate-per-consumer (analog of Duplicate Code: the missing validation seam is re-implemented per consumer).
- Lens: typing (primary) + dedup (secondary)
- Maintenance impact: architectural
- Blast radius: the two storage classes + **18 instantiation sites** across `@nulo/extension` (every persisted entity type in the wallet)
- Instances:
  - Loose read casts: `packages/wallet-core/src/storage/entity_storage.ts:49` (`JSON.parse(raw as string) as T`), `packages/wallet-core/src/storage/value-storage.ts:21` (`JSON.parse(res[this.root] as string)` returned as `T`).
  - Consumers that trust the unchecked `T` (no re-validation): `auth-registry/service.ts:62-63`, `network/service.ts:177`, `token/service.ts:73`, `token-balance/balance-repository.ts:21`, `account/service.ts:41`, `wallet/config/store.ts:10`, `contact/service.ts:51-52`, `transaction/service.ts:49`, `incoming-transfer/repository.ts:35-36`, `dapp-session/service.ts:53`, `fpc/service.ts:63`, `profile/session-manager.ts:138-139`, `profile/repository.ts:44-45`.
  - The one consumer that noticed and hand-rolled a second validation layer: `operation-journal/service.ts:118-150` (`OperationRecordSchema.safeParse` with the comment "Layer 1 (`EntityStorage`) catches byte-level JSON corruption. This is layer 2: a row that *parses* as JSON but doesn't fit the schema").
- Evidence: `parseOrDelete` (`entity_storage.ts:47-60`) only guards against `JSON.parse` *syntax* failure; on success it does `return JSON.parse(...) as T` with zero shape checking. The type parameter `T` is therefore a claim the class never enforces — `EntityStorage<Account>.get()` returns a value typed `Account` that was never shape-checked. `ValueStorage.get()` is worse: `JSON.parse` returns `any`, so even the `as T` is implicit.
- Why it harms future change: a forward-incompatible shape change (renamed field, narrowed enum) silently produces structurally-wrong objects that the compiler swears are valid `T`, surfacing as `undefined`-property crashes far from the storage layer. The journal author already paid the tax by building a bespoke `safeParse` layer; any other consumer that needs the same guarantee must copy that pattern (boilerplate-per-consumer). The repo already standardizes zod at service boundaries (`operation-journal/spec.ts`), so the validation vocabulary exists — it just isn't wired into the storage seam.
- Refactoring: Introduce Parameter Object / add an optional `validate?: (raw: unknown) => T` (or `z.ZodType<T>`) to the `EntityStorage`/`ValueStorage` constructor; run it inside `parseOrDelete` so the "parses-but-wrong-shape" drop policy lives once. The journal's layer-2 collapses into the storage layer and the other 17 consumers gain opt-in shape safety at the boundary they already think they have.
- Effort: days
- Confidence: high

---

### WC-Q2 `JobError.kind: string` is stringly-typed — the known set lives only in a doc comment and has already drifted
- Smell: Stringly-Typed (analog of Primitive Obsession: a closed category modeled as bare `string`) + Shotgun Surgery (adding a kind touches the producer + 3 hand-maintained switches + the doc) + Schema/Type Drift.
- Lens: typing
- Maintenance impact: architectural
- Blast radius: type def in wallet-core + 4 producer files + 3 consumer switches (one file) + zod schema + reaper + 2 doc comments (~8 files)
- Instances:
  - Loose decl: `packages/wallet-core/src/jobs/types.ts:82` (`kind: string`); the canonical set is prose only at `jobs/types.ts:79-81` and `jobs/error.ts:38` (`kind = "unknown"`).
  - Zod gives no set-validation: `operation-journal/spec.ts:190` (`kind: z.string().min(1)`).
  - Producers emitting kinds **not** in the documented 9-value set: `transfer-executor.ts:245` (`"transfer"`), `execution-lane.ts:260` + `mark-failed-unless-cancelled.ts:35` (`"dapp_execute"`), `token/service.ts:217` via `classifyTokenImportError` returning `"network_unreachable"` / `"contract_invalid"` / `"metadata_fetch"` (`token/service.ts:568-575`).
  - Consumers that each re-enumerate the kind set by hand: `journal-state.ts:165` (`humanizeErrorKind`), `journal-state.ts:~230` (`categoricalLabel`), `journal-state.ts:~255` (`failedSubtitleFor`).
- Evidence: the documented union is `user_rejected | popup_bound | sw_restart_post_prove | stale_on_resume | stuck_proving | network | simulation | prover | unknown`. The actual emitted set adds `transfer`, `dapp_execute`, `network_unreachable`, `contract_invalid`, `metadata_fetch`, `stuck_queued` — none compiler-checked. Concrete already-shipped consequence: `classifyTokenImportError` emits `network_unreachable`/`contract_invalid`/`metadata_fetch`, but none of the three switches in `journal-state.ts` have cases for them, so every token-import failure falls through to the generic `"Error"` label. Nothing flagged this because `kind` is `string`.
- Why it harms future change: adding or renaming a category is a silent, compiler-invisible edit across one producer and three separate switch statements; miss one and the UI degrades to the default arm with no error. Exhaustiveness can never be enforced.
- Refactoring: Replace Type Code with a union — `type KnownJobErrorKind = "user_rejected" | … | "transfer" | "dapp_execute" | "stuck_queued" | "network_unreachable" | "contract_invalid" | "metadata_fetch"` and `type JobErrorKind = KnownJobErrorKind | (string & {})`. The open tail keeps the documented forward-compat ("consumers MUST tolerate unknown values") while the closed head makes the three switches type-check; tighten `JobErrorSchema.kind` to `z.union([...])` or keep `z.string()` but type the producers. Switch exhaustiveness then catches the next added kind at compile time.
- Effort: hours
- Confidence: high

---

### WC-Q3 Two divergent `unknown → string` error extractors; one carries an unsound double-cast
- Smell: Duplicate Code (two overlapping extraction implementations) + Stringly-Typed/unsound cast.
- Lens: dedup (primary) + typing (secondary)
- Maintenance impact: structural
- Blast radius: `getErrorMessage`/`getErrorData` have **141 call sites** repo-wide; `extractMessage` is the job-failure path
- Instances:
  - `packages/wallet-core/src/utils/errors.ts:1` (`getErrorData`), `:3` (`getErrorMessage`).
  - `packages/wallet-core/src/jobs/error.ts:53-59` (`extractMessage`).
- Evidence: both turn an `unknown` thrown value into a human string. They diverge in soundness and behavior:
  - `errors.ts:3`: `(error as Error)?.message ?? (error as string) ?? "Unknown error"` — the `as string` is unsound (a non-Error, non-string value, e.g. a number, is returned typed as `string`); the final `?? "Unknown error"` only saves `null`/`undefined`.
  - `error.ts:53-59`: explicitly branches `instanceof Error` / `string` / `null` / `undefined` / `String(raw)` — sound, but a second hand-rolled copy of the same intent.
  The package already demonstrates the right consolidation pattern: `baseErrorJson` (`utils/error-json.ts:18`) is the shared hub for the two JSON Error replacers (`serialization.ts:39`, `jobs/error.ts:77`). The message extractor has no such hub.
- Why it harms future change: a fix to error-message extraction (e.g. unwrap `AggregateError`, read `cause`) must be made twice, and the two will keep drifting (they already differ on the non-Error fallback). The unsound `as string` is a latent typing hole at 141 call sites.
- Refactoring: Extract one `extractErrorMessage(unknown): string` helper (the sound `error.ts` version), have `getErrorMessage` and `jobs/error.ts:extractMessage` both delegate; drop the `as string` cast. `getErrorData` keeps only the `.stack ??` projection on top.
- Effort: hours
- Confidence: high

---

### WC-Q4 `ClockPort.TimerHandle = unknown` forces every adapter to re-narrow the handle
- Smell: Primitive Obsession (opaque `unknown` for a domain handle) — pushes a cast onto each implementor.
- Lens: typing
- Maintenance impact: local
- Blast radius: the port + 3 adapter/consumer files
- Instances:
  - Decl: `packages/wallet-core/src/ports/clock-port.ts:8` (`export type TimerHandle = unknown`).
  - Forced casts: `testing/mock-clock.ts:51` + `:61` (`handle as number`), `extension/src/core/adapters/system-clock.ts:22` + `:30` (`handle as Parameters<typeof globalThis.clearTimeout>[0]`), `extension/src/wallet/services/window-manager/window-manager.ts:74` (`handle as Handle<unknown>`).
- Evidence: because the handle type erases to `unknown`, `clearTimeout`/`clearInterval` can't accept it without a cast; every implementor independently re-narrows to its own concrete handle type. Three implementations, three different casts.
- Why it harms future change: each new `ClockPort` adapter must re-discover that it needs to cast, and the casts are unchecked — passing a `MockClock` handle to `SystemClock.clearTimeout` would type-check and fail at runtime. A genuinely-opaque branded handle would keep adapters from confusing each other's handles.
- Refactoring: Make `ClockPort` generic in its handle (`ClockPort<H = unknown>`) or use a branded opaque type (`type TimerHandle = { readonly __brand: unique symbol }`) that each adapter mints, so the cast happens once at the mint site instead of at every `clear*` call.
- Effort: hours
- Confidence: moderate

---

### WC-Q5 Duplicated force-release literal `5 * 60_000`
- Smell: Duplicate Code (magic-number duplication of a documented invariant pair).
- Lens: dedup
- Maintenance impact: local
- Blast radius: 2 production constants (+ 3 test copies)
- Instances: `packages/wallet-core/src/utils/lock.ts:4` (`MAX_HOLD_MS`), `packages/wallet-core/src/utils/rw-guard.ts:6` (`MAX_READER_DRAIN_MS`). Test copies that also hard-code the literal: `lock.test.ts:70`, `lock.test.ts:135`, `rw-guard.test.ts:379`.
- Evidence: the README pins `Lock.MAX_HOLD_MS` ≡ `ReadWriteGuard.MAX_READER_DRAIN_MS` as an intentional invariant pair, but they are two independent literals plus three more hand-copied into tests. `rw-guard.ts:3-5` even documents the mirroring in prose ("Mirrors `Lock.MAX_HOLD_MS`") rather than sharing the value.
- Why it harms future change: changing the deadlock window means editing 2 production sites that the type system can't tell are related, plus re-syncing the 3 test literals — a silent-drift surface for a safety constant.
- Refactoring: Extract a shared `FORCE_RELEASE_MS` constant in `utils/` imported by both primitives (and the tests). The "they must be equal" README invariant becomes structurally true.
- Effort: hours
- Confidence: high

---

### WC-Q6 Dead empty root barrel `src/index.ts`
- Smell: Dead Code (Speculative Generality — an export path nothing consumes).
- Lens: other
- Maintenance impact: cosmetic
- Blast radius: 1 file
- Instances: `packages/wallet-core/src/index.ts:15` (`export {}`).
- Evidence: repo-wide grep for `from "@nulo/wallet-core"` (no subpath) returns zero importers; all consumers use the `/utils`, `/ports`, `/jobs`, etc. subpaths. The doc comment is accurate about intent but the file is a no-op.
- Why it harms future change: negligible — minor noise / a tripwire for someone who tries to add to it. Either keep as the documented "use subpaths" signpost or delete; not worth churn beyond a one-line decision.
- Refactoring: Remove Dead Code, or leave with the existing comment. Trivial.
- Effort: hours
- Confidence: high

---

## Out-of-focus notes (verified non-issues / watch items — not scored)

- **`MethodsMap = Record<string, (...params: any[]) => unknown>` (`base/index.ts:11`) is the package's one public `any`, and it is correctly justified.** I verified it does NOT widen consumer inference: `MethodsSpec<T>` (`base/index.ts:13-15`) maps each method to `(...params: Parameters<T[M]>) => Promise<ReturnType<T[M]>>`, so concrete `ServiceSpec`s preserve their own precise param types; the `any[]` is only the *constraint* the concrete signatures must satisfy (variance), consumed contravariantly by `BaseService`/`BaseServiceClient` in `@nulo/extension-messaging`. The biome-ignore reason is accurate. No change recommended.
- **`MinimalStorageArea` (`entity_storage.ts:12`) vs `StorageArea` (`storage-port.ts:18`) is a structural near-dup at the storage boundary**, but it is internal-only (grep finds no use outside `storage/`) and cannot be a clean `Pick<StorageArea, …>` because `MinimalStorageArea.get` omits the `| null` overload `StorageArea.get` carries. Low value; leaving it documented here for completeness rather than scoring it.
- **Vendored `utils/serialization.ts` (copy of `@aztec/foundation/json-rpc`, see `:25` comment) is an upstream-drift watch item**, not a quality smell — keeping core Aztec-free is the deliberate, correct tradeoff. The genuinely-shared subset is already factored out via `baseErrorJson`.
- **Correctness (out of focus, flagging per rules):** `getEntropy` (`mnemonic.ts:2103`) validates `mnemonic.length % 3` but `getMnemonic` validates `entropy.length % 4`; standard bip39 entropy is multiples of 4 bytes (16/20/24/28/32). Not a typing/dedup issue — noting only so the correctness focus can confirm the round-trip invariant.

## Summary
6 findings (2 high / 2 moderate / 2 low). Highest value: **WC-Q2** — `JobError.kind: string` is stringly-typed and has already drifted (producers emit `transfer`/`dapp_execute`/token-import kinds absent from the documented set, and token-import kinds silently miss all three consumer switches); closely followed by **WC-Q1**, the unvalidated `as T` storage read path that 18 consumers trust and exactly one re-validates by hand.
