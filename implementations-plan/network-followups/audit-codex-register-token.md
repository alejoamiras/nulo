Verdict: **quarantine it**

1. The math is real. The current failure is the **outer test timeout**, not a specific inner await. The signal is the wall time: `180054ms` with `retry: 2` means roughly `3 x 60s` exhausted, and the stack points at the `test.skipIf(...` declaration line in [register-token.test.ts:28](../../packages/extension/tests/e2e/network/register-token.test.ts:28). With a `60_000` test budget and inner waits of `60_000`, `60_000`, `30_000`, `30_000`, the test can die before any one inner wait individually times out.

2. `register-token` is slower than the other “basic bundle” tests because it stacks **two cold interaction flows** in one spec:
   - cold capabilities popup open + cold `availableAccounts` hydration
   - then a second execute popup + token metadata prefetch before confirm
   `cap-request-basic` only pays the first cost. `tx-sendTx-*` tests that chain capability + execute already use `90_000` to `180_000`.

3. If you insist on keeping it live, `120_000` is still too tight. The worst plausible path here is roughly:
   - `waitForPopup(capabilities)` up to 60s
   - `cap-account-item` up to 60s
   - `waitForPopup(execute)` up to 30s
   - `register-token-symbol` up to 30s
   - result wait up to 30s
   That is already `210s` of allowed inner waits. I would not keep iterating on 120 vs 180 blindly.

4. Your capabilities `initComplete` fix does **not** make `[data-testid="cap-account-item"]` render earlier. It only delays when Approve becomes clickable. So the extra 60s on `cap-account-item` remains logically justified, but it also proves this spec is now a cold-start budget problem, not the original popup race.

5. Restructuring could help later, but it is not the merge-path move. Pre-granting accounts in a fixture or splitting “grant cap” from “register token” would reduce stacked cold waits, but that is more test design work after 25+ CI iterations.

Single concrete next step:
- Move `register-token.test.ts` behind the same deferred-slow guard pattern as the documented slow tests, open Issue #59, and merge the branch. If you refuse quarantine, jump straight to `{ timeout: 180_000 }` as the only defensible non-quarantine budget.
