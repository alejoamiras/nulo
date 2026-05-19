# Network test triage — RECONCILED plan (post-audit)

This supersedes `plan.md` after both audits (`audit-codex.md` xhigh, `audit-opus.md` opus 4.7).

## What both audits agreed on

1. **The original plan's categorization arithmetic is correct** (18 = 11 + 3 + 2 + 1 + 1 split, all file paths verified).
2. **Cluster C's user-side "keep OLD is intentional" claim is wrong.** The wallet code at `EditContactPopup.vue:185-194,199-230,250-255` explicitly intends to migrate. Codex specifically searched for any current code/comment saying "keep old senders intentionally" and found none — the only contrary evidence is a superseded planning note at `pre-a11-ux-cleanup/plan-v1.md:152`.
3. **Cluster A's stated A1/A2 hypotheses are insufficient.** The actual hot path is `addToken → fetchTokenMetadata → 3 sequential simulate(...) calls` (`token/service.ts:122-123, 402-434`), not just `parseTokenInterface`.
4. **The plan's anti-scope discipline is right** (no retry-wrappers, no test-infra changes).

## What the audits forced me to revise

### Revision 1 — Cluster A's actual mechanism

Original plan's A1 ("`parseTokenInterface` >60s") and A2 ("`isComplete:false` short-circuit") are **both real but neither is the dominant hypothesis**.

**Codex's correction:** `importToken()` does NOT wait for parsing before click — parsing starts only inside `handleAddToken()` after submit (`helpers.ts:342-357`, `NewTokenPopup.vue:58-66`). The toast fires only after BOTH `parseTokenInterface()` AND `addToken()` complete (with `addToken` doing 3 metadata `simulate()` calls).

**Opus's correction (A3):** Both `parseTokenInterface` and `addToken` go through `withPxeRead`/`withPxeWrite` (`packages/aztec-runtime/src/pxe/service.ts:314-345`), which serializes ALL PXE access. Under cold-PXE conditions in the e2e fixture, the queue accumulates and ONE click can produce a multi-step PXE sequence that exceeds the 60s helper budget.

**Codex also flagged a missed RPC layer:** popup→SW client RPC has its OWN 60s timeout (`extension-messaging/background/client.ts:18,149-168`). If the SW is busy in PXE work past 60s, the popup-side RPC bails with `Client request timed out` *before* the toast can fire — looks like a wallet hang to the test.

**Reclassification:**

| Original | New |
|---|---|
| A1: `parseTokenInterface > 60s` | **A1**: `parseTokenInterface` slow on cold PXE — still possible |
| A2: `isComplete:false` short-circuit | **A2**: `isComplete:false` — but only plausible as **artifact-resolution bug** (codex), since the deployed token IS standard `TokenContract` |
| — | **A3**: PXE-guard serialization stall in `addToken` (3 simulates) — opus's strongest candidate |
| — | **A4**: 60s popup→SW RPC timeout fires before SW finishes (codex) |

A's category remains **(a) wallet bug** but the surface is broader than I originally claimed.

### Revision 2 — Cluster B is NOT a clean separate cluster

Codex was right: the 3 FJ tests still traverse `importToken()` at `extension.ts:538` after Phase 1. So when `setupPreFundedAccount` (Phase 1) succeeds, the FJ tests are simply more cascade victims of Cluster A. The LMDB error is a **sporadic orthogonal precondition** in the script-side fixture, not a deterministic class of failures.

**Reclassification:** Cluster B becomes "**LMDB sporadic + A-cascade-on-Phase-2**". Effectively merges into A for any deterministic count. LMDB stays **(d) sandbox-side**.

### Revision 3 — Cluster D is NOT a tight-timeout (b)

Codex strongly disagreed. Mechanism:

```
addContact():
  click submit
  wait for contact-row to appear  ← short, ~ms
  closeStuckPopup()                ← FORCE-CLOSES popup mid-RPC
  
NewContactPopup's submit handler:
  await contactService.addContact(...)        ← finishes before row appears
  if (registerAsSender) {
    await accountStateService.addSender(...)  ← STILL IN FLIGHT when popup closes
  }
  emit('onClose')
  
Popup unmount:
  watch(() => props.show, ...) → contactService.disconnect() + accountStateService.disconnect()
  ↑ This DISCONNECTS the in-flight addSender's RPC client.
  Background/client.ts:77-83 rejects pending requests on disconnect.
```

**So D is a wallet/helper interaction bug**, not a 10s budget issue. The test waits for the chip to appear (because addSender fires the `onSenderAdded` event when it eventually resolves), but if `closeStuckPopup` aborted `addSender` mid-flight, the chip never appears regardless of timeout.

**Reclassification:** D moves from **(b)** to **(a)** *and* **(b)** simultaneously — wallet has a real bug (rejecting in-flight RPCs on disconnect is wrong for fire-and-forget side effects), AND the test/helper has a bug (calling `closeStuckPopup` before the side effect is durable).

### Revision 4 — Cluster C's mechanism narrows

Both audits killed C2 (cached `getSenders`): no cache layer exists in `account-state/service.ts:52-62`. C3 (cross-test leak) is unlikely because the contacts-sender file uses distinct file-private addresses per test (lines 14-19 of the test file).

The dominant mechanism is now **C4 (codex + opus): `closeStuckPopup` aborts `applySenderDelta` mid-flight**. Same root as D. Test 2 of contacts-sender PASSES — opus pointed out this is signal: the OFF branch (no `addressChanged`) doesn't have a race with closeStuckPopup. The `addressChanged` branch DOES, because it issues TWO PXE writes (add-then-delete) and `closeStuckPopup` can fire between them.

