**Verdict**: ship-with-changes

**Absorption check**

- **Phase 1.5 (`accounts`-only field-aware diff):** sufficient for this PR. That was the minimum acceptable scope, and you’ve explicitly filed the breadth follow-up. I would not block on fixing `contracts`/`simulation`/`transaction`/`data` in the same PR.
- **Phase 1.6 (implicit vs explicit rejection + 1h TTL):** this does address the “sticky implicit rejection is a usability DoS” concern. It’s a real improvement. The new risk is not the TTL itself; it’s future misuse of the `implicit` flag. More on that below.
- **Narrower error handling:** the rule is basically right. If the popup path did not persist an implicit rejection, the error should propagate. I do not see an important popup failure mode that should silently degrade to `[]` without a rejection record.
- **Inflight dedupe `Map`:** the `map.get()` → `map.set()` sequence is fine. There is no `await` between them, so no same-turn race in JS. The only thing duplicated under burst is the preflight read work, which is cheap.
- **Dropped `synthMetadataForImplicit`:** correct.
- **Dropped Phase 4 playground addition:** correct.
- **What you missed from v1:** v2 now depends on `payload.params.implicit`, but the plan’s touched-files list does **not** include `packages/wallet-bridge/src/dapp-interaction-protocol.ts`, where `CapabilityParams` is declared. Right now that type has no `implicit` field. That is a real plan gap.
- **What else is weak:** the CTA route assumption is wrong. The route present in the codebase is `/popup/profile/new`, not `/profile/new`.

**New risks v2 introduces**

- **Wall-clock TTL drift:** `Date.now()` skew, sleep, or manual clock changes only affect suppression duration. Forward skew expires early; backward skew can prolong suppression. That is a UX edge, not a security issue. I’d clamp negative elapsed to `0` and move on.
- **Inflight map growth:** low risk. It is bounded by active unresolved implicit interactions and cleaned up in `.finally()`. The real bound is the popup timeout in `DappInteractionService`, so this is not an unbounded memory-growth vector in practice.
- **`implicit?: boolean` omission:** omission fails closed. If someone forgets to set it on the implicit path, rejection becomes explicit/sticky, which is over-harsh but not permissive.
- **`implicit?: boolean` misuse:** the dangerous direction is future code passing `implicit:true` on a broader manifest than accounts-only. That would TTL-soften rejections that should stay explicit. Add an assertion: implicit mode is only legal for exactly one `accounts` capability.
- **CTA flow orphaning:** biggest new plan risk. If the capabilities window routes itself to profile creation without first resolving/rejecting the interaction, the dApp request hangs until timeout.

**§6 completeness**

Still missing three things:

- **Mixed-path popup stacking:** inflight dedupe only covers implicit `getAccounts`. A malicious dApp can open an implicit popup and then concurrently call explicit `requestCapabilities`, yielding a second popup. This is mostly covered by your rate-limit follow-up, but name it explicitly.
- **Internal API misuse guard:** §6 should say `implicit:true` is only valid for accounts-only lazy grant, and the dispatcher enforces that.
- **Cross-tab TTL semantics:** one implicit rejection on `(origin, chainId)` suppresses the popup across all tabs for that dApp/session scope. That is probably intended, but it should be documented as shared-session behavior.

**v2 open-question triage**

- **Q1:** `accounts`-only is acceptable for this PR.
- **Q2:** 1 hour is reasonable. Better than 15 min, less annoying than 24h. I would keep it.
- **Q3:** `Info` is correct. Zero visible accounts is expected user state, not a wallet fault.
- **Q4:** use `/popup/profile/new`, not `/profile/new`. More importantly: do not route there without first cancelling or resolving the current interaction.
- **Q5:** add one more follow-up only if you do not fold it into the existing rate-limit plan: “general capability-popup inflight dedupe across implicit + explicit paths.”
- **Q6:** yes, log implicit popup invocations and outcomes. Low-cost telemetry, useful for support/debugging.
- **Q7:** no same-turn race in `map.get`/`map.set`; the real remaining race is concurrent implicit + explicit capability requests, not dedupe-map corruption.

**Final adversarial review**

What an attacker targets in v2:

- **Popup layering:** not by spamming `getAccounts` anymore, but by combining implicit `getAccounts` with explicit `requestCapabilities` while the first popup is still open.
- **TTL boundary behavior:** a hostile dApp can retry once the cooldown expires. That is acceptable; it is not worse than explicit re-request spam, which you already scoped out.
- **Mislabelled rejection provenance:** if future code accidentally marks an explicit rejection as implicit, you weaken deny semantics. That is why the dispatcher-side assertion matters.
- **Interaction orphaning:** the “Create account” CTA is the sharpest operational bug. If it navigates away without settling the request, the dApp sees a hanging wallet call, not a clear deny/retry.
- **Least privilege:** still coarse. You have correctly documented that the synthetic grant authorizes the current `accounts` bucket as implemented. That is honest.
- **Supply-chain / crypto:** no new issue. No protocol or dependency delta.

**Remaining blockers**

1. **Fix the hollow-state CTA flow.**
   - Use the actual route: `/popup/profile/new`.
   - Do not navigate away while the capability interaction is unresolved.
   - Best option: reject/cancel the current interaction, then open the profile-creation flow separately.

2. **Add `implicit?: boolean` to `CapabilityParams` and include the file in the plan.**
   - `packages/wallet-bridge/src/dapp-interaction-protocol.ts`
   - Otherwise the popup subtitle path is relying on an undeclared field.

3. **Add a dispatcher guard for implicit mode.**
   - If `opts.implicit === true`, require the manifest to be exactly one `accounts` capability.
   - This prevents future accidental TTL-softening of broader explicit rejections.

**What looks fine**

The core v1 findings were absorbed correctly. The `accounts`-shape fix is scoped tightly but appropriately. The no-accounts preflight plus popup hardening is the right layered approach. The narrowed catch is materially better. The dedupe design is sound. Once the CTA/orphaning issue and the missing `implicit` type are fixed, this is shippable.