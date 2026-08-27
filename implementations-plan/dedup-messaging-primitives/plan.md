# Plan — dedup-messaging-primitives (Arc 1 of audit 2026-08-14-dedup-mid)

**Tier**: `/blueprint light` · **Branch**: `worktree-dedup-messaging-primitives` → PR into `dev`
**Scope**: findings Q-14, Q-07, Q-05 from `audit/quality/2026-08-14-dedup-mid/` (verified corrections authoritative)
**Approval**: standing authorization via the owner's `/goal` (2026-08-16) — autonomous remediation, per-arc merge authorized. ELI5 companion deliberately omitted (autonomous mode; the owner-facing narrative is the audit report + final goal report). Phase-0 answers derive from the goal: production quality bar, zero behavior change, repo-standard gates.

## Assumptions

**Facts (verified in recon)**
1. 11 `WalletError` subclasses each end their ctor with `this.name = "X"` + `Object.setPrototypeOf(this, X.prototype)`; the base comment documents the ritual (`errors.ts:34`).
2. `walletErrorFromPayload` + `errors.test.ts` are the prototype-identity consumers; `isClientDisconnectRejection` matches on message, not name.
3. The two transports' `makeRemoteError`/`makeDisconnectError` are byte-identical; `makeTimeoutError`/`makeSendFailureError` differ only in message string; details construction is identical (`background/client.ts:134-155` ↔ `offscreen/client.ts:113-134`).
4. `base-client.ts` already models "concrete hook with default, override where transports differ" (`getRequestTimeoutMs`, `onTerminal`) — the Q-07 pull-up follows an in-file precedent.
5. `core/base-client.ts → ../errors` is import-cycle-free (errors.ts imports nothing).
6. The Q-05 curried generic was compile-proven against repo TS 6.0.3 `--strict` in both failure directions (`findings/verified/Q-05.md`); the 16-file list is a 3-way exact match; the 7 deviants each have a structural reason not to migrate.
7. ~~Test doubles extend `BaseServiceClient`~~ **Corrected by codex audit**: only the two transports directly extend `BaseServiceClient`; `hardening.test.ts` extends the background transport and inherits everything. No test-double migration exists.

**Inferences (resolved by codex audit — corrected wording)**
- I1 (confirmed, sharpened): `new.target.name` is unsafe — production uses Vite 8's OXC/Rolldown minifier, no keepNames; codex verified class names are stripped in a production-equivalent bundle. Resolution: frozen literal name travels through `super` (4th param); base owns both `name` and prototype.
- I2 (evidence corrected, conclusion kept): the four timeout/send strings are NOT dApp-verbatim (`error-envelope.ts` genericizes them); `CLIENT_DISCONNECTED_MESSAGE` IS load-bearing (`isClientDisconnectRejection`). All strings stay frozen per this arc's zero-behavior-change constraint — Template Method with per-transport message hooks stands.
- I3 (narrowed): the abstract→concrete migration breaks loudly ONLY for the two direct transport extenders (both edited in this arc). A hypothetical existing override of a now-concrete `make*Error` would bypass silently — codex confirmed none exists in-repo.

**Asks (none silent)**
- None owner-facing. Design forks below are resolved in-plan and challenged via the codex audit.

## Architecture & Implementation

