1. **Verdict:** ship-with-changes.

2. **Diagnosis correctness**

Your primary diagnosis holds.

- `handleGetAccounts()` returns `[]` purely when `dappSession.accounts` is empty; it does not consult grants before that branch. That is exactly `packages/wallet-bridge/src/dispatcher.ts:253-262`.
- Discovery creates the session with empty accounts, then explicitly sets empty capability grants at `packages/extension/src/wallet/services/wallet-sdk/background.ts:396-406`.
- Nethermind faucet does `getAccounts()` first, only falls back to `requestCapabilities()` on throw, and errors on empty array at `/Users/alejoamiras/Projects/Ecosystem/aztec-faucet/src/lib/use-wallet-connect.ts:92-113`.

I do not see evidence that `confirm()` or the discovery handler is the root bug. Discovery persists the session before `approveDiscovery()` at `background.ts:396-409`, so by the time the dApp proceeds, the empty session is intentionally there. This is not a race-first diagnosis; it is a contract mismatch.

There is one other code path that can produce a similar symptom and your plan underweights it: zero visible accounts on the target chain. `AccountService.getAccounts()` filters by `visible` unless `all` is passed (`packages/extension/src/wallet/services/account/service.ts:52-55`). If that returns zero, your proposed implicit flow opens an accounts popup with no selectable accounts. That is a separate failure mode from the faucet bug.

3. **Design correctness**

Treating `getAccounts()` as a lazy implicit accounts grant is a reasonable compatibility shim. It also matches the shape of other wallet implementations better than your current silent `[]`; your local demo wallet’s `getAccounts` operation is itself an authorization flow (`/Users/alejoamiras/Projects/demo-wallet/shared/src/wallet/operations/get-accounts-operation.ts:102-150`).

So: as a pragmatic production-wallet fix, yes.

But your plan overstates the “smallness” of the grant.

- In your dispatcher, `accounts` is a coarse capability type for `getCompleteAddress`, `createAuthWit`, and `registerToken` (`packages/wallet-bridge/src/capability-map.ts:19-21`).
- `canCreateAuthWit` is enforced in scope enforcement (`packages/wallet-bridge/src/scope-enforcement.ts:241-249`).
- `canGet` is not enforced anywhere. So the implicit grant is not “just let them call `getAccounts()`”; it authorizes the current `accounts` capability bucket as implemented.

The bigger design problem is this: `handleRequestCapabilities()` does not diff capabilities by semantics, only by `cap.type` (`dispatcher.ts:374-385`). That makes your assumption C dangerous, not reassuring.

Concrete failure:

- implicit grant stores `{ type:"accounts", canCreateAuthWit:false }`
- later dApp explicitly requests `{ type:"accounts", canCreateAuthWit:true }`
- current code treats that as already granted, so no popup
- `enrichGrantedCapabilities()` uses the **requested** capability as the response template (`dispatcher.ts:524-548`)

So the dApp can get back a response that appears to grant `canCreateAuthWit:true`, while stored grants still have `false`. That is a real protocol correctness bug, and your plan currently leans on it as if it were a feature.

4. **Implementation risks**

Inference B: recursion is safe. I do not see a path from `handleRequestCapabilities()` back into `dispatch("getAccounts")`. `DappInteractionService.requestCapabilities()` just opens the popup and resolves it (`packages/extension/src/wallet/services/dapp-interaction/service.ts:150-155`).

But your stated reason for calling `handleRequestCapabilities()` directly is wrong. `dispatch("requestCapabilities", …)` would also be safe because `requestCapabilities` is exempt in `enforceCapability()` and won’t hit scope enforcement (`dispatcher.ts:213-227`, `560-574`). Direct call is fine; the rationale is off.

`availableAccounts` loading does work for an accounts-only manifest (`dispatcher.ts:406-417`).

The catch-all `try { … } catch { return [] }` is not acceptable as written. It will swallow:

- storage corruption
- failed grant writes
- failed rejection writes
- network/account resolution errors
- popup plumbing errors

That turns wallet bugs into false “no accounts” results. Better rule: after catch, re-read session. Only degrade to `[]` if an `accounts` rejection was actually persisted. Otherwise rethrow.

