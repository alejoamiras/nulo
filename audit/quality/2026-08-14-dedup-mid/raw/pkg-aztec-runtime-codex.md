## Findings

### 1. Retryable async memoization is reimplemented five times

**Smell:** Duplicate Code. Each instance maintains an in-flight promise, shares it across callers, clears it after rejection so later calls retry, and exposes or participates in cache reset behavior.

**Impact bucket:** structural. Blast radius: four PXE modules. Change frequency from full `git log`: `public-events.ts` 2 commits, `artifact-catalog.ts` 1, `artifact-registry.ts` 2, `note-schemas.ts` 2.

**Evidence:**

- `public-events.ts:169-181` memoizes the transfer tag and clears the promise on rejection.
- `public-events.ts:184-194` repeats the same lifecycle for the bundled token class ID.
- `artifact-catalog.ts:88-105` implements the keyed form of the same promise lifecycle.
- `artifact-registry.ts:51-52,99-112` implements it through separate result and initialization-promise fields.
- `note-schemas.ts:61-88` implements another scalar promise cache and explicitly says it matches `ArtifactRegistry`.
- Reset logic is separately maintained at `public-events.ts:196-200`, `artifact-catalog.ts:108-110`, `artifact-registry.ts:130-133`, and `note-schemas.ts:91-96`.

The implementations have already diverged in details: the catalog conditionally deletes only if the rejected promise remains current (`artifact-catalog.ts:102-104`), while the two public-event memoizers unconditionally clear their module variable (`public-events.ts:177-179,189-191`).

**Why it harms future change:** Any change to rejection caching, concurrent reset behavior, instrumentation, or test reset semantics must be discovered and applied across four modules. Adding another expensive artifact-derived value encourages copying whichever variant is noticed first, including its differing concurrency semantics.

**Smallest safe refactoring:** **Extract Function / Extract Class** into a small `RetryableAsyncMemo<T>` plus keyed `RetryableAsyncCache<K,V>`. Retain the current exported test-reset wrappers, but delegate their `get` and `clear` operations. The five hand-maintained promise initialization/rejection blocks disappear.

**Instances:**

- `packages/aztec-runtime/src/pxe/public-events.ts:169-181`
- `packages/aztec-runtime/src/pxe/public-events.ts:184-194`
- `packages/aztec-runtime/src/pxe/artifact-catalog.ts:88-105`
- `packages/aztec-runtime/src/pxe/artifact-registry.ts:51-52,99-112`
- `packages/aztec-runtime/src/pxe/note-schemas.ts:61-88`
- Associated resets:
  - `packages/aztec-runtime/src/pxe/public-events.ts:196-200`
  - `packages/aztec-runtime/src/pxe/artifact-catalog.ts:108-110`
  - `packages/aztec-runtime/src/pxe/artifact-registry.ts:130-133`
  - `packages/aztec-runtime/src/pxe/note-schemas.ts:91-96`

---

### 2. Timeout fetch is a local fork of the SDK transport implementation

**Smell:** Duplicate Code. This is an external-copy analog: the package duplicates the dependency’s JSON serialization, POST request, response parsing, HTTP error classification, and retry/backoff algorithm solely to insert an abort signal.

**Impact bucket:** structural. Blast radius: `utils/fetch.ts`, both node-construction paths in `adapters/aztec-node-factory-adapter.ts`, and every Aztec-node request created through that adapter. Change frequency: `fetch.ts` 2 commits; adapter 3 commits.

**Evidence:**

- The module explicitly declares the fork at `utils/fetch.ts:4-11` and `utils/fetch.ts:30-32`.
- The copied single-request pipeline is at `utils/fetch.ts:34-76`:
  - JSON serialization and headers: `42-47`
  - transport error conversion: `48-53`
  - response parsing: `55-61`
  - 4xx/`noRetry` classification: `63-70`
  - response shape: `72`
- The copied SDK retry configuration is at `utils/fetch.ts:97-107`.
- Production consumers are `aztec-node-factory-adapter.ts:55` and `:65`.