### Q-14 — Pull Up Constructor Behavior (AMENDED per codex audit)
`WalletError` base ctor gains an optional 4th parameter carrying the frozen literal name — `constructor(code, message, details?, name = "WalletError")` — and owns BOTH halves of the ritual: `this.name = name` and `Object.setPrototypeOf(this, new.target.prototype)`. Each subclass ctor becomes a pure `super(X.CODE, message, details, "XError")` call: no body lines left to forget. `new.target.name` stays banned (codex empirically confirmed Vite 8's OXC/Rolldown minifier strips class names in a production-equivalent bundle — worse than my esbuild assumption, same conclusion); the literal travels through `super` instead. Base comment states the invariant.
*What disappears*: the entire 2-line ritual from all 11 subclasses. A 12th subclass that forgets the name argument degrades cosmetically to `"WalletError"` (caught by the completeness test); `instanceof` breakage is structurally impossible.
**Scope guard (codex blocking finding)**: `TooManyPendingError` is absent from `KnownWalletErrorPayload` + the `walletErrorFromPayload` switch — a pre-existing gap, NOT fixed here (adding the arm is a behavior change outside this arc's authorization; flagged as an owner follow-up). Tests therefore: direct-construction sweep over all 11 subclasses (prototype chain + literal name + code), round-trip sweep over the 10 switch-covered codes, plus a BUG-PIN test documenting that `TOO_MANY_PENDING` currently reconstructs as base `WalletError`.

### Q-07 — Pull Up Method + Template Method
In `base-client.ts`, the four hooks become concrete:
- `makeRemoteError(content)` → `remoteErrorFromResponseContent(content)` (new import from `../errors`)
- `makeDisconnectError()` → `new Error(CLIENT_DISCONNECTED_MESSAGE)`
- `makeTimeoutError(meta)` → `new RpcTimeoutError(this.timeoutMessage(meta), { requestId, methodName })`
- `makeSendFailureError(meta)` → `new RpcDisconnectedError(this.sendFailureMessage(meta), { requestId, methodName, cause: meta.cause === undefined ? undefined : String(meta.cause) })`

Two NEW abstract hooks: `protected abstract timeoutMessage(meta: RequestErrorMeta): string` and `protected abstract sendFailureMessage(meta: RequestErrorMeta): string`. Each transport shrinks to two one-line string returns preserving its exact current messages verbatim. Hooks stay overridable so a future transport with a genuinely different error SHAPE is not boxed in.
*Corrections adopted from codex*: only the two transports directly extend `BaseServiceClient` (no test doubles to migrate — `hardening.test.ts` extends the background transport and inherits everything); the four message strings are NOT dApp-verbatim (error-envelope.ts genericizes them) but stay frozen per this arc's constraint, pinned with exact `toBe` assertions incl. class/code/details/cause; `CLIENT_DISCONNECTED_MESSAGE` IS load-bearing (`isClientDisconnectRejection`). Also fix the stale offscreen header comment ("currently string-shaped error contract") while touching the file — it describes the pre-P3 world.
*What disappears*: the four make*Error methods from both transports, and the hand-maintained "parity with the background transport" comment contract.

### Q-05 — Extract Function (curried exhaustive factory)
`definePassthroughsExhaustive<M>()` added to `core/service-client-factory.ts` exactly per the compile-proven sketch in `findings/verified/Q-05.md` (curried; `Exclude<keyof M, T[number]> extends never ? T : { missingMethods: ... }` parameter type; TSDoc from the verified refined recommendation). Exported wherever `definePassthroughs` is exported today (verify entry-point in phase 1). All 16 listed clients collapse: drop the `_METHODS` const + `satisfies`, the `_XMethodsExhaustive` alias, the dummy-const + `void` pair, the per-file completeness comment; inline the method array into `definePassthroughsExhaustive<Methods>()(XServiceClient.prototype, [...])`. The `MethodsSpec` interface merge + `biome-ignore` stay per-file (declaration merging binds to the named class — verified §Refined). The 7 deviant clients are untouched.
*What disappears*: ~90-130 lines of guard skeleton; the possibility of a future client silently omitting the completeness proof.

## Phases & validation gates

1. **Q-14 + tests**: base ctor gains the name param + `new.target.prototype`; 11 subclass ctors collapse to pure `super` calls. Tests: direct-construction sweep over all 11 (prototype chain + literal name + code), round-trip sweep over the 10 switch-covered codes, BUG-PIN test for `TOO_MANY_PENDING`'s base-`WalletError` fallback. Gate: package tests green.
2. **Q-07 + tests**: base-client concretization + two message hooks; both transports slimmed (no other extenders exist — codex-verified); extend transport tests to pin all four messages with exact `toBe` + class/code/details/cause assertions. Fix the stale offscreen "string-shaped" header comment. Gate: package tests green.
3. **Q-05 + tests**: factory export + 16-client migration (mechanical, one commit); extend `service-client-factory.test.ts` (runtime: installs forwards identically to `definePassthroughs`; compile-time: `@ts-expect-error` missing-key + extra-key cases inside a never-executed function so vitest doesn't install intentionally-invalid methods — codex confirmed `typecheck:all` covers `src/**/*.test.ts`). Gate: package tests + `bun run typecheck:all`.
4. **Whole-arc gate**: `bun run lint` + `bun run typecheck:all` + `bun run test` + `bun run audit:vue` (extension client files touched). No e2e required (no popup/PXE/dApp behavior change; unit + component layers cover the RPC plumbing) — smoke rides CI's filter if it fires.
5. **Post-implementation**: ONE codex xhigh pass over the complete arc diff → fix → resume → `converged` → PR → babysit → squash-merge.

## Security & Adversarial Considerations

- The service-side dispatch allowlist (`rpcMethods`) is explicitly NOT touched — `definePassthroughs` doc marks it as the trust boundary; this arc changes only client-side forwarders and error shaping.
- Error-message strings: the four transport messages are internal (error-envelope.ts genericizes what dApps see) but frozen anyway under this arc's constraint and pinned by new tests; `CLIENT_DISCONNECTED_MESSAGE` and `CapabilityNotGrantedError`'s wording are genuinely load-bearing and untouched.
- `walletErrorFromPayload` reconstruction paths unchanged; prototype identity strengthened (single owner) not weakened. Attack surface delta: none — no new inputs cross a trust boundary.

## Trade-offs / alternatives rejected

- `this.name = new.target.name` (audit's literal text): rejected for minification instability (I1) — codex asked to confirm.
- Single shared message template for timeout/send-failure: rejected — messages are frozen per-transport contracts (I2).
- Centralizing the `MethodsSpec` declaration-merge: rejected per verified Q-05 §Refined (breaks named-class type-position imports).
- Keeping the 4 base hooks abstract and adding a shared `makeTypedTransportErrors()` helper the subclasses call: rejected — leaves the drift-prone duplication in place, just shorter; the in-file precedent (F4) favors concrete-with-default.
