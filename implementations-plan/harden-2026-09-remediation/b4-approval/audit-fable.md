# harden-b4-approval — fable audit transcript

## Round 1 — 2026-09-14, Fable 5.1 (same-family `Plan` agent), independent of the outline author

Prompt: the same inputs as the codex leg, lenses (i)–(vi).

### Response (paths repo-relative)

## Audit — `b4-approval/plan.md` (fable leg, round 1)

Read in the prescribed order; every claim below is checked against the tree at `harden-b3-isolation`@4b963a97 + the draft. Repo-relative paths.

### Findings

**1. [blocking] The vocabulary map as typed cannot hold both `transfer` arities — it re-creates F-02(a).**
`plan.md:14` declares `TRANSFER_SIGNATURES: ReadonlyMap<name, { kind; params }>` — one entry per name. But `transferPrivate` has two variants under the same `defaultNames` (`descriptors.ts:356-358, 374`: impl 0 → `transfer2Abi` = `(to, amount)`, impl 1 → `transfer4Abi` = `(from, to, amount, authwit_nonce)`), and `transferPublicToPrivate` likewise (`:381-383, 398`). Built with `map.set(name, …)` per variant, the last write wins and the 2-arg `transfer` is `unverified` again — exactly the Codex probe in `verified.md` §F-02. Smallest change: key the map by name to a *list* of variants (`ReadonlyMap<string, readonly { kind; params }[]>`) and match `(name, args.length)` against the list; the pin test must assert `transfer` accepts BOTH `[to, amount]` and `[from, to, amount, authwit_nonce]` (the outline's Phase 3 test already says this; the plan's Phase 2 test says only "`transfer(to, amount)` → …", which stays green on a lossy map if the 4-arg variant is what got dropped).

**2. [blocking] "From: this account" is false for `default_entrypoint`.**
`plan.md:14` states the account contract "IS `msg_sender` for that variant — a fact". It is a fact only on the standard path, where `dapp-send-executor.ts:567-569` enforces `op.accountAddress === op.opts.from`. For NO_FROM the dispatcher omits `opts.from` (`dispatcher.ts:945, 951`) and `executeNoFromSendTx` wraps nothing in the account contract (`:709-711`), so the token's `msg_sender` is the entrypoint, not the user's account. The card would print the user's own address as the sender of a 2-arg `transfer` it does not send. Smallest change: render "From: this account" only when `op.executionMode !== "default_entrypoint"`; for NO_FROM render the unverified fallback for 2-arg shapes (or "From: transaction entrypoint — not this account"). Add that case to the `OperationCard` component tests.

**3. [should-fix] The throttle has no drain trigger.**
`plan.md:18` says "no alarms; time read lazily from an injected clock". With lazy refill and no timer, a queued reconnect is only re-examined on the *next* `admit` call — the 4th handshake of a 4-handshake burst is never served (no 5th arrives), the dApp times out at 60 s, and the "queued, never dropped" constraint is violated in the common case. Smallest change: `admit` schedules a `setTimeout` for the next refill instant when the queue is non-empty (SW lifetime is fine — an open content-script port keeps it alive; a killed SW loses the queue and the dApp re-broadcasts). The unit test must use fake timers and advance, not call `admit` again, to prove the drain.

**4. [should-fix] A `CapabilityPayload` is approvable under the "no `session`" rule.**
`spec.ts:88-91`: capability payloads carry `session` but no `params.operations`. With the plan's check (`plan.md:17`, "rejects a payload without `session`") a compromised popup can `approveInteraction(capabilityId, [])`; the claim deletes the record (`service.ts:175`), `payload.params.operations` is `undefined`, and the capabilities window's later `resolveInteraction` gets "Invalid id" — a request-kill. Smallest change: reject unless `Array.isArray(payload.params.operations)` (i.e. an `ExecutionPayload`), and perform BOTH that check and the delta-length check before `this.storage.delete(id)`, not inside `executeAndResolve`.

