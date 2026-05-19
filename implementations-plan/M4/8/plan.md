# M4.8 — Passkey session symmetry (DECISION MEMO + PREWORK; 3-4d execution after decision)

> **STATUS: FOLDS INTO M4.2's Strict Security Mode** (2026-04-26 user decision — see `../DECISIONS.md`). When strict mode is OFF (default): passkey re-PRF on next popup interaction = today's behavior, asymmetric vs password (which silently restores). When strict mode is ON: both flows re-auth on SW restart, symmetric. M4.8 = no separate PR; behavior already matches Design X. SECURITY.md update happens jointly with M4.2.
>
> **Audit tier**: dual (codex xhigh + Plan agent). Audited as decision memo.
>
> **Status**: NOT a step-by-step execution plan. M4.8 has dependencies on M4.2 (passhash design — see `implementations-plan/M4/2/plan.md`) AND a separate decision about pending-request behavior on SW restart (codex BLOCKING).

## Why this is a memo, not an execution plan

**Codex audit BLOCKING**: M4.8 depends on more than M4.2. Passkey pending requests are memory-only at `packages/extension/src/wallet/services/passkey/service.ts:26` (`private pending: Map<string, PendingPasskey> = new Map()`). On SW restart, every in-flight passkey request is dropped. The pre-existing audit (`architecture/codex-notes/08-passkey-flow.md:198`) already flagged this.

If M4.8 promises "SW-restart symmetry" with password profiles, the plan must explicitly pick:
- **(M4.8.x) Re-prompt on next popup open only** — accept that any in-flight passkey window is dead. Popup re-opens, user re-clicks "unlock with passkey," PRF flow re-runs.
- **(M4.8.y) Absorb minimal pending-request durability/recovery** — persist PendingPasskey envelope, recover on SW restart. *Aligns with M1.2 deferred work.*

"After M4.2" alone isn't enough — M4.8 must also commit to one of these.

## Current state (verified at `55f88a4`)

`packages/extension/src/wallet/services/passkey/service.ts:26`:
```ts
private pending: Map<string, PendingPasskey> = new Map()
```

`PendingPasskey` shape (from spec.ts): `{ request: PasskeyRequest, handleId: string }`. Memory-only, doubles via `WindowManager.openAndAwait`'s in-memory handle.

SessionManager treatment of passkey profiles (`session-manager.ts:231-235`):
```ts
if (profile.type === "passkey") {
  // Passkey sessions can't be silently restored — the browser
  // requires a user gesture for WebAuthn `get`. Leave persisted
  // record in place; the popup's lock screen will handle it.
  return
}
```

Today the asymmetry is documented + accepted: passkey profiles always re-PRF on SW restart; password profiles silently restore via the persisted passhash (until M4.2).

`SECURITY.md` "Session secret (passkey profiles)" section already documents this:
> "Passkey profiles **do not persist any session material**. When the service worker restarts, the user must re-perform WebAuthn PRF to re-derive the master secret. This is asymmetric with the password flow above and is intentional…"

After M4.2 ships Design B (re-auth on SW restart for password profiles too), the asymmetry inverts: now **both** profile types re-auth on SW restart. M4.8 then becomes a UX symmetry pass + a pending-request decision.

## Two viable designs (each must address pending-request question)

### Design X — Re-prompt on popup open only

**Idea**: Don't persist anything. SW restart kills any in-flight passkey window; popup re-opens; user re-clicks; new PRF flow runs.

**Pros**:
- Zero new persisted state.
- Symmetric with M4.2 Design B.
- Simplest to ship.

**Cons**:
- Mid-PRF SW restart (rare but possible) loses the user's gesture; they re-click. Annoying but not broken.
- dApp connection requests in flight can timeout if the SW restarts during the prompt; the dApp sees a generic timeout error, retries.

### Design Y — Persistent pending-request envelope

**Idea**: When a passkey window opens, persist `{requestId, request, handleId, openedAt}` to `chrome.storage.session.nulo:passkey:pending`. SW restart reads it on init; if the window is still open (`chrome.windows.get(windowId)` succeeds), re-attach the resolver. If gone, settle as "user cancelled."

**Pros**:
- Strict UX symmetry: in-flight passkey requests survive SW restart.
- Aligns with M1.2 deferred work (persist approval/passkey envelopes).

**Cons**:
- Persisted state in `chrome.storage.session` — same threat-model space M4.2 is trying to clear. The envelope contains no master secret, but it does contain dApp request metadata.
- Additional storage migration needed (M4.7 territory).
- More complex; more surface to test.

## Which design ships?

**Recommendation, pending product decision**: **Design X**. Audit consensus + matches M4.2 Design B's "re-auth on SW restart" pattern. Persisting in-flight passkey envelopes adds a state machine without strong UX wins (the failure mode is a re-click, not a lost transaction).

If product requires Design Y (UX symmetry mandate), M4.8 absorbs the additional persistence surface and M4.7 owns its migrator.

## Prework (safe to do now)

