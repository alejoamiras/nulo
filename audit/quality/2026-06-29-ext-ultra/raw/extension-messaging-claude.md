# QUALITY audit — `@nulo/extension-messaging` (typing + dedup lens)

Scope: `packages/extension-messaging/src/**` (excl. `*.test.ts`, `src/testing/**`). Quality only.
Method: read every shipped source module; verified the external typing root and the consumer
passthrough fan-out by grep. Line citations are against the files as read this session.

Context the report relies on (from the repo map, re-verified): the wire's *runtime* safety rests on
the `rpcMethods` Set + integer/shape guards + `instanceof EventHandler`, NOT on the generic types. So
the generic `Parameters<>`/`ReturnType<>` machinery is **consumer ergonomics, not boundary
enforcement**. Several `as unknown as` casts at the dispatch core are therefore *deliberate* and are
scored low / by-design below; the high-value findings are the ones with a clean refactor that removes
real duplication or drift risk.

---

### EM-Q1 Consumer `ServiceClient` passthrough boilerplate (headline dedup)
- Smell: Duplicate Code + Boilerplate-per-consumer (analog: every consumer mechanically restates the
  `Methods` type the class already `implements`).
- Lens: dedup
- Maintenance impact: architectural
- Blast radius: 22 client files (~110+ methods) across `packages/extension/`; caused by the base API shape in this package.
- Instances: every method body in the 21 Port clients —
  `account-state/client.ts` (6), `account/client.ts` (6), `auth-registry/client.ts` (5),
  `config/client.ts` (3), `contact/client.ts` (8), `dapp-interaction/client.ts` (4),
  `dapp-session/client.ts` (12), `execution/client.ts` (6), `fpc/client.ts` (6),
  `incoming-transfer/client.ts` (7), `log-viewer/client.ts` (2), `logger/client.ts` (1),
  `network/client.ts`, `note/client.ts` (3), `operation-journal/client.ts`, `passkey/client.ts` (3),
  `profile/client.ts` (23), `task/client.ts` (2), `token-balance/client.ts` (3), `token/client.ts` (8),
  `transaction/client.ts` (2) — 110 `return this.request("foo", ...a)` bodies total; plus the
  offscreen `wallet/services/pxe/client.ts`. Pattern confirmed in `contact/client.ts:19-48`
  (`getContact(id) { return this.request("getContact", id) }`, ×8).
- Evidence: each class is
  `class XServiceClient extends ServiceClient<Methods,Events> implements ServiceSpec<Methods,Events>`
  whose every method is a positional passthrough to `this.request(<same-name>, ...args)`. The method
  name, arity, and return type are stated **three times**: the `Methods` tuple type, the
  `implements ServiceSpec` obligation, and the hand-written body. Nothing but discipline keeps them in
  sync — a typo in the string literal, or an arg-order slip, type-checks because
  `request<T extends keyof TRequests>(method: T, ...params: Parameters<TRequests[T]>)` only constrains
  *that* the literal is a key and the args match it, not that the wrapper method name equals the literal.
- Why it harms future change: adding/renaming one RPC is Shotgun Surgery across spec + service + client
  body; 110 near-identical bodies are 110 places a future refactor (e.g. adding per-call telemetry,
  validation, or a retry) must be touched.
- Refactoring: Replace Method-with-Factory / typed `Proxy` on `BaseServiceClient`. A
  `createRpcClient<Methods,Events>()` that returns a typed proxy (`get(_, name) => (...a) => request(name, ...a)`)
  derives the whole surface from the `Methods` type — the 110 bodies collapse to zero, and the
  name↔literal drift class becomes unrepresentable.
- Effort: days (per-client migration + a type-level test asserting the proxy satisfies `ServiceSpec`).
- Confidence: high (dedup real; "wise" caveat: keep hand-written wrappers only where a client adds
  genuine logic beyond passthrough — most add none).

---

### EM-Q2 `…ContentLike` loose shadows of the typed `messages.ts` envelopes
- Smell: Schema/Type Drift (analog: two hand-maintained declarations of the same wire shape, one
  loose) + the casts it forces.
