# dapp-profile-binding — batch 3 of audit-448-remediation

Fixes **N-04 (Major)** — a live encrypted dApp channel established under profile A silently serves profile B after a switch (identity-binding gap; also hard cross-profile linkability over one continuous channel) — **N-26** — the `pendingVerification` marker leaks on tab-close mid-ECDH, forcing spurious emoji re-verification — and **N-19** — `toJsonSafe` corrupts shared (non-cyclic) references into `"[Circular]"` in dApp responses. Spec: `implementations-plan/audit-448-remediation/runbook.md`; verdicts: `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; recon: [recon.md](./recon.md). Base: dev `6fe41b46`. Tier: **mid** (rubric: security-sensitivity HIGH — profile isolation is the product promise; 1 high → mid).

**Success criterion:** after a profile switch, no live channel established under the previous profile can serve the new one — the dApp observes a clean disconnect (the same signal as explicit disconnect), and even a racing in-flight message cannot cross identities; a mid-ECDH tab close no longer poisons future reconnects into re-verification; shared references serialize in full while true cycles still terminate; `bun run audit:vue` + `bun run test:e2e` + `bun run e2e:agent` (solo) green; PR squash-merged.

**Scope:** N-04 + N-26 + N-19 per the runbook. OUT: lock semantics (today's per-call "Wallet is locked" errors with surviving channels stay AS-IS — a deliberate, pinned behavior; N-04 is about switch, not lock), upstream `@aztec/wallet-sdk` changes, dispatcher/capability model changes beyond the stamp check.

**eli5_mode:** Artifact (publish at close-out; session artifact hosting is flaky this run — sources committed either way).

---

## Architecture & Implementation

### N-04 — chosen: HYBRID (kill-on-switch + stamp-validate-at-dispatch), as a new extracted listener + side-map

Recon shows the two audit-suggested options are individually incomplete: kill-on-switch (A) leaves the in-flight dispatch race (the capability lookup re-reads the LIVE active profile mid-message) and its teardown runs async after the switch; stamp-only (B) leaves the dApp UI believing it's connected while every call errors (the transport never learns). The hybrid takes A's clean UX (the already-tested `SESSION_DISCONNECTED` → `handleDisconnect` chain) AND B's structural closure (per-dispatch validation against the establishing profile). Both audit fix-directions are thereby implemented, not arbitrated away — the fork put to the audits is hybrid vs either-alone.

1. **Approver-bound marker, keyed by the transport REQUEST identity** (final-pass r3: tuple keying let a B-reconnect consume A's marker and leave the original A-approved handshake markerless → B-stamped; two interactive approvals could likewise overwrite each other): `pendingVerification` becomes `Map<requestId, { at: number; profileId: string; tabId: number }>` — the upstream stores discoveries by requestId, and the establishment path carries the request/session continuity (exact upstream field verified at impl; the terminate path's discovery re-insert keyed by sessionId shows the linkage exists). Approval (`discovery-approval.ts:56`) stamps WHEN, WHO, WHERE under ITS OWN request's key — concurrent same-tuple approvals no longer interact, and a reconnect consumes only its own marker. Both r3 interleavings (B-reconnect-then-A-establishes; two interactive approvals) are pinned. Establishment semantics (final-pass B1 — expiry is NOT a soft path):
   - marker present + fresh + `row.profileId === marker.profileId` → stamp and proceed (verify per `isNewConnection` as today);
   - marker present + fresh + profile MISMATCH → terminate (approve-under-A/validate-under-B fail-closes);
   - marker present + **STALE → terminate + delete** — a stale approval is a DEAD approval, never a downgrade into unmarked-reconnect semantics (the R2 draft's "stale ⇒ treat as returning" would have let an attacker park an approved handshake past the TTL, switch to B, and mint a B-stamped channel from an A-era approval);
   - no marker (genuine trusted reconnect — no outstanding approval) → stamp from the validated row (self-consistent: row, hash, grants are one profile's; `!trustedVerification` still floors first-time verification).
   (The r2 same-tuple "documented residual" is GONE — request-keying removes the interaction entirely rather than documenting it.)
2. **Side-map** `sessionProfiles: Map<sessionId, profileId>` in `background.ts`'s closure (upstream `ActiveSession` is closed — recon), stamped per (1), threaded via a WIDENED `SessionEstablishedDeps` return (fable c4), cleaned in `onSessionTerminated` (`:243-247`) beside the existing maps.
3. **Dispatch guard** at the ctx build (`:681-688`): after `requireActiveProfile`, stamp ≠ active profile (map-miss INCLUDED — fail closed) → **send the error envelope FIRST, then terminate** (fable c2: terminating first breaks `sendResponse` on the deleted session; the DISCONNECT chain still covers the dApp either way).
4. **Anchored dispatcher lookup** (both audits' central demand — closes the intra-dispatch TOCTOU): `tryGetDappSessionByOriginAndChain` gains an explicit `forProfileId` parameter; the dispatcher passes `ctx.profileId`, and the service filters on IT instead of re-reading the live profile (`dapp-session/service.ts:116`). The two DISCOVERY callers and the ESTABLISHMENT path retain live-read semantics deliberately (final pass) — only the dispatch path anchors. **Corrected semantic** (final pass, `mac-storage.ts:85`): after a switch, MAC verification of A's rows requires A active, so an anchored A-lookup under B returns ABSENT — the in-flight message is **A-consistent or fails closed**; it can never observe B, and usually cannot complete at all. Residual stated plainly: termination doesn't cancel a running callback; NEW messages cannot start.
4b. **The pre-dispatch crossing** (final-pass B3 — a hole every earlier round missed): `sendTx`'s queued-journal creation runs BEFORE `handleWalletMessage`'s guard and independently live-reads profile/session/accounts (`queued-journal.ts:102`) — an A-era message could persist a B-profile operation after termination. Fix: the stamp guard runs BEFORE queued-journal creation on that path, and **every profile-scoped dependency in the journal path anchors** to the stamped profileId — sessions, accounts, AND network resolution (`resolveNetworkByChainId` → `NetworkService.getNetworks()` live-reads too, final-pass r3) — with a belt **stamp-vs-active revalidation immediately before the journal persist** (covers any dependency the enumeration misses). Unit tests: switch-during-journal-creation AND switch-gated-at-network-resolution.
5. **Switch listener** — new extracted `profile-switch-teardown.ts` (tab-lifecycle shape): on a truthy new profile, terminate every active session whose stamp ≠ new profile id **and every unstamped session** (resolves the R1-flagged listener/dispatch contradiction; both audits favor — an unstamped zombie costs nothing to kill). On `undefined` (lock): NO teardown — pinned lock semantics stay; in-flight-call cancellation is explicitly NOT claimed (codex). A key exchange completing AFTER the listener ran is covered by (1): its establishment validates under the live profile with the approver-bound marker — mismatch fail-closes, match is self-consistently the new profile's session.
6. Wired in `initWalletSdkHandler` beside the `onDappSessionDeleted` block.

### N-26 — marker carries `{at, profileId, tabId}`; teardown-deletes + TTL backstop

The Map from §N-04(1) carries the timestamp. Leak closure is TWO-layer (codex R1: a bare 90 s TTL still poisons an immediate reconnect for the full window):
- **Teardown deletion (primary)**: the marker's stored `tabId` (§N-04(1)) is the deletion key — `tabs.onRemoved` supplies ONLY a tabId, and pre-establishment there is no `ActiveSession` to map through (final-pass B2: origin-based deletion was unimplementable as specced). Tab close / cross-origin nav delete every marker whose `tabId` matches. An immediate reconnect reads a clean set — no 90 s poisoning. The wired lifecycle (approve → tab close → reconnect) is unit-tested against the real tab-lifecycle deps shape.
- **TTL backstop (secondary)**: `PENDING_VERIFICATION_STALE_MS = 90_000` + `isPendingVerificationStale(at, now = Date.now())` mirroring `isDiscoveryExpired` (stamp-on-write / check-on-read / lazy-delete; no alarms) — covers leak paths tab-lifecycle can't see (SW-side failures with the tab still open).
- The verification-security floor is unchanged either way: `!trustedVerification` (`session-established.ts:77`) independently forces first-time verification. Marker-state consequences are asymmetric BY DESIGN (r3-consistent): a TEARDOWN-DELETED marker (its handshake is dead with its tab) lets a genuinely fresh reconnect proceed as a new connection with its own approval; a STALE-but-present marker at establishment TERMINATES (a parked approved handshake must die, never soften — §N-04(1)). Neither path can skip a first verification.
Signature ripple: 4 sites + 2 test fixtures (recon list) move in lockstep with the §N-04(1) type change.

### N-19 — extract + ancestor-chain fix

`toJsonSafe` moves to `wallet-sdk/to-json-safe.ts` (exported; the directory's extraction convention) with the fix: `seen` becomes the ANCESTOR set — `add` before recursing into a composite's children, `delete` in a `try/finally` after (codex R1: a throwing child must not leave its ancestor marked) — so shared siblings serialize in full and only true ancestor cycles hit `"[Circular]"`. `background.ts` imports it; the dangling `:789-796` JSDoc debris in the touch region is removed. Colocated `to-json-safe.test.ts` adopts BOTH c6-2 assertions (shared-ref-in-full via a real `Fr.ZERO`-style shared object + true-cycle-terminates) plus Map/Set/toJSON/bigint coverage of the existing branches. The audit/ proof copy stays untouched (its provenance note says re-sync on change — but audit/ is contract-frozen; the PR body flags that the proof's copy is now historical, superseded by the colocated real-import test).

### Data & control flow (critical paths after fix)

Switch: profile B activates → listener terminates all sessions stamped ≠ B → dApp gets DISCONNECT (in-flight calls reject; UI flips). Racing message on a not-yet-terminated A-channel: dispatch guard compares stamp(A) vs active(B) → mismatch → terminate + error envelope — no capability lookup, no account read, nothing crosses. Reconnect under B: discovery → approval under B's rows → fresh stamp B.

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/wallet-sdk/background.ts` | side-map + dispatch guard + wire the switch listener; `toJsonSafe` moved out; dead JSDoc removed |
| `apps/extension/src/wallet/services/wallet-sdk/session-established.ts` (+`.test.ts`) | stamp from the validated row; deps field; marker Map/TTL read |
| `apps/extension/src/wallet/services/wallet-sdk/discovery-approval.ts` (+`.test.ts`) | marker write stamps now |
| `apps/extension/src/wallet/services/wallet-sdk/profile-switch-teardown.ts` (+`.test.ts`) | NEW extracted listener (tab-lifecycle shape) |
| `apps/extension/src/wallet/services/wallet-sdk/to-json-safe.ts` (+`.test.ts`) | NEW extracted + fixed serializer, c6-2 assertions adopted |
| `apps/extension/tests/e2e/network/session-profileSwitch.test.ts` | NEW network spec: connect under A → switch to B → dApp observes disconnect + a queued call rejects; reconnect under B works |

