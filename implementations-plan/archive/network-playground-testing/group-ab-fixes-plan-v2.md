# Plan v2 — Group A + Group B fixes (post-audit)

> Status: **draft for user approval**. Both audits returned. v1's "popup-readiness everywhere" framing was wrong. Restructured around fault boundaries per Codex + Claude consensus.

## TL;DR

- **1 real wallet bug** (dispatcher reject path) → affects `cap-request-rerequest` deterministically.
- **1 real playground bug** (`<textarea>` not bound to state) → blocks `contracts-register`.
- **1 cosmetic playground bug** (hand-built `FunctionCall` fails Zod) → currently masked by `["ok","error"]` tolerance in `authwit-callIntent`.
- **7 stale tests** → flake from timing/input-commit, not the issues v1 hypothesized. Need per-test deterministic gates.

The user's instinct was right: `cap-request-rerequest` IS surfacing a real bug.

---

## What both audits agree on

### Confirmed REAL impl bug — dispatcher reject path
`packages/wallet-bridge/src/dispatcher.ts:367-505` (`handleRequestCapabilities`):

1. Line 428: `await this.dappInteractionService.requestCapabilities(...)` — throws on user reject (popup calls `rejectInteraction` → `windowManager.cancel` → `handle.reject("User rejected")`).
2. Lines 437-488 (incl. `setCapabilityRejections` at line 488) **never execute**.
3. `existingRejections = []` on next request → `reRequested = []` → popup never receives `reRequested` flag → badge never renders.

**Test fails deterministically, not flakily.**

Verified at:
- `dispatcher.ts:428-488` (read in this session)
- `capabilities/index.vue:293-300` — `reject()` calls `rejectInteraction` and `closeWindow` without awaiting
- `dapp-interaction/service.ts:109-116` — `rejectInteraction` cancels the interaction promise
- `window-manager.ts:148-159` — `_settleUserClose` rejects with `"Window closed by user."`

### Confirmed REAL test/playground bug — contracts-register textarea
`packages/playground/src/sections/contracts.ts:27` uses `<textarea name="contractInstance">`.
`packages/playground/src/main.ts:111-122,136-140` only queries `input[name]` — textarea is excluded from:
- `collectInputs()` (state snapshot)
- `restoreInputs()` (state restore on re-render)
- The `input` event listener that calls `setInput()`

⇒ `getInput("contractInstance")` always returns empty.
⇒ `contracts.ts:88` throws `"Empty contractInstance — set the input first"`.
⇒ Test deterministically fails.

### Confirmed cosmetic playground bug — authwit callIntent
`packages/playground/src/sections/authwit.ts:54-66` hand-built object:
- `selector: { value: 0n }` — `FunctionSelector` schema expects hex string (Codex), Zod throws
- Missing `type` (FunctionType) and `hideMsgSender` per upstream `MessageHashOrIntentSchema` (Claude)

Dispatcher returns `error` to dApp. **Test passes anyway** because it tolerates `["ok","error"]`. Fix is fidelity, not test correctness.

### Confirmed FALSE alarms in v1
- ❌ "popup-readiness lag in `waitForPopup`" — already gated on `cap-item OR cap-account-item` selectors at `popups.ts:198-205`.
- ❌ "`callExpectingNoPopup` returns early" — `playground.ts:118-141` correctly awaits `waitForPgResult` which only returns on `data-status="ok"|"error"` (`playground.ts:66-105`).
- ❌ "`sim-simulateTx`/`profileTx` opts shape mismatch" — opts are canonical per `SimulateOptionsSchema`/`ProfileOptionsSchema`. Dispatcher overwrites `from` (`dispatcher.ts:655-680`) and execution injects scopes (`service.ts:1114-1142`). The TODO claim is stale.
- ❌ "`chrome.runtime.connect` race" — `extension-messaging/src/background/client.ts:48-67` retries connect; `request()` blocks until `Connected`.

---

## Where the audits diverged

### `cap-request-reject` classification

| Audit | Verdict | Reasoning |
|---|---|---|
| Codex | IMPL-ONLY | Reject path doesn't await before close → "Window closed by user." instead of "User rejected" |
| Claude | STALE/TEST-ONLY | Test only asserts `result.status === "error"`, passes regardless of error text |

**Resolution**: Claude is right at the test level — `cap-request-reject.test.ts:31` only checks `expect(result.status).toBe("error")`. The popup not awaiting before close is a real polish issue, but it's not what fails this test. The actual flake source is timing (popup target detach + click race). Treat as STALE/timing.