- Lens: typing
- Maintenance impact: structural
- Blast radius: 4 files (`core/base-client.ts`, `core/base-service.ts`, both clients).
- Instances:
  - `ResponseContentLike` decl — `core/base-client.ts:67-73` (`errorPayload?: unknown`,
    `result?: unknown`, `resultIsJson?: boolean`) vs the real `ResponseContent<T>` `messages.ts:39-57`
    (`errorPayload?: WalletErrorPayload`, `result?: ReturnType<T[M]>`).
  - `RequestContentLike` decl — `core/base-service.ts:13-17` vs the real `RequestContent<T>`
    `messages.ts:26-32`.
  - The `errorPayload: unknown` looseness then forces an identical re-cast at every read:
    `core/base-client.ts` (declared shape) is consumed in `background/client.ts:139` and
    `offscreen/client.ts:115` as
    `content.errorPayload as Parameters<typeof walletErrorFromPayload>[0]`.
- Evidence: the package already owns a *correct* discriminated-union envelope in `messages.ts`
  (cited by the prompt as the typing high point), but the correlator core re-declares loose,
  non-generic shadows because it operates pre-narrowing. The shadow's `errorPayload: unknown` is
  strictly weaker than the canonical `WalletErrorPayload`, so the two clients must re-cast to the exact
  arg type of `walletErrorFromPayload` on every error path.
- Why it harms future change: a change to `ResponseContent`/`WalletErrorPayload` in `messages.ts`/`errors.ts`
  is NOT caught at the shadow — the shadow keeps compiling with the old/loose shape, and the casts
  paper over the drift until something breaks at runtime on the wire. Two sources of truth for one wire
  contract.
- Refactoring: Collapse the shadows onto the canonical types — type `errorPayload?: WalletErrorPayload`
  on `ResponseContentLike` (it can stay non-generic over `T` while still using the precise field
  types). That deletes both `as Parameters<typeof walletErrorFromPayload>[0]` casts and re-binds the
  core to the single `messages.ts`/`errors.ts` source of truth.
- Effort: hours.
- Confidence: high.

---

### EM-Q3 `WalletErrorPayload.details: unknown` + non-exhaustive `switch` registry
- Smell: Primitive Obsession (`details: unknown` for a per-code-shaped payload) + Switch Statements +
  Shotgun Surgery (adding a subclass = 3 coordinated edits with no compile-time link).
- Lens: typing
- Maintenance impact: structural
- Blast radius: 1 file (`errors.ts`) but it is the `./errors` public surface consumed by 31 files.
- Instances:
  - Loose decl: `errors.ts:20` (`WalletErrorPayload.details?: unknown`) + `errors.ts:26`
    (`WalletError.details?: unknown`).
  - Re-casts forced by it: `errors.ts:229` (`payload.details as { jobId?: string } | undefined`),
    `errors.ts:234` (`payload.details as { capabilityType?: string } | undefined`).
  - Non-exhaustive registry: `walletErrorFromPayload` `errors.ts:220-246` — a `switch (payload.code)`
    over 8 string `CODE` constants + `default`. No type ties a `code` to its `details` shape, and no
    compile-time check that every subclass appears. Each subclass declares `static CODE` (e.g.
    `errors.ts:48,69,80,106,134,156,167,182,206`) read only by string comparison.
- Evidence: the `code → details` relationship is a discriminated union in disguise. Because `details`
  is `unknown`, the only two subclasses that carry structured details (`JobCancelledError`,
  `CapabilityNotGrantedError`) must hand-cast on reconstruction; a third subclass that grows a typed
  `details` will silently add a fourth untyped cast. Adding a new error type means touching the class,
  its `CODE`, and the `switch` — three sites, zero compiler enforcement that you did all three.
- Why it harms future change: forget the `switch` case and the new error silently degrades to a base
  `WalletError` (loses `instanceof`) with no compile error — exactly the failure the registry exists to
  prevent. The `unknown` details defeat the structured-error value proposition for any new shaped error.
- Refactoring: Replace Conditional with a code-keyed registry map +
  `type WalletErrorPayload = { code:"JOB_CANCELLED"; details?:{jobId?:string} } | { code:"CAPABILITY_NOT_GRANTED"; details:{capabilityType:string} } | …`
  discriminated union, or a `Record<code, (payload)=>WalletError>` table with an `Object.values`-driven
  exhaustiveness assert (mirror the `defineRpcMethods` exhaustiveness pattern already used in this
  package). Kills both `details` casts and the silent-fallthrough class.
- Effort: hours.
- Confidence: high.

---

