# dapp-profile-binding — batch 3 of audit-448-remediation

Fixes **N-04 (Major)** — a live encrypted dApp channel established under profile A silently serves profile B after a switch (identity-binding gap; also hard cross-profile linkability over one continuous channel) — **N-26** — the `pendingVerification` marker leaks on tab-close mid-ECDH, forcing spurious emoji re-verification — and **N-19** — `toJsonSafe` corrupts shared (non-cyclic) references into `"[Circular]"` in dApp responses. Spec: `implementations-plan/audit-448-remediation/runbook.md`; verdicts: `audit/bugs/2026-08-22-production-ready/adjudication-2026-08-24.md`; recon: [recon.md](./recon.md). Base: dev `6fe41b46`. Tier: **mid** (rubric: security-sensitivity HIGH — profile isolation is the product promise; 1 high → mid).

**Success criterion:** after a profile switch, no live channel established under the previous profile can serve the new one — the dApp observes a clean disconnect (the same signal as explicit disconnect), and even a racing in-flight message cannot cross identities; a mid-ECDH tab close no longer poisons future reconnects into re-verification; shared references serialize in full while true cycles still terminate; `bun run audit:vue` + `bun run test:e2e` + `bun run e2e:agent` (solo) green; PR squash-merged.

**Scope:** N-04 + N-26 + N-19 per the runbook. OUT: lock semantics (today's per-call "Wallet is locked" errors with surviving channels stay AS-IS — a deliberate, pinned behavior; N-04 is about switch, not lock), upstream `@aztec/wallet-sdk` changes, dispatcher/capability model changes beyond the stamp check.

**eli5_mode:** Artifact (publish at close-out; session artifact hosting is flaky this run — sources committed either way).

---

## Architecture & Implementation

### N-04 — chosen: HYBRID (kill-on-switch + stamp-validate-at-dispatch), as a new extracted listener + side-map

Recon shows the two audit-suggested options are individually incomplete: kill-on-switch (A) leaves the in-flight dispatch race (the capability lookup re-reads the LIVE active profile mid-message) and its teardown runs async after the switch; stamp-only (B) leaves the dApp UI believing it's connected while every call errors (the transport never learns). The hybrid takes A's clean UX (the already-tested `SESSION_DISCONNECTED` → `handleDisconnect` chain) AND B's structural closure (per-dispatch validation against the establishing profile). Both audit fix-directions are thereby implemented, not arbitrated away — the fork put to the audits is hybrid vs either-alone.

1. **Approver-bound marker** (unifies N-26's TTL and the stamp source — codex R1's "bind approval to the exact profile"): `pendingVerification` becomes `Map<string, { at: number; profileId: string }>` — the write at approval time (`discovery-approval.ts:56`) stamps WHEN and WHO approved. At establishment, when a marker is present (new connections), the validated row must satisfy `row.profileId === marker.profileId` — an approve-under-A → switch → validate-under-B race now FAIL-CLOSES (terminate) instead of stamping B onto an A-initiated channel. Trusted reconnects (no marker) stamp from the validated row (self-consistent by construction: the row, hash, and grants are one profile's).
2. **Side-map** `sessionProfiles: Map<sessionId, profileId>` in `background.ts`'s closure (upstream `ActiveSession` is closed — recon), stamped per (1), threaded via a WIDENED `SessionEstablishedDeps` return (fable c4), cleaned in `onSessionTerminated` (`:243-247`) beside the existing maps.
3. **Dispatch guard** at the ctx build (`:681-688`): after `requireActiveProfile`, stamp ≠ active profile (map-miss INCLUDED — fail closed) → **send the error envelope FIRST, then terminate** (fable c2: terminating first breaks `sendResponse` on the deleted session; the DISCONNECT chain still covers the dApp either way).
4. **Anchored dispatcher lookup** (both audits' central demand — closes the intra-dispatch TOCTOU): `tryGetDappSessionByOriginAndChain` gains an explicit `forProfileId` parameter; the dispatcher passes `ctx.profileId`, and the service filters on IT instead of re-reading the live profile (`dapp-session/service.ts:116` — the second independent live read disappears from the dispatch path; other callers, if any, keep a live-read overload). With this, an in-flight message that outlives a switch completes ENTIRELY under its captured identity (A's row, A's grants) — which is the correct semantic: accepted-under-A executes-as-A; cross-identity mixing is impossible rather than unlikely. Accepted residual, stated plainly: termination does not cancel an already-running dispatch callback; it completes as A, the dApp may miss its response (already-rejected via DISCONNECT), and NEW messages cannot start.
5. **Switch listener** — new extracted `profile-switch-teardown.ts` (tab-lifecycle shape): on a truthy new profile, terminate every active session whose stamp ≠ new profile id **and every unstamped session** (resolves the R1-flagged listener/dispatch contradiction; both audits favor — an unstamped zombie costs nothing to kill). On `undefined` (lock): NO teardown — pinned lock semantics stay; in-flight-call cancellation is explicitly NOT claimed (codex). A key exchange completing AFTER the listener ran is covered by (1): its establishment validates under the live profile with the approver-bound marker — mismatch fail-closes, match is self-consistently the new profile's session.
6. Wired in `initWalletSdkHandler` beside the `onDappSessionDeleted` block.

### N-26 — marker carries `{at, profileId}`; teardown-deletes + TTL backstop

The Map from §N-04(1) carries the timestamp. Leak closure is TWO-layer (codex R1: a bare 90 s TTL still poisons an immediate reconnect for the full window):
- **Teardown deletion (primary)**: the tab-lifecycle teardown paths (tab close, cross-origin nav — the exact triggers of the mid-ECDH leak) also delete `pendingVerification` entries for that session's/tab's origin. An immediate reconnect after a tab close reads a CLEAN marker set — no 90 s poisoning.
- **TTL backstop (secondary)**: `PENDING_VERIFICATION_STALE_MS = 90_000` + `isPendingVerificationStale(at, now = Date.now())` mirroring `isDiscoveryExpired` (stamp-on-write / check-on-read / lazy-delete; no alarms) — covers leak paths tab-lifecycle can't see (SW-side failures with the tab still open).
- The verification-security floor is unchanged either way: `!trustedVerification` (`session-established.ts:77`) independently forces first-time verification — a deleted/stale marker can only skip a REDUNDANT re-verify, never a first verification (codex-confirmed).
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
- **Marker TTL** can only relax a REDUNDANT re-verification (origin already user-approved once); genuinely new connections always carry their own fresh stamp. 90 s chosen ≥ the 55 s discovery staleness so a slow-but-legitimate ECDH never reads stale.
- **Serializer**: ancestor-tracking preserves the cycle guard (no stack overflow / infinite loop on hostile cyclic results); output shape for existing consumers unchanged for trees.
- No new deps, no crypto changes, no token/workflow changes.

## Assumptions

**Facts (verified; recon.md cites):** ActiveSession is upstream-typed with no profileId; teardown inventory + the `:365-389` template; `onActiveProfileChanged` drains discoveries only; dispatch double-reads the live profile; termination propagates the tested DISCONNECT chain; lock = per-call errors (pinned); marker type/sites (4+2); `toJsonSafe` private, single call site; layer TTL convention; no second-profile network spec exists.
**Inferences (post-audit state):** (1) ~~validated row = approving row~~ REFUTED by both audits (validation reads the LIVE profile, `service.ts:116`; approve-A→switch→validate-B returned B's row) — replaced by the approver-bound marker design. (2) `getActiveSessions()` suffices for the listener's SNAPSHOT only — late key exchanges are covered by the marker at establishment, not the listener (codex). (3) Map-miss handling unified: fail-closed at dispatch AND terminated by the listener (the R1 contradiction resolved). (4) ~~two-profile fixtures exist~~ REFUTED (fable): the in-session switcher has never been e2e-driven — Phase 3 budgets the fixture work with a documented fallback. (5) `SessionEstablishedDeps`' narrowed return type widens to carry `profileId` (fable c4). (6) Profile-change listeners fire synchronously (codex fact) — the guard adjacent to `requireActiveProfile` has no interleaving gap; the ONLY residual is the accepted completes-as-A semantics stated in §N-04(4).
**Asks:** none remaining — the three R1-flagged adjudications (dispatch anchoring, approval-profile binding, map-miss policy) are resolved in-plan.

## Phases

### Phase 1 — N-19 + N-26 (pure, low-risk slices first)
Extract + fix `to-json-safe.ts` with the adopted c6-2 assertions + branch coverage; marker Map/TTL conversion across the 6 sites.
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test src/wallet/services/wallet-sdk/`. Pass: exit 0, new + existing wallet-sdk suites green. Layers: lint/typecheck + unit.

### Phase 2 — N-04 (marker binding, stamp, anchored lookup, guard, listener)
Approver-bound marker + side-map + establishment stamping + the `forProfileId` dispatcher-lookup anchor (dapp-session service + wallet-bridge dispatcher — in-scope adjacent, both audits demanded it) + dispatch guard (respond-then-terminate) + `profile-switch-teardown.ts`. Controlled unit tests (codex R1's list): the listener matrix (stamped-B survives / stamped-A terminated / UNSTAMPED terminated / lock touches nothing); guard: mismatch or map-miss → envelope sent then session terminated, capability lookup never reached; **switch-after-guard** (anchored lookup returns A's row while live profile is B — the TOCTOU pin, via the service's new param); **switch-during-key-exchange** (marker approver A + validated row B → fail-closed terminate; marker A + row A → stamped A); establishment after the listener ran (late key exchange) lands correctly per the marker; **immediate post-tab-close reconnect** (tab teardown deletes the marker; the reconnect is NOT treated as new).
**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test src/wallet/services/wallet-sdk/ src/wallet/services/dapp-session/`. Pass: exit 0. Layers: lint/typecheck + unit.

### Phase 3 — end-to-end proof + full battery (fixture-pioneering budgeted)
Fable c3 finding: the in-session profile switcher has NEVER been driven in e2e (existing two-profile specs use a second browser). Phase 3 therefore BUDGETS fixture work: drive profile-create-B + switcher through the popup with new testids if the switcher lacks them (testid additions are in-scope UI touches). New `tests/e2e/network/session-profileSwitch.test.ts`: connect playground under A → in-session create/switch to B → playground flips disconnected (`pg-status` idiom); a post-switch call rejects (deterministic — no timing-raced "queued call" assertion; the mid-flight race is pinned at unit level per Phase 2, codex R1); reconnect under B succeeds (fresh session, B's rows). Fallback if the switcher proves undrivable in-harness after honest effort: pin the switch path at the composition/unit level + keep the rest of the spec (documented as a deviation, not silently dropped). Then: `bun run audit:vue` + armed `bun run test:e2e` + `bun run e2e:agent` (SOLO; re-run once before triaging).
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
| Anchored dispatcher lookup (`forProfileId` param; live re-read leaves the dispatch path) — in-flight messages complete under their CAPTURED identity, accepted + stated | fable HIGH + codex blocker 1 (converged) | **adopted** |
| Approver-bound marker `Map<key, {at, profileId}>` — one structure serves N-26's TTL AND the stamp source; approve/validate profile mismatch fail-closes | codex blocker 2 (+ fable c4's weaker wording fix, superseded) | **adopted** |
| Respond-then-terminate guard ordering | fable c2 | **adopted** |
| Listener also terminates unstamped sessions (contradiction resolved) | codex + fable minor (converged) | **adopted** |
| Marker teardown-deletion at tab-lifecycle points + TTL as backstop (immediate reconnects unpoisoned) | codex blocker 3 | **adopted** |
| try/finally ancestor cleanup in toJsonSafe | codex | **adopted** |
| Phase 3 fixture-pioneering budget + documented fallback (in-session switcher never e2e-driven) | fable c3 | **adopted** |
| Deterministic e2e (drop the timing-raced queued-call assertion; race pinned at unit level) | codex | **adopted** |

Unresolved disputes: none carried.

## Audit verdicts

- Fable round 1: **conditional approve** (4 conditions) — all adopted (ledger).
- Codex round 1 (session `01a03591-f807-7da0-b4d6-82cbaafc1cd8`): **reject** — 3 blockers (intra-dispatch TOCTOU; unsafe stamp source; N-26's immediate-reconnect poisoning) — ALL adopted in revision 2 (ledger). Its "hybrid genuinely necessary" and "stamp-based teardown correct" confirmations ratify the base shape.
- Final fresh-context codex pass: _pending_

## Seeds

Not used by the active pipeline run. Standalone re-run:

```
/goal All 3 phases marked ✓ in implementations-plan/dapp-profile-binding/plan.md, each ✓ backed by its validation gate reported passing in the transcript; /code-review max --fix applied+committed; codex post-impl loop converged (quoted); PR to dev green; bun run audit:vue, test:e2e, and e2e:agent all exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/dapp-profile-binding forward per plan.md. Reality-check plan.md + lessons/ + git status; next pending phase step; validate with the phase's gate after each meaningful edit; ✓ only when the written gate passes; decisions via /codex xhigh; log consults in lessons/; after all phases ✓ run the plan's Post-implementation section verbatim.
```
