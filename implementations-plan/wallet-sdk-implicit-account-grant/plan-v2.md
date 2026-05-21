# wallet-sdk-implicit-account-grant — plan v2 (post-audit)

Status: **awaiting final codex review** then **awaiting user approval**
Owner: Alejo
Target branch: `feat/wallet-sdk-implicit-account-grant` off `dev`

**This is the active plan.** Plan v1 (`plan.md`) is kept as the pre-audit artifact for traceability. The audits (`audit-codex.md`, `audit-opus.md`) are the source of every revision listed in §14 below.

Both audits returned **ship-with-changes** verdicts on v1. They independently identified:

1. A **critical pre-existing bug** (shape-blind capability delta filter at `dispatcher.ts:374-385`) that the v1 plan would *amplify* — a dApp could escalate from implicit `canGet:true` to `canCreateAuthWit:true` without a popup.
2. A **high-impact UX dead-end** in the popup when the profile has zero accounts.
3. A handful of structural issues: dead code (`synthMetadataForImplicit`), obsolete plan phase (Phase 4 playground — button + e2e already exist), and a too-broad `try/catch` that would swallow real errors.

Plan v2 addresses all of these.

---

## 1. Context

Unchanged from v1 §1. Two third-party dApps (Nethermind Aztec Faucet, Wonderland Token Dripper) fail at account selection after a successful wallet connection. See `plan.md` §1 for the symptom table.

---

## 2. Root cause (extended)

The primary diagnosis from v1 §2 holds — both audits independently confirmed it:

- `handleGetAccounts` returns `[]` when `dappSession.accounts` is empty (`packages/wallet-bridge/src/dispatcher.ts:253-262`).
- Discovery creates sessions with empty accounts + zero grants (`packages/extension/src/wallet/services/wallet-sdk/background.ts:396-406`).
- Nethermind faucet's `getAccounts`-first fallback only triggers on throw (`/Users/alejoamiras/Projects/Ecosystem/aztec-faucet/src/lib/use-wallet-connect.ts:92-113`).

### New observations from the audits

**Consistency observation (opus):** The rest of the dispatcher already adopts a throw posture when accounts are missing — `resolveNetworkAndAccount` (`dispatcher.ts:766-784`) throws `"No accounts authorized..."` for other account-bound methods. `handleGetAccounts` returning `[]` is the **inconsistent** one. That strengthens the case for the fix: we're aligning `getAccounts` with the rest of the contract, not introducing a new pattern.

**Adjacent failure mode (codex):** `AccountService.getAccounts(profileId, chainId, all?)` filters by `visible` unless `all` is passed (`packages/extension/src/wallet/services/account/service.ts:52-54`). If a profile has only hidden accounts on the target chain, even the v1 popup flow would open with an empty `availableAccounts` list — a distinct failure mode that v1 missed and that interacts with Bug C below.

**Comment fix (opus):** `background.ts:391` says "*empty accounts — will be populated via getAccounts()*". That comment is misleading: today, accounts are populated via `requestCapabilities()`, not `getAccounts()`. The implicit-grant fix doesn't change that — `requestCapabilities` is still the explicit path; `getAccounts` becomes implicit. The comment should be tightened in this PR.

**Reference precedent (codex):** The local demo-wallet at `/Users/alejoamiras/Projects/demo-wallet/shared/src/wallet/operations/get-accounts-operation.ts:102-150` already implements `getAccounts` as an authorization flow. This is not a unique pattern — at least one other Aztec wallet treats `getAccounts` as a grant trigger. Our v1 silent-`[]` is the outlier.

---

## 3. Design — lazy implicit accounts grant (revised)

### Framing

This is a **compatibility shim**, not a protocol canon. The wallet-sdk spec (per the wallet-sdk skill, lines 1470-1481) says dApps SHOULD call `requestCapabilities` first. Two known dApps don't. Rather than break them, we make `getAccounts` work in the unprivileged case — but we do not normalize this in the spec or recommend it.

### Decision matrix (revised — adds Option D per opus, splits contract rows)

| Option | Why rejected |
|---|---|
| **B: Throw a clear error** | Triggers the faucet's fallback — but only if the fallback exists. dApps without a fallback stay broken. Internal error string leaks into the dApp's display. |
| **C: Eager grant at discovery** | Changes the discovery popup's scope. Forces redesign for dApps that already call `requestCapabilities` after discovery (double picker). |
| **D: Structured `4100`-style error code (opus)** | Cleaner than B in principle but requires upstream spec + dApp adoption we don't control. Same blocker as B. |
| **A: Lazy implicit grant (winner)** | One-popup UX. No change for well-behaved dApps. Reuses the existing `/windows/capabilities` plumbing. Aligns `getAccounts` with the rest of the dispatcher's throw-on-missing-auth posture. |

### Contract that the fix establishes (revised — desync row split out per opus)

| `getAccounts()` arrives and... | Behavior | Reason |
|---|---|---|
| Session has accounts (any count > 0) | Return them (current behavior) | Fast path; regression-pinned. |
| Session has 0 accounts AND **accounts grant exists** but accounts list is empty (desync) | Return `[]`, log warning | Wallet shipped a bad write. Don't re-popup; surface via logs so an engineer notices. |
| Session has 0 accounts AND **explicit accounts rejection** persisted | Return `[]` (sticky forever) | User explicitly denied. Re-request requires explicit `requestCapabilities`. |
| Session has 0 accounts AND **implicit accounts rejection** persisted **within TTL** (1h) | Return `[]` (no popup) | Short-term suppression to prevent popup spam; cools off. |
| Session has 0 accounts AND **implicit accounts rejection** persisted **past TTL** | Treat as no prior rejection — open popup again | Allows recovery without forcing the user to find "reset permissions" UI. |
| Session has 0 accounts AND **no rejection** AND profile has **0 visible accounts** on this chain | Return `[]` without opening popup | No-accounts preflight (Bug C). Empty popup is a UX dead-end. |
| Session has 0 accounts AND **no rejection** AND profile has ≥1 visible account | **Inflight-dedupe**, then open implicit popup with synthetic manifest `[{type:"accounts",canGet:true,canCreateAuthWit:false}]` | Lazy grant. Approve → persist implicit grant + selected accounts, return them. Reject → persist implicit rejection (TTL-bounded), return `[]`. |