### EM-Q4 Client error-shaping helpers duplicated across both transports
- Smell: Duplicate Code (the client-side inverse of the already-shared `buildErrorResponseContent`).
- Lens: dedup
- Maintenance impact: structural
- Blast radius: 2 files (`background/client.ts`, `offscreen/client.ts`).
- Instances:
  - `makeRemoteError` — **bodies byte-identical**: `background/client.ts:134-141` ≡
    `offscreen/client.ts:113-117`
    (`content.errorPayload ? walletErrorFromPayload(... as ...) : new Error(content.error ?? "Unknown error")`).
  - `makeDisconnectError` — identical: `background/client.ts:158-160` ≡ `offscreen/client.ts:134-136`
    (`new Error("Client disconnected")`).
  - `makeTimeoutError` — near-identical: `background/client.ts:143-148` vs `offscreen/client.ts:119-124`
    (same `new RpcTimeoutError(msg, {requestId, methodName})`; only the message literal differs).
  - `makeSendFailureError` — near-identical: `background/client.ts:150-156` vs
    `offscreen/client.ts:126-132` (same `new RpcDisconnectedError(msg, {requestId, methodName, cause})`;
    only the message literal differs).
- Evidence: `BaseServiceClient` deliberately left these as transport hooks (base-client.ts:259-269)
  with a comment justifying it by the offscreen client "rejecting with raw strings." That premise is
  now **false** — both clients reconstruct typed `WalletError`s identically (the offscreen string→typed
  flip already happened; the base-client.ts:24-35 doc still describes the old behavior). With the
  divergence gone, four hooks duplicate logic that differs only in two message-template strings.
- Why it harms future change: any change to client-side error reconstruction (e.g. preserving
  `cause`, mapping a new code) must be made and kept consistent in two places. The drift already
  happened once in the docs.
- Refactoring: Extract Method to a shared `client-errors.ts` next to `core/error-response.ts` —
  `makeRemoteError(content)` becomes a free function; `makeTimeoutError`/`makeSendFailureError` take a
  `messagePrefix`/`label` param. Hooks shrink to one-line delegations (or drop to a shared default on
  the base). Removes the now-stale base-client.ts doc justification.
- Effort: hours.
- Confidence: high.

---

### EM-Q5 Residual cross-fork micro-duplication (log quartet, event-literal cast, inbound guard)
- Smell: Duplicate Code (×2 verbatim) + repeated forced cast.
- Lens: dedup + typing
- Maintenance impact: local
- Blast radius: 4 files (both services, both bases).
- Instances:
  - **Logging quartet duplicated verbatim**: `core/base-service.ts:205-219`
    (`logDebug/logInfo/logWarn/logError`) ≡ `core/base-client.ts:285-299` — differ only by the source
    field (`this.name` vs `this.clientName`).
  - **`as EventMessage<TEvents>` literal cast duplicated** (TYPE-8): `background/service.ts:77`
    (`{ type: MessageType.Event, content } as EventMessage<TEvents>`) and `offscreen/service.ts:62`
    (`{ type: MessageType.Event, content, from: this.name } as EventMessage<TEvents>`). Same root cause:
    the mapped-union `EventContent<T>` (messages.ts:14-19) can't be inferred from an object literal.
  - **Inbound envelope guard repeated** (with per-transport `from`/`to` deltas, so structural not
    byte-identical): `background/service.ts:59`, `background/client.ts:87`, `offscreen/service.ts:44`,
    `offscreen/client.ts:69-77` — all re-checking `type`/`content` presence.
- Evidence: the log quartet is the cleanest verbatim dup; the event-literal cast is a forced
  double-cast caused by a typing limitation; the inbound guard is the "wise-dedup" borderline — its
  `type`/`content` prefix is common, its `from`/`to`/`service` routing is genuinely transport-specific.
- Why it harms future change: a log-source convention change touches two files; a wire-envelope shape
  change touches four guard sites; the `as EventMessage` cast hides the literal/union mismatch in two
  places.
- Refactoring: (a) lift the log quartet into a tiny shared `makeLogger(source, logger)` or a mixin
  consumed by both bases; (b) add an `eventMessage(content): EventMessage<T>` constructor helper in
  `messages.ts` so the cast lives once; (c) extract only the common `type`/`content` prefix check into
  a shared `isEnvelope(msg, expectedType)` guard, leaving routing in the subclass (don't over-abstract
  the from/to deltas).
- Effort: hours.
- Confidence: moderate (log quartet high; inbound guard intentionally partial).

