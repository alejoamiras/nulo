### Q1 Storage Reads Return Unvalidated `T`
- Smell: Schema/Type Drift
- Lens: typing
- Maintenance impact: architectural
- Blast radius: 2 shared storage modules; all `EntityStorage<T>` / `ValueStorage<T>` consumers
- Instances: `packages/wallet-core/src/storage/entity_storage.ts:47`, `packages/wallet-core/src/storage/entity_storage.ts:49`, `packages/wallet-core/src/storage/value-storage.ts:18`, `packages/wallet-core/src/storage/value-storage.ts:21`
- Evidence: `MinimalStorageArea` returns `Record<string, unknown>`, but reads do `JSON.parse(raw as string) as T` / `JSON.parse(res[this.root] as string)`. `parseOrDelete` catches syntax errors only; it does not validate shape.
- Why it harms future change: persisted schema changes can compile while stale/forward-incompatible records are returned as trusted wallet domain objects, pushing failures into unrelated services.
- Refactoring: Encapsulate Downcast + Introduce Schema/Parser Strategy → require a parser per storage root, or provide `EntityStorage<TParsed>` from validated codecs.
- Effort: days
- Confidence: high

### Q2 `JobError.kind` Is A Stringly Taxonomy
- Smell: Primitive Obsession / Stringly-Typed
- Lens: typing
- Maintenance impact: structural
- Blast radius: job FSM, journal schema, execution classifiers, activity UI
- Instances: `packages/wallet-core/src/jobs/types.ts:75`, `packages/wallet-core/src/jobs/types.ts:82`, `packages/wallet-core/src/jobs/error.ts:38`, `packages/wallet-core/src/jobs/error.ts:41`; downstream drift evidence at `packages/extension/src/wallet/services/operation-journal/spec.ts:189`, `packages/extension/src/wallet/services/operation-journal/spec.ts:190`, `packages/extension/src/wallet/services/operation-journal/reaper.ts:184`, `packages/extension/src/wallet/services/token/service.ts:568`, `packages/extension/src/utils/journal-state.ts:164`, `packages/extension/src/utils/journal-state.ts:224`
- Evidence: core documents a fixed-ish category set in comments, but exports `kind: string`; consumers validate with `z.string()` and switch on raw strings. Live emitters already include values outside the core comment, e.g. `stuck_queued`, `transfer`, `dapp_execute`, token-import categories.
- Why it harms future change: adding/renaming a job error kind requires manual updates across classifiers, schemas, and UI copy with no exhaustiveness help.
- Refactoring: Replace Primitive With Typed Value → `KnownJobErrorKind | (string & {})`, backed by a shared const list/schema and helper classifiers.
- Effort: hours
- Confidence: high

### Q3 RPC Wire Types Drift Into Loose Shadow Types
- Smell: Schema/Type Drift
- Lens: typing
- Maintenance impact: architectural
- Blast radius: `wallet-core/base` plus extension-messaging core, transports, errors, zod helpers
- Instances: `packages/wallet-core/src/base/index.ts:10`, `packages/wallet-core/src/base/index.ts:11`, `packages/extension-messaging/src/core/base-client.ts:67`, `packages/extension-messaging/src/core/base-client.ts:71`, `packages/extension-messaging/src/core/base-client.ts:117`, `packages/extension-messaging/src/core/base-client.ts:205`, `packages/extension-messaging/src/core/base-service.ts:13`, `packages/extension-messaging/src/core/base-service.ts:16`, `packages/extension-messaging/src/core/base-service.ts:111`, `packages/extension-messaging/src/core/base-service.ts:125`, `packages/extension-messaging/src/core/base-service.ts:130`, `packages/extension-messaging/src/utils.ts:22`, `packages/extension-messaging/src/utils.ts:28`, `packages/extension-messaging/src/errors.ts:16`, `packages/extension-messaging/src/errors.ts:20`, `packages/extension-messaging/src/errors.ts:229`, `packages/extension-messaging/src/errors.ts:234`, `packages/extension-messaging/src/zod-helpers.ts:38`, `packages/extension-messaging/src/zod-helpers.ts:54`, `packages/extension-messaging/src/background/service.ts:77`, `packages/extension-messaging/src/offscreen/service.ts:62`
- Evidence: the real typed envelopes live in `messages.ts`, but dispatch uses `RequestContentLike` / `ResponseContentLike` with `unknown` payloads, tuple params are recovered by `unknown[] as T`, RPC invocation indexes `this` through `as unknown as Record<...>`, and error `details` is re-cast per subclass.
- Why it harms future change: changing a wire field, event payload, method tuple, or structured-error detail shape requires editing several parallel type surfaces and casts; the type checker cannot prove they stayed aligned.
- Refactoring: Consolidate Duplicate Type Definitions + Encapsulate Downcast → make core handlers consume narrowed `RequestContent<T>` / `ResponseContent<T>` through shared guards/codecs; make `WalletErrorPayload` a code-keyed discriminated union.
- Effort: days
- Confidence: moderate; dynamic wire boundaries need runtime guards, but the shadow-type spread is the quality smell.

### Q4 Error Projection Logic Is Duplicated
- Smell: Duplicate Code / Divergent Change
- Lens: dedup
- Maintenance impact: structural
- Blast radius: wallet-core error helpers, job normalization, both messaging clients
- Instances: `packages/wallet-core/src/utils/errors.ts:1`, `packages/wallet-core/src/utils/errors.ts:3`, `packages/wallet-core/src/jobs/error.ts:53`, `packages/wallet-core/src/jobs/error.ts:59`, `packages/extension-messaging/src/background/client.ts:134`, `packages/extension-messaging/src/background/client.ts:140`, `packages/extension-messaging/src/offscreen/client.ts:113`, `packages/extension-messaging/src/offscreen/client.ts:117`
- Evidence: `getErrorMessage` and `extractMessage` both implement `unknown → string` with different null/undefined behavior; `makeRemoteError` is byte-identical across background and offscreen clients, including the same `errorPayload` cast.
- Why it harms future change: changing error rendering, structured payload precedence, or hostile-input handling must be patched in multiple places and can silently diverge between job persistence and RPC clients.
- Refactoring: Extract Function / Pull Up Method → one hostile-safe `errorMessageFromUnknown` in wallet-core and one shared `remoteErrorFromResponseContent` beside `buildErrorResponseContent`.
- Effort: hours
- Confidence: high

Likely false positives not scored: vendored `serialization.ts` and the bip39 table are excluded; empty root barrels are documented intentional (`wallet-core/src/index.ts:15`, `extension-messaging/src/index.ts:18`) and have no bare importers; `TimerHandle = unknown` only forces two mock-clock casts, so it is lower value.

## Summary
4 findings; highest-value fix is consolidating the RPC wire/content/error typing so the shared messaging boundary stops relying on parallel loose types and repeated casts.