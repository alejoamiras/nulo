VERDICT: **conditional approve (conditions: fix cold-incarnation admission, lock ordering, D16’s fail-open API, and the final-submit/e2e gaps below).**

## Contradictions

1. **D15 is contradicted by §10.** §5.6/D15 mandates `facade → activity-scope → source`, but §10 specifies `queuedCreationLock → operationJournal.transitionLock → activity source lock`. That reverses activity/source ordering and can deadlock against snapshots, retirement, or profile deletion. Make `transitionLock` the journal source lock, or acquire `queuedCreationLock → activity-scope → transitionLock`; never add a second source lock beneath it.

2. **Phase 2 depends on Phase 4 types and behavior.** §6’s `recordSubmittedTransaction({fence, scope})` validates `authorizedAccounts`, network, deletion epoch, and activity incarnation—the `ExecutionScopeFence` introduced in §9/Phase 4. Meanwhile §5.5 says tx execution captures its activity fence before proving. Phase 2 cannot be independently complete as written. Split Phase 2 into storage primitives followed by execution-producer wiring, or move that wiring before Phase 3. Phase 3 may precede abort semantics only after every tx producer emits complete causal envelopes.

3. **D16 is too broad and fail-open.** §16/§17 says every execution change is inert when `expectedProfileId===undefined`; one missed dApp call-site then silently bypasses the captured lane, repeated checks, and serialized submission hook. Use a discriminated API such as `{kind:"dapp", expectedProfileId:string}` versus `{kind:"wallet"}`; a dApp invocation without the profile must reject. Only drift-abort behavior may be inert for wallet sends—activity scope/revision stamping must apply to all sends.

## New bugs

1. **Cold slices can transiently render retired-incarnation data.** §5.2 explicitly allows an ordinary event to initialize a cold slice. After popup/SW restart or same-ID backup restore, a delayed old-incarnation event can render before the authoritative snapshot arrives, violating §1. Buffer events by `(scope,incarnation)` until a snapshot/reset establishes the current incarnation, then replay only matching revisions above its watermark. Add this exact trace to P7; the existing wording would otherwise make that property fail.

2. **The serialized boundary fences only profile drift, not scope retirement.** §9.4 holds the facade lock across `node.sendTx`, but account/network deletion can retire the activity incarnation under the activity lock. Hold `facade → activity-scope` through the final check and send, or prove every retirement also takes the facade lock. Additionally, SW death or deletion immediately after accepted submission can prevent `recordTransaction`/journal success; §9.4’s claim that reconciliation follows is therefore too strong. Persist a pre-send `submitting` marker with tx hash and define restart reconciliation; never translate post-acceptance persistence failure into `EXECUTION_SCOPE_CHANGED`.

3. **The store/envelope seam is not type- or runtime-safe.** `ActivityMutation<T>` does not bind `source` to its record type, while §5.2 references a `scope-reset` mutation absent from §4.2’s union. Define a source-indexed discriminated union and a separate reset control. Runtime codecs must also require envelope scope/ID/incarnation to equal the embedded new-record fields and snapshot-row revisions; TypeScript alone cannot stop a corrupt producer from wrapping a P2 row in a P1 envelope.

4. **The network e2e does not prove the strongest H5 boundary.** The pre-`acquireSlot` gate (§11) proves early drift detection, not the post-prove/pre-submit closure introduced by D10. Make the proof-gate case part of the dedicated network e2e, with an observable `sendTx` invocation counter—not balances or missing rows. Arm the `MutationObserver` before switching; arming it after P2 activation misses a one-frame leak during the switch.

## Assumptions

- **I1 is partly false:** mnemonic import mints a new ID, but backup restore deliberately reuses `profile.id` when available and mints only a fresh `pxeGeneration` (`profile/service.ts:1337-1348`). Same-scope reincarnation is therefore real, not conditional; wire and test it explicitly.
- **I3 is false as stated:** `refreshSession()` calls `getActive()`, which can close a TTL-expired session (`session-manager.ts:159-166,259-277`). It cannot switch to P2, but concurrent switching is not the only state change.
- **I2 needs characterization, not inference.** Current lock/close paths do not visibly cancel execution controllers, but pin that contract in Phase 0.
- **I4 covers only a live popup.** Popup teardown loses the 32-slice cache, and slice size itself is unbounded; measure memory and define the cold-paint UX.
- A1/A2/A3/A5/A6 are already baked into implementation phases, so they are approval preconditions rather than deferred asks. A4 and A7 restate binding decisions.

## What’s solid

- D4, D7, D8, D11, D13, and D14 are encoded correctly.
- Record-owned routing, per-source coverage, quarantine, and retained display filters compose well.
- Actual dispatcher-authorized `from`, journal `profileId`, account-key collision facts, NoteDAO ownership, and dropped dApp spinner scope are correctly preserved.