---

### EM-Q6 Dispatch/param/event reach is typed fiction (by-design; one local fix worth taking)
- Smell: Stringly-Typed dispatch + generic-that-enforces-nothing — but DELIBERATE defense-in-depth,
  so scored low except the one item with a clean fix.
- Lens: typing
- Maintenance impact: local (mostly cosmetic / by-design)
- Blast radius: 3 core/transport files.
- Instances (by-design — note, don't "fix"):
  - Root: `MethodsMap = Record<string, (...params: any[]) => unknown>` — external,
    `packages/wallet-core/src/base/index.ts:11` (carries its own `biome-ignore noExplicitAny`). Every
    generic here inherits the `any[]`; the constraint enforces nothing about args by intent.
  - Invoke: `core/base-service.ts:125`
    (`(this as unknown as Record<string,(...args:unknown[])=>unknown>)[method](...params)`) +
    `:111` (`params as unknown[]`). Guarded at runtime by the `rpcMethods` Set + integer check
    (base-service.ts:90-97).
  - Emit / event reach: `core/base-service.ts:130` (`this as unknown as EventsSpec<TEvents>`) and
    `core/base-client.ts:205` (`this as unknown as Record<PropertyKey,unknown>`), guarded by
    `instanceof EventHandler` + `reservedEventNames`.
  - Wire-type assertion: `utils.ts:28` (`unwrapParams<T>` returns `res as T`) +
    `core/base-client.ts:117` (`jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>`).
- Instance with a clean local fix:
  - Framework-RPC casts: `background/client.ts:165`
    (`this.request("backup" as keyof TRequests, ...([] as unknown as Parameters<…>))`) and `:169`
    (same shape for `restore`). `backup`/`restore` live outside the `Methods` generic, so the generic
    `request` signature can't express them and forces a triple-cast.
- Evidence: the repo map and `base-service.ts:84-97` make explicit that types are not the boundary
  guard here — the Sets + integer/shape checks are. So the `as unknown as` cluster is intentional and
  has no type-safe rewrite without weakening the generic ergonomics elsewhere. The exception is the
  framework-RPC casts, which exist only because `backup`/`restore` were bolted onto a per-`Methods`
  generic.
- Why it harms future change: minimal for the by-design items. For backup/restore: the cast hides
  arg/return types entirely (`request("backup", ...[])` returns `unknown`), so a future caller gets no
  inference and a rename of the framework RPCs is a silent string-literal edit.
- Refactoring: leave the dispatch/param casts (note as accepted defense-in-depth). For backup/restore,
  give `BaseServiceClient` typed framework methods via a small `FrameworkRpc` interface intersected into
  the request surface (or a dedicated `protected frameworkRequest(name, ...args)` overload) so the
  `keyof TRequests` casts disappear.
- Effort: hours (backup/restore only).
- Confidence: high (that the cluster is by-design); moderate (that the backup/restore fix is worth it).

---

## Out-of-focus notes (not scored)
- **Stale package docs (not code).** `core/base-client.ts:24-35` still says the offscreen client
  "currently rejects with raw strings" — it reconstructs typed `WalletError`s identically to the Port
  client (offscreen/client.ts:113-117). The `README.md` file-map omits the entire `core/` subdir and
  repeats the same stale "raw strings" claim. Docs-fix, flagged per the prompt's instruction not to
  edit config/docs as code.
- **zod schema↔signature decoupling is genuinely out of this package's scope.** `validateParams<T>(schema: ZodType<T>)`
  / `validateResult<T>` (`zod-helpers.ts:38,54`) tie the result to the *schema's* `T` with nothing
  linking it to the method's real param tuple — but the schemas live in consumer `spec.ts` files, so
  the dual-source-of-truth drift materializes there, not here. The helper module itself is clean.
- **`offscreen/messages.ts:13-15` intersection envelope** (`BaseX<T> & MessageExt`) is a reasonable
  extension, not a smell — the discriminant is shared and `from`/`to` are real routing additions. No
  action.

## Summary
6 findings (4 strong, 2 grouped/low). Highest-value: **EM-Q1** — 110 hand-written
`return this.request("foo", ...a)` passthroughs across 22 consumer clients that mechanically restate
the `Methods` type they already `implements`; a typed proxy/factory on `BaseServiceClient` erases all
of them and the name↔literal drift class with them.
