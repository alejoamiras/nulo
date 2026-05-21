1. **Verdict**

ship-with-changes

2. **v2→v3 pivot soundness**

Yes. For the known Nethermind flow, v3 is the better design.

- v2 only fixes the first symptom. Nethermind still needs `transaction` capability for `interaction.send(...)` at `claim-via-wallet.ts:140`, so v2 just moves the failure deeper.
- v3 forces the dApp into the one-popup, full-manifest path the wallet-sdk docs explicitly recommend.
- It is smaller, cleaner, and more spec-aligned.

The one case where v2 is materially better: a dApp that only wants account selection and has no `requestCapabilities` fallback. v2 would limp along; v3 breaks it immediately. That is the tradeoff. For the ecosystem direction, I still prefer v3.

3. **v3 standalone evaluation**

If I only saw v3, I’d still land on `ship-with-changes`.

What’s good:

- The design is coherent on its own.
- 4100 is the right semantic surface.
- Keeping Phase 1.5 is correct; that bug is independent.
- The PR is much smaller than v2 and avoids TTL/dedupe/popup-state complexity.

What is off:

- The plan points at the wrong file for the EIP-1193 mapping. The structured `response.error` writer is in [background.ts](/Users/alejoamiras/Projects/nulo/nulo-2/packages/extension/src/wallet/services/wallet-sdk/background.ts:460), not `wallet-bridge/src/dispatcher.ts`.
- The “wire-response writer” test needs a real seam. As written, there is no obvious isolated unit target unless you extract a pure helper from `handleWalletMessage`.
- The e2e assertion is too optimistic about directly seeing numeric `4100`.

4. **EIP-1193 code choice**

4100 is the right code.

- `4200` is wrong: the method is supported.
- plain `Error` is worse: loses machine-readable signal.
- custom `4101` buys nothing and hurts compatibility.

Using `4100` plus `data.walletErrorCode = "CAPABILITY_NOT_GRANTED"` is the correct split: standard outer code, wallet-specific inner discriminator.

One nuance: the dApp-facing SDK may stringify the structured error object before it reaches app code. So 4100 is still the right wire choice, but your tests should not assume every consumer sees a live `code` property.

5. **Phase 1.5 scope**

Still right.

- `accounts`-only is the minimum necessary fix.
- The broader field-aware diff follow-up remains justified.
- I would not block v3 on fixing `contracts`/`simulation`/`transaction`/`data` in the same PR.

6. **Test adequacy**

Mostly fine, but two gaps remain.

- Add the missing no-op regression pin: same-shape `accounts` re-request should **not** reopen the popup. v2 had this; v3 dropped it.
- Make the “wire-response writer” test concrete. Either:
  - extract a pure mapper from `handleWalletMessage`, or
  - test `background.ts` directly at that seam.

The e2e should assert:

- `getAccounts` pre-grant fails
- then `requestCapabilities` succeeds
- and the assertion should allow either parsed `code === 4100` or a serialized payload containing `4100` / `CAPABILITY_NOT_GRANTED`

7. **Adversarial review**

What v3 changes:

- A dApp can use the 4100 to trigger its own permission UX. That is not a new privilege escalation path; it is normal wallet behavior. A malicious dApp can already fake UI.
- The structured error slightly improves capability probing: a dApp learns “accounts not granted” explicitly instead of inferring from `[]`. That is low-risk; capability state was already observable by behavior.
- DApps without fallback stay broken. That is intentional, but real.
- The old `No dApp session found` race still exists and will still throw a non-4100 error. That is acceptable, but you should not oversell “all pre-grant failures become 4100.”

No new crypto, supply-chain, or least-privilege risk. v3 is cleaner than v2 on that front.

8. **v3 open-question triage**

- **Q1:** yes, the spec-alignment argument holds. The main downside is breaking account-only/no-fallback dApps.
- **Q2:** 4100 is the right code.
- **Q3:** coverage is close, but add the same-shape no-op test and firm up the wire-mapper seam.
- **Q4:** `accounts`-only Phase 1.5 scope is still fine.
- **Q5:** throw timing is fine. `getAccounts` is exempt from capability enforcement, so the throw reaches the wallet-sdk response writer cleanly.
- **Q6:** biggest abuse is misleading dApp UX after 4100, not wallet compromise.
- **Q7:** branch rename is appropriate. Keeping the old plan directory for audit history is acceptable, just slightly ugly.

9. **Remaining blockers**

- Fix the plan’s file ownership: the EIP-1193 error mapping lives in `packages/extension/src/wallet/services/wallet-sdk/background.ts`, not `packages/wallet-bridge/src/dispatcher.ts`.
- Add the missing Phase 1.5 regression test: same-shape `accounts` re-request should not popup.
- Make the wire-response-writer test real by extracting a pure helper or explicitly testing `background.ts`.
- Relax the e2e assertion: don’t require direct `error.code === 4100` unless you verify the playground sees that exact shape through wallet-sdk.

10. **What looks fine**

The pivot itself is good. The reasoning is better than v2 for the actual user flow. The new error class shape is consistent with existing `WalletError` patterns. Keeping Phase 1.5 unchanged is correct. The branch rename is better than the old one.