The dApp can always force a re-prompt by calling `requestCapabilities([{type:"accounts"}])` explicitly — the existing `reRequested` path handles this (and, after Phase 1.5, will correctly trigger a popup for shape upgrades like `canCreateAuthWit:false` → `true`).

### Why the implicit/explicit distinction matters

The user's mental model differs between:
- **Implicit popup** (triggered by `getAccounts`): they didn't ask for capabilities, the wallet is offering a "share accounts" UX. If they reject, they may simply be confused — sticky-forever is too punitive.
- **Explicit popup** (triggered by `requestCapabilities`): the dApp asked, the wallet showed the full manifest. Rejection is an informed deny.

The TTL difference reflects this: implicit rejections are forgiving (1h cooldown), explicit rejections are committal (sticky until user resets via settings).

---

## 4. Implementation phases (revised)

### Phase 1 — Dispatcher: lazy grant with full safety

**Files touched**

- `packages/wallet-bridge/src/dispatcher.ts`
- `packages/wallet-bridge/src/dispatcher.test.ts` (extend)
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` (comment fix at line 391)

**Change shape**

In `WalletSdkDispatcher.handleGetAccounts`:

```ts
private inflightImplicitGrants = new Map<string, Promise<unknown>>();
private static IMPLICIT_REJECTION_TTL_MS = 60 * 60 * 1000;  // 1 hour

private async handleGetAccounts(ctx: SessionContext): Promise<unknown> {
  const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(
    ctx.origin, String(ctx.chainId),
  );
  if (!dappSession) throw new Error(`No dApp session found for origin ${ctx.origin}`);

  // Fast path.
  if (dappSession.accounts && dappSession.accounts.length > 0) {
    return this.formatSessionAccounts(dappSession, ctx);
  }

  const grants = dappSession.capabilityGrants ?? [];
  const rejections = dappSession.capabilityRejections ?? [];
  const accountsGrant = grants.find((g) => g.capability.type === "accounts");
  const accountsRejection = rejections.find((r) => r.capabilityType === "accounts");

  // Desync — grant exists but accounts list is empty. Don't re-popup; log + return [].
  if (accountsGrant) {
    this.logger.log("wallet-sdk", LogLevel.Warn,
      `Desync: accounts grant exists but session.accounts is empty for ${ctx.origin}`);
    return [];
  }

  // Explicit rejection — sticky forever. User must explicit-request to revisit.
  if (accountsRejection && !accountsRejection.implicit) return [];

  // Implicit rejection — sticky within TTL.
  // Math.max guards against backward wall-clock skew (machine sleep, manual clock
  // change). Forward skew expires the rejection early — acceptable UX edge.
  if (accountsRejection?.implicit) {
    const elapsed = Math.max(0, Date.now() - accountsRejection.rejectedAt);
    if (elapsed < WalletSdkDispatcher.IMPLICIT_REJECTION_TTL_MS) return [];
    // Past TTL — fall through to re-prompt.
  }

  // No-accounts preflight (Bug C): if profile has zero visible accounts, don't open
  // an empty popup. Return [] and let the dApp render its no-accounts UX.
  const network = await this.resolveNetwork(ctx);
  const available = await this.accountService.getAccounts(ctx.profileId, network.chainId);
  if (available.length === 0) {
    this.logger.log("wallet-sdk", LogLevel.Info,
      `Implicit grant skipped: no visible accounts on chain for ${ctx.origin}`);
    return [];
  }

  // Inflight dedupe: if a popup for this (origin, chainId) is already up, await its result.
  const dedupeKey = `${ctx.origin}|${ctx.chainId}`;
  const inflight = this.inflightImplicitGrants.get(dedupeKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const syntheticManifest = {
      version: "1.0" as const,
      // No metadata field — handleRequestCapabilities reads dappSession.dappMetadata,
      // not manifest.metadata. Audit removed the dead synthMetadataForImplicit helper.
      capabilities: [{ type: "accounts" as const, canGet: true, canCreateAuthWit: false }],
    };

    this.logger.log("wallet-sdk", LogLevel.Info,
      `Implicit accounts grant: opening popup for ${ctx.origin} on chain ${ctx.chainId}`);

    try {
      await this.handleRequestCapabilities(syntheticManifest, ctx, { implicit: true });
      this.logger.log("wallet-sdk", LogLevel.Info,
        `Implicit accounts grant approved for ${ctx.origin}`);
    } catch (err) {
      // Re-read session. If an accounts rejection was persisted (the popup handler
      // wrote it before re-throwing), this is a user-reject — return []. Otherwise
      // the throw is a real error (storage failure, popup plumbing crash) — rethrow.
      const refreshedAfterError = await this.dappSessionService.getDappSession(dappSession.id);
      const persistedReject = (refreshedAfterError.capabilityRejections ?? []).find(
        (r) => r.capabilityType === "accounts" && r.implicit,
      );
      if (persistedReject) {
        this.logger.log("wallet-sdk", LogLevel.Info,
          `Implicit accounts grant rejected for ${ctx.origin} (TTL-bounded)`);
        return [];
      }
      throw err;
    }

    const refreshed = await this.dappSessionService.getDappSession(dappSession.id);
    return this.formatSessionAccounts(refreshed, ctx);
  })().finally(() => {
    this.inflightImplicitGrants.delete(dedupeKey);
  });

  this.inflightImplicitGrants.set(dedupeKey, promise);
  return promise;
}
```

Notes:

- `formatSessionAccounts(session, ctx)` is extracted from the existing return body so the fast path and the post-grant path use the same wire format. Format-parity is the regression pin (test in §4 Phase 3).
- `handleRequestCapabilities` gets a new optional `{ implicit?: boolean }` parameter; when set, the rejection it persists is flagged `implicit: true`. (See Phase 1.6.) **Dispatcher guard (codex blocker fix):** when `implicit === true`, the handler asserts that the manifest contains **exactly one** capability of type `"accounts"`. Any other shape throws a programmer error. This prevents future code from accidentally TTL-softening rejections that should stay sticky (e.g., calling `handleRequestCapabilities(broaderManifest, ctx, {implicit:true})` would weaken explicit deny semantics).
- No `synthMetadataForImplicit` helper. The popup reads `dappSession.dappMetadata` directly via `useDappInteractionPayload` — the manifest's `metadata` field is unused by the popup. Removed per both audits.
- The catch-then-rethrow is the narrow contract from codex: only swallow if a rejection was actually persisted. Anything else (storage error, popup plumbing crash, network failure) propagates so the dApp's catch block sees a real error rather than a silent `[]`.
- `inflightImplicitGrants` keyed by `(origin, chainId)` dedupes burst calls. The `finally` ensures the map is cleared whether the popup approves, rejects, or errors.
- The `background.ts:391` comment is updated to: `// empty accounts — populated via requestCapabilities() or the implicit getAccounts() grant path.`

