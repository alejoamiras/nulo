## Adversarial findings

- No repository subclass or consumer depends on the per-subclass `setPrototypeOf` calls themselves. Prototype consumers use `instanceof`; exact `.name` is observable through [`baseErrorJson`](packages/wallet-core/src/utils/error-json.ts:18) and serialization tests, so names are genuinely frozen.
- Recon’s test-double claim is false: [`core.test.ts`](packages/extension-messaging/src/core/core.test.ts) has no client subclass, and [`hardening.test.ts`](packages/extension-messaging/src/core/hardening.test.ts:24) extends the background transport, not `BaseServiceClient`. Only background and offscreen directly extend `BaseServiceClient`; all extension clients and the PXE chain inherit from them.
- Blocking test flaw: `TooManyPendingError` is one of the 11 subclasses but is absent from `KnownWalletErrorPayload` and the reconstruction switch in [`errors.ts`](packages/extension-messaging/src/errors.ts:280). An “every-subclass round-trip” sweep fails today. Adding its switch arm is a behavior change. Either explicitly scope/approve that fix or test all 11 via direct construction while pinning today’s fallback behavior separately.

## Assumption attack

- I1 is correct in substance but factually stale: production uses Vite 8’s default OXC/Rolldown minifier, not esbuild; `keepNames` is not configured, and an in-memory production-equivalent bundle removed `RpcTimeoutError`’s class name. `new.target.name` is unsafe.
- Keeping 11 `this.name = "X"` assignments is not the best narrowing and only half-remediates Q-14. Follow the raw audit’s safer recommendation: pass the frozen literal through `super`, e.g. `super(CODE, message, details, "RpcTimeoutError")`, and let the base assign it. Direct `WalletError` calls retain a default `"WalletError"`.
- `new.target.prototype` is identical after normal construction for all current classes, including direct base construction. Both TS and Vite target ESNext, so there is no Error-subclass downlevel transform. It does intentionally change a further subclass that omitted its own fixup: it now receives the most-derived prototype. No such subclass exists in-repo.
- I2’s evidence is wrong: the four timeout/send strings are not exposed verbatim through [`error-envelope.ts`](apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts:50); they are replaced with generic dApp messages, and no production substring matcher for them exists. `Client disconnected` is load-bearing. Still preserve all strings because the stated constraint freezes them; the two message hooks are a reasonable shape.
- I3 is overstated. Only the two direct transport extenders break loudly. Downstream/test subclasses inherit the hooks, and an existing override of a now-concrete `make*Error` would bypass them silently—although none exists in-repo.

## Implementation critique

Phase order is sound. Require exact `toBe` message pins plus error class/code/details/cause; current regex assertions are insufficient. Correct the stale base-client documentation about offscreen “raw strings” and the inaccurate “five-method quintet” claim—the plan removes four methods, not `onMessage`.

Inlining one-use method arrays is cleaner. The factory positive test plus missing/extra negatives is minimal; place negative calls in non-executing code so Vitest does not install intentionally invalid methods. `typecheck:all` does cover these `src/**/*.test.ts` files.

**Verdict: reject (with blocking findings: resolve the impossible `TooManyPendingError` round-trip sweep, fully centralize frozen names through `super`, and correct I3/test-double and dApp-message assumptions before implementation).**Architecture is now sound; no design blocker remains. However, the execution plan still contradicts it:

- Phase 1 still requires an every-subclass round-trip sweep.
- Phase 2 still says test doubles are updated.
- Assumptions I1–I3 and Fact 7 retain the disproven wording.
- Security still claims the four transport strings are dApp-visible.

These stale instructions could reintroduce the rejected work during implementation. Synchronize them with the amended Architecture section.

**conditional approve (conditions: update the stale Assumptions, Phases 1–2, and Security wording before implementation).**