1. **Inventory passkey lifecycle hooks** — `packages/extension/src/wallet/services/passkey/service.ts:24-90`. Identify every `pending.set` / `pending.delete` site. There are 4: `openWindowAndWait` (set), `resolvePasskeyRequest` (delete), `rejectPasskeyRequest` (delete), `finally` block of `handle.promise` (delete on settle).
2. **Sketch `PasskeyPendingStore` interface** — type-only. Both designs implement different versions:
   ```ts
   // packages/extension/src/wallet/services/passkey/pending-store.ts
   export interface PasskeyPendingStore {
     set(id: string, entry: PendingPasskey): Promise<void>
     get(id: string): Promise<PendingPasskey | undefined>
     delete(id: string): Promise<void>
     all(): Promise<Map<string, PendingPasskey>>
   }
   export class InMemoryPasskeyPendingStore implements PasskeyPendingStore { /* current behavior */ }
   ```
   Wire `PasskeyService` to use the interface; default = in-memory. Design Y adds a persistent variant later.
3. **Annotate the asymmetry in `SECURITY.md`** — clarify that M4.8 will resolve the symmetry once M4.2's design lands. Today's "intentional asymmetry" footnote becomes "legacy of M4.2-pending; M4.8 removes once M4.2 lands."
4. **Pre-write the M2.6 vector for re-PRF** — passkey profiles already have a vector pinning credentialId × HKDF label → master secret. Verify it covers the re-derive path; extend if not.

## What execution looks like

### If Design X is approved (recommended)

**Step 1 — Confirm parity with M4.2's Design B**:
- SessionManager.restore for passkey profiles: unchanged (already short-circuits).
- ProfileService.restorePasskeySession: verify it triggers on next popup interaction.
- Lock screen for passkey profiles: existing flow already prompts for passkey unlock.

**Step 2 — Pending-request graceful failure**:
- On SW restart: `pending` map is empty. No-op.
- Any popup window opened by the previous SW (handleId-mismatch on re-attach attempt): WindowManager already cleans up via `chrome.windows.onRemoved`. Verify the cleanup races cleanly; add a test.

**Step 3 — UX polish**:
- If a passkey window is open and the SW restarts mid-prompt, the popup currently sees a generic timeout. Surface a more specific "Wallet was reloading; please try again" message. (Hairline polish, optional.)

**Step 4 — Tests** (in `passkey/service.test.ts`):
1. **Pending map empty post-SW-restart**: simulate SW restart by constructing a fresh `PasskeyService` instance with `FakeBrowserApi`. Assert `pending` is empty.
2. **Re-unlock via passkey works**: simulate the lock-then-unlock loop; assert the new session opens with the same master secret (via M2.6 vector).
3. **Stale window cleanup**: open a fake window, drop the handle, simulate `windows.onRemoved`. Assert no leaked entries.

### If Design Y is approved (pending-request persistence)

Replace InMemoryPasskeyPendingStore with PersistedPasskeyPendingStore wrapping `EntityStorage<PendingPasskey>("nulo:passkey:pending", browserApi.storage.session)`. M4.7 migration registry adds an entry for the new collection. Recovery logic on SW init:

```ts
public async init(): Promise<void> {
  const pending = await this.store.all()
  for (const [id, entry] of pending) {
    const window = await chrome.windows.get(parseInt(entry.handleId)).catch(() => null)
    if (window) {
      // Re-attach: re-issue the WindowManager handle pointing at this windowId.
      this.windowManager.reattach(entry.handleId)
    } else {
      // Window gone; settle as cancelled.
      this.windowManager.cancel(entry.handleId, "Service worker restarted")
      await this.store.delete(id)
    }
  }
}
```

(Both `WindowManager.reattach` and the persisted store's `EntityStorage` come along for the ride. Reasonably scoped; ~1 day of additional work over Design X.)

## Verification commands (post-execution)

```bash
bun run --filter '@nulo/extension' test    # passkey/service tests
bun run typecheck:all
bun run test:all                           # M2.6 vectors include passkey re-derive
bun run check:imports
bun run build
```

Manual QA: register a passkey profile; unlock; suspend SW; open popup; verify lock screen; re-PRF; wallet unlocks. Repeat with mid-prompt SW restart (force via chrome internals if possible).

## Risks tracked

1. **Design X UX cost**: re-click is annoying but acceptable. Beta feedback decides.
2. **Design Y storage surface**: `nulo:passkey:pending` adds another collection M4.7 must migrate. Schedule.
3. **`chrome.windows.get` reliability across SW restart**: verify the windowId from a previous SW is still resolvable. If not, Design Y degrades to Design X anyway.
4. **`WindowManager.reattach` doesn't exist** today. Design Y owns adding it; small surface.

## Audit prep

When this memo goes to codex + Plan agent for audit:
- Both audits flagged the pending-request question. This memo addresses it head-on.
- The audit now focuses on: (1) is Design X / Y the right pick? (2) is the prework correct? (3) does the recovery logic in Design Y handle all the windowId edge cases?