### Algorithms / non-obvious mechanics

- Ancestor-chain serialization: `seen.add(value)` → recurse children → `seen.delete(value)`; the toJSON branch recurses the RESULT under the same ancestor frame (a toJSON returning its own ancestor still terminates).
- The dispatch guard runs AFTER `requireActiveProfile` (locked stays locked-error) and BEFORE any service/capability read.
- Stamp source = the validated row's profileId at establishment (the identity that APPROVED), never a live read.

### Trade-offs & alternatives not taken

- **A-only / B-only**: rejected as incomplete (race / lying UX — recon §N-04). The audits are asked to challenge the hybrid's necessity.
- Tuple-based teardown matching (the audit's literal "tuple-matching" phrasing): rejected — same-tuple rows can exist under both profiles; stamp-based matching is what the linkability concern actually requires.
- Teardown on LOCK: rejected — deliberate, pinned per-call-error semantics today; changing it is scope creep with its own UX debate.
- Composition-test for the switch scenario: rejected for the directory's extracted-unit convention (recon §tests); the network e2e carries the end-to-end proof.
- chrome.alarms TTL for the marker: rejected — wrong layer convention.

## Security & Adversarial Considerations

- **Threat model**: the dApp is the semi-trusted counterparty — it must never observe profile B's data over an A-era channel (reads already require B's own grant; the LINKABILITY of A and B co-residing is itself the leak the stamp kills). The dispatch guard fails closed on unknown sessions. The side-map lives in SW memory — an SW restart drops both the map AND the upstream `activeSessions` (same lifetime), so no stale-stamp window exists across restarts.
- **Marker TTL** semantics are the deliberate asymmetry of §N-26: a stale-but-PRESENT marker at establishment TERMINATES (a parked approved handshake dies — never softens into reconnect semantics); a teardown-DELETED marker lets a genuinely fresh reconnect proceed as a new connection under its own approval. `!trustedVerification` independently floors first-time verification on every path. 90 s ≥ the 55 s discovery staleness so a slow-but-legitimate ECDH never reads stale.
- **Serializer**: ancestor-tracking preserves the cycle guard (no stack overflow / infinite loop on hostile cyclic results); output shape for existing consumers unchanged for trees.
- No new deps, no crypto changes, no token/workflow changes.

