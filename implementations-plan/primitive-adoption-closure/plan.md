# Arc 5 — primitive-adoption-closure (F-Q05 · F-Q07 · helper sweep)

[light] tier of the 2026-08-16 remediation follow-ups ([spec](../remediation-followups/plan.md) §5). Quality arc: ZERO behavior change — every existing test is a characterization pin and must stay green UNMODIFIED. Validation: repo gates + `audit:vue` + **armed smoke** (arc-5 requirement). Single codex xhigh pass over the complete diff at the end.

## F-Q05 — AlarmDispatcher adoption (recon-verified against `dev@7d622803`)

`AlarmDispatcher` (`packages/wallet-core/src/utils/alarm-dispatcher.ts`) owns exactly the named create/clear/dispatch ritual; scheduling, boot-runs, and gating stay caller-owned (its doc says so; `gc.ts` is the proven adopter template). The three adoptions, each shaped by the prior arc's codex-converged follow-up notes (`implementations-plan/quality-quick-wins/plan.md:20-30`):

- **`operation-journal/reaper.ts` — full ritual adoption** (`listen` + `create` + `stop`), preserving verbatim: the B-03 `bootCutoff` capture as the FIRST synchronous statement, the subscribe→create→boot-sweep ordering, the boot sweep's distinct `{unconditional, bootCutoff}` args vs the periodic no-arg tick, and the byte-identical tick diagnostic. 17 existing pins green unmodified.
- **`profile/session-manager.ts` — `create({when})`/`clear` only.** The listener deliberately does NOT go through `dispatcher.listen()`: the staleness gate needs `alarm.scheduledTime`, which the dispatcher's tick contract doesn't surface, and the handler's fire-and-forget `void runExclusive(...)` semantics must stay byte-identical (routing through `listen`'s `onError` would convert an unhandled rejection into a logged one — a behavior change a quality arc may not make). Extending the helper's tick signature for one site was rejected (charter: no capability gain without ≥3 sites). 55 existing pins green unmodified.
- **`price/service.ts` — `create`/`clear` only (6 sites: 1 create via `ensureAlarm`, 5 clears).** `listen()` is never called: dispatch stays external — the module-scope shim in `wallet/index.ts:81-89` is the SINGLE dispatch path (MV3 delivers a wake-triggering alarm only to synchronously-registered listeners) and is untouched. 27 existing pins green unmodified.

## F-Q07 — restoreRows: three rejections + one missed adoption (recon-verified)

- **`network/service.ts` restore — REJECTED, correctly-deferred.** The `unknown[]` signature guards a REAL untrusted boundary (`useFullBackupImport.ts` passes the raw backup slice unvalidated). The helper's `TIn extends object` can't accept it without a cast (a signature change), and its unconditional `{...row}` catch-spread diverges for string rows (char-spread `{0:'a',...}` vs today's guarded `{}`) — an unpinned behavior a swap could silently change. Giving the helper an `unknown`-tolerant guarded-spread capability would serve exactly ONE site.
- **`config/service.ts` restore — REJECTED, correctly-deferred.** The allowlist miss is a SKIP-with-no-pushed-row — a third outcome the helper's two-outcome contract (success row | restoreError row) doesn't model, and the 6-in→1-out cardinality is directly pinned (`config/service.test.ts:52`). A "skip" capability would serve exactly ONE site.
- **`task/service.ts` — REJECTED.** Not a restore site at all (no backup/restore method): the `Map.has` loop is task-id collision avoidance inside the SYNC `createTask`. Adopting async `nextRandomId` forces `createTask` async with a caller-wide ripple — a signature ripple, not a one-liner.
- **`token-balance/service.ts:404` — ADOPTED (the site the spec's list missed).** Hand-rolled loop was byte-identical to the helper's contract (same catch-spread, same per-row cardinality); swapped to `restoreRows`; the P1 hostile-row pins (incl. the 1:1-cardinality assertion) green unmodified. 50 tests pass.

## Sweep (recon-rated ADOPT / BORDERLINE / STRETCH; only clean zero-delta swaps shipped)

**ADOPTED (3, all byte-identical to the helper bodies, all pinned by existing tests):**
- `token-balance/balance-repository.ts allocateId` → `nextNumericId(this.storage)` (the file's own header even quoted the expression it mirrors; pinned "allocateId returns max+1").
- `profile/repository.ts generateUniqueId` → `nextRandomId(this, PROFILE_ID_HEX_LENGTH)` (pinned: not-yet-in-storage + collision-skip tests).
- `operation-journal/service.ts` 16-hex id loop → `nextRandomId(this.storage, 16)` (the helper's optional length param covers it; the 128-bit defense-in-depth comment retained).

**REJECTED (documented; each would change observable behavior or serve one site):**
- `wallet/index.ts:81-89` price dispatch → `dispatcher.listen()`: sits on the documented MV3 module-scope synchronous-registration invariant; not among the audited sites; not worth the risk for a shape swap.
- Popup Enter-handlers (`NewEndpointPopup`, `EditProfilePopup`, `NewSenderPopup`): adopting `isPopupSubmitKey` would NARROW any-Enter to input-focused-Enter — an observable behavior change (arguably a bug fix; the two authwits popups even have tests dispatching Enter on `document` that would break). Per the charter, a behavior fix may not ride a zero-delta refactor — recorded as a follow-up recommendation for the owner (incl. the `EditEndpointPopup` vs `NewEndpointPopup` asymmetry).
- `auth-registry` max-id sites: `getValues().map(x=>x.id)` vs the helper's `getKeys()` — a REAL divergence (validation-failed rows count for `getKeys`), not a safe swap.
- `task/service.ts`, `passkey/service.ts`, `window-manager.ts` sync collision loops: async adoption forces signature/interleaving changes.
- `profile/service.ts:1567` prefer-id loop: carries a `deletionState.isReserved` OR-condition `preferOrReallocId` has no parameter for.
- `sessionQueues` (F-Q08), `ExecutionMutex`, single-flight maps, `_fresh8`, account index-max: different primitives, per the spec's standing REJECTED list and the sweep's semantics analysis.
- `SingleShotTtlCache` / `KeyedLock`: zero unadopted duplicates found — both fully adopted already.

## Codex audit (single, light tier) over complete arc diff — bounded (initial + max 2 resumes)

**Initial pass: `reject`** — three blocking findings that were all one claim: an extracted async helper adds a Promise-reaction (microtask) checkpoint versus directly awaiting the port, therefore "scheduling is not byte-identical". The pass explicitly endorsed every rejection decision (network/config/task, popups, auth-registry, session-listener; called `wallet/index.ts` conservative-but-valid) and confirmed nothing was smuggled.

**Resume 1 (pushback): findings WITHDRAWN → `approve — converged after pushback`.** The pushback argued: (1) the standard indicts the nine codex-converged prior adoptions (gc.ts, six restoreRows sites, estimate-reuse) that define these very remediation items — it cancels its own charter; (2) no observable contract depends on checkpoint counts around Chrome port promises (ordering guarantees in this codebase come from locks, fences, and explicit serialization; code depending on tick counts would already break across Chrome versions); (3) the repo's operational zero-delta bar — all characterization + concurrency pins green unmodified (4354 tests) — is met. Codex's withdrawal states it "found no concrete call site where the additional Promise reaction changes an outcome protected by an existing contract" and that the stricter standard "would contradict the accepted precedents that define these remediation items."