**5. [should-fix] The discovered-hash "bind" trusts the popup it is meant to bound.**
`plan.md:16`: on a rebuild the SW compares recomputed hashes against `delta.discoveredMessageHashes` — a popup-authored list. The popup receives the full list from the estimate, so a compromised popup passes the compare while rendering nothing. That is inside lens (i)'s accepted envelope ("the shown hash list"), but the plan's wording "bound to the execution that is approved" overstates it: the compare defends against chain/dApp drift between estimate and confirm, not against the popup. Two options, smallest first: (a) keep the field and state the boundary honestly in the envelope's doc comment; (b) drop the field and bind SW-side — stash `discoveredHashes` on the reuse entry (the plan already does) and have `tryConsume` return the rejected entry's hashes alongside `undefined` (it already holds `entry` at `operation-estimate-reuse.ts:120` before the ladder), so the rebuild at `dapp-send-executor.ts:700` compares against SW-held data. (b) is one return-shape change and removes a popup-privileged field; I would take it.

**6. [should-fix] Confirm is reachable with no estimate result; the fail-closed abort then lies.**
Confirm gates on fee selection, not on a successful estimate (`execute/index.vue:558-565`; a failed estimate only toasts, `:145-148`). With `undefined` → empty set (`plan.md:16`), any discovered authwit at confirm aborts with "Authorizations changed since preview" for a user who never saw a preview. Smallest change: distinct message when the delta carries no list ("Fee estimate did not complete — retry the estimate"), and pin it. (Gating Confirm on an estimate would also work but changes UX the e2e cells wait on.)

**7. [should-fix] `feeSettings` from the delta can overwrite an embedded fee path.**
`materialize.ts:91, 100` sets `{ kind: "embedded" }` when the dApp supplied the fee; the honest popup never re-emits fee settings for those (the card shows the badge, `OperationCard.vue:164-166`). A compromised popup sending `{ kind: "fj" }` for an embedded `aztec_sendTx` makes the user pay a fee the dApp was paying, on top of the dApp's fee calls. Within the lens's "feeSettings" allowance, but the smallest guard is one line: apply `delta.feeSettings` only when the materialized op's `feeSettings === undefined` (i.e. `requiresFeeSelection`). Pin it. (`default_entrypoint` is already guarded at `dapp-send-executor.ts:723-725`.)

**8. [should-fix] `rejectDiscovery` tells the page nothing — size the flood cell for a 60 s horizon.**
SDK `background_connection_handler.js:150-158`: reject flips status and deletes the map entry; no `DISCOVERY_*` message reaches the tab. The dApp learns only via its 60 s discovery timeout. `plan.md:35`'s flood cell ("6 tabs … after a bounded wait … no tab hangs") with capacity 3 + queue 4 leaves tabs 4–6 queued at 20/40/60 s (the last past the 55 s cutoff, `discovery-queue.ts:16`) and any rejected tab silent for 60 s. Smallest change: N = 4 (3 immediate + 1 queued, served at ~20 s), assert `≤ 2` verify targets and that the 4th tab connects within ~30 s; assert "rejected → disconnected" only in the unit harness. Also `waitForPopup`'s pre-existing snapshot (`popups.ts:35-40`) is fine here since every verify URL is unique — no spike needed.

**9. [should-fix] The vocabulary pin is tautological as written.**
`plan.md:14, 30`: "recognized names == the four descriptors' `defaultNames` union" — both sides derive from `TOKEN_FN_DESCRIPTORS`, so a descriptor edit changes both and nothing reds. A pin must hold an independent copy: hardcode the expected `{name → arities}` table in the test (9 names, `transfer`/`transfer_private_to_private`/`transfer_in_private` etc. with their arities) and assert the module equals it. The behavioural `parseTransferIntent` cases in Phase 2 are the ones that actually catch a lossy map; keep them.

**10. [nit] Raw-args fallback has no row cap.** `exec.calls[].args` is dApp-sized; render at most ~32 `execute-op-arg` rows and "+N more (JSON)". Bidi is covered by `safeWire`; NO_FROM/sendTx args arrive flat (`Fr[]` over JSON), nested structs only exist on wallet-internal `call` actions the popup never receives (see Ask F).

**11. [nit] `previewedInterface` for the RIGHT contract but wrong `impl`s persists a wrong token model.** The cross-check (`execution/service.ts:745-749`) is contract+chainId only; `FnImpl.impl` is persisted (`types.ts:29`). Accepted by the lens as "previewed interface"; record it in lessons as a residual rather than adding a cache.