### Phase 1.5 — Field-aware capability delta for `accounts` (NEW — critical security fix)

**Problem (from both audits):** `handleRequestCapabilities` computes the delta as `requestedCapabilities.filter(cap => !grantedTypes.has(cap.type))` (`dispatcher.ts:380-382`). This is type-only. A dApp that has an implicit `accounts` grant with `{canGet:true, canCreateAuthWit:false}` can later explicitly request `{canCreateAuthWit:true}` and the delta filter returns empty — no popup. The dApp's wire response then includes `canCreateAuthWit:true` (because `enrichGrantedCapabilities` echoes the **requested** capability, `dispatcher.ts:524-548`), but storage still has `canCreateAuthWit:false`. The dApp believes it has `canCreateAuthWit`; the wallet's enforce-scope then refuses the `createAuthWit` call. **Protocol-correctness bug + authority-escalation surface.**

**Fix (minimum scope — `accounts` only for this PR):**

Introduce `accountsCapsEqual(a, b)`:

```ts
function accountsCapsEqual(a: AccountsCapability, b: AccountsCapability): boolean {
  return Boolean(a.canGet) === Boolean(b.canGet)
    && Boolean(a.canCreateAuthWit) === Boolean(b.canCreateAuthWit);
}
```

Rewrite the delta calc at `dispatcher.ts:380-385`:

```ts
const delta = requestedCapabilities.filter((cap) => {
  if (rejectedTypes.has(cap.type as string)) return true;   // re-request after reject

  if (cap.type === "accounts") {
    const existing = existingGrants.find((g) => g.capability.type === "accounts");
    return !existing || !accountsCapsEqual(
      existing.capability as AccountsCapability,
      cap as AccountsCapability,
    );
  }

  // All other types: type-only diff (UNCHANGED — broader fix is follow-up).
  return !grantedTypes.has(cap.type as Capability["type"]);
});
```

And fix `enrichGrantedCapabilities` (`dispatcher.ts:518-550`) for `accounts` only: when emitting the response, take the `{canGet, canCreateAuthWit}` from the **stored grant**, not the requested capability:

```ts
if (cap.type === "accounts") {
  const stored = grantedCaps.find((g) => (g as Capability).type === "accounts") as AccountsCapability | undefined;
  // Use stored shape for canGet/canCreateAuthWit so wire response can't lie.
  result.push({
    ...cap,
    canGet: stored?.canGet ?? false,
    canCreateAuthWit: stored?.canCreateAuthWit ?? false,
    accounts: /* … existing per-app-aliased account list … */,
  });
}
```

**Out of scope for this PR:** the same field-blind diff exists for `contracts.contracts`, `simulation.utilities.scope`, `simulation.transactions.scope`, `transaction.scope`, `data.privateEvents.contracts`. Codex flags this as a broader correctness issue. **Follow-up plan to be filed**: `wallet-sdk-capability-field-diff` covers the breadth fix. This PR only fixes `accounts` because that's the field amplified by the lazy-grant path.

### Phase 1.6 — Rejection schema: implicit vs explicit (NEW)

**File touched:** `packages/wallet-bridge/src/capabilities.ts`

```ts
export type RejectedCapabilityRecord = {
  capabilityType: string
  rejectedAt: number
  implicit?: boolean   // NEW — true if rejection came from getAccounts() lazy-grant
}
```

**File touched:** `packages/wallet-bridge/src/dispatcher.ts` — `handleRequestCapabilities` gains an optional second argument `{ implicit?: boolean }`. When set, the persisted rejection records are tagged `implicit: true`. The existing explicit path (called via `dispatch("requestCapabilities", ...)`) passes nothing, so existing records continue to be persisted as explicit (sticky).

**File touched (codex blocker fix):** `packages/wallet-bridge/src/dapp-interaction-protocol.ts` — extend `CapabilityParams` (currently at `dapp-interaction-protocol.ts:155-162`) with:

```ts
export type CapabilityParams = {
  sessionId: string
  manifest: unknown
  delta: unknown[]
  existingGrants: unknown[]
  reRequested?: string[]
  availableAccounts?: Array<{ address: string; name: string; chainId: number }>
  implicit?: boolean   // NEW — true when the popup was triggered by getAccounts() lazy-grant
}
```

The popup (Phase 2) reads `payload.params.implicit` to drive the subtitle copy. Without this type addition, the popup would reference an undeclared field. Codex's first audit didn't catch this; the final-review pass did.

**Storage migration:** none needed. Old `RejectedCapabilityRecord` rows without `implicit` are treated as `implicit === undefined`, which evaluates as explicit (sticky) — matching existing behavior. Per memory `feedback_no_data_migrations.md`, the wallet has no production users; we don't need to preserve old data shapes, but this happens to be backwards-compatible by accident.

### Phase 2 — Popup hollow-state fix

**File touched:** `packages/extension/src/popup/windows/capabilities/index.vue`

**Problem (opus Bug C, codex confirmed):** when `availableAccounts` is empty AND the delta is accounts-only, the popup renders no `AccountSelectRow` and no `CapabilityCard`s. The Approve button stays enabled. Clicking Approve sends `granted: [accounts]` with no `selectedAccounts`, the dispatcher writes a grant with zero accounts, and the dApp is soft-bricked (next call hits the "grant exists but accounts list empty" desync row in §3).

**Fix:**