## Assumptions

**Facts (verified; recon.md cites):** ActiveSession is upstream-typed with no profileId; teardown inventory + the `:365-389` template; `onActiveProfileChanged` drains discoveries only; dispatch double-reads the live profile; termination propagates the tested DISCONNECT chain; lock = per-call errors (pinned); marker type/sites (4+2); `toJsonSafe` private, single call site; layer TTL convention; no second-profile network spec exists.
**Inferences (post-audit state):** (1) ~~validated row = approving row~~ REFUTED by both audits (validation reads the LIVE profile, `service.ts:116`; approve-A→switch→validate-B returned B's row) — replaced by the approver-bound marker design. (2) `getActiveSessions()` suffices for the listener's SNAPSHOT only — late key exchanges are covered by the marker at establishment, not the listener (codex). (3) Map-miss handling unified: fail-closed at dispatch AND terminated by the listener (the R1 contradiction resolved). (4) ~~two-profile fixtures exist~~ REFUTED (fable): the in-session switcher has never been e2e-driven — Phase 3 budgets the fixture work; the real e2e is REQUIRED (undrivable ⇒ park, per the final pass — no fallback). (5) `SessionEstablishedDeps`' narrowed return type widens to carry `profileId` (fable c4). (6) Profile-change listeners fire synchronously (codex fact) — the guard adjacent to `requireActiveProfile` has no interleaving gap; in-flight messages are A-consistent or FAIL CLOSED (§N-04(4) — MAC verification requires the owning profile active), and the journal path revalidates the stamp pre-persist (§N-04(4b)).
**Asks:** none remaining — the three R1-flagged adjudications (dispatch anchoring, approval-profile binding, map-miss policy) are resolved in-plan.

## Phases

### Phase 1 ✓ — N-19 + N-26 (pure, low-risk slices first)
_Gate passed: to-json-safe extracted with 9 pins (both c6-2 assertions + ancestor/finally/toJSON-cycle cases); pending-verification module + tab-teardown deletion pins; marker Map migration across all 6 sites._
Extract + fix `to-json-safe.ts` with the adopted c6-2 assertions + branch coverage; marker Map/TTL conversion across the 6 sites.
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test src/wallet/services/wallet-sdk/`. Pass: exit 0, new + existing wallet-sdk suites green. Layers: lint/typecheck + unit.

### Phase 2 ✓ — N-04 (marker binding, stamp, anchored lookup, guard, listener)
_Gate passed: lint 0, vue-tsc clean, 135/135 across wallet-sdk (12 suites incl. the new profile-switch-teardown matrix + guard, establishment profile-binding describe with the r3 interleavings, queued-journal stamp/belt/anchor pins) + dapp-session. The guard was extracted as `enforceSessionProfileBinding` for convention-fit testability._
Approver-bound marker + side-map + establishment stamping + the `forProfileId` dispatcher-lookup anchor (dapp-session service + wallet-bridge dispatcher — in-scope adjacent, both audits demanded it) + dispatch guard (respond-then-terminate) + `profile-switch-teardown.ts`. Controlled unit tests (codex R1's list): the listener matrix (stamped-B survives / stamped-A terminated / UNSTAMPED terminated / lock touches nothing); guard: mismatch or map-miss → envelope sent then session terminated, capability lookup never reached; **switch-after-guard** (anchored A-lookup under live B is **A-consistent or ABSENT** — MAC verification requires A active, `mac-storage.ts:85` — either way nothing of B is observable: the corrected r3 semantics, pinned via the service's new param); **switch-during-key-exchange** (marker approver A + validated row B → fail-closed terminate; marker A + row A → stamped A); **STALE marker at establishment → terminate + delete**; **the two r3 marker interleavings** (B-reconnect establishing first consumes ONLY its own request-keyed marker — A's marker survives and A's establishment still fail-closes on mismatch; two interactive approvals don't overwrite each other); establishment after the listener ran lands correctly per its marker; **switch-during-journal-creation** and **switch-gated-at-network-resolution** (§4b); **immediate post-tab-close reconnect** (tabId-keyed deletion; reconnect NOT treated as new).
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test src/wallet/services/wallet-sdk/ src/wallet/services/dapp-session/`. Pass: exit 0. Layers: lint/typecheck + unit.

### Phase 3 — end-to-end proof + full battery (fixture-pioneering budgeted)
Fable c3 finding: the in-session profile switcher has NEVER been driven in e2e (existing two-profile specs use a second browser). Phase 3 BUDGETS the fixture work — and the final pass notes existing profile-selection/create testids make the real A→B UI switch plausible, so **the real disconnect/reconnect e2e is REQUIRED, no unit-level fallback** (final pass: a fallback is insufficient rigor for a Major finding's approval gate; if the switcher genuinely cannot be driven after honest effort, that is a PARK-the-batch blocker surfaced per the runbook, not a silent downgrade). New `tests/e2e/network/session-profileSwitch.test.ts`: connect playground under A → in-session create/switch to B → playground flips disconnected (`pg-status` idiom); a post-switch call rejects (deterministic; the mid-flight races are pinned at unit level per Phase 2); reconnect under B succeeds (fresh session, B's rows). Then: `bun run audit:vue` + armed `bun run test:e2e` + `bun run e2e:agent` (SOLO; re-run once before triaging).
**Validation gate** — commands: `bun run audit:vue && bun run test:e2e && bun run e2e:agent`. Pass: all exit 0. Layers: everything incl. live-network e2e.

## Post-implementation (self-contained — run in order)

1. `/code-review max --fix` (autonomous form: independent max-effort Anthropic-family review agent; fixes committed SEPARATELY).
2. Codex post-impl audit (`/codex xhigh`, fresh): net diff from `6fe41b46`, code-review commit summary, this plan + ledger, adversarial ask, and verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. Fix loop: verify claims → apply → commit → log in `lessons/` → RESUME with the fix diff → repeat to convergence (3+ churning rounds → park per runbook).
4. Delivery: PR to dev; green required checks + codex final-diff sign-off → `gh pr merge --squash --delete-branch` (never `--admin`; Cloudflare Pages rows are non-required and red on bun 1.4 — disregard per owner).

## Delivery

**Single arc, one PR**: `fix(dapp): profile-bound sessions + verification marker ttl + dag-safe responses` (78 chars).

## Decision ledger

| Decision | Source | Disposition |
|---|---|---|
| HYBRID (kill-on-switch + stamp-validate) over A-only/B-only | recon race + lying-UX analysis | **chosen** — audits to ratify |
| Stamp = validated row's profileId at establishment (not a live read) | recon | **chosen** |
| Stamp-based (not tuple-based) teardown matching | recon same-tuple nuance | **chosen** |
| Map-miss ⇒ fail-closed terminate at dispatch | plan | **chosen** — audits to challenge |
| Lock keeps today's per-call-error semantics (no teardown) | pinned behavior | **chosen** |
| Marker TTL 90 s, lazy check-on-read (no alarms) | layer convention | **chosen** |
| toJsonSafe extracted to its own file (not exported-from-background) | directory convention | **chosen** |
| Anchored dispatcher lookup (`forProfileId` param; live re-read leaves the dispatch path) — ~~completes under captured identity~~ corrected r3: A-consistent or fails closed | fable HIGH + codex blocker 1 (converged) | **adopted, semantics superseded by the r3 row** |
| ~~Approver-bound marker `Map<tupleKey, {at, profileId}>`~~ | codex blocker 2 | **superseded** — r3 re-keyed by requestId + tabId in the value (see the r3 rows) |
| Respond-then-terminate guard ordering | fable c2 | **adopted** |
| Listener also terminates unstamped sessions (contradiction resolved) | codex + fable minor (converged) | **adopted** |
| Marker teardown-deletion at tab-lifecycle points + TTL as backstop (immediate reconnects unpoisoned) | codex blocker 3 | **adopted** |
| try/finally ancestor cleanup in toJsonSafe | codex | **adopted** |
| ~~Phase 3 fixture budget + documented fallback~~ | fable c3 | **superseded** — the final pass removed the fallback: real e2e required, undrivable ⇒ park |
| Deterministic e2e (drop the timing-raced queued-call assertion; race pinned at unit level) | codex | **adopted** |

| Stale marker at establishment ⇒ TERMINATE + delete (never unmarked-reconnect semantics — the R2 draft's soft-expiry was an attack path: park an approved handshake past the TTL, switch, mint a B-stamped channel) | final pass B1 | **adopted** — supersedes the R2 "stale ⇒ returning" row |
| Marker value carries `tabId`; teardown deletes by tabId (origin-based deletion unimplementable pre-establishment) | final pass B2 | **adopted** |
| Stamp guard BEFORE queued-journal creation + that path's lookups anchored (the pre-dispatch crossing) | final pass B3 | **adopted** |
| In-flight semantic corrected: "A-consistent or fails closed" (MAC verification requires A active — `mac-storage.ts:85`); discovery + establishment retain live-read deliberately | final pass | **adopted** |
| Real profile-switch e2e REQUIRED; unit-level fallback removed (insufficient for a Major's gate; undrivable ⇒ park, not downgrade) | final pass | **adopted** |

Unresolved disputes: none carried.

## Audit verdicts

- Fable round 1: **conditional approve** (4 conditions) — all adopted (ledger).
- Codex round 1 (session `01a03591-f807-7da0-b4d6-82cbaafc1cd8`): **reject** — 3 blockers — all adopted in revision 2; "hybrid genuinely necessary" + "stamp-based teardown correct" ratify the base shape.
- Final fresh-context pass round 1 (session `01a03599-e519-7850-8c8d-3aacd77047de`): **reject** — marker identity/expiry (soft-expiry attack), N-26 teardown unimplementable as specced (tabId linkage), the queued-journal pre-dispatch crossing, the completes-as-A overclaim, e2e fallback insufficient. ALL adopted in revision 3 (rows above).
- Final pass round 2 (resumed, on revision 3): **reject** — 2 residual blockers (tuple-keyed marker's cross-request consumption; journal network resolution unanchored) + 3 textual staleness items. ALL adopted in revision 4: request-keyed marker (`Map<requestId, …>` — the same-tuple residual eliminated, not documented), every profile-scoped journal dependency anchored incl. network + a pre-persist stamp revalidation belt, Phase-2 test list + Security wording corrected.
- Final pass round 3 (on revision 4): **conditional approve** (editorial contradictions only — all corrected same-revision). Round 4 ratification: **approve**. **GATE PASSED** (approval delegated per the goal contract).

## Seeds

Not used by the active pipeline run. Standalone re-run:

```
/goal All 3 phases marked ✓ in implementations-plan/dapp-profile-binding/plan.md, each ✓ backed by its validation gate reported passing in the transcript; /code-review max --fix applied+committed; codex post-impl loop converged (quoted); PR to dev green; bun run audit:vue, test:e2e, and e2e:agent all exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/dapp-profile-binding forward per plan.md. Reality-check plan.md + lessons/ + git status; next pending phase step; validate with the phase's gate after each meaningful edit; ✓ only when the written gate passes; decisions via /codex xhigh; log consults in lessons/; after all phases ✓ run the plan's Post-implementation section verbatim.
```
