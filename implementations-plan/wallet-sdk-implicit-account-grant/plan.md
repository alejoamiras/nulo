# wallet-sdk-implicit-account-grant

Status: **draft, pre-audit** (to be reviewed in parallel by codex `xhigh` + an opus 4.7 audit subagent before consolidation)
Owner: Alejo
Target branch: `feat/wallet-sdk-implicit-account-grant` off `dev`
Target PR: single squash-merge into `dev`

---

## 1. Context

Two third-party dApps fail at the same point in our wallet handshake:

| dApp | URL | Failure copy |
|---|---|---|
| **Nethermind Aztec Faucet** (Fee Juice bridge) | [github.com/nethermind/aztec-faucet](https://github.com/nethermindeth) — cloned locally at `/Users/alejoamiras/Projects/Ecosystem/aztec-faucet` | "Your wallet has no Aztec account yet." |
| **Wonderland Token Dripper** | [token-dripper-app.vercel.app](https://token-dripper-app.vercel.app/) (closed source) | "No accounts available in connected wallet" |

Both pages successfully:
1. Discover the wallet
2. Allow the connection
3. Match the verification emojis

Both pages then break at **account selection**, before the user can pick which account to use.

Our own `/packages/playground` works because it calls `wallet.requestCapabilities(...)` after `confirm()`. The two failing dApps call `wallet.getAccounts()` first.

---

## 2. Root cause (high confidence)

### What the failing dApps do

`/Users/alejoamiras/Projects/Ecosystem/aztec-faucet/src/lib/use-wallet-connect.ts:84-114`:

```ts
const wallet = await confirmConnection(prev.pending);

let rawAccounts: unknown[] | undefined;
try {
  const accounts = await wallet.getAccounts();          // ← primary
  rawAccounts = Array.from(accounts as unknown[]);
} catch {
  const granted = await wallet.requestCapabilities(faucetCapabilities());  // ← fallback
  // …
}

if (!rawAccounts || rawAccounts.length === 0) {
  setPhase({ kind: "error", message: "Your wallet has no accounts…" });
  return;
}
```

The fallback only triggers if `getAccounts()` **throws**. If it returns `[]`, the dApp surfaces "no accounts".

Wonderland is closed-source but the failure point + error string are isomorphic. Per the user's decision (see §11), we trust the symptom match rather than reverse-engineering the bundle.

### What our wallet does

`packages/wallet-bridge/src/dispatcher.ts:253-276` (`WalletSdkDispatcher.handleGetAccounts`):

```ts
private async handleGetAccounts(ctx: SessionContext): Promise<unknown> {
  const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(
    ctx.origin, String(ctx.chainId),
  );
  if (!dappSession) throw new Error(`No dApp session found for origin ${ctx.origin}`);

  // No accounts yet — dApp should call requestCapabilities() with accounts type first
  if (!dappSession.accounts || dappSession.accounts.length === 0) {
    return [];   // ← lands here right after discovery
  }
  …
}
```

At discovery time (`packages/extension/src/wallet/services/wallet-sdk/background.ts:396-406`), we deliberately create the session with **empty accounts and zero capability grants**:

```ts
const newSession = await dappSessionService.addDappSession(
  params.dappMetadata,
  [{ methods: [] }],
  [], // empty accounts — will be populated via getAccounts()
  AccessLevel.Transactions,
  chainId,
);
await dappSessionService.setCapabilityGrants(newSession.id, []);
```

The intent of that design is: accounts are first attached when the dApp calls `requestCapabilities({ type: "accounts" })`, which opens our `/windows/capabilities` popup. The wallet-sdk skill flags `getAccounts()`-first as a footgun (lines 1470-1479), but dApps in the wild are doing it anyway, and we silently return `[]`.

### Why our own playground works

`packages/playground/src/lib/wallet.ts:62-93,125-136` — calls `requestCapabilities()` after `confirm()` (the canonical flow). It never relies on `getAccounts()` to drive account state. So it never hits the empty-return path.

### Why other wallets work

External wallets are expected to either:
1. Disallow `getAccounts()` before `requestCapabilities()` (and throw), or
2. Treat `getAccounts()` as an implicit accounts-capability request (lazy grant).

The Aztec wallet-sdk has not settled this contract upstream. Our current behavior — return `[]` silently — is the worst of both worlds because it neither triggers the dApp's fallback nor returns useful data.

---

## 3. Design decision — lazy implicit grant

**Decision (per §11 Q1):** when `wallet.getAccounts()` is called on a session that has no accounts grant yet, we treat it as an implicit `requestCapabilities([{ type: "accounts", canGet: true }])` and trigger the same `/windows/capabilities` popup we already use for the explicit path. After approval, the granted accounts populate the session and are returned to the dApp.

### Why lazy implicit grant (Option A) wins over the alternatives

| Option | Why rejected |
|---|---|
| **B: Throw a clear error** | Would trigger the faucet's fallback to `requestCapabilities()` — but only for dApps that *have* a fallback. dApps that don't (likely Wonderland) stay broken. Also produces a worse UX for the well-behaved case: an internal error string leaks into the dApp's display. |
| **C: Eager grant at discovery** | Requires changing the discovery popup to also pick accounts. Doubles the discovery popup's scope, breaks separation of "establish channel" from "grant scope", and would force a redesign for any dApp that already calls `requestCapabilities()` after discovery (they'd see two account selectors). |
| **A: Lazy implicit grant** | One-popup UX matches what dApps assume. No change for dApps that use `requestCapabilities()` correctly. No change to the discovery popup. Reuses the existing `/windows/capabilities` plumbing. Wins. |

### Contract that the fix establishes

| `getAccounts()` arrives and... | Behavior | Reason |
|---|---|---|
| Session has accounts | Return them (current behavior) | Preserves the working path |
| Session has zero accounts AND zero `accounts` grant AND no prior rejection | Open `/windows/capabilities` with `delta = [{type:"accounts",canGet:true}]`. Approve → persist grant + selected accounts, return them. Reject → persist rejection, return `[]`. | Lazy grant, single popup |
| Session has zero accounts AND `accounts` grant exists (somehow desynced) OR prior rejection persisted | Return `[]` without opening a popup | **No popup-loop on rejection.** dApp shows its "no accounts" UX honestly. |

The dApp can always force a re-prompt by calling `requestCapabilities([{type:"accounts"}])` explicitly — the existing re-request path (`reRequested` array in the dispatcher) handles this correctly.

---

## 4. Implementation phases

### Phase 1 — Dispatcher contract change

**Files touched**

- `packages/wallet-bridge/src/dispatcher.ts`
- `packages/wallet-bridge/src/dispatcher.test.ts` (extend, do not duplicate)

**Change shape**

In `WalletSdkDispatcher.handleGetAccounts` (dispatcher.ts:253-276):

```ts
private async handleGetAccounts(ctx: SessionContext): Promise<unknown> {
  const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(
    ctx.origin, String(ctx.chainId),
  );
  if (!dappSession) throw new Error(`No dApp session found for origin ${ctx.origin}`);

  // Fast path: already-granted accounts.
  if (dappSession.accounts && dappSession.accounts.length > 0) {
    return this.formatSessionAccounts(dappSession, ctx);  // extracted from current return body
  }

  const grants = dappSession.capabilityGrants ?? [];
  const rejections = dappSession.capabilityRejections ?? [];
  const hasAccountsGrant = grants.some((g) => g.capability.type === "accounts");
  const accountsPreviouslyRejected = rejections.some((r) => r.capabilityType === "accounts");

  // Already settled (either granted-but-no-accounts-chosen, or explicitly rejected).
  // Returning [] avoids a popup loop. dApps can force re-prompt via requestCapabilities().
  if (hasAccountsGrant || accountsPreviouslyRejected) return [];

  // Lazy grant: trigger an implicit accounts-capability request.
  const syntheticManifest = {
    version: "1.0" as const,
    metadata: this.synthMetadataForImplicit(dappSession),  // pulls name/url from existing session
    capabilities: [{ type: "accounts" as const, canGet: true, canCreateAuthWit: false }],
  };

  try {
    await this.handleRequestCapabilities(syntheticManifest, ctx);
  } catch {
    // handleRequestCapabilities already persists the rejection on user-reject.
    // Return [] — the dApp surfaces its own "no accounts" UX.
    return [];
  }

  // Re-load session and return the now-populated accounts.
  const refreshed = await this.dappSessionService.getDappSession(dappSession.id);
  return this.formatSessionAccounts(refreshed, ctx);
}
```

Notes:

- Extract the existing "format session accounts" code into `formatSessionAccounts(session, ctx)` to keep the fast path and the post-grant path in lockstep.
- `synthMetadataForImplicit` derives `name` + `url` from `dappSession.dappMetadata` so the popup shows the same identity strip the user already vetted at discovery time.
- The `try/catch` is intentionally narrow: anything thrown from `handleRequestCapabilities` (user reject, popup error, internal failure) collapses to `[]`. The `handleRequestCapabilities` body already writes the rejection record before re-throwing.
- We do not alter `EXEMPT_METHODS` in `capability-map.ts`. `getAccounts` stays exempt from the type-level `enforceCapability` check; lazy grant is internal to this handler.

**Why this is small and self-contained**

- One function changes shape; one helper extracted.
- No popup component changes (Phase 2 verifies this).
- No protocol changes; the wire schema is identical from the dApp's perspective — `getAccounts` still returns `Aliased<AztecAddress>[]`.

### Phase 2 — Verify popup UX with implicit `delta`

**Files touched (verify, may not need edits)**

- `packages/extension/src/popup/windows/capabilities/index.vue:99-120` — the loop that builds capability cards already `continue`s on `cap.type === "accounts"` (the `accounts` capability is rendered as `AccountSelectRow`, not as a regular capability card). When `delta = [{type:"accounts"}]`, the result is a popup with:
  - `DappStatusStrip` + `DappIdentityBlock` (dApp identity)
  - `AccountSelectRow` (account list with checkboxes)
  - No `CapabilityCard` items — the popup degrades to a clean "pick which account to share" surface

- `packages/extension/src/popup/windows/capabilities/AccountSelectRow.vue` — verify the heading / submit copy reads sanely when this is the *only* card. Today the row says "Share your accounts" via `capability-meta.ts:14-19`. That's already appropriate.

**Possible copy tweak (subject to A/B sanity-check during impl)**

If the implicit-only popup looks bare, add a one-line subtitle when `delta.length === 1 && delta[0].type === "accounts"`:

> "This site is asking to see your accounts. Pick which ones to share."

Keep it short, brutalist-styled, lower-case rhythm matching the rest of the popup. Do not introduce a separate popup variant — same `/windows/capabilities` route, conditional copy.

**Component test added in Phase 3:**

- `CapabilityCard.test.ts` or `index.vue.test.ts` (place next to the file per project convention) — assert that when `payload.params.delta = [{type:"accounts"}]`, the popup renders `AccountSelectRow` and zero `CapabilityCard`s.

### Phase 3 — Tests (target: succinctness, full coverage of contract from §3)

**Unit — `packages/wallet-bridge/src/dispatcher.test.ts`** (4 new tests, ≈40 LOC each):

| # | Name | What it asserts |
|---|---|---|
| 1 | `getAccounts — session has accounts → returns them, no popup` | Regression pin for the fast path. |
| 2 | `getAccounts — empty session, no grants, popup approved → returns granted accounts + persists grant` | Happy path of the new behavior. Verifies grant is added so subsequent calls hit the fast path. |
| 3 | `getAccounts — empty session, no grants, popup rejected → returns [] + persists rejection` | Rejection contract. Verifies no popup loop on next call. |
| 4 | `getAccounts — empty session, accounts grant already exists OR prior rejection → returns [] without popup` | Two cases in one parameterized test. Verifies the loop-suppression. |

Use the existing `makeSessionWriter` + `makeDispatcher` helpers (dispatcher.test.ts:43-77). Mock `requestCapabilities` impl via the existing `IDappInteractionRunner` stub pattern.

**Component — `packages/extension/src/popup/windows/capabilities/index.vue.test.ts`** (1 new test, may need to create the file):

- `renders only AccountSelectRow when delta is accounts-only` — drives the popup with a mocked `useDappInteractionPayload` returning `delta=[{type:"accounts"}]` + `availableAccounts=[…]`. Asserts the rendered DOM contains `AccountSelectRow` and no `CapabilityCard` stubs. Verifies copy from Phase 2 if a subtitle is added.

**Smoke e2e — `packages/extension/tests/e2e/...`**:

Add one e2e scenario in the existing `e2e:smoke` suite (no Aztec sandbox required since the dispatcher works purely on session state and stubbed services):

- `dapp calls getAccounts before requestCapabilities → user approves → dapp receives accounts`. Drive via a new playground button (Phase 4) or by reusing the existing dapp-stub fixture.

If the playground already covers it via a smoke harness, we extend the existing harness rather than creating a new one.

**Out of scope (per §11 Q2):** network e2e against a real aztec sandbox. We verify Nethermind + Wonderland manually post-deploy.

### Phase 4 — Playground hook for smoke testing

**File touched:** `packages/playground/src/sections/connect.ts`

Add a button next to the existing `[pg-btn-requestCapabilities]`:

```html
<button data-testid="pg-btn-getAccounts" type="button" ${s.status === "connected" ? "" : "disabled"}>
  getAccounts (no capabilities)
</button>
```

Wire it to a new `getAccountsRaw()` function in `packages/playground/src/lib/wallet.ts` that calls `wallet.getAccounts()` directly — same shape as our existing `requestCapabilities` button. This gives us:

- A repro of the failing dApp flow against our local extension build
- A handle for the smoke e2e in Phase 3 to drive deterministically

### Phase 5 — Manual verification matrix (post-merge)

Per §11 Q4 (user picked "Just Nethermind + Wonderland"):

| dApp | Path | Expected pass criterion |
|---|---|---|
| Nethermind faucet | Connect → Verify emojis → "Choose account" popup opens (our `/windows/capabilities`) → user picks 1 → faucet shows that account address | "Your wallet has no Aztec account yet" no longer fires. Faucet proceeds to drip flow. |
| Wonderland Token Dripper | Same flow | "No accounts available in connected wallet" no longer fires. Page shows the connected account. |

If either still fails, reopen with the actual error string surfaced — a new diagnosis cycle starts.

---

## 5. Test plan summary (succinctness check)

Per the universal workflow + testing philosophy in `~/.claude/CLAUDE.md`: succinctness over volume. Each test is the **smallest** thing that proves a distinct part of the contract.

```
Unit (dispatcher.test.ts):     4 new tests   (covers all 4 contract rows in §3)
Component (capabilities popup): 1 new test    (verifies popup degrades cleanly)
Smoke e2e (playground):         1 new test    (end-to-end flow against real popup)
                               ─────────────
Total new tests:                6
```

No duplicate coverage. No "miscellaneous safety" tests. Each test pins one row of the contract.

---

## 6. Security & Adversarial Considerations

Per `~/.claude/CLAUDE.md` Security & Adversarial mindset. Threat-modeled against the new lazy-grant surface; this section is the explicit ask for both audit agents.

### Threat: popup spam from a malicious dApp

A hostile dApp could call `getAccounts()` in a tight loop trying to spam the user with account-grant popups.

**Mitigation:** the contract in §3 says — once a rejection is persisted, subsequent `getAccounts()` calls return `[]` without re-opening the popup. The dApp must call `requestCapabilities()` explicitly to re-prompt, and that path already runs through user-controlled UI. Verified by Test #4.

### Threat: capability scope creep via the implicit path

The implicit grant gives only `{ type: "accounts", canGet: true, canCreateAuthWit: false }`. It does NOT grant `simulation`, `transaction`, `data`, or `canCreateAuthWit`. Any subsequent method that needs those caps must still go through the regular `requestCapabilities` flow and re-prompt.

**Mitigation:** the synthetic manifest is hardcoded in the dispatcher (Phase 1). The dApp cannot influence the synthetic shape. Verified by reading the diff.

### Threat: confused-deputy via stale session metadata

The implicit popup is generated using metadata from `dappSession.dappMetadata`, which was captured at discovery time. If a dApp could mutate that metadata between discovery and `getAccounts`, the user might see a misleading name.

**Mitigation:** `dappSession.dappMetadata` is written once at `dappSessionService.addDappSession(...)` (background.ts:396) and is not updated by dApp messages. The wallet-sdk's `DappMetadata` flows from the discovery params, which are origin-bound. There is no current write path from a wallet message back to dapp metadata. Verified by inspection of `DappSessionService` — confirm during impl review.

### Threat: cross-origin / cross-chain replay

`handleGetAccounts` looks up the session by `(origin, chainId)`. The lazy grant inherits that scoping — it grants `accounts` only for the specific `(origin, chainId)` pair, never globally.

**Mitigation:** same lookup key used as before; no new code path bypasses it. Verified by reading the diff.

### Threat: race between discovery-approval and implicit getAccounts

If a dApp races `getAccounts()` immediately after `confirm()`, before the session has fully persisted, we might throw `No dApp session found`. Today that already happens occasionally — the dApp's fallback should retry.

**Mitigation:** the session is created synchronously inside the discovery popup approval flow (`background.ts:382-410`) before `approveDiscovery` is called, so by the time the dApp sees the secure channel ready, the session row exists. We do not change this ordering.

### Threat: malicious origin name in the popup

Popup metadata includes the dApp's claimed name; the URL is the source of truth. Existing `useDappHostname` composable already flags `isSuspicious: hostnameHasNonAscii` (capabilities/index.vue:73). The implicit-grant path reuses this composable unchanged.

**Mitigation:** no change — inherited from the existing popup.

### Threat: supply chain

No new dependencies introduced. `bun.lock` unchanged. `bun audit` unchanged.

### Threat: data exfiltration via account aliases

Per-app aliases are already in use (`dispatcher.ts:271-274`). The lazy-grant path resolves aliases the same way. Aliases set in one dApp are not leaked to another.

**Mitigation:** existing behavior preserved.

### Crypto

No change. ECDH, AES-GCM, emoji verification, capability signing — all unchanged. The encrypted channel still gates every message.

### Least privilege

The synthetic manifest is the smallest possible accounts grant (`canGet: true, canCreateAuthWit: false`). The dApp cannot escalate to `canCreateAuthWit` without an explicit follow-up `requestCapabilities`.

---

## 7. UX / copywriting

Per the user's note: "If we are doing some frontend work take your time to think the best copies."

- **Capability popup** when triggered implicitly via `getAccounts`: keep the existing `AccountSelectRow` heading ("Share your accounts" per `capability-meta.ts:14-19`). Verify it reads clearly in isolation. If anything feels off, the candidate subtitle is:

  > "this site is asking which accounts to share. pick one or more to continue."

  Brutalist lower-case, terse, no marketing flourish.

- **No copy changes on the failing-dApp side** — those are their own codebases. We document the discovered footgun in our wallet-bridge README so future audits / partner integrations know.

- **No copy changes in the dispatcher error paths** — the only user-facing path is the popup. Internal `throw` strings stay technical (they only surface in dApp consoles).

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Popup feels weird in isolation when delta is accounts-only | Medium | Low | Phase 2 verifies; copy tweak option is reserved. |
| `handleRequestCapabilities` recursion (synthetic manifest re-enters dispatch) | Low | High (stack overflow) | We call `handleRequestCapabilities` directly, NOT via `dispatch("requestCapabilities", …)`. Direct call avoids the enforceCapability → enforceScope → dispatch loop. Verified during impl. |
| dApps that DO call `requestCapabilities` after `confirm()` see two popups | Low | Medium | Only happens if the dApp also called `getAccounts` first. The popup is the same `/windows/capabilities` route, so the second call's delta will be empty (existing grant covers accounts) and the second popup will be suppressed by the existing `delta.length === 0` early return in `handleRequestCapabilities` (dispatcher.ts:387-399). Verified by inspection — call out in audit. |
| Wonderland is doing something different we're not seeing | Low | Medium | Manual verification post-deploy. If Wonderland still fails, we open a follow-up plan. |
| Existing playground tests rely on `connect → requestCapabilities` ordering and break | Low | Low | Playground change is additive (new button, new fn). No existing function modified. |

---

## 9. Roll-out

1. Branch `feat/wallet-sdk-implicit-account-grant` off `dev`.
2. Land Phase 1 + 3 (dispatcher + tests) as the smallest unit. Commit + open PR.
3. Land Phase 2 (popup copy verification + component test) on the same PR — they're small.
4. Land Phase 4 (playground button) on the same PR.
5. `bun run audit:vue` locally before push.
6. PR → `dev` → squash merge.
7. Build the extension, side-load, perform §5 manual verification.
8. Document the fix in `packages/wallet-bridge/README.md` (one paragraph) so future contributors know about the lazy grant.

No release-channel work in this plan. Whatever release the next promote to `main` carries will include the fix.

---

## 10. Files touched (final list)

```
packages/wallet-bridge/src/dispatcher.ts                          [edit]
packages/wallet-bridge/src/dispatcher.test.ts                     [extend]
packages/wallet-bridge/README.md                                  [append]
packages/extension/src/popup/windows/capabilities/index.vue       [verify + tiny copy]
packages/extension/src/popup/windows/capabilities/index.vue.test.ts [new]
packages/playground/src/sections/connect.ts                       [add button]
packages/playground/src/lib/wallet.ts                             [add getAccountsRaw]
packages/extension/tests/e2e/<scenario>.test.ts                   [new — TBD location]
implementations-plan/wallet-sdk-implicit-account-grant/plan.md    [this file]
implementations-plan/wallet-sdk-implicit-account-grant/lessons/   [populated during impl]
```

---

## 11. Closed clarifying questions (user-confirmed, captured for auditor context)

| # | Question | Answer | Implication |
|---|---|---|---|
| Q1 | Behavior of `getAccounts()` when called pre-capabilities | **Lazy account grant** (Option A) | §3 design |
| Q2 | Test depth | **Unit + component + smoke e2e** (no network e2e) | §4 Phase 3 |
| Q3 | Reverse-engineer Wonderland bundle | **No — trust the symptom match** | §2 root cause section + §5 verification |
| Q4 | Other dApps to verify against | **Just Nethermind + Wonderland** | §5 verification matrix |

---

## 12. Open questions for auditors

These are intentionally surfaced for the codex `xhigh` + opus 4.7 audit cycle:

1. **Synthetic-manifest recursion safety.** The dispatcher calls `this.handleRequestCapabilities(syntheticManifest, ctx)` directly (not via `dispatch`). Is there any code path inside `handleRequestCapabilities` that could re-enter `dispatch("getAccounts", …)` and loop? Read dispatcher.ts:358-512 with this in mind.

2. **Rejection persistence as DoS surface.** Once a user rejects, we return `[]` forever. A dApp that legitimately needs to re-prompt has to call `requestCapabilities([{type:"accounts"}])` explicitly. Is that good enough, or should we time-out the rejection (e.g., after 24h) to allow soft retries? Default position: no timeout — explicit re-request is intentional UX, not friction.

3. **Implicit grant popup discoverability.** If a user has already approved 5 capabilities for a dApp and later the dApp calls `getAccounts()` on a fresh session (e.g., after logout), the implicit popup will re-appear. Is that the right behavior, or should we persist a flag "this dApp already had accounts granted" across session resets? Default position: per-session is correct — session reset = full re-consent.

4. **Should the synthetic manifest be marked in any wire-visible way?** Currently it's indistinguishable from a normal `requestCapabilities([{type:"accounts"}])` call from the popup's perspective. The popup user has no way to know "this was triggered by `getAccounts`, not an explicit request". Is that a defect or a feature?

5. **Wonderland symptom assumption.** We assume Wonderland's "No accounts available in connected wallet" string comes from the same `getAccounts() === []` path. If Wonderland is actually doing something different (e.g., calling `requestCapabilities` correctly but mishandling the response), the fix won't help them. Should the audit include any cheap sanity check we haven't done?

6. **`canCreateAuthWit: false` in the synthetic manifest.** Is that the right default? A dApp doing `getAccounts → claim_via_wallet` (like the Nethermind faucet) does NOT need `canCreateAuthWit` to claim Fee Juice. But a dApp doing a bridge exit does. They'd need to call `requestCapabilities` explicitly. Is that a footgun we're swapping for the original one?

7. **Adversarial review (explicit ask for both auditors):** *What could go wrong? What would an attacker target? What are we trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses in this change?*

---

## 13. ASCII state tracker

```
[✓] 0. Clarifying questions
[✓] 1. Plan drafted
[ ] 2. Codex xhigh audit
[ ] 2. Opus 4.7 audit (parallel)
[ ] 3. Consolidate audits
[ ] 4. Final codex review of consolidated plan
[ ] 5. ELI5 HTML companion
[ ] 6. Approval gate
[ ] 7. Implementation
[ ] 8. Post-impl codex review
[ ] 9. Fix loop
```
