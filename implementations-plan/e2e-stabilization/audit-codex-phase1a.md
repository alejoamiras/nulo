`LGTM with nits`

1. `isReady` flips late enough. `loadInteractionPayload()` sets `requestId`, then awaits `getInteractionPayload()`, then commits `payload.value` and `dapp.value`, and only then resolves at [useDappInteractionPayload.ts:82](../../packages/extension/src/composables/useDappInteractionPayload.ts:82). So when [discover/index.vue:80](../../packages/extension/src/popup/windows/discover/index.vue:80) sets `isReady = true`, `requestId` and dApp identity are already committed. Your adversarial analysis is correct.

2. The throw is defensive enough. There is no custom `app.config.errorHandler` in [src/popup/index.ts:19](../../packages/extension/src/popup/index.ts:19) or [src/setup/index.ts:13](../../packages/extension/src/setup/index.ts:13), so this should stay in Vue/console logging rather than surfacing as user-facing UI. That is the right failure mode.

3. I do not see another live popup with the same `useDappInteractionPayload` shape. `discover`, `capabilities`, and `execute` are the only consumers; the latter two are already hardened.

4. Nit: the code relies on the composable invariant “`load()` resolves only after `dapp.value` is assigned.” That is true today, and `DiscoveryPayload` requires `dappMetadata` at [spec.ts:58](../../packages/extension/src/wallet/services/dapp-interaction/spec.ts:58). If you want belt-and-suspenders future-proofing, make the readiness flip explicitly require `profile.value && dapp.value && requestId.value`. Not a blocker.

5. Nit on tests: they prove the readiness gate, but because `DappIdentityBlock` and `useDappHostname` are stubbed, they do not literally assert “identity rendered before Allow enabled.” The runtime ordering above is enough for me, so also not a blocker.

I could not save to `implementations-plan/e2e-stabilization/audit-codex-phase1a.md` because this sub-session’s write sandbox denied writes to `implementations-plan/`.