1. **Defense in depth:** Phase 1's no-accounts preflight prevents the popup from opening in this case for the implicit path. But the popup is also reachable via explicit `requestCapabilities` — so we still need to fix the popup itself.

2. **Popup change** at `index.vue` after `loadInteractionPayload()`:
   - If `delta` contains an `accounts` capability AND `availableAccounts.length === 0`:
     - Set `needsAccountSelection = true` (so the existing guard at line ~170 disables Approve)
     - Render an explicit CTA in place of `AccountSelectRow`: *"no accounts on this profile yet. create one in the wallet, then reconnect."*
     - Provide a "create account" button that **first rejects the in-flight capability interaction** via `rejectViaInteractionService()` (already destructured from `useDappInteractionPayload`), **then** routes to the new-account flow.

3. **Route correctness (codex blocker fix):** the actual route is `/popup/profile/new` (verified: `packages/extension/src/popup/components/popups/SelectProfilePopup.vue:43`, `packages/extension/src/popup/pages/register.vue:51`). The plan v1 wrote `/profile/new` — wrong.

4. **Interaction-orphaning fix (codex blocker fix):** the click handler MUST settle the capability interaction before navigation. Codex identified this as the sharpest operational bug — if the popup navigates away with the interaction unresolved, the dApp's `requestCapabilities()` call hangs until `DappInteractionService`'s popup timeout. Pattern:

   ```ts
   async function handleCreateAccount() {
     await rejectViaInteractionService();   // settle the dApp's pending request
     router.push("/popup/profile/new");
   }
   ```

5. Replace the existing toast (`useToast` call at line 106) with this inline CTA — toasts disappear and leave the popup looking empty.

### Phase 3 — Tests (succinct, contract-row-aligned)

The v1 test plan was underweight per both audits. v2 adds the rejection-TTL + field-aware + dedupe coverage. Each test still pins one distinct contract row.

**Unit — `packages/wallet-bridge/src/dispatcher.test.ts`** (8 new tests, parameterized where reasonable):

| # | Name | Pins which contract row in §3 |
|---|---|---|
| 1 | `getAccounts — session has accounts → returns them (format-parity vs implicit path)` | Row 1. Assert wire shape matches what implicit-grant path returns. |
| 2 | `getAccounts — empty session + accounts grant exists (desync) → returns [] + warn log` | Row 2. Mock logger; assert log emitted. |
| 3 | `getAccounts — empty session + explicit rejection → returns [] sticky` | Row 3. |
| 4 | `getAccounts — empty session + implicit rejection (parameterized: within TTL, past TTL)` | Rows 4+5 in one test. Within-TTL → `[]` no popup; past-TTL → popup opens. |
| 5 | `getAccounts — empty session + zero visible accounts → returns [] without popup` | Row 6. |
| 6 | `getAccounts — empty session + accounts available + approve → returns accounts + persists implicit grant` | Row 7 happy. |
| 7 | `getAccounts — empty session + accounts available + reject → returns [] + persists implicit rejection (flagged implicit:true)` | Row 7 reject. |
| 8 | `getAccounts — concurrent calls dedupe → single popup, both promises resolve to same value` | Inflight dedupe. |

**Unit — `dispatcher.test.ts` for Phase 1.5 field-aware diff** (3 new tests):

| # | Name | Asserts |
|---|---|---|
| 9 | `requestCapabilities — accounts(canGet:true,canCreateAuthWit:false) granted, then accounts(canGet:true,canCreateAuthWit:true) requested → popup re-opens` | Regression pin for Bug B (authority escalation). |
| 10 | `requestCapabilities — accounts(canGet:true,canCreateAuthWit:false) granted, then accounts(canGet:true,canCreateAuthWit:false) re-requested → no popup` | Same-shape no-op. |
| 11 | `enrichGrantedCapabilities — stored canCreateAuthWit:false, requested canCreateAuthWit:true → response shows false` | Wire response cannot lie about granted shape. |

**Unit — `dispatcher.test.ts` for codex final-review fixes** (1 new test):

| # | Name | Asserts |
|---|---|---|
| 14 | `handleRequestCapabilities({implicit:true}) — guard rejects non-accounts-only manifest` | Internal API misuse guard. Throws on `{type:"transaction"}` etc. when implicit flag set. |

**Component — `packages/extension/src/popup/windows/capabilities/index.vue.test.ts`** (2 new tests):

| # | Name | Asserts |
|---|---|---|
| 12 | `renders only AccountSelectRow when delta is accounts-only` | Popup degrades cleanly when only accounts cap is in delta. |
| 13 | `accounts-only delta + zero availableAccounts → Approve disabled, "Create account" CTA visible` | Phase 2 dead-end fix. |

(Component test for "DappIdentityBlock uses session metadata not synthetic" deferred — verified by reading `useDappInteractionPayload` source; would require heavy stubbing for marginal value.)

**E2E — `packages/extension/tests/e2e/network/meta-getAccounts*.test.ts`** (UPDATE existing, ADD one):

- **UPDATE** `meta-getAccounts-pregrant.test.ts` (currently pins the BROKEN behavior at line 27-29):
  - Old assertion: `getAccounts` pre-grant returns `[]` silently
  - New assertion: `getAccounts` pre-grant opens the capabilities popup. Approve → returns granted accounts. (Mirrors the new contract.)
- **ADD** one new test in the same file or as `meta-getAccounts-implicit-reject.test.ts`:
  - `getAccounts` pre-grant → user rejects → returns `[]`. **Second `getAccounts` within TTL** → no popup, still `[]`. Pins the dedupe + TTL contract end-to-end.
- The existing `meta-getAccounts.test.ts` (post-grant path) is preserved unchanged — it's the regression pin for the fast path.

**Test count summary**

```
Unit:        12 new tests   (8 getAccounts contract rows + 3 field-aware diff + 1 misuse guard)
Component:    2 new tests
E2E:          1 updated + 1 new
              ─────────────
Total:       16 changes
```

Larger than v1's 6, but each test pins a distinct contract row that one of the audits identified as a hard-to-cover-otherwise risk. No duplicate coverage.

### Phase 4 — REMOVED (codex)