**12. [nit] Verify-window queue is unbounded** (`plan.md:18` bounds open windows and the throttle queue, not the reservation queue). It grows at ≤ 1 entry / 20 s / origin under the throttle, so memory is fine; say so in the plan rather than leave it implicit.

**13. [nit] Comments the diff must touch.** `dapp-send-executor.ts:441-449` and `:537-545` describe `approveInteraction` "shipping popup-built operations through without further validation" — false after Phase 1; shorten to a drift-alarm sentence (the outline flagged it; the plan dropped it). `operation-estimate-reuse.ts:64` "plan architecture §2" and `discovery-probe.ts:4` "single-sim-estimates B1" are milestone tags CLAUDE.md bans — fix only if the lines are otherwise edited.

**14. [nit] Scope.** Three new modules (`token-transfer-vocabulary.ts`, `reconnect-throttle.ts`, `verify-window-reservation.ts`) are each the smallest home for pure state; no objection. `OperationApprovalDelta.discoveredMessageHashes` is the only speculative surface — resolved by finding 5(b).

### Tests that stay green with the fix deleted / red for the wrong reason
- The vocabulary equality pin (finding 9) — green under any descriptor drift.
- "feeSettings on a non-send kind is ignored" stays green under a spread merge unless the executor stub asserts `toEqual(materialized)` exactly; write it as strict equality (the "accountAddress/exec/opts" pin likewise).
- `session-established.test.ts:85-91` (B-13 failed-open) reds for the wrong reason when `chrome.windows.create` moves behind `WindowPort` — the plan already re-expresses it; also keep `:59-68` (B-06) on the injected port's `create` mock.
- `background.discovery-race.pins.test.ts` harness (`:19-40`) has no `windows`/timers — the 12-handshake test needs fake timers for finding 3.
- Flood e2e as drafted can red on the 60 s SDK timeout (finding 8), not on the cap.

### Asks
**A.** Delete `KNOWN_MINT_METHODS`. No descriptor exists (`types.ts:9-18`); the fallback still shows `0: <to>, 1: <amount>`; `METHOD_LABELS` mint labels stay for the journal.
**B.** `abiBuilder` parameter names, one pin — sound for every variant (`descriptors.ts:242-261` are pure literals) PROVIDED the map is per-variant (finding 1) and the pin holds an independent table (finding 9).
**C.** Fail-closed compare, but against SW-held hashes (finding 5b), with a distinct no-estimate message (finding 6). Re-prompting is a new UX loop; not the smallest.
**D.** Parameters are defensible: capacity 3 / 20 s / queue 4 (with a real timer, finding 3), 2 per origin / 8 global, waiter 8. Counting the fresh-connect window is right (outline risk 8). Sequential cells never engage — per-test extension, ≤ 2 reconnects each (`session-reconnect.test.ts:41, 58/67`, `session-tabClose.test.ts:31, 48`, `session-tabNavigate.test.ts:32, 58`). B-13 is preserved because establishment returns `true` after reserve-or-enqueue; dispatch never waits on the queue. A remembered origin cannot open N windows another way: fresh (origin, chainId) pairs hit the 4/32 popup caps and then the same verify reservation; capabilities/execute popups are `WindowManager` one-per-interaction and need a live session request each. `rejectDiscovery` on a queued-then-expired request is silent on the SDK side (finding 8) — the dApp's own timeout closes it.
**E.** One `OperationApprovalDelta[]` replacing `operations`+`origin`+`estimateIds` — yes, with findings 4, 5, 7 folded in; `origin.name` from `payload.session.dappMetadata.name` matches what the popup already sends (`index.vue:121, 446`).
**F.** No. The only dApp producer of `send_transaction` is `grantPublicAuthwit` (`dispatcher.ts:1082-1088`), whose `add_public_authwit` row already renders spender/method/contract/args (`OperationActionRow.vue:20-32`); plain `call`/`encoded_call` actions never reach the approval popup from a dApp. Leave `OperationActionRow` alone.

### Verdict
**reject** — findings 1 and 2 are cheap to fix in the plan text but each would ship the display defect F-02 exists to close; re-audit after the plan absorbs 1–9.