There is also a hollow-popup bug: when `availableAccounts` is empty, the popup sets a toast but does not require selection (`packages/extension/src/popup/windows/capabilities/index.vue:100-109`, `167-183`). For an accounts-only delta, that leaves a popup with no account rows and no capability cards. Approving it effectively records a rejection without the user explicitly rejecting.

5. **Test plan adequacy**

The proposed 4 unit + 1 component + 1 e2e is not enough.

Missing tests that matter:

- `implicit accounts(false authwit) -> explicit accounts(true authwit)` must reprompt and persist the upgraded grant. Current code will fail this.
- zero available accounts on chain should not open an empty approval popup and should not silently record rejection on approve.
- implicit rejection persistence across reconnect. Discovery auto-approves existing sessions (`background.ts:317-324`), so a broken dApp that only calls `getAccounts()` becomes soft-bricked after one rejection unless the session is cleared.
- concurrent `getAccounts()` calls from the same session. Right now there is no dedupe comparable to discovery dedupe.

Also: your Phase 4 playground addition is obsolete. `pg-btn-getAccounts` already exists in `packages/playground/src/sections/meta.ts:19,47-50`, and there is already a post-grant e2e around it at `packages/extension/tests/e2e/network/meta-getAccounts.test.ts:11-49`.

6. **Security & adversarial**

Your security section is too optimistic.

- Popup spam: rejection persistence only stops spam after the first request settles. A malicious dApp can fire multiple `getAccounts()` calls before any rejection/grant is written and open multiple popups. There is no per-session inflight capability dedupe.
- Least privilege: the implicit grant is broader than the plan says because `accounts` is a coarse method bucket and `canGet` is unenforced.
- Sticky rejection is a usability DoS. Because sessions persist and discovery auto-approves remembered sessions, a single accidental reject can poison a non-compliant dApp for the lifetime of the session.
- Error swallowing is dangerous. You can end up with partially updated session state and no surfaced failure.
- Metadata confused-deputy risk looks low. `dappMetadata` is written at session creation (`dapp-session/service.ts:123-127`) and not mutated by update paths (`142-165`, `220-260`). Also the popup uses `payload.session.dappMetadata`, not manifest metadata.
- No crypto delta. No supply-chain delta.

The missed one is capability-confusion: `enrichGrantedCapabilities()` can overstate what was granted because it echoes requested fields. That is not privilege escalation, but it is a protocol boundary lie.

7. **Open-question triage**

1. Recursion safety: yes, safe.
2. Rejection timeout: for explicit `requestCapabilities`, no timeout is fine. For `getAccounts`-only dApps, indefinite sticky rejection is too punitive unless you give a clear recovery path.
3. Re-consent after session reset: per-session is fine.
4. Mark synthetic manifest: not wire-visible. Add internal telemetry/logging instead.
5. Wonderland assumption: still unverified. Keep it as a risk, not a premise.
6. `canCreateAuthWit:false`: correct default, but later upgrade is broken under current type-only diffing.
7. Add one more open question: do you need per-session inflight dedupe for capability popups?

8. **Concrete edits**

- Rewrite §3/§8 to say this is a compatibility shim, not protocol canon.
- Fix capability delta/merge logic to be field-aware, at minimum for `accounts.canCreateAuthWit`, and ideally for all scoped/flagged capability types.
- Replace the blanket catch with “return `[]` only if rejection state was persisted; otherwise throw.”
- Add a no-accounts preflight so implicit `getAccounts()` does not open a hollow popup.
- Add per-session inflight dedupe for implicit accounts grant, or explicitly accept popup-burst risk.
- Remove `synthMetadataForImplicit`; the popup identity comes from session metadata, not manifest metadata.
- Delete Phase 4 playground work from the plan; reuse existing `pg-btn-getAccounts`.

9. **What looks fine**

The root cause for Nethermind is real. Reusing the existing capabilities popup for an accounts-only delta is structurally fine. Recursion is not the problem. Reusing stored session metadata for identity is fine.

The plan is close on the top-level direction and wrong in a few important internals. The field-diff bug is the one that should stop you from implementing it as written.