**Reclassification:** C remains **(a)** (wallet code intends migrate; bug is real), but the mechanism is the same RPC-abort-on-disconnect issue as D. Fixing the disconnect-cancels-pending-requests behavior in `background/client.ts:77-83` likely fixes BOTH C and D.

### Revision 5 — Cluster E timeout I misquoted

Codex caught I said "15s waitForPgResult timeout" in the plan. The actual default is **30s** (`playground.ts:67`); STATUS.md misled me. The real timeout stack is 30s playground wait, 60s popup→SW RPC, 90s offscreen RPC. So "bump from 15s" is based on a bad read.

**Reclassification:** E remains **(b)/(a) split**, but the diagnostic is "is registerSender taking >30s end-to-end OR is the SW RPC timing out at 60s?".

## Reconciled categorization table

```
Cluster   Victims  Original  Reconciled                        Mechanism
─────────────────────────────────────────────────────────────────────────────────────────────
A         11/18    (a)       (a) wallet perf/RPC               PXE-guard serialization on
                                                                addToken's 3 simulates,
                                                                potentially also 60s popup-SW
                                                                RPC timeout
B (FJ)    3/18     (d)       (a)+(d) hybrid                    Mostly cascade of A on Phase 2
                                                                importToken; LMDB is sporadic
                                                                orthogonal precondition
C         2/18     (a)       (a) wallet RPC-cancellation bug   closeStuckPopup disconnects
                                                                accountStateService while
                                                                deleteSender is in-flight
D         1/18     (b)       (a)+(b) wallet+helper             Same disconnect-mid-RPC as C;
                                                                addContact's closeStuckPopup
                                                                kills addSender before chip
                                                                renders
E         1/18     (b)       (b)/(a)                           registerSender end-to-end
                                                                latency vs 30s playground
                                                                wait OR 60s popup→SW RPC
─────────────────────────────────────────────────────────────────────────────────────────────
```

**Of 18 failures, ~13 share TWO underlying root causes:**

- **R1: PXE-guard serialization** in the offscreen PXE service (affects A's 11, possibly D, possibly E)
- **R2: Service-client disconnect cancels pending RPCs** (affects C's 2, D's 1)

If both roots are addressed, 14 of 18 likely pass without test-side changes.

## Reconciled Phase 0 (combined opus + codex feedback)

Three runs, ~50 min:

| Run | Tests | Probes | Time |
|---|---|---|---|
| 1 | Single vitest invocation containing `transfers > "balance shows minted tokens"` (A) + `contacts-sender > "delete-confirm exposes unregister-sender toggle"` (D) + `data-registerSender > "silent path adds sender to PXE"` (E). | Probe inside `withPxeRead`/`withPxeWrite` (`aztec-runtime/src/pxe/service.ts:314-345`) logging queue-depth + per-call latency. Probe inside `extension-messaging/background/client.ts:149-168` logging RPC latency + abort reason. | ~25 min |
| 2 | `fee-methods > "transfer with public Fee Juice"` × 3 reruns with `rm -rf /tmp/nulo-aztec-*` between runs | LMDB determinism check. If 0/3 fail, B is a flake; if 3/3 fail, B is deterministic; otherwise it's spurious. | ~10 min |
| 3 | `contacts-sender > "edit contact address with sender ON migrates"` (test 3) | Console.log inside `applySenderDelta` for branch trace + `await accountStateService.getSenders(networkId)` pre + post + `onSenderDeleted` fire-or-not. ALSO instrument `closeStuckPopup` to log when it disconnects each service client. | ~15 min |

After Phase 0 we have one coherent dataset for R1 (PXE serialization) across A/D/E and one targeted dataset for R2 (RPC abort) on C/D.

## Open questions for the user (now narrower than before)

1. **Confirm Cluster C re-categorization.** Both audits independently agree the wallet code intends to migrate; codex specifically searched for any current "keep old is intentional" comment and found none. Your earlier instinct was based on the symptom; the audits show the wallet was meant to do what the test asserts. **OK to treat as a real bug?**

2. **Fix vs. test-skip on C and D.** Both clusters share R2 (disconnect-cancels-pending-RPCs). Two valid responses: (i) FIX the wallet — change `background/client.ts:77-83` to NOT reject pending requests on disconnect, and instead let them resolve, (ii) FIX the helper — `closeStuckPopup` should await pending RPCs before disconnecting. **Which is more correct?** I lean (ii) because (i) leaves SW with orphaned listeners after popup close, but (i) is what most "fire and forget" UI patterns expect. Audits split implicitly.

3. **PXE-guard serialization scope.** Cluster A's R1 is real product perf concern, not just an e2e thing. Investigating it is a multi-day rabbit hole (mostly @nulo/aztec-runtime). Two options: (a) sink time now to fix the perf, (b) bump the e2e timeouts AND file an internal task for the perf later. **Which?**

4. **Cluster B framing.** Codex says B isn't a separate deterministic cluster; opus says it is. The truth is "sometimes LMDB blows up sporadically; the rest of the time those tests are A-cascade victims". **Treat B as a noise gate (rerun on failure) or do a real investigation?**

5. **Phase 0 sequencing.** Run 1 needs the new `withPxeRead`/`withPxeWrite` instrumentation + the `client.ts` RPC instrumentation to be added BEFORE running. That's ~30 min of code (revertible). **Approve this?**

6. **Fix PR strategy.** Once Phase 0 is in: one big PR ("fix flakes") vs. one PR per root cause (R1 + R2 + LMDB) vs. one PR per cluster (A/B/C/D/E)?
