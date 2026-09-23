# Recon — dedup-messaging-primitives

Sources: audit run `audit/quality/2026-08-14-dedup-mid/` (findings Q-14, Q-07, Q-05 + `findings/verified/Q-05.md`) plus direct reads of the four target files. The audit's verified layer substitutes for a fresh explorer fan-out — file:line evidence was independently re-derived there 2 days ago.

## Q-14 surface (`packages/extension-messaging/src/errors.ts`)

- Base `WalletError` ctor sets `this.name = "WalletError"` + `Object.setPrototypeOf(this, WalletError.prototype)` with a comment: "Subclasses repeat this in their ctors" (`errors.ts:30-35`).
- 11 subclasses each end with `this.name = "X"` + `Object.setPrototypeOf(this, X.prototype)`: RpcTimeoutError:52-53, RpcDisconnectedError:73-74, UserRejectedError:104-105, JobCancelledError:130-131, CapabilityNotGrantedError:158-159, TooManyPendingError:180-181, ValidationError:191-192, InvalidPasswordError:207-208, AccountAddressInconsistencyError:224-225, RestoreTornError:243-244, ProfileIdConflictError:266-267.
- `walletErrorFromPayload` reconstructs via concrete ctors — the ONLY consumer that depends on prototype identity across the wire. `errors.test.ts` exists (round-trip coverage to extend).
- **Reuse/adapt**: `new.target.prototype` in the base ctor makes every subclass's `setPrototypeOf` line redundant. **Risk found in recon**: `this.name = new.target.name` (the audit's literal suggestion) is minification-sensitive — esbuild/terser mangle class names unless keepNames is set; the current literals are minification-proof. The `name` strings appear in logs/toasts; silently changing them in prod builds violates the zero-behavior-change rule.

## Q-07 surface (`packages/extension-messaging/src/{core/base-client.ts,background/client.ts,offscreen/client.ts}`)

- `base-client.ts:259-269` declares 4 abstract hooks: `makeRemoteError`, `makeTimeoutError`, `makeSendFailureError`, `makeDisconnectError`. Two other hooks already model the intended pattern: `getRequestTimeoutMs` and `onTerminal` are CONCRETE with default bodies, overridden where a transport differs.
- `background/client.ts:134-155` vs `offscreen/client.ts:113-134`:
  - `makeRemoteError` — byte-identical (`remoteErrorFromResponseContent(content)`).
  - `makeDisconnectError` — byte-identical (`new Error(CLIENT_DISCONNECTED_MESSAGE)`).
  - `makeTimeoutError` — identical construction (`RpcTimeoutError` + `{requestId, methodName}`), differing ONLY in message: `` `RPC '${m}' timed out after ${t}ms` `` vs `` `Offscreen request timed out: ${m}` ``.
  - `makeSendFailureError` — identical construction (`RpcDisconnectedError` + `{requestId, methodName, cause: String(cause)}`), differing ONLY in message: `` `RPC '${m}' aborted: port disconnected` `` vs `` `Offscreen send failed: ${m}` ``.
- Message strings are load-bearing: offscreen's comment notes rejections map to stable dApp-facing envelopes via `error-envelope.ts`; treat all four strings as frozen.
- Test doubles in `core/core.test.ts` / `core/hardening.test.ts` extend `BaseServiceClient` and implement the abstract hooks — signature changes ripple there.
- **Reuse/adapt**: `core/base-client.ts` importing from `../errors` is cycle-free (errors.ts has zero imports).

## Q-05 surface (`core/service-client-factory.ts` + 16 client files)

- `findings/verified/Q-05.md` is definitive: exact 16-file list; 7 deviants with reasons (config/price/profile hand-written; network/operation-journal zod-wrapped; logger narrower signature; pxe base-classed elsewhere) — none migrate. The curried `definePassthroughsExhaustive` sketch was compiled against the repo's TS 6.0.3 `--strict` with positive + two `@ts-expect-error` negative cases.
- The factory's doc comment already prescribes pairing with the exhaustiveness assertion it can't enforce (`service-client-factory.ts` "Why an explicit name list" block) — the new export closes exactly that documented gap.
- `service-client-factory.test.ts` exists; extend rather than create.
- What stays per-file (verified §Refined): the `interface X extends MethodsSpec<Methods> {}` merge + its `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` comment (TS declaration merging binds to the named class). Only the exhaustive type alias + dummy-const/`void` pair (and the standalone `satisfies` clause) collapse.

## Conventions to match

- TSDoc on public exports; comments explain WHY/invariants; no milestone tags.
- Tests colocated; `bun run --cwd packages/extension-messaging test` (bun:test? — this package's tests run under the root vitest workspace; verify with `bun run test` filter during phase 1).
- Layer position: extension-messaging must not import from aztec-runtime/wallet-bridge/extension. All changes stay inside the package + the 16 extension client files.

## Collision/dedup risks

- None with in-flight work: `git log` shows no open branches touching these files; the errors.ts `KnownWalletErrorPayload` union (recent) is untouched by the ctor-tail change.
- The 16-client migration touches the same files Arc 2 (withlock) does NOT — no cross-arc conflict expected; arcs are sequential anyway.