v1 Phase 4 proposed adding a `pg-btn-getAccounts` playground button. **It already exists** at `packages/playground/src/sections/meta.ts:19,47-49`. The post-grant e2e `meta-getAccounts.test.ts` and pre-grant pin `meta-getAccounts-pregrant.test.ts` already use it. v2 reuses these instead of introducing duplicate playground wiring.

### Phase 5 — Manual verification matrix (extended)

| dApp | Path | Pass criterion |
|---|---|---|
| Wonderland Token Dripper | **(NEW per codex)** Open devtools network tab on the page, watch wallet-sdk wire messages. Confirm the dApp calls `getAccounts` before `requestCapabilities` (5-minute cheap sanity check; if it doesn't, our fix won't help and we open a new diagnosis). | Wire trace shows `getAccounts` first. |
| Wonderland Token Dripper | Full connect → emoji match → "Choose account" popup → pick 1 → page shows the connected account. | "No accounts available" no longer fires. |
| Nethermind Aztec Faucet | Full connect → emoji match → "Choose account" popup → pick 1 → page proceeds to drip flow. | "Your wallet has no Aztec account yet" no longer fires. |
| Both | After connecting once, refresh the page. The dApp should silently reconnect (session is sticky); accounts should be present without a popup. | Returning-user flow unchanged. |
| Both | Connect → in the popup, click Reject. Reload the page within 1h. The dApp should NOT trigger the popup again; it should show its "no accounts" UX. | Implicit-rejection TTL works. |
| Both | Connect → Reject. Wait >1h (or fast-forward via dev tools). The dApp should trigger the popup again. | Implicit-rejection TTL recovery works. (Manual time-fast-forward; covered exhaustively in unit Test #4.) |
| Aztec Playground | Run the existing CI e2e suite. | All `meta-getAccounts*.test.ts` tests pass under the new contract. |

---

## 5. Test plan summary

```
Unit (dispatcher.test.ts):              11 new tests
  - 8 getAccounts contract rows
  - 3 field-aware diff regression pins (Bug B)
Component (capabilities popup):          2 new tests
E2E (meta-getAccounts*.test.ts):         1 updated + 1 new
                                        ─────────────────
Total test changes:                     15
```

Manual verification matrix in §5 adds 6 manual scenarios across 2 dApps post-deploy.

---

## 6. Security & Adversarial Considerations (rewritten)

Both audits flagged the v1 §6 as too optimistic. v2 surfaces the actual threats.

### Threat: Authority escalation via shape-blind delta filter (Bug B — CRITICAL)

**Old text (v1)** glossed over this. **New mitigation:** Phase 1.5 fixes the delta filter for `accounts` capability. A dApp that has `{canGet:true, canCreateAuthWit:false}` cannot upgrade to `canCreateAuthWit:true` without a fresh popup. The wire response from `enrichGrantedCapabilities` uses the **stored** shape, not the requested one — wire cannot lie. Tests #9, #10, #11 pin the regression.

**Residual risk:** The same field-blind diff exists for other capability types (`contracts`, `simulation`, `transaction`, `data`). This PR only fixes `accounts`. A follow-up plan (`wallet-sdk-capability-field-diff`) addresses the breadth. Documented in §10 follow-ups.

### Threat: Popup spam from a malicious dApp

**v1 mitigation was incomplete.** Codex correctly noted that the rejection-persistence defense only stops spam **after** the first request settles. A hostile dApp firing 20 `getAccounts()` calls before any rejection is written would open 20 popups.

**v2 mitigation (stacked):**

1. **Inflight dedupe** (Phase 1): if an implicit popup is in flight for `(origin, chainId)`, subsequent calls await the same promise. One popup, N callers.
2. **Implicit-rejection TTL** (Phase 1.6): after rejection, no popup for 1h. Burst-spam after the cooldown is bounded by 1 popup per hour.
3. **Explicit-rejection sticky** (preserved): `requestCapabilities` rejections stay forever.

**Residual risk (codex):** A hostile dApp can still spam via `requestCapabilities([{type:"accounts"}])` in a loop — that path is gated by the existing `rejectedTypes.has(...)` re-request clause, but on first rejection the popup re-opens for the next call. **This is pre-existing**, not introduced by the plan. Filing a follow-up: `wallet-sdk-requestcapabilities-rate-limit` to add a per-origin rate limit. Out of scope for this PR.

### Threat: Attribution attack (popup looks user-asked, was dApp-asked)

**New (opus Q4).** When the implicit popup opens, the user doesn't know it was triggered by a `getAccounts` call vs an explicit `requestCapabilities`. A hostile dApp can exploit this ambiguity to make the popup look more legitimate than it is.

**v2 mitigation:** The popup payload carries an internal `implicit: true` flag (NOT exposed to the wire). When the popup is implicit, the existing `AccountSelectRow` heading "Share your accounts" is preceded by a one-line subtitle: *"this site is asking which accounts to share. pick one or more to continue."* — distinguishes "wallet UI is asking" from "site is asking". Tied to brutalist lower-case styling (matches existing copy in `wallet-connect-modal.tsx` ecosystem).

### Threat: Confused-deputy via stale session metadata

**Largely a non-issue (codex verified).** `dappSession.dappMetadata` is written at session creation (`dapp-session/service.ts:123-127`) and not mutated by update paths (`142-165, 220-260`). The popup uses `payload.session.dappMetadata`, not manifest metadata. v1 already had this right; v2 keeps the analysis.

### Threat: Error-swallowing turns wallet bugs into "no accounts"

**v2 explicit fix.** v1's `try { handleRequestCapabilities(...) } catch { return [] }` was too broad. v2's catch re-reads the session and **only returns `[]` if an implicit rejection was actually persisted by the popup handler before re-throwing**. Otherwise the error propagates so the dApp sees a real failure rather than a silent empty-accounts response.

### Threat: No-accounts dead-end (Bug C)

**v1 didn't surface this.** v2 has two layers of defense:

1. **Dispatcher no-accounts preflight** (Phase 1): if `accountService.getAccounts(profileId, chainId)` returns 0, return `[]` without opening the popup.
2. **Popup hollow-state fix** (Phase 2): if the popup IS reached with zero available accounts (e.g., via explicit `requestCapabilities`), the Approve button is disabled and a "Create account" CTA is shown. No more soft-brick.

### Threat: Implicit-rejection sticky-DoS

**Codex's concern.** v1's blanket "rejection sticks forever" would soft-brick non-compliant dApps for any user who accidentally clicks Reject. **v2 mitigation:** the new `implicit: boolean` flag on `RejectedCapabilityRecord` (Phase 1.6) lets implicit rejections expire after 1h, while explicit rejections stay sticky. Recovery without the user finding "reset permissions" UI.

### Threat: Cross-origin / cross-chain replay

Same as v1. Session lookup is `(origin, chainId)`. The implicit grant inherits that scoping. No change.

### Threat: Mixed-path popup stacking (codex final review)

Inflight dedupe in Phase 1 only covers the **implicit** `getAccounts` path. A hostile dApp can open an implicit popup AND concurrently call explicit `requestCapabilities` — yielding two stacked popups. The user sees what looks like two different requests when they're functionally the same authorization moment.

**Mitigation:** documented as in-scope for the follow-up plan `wallet-sdk-capability-popup-dedupe` (NEW per codex's Q5 answer). This PR does not unify the two paths' inflight handling; the security impact of stacking is limited (the explicit popup has its own user-facing context).

### Threat: Cross-tab TTL semantics (codex final review)

A single implicit rejection on `(origin, chainId)` suppresses the popup across **all tabs** sharing that dApp session for 1h. If the user has the dApp open in two tabs and rejects in one, the other tab sees `[]` silently for the next hour.

**Mitigation:** documented behavior. This is the intended scoping — sessions are per-`(origin, chainId)`, not per-tab. The TTL inherits that scoping. Surface in the wallet-bridge README so future contributors aren't surprised.

### Threat: Internal API misuse — `implicit:true` on broader manifests (codex final review)

If future code calls `handleRequestCapabilities(broaderManifest, ctx, { implicit: true })` with a manifest containing more than just an `accounts` capability, every rejected capability in that broader manifest would be TTL-softened — silently weakening deny semantics for `transaction`, `data`, etc.

**Mitigation:** Phase 1 dispatcher guard (added in the §4 Phase 1 changes above): when `opts.implicit === true`, assert the manifest contains exactly one capability of type `"accounts"`. Throws a programmer error on misuse. Pinned by a unit test (added to §4 Phase 3 Test #14 below).

### Threat: Account visibility leakage

**Codex addition.** `AccountService.getAccounts` filters by `visible` unless `all` is passed. The implicit popup uses the default (visible-only), matching the user's mental model from the wallet UI. Hidden accounts are not exposed via the implicit path. Verified by inspection of `account/service.ts:52-54`.

### Crypto

No change. ECDH P-256, AES-256-GCM, emoji verification, capability signing — all unchanged.

### Supply chain

No new dependencies. `bun.lock` unchanged.

### Least privilege

Synthetic manifest = `{canGet:true, canCreateAuthWit:false}` — minimum viable. Phase 1.5 ensures upgrades to `canCreateAuthWit:true` require a fresh popup. **But codex correctly notes:** `accounts` is a coarse capability type covering `getCompleteAddress`, `createAuthWit`, `registerToken` (per `capability-map.ts:19-21`), and `canGet` is not enforced anywhere (only `canCreateAuthWit` is, at `scope-enforcement.ts:246`). The implicit grant authorizes the current `accounts` bucket as implemented. A finer-grained capability split (e.g., separate `accounts.read` vs `accounts.authwit`) is a wallet-sdk spec-level discussion, deferred.

---

## 7. UX / copywriting (expanded)

### Implicit popup — new subtitle

When `delta` is accounts-only AND `payload.params.implicit === true`, render this subtitle above the `AccountSelectRow`:

> this site is asking which accounts to share. pick one or more to continue.

Brutalist lower-case, terse, no marketing flourish. Matches the rest of our popup copy ecosystem.

### Hollow-state CTA (Phase 2)

When `availableAccounts.length === 0` AND `delta` includes an accounts capability:

```
no accounts on this profile yet.
create one in the wallet, then reconnect.

  [ create account ]   [ cancel ]
```

Lower-case, matching tone. The "create account" button routes to the new-account flow (`/profile/new` — verify route during impl).

### No copy changes on the failing-dApp side

Same as v1 — those are their own codebases. We add a single paragraph to `packages/wallet-bridge/README.md` documenting that `getAccounts` is now an implicit-grant trigger.

---

## 8. Risks (revised)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Bug B (silent canCreateAuthWit escalation)** | Was high pre-fix; **fix lands in Phase 1.5** | Critical | Tests #9, #10, #11 + audit re-review. |
| **Bug C (popup dead-end with zero accounts)** | Was reachable from common path post-v1; **fix lands in Phases 1 + 2** | High | Tests #5, #13 + manual verification §5. |
| Implicit-rejection TTL timing window edge cases | Low | Medium | Test #4 parameterized for within-TTL and past-TTL. |
| Inflight dedupe map leaks if the popup hangs | Low | Low | `.finally(() => delete)` clause guarantees cleanup on any outcome. |
| Phase 1.5 field-aware diff misses an edge field on `accounts` | Low | Medium | `accountsCapsEqual` is small (2 booleans); audit re-review will catch. |
| `requestCapabilities` still spammable (pre-existing) | Medium | Medium | Documented in §6; follow-up plan `wallet-sdk-requestcapabilities-rate-limit`. Not blocking this PR. |
| Field-blind diff for non-`accounts` capability types (pre-existing) | Low | Medium | Documented in §6; follow-up plan `wallet-sdk-capability-field-diff`. Not blocking this PR. |
| Wonderland is doing something different (per Q3) | Low | Medium | §5 adds the 5-minute devtools sanity check. |
| Existing playground / e2e tests break | Was unmentioned in v1; **mitigation: §4 Phase 3 explicitly updates `meta-getAccounts-pregrant.test.ts`** | Low | The test today PINS the broken behavior — updating it is part of Phase 3. |

The recursion-safety risk from v1 §8 is **removed**. Both audits confirmed it's a non-issue; the direct call to `handleRequestCapabilities` is for clarity, not safety.

---

## 9. Roll-out

1. Branch `feat/wallet-sdk-implicit-account-grant` off `dev`.
2. Land Phases 1, 1.5, 1.6, 2 + Phase 3 tests as one PR. (Phases are conceptually distinct but tightly coupled — splitting would require maintaining a half-fixed state.)
3. Update existing e2e tests (`meta-getAccounts-pregrant.test.ts`) — flip the assertion to the new contract.
4. `bun run audit:vue` locally + `bun run test:e2e` smoke before push.
5. PR → `dev` → squash merge.
6. Build extension, side-load, perform §5 manual verification including the Wonderland devtools sanity check.
7. Document in `packages/wallet-bridge/README.md` (one paragraph).
8. File the two follow-up plans for the deferred breadth issues (`wallet-sdk-capability-field-diff`, `wallet-sdk-requestcapabilities-rate-limit`).

---

## 10. Files touched (final)

```
packages/wallet-bridge/src/dispatcher.ts                                        [edit]
packages/wallet-bridge/src/dispatcher.test.ts                                   [extend]
packages/wallet-bridge/src/capabilities.ts                                      [extend RejectedCapabilityRecord]
packages/wallet-bridge/src/dapp-interaction-protocol.ts                         [extend CapabilityParams — codex blocker fix]
packages/wallet-bridge/README.md                                                [append]
packages/extension/src/wallet/services/wallet-sdk/background.ts                 [comment fix line 391]
packages/extension/src/popup/windows/capabilities/index.vue                     [hollow-state fix + implicit subtitle + CTA settle-then-navigate]
packages/extension/src/popup/windows/capabilities/index.vue.test.ts             [new]
packages/extension/tests/e2e/network/meta-getAccounts-pregrant.test.ts          [flip assertion]
packages/extension/tests/e2e/network/meta-getAccounts-implicit-reject.test.ts   [new — or append to pregrant file]
implementations-plan/wallet-sdk-implicit-account-grant/plan-v2.md               [this file]
implementations-plan/wallet-sdk-implicit-account-grant/lessons/                 [populated during impl]
```

**Follow-up plans (NOT touched in this PR, but filed):**

```
implementations-plan/wallet-sdk-capability-field-diff/plan.md                   [new dir, not in this PR]
implementations-plan/wallet-sdk-requestcapabilities-rate-limit/plan.md          [new dir, not in this PR]
implementations-plan/wallet-sdk-capability-popup-dedupe/plan.md                 [new dir — unify implicit + explicit inflight dedupe, codex Q5 final-review]
```

**Files NOT touched (v1 said would be, audits removed):**

- `packages/playground/src/sections/connect.ts` — button already exists
- `packages/playground/src/lib/wallet.ts` — function already exists in equivalent

---

## 11. Closed clarifying questions

Same as v1 §11. User-confirmed:
- Q1: lazy account grant (Option A)
- Q2: unit + component + smoke e2e (no network e2e)
- Q3: trust the symptom match for Wonderland
- Q4: just Nethermind + Wonderland for verification matrix

---

## 12. Open questions — RESOLVED via codex final review

The 7 questions sent for the final review (transcript: `audit-codex-final.md`) all got answered. Resolutions:

| # | Question | Codex answer | Action in v2.1 |
|---|---|---|---|
| Q1 | Phase 1.5 scope — `accounts`-only sufficient? | **Yes**, for this PR. Filed follow-up `wallet-sdk-capability-field-diff` is the right shape. | No change. |
| Q2 | TTL value (1h)? | **Yes**, 1h is right. Better than 15min (annoying), less risky than 24h (long suppression). | No change. |
| Q3 | No-accounts preflight log level (Info vs Warn)? | **Info is correct.** Zero visible accounts is expected user state, not a bug. | No change. |
| Q4 | CTA route `/profile/new`? | **Wrong route.** Actual is `/popup/profile/new`. AND: don't navigate without first cancelling the interaction — would orphan the dApp request. | Phase 2 fixed: settle interaction → navigate to `/popup/profile/new`. |
| Q5 | Other follow-up plans? | **Yes** — add `wallet-sdk-capability-popup-dedupe` (unify implicit + explicit inflight handling across paths). | Added to §10 follow-ups. |
| Q6 | Telemetry for implicit popup? | **Yes**, log invocations + outcomes. Low-cost, useful for support. | Phase 1 now emits `LogLevel.Info` lines for popup open, approve, reject. |
| Q7 | Adversarial review of v2. | See `audit-codex-final.md`. Three new threat rows added to §6: mixed-path popup stacking, internal API misuse guard, cross-tab TTL semantics. | §6 expanded. |

Codex also flagged **two implementation gaps in v2 (not v2-specific design questions)** which became v2.1 blockers and are now patched:

- **Missing type extension:** `CapabilityParams` at `dapp-interaction-protocol.ts:155-162` had no `implicit?` field. Without it, the popup's subtitle path would reference an undeclared field. Phase 1.6 now extends this type.
- **CTA orphans the dApp request:** the original "create account" button design would have navigated away while the interaction was unresolved, hanging the dApp call until popup timeout. Phase 2 now `await rejectViaInteractionService()` before `router.push`.

Both verified against the codebase before being incorporated.

---

## 13. ASCII state tracker

```
[✓] 0. Clarifying questions
[✓] 1. Plan v1 drafted
[✓] 2. Codex xhigh audit (audit-codex.md)
[✓] 2. Opus 4.7 audit (audit-opus.md)
[✓] 3. Consolidate audits → plan-v2.md
[✓] 4. Final codex review of plan-v2 (audit-codex-final.md) — 3 blockers patched as v2.1
[✓] 5. ELI5 HTML companion → eli5.html
[▶] 6. Approval gate (this is where you, Alejo, decide)
[ ] 7. Implementation
[ ] 8. Post-impl codex review
[ ] 9. Fix loop
```

---

## 14. Changelog from v1

Every change v1 → v2, attributed to its source. Both audits returned **ship-with-changes**.

### Removed from v1

- **Phase 4 (playground button + lib function)** — Codex: the playground button (`pg-btn-getAccounts`) and lib wiring already exist. Reuse the existing `meta-getAccounts.test.ts` + `meta-getAccounts-pregrant.test.ts` instead.
- **`synthMetadataForImplicit` helper** — Both audits: the popup reads `dappSession.dappMetadata`, not `manifest.metadata`. Helper is dead code.
- **§8 "two popups via second requestCapabilities" risk row** — Replaced by Phase 1.5's field-aware diff (the actual fix).
- **v1 §8 "recursion" risk** — Both audits: not a real risk (`requestCapabilities` is exempt; direct call is for clarity).

### Added to v1

- **Phase 1.5 — Field-aware capability delta for `accounts`** (NEW). Both audits flagged this as a critical pre-existing bug (`grantedTypes.has(cap.type)` at `dispatcher.ts:380-382` allows `canGet:true → canCreateAuthWit:true` upgrades without re-popup). Plan v2 fixes this for `accounts` capability only; broader breadth deferred to follow-up.
- **Phase 1.6 — Rejection schema implicit/explicit split** (NEW). Codex: indefinite sticky implicit rejection is a usability DoS. Solution: optional `implicit: boolean` on `RejectedCapabilityRecord`; TTL-bounded (1h) for implicit, sticky for explicit.
- **Inflight dedupe** for implicit popups (NEW). Opus: prevents popup-burst-spam from a hostile dApp firing N concurrent `getAccounts` before any rejection settles.
- **No-accounts preflight** in dispatcher (NEW). Both audits surfaced Bug C: empty `availableAccounts` → popup dead-end. Preflight bypasses the popup entirely; popup CTA fix (Phase 2) is defense in depth.
- **Narrower error handling** (Phase 1). Codex: blanket `catch { return [] }` swallows storage / plumbing errors. v2 re-reads session and only returns `[]` if rejection was persisted; else rethrows.
- **Popup hollow-state fix** (Phase 2). Both audits: when `availableAccounts.length === 0`, disable Approve and render an explicit "create account" CTA in place of the disappearing toast.
- **Wonderland devtools sanity check** (§5). Codex Q5: 5-minute cheap verification that Wonderland actually does `getAccounts` first. Cheaper than reverse-engineering the bundle.
- **Option D** to §3 design-decision rejection table. Opus: structured `4100`-style error code; rejected for the same reason as B.
- **Authority-escalation threat row** to §6. Opus + codex: the actual confused-deputy attack v1 missed.
- **Attribution attack threat + mitigation** to §6 (popup `implicit:true` subtitle).
- **Visible-account filter analysis** to §6. Codex: `AccountService.getAccounts` filters by `visible`; the implicit popup correctly inherits this.
- **`background.ts:391` comment fix** to §10. Opus: comment misleadingly says "via getAccounts()" when it should say "via requestCapabilities() or the implicit getAccounts() grant path".
- **`dispatcher.ts:766-784` consistency observation** to §2. Opus: rest of dispatcher already throws when accounts are missing; `handleGetAccounts` was the inconsistent one.
- **demo-wallet reference precedent** to §2. Codex: at least one other Aztec wallet already treats `getAccounts` as a grant trigger.
- **Two follow-up plans** declared in §10:
  - `wallet-sdk-capability-field-diff` (broaden Phase 1.5)
  - `wallet-sdk-requestcapabilities-rate-limit` (cap-popup rate limit)

### Modified in v1

- **§3 contract table** — rows split: "grant exists with empty accounts (desync)" and "implicit rejection (TTL)" are now distinct from "explicit rejection (sticky)" and "no rejection" paths. Opus.
- **§3 framing** — softened from "the contract that the fix establishes" to "compatibility shim, not protocol canon". Codex.
- **§6 popup-spam mitigation** — acknowledged that `requestCapabilities` itself is still spammable (pre-existing); inflight dedupe + TTL only protect the implicit path. Codex.
- **§4 Phase 3 unit tests** — expanded from 4 to 11. Adds format-parity, field-aware diff (3 tests), TTL parameterization, no-accounts preflight, dedupe. Opus + codex.
- **§4 Phase 3 e2e** — updates the existing pregrant test to assert the new contract; adds an implicit-reject test. v1's "add a new playground button" approach is removed.
- **§12 open questions** — Q1 (recursion) rephrased; Q5 (Wonderland) elevated from "trust the symptom" to "5-min devtools sanity check"; new Q1-Q7 entirely for the v2 cycle.

### Re-verified after audit (no change)

- Q2 (rejection-timeout default) for explicit rejections: sticky stays sticky. Codex.
- Q3 (per-session re-consent): per-session is correct. Codex + opus.
- Q6 (`canCreateAuthWit: false` default): correct, but Phase 1.5 is what makes it meaningful. Both audits.

### v2.1 patches from codex final review (audit-codex-final.md)

Codex's final-review pass returned `ship-with-changes` with three concrete blockers — all small fixes, applied inline to v2:

- **Phase 1.6 / §10**: extended `CapabilityParams` in `packages/wallet-bridge/src/dapp-interaction-protocol.ts` with `implicit?: boolean`. v2 referenced this field without declaring it. **Blocker fix.**
- **Phase 2**: fixed CTA route from `/profile/new` to `/popup/profile/new` (verified against `register.vue:51`, `SelectProfilePopup.vue:43`) AND made the CTA `await rejectViaInteractionService()` before navigation so the dApp's interaction is settled. v2 would have orphaned the dApp's request until popup timeout. **Blocker fix.**
- **Phase 1**: added a dispatcher guard — when `opts.implicit === true`, assert the manifest contains exactly one `accounts` capability. Prevents future code from accidentally TTL-softening rejections that should stay sticky. **Blocker fix.**

Smaller v2.1 improvements also applied:

- **Phase 1**: `Math.max(0, Date.now() - rejectedAt)` clamps backward wall-clock skew (machine sleep, manual clock change) so TTL suppression can't be artificially extended.
- **Phase 1**: telemetry — log popup open, approve, reject at `LogLevel.Info` (codex Q6).
- **§6**: added three new threat rows — mixed-path popup stacking, internal API misuse guard, cross-tab TTL semantics (codex Q7).
- **§10**: added third follow-up plan `wallet-sdk-capability-popup-dedupe` (codex Q5).
- **§4 Phase 3**: added Test #14 (`{implicit:true}` guard rejects non-accounts manifests).