(But the popup-reject-doesn't-await issue is worth fixing in the same PR as the persistence bug — both touch the reject path and improve user-facing error fidelity.)

### Per-test classification (final)

| # | Test | Class | Action |
|---|---|---|---|
| 1 | `cap-request-basic` | STALE | un-skip; add `:not([disabled])` gate before approve click |
| 2 | `cap-request-reject` | STALE | un-skip; add `:not([disabled])` gate before reject click |
| 3 | `cap-request-rerequest` | **IMPL-ONLY** | fix dispatcher → un-skip |
| 4 | `authwit-innerHash` | STALE | un-skip; tighten input-commit wait |
| 5 | `data-privateEvents` | STALE | un-skip; tighten input-commit wait |
| 6 | `contracts-register` | **TEST-ONLY** | fix playground textarea binding → un-skip |
| 7 | `sim-executeUtility` | STALE | un-skip |
| 8 | `authwit-callIntent` | TEST-ONLY (cosmetic) | fix playground stub for fidelity |
| 9 | `sim-simulateTx` | STALE | un-skip; drop the wire-shape TODO |
| 10 | `sim-profileTx` | STALE | un-skip; drop the wire-shape TODO |

Net: **1 impl bug + 1 real playground bug + 1 cosmetic playground bug + 7 stale.** Vastly different from v1's "7 popup-readiness + 3 wire-shape".

---

## Phase 0 — Quick recon (~15 min)

Replaces v1's "run all 10". We've already characterized the failures in audit; now just confirm:

1. Run `cap-request-rerequest` once at HEAD with `console.log` at `dispatcher.ts:428` + `488`. Confirm line 488 never logs on reject path.
2. Run `contracts-register` once at HEAD with `console.log` in `safe("registerContract")` printing `getInput("contractInstance")`. Confirm it returns empty.
3. Run the 7 STALE tests at HEAD HEADLESS=0, 3 runs each. Capture failure modes per-test (NOT to discover root cause — to validate that the proposed fix targets it).

If any STALE test passes 3/3 at HEAD: simply un-skip and commit. If it flakes, apply the targeted gate.

---

## Phase 1 — PR 1: Dispatcher reject persistence fix (~45 min)

**File:** `packages/wallet-bridge/src/dispatcher.ts`

**Change:** Wrap `requestCapabilities` await in try/catch. On throw, persist `delta`-wide rejections, then re-throw.

```typescript
let result: CapabilityResult
try {
  result = await this.dappInteractionService.requestCapabilities({...})
} catch (err) {
  // User rejected/closed — persist rejection for ALL delta items so re-request shows badge
  const newRejections: RejectedCapabilityRecord[] = delta.map((cap) => ({
    capabilityType: cap.type as string,
    rejectedAt: Date.now(),
  }))
  const deltaTypes = new Set(delta.map((cap) => cap.type as string))
  const mergedRejections = [
    ...existingRejections.filter((r) => !deltaTypes.has(r.capabilityType)),
    ...newRejections,
  ]
  await this.dappSessionService.setCapabilityRejections(dappSession.id, mergedRejections)
  throw err
}
```

**Bonus fix in same PR:** `capabilities/index.vue:293-300` — make `reject()` await `rejectInteraction()` before `closeWindow()`. Eliminates the "Window closed by user." message in the reject error.

**Unit test:** `packages/wallet-bridge/src/dispatcher.test.ts` (new or existing).
- Setup: dispatcher with mocked services; first `requestCapabilities` rejects with "User rejected".
- Assert: `setCapabilityRejections` called with all delta items before throw.
- Assert: second `requestCapabilities` call gets `reRequested` array containing all previously-rejected types.

**E2E validation:**
- Un-skip `cap-request-rerequest`. Run individually 3x. Must pass 3/3.
- Run `cap-request-reject` (still skipped) to confirm no regression elsewhere — should still fail flakily for the timing reason, that's expected.

**Risk:** Low. Try/catch around an existing await; new write happens only on throw path which is currently a no-op.

---

## Phase 2 — PR 2: Playground correctness + test gates (~1.5-2 hr)

### B1 — Playground textarea binding fix
**File:** `packages/playground/src/main.ts:109-140`

Change selectors from `input[name]` to `input[name], textarea[name]`:
- `collectInputs()`
- `restoreInputs()`
- The state-sync `input` event listener at `:136`

Verify with HEADLESS=0 that the test's `dispatchEvent(new Event("input"))` now reaches state.

### B2 — Per-test deterministic gates
For Phase 0 recon results that show flake:

**`cap-request-basic` / `cap-request-reject`:**
Add `popup.waitForSelector('[data-testid="cap-approve-btn"]:not([disabled])', { visible: true, timeout: 5_000 })` (or `cap-reject-btn`) inside `approveCapabilities` / `rejectCapabilities` helpers in `popups.ts` BEFORE the click. This gates against early clicks while the Vue tree mounts the buttons in disabled state.

**Silent-path tests** (`authwit-innerHash`, `data-privateEvents`, `sim-executeUtility`, `sim-simulateTx`, `sim-profileTx`):
The flake hypothesis (per Claude) is input-commit timing — `replaceInputValue` doesn't always commit before the click handler reads from state. Add a small assertion in the test:
```typescript
await page.waitForFunction(
  (name, expected) => document.querySelector(`[name="${name}"]`)?.value === expected,
  { polling: 100, timeout: 2_000 },
  inputName, expectedValue,
)
```
before the action click. Or — safer — read state directly via `page.evaluate` to confirm `getState().inputs[name]` is set.

### B3 — `authwit-callIntent` FunctionCall replacement
**File:** `packages/playground/src/sections/authwit.ts:54-66`

Replace hand-built object with canonical pattern. Codex prefers `ContractFunctionInteraction.getFunctionCall()`; Claude accepts either. Simplest:
```typescript
import { FunctionCall, FunctionSelector, FunctionType } from "@aztec/aztec.js"

const intent = {
  caller: AztecAddress.fromString(consumer),
  call: FunctionCall.from({
    name: "transfer_public_to_public",
    to: AztecAddress.fromString(consumer),
    selector: await FunctionSelector.fromSignature("transfer_public_to_public((Field),(Field),Field,Field)"),
    type: FunctionType.PUBLIC,
    hideMsgSender: false,
    isStatic: false,
    args: [],
    returnTypes: [],
  }),
}
```
Test passes either way; this is fidelity. If signature/import path is wrong, fall back to building a real `Contract.at(...)` interaction and calling `.getFunctionCall()`.

### B4 — Drop stale TODOs
- Remove "executeUtility-style scopes/options shape mismatch" framing from `sim-methods.test.ts` TODO comments.
- Update `cap-request-basic`/`cap-request-reject` TODOs to point at the gate fix instead of "popup-readiness timing race".

### B5 — Un-skip 9 tests
After the fixes land, un-skip the remaining 9 (all except `cap-request-rerequest` which is in PR 1).

---

## Phase 3 — Validate

Per the iterative-validation memory: after EACH change, run targeted test individually with `pkill -9 chrome` between runs.

Final validation:
- Run each of the 10 un-skipped tests individually 3x.
- Run full `fee-methods.test.ts` (regression check).
- Run full smoke (`bun run test:e2e`).

---

## PR strategy

3 PRs, ordered by risk (lowest first):

| PR | Scope | Files | Time |
|---|---|---|---|
| **PR 1** | Dispatcher reject persistence + popup await fix + unit test + un-skip rerequest | `dispatcher.ts`, `capabilities/index.vue`, `dispatcher.test.ts`, `cap-request-rerequest.test.ts` | ~45 min |
| **PR 2** | Playground textarea fix + per-test gates + un-skip 8 tests | `main.ts`, `popups.ts`, 8 test files | ~1.5-2 hr |
| **PR 3** | authwit callIntent FunctionCall fidelity (low-priority, optional) | `authwit.ts` | ~15 min |

Each PR independent + reversible. PR 1 lands the real bug fix without touching test infra; PR 2 absorbs the test-side cleanup; PR 3 can ship later or be deferred entirely.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Dispatcher try/catch breaks the success path | **L** | Try/catch only wraps the await; success path unchanged. Unit test covers both branches. |
| Popup `await rejectInteraction` introduces close-race | **L** | Already async; just adding await. Window close happens after the RPC completes. |
| Textarea binding change breaks other inputs | **L** | Selector union, not replacement. Existing `input[name]` still works. |
| Per-test gates mask real flakes that need infra fix | **M** | If a test still flakes 3 runs after gate, escalate — don't keep adding waits. |
| `authwit-callIntent` PR 3 breaks because `FunctionCall.from` import path changed | **L** | Optional PR; defer if it churns. Test passes without it. |

---

## What's removed from v1

- Phase 0 "run all 10 tests at once" — replaced with targeted recon since audits already characterized failures.
- Phase 1 A1/A2/A3 framing as "popup-readiness everywhere" — wrong diagnosis.
- Phase 2 B2 "wire-shape mismatch for sim methods" — incorrect; opts shape is canonical.
- Risk row "real bug surfaces in dispatcher" — promoted from risk to PR 1.
- The `callExpectingNoPopup` rewrite paragraph — helper is correct.

---

## Open issues (for user discussion)

1. **PR 3 priority**: ship now (fidelity) or skip entirely (test passes anyway)?
2. **`cap-request-reject` popup `await` fix**: bundle in PR 1 (touches same file as persistence fix) or split into a separate "reject UX polish" PR? Recommend bundling.
3. **Phase 0 recon scope**: is 15 min enough, or do you want a fuller pass before any code changes?
4. **Claim verification at execution time**: both audits read code but didn't run tests. Phase 0 confirms reality before commits.

---

## Decision points for user approval

- [ ] **PR 1 scope** (dispatcher reject persistence + popup await + unit test + un-skip rerequest) — OK?
- [ ] **PR 2 scope** (playground textarea + per-test gates + un-skip 8 tests) — OK?
- [ ] **PR 3 scope** (authwit-callIntent fidelity) — ship, defer, or skip?
- [ ] **Phase 0 recon** (15 min) — OK or skip straight to PR 1?
- [ ] **Branching**: cut from `master` post-WS3 (`b31c554`)? OK?

---

## Time estimates (revised)

- Phase 0 recon: 15 min
- PR 1 (dispatcher fix): 45 min
- PR 2 (test/playground): 1.5-2 hr
- PR 3 (callIntent fidelity): 15 min
- Validation: 30 min
- **Total: 3-3.5 hr realistic** (down from v1's 4-5.5 hr because audits killed the speculative work)

---

**End of plan v2.**
