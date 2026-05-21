# wallet-sdk-implicit-account-grant — plan v3 (post-user-pivot)

Status: **draft, awaiting dual audit** (Tier-B per `~/.claude/CLAUDE.md`)
Owner: Alejo
Target branch: `feat/wallet-sdk-accounts-not-granted-error` off `dev` (NOTE: branch name updated — no longer "implicit-account-grant")

**This is the active plan.** Plans v1 and v2 are retained for traceability:

- `plan.md` — v1 (silent `[]` fix attempt 1)
- `plan-v2.md` — v2 (lazy implicit grant; rejected after audit + user review)
- `audit-codex.md`, `audit-opus.md`, `audit-codex-final.md` — audit transcripts for v1/v2

The directory name `wallet-sdk-implicit-account-grant/` is now a misnomer — kept to preserve audit history. Future plans get new directories.

---

## 0. Why v3 exists — the pivot

After v2 passed two rounds of audits and reached the approval gate, the user (Alejo) raised a deeper concern:

> *"Let's say we add the only-account pop-up… those webpages will want to register contract, etc. that our security system should reject because the app has not asked for those permissions yet. Right? Then… This would only be a patch, while it sounds that the webpages are the ones that need to fix their workflow to correctly request the capabilities."*

He's right. v2's lazy implicit grant:

1. Gets Nethermind past account selection ✓
2. But Nethermind's next action is `feeJuice.methods.claim(...).send(...)` (`/Users/alejoamiras/Projects/Ecosystem/aztec-faucet/src/lib/claim-via-wallet.ts:140`) — which calls `wallet.sendTx`, which our `enforceCapability` rejects because `transaction` capability wasn't granted ✗
3. So v2 moves the failure one click deeper. The user *thinks* the wallet is "almost working" but the second click still breaks.

The wallet-sdk spec (`/Users/alejoamiras/.claude/skills/wallet-sdk/wallet-sdk.md:1470-1474`) is unambiguous:

> *"After confirm(), call requestCapabilities() FIRST — not getAccounts() directly. External wallets … expect the capabilities-first flow"*

Nethermind and Wonderland are both violating the spec. v2 normalizes the bad pattern. **v3 throws a structured error that forces the dApp's existing fallback (which Nethermind has) to fire, sending the full capability manifest in a single popup — fixing the entire flow end-to-end in one click instead of two.**

---

## 1. Context

Same as v1 §1 / v2 §1. Two third-party dApps fail at account selection after a successful wallet connection. Symptoms:

| dApp | Error |
|---|---|
| Nethermind Aztec Faucet | "Your wallet has no Aztec account yet" |
| Wonderland Token Dripper | "No accounts available in connected wallet" |

Both call `wallet.getAccounts()` before `wallet.requestCapabilities()`. Today our dispatcher returns `[]` silently, which both dApps treat as "no accounts".

---

## 2. Root cause

Same diagnosis confirmed by both audits in v1 → v2 cycle. See `plan-v2.md` §2 for the full traceback. Short version:

- `dispatcher.ts:253-262` — `handleGetAccounts` returns `[]` when `dappSession.accounts` is empty
- `background.ts:396-406` — discovery creates sessions with empty accounts + zero grants
- Nethermind's fallback (`use-wallet-connect.ts:99`) only fires if `getAccounts()` **throws** — `[]` silently kills the flow
- The rest of the dispatcher already throws when capabilities are missing (`resolveNetworkAndAccount` at `dispatcher.ts:766-784`) — `handleGetAccounts` is the inconsistent one

---

## 3. Design — throw `CapabilityNotGrantedError` (EIP-1193 code 4100)

### Decision

When `wallet.getAccounts()` arrives on a session that has no `accounts` capability grant, throw a structured `CapabilityNotGrantedError`. The wallet-sdk background handler's structured-response writer (mirroring the existing `JobCancelledError` path at `packages/extension/src/wallet/services/wallet-sdk/background.ts:461-472` — extracted into a pure helper in Phase 1.4) converts it to an EIP-1193-4100 wire response (`{ code: 4100, message, data: { walletErrorCode: "CAPABILITY_NOT_GRANTED", capabilityType: "accounts" } }`).

### Why 4100

EIP-1193 reserves code `4100` for "Unauthorized — The requested method and/or account has not been authorized by the user." This is exactly our case. We pick it because:

1. **dApps that bare-`catch` (like Nethermind's `use-wallet-connect.ts:99`)** trigger their fallback regardless of code. The throw alone is enough.
2. **dApps that want to discriminate** can parse the code (see "Wire reality" below). Standardized 4100 is the canonical choice; custom codes (e.g., 4101) buy no compatibility.
3. **Alternative codes are wrong**: `4200` ("Method not supported") is false — the method IS supported; `4900`/`4901` are connection states; a custom code outside the EIP range loses the semantic surface.

### Wire reality — how dApps actually see the error

**Important caveat (opus v3 audit, verified):** the `@aztec/wallet-sdk@4.2.0` dApp-side wrapper at `extension_wallet.ts:181` does:

```ts
if (error) { reject(new Error(jsonStringify(error))); }
```

When our wallet's `response.error` is an object (which it is for `CapabilityNotGrantedError`), the SDK wraps it in a plain `Error` whose `.message` is the JSON-stringified envelope. There is **no `.code` property on the rejected error**. dApp code that wants to discriminate must parse the message:

```ts
try {
  await wallet.getAccounts();
} catch (err) {
  // Plain catch: fallback fires regardless (Nethermind path) ✓
  // Code-aware path:
  try {
    const parsed = JSON.parse(err.message);
    if (parsed.code === 4100 && parsed.data?.walletErrorCode === "CAPABILITY_NOT_GRANTED") {
      // Specific recovery
    }
  } catch { /* not a structured error */ }
  // Always fall back to requestCapabilities() with the full manifest
  await wallet.requestCapabilities(manifest);
}
```

This recipe is documented in the wallet-bridge README append (§8). The plan does NOT block on dApps adopting it — bare `catch` works fine for the actual Nethermind flow.

### What each dApp does after the throw

| dApp | Behavior |
|---|---|
| **Nethermind faucet** | `try { wallet.getAccounts() } catch { wallet.requestCapabilities(faucetCapabilities()) }` (`use-wallet-connect.ts:93-106`). The `catch` fires → full manifest sent → our wallet shows ONE popup with accounts + contracts + simulation + transaction. User approves → all the permissions Nethermind needs to claim Fee Juice are granted. Full flow works end-to-end in **one popup**. |
| **Wonderland** (with fallback) | Same as Nethermind. |
| **Wonderland** (no fallback) | Sees our error string. Their team gets actionable signal to fix their code. We file an issue. |
| **Well-behaved dApp** (e.g., our playground) | Unaffected — they already call `requestCapabilities` first. The `getAccounts` throw only fires on the unauthorized path. |

### Why this over v2's lazy grant

The user's argument, verified:

1. **Lazy grant ≠ working dApp.** Lazy grant only fixes the account-selection symptom. Nethermind's `claim_via_wallet.ts:140` (`wallet.sendTx`) and `claim_via_wallet.ts:122` (`batch.send`) both need `transaction` capability. v2 would surface a confusing "transaction capability not granted" error on the second click. v3 fixes the entire flow on the first popup.
2. **Spec alignment.** Wallet-sdk skill explicitly calls `getAccounts`-first a footgun. v2 normalizes the footgun; v3 enforces the spec.
3. **Smaller PR.** No new schema field on `RejectedCapabilityRecord`, no TTL, no inflight dedupe, no popup hollow-state work, no protocol-type extension. Just a structured throw + the independent Phase 1.5 security fix.
4. **Better ecosystem incentive.** Other wallets aligned with the spec will throw too. dApps that worked with our v2 lazy grant would break on those other wallets.

### What v2 had that v3 keeps

- **Phase 1.5 — field-aware capability delta for `accounts`** — pre-existing security bug (Bug B from v2 audits). A dApp that has `accounts {canGet:true, canCreateAuthWit:false}` granted can silently upgrade to `canCreateAuthWit:true` because `handleRequestCapabilities`'s delta filter is type-only (`dispatcher.ts:380-385`). This bug is independent of v2 vs v3 — it exists regardless. Both auditors flagged it as ship-blocking. **KEEP.**

- **`background.ts:391` comment fix** — opus called out that the comment is misleading. **KEEP** with updated wording for v3: `// empty accounts — populated via requestCapabilities()`.

### What v2 had that v3 drops

- Phase 1 lazy implicit grant
- Phase 1.6 `RejectedCapabilityRecord.implicit?: boolean` schema
- TTL on implicit rejections
- Inflight dedupe map
- Phase 2 popup hollow-state work + CTA route + interaction-orphaning fix
- `CapabilityParams.implicit?: boolean` protocol extension
- All v2 tests that pinned the lazy-grant contract (10 of 16)
- Three follow-up plans that were scoped around v2's surface (`wallet-sdk-capability-popup-dedupe` is no longer relevant; the other two are revised below)

### What's new in v3

- New `CapabilityNotGrantedError` class in `@nulo/extension-messaging/errors.ts`
- Dispatcher handler updated to write EIP-1193-4100 structured response (mirrors `JobCancelledError` path)
- `meta-getAccounts-pregrant.test.ts` flipped: was "asserts returns `[]`", becomes "asserts throws `CapabilityNotGrantedError`"
- Two follow-up actions: file GitHub issues with Nethermind + Wonderland teams pointing at the documented spec

---

## 4. Implementation phases

### Phase 1 — Throw `CapabilityNotGrantedError` from pre-grant `handleGetAccounts`

**Files touched (v3.1: corrected — error writer is in `background.ts`, NOT `dispatcher.ts`)**

- `packages/extension-messaging/src/errors.ts` (add new error class)
- `packages/extension-messaging/src/errors.test.ts` (extend)
- `packages/wallet-bridge/src/dispatcher.ts` (modify `handleGetAccounts` ONLY — no error-writer changes here)
- `packages/wallet-bridge/src/dispatcher.test.ts` (extend)
- `packages/extension/src/wallet/services/wallet-sdk/background.ts` (modify the error-to-response writer at lines 461-475 + comment fix at line 391)
- `packages/extension/src/wallet/services/wallet-sdk/error-envelope.ts` (NEW — extracted pure helper, see Phase 1.4)
- `packages/extension/src/wallet/services/wallet-sdk/error-envelope.test.ts` (NEW — unit test for the helper, the real testable seam codex asked for)

**Change shape**

#### 1.1 New error class (`errors.ts`)

```ts
/**
 * The dApp called a method that requires a capability it has not been granted.
 *
 * Maps to EIP-1193 code 4100 ("Unauthorized — the requested method and/or
 * account has not been authorized by the user") when surfaced to dApps. The
 * dispatcher writes a structured response.error with `data.walletErrorCode`
 * so dApps can distinguish this from other 4100s.
 *
 * Thrown by `dispatcher.handleGetAccounts` when no `accounts` grant exists.
 * dApps should catch this and call `requestCapabilities(manifest)` with the
 * required capability bundle.
 */
export class CapabilityNotGrantedError extends WalletError {
  public static readonly CODE = "CAPABILITY_NOT_GRANTED"

  public constructor(
    capabilityType: string,
    message = `${capabilityType} capability not granted. Call requestCapabilities() first.`,
  ) {
    super(CapabilityNotGrantedError.CODE, message, { capabilityType })
    this.name = "CapabilityNotGrantedError"
    Object.setPrototypeOf(this, CapabilityNotGrantedError.prototype)
  }
}
```

Add a `case CapabilityNotGrantedError.CODE` to `walletErrorFromPayload` (`errors.ts:170-189`).

#### 1.2 Dispatcher change (`dispatcher.ts`) — handler only, NO error-writer changes

The error-to-response writer is **not** in this file (see §1.4 — it's in `background.ts:461-475`). The dispatcher's job here is just to throw the structured error and let it propagate. Replace `handleGetAccounts` (currently `dispatcher.ts:253-276`) with:

```ts
private async handleGetAccounts(ctx: SessionContext): Promise<unknown> {
  const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(
    ctx.origin, String(ctx.chainId),
  );
  if (!dappSession) throw new Error(`No dApp session found for origin ${ctx.origin}`);

  const grants = dappSession.capabilityGrants ?? [];
  const hasAccountsGrant = grants.some((g) => g.capability.type === "accounts");

  // Pre-grant: throw structured 4100 so the dApp's fallback fires.
  // Per wallet-sdk spec, dApps SHOULD call requestCapabilities() before getAccounts();
  // throwing forces them onto the canonical flow.
  //
  // Log level is Debug (opus v3): a misbehaving dApp may re-fire getAccounts() on
  // every React render — Info would spam the log. Debug keeps the signal available
  // for dev/diagnosis without the noise.
  if (!hasAccountsGrant) {
    this.logger.log("wallet-sdk", LogLevel.Debug,
      `getAccounts pre-grant from ${ctx.origin} — throwing CAPABILITY_NOT_GRANTED to nudge requestCapabilities()`);
    throw new CapabilityNotGrantedError("accounts");
  }

  // Granted but empty (desync — should not happen in practice but defensive).
  if (!dappSession.accounts || dappSession.accounts.length === 0) {
    this.logger.log("wallet-sdk", LogLevel.Warn,
      `Desync: accounts grant exists but session.accounts is empty for ${ctx.origin}`);
    return [];
  }

  return this.formatSessionAccounts(dappSession, ctx);
}
```

Note: the post-grant body (the original lines 264-276 returning the session-scoped accounts) is extracted into `formatSessionAccounts(session, ctx)` for readability. The behavior is unchanged.

#### 1.3 Comment fix (`background.ts:391`)

Change:
```ts
[], // empty accounts — will be populated via getAccounts()
```
to:
```ts
[], // empty accounts — populated via requestCapabilities()
```

#### 1.4 Extract pure helper for EIP-1193 mapping (v3.1 — both auditors flagged)

The error-to-response writer at `packages/extension/src/wallet/services/wallet-sdk/background.ts:461-475` currently inlines the `JobCancelledError → 4001` branching inside `handleWalletMessage`. Both v3 auditors flagged that this is the right seam for our 4100 case AND that it's hard to unit-test inline.

**Extract a pure helper:**

New file `packages/extension/src/wallet/services/wallet-sdk/error-envelope.ts`:

```ts
/**
 * Convert an internal exception into the `WalletResponse.error` shape that the
 * wallet-sdk's dApp-side wrapper expects. Structured errors get EIP-1193 codes
 * + a `walletErrorCode` discriminator so dApps can parse the JSON-wrapped error
 * message (see wallet-bridge README for the dApp recipe).
 *
 * Pure — has no I/O, no logger, no service dependencies. Testable in isolation.
 */
import { JobCancelledError, CapabilityNotGrantedError } from "@nulo/extension-messaging/errors"
import type { WalletResponse } from "@aztec/wallet-sdk/types"

export function toWalletResponseError(error: unknown): WalletResponse["error"] {
  if (error instanceof JobCancelledError) {
    return {
      code: 4001,
      message: error.message,
      data: {
        walletErrorCode: JobCancelledError.CODE,
        jobId: (error.details as { jobId?: string } | undefined)?.jobId,
      },
    }
  }
  if (error instanceof CapabilityNotGrantedError) {
    return {
      code: 4100,
      message: error.message,
      data: {
        walletErrorCode: CapabilityNotGrantedError.CODE,
        capabilityType: (error.details as { capabilityType?: string } | undefined)?.capabilityType,
      },
    }
  }
  return error instanceof Error ? error.message : String(error)
}
```

In `background.ts:461-475`, replace the inlined branches with:

```ts
} catch (error) {
  response.error = toWalletResponseError(error);
  // existing log handling stays
}
```

Tests live in `packages/extension/src/wallet/services/wallet-sdk/error-envelope.test.ts` (new file). The helper is pure, so the test suite needs no service mocks — just construct error instances and assert the output shape. Test list in §4 Phase 2.

### Phase 1.5 — Field-aware capability delta for `accounts` (unchanged from v2)

Independent of the throw vs lazy-grant decision. This is the Bug B fix that both auditors flagged. Full design in `plan-v2.md` §4 Phase 1.5 — verbatim:

- New helper `accountsCapsEqual(a, b)` comparing `Boolean(a.canGet) === Boolean(b.canGet) && Boolean(a.canCreateAuthWit) === Boolean(b.canCreateAuthWit)`
- `handleRequestCapabilities` delta filter (`dispatcher.ts:380-385`): when `cap.type === "accounts"`, compare by shape, not just type
- `enrichGrantedCapabilities` (`dispatcher.ts:518-550`): for the `accounts` capability, emit `canGet` / `canCreateAuthWit` from the **stored** grant, not the requested capability. Wire response cannot lie about granted shape.

Out of scope (filed as follow-up `wallet-sdk-capability-field-diff`): same field-blind diff for `contracts`, `simulation`, `transaction`, `data`.

### Phase 2 — Tests

Smaller than v2 because we drop lazy-grant work.

**Unit — `errors.test.ts`** (1 new test):

| # | Name | Asserts |
|---|---|---|
| 1 | `CapabilityNotGrantedError round-trips through walletErrorFromPayload` | Pattern parity with existing `WalletError` subclasses; `instanceof` survives the JSON boundary. |

**Unit — `dispatcher.test.ts`** (6 new tests):

| # | Name | Asserts |
|---|---|---|
| 2 | `getAccounts — no accounts grant → throws CapabilityNotGrantedError with exact stable message wording` | Phase 1 core contract. Includes assertion on `error.code === "CAPABILITY_NOT_GRANTED"`, `error.details.capabilityType === "accounts"`, AND `error.message === "accounts capability not granted. Call requestCapabilities() first."` exactly. The exact-message assertion pins §5's stable-contract invariant — a future "improvement" to the wording would break dApps that substring-match. |
| 3 | `getAccounts — no session → throws plain "No dApp session found" Error (NOT CapabilityNotGrantedError)` | (v3.1, opus) Pin ordering: session-not-found throws BEFORE the accounts-grant check so dApps relying on the session-expired diagnostic see it unchanged. Refactor protection. |
| 4 | `getAccounts — accounts grant exists, session has accounts → returns them (regression pin for fast path)` | Verifies the post-grant path is unchanged. |
| 5 | `getAccounts — accounts grant exists, session.accounts is empty (desync) → returns [] + warn log` | Defensive desync handling. |
| 6 | `requestCapabilities — accounts(canGet:true,canCreateAuthWit:false) granted, then accounts(canCreateAuthWit:true) requested → popup re-opens` | Phase 1.5 Bug B regression pin. |
| 7 | `requestCapabilities — accounts(canGet:true,canCreateAuthWit:false) granted, then SAME shape re-requested → no popup` | (v3.1, codex) Same-shape no-op. Was in v2 §4 Test #10; v3 dropped it by accident. Pins that field-aware diff doesn't over-trigger. |
| 8 | `enrichGrantedCapabilities — stored canCreateAuthWit:false, requested canCreateAuthWit:true → response shows false` | Phase 1.5 — wire response cannot lie. |

**Unit — `error-envelope.test.ts`** (3 new tests in the extracted helper, NEW file per §1.4):

| # | Name | Asserts |
|---|---|---|
| 9 | `toWalletResponseError(JobCancelledError) → {code:4001, walletErrorCode:"JOB_CANCELLED"}` | Regression pin for existing behavior. |
| 10 | `toWalletResponseError(CapabilityNotGrantedError("accounts")) → {code:4100, walletErrorCode:"CAPABILITY_NOT_GRANTED", capabilityType:"accounts"}` | EIP-1193 mapping for the new error. |
| 11 | `toWalletResponseError envelope round-trips through new Error(JSON.stringify(env)) — JSON.parse(err.message).code === 4100` | (v3.1, opus) Verifies the dApp's parse recipe documented in the README. Load-bearing contract test. |

**E2E — `meta-getAccounts-pregrant.test.ts`** (UPDATE existing assertion, v3.1 relaxed per both auditors):

- Old: `expect((result.resultJson as unknown[]).length).toBe(0)` (pinned the broken behavior)
- **New (v3.1):** assert `result.status === "error"` AND that the error surface contains the discriminator. Use a flexible match because the wallet-sdk's `extension_wallet.ts:181` wraps the envelope in `new Error(JSON.stringify(error))` — the playground may surface this as a string-typed error, an object with `.code`, or a `JSON.parse`-able message. Accept any of:
  - `result.error?.code === 4100`, OR
  - `result.error` contains the string `"4100"`, OR
  - `result.error` contains the string `"CAPABILITY_NOT_GRANTED"`
  
  Implementation: a single `expect(JSON.stringify(result)).toMatch(/4100|CAPABILITY_NOT_GRANTED/)`. The exact shape gets pinned by the unit-level Test #11 (envelope round-trip); the e2e only needs to verify "the dApp sees something it can recognize".
- Also assert that calling `requestCapabilities` next succeeds (full flow regression pin).

**E2E — `meta-getAccounts.test.ts`** (preserved unchanged): the post-grant fast path test continues to verify that after a successful `requestCapabilities` grant, subsequent `getAccounts` returns the granted accounts silently.

**Component tests:** none — no popup changes in v3.

**Test count summary (v3.1)**

```
Unit (errors.test.ts):                1 new test (round-trip walletErrorFromPayload)
Unit (dispatcher.test.ts):            6 new tests (was 5; added session-not-found pin + same-shape no-op)
Unit (error-envelope.test.ts):        3 new tests (was 1 "wire-response writer"; expanded into pure-helper file with envelope round-trip)
E2E:                                  1 updated (relaxed assertion to flexible match)
                                      ─────────────
Total:                                11 changes
```

(v2 had 16; v3.0 had 8; v3.1 has 11 after auditor-requested additions. Still 30% smaller than v2. Every test pins one row of the contract.)

### Phase 3 — Verification matrix (post-deploy)

| Step | Pass criterion |
|---|---|
| Build extension, side-load on test profile with ≥1 account | Extension loads normally. |
| Connect to Nethermind faucet → emoji match → wait for next step | Our wallet shows the **capabilities popup** with Nethermind's full manifest (accounts + contracts + simulation + transaction). Single popup, not two. |
| Approve all capabilities → pick an account | Faucet shows the connected account. |
| Click "Drip" (assuming a fresh L1→L2 message exists) | Claim transaction goes through. Faucet shows "claimed" state. |
| Connect to Wonderland Token Dripper → emoji match → wait for next step | If Wonderland has a fallback: capabilities popup opens with their manifest. If not: page shows an error containing "CAPABILITY_NOT_GRANTED" or similar — actionable for their team. |
| Run existing CI e2e suite (`bun run e2e:agent` if local sandbox available) | All `meta-getAccounts*.test.ts` pass under the new contract. Other tests unaffected. |
| Disconnect Nethermind → reconnect | Session is sticky (persisted capability grants); accounts visible without re-grant. |

### Phase 4 — File issues with dApp teams (follow-up action, not blocking the PR)

- Nethermind: file an issue at their `aztec-faucet` repo pointing at `use-wallet-connect.ts:84-114` and the wallet-sdk skill recommendation. Suggested fix: invert the try/catch — call `requestCapabilities(faucetCapabilities())` first, fall back to `getAccounts()` only if `requestCapabilities` throws (for wallets that don't implement it). 
- Wonderland: bundle is closed-source. File an issue at any public Wonderland Aztec repo or contact the team directly. Subject: "Aztec wallet integration — call requestCapabilities() before getAccounts()".

Tracked as a follow-up TODO in the implementation PR description, NOT as a blocker.

---

## 5. Security & Adversarial Considerations

Tighter than v2 because the v3 surface is smaller. Each row is the explicit ask for both auditors.

### Threat: Pre-existing Bug B — silent canCreateAuthWit escalation

**Fix:** Phase 1.5 (unchanged from v2). Field-aware delta filter + `enrichGrantedCapabilities` reads from stored grant. Tests #5 and #6 pin the regression. **Critical, lands in this PR.**

**Residual:** same field-blind diff exists for non-`accounts` capabilities. Filed as follow-up `wallet-sdk-capability-field-diff`.

### Threat: Error-string information leakage / stable-contract requirement

Our throw includes the literal message "accounts capability not granted. Call requestCapabilities() first." A dApp could exfiltrate this via standard error logging. **Assessment: low risk.** No secret information is in the message — it's a documented protocol-level error.

**Stable-contract requirement (v3.1, opus):** the error message string is a **public contract**. dApp authors who substring-match on it (suboptimal but inevitable) lock our wording in. **Invariant:** the error message MUST be a fixed string literal. It must NEVER include user-supplied data (origin, session ID, account address, etc.) — both for stability and because the SDK does `new Error(jsonStringify(error))` and unescaped user input could break the JSON envelope. Pinned by Test #10 (which constructs `CapabilityNotGrantedError("accounts")` and asserts the exact message wording).

### Threat: Log-spam from misbehaving dApps (v3.1, opus)

A dApp that re-fires `getAccounts()` on every React render (common in unfortunate effect dependencies) would spam our pre-grant throw log line. **Mitigation:** log level is `LogLevel.Debug`, not `LogLevel.Info`, so it stays out of normal operation logs but is available for diagnosis. If telemetry shows this becoming a problem, a per-origin debounce can be added — not blocking for this PR.

### Threat: Throwing identifies wallet (fingerprinting)

A page can detect our wallet by triggering `getAccounts()` and observing the structured error code. **Assessment: not new.** Our wallet is already identifiable via the discovery handshake (`WalletInfo.walletId === "nulo"`). EIP-1193 codes are a standardized response format; using them does not increase fingerprinting surface meaningfully.

### Threat: Bare-`catch` dApps mis-route the error

If a dApp's `catch` block does something unexpected (e.g., shows the raw error message to the user, or treats any throw as "wallet locked"), our error string might cause a poor UX. **Mitigation:** the error message is plain English, recognizable as a permission issue. We rely on dApp authors writing reasonable `catch` blocks; this is consistent with how every Web3 wallet works.

### Threat: dApps without fallback are now unreachable

A dApp that calls `getAccounts()` with NO fallback (no `requestCapabilities` path anywhere) will be permanently broken with v3. **Mitigation:** file issues with affected teams. The wallet-sdk skill already calls this an anti-pattern; we're enforcing the spec. Long-term, the cost of supporting non-compliant dApps exceeds the cost of nudging them to comply.

### Threat: Throw behavior changes for currently-working flows

The fast path (`getAccounts` after a successful `requestCapabilities` grant) is **preserved unchanged**. The only behavior change is the pre-grant path, which today returns `[]` (a passive failure). v3 converts the passive failure to an active throw. **Mitigation:** Test #3 is the regression pin for the fast path.

### Threat: Cross-origin / cross-chain replay

Same as v1 / v2. Session lookup is `(origin, chainId)`. The throw inherits that scoping — a dApp can't trigger our throw on behalf of another origin. No change.

### Threat: Race between session creation and first `getAccounts`

If a dApp races `getAccounts()` immediately after `confirm()`, before the session has fully persisted, today we already throw `"No dApp session found"`. The dApp's fallback handles this (any throw triggers the catch). v3 preserves this behavior; the new throw is **in addition to**, not replacing.

### Crypto / supply chain / least privilege

No change. ECDH P-256, AES-256-GCM, emoji verification unchanged. No new dependencies. The Phase 1 throw and Phase 1.5 fix do not introduce new authority paths — they restrict existing ones.

---

## 6. UX / copywriting

### Error message text

`"accounts capability not granted. Call requestCapabilities() first."`

This text is for **dApp developers**, not end users — it appears in dApp consoles / error reporters. Lower-case to match our brutalist style, but the imperative ("Call requestCapabilities() first") is in normal case because it's a function-name reference.

### No popup changes

v3 does not modify the capability popup. The existing `/windows/capabilities` route remains the single account-selection surface, triggered ONLY by explicit `requestCapabilities` calls.

### dApp-side copy

Not in our codebase. The dApps themselves will display their own error UX when our throw fires. We control the wire shape; they control the UI.

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Bug B (pre-existing, silent escalation)** | Fixed in Phase 1.5 | Critical | Tests #5, #6. Audit re-review. |
| Wonderland has no fallback → stays broken | Medium-low (most modern Aztec dApps have fallbacks) | Medium | File issue with Wonderland team. Document in the PR that this is the expected outcome for non-compliant dApps. |
| Some other dApp we haven't seen is more affected than helped | Low | Medium | The wallet-sdk skill explicitly calls `getAccounts`-first an anti-pattern; if any dApp is broken by v3, they were also broken in spirit before. Manual community survey post-deploy. |
| Existing playground test pins broken behavior | High (we KNOW it does — `meta-getAccounts-pregrant.test.ts:27-29`) | Low | Phase 2 explicitly updates it. |
| Bare-catch dApps mis-handle the throw | Low | Low | The throw message is plain English. Standard pattern. |
| Phase 1.5 misses an edge field on `accounts` | Low | Medium | `accountsCapsEqual` compares 2 booleans. Audit re-review will catch. |
| Field-blind diff for non-`accounts` types (pre-existing) | Low | Medium | Filed as follow-up `wallet-sdk-capability-field-diff`. Out of this PR. |

---

## 8. Roll-out

1. Branch `feat/wallet-sdk-accounts-not-granted-error` off `dev`. (New branch name reflects v3 direction.)
2. Land Phases 1 + 1.5 + Phase 2 tests as one PR.
3. Update `meta-getAccounts-pregrant.test.ts` — flip the assertion.
4. `bun run audit:vue` + `bun run test:e2e` smoke before push.
5. PR → `dev` → squash merge. PR title: `fix(wallet-bridge): throw CAPABILITY_NOT_GRANTED for pre-grant getAccounts (#nnn)`.
6. Build extension, side-load, perform §3 manual verification.
7. Append a short section to `packages/wallet-bridge/README.md`:
   - The new `CapabilityNotGrantedError` + EIP-1193 4100 mapping
   - The dApp-side parse recipe (per opus v3 — the SDK wraps as `new Error(JSON.stringify(error))`, so reading the code requires `JSON.parse(err.message).code`):

   ```ts
   // dApp-side discrimination after wallet.getAccounts() throws:
   try {
     await wallet.getAccounts();
   } catch (err) {
     // TypeScript-safe message extraction (handles non-Error throws too).
     const msg = err instanceof Error ? err.message : String(err);
     try {
       const parsed = JSON.parse(msg);
       if (parsed.code === 4100 && parsed.data?.walletErrorCode === "CAPABILITY_NOT_GRANTED") {
         // Wallet says: call requestCapabilities first.
       }
     } catch { /* not a structured error — bare-catch fallback */ }
     await wallet.requestCapabilities(fullManifest);  // Always-correct fallback
   }
   ```
8. File issues with Nethermind + Wonderland teams (Phase 4) — track as separate post-merge action.
9. File two follow-up plans:
   - `implementations-plan/wallet-sdk-capability-field-diff/plan.md` (broaden Phase 1.5)
   - `implementations-plan/wallet-sdk-requestcapabilities-rate-limit/plan.md` (per-origin cap-popup rate limit)

The third v2 follow-up (`wallet-sdk-capability-popup-dedupe`) is no longer relevant in v3 (no implicit popup path exists).

---

## 9. Files touched (final)

```
packages/extension-messaging/src/errors.ts                                      [add CapabilityNotGrantedError]
packages/extension-messaging/src/errors.test.ts                                 [extend with round-trip test]
packages/wallet-bridge/src/dispatcher.ts                                        [edit handleGetAccounts ONLY — no error writer here]
packages/wallet-bridge/src/dispatcher.test.ts                                   [extend with 6 new tests]
packages/wallet-bridge/README.md                                                [append section: new error + parse recipe]
packages/extension/src/wallet/services/wallet-sdk/background.ts                 [replace inline error mapping with toWalletResponseError(); comment fix line 391]
packages/extension/src/wallet/services/wallet-sdk/error-envelope.ts             [NEW — extracted pure helper, v3.1]
packages/extension/src/wallet/services/wallet-sdk/error-envelope.test.ts        [NEW — 3 tests for the helper, v3.1]
packages/extension/tests/e2e/network/meta-getAccounts-pregrant.test.ts          [flip assertion, flexible match]
implementations-plan/wallet-sdk-implicit-account-grant/plan-v3.md               [this file]
implementations-plan/wallet-sdk-implicit-account-grant/lessons/                 [populated during impl]
```

**Follow-up plans (NOT touched in this PR, but filed):**

```
implementations-plan/wallet-sdk-capability-field-diff/plan.md                   [new dir]
implementations-plan/wallet-sdk-requestcapabilities-rate-limit/plan.md          [new dir]
implementations-plan/wallet-sdk-error-envelope-typed-codes/plan.md              [new dir — v3.1, opus — expose walletErrorCode as top-level discriminator]
```

**Files DROPPED from v2:**

- `packages/wallet-bridge/src/capabilities.ts` (no `RejectedCapabilityRecord.implicit` field needed)
- `packages/wallet-bridge/src/dapp-interaction-protocol.ts` (no `CapabilityParams.implicit` field needed)
- `packages/extension/src/popup/windows/capabilities/index.vue` (no hollow-state work — popup is reached only via existing explicit path)
- `packages/extension/src/popup/windows/capabilities/index.vue.test.ts` (no new component tests)
- `packages/extension/tests/e2e/network/meta-getAccounts-implicit-reject.test.ts` (no implicit-reject contract to test)

---

## 10. Closed clarifying questions (carried from v1)

| # | Question | Answer | Implication in v3 |
|---|---|---|---|
| Q1 | Behavior of `getAccounts()` when called pre-capabilities | **(REVISED)** Throw structured 4100 error (Option B). v1/v2 chose lazy grant; v3 pivots after user analysis. | §3 design |
| Q2 | Test depth | Unit + smoke e2e (no network e2e) | §4 Phase 2 |
| Q3 | Reverse-engineer Wonderland bundle | No — trust the symptom match | §3 verification |
| Q4 | Other dApps to verify against | Just Nethermind + Wonderland | §3 verification |

---

## 11. Open questions for the v3 dual audit

Targeted at codex + opus for the v3 cycle:

1. **Throw vs lazy grant — does the spec-alignment argument hold?** v3 chooses to throw based on the wallet-sdk skill's explicit recommendation. Is there a counter-argument I'm missing? Are there dApps in the ecosystem we should expect to break with v3 that wouldn't break with v2?

2. **EIP-1193 code 4100 — is this the right code?** Alternatives: a custom code (e.g., `4101`), reusing 4100 with our walletErrorCode discriminator (current choice), or no code at all (plain Error). My reasoning: 4100 is the canonical "unauthorized" code and dApps that follow EIP-1193 expect it. We discriminate further via `data.walletErrorCode = "CAPABILITY_NOT_GRANTED"` for tooling that wants to differentiate from other 4100s.

3. **Test coverage adequacy.** 8 changes total (7 new + 1 flipped existing). Each pins one row. Is anything missing?

4. **Phase 1.5 scope.** Same as v2 — `accounts`-only field-aware diff, with `wallet-sdk-capability-field-diff` as follow-up for breadth. Codex approved this scope in the v2 final review; carrying it forward unchanged.

5. **Throw timing.** I throw INSIDE `handleGetAccounts`, before any heavy lifting. Is there a code path between dispatcher entry and `handleGetAccounts` where the throw could leak in a way that breaks the wire response shape? **v3 audit answer (codex + opus, both verified):** safe — `enforceCapability` exempts `getAccounts` (`capability-map.ts:14`), `enforceScope` runs only if `grants.length > 0`. The throw inside `handleGetAccounts` propagates cleanly through `dispatch()` → `background.ts:460` catch → `toWalletResponseError()` envelope. Pinned by Tests #2, #3, and #10.

6. **Adversarial review (explicit ask):** *what could go wrong with v3 specifically? what would an attacker target in the structured-error path? are there ways a dApp could weaponize the EIP-1193 4100 response (e.g., showing a misleading permission dialog after the throw)? any supply-chain / crypto / least-privilege concerns I haven't addressed?*

7. **Branch name change.** I'm renaming the branch from `feat/wallet-sdk-implicit-account-grant` to `feat/wallet-sdk-accounts-not-granted-error` to reflect the v3 direction. The directory name `wallet-sdk-implicit-account-grant/` stays for audit-history continuity. Is this confusing or appropriate?

---

## 12. ASCII state tracker

```
[✓] 0. Clarifying questions
[✓] 1. Plan v1 drafted
[✓] 2. Codex xhigh audit v1
[✓] 2. Opus 4.7 audit v1
[✓] 3. Consolidate v1 audits → plan-v2.md
[✓] 4. Final codex review of v2 → plan-v2.1
[✓] 5. ELI5 HTML companion (will update for v3)
[—] 6. Approval gate — DEFERRED, user pivoted to Option B (re-plan)
[✓] 7. Plan v3 drafted
[✓] 8. Dual audit of v3 (audit-codex-v3.md, audit-opus-v3.md)
[✓] 9. Consolidate v3 audits → plan-v3.1 patches (this file)
[✓] 10. Final codex review of v3.1 → ship-with-tiny-changes, 3 nits patched as v3.1.1
[✓] 11. Update ELI5 for v3 → eli5.html
[▶] 12. Approval gate v3 (this is where you, Alejo, decide)
[ ] 13. Implementation
[ ] 14. Post-impl codex review
[ ] 15. Fix loop
```

---

## 13. v2 → v3 changelog

**Direction change** (user-driven): Lazy implicit grant → structured `CapabilityNotGrantedError` throw. Reason: lazy grant only fixed account selection, not the downstream transaction flow. Throw forces dApp into its existing fallback path, which sends the full capability manifest — fixing the whole flow in one popup.

**Removed phases:**

- Phase 1 lazy grant body
- Phase 1.6 implicit/explicit rejection schema + TTL
- Phase 2 popup hollow-state + CTA work
- Three of the v2 follow-up plans (only two carry forward)

**Removed files from touched list:**

- `packages/wallet-bridge/src/capabilities.ts` (no schema extension)
- `packages/wallet-bridge/src/dapp-interaction-protocol.ts` (no protocol-type extension)
- `packages/extension/src/popup/windows/capabilities/index.vue` (no popup changes)
- `packages/extension/src/popup/windows/capabilities/index.vue.test.ts`
- `packages/extension/tests/e2e/network/meta-getAccounts-implicit-reject.test.ts`

**Added:**

- New `CapabilityNotGrantedError` class in `@nulo/extension-messaging`
- Dispatcher error-writer case for EIP-1193 4100 mapping
- Test #1 (error round-trip), Test #7 (wire response shape)

**Preserved from v2:**

- Phase 1.5 field-aware delta filter for `accounts` (Bug B fix — independent of v2/v3 choice)
- `background.ts:391` comment fix (wording updated for v3: "via requestCapabilities()" not "via getAccounts()")
- `formatSessionAccounts` extraction for readability (carried over from v2 Phase 1 even though the surface is smaller)
- Verification matrix style
- Follow-up plans: `wallet-sdk-capability-field-diff`, `wallet-sdk-requestcapabilities-rate-limit`

**Test count:** 16 → 8 → 11 (v2 → v3.0 → v3.1). Still 30% smaller than v2.

---

## 14. v3.0 → v3.1 changelog (post-dual-audit patches)

Both v3 auditors (codex + opus) returned `ship-with-changes` with convergent findings. Patches applied:

### Convergent findings (both auditors flagged)

- **Wrong file path for the error writer.** The EIP-1193 mapping lives in `packages/extension/src/wallet/services/wallet-sdk/background.ts:461-475`, NOT in `dispatcher.ts`. v3.0 §1.2 had the wrong location. **Fix:** Phase 1.2 now only touches `dispatcher.ts` for the `handleGetAccounts` throw. Error-mapping work moves to §1.4 with file extraction.
- **Wire-response writer needed a real testable seam.** v3.0 proposed a test against an inlined branch in `handleWalletMessage` — hard to test. **Fix:** new Phase 1.4 extracts `toWalletResponseError(error)` into a pure helper at `packages/extension/src/wallet/services/wallet-sdk/error-envelope.ts`. Tests #9, #10, #11 live in `error-envelope.test.ts`.
- **E2E assertion was too strict.** v3.0 asserted `error.code === 4100` directly — but the `@aztec/wallet-sdk` wrapper does `new Error(JSON.stringify(error))`, so the dApp sees the envelope as a string in `err.message`. **Fix:** relaxed e2e assertion to `expect(JSON.stringify(result)).toMatch(/4100|CAPABILITY_NOT_GRANTED/)`. Exact wire shape pinned by Test #11.

### Opus-only findings

- **Wire reality clarification.** §3 "Why 4100" wrongly claimed dApps see `code === 4100` directly. **Fix:** rewrote §3 to acknowledge the JSON-stringified envelope and document the dApp-side parse recipe. Added the recipe to the README append in §8.
- **Session-not-found ordering pin.** v3.0 had no test for the session-not-found path. A future refactor could swap order and change the error semantic. **Fix:** added Test #3 pinning that session-not-found throws BEFORE the `CapabilityNotGrantedError` check.
- **JSON-envelope round-trip test.** §3's claim that `JSON.parse(err.message).code === 4100` works after the SDK wrap needs a contract test. **Fix:** Test #11 pins this exact recipe.
- **Stable error-message contract.** The error message string is a public contract; user data interpolation would both break stability and inject into the JSON envelope. **Fix:** added §5 row + invariant note.
- **Log-spam mitigation.** Changed pre-grant throw log from `LogLevel.Info` to `LogLevel.Debug` to handle dApps that re-fire `getAccounts()` per render.
- **New follow-up plan filed.** `wallet-sdk-error-envelope-typed-codes` — explore exposing `walletErrorCode` as top-level discriminator without `JSON.parse`. Low-priority, post-launch.

### Codex-only findings

- **Same-shape no-op test.** v2 had a regression pin for `accounts(same shape) re-requested → no popup`. v3.0 dropped it by accident. **Fix:** added Test #7. Verifies field-aware diff doesn't over-trigger.

### Triage of v3 open questions (§11) per the audits

- Q1 (spec-alignment): both confirmed sound. No change.
- Q2 (EIP-1193 4100): both confirmed right code, with wire-reality caveat patched into §3.
- Q3 (test coverage): both flagged the seam issue + same-shape gap. All patched.
- Q4 (Phase 1.5 scope): both confirmed `accounts`-only is right for this PR. No change.
- Q5 (throw timing): both verified safe. Answer baked into §11 Q5.
- Q6 (adversarial review): handled in §5 expansion (stable-contract + log-spam rows).
- Q7 (branch / dir naming): both confirmed acceptable. No change.

### Verdict

After v3.1 patches, both audits' concrete blockers are addressed.

### v3.1 final-pass codex review (audit-codex-final-v3.md)

Codex returned **ship-with-tiny-changes** on v3.1. Patch-by-patch absorption check passed for all 10 v3.1 patches. Three tiny doc-nits flagged and applied:

- **Stray "dispatcher's error writer" reference in §3:** fixed to point to `background.ts:461-472`. The §3 narrative now correctly says "the wallet-sdk background handler's structured-response writer (extracted to a helper in Phase 1.4)".
- **README parse snippet TS-safe message extraction:** updated to `const msg = err instanceof Error ? err.message : String(err)` before `JSON.parse(msg)`. Handles non-Error throws cleanly.
- **Exact-message assertion in Test #2:** strengthened to pin the literal message wording (`"accounts capability not granted. Call requestCapabilities() first."`) so the §5 stable-contract invariant has a regression pin. Without this, a future "copy improvement" PR could silently break substring-matching dApps.

Codex also confirmed the broader picture: `toWalletResponseError` adds no new authority, the README contract around `data.walletErrorCode` is acceptable de-facto contract surface, `error-envelope.ts` is in the right layer (wallet-sdk transport shaping, not wallet-bridge domain), and the pivot to v3 remains right.

**Final verdict (post-v3.1.1):** ready for user approval gate.