Corroborating dependency source, not an additional in-scope finding instance: installed `@aztec/foundation/src/json-rpc/client/fetch.ts:26-65,75-84` contains the upstream counterpart. It has already diverged: upstream parses text before JSON and includes the body in parse/server errors, whereas the local fork uses `Response.json()` and `statusText`.

**Why it harms future change:** Every Aztec dependency upgrade requires manually diffing upstream transport semantics against this fork. Otherwise upstream changes to parsing, logging, retry classification, or error context do not reach Nulo even though the local comments claim exact parity.

**Smallest safe refactoring:** **Introduce Parameter** upstream so `defaultFetch` accepts an `AbortSignal`, timeout, or injected low-level fetch implementation, then **Substitute Algorithm** locally with the SDK implementation. The local serialization, parsing, HTTP classification, and retry copy disappears; only timeout construction/configuration remains. Until the dependency exposes that seam, the fork should at least be treated as an explicit compatibility surface rather than “mirrors exactly.”

**Instances:**

- Eligible local fork: `packages/aztec-runtime/src/utils/fetch.ts:34-76,97-107`
- Production use sites: `packages/aztec-runtime/src/adapters/aztec-node-factory-adapter.ts:55,65`
- Out-of-scope duplicated counterpart used for verification: `node_modules/@aztec/foundation/src/json-rpc/client/fetch.ts:26-65,75-84`

---

### 3. A retired profile-switch behavior remains as an empty subscribed hook

**Smell:** Speculative Generality. A service dependency, event subscription, and callback extension point remain after the behavior they supported was deliberately removed. This is the close catalog mapping because the empty hook preserves a hypothetical future profile-switch policy without providing current behavior.

**Impact bucket:** local. Blast radius: one production file and the structural `IProfileReader` contract. Change frequency: `service.ts` 13 commits.

**Evidence:**

- `IProfileReader` still requires the event solely for this path at `service.ts:67-68`.
- Initialization registers the callback at `service.ts:209`.
- The callback at `service.ts:911-919` is empty; its entire body explains why the old clearing behavior must no longer occur.
- A production-only reference search finds no other use of `PxeService.onActiveProfileChanged`. The event registration mechanism does invoke this symbol, but invocation has no observable action, awaited work, or state transition.

**Why it harms future change:** Profile-reader implementations and service setup continue to advertise a runtime dependency that PXE no longer uses. A maintainer changing profile-switch behavior must inspect the subscription and its lengthy historical comment before discovering it intentionally does nothing; it also invites new cleanup logic to be placed in a lifecycle path whose current design explicitly rejects that cleanup.

**Smallest safe refactoring:** **Remove Dead Code**: delete the event member from `IProfileReader`, remove the registration, and remove the empty handler. The historical rationale belongs in the registry lifecycle documentation or an architectural decision note, not an executable hook.

**Instances:**

- `packages/aztec-runtime/src/pxe/service.ts:67-68`
- `packages/aztec-runtime/src/pxe/service.ts:209`
- `packages/aztec-runtime/src/pxe/service.ts:911-919`

## Non-findings

- `schemas.ts`, `note-schemas.ts`, and `spec.ts` have overlapping terminology but distinct jobs: RPC rehydration, note metadata, and transport contract types.
- `ArtifactRegistry` and `ChainRuntimeRegistry` both use maps, but their lifecycle, verification, disposal, and failure invariants differ too much for a shared registry abstraction.
- The `Methods`/client/service/IPXE surface repetition is the declared service/client/spec convention. `descriptors.ts:69-112` and `proxy.ts:46-66` add compile-time drift guards rather than unguarded boilerplate.
- `known-artifacts.ts` and `note-schemas.ts` correctly converge through `artifact-catalog.ts`; the earlier class-ID duplication has not regrown.
- `chain-coordinates.ts` and `chain-identity.ts` share domain vocabulary only; their logic is unrelated.
- `PxeService` is large, but size alone is insufficient here: its RPC methods consistently centralize the offscreen trust boundary and shared concurrency protocol.
