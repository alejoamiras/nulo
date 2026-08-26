# capture-await-write-sweep — targeted concurrency sweep

**Tier**: `/blueprint light` (owner-fixed; escalation is risk-based — §Method 6: CONFIRMED > 2 OR any cross-context/shared-primitive/trust-boundary/high-harm fix → independent max review leg).
**Branch/worktree**: `worktree-capture-await-write-sweep`, cut at dev `4f2833ab` (post audit-448 batch 9), origin/dev `1727a42f` (#470) merged in at `c3297ded`.
**eli5_mode**: Artifact (URL recorded in § Seeds when published).

## Goal

Hunt the one recurring racy shape in code the #448 audit never flagged:

```
const snap = readSharedState()   // epoch, generation, profile row, journal stage, active network…
await something()                // lock released / microtask gap; deletions, switches, claims interleave
write(basedOn(snap))             // stale snapshot → orphan or cross-profile/cross-stage write
```

This is a pattern hunt, not a re-audit. The 9 audit-448 batches + earlier fence plans are the TEMPLATE LIBRARY (idioms + pin shapes), not targets. Deliverables:

1. A complete triage table — every candidate listed with a verdict, **no silent drops**.
2. Fixes for every CONFIRMED site using the **nearest established fence idiom** (never a new fence style), each with a colocated regression pin that discriminates the racy shape, revert-probed red.
3. If nothing triages CONFIRMED: the table itself is the deliverable — a bill of health that is always QUALIFIED by the KNOWN-DEFERRED D13 residual rows (an unqualified clean bill is impossible by construction) and by any OWNER-ACK-PENDING SAFE-lww rows.

## Phase 0 answers (derived from the task brief — owner pre-answered)

- **Success criterion**: triage table covers 100% of enumerated candidates; CONFIRMED sites fixed + pinned (revert-probe log per pin); `audit:vue` green; smoke/network e2e per repo rules when their surfaces are touched.
- **Scope in**: `apps/extension/src/wallet/services/**`, `packages/wallet-core/src/**`, `packages/aztec-runtime/src/**`; UI composables ONLY where they write through services. Background/SW code paths are the focus.
- **Scope out as fix TARGETS** (but pre-seeded into the table for capture-order/branch-coverage verification, never silently excluded): already-fenced sites (recon.md §4) and the KNOWN-DEFERRED D13 residuals. Fully out: UI-pure composables/components, faucet/playground apps, e2e/test code (except pins added by this plan), findings adjudicated REFUTED in the 2026-08-24 verdict (esp. N-20's defective proof c5-3 — never adopt; adjacent allocator races still triage).
- **Quality bar**: production. This is a wallet; races here are security-adjacent.
- **Validation layers**: typecheck/lint/unit on every phase; `audit:vue` as the pre-PR gate; `test:e2e` (smoke) if popup/UI surfaces change; `e2e:agent` (network, SOLO on this host) if dApp/network/PXE behavior changes.
- **Escalation**: CONFIRMED > 2 → treat fixes as a mid-tier arc (independent max review of the diff in addition to the codex loop).
- **Delegation**: routine verdicts resolved in-session; genuinely disputable SAFE-vs-CONFIRMED calls go through the codex adversarial pass (phase 2 gate). NEEDS-DESIGN findings are documented, not silently fixed or dropped.
- **/harden**: not scheduled — this sweep IS a targeted hardening pass; a future whole-repo `/harden` remains an owner call.

## Method (from the brief, operationalized; rev 2 folds the codex plan-gate reject)

1. **Enumerate mechanically, THREE passes** (phase 1):
   - **Pass 1 — intraprocedural**: fan out read-only agents over the 122-file census slices; every function where a value read from shared state crosses an `await` and then feeds a write, transition, or dispatch is a candidate. Sites with visible fences are listed and marked, never dropped.
   - **Pass 2 — async-boundary lens** (codex net-miss finding): a grep-guided sweep over the whole scope for the variants pass 1's function-local reading under-catches: state captured into REGISTERED closures/listeners that fire later (EventHandler `.add`, `addListener`, ports, alarms, timers); fire-and-forget launches (`void fn(...)`, un-awaited promises, `.then` chains) where the capture and the await live in different functions; aliased mutable objects (captured reference mutated elsewhere; final write doesn't syntactically mention the read); cross-realm/cross-context flows (SW↔offscreen RPC results carrying identity, popup-realm writers to shared storage); event-payload staleness (payload minted pre-switch consumed post-switch — `EventHandler.invoke` does NOT await subscribers, so async subscriber bodies interleave).
   - **Pass 3 — score-0/1 re-screen**: the census's score-0/1 exclusions are re-verified by a cheap shape-screen (grep for await + subsequent shared-state write per file); any hit is promoted to full enumeration. Known promotions already: `packages/aztec-runtime/src/pxe/client.ts` (`request()` :124-194 — generation capture, provision retry), `apps/extension/src/wallet/services/profile/client.ts` (`subscribeActiveProfile` :138-155 — documented snapshot→subscribe lost-event window). The screen also covers `packages/extension-messaging/src/**` (scope-adjacent transport layer holding cross-context request state — a DOCUMENTED scope addition per the plan audit, reported in the table under its own section).
   STATEFUL `extension-messaging` files (`core/base-client.ts`, `core/base-service.ts`, transports — anything holding correlators/pending maps/timers) get FULL-read enumeration like a pass-1 slice, not grep-screen-only; type/barrel files may stay screen-only. Over-inclusion is fine; silent omission is the failure mode.
2. **Triage** (phase 2) with the three questions per candidate, each answered against the RIGHT invariant (codex triage-misjudgment finding):
   - (a) Can the state the snapshot came from change during the await? Consider ALL mutator classes: user-driven deletion/profile/network/account switch, claim/reap, restore/import, SW restart (in-memory state dies; durable state persists; offscreen restarts independently), lock/unlock + session expiry, OTHER REALMS (popup/onboarding write shared storage directly), event-handler reentrancy, watchdog force-release — AND authority expiry: even if the captured state row is unchanged, has the AUTHORIZATION it represents (session, approval, epoch) expired or been revoked?
   - (b) Does the write recheck or CAS at commit — over the RIGHT field? A CAS on stage is not a CAS on authorization provenance; check ABA, an await between the re-check and the commit, and whether every write branch (success, failure, catch, finally) is covered.
   - (c) Is an existing fence idiom guarding it — with correct capture ORDER (before the first await), full branch coverage, restart persistence where needed, and fencing of production (the write) rather than only consumption?
3. **Verdicts with proof obligations** (codex SAFE-taxonomy finding):
   - `SAFE-fenced`: name the idiom + verify capture order and branch coverage.
   - `SAFE-under-lock`: the read→write AND every mutator take the SAME lock acquisition; note the watchdog — a >5-min hold forfeits exclusivity (`maxHoldMs` default), so long-hold sections claiming this verdict must address force-release.
   - `SAFE-immutable`: ALL relevant authority is immutable, not merely the captured object.
   - `SAFE-no-mutator`: enumerate the mutator classes checked (raw storage writers incl. other realms, events, ports, offscreen, restart recovery) WITH the search trail. This is the highest-risk category — treat a thin trail as unresolved.
   - `SAFE-lww` (by-design last-write-wins): state the harm ceiling, affected identities/assets, persistence duration — and mark `OWNER-ACK-PENDING` (the PR body lists these for explicit owner acceptance; a SAFE-lww verdict is provisional until then).
   - `CONFIRMED` (constructible interleave with durable or cross-identity harm) · `NEEDS-DESIGN` (racy, fix exceeds established idioms — documented, not fixed; precedent: backup-restore-residuals) · `KNOWN-DEFERRED` (owner-ratified deferral cited; NEVER relabeled SAFE — precludes an unqualified clean bill).
4. **Fix policy** (phase 3): nearest established idiom only — capture-at-entry epochs (`captureRestoreEpochs`/`assertRestoreEpoch`), generation fences (`createRunFence`, required `getGeneration`), CAS (`transitionIfStage`), ownership (`requireOwnedRow`, ticketed `Lock`), switch-epoch trackers. Capture must precede the FIRST await it guards (hold points and e2e gates are first-class parks). Every fix ships its discriminating pin IN THE SAME COMMIT, revert-probed red.
5. **Adversarial framing** everywhere: construct the interleaving; never accept "single-threaded so it's fine" (single-threaded holds only PER REALM — SW, offscreen, popup are concurrent contexts sharing durable state). Never accept "test-only/e2e-only window" as an exemption.
6. **Escalation** (risk-based, replacing the pure count rule): the independent max-effort review leg fires when CONFIRMED > 2 **or** any single fix touches a cross-context flow, a shared fence primitive, a trust boundary (restore/dApp dispatch), or has high-harm ceiling.

## Template-library principles (binding, from the batches' lessons)

- Capture precedes the first await it guards; a hold/gate point is a park (service-fences r1).
- Event-derived epochs need (a) a cold-start baseline policy for silent restores and (b) capture BEFORE the await that resolves the identity they protect (dapp-profile-binding r3).
- Snapshot loops need per-item recheck-at-commit; batch cursors must not consume invalidated post-conditions (data-safety caller-walk lesson).
- Hardening code at a trust boundary is exactly as hostile-input-tolerant as the loop it guards — null-probe every new pre-loop pass over backup rows (service-fences max review).
- A pin must discriminate the racy shape: revert-probe (strip fence → red → restore → green); begin+RELEASE deletion variants where only entry-capture still rejects; stub the legacy read path for CAS pins; probe multi-mechanism pins per mechanism (shell-identity r2).
- Fail-closed claims enumerate op classes before generalizing (accountless ops bypass session-manager — dapp-profile-binding r2).
- `Date.now()` same-tick collisions void equality-CAS tests — separate ticks explicitly (journal-reaper).
- Network e2e runs ALONE on this host; audit:vue never runs concurrently with it (lock-ownership lesson).

## Architecture & Implementation (compact — light tier)

- **No new runtime architecture.** The change surface is: (i) point fixes at CONFIRMED sites re-using exported fence helpers; (ii) colocated `*.test.ts` pins; (iii) committed sweep artifacts (`candidates.md`, `triage.md` — final table also inlined in this plan dir).
- **Reuse**: every fix imports an existing idiom (see recon.md § idiom inventory for defining files/signatures). If a CONFIRMED site has no reachable idiom → it is NEEDS-DESIGN by definition.
- **Critical flow (the sweep itself)**: census → slice → enumerate (agents return per-file candidate lists + a coverage statement) → consolidate/dedup (parent) → per-candidate code read + verdict (parent, in-session) → codex adversarial pass on the table → fixes+pins → gates.
- **File-level change map**: unknown until phase 2 (inherent to a sweep); the triage table IS the change map, produced before any fix lands. candidates.md records the census hash so coverage is checkable.
- **Simpler alternative considered**: single-pass "grep for missing fences" without a census or triage table — rejected: silent drops are exactly what the brief forbids; the census + full table is what makes absence claims auditable.

## Security & Adversarial Considerations

- **Threat model**: (1) hostile backup blobs driving restore writers (attacker-controlled rows); (2) malicious/aggressive dApps issuing concurrent RPC while the user switches profiles/networks; (3) user-driven deletions/switches interleaving any in-flight background op; (4) SW restarts tearing state mid-write; (5) a compromised or confused UI surface racing service state. The sweep's whole point is closing interleave primitives (orphans, cross-profile writes, resurrection-after-deletion).
- **Trust boundaries**: restore/import paths treat input as HOSTILE (presence-guard + null-tolerance; probe new pre-loop code with null elements). dApp-origin params validated at dispatch; no fix may relax an existing fail-closed check.
- **Least privilege / supply chain / crypto**: no new deps, no credentials, no crypto — fixes are control-flow only, reusing in-repo helpers. CI surface untouched.
- **Fail-direction rule**: every added fence fails CLOSED (bail/reject the stale write); a fence must never convert a per-row error contract into a whole-operation abort (service-fences null lesson).
- **Adversarial ask for every audit pass**: try to CONSTRUCT the interleaving; attack SAFE verdicts; check fixes don't introduce new failure modes (a reviewer-mandated fix is still new code — data-safety float-boundary lesson).

## Assumptions

**Facts** (verified):
- Worktree cut at origin/dev `4f2833ab`; origin/dev then advanced to `1727a42f` (#470 — CI workflow + aztec-5.2.0-js-line plan docs ONLY, zero scope source files) and was merged into this branch (`c3297ded`). All 9 audit-448 batches merged (index rows 129–143). Rebase policy: re-fetch + delta-assess before the PR opens; re-enumerate only if a delta touches scope files.
- Gate commands exist at root `package.json`: `audit:vue`, `test`, `test:all`, `lint`, `typecheck:all`, `test:e2e`, `e2e:agent`.
- Template plans + lessons exist under `implementations-plan/{export-integrity,migration-lifecycle,dapp-profile-binding,lock-ownership,data-safety,shell-identity-fences,service-fences,journal-reaper,runtime-edges,fix-state-fences,fix-account-generation-fence,reimport-pxe-fence}/`.
- N-20 adjudicated REFUTED with defective proof c5-3 (runbook § adjudication deltas); N-21 latent; N-03's orphan inert; N-10's harm ceiling = transiently stale same-address balance.
- Recon idiom inventory + exclusion list: see `recon.md` (file:line for every idiom).
- Census: 280 production files in scope; 122 at async-write score ≥2 (34,437 LOC) form the PASS-1 universe (6 LOC-balanced slices, recon.md §5) — the full enumeration universe additionally includes the pass-3 promotions (`pxe/client.ts`, `profile/client.ts`, any screen hits, stateful `extension-messaging` files) and the parent carve-out files. Score 0/1 exclusions carry per-file bases in census.md and are re-verified by the pass-3 screen.
- Fence implementations themselves (lock.ts, rw-guard.ts, restore-fence.ts, …) are IN the enumeration universe — prior batches found real bugs inside fences (N-11).

**Inferences** (attackable):
- Pass 1 (intraprocedural) + pass 2 (async-boundary lens) + pass 3 (score re-screen) together catch the shape. The codex plan gate REJECTED the pass-1-only net as intraprocedural; passes 2–3 are the fold. Residual risk: deeply laundered aliasing — mitigated by the phase-2 codex table attack.
- Interleaving at awaits PER REALM; SW, offscreen, popup/onboarding are concurrent realms sharing durable storage — cross-realm writers are a first-class mutator class in triage.
- ~~Score-0/1 files cannot hide the shape~~ CORRECTED (codex found two counterexamples: `pxe/client.ts`, `profile/client.ts`): score-0/1 exclusions are re-verified by the pass-3 shape screen; the committed `census.md` carries the per-file trail.

**Asks** — all resolved under the brief's standing authorization; recorded here as decided-with-rationale for owner veto at PR review:
- *Boundary-package scope*: `packages/extension-messaging/src/**` (cross-context transport state) gets the pass-3 shape screen and its hits a dedicated table section — a DOCUMENTED addition beyond the brief's three dirs, adopted from the plan audit; everything else outside the brief stays out.
- *Rebase policy*: fold origin/dev before the PR; re-enumerate scope-touching deltas.
- *SAFE-lww acceptance*: each such verdict is provisional `OWNER-ACK-PENDING`; the PR body lists them for explicit acceptance.
- *Negative-proof bar*: every SAFE-no-mutator verdict enumerates the mutator classes checked (raw storage/other realms, events, ports, offscreen, restart) with its search trail.
- *Deferral expiry*: KNOWN-DEFERRED rows cite their ratifying plan; re-audit scheduling stays an owner call (out of sweep scope).
Pre-answered by the brief: tier + escalation floor, scope dirs, fix policy (established idioms only), clean-bill deliverable, adversarial codex framing. Standing instructions authorize codex consults and feature-branch pushes; PR opened at delivery, merge stays with the owner.

## Phases & validation gates

### Phase 1 — census-sliced mechanical enumeration
Fan out 6 read-only enumeration agents over recon.md §5's slices; each reads EVERY assigned file fully and returns per-function candidates (`file:line · state read · await(s) crossed · write · visible guard · interleave hypothesis`) + an explicit per-file coverage statement (zero-candidate files still listed with a reason). Sites with visible fences are LISTED and marked, never dropped — the parent verifies fence sufficiency at triage. Parent consolidates into `candidates.md` (dedup, no verdicts yet).
**Gate**: pass 1 slice-union == the 122-file census set with every slice reporting 100% of its files examined (⚠ files re-covered by the parent); pass 2 (both agents) AND pass 3 (screen of every score-0/1 file with per-file reason + full enumeration of every promotion incl. the stateful extension-messaging files) complete; all three passes consolidated into `candidates.md` — the file is not final (and triage does not freeze) until all passes are in. Commands: none (read-only phase) — gate is the coverage cross-check recorded in candidates.md. Layers: n/a.

### Phase 2 — triage + adversarial pass
Parent reads each candidate site in the code and issues verdicts per the three questions (v2 checklist in §Method). The table is PRE-SEEDED with every recon §4 prior-fenced site and both D13 residual rows — "if encountered" listing is not enough (codex exclusion finding); prior-fenced rows verify capture order + branch coverage rather than assuming. KNOWN-DEFERRED rows cite backup-restore-residuals (never re-flagged as new, never silently fixed, never relabeled SAFE — a clean bill is explicitly QUALIFIED by them). A new bug in a previously-fenced file is suppressed only if it IS the exact ratified residual; adjacent races (incl. allocator races near refuted N-20) triage normally. Parent carve-out skim results (`wallet/{config,logger,base}/`, `syncedRef.js`) enter the table as parent-slice rows. Then the candidate manifest + SAFE rows are FROZEN and independently attacked: a codex `xhigh` adversarial pass over the full table + code refs — attack SAFE verdicts, confirm/refute CONFIRMED interleavings, flag net-misses — before any fix edits begin (reviewing only a fix diff cannot find omissions).
**Gate**: triage-row ID set == candidates.md ID set (candidates.md carries the pre-seeded prior-fenced/D13/refuted-adjacent rows in its own section, so parity is ID-set equality with no out-of-band rows; dedup rule: a pass-2/3 candidate matching an existing ID folds into that row, noted); every CONFIRMED row has a written interleave scenario; codex pass completed with its challenges resolved (adopted or rebutted in the table). Commands: none (analysis phase). Layers: n/a.

### Phase 3 — fixes + discriminating pins (skipped if zero CONFIRMED)
Per CONFIRMED site: nearest-idiom fix + colocated pin in the SAME commit; revert-probe each pin (strip fence → pin red → restore → green) and log the probe in `lessons/phase-3.md`.
**Gate** (per-fix-iteration feedback, NOT a terminal re-run — the terminal full battery is phase 4's alone): after each fix commit, `bun run lint` + `bun run typecheck:all` + the touched packages' targeted test runs (each named in lessons) exit 0. No standalone full-suite pass at phase end — phase 4 immediately provides it. Layers: typecheck/lint · unit (targeted).

### Phase 4 — full battery + delivery prep
**Gate**: `bun run audit:vue` exit 0 (typecheck ∥ extension unit+component ∥ lint, then build) AND `bun run test:all` exit 0 (all workspace packages' suites — covers wallet-core/aztec-runtime units audit:vue doesn't run). If any popup/UI file changed: `bun run test:e2e` green. If any dApp/network/PXE behavior changed: `bun run e2e:agent` green, run SOLO (no concurrent suites/audits on this host; flake → re-run once before triaging). Layers: all applicable.

## Post-implementation (self-contained — the implementing session executes THIS section)

1. **`/code-review max --fix`** on the whole sweep diff → skim applied fixes → commit them separately from implementation commits.
2. **Codex audit** (`/codex xhigh`, fresh session): the net diff + triage.md + this plan + summary of code-review commits + the adversarial/security ask (construct interleavings; attack SAFE verdicts; new-failure-mode check on every fix) + BOTH rules verbatim:
   - No-over-engineering: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Comment-quality: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop**: verify codex's factual claims against the repo first; apply accepted fixes; commit; log consult + verdict in `lessons/`; RESUME the same codex session with the fix diff; repeat until a round yields no new material findings (>3 material rounds → stop and surface).
4. **Escalation leg** (risk-based — §Method 6): fires when CONFIRMED > 2 OR any fix touches a cross-context flow, shared fence primitive, trust boundary, or high-harm ceiling: an independent max-effort Claude review of the diff (own revert-probes), findings folded before the codex loop closes.
5. **Delivery**: FIRST PR now — `gh pr create` to dev, conventional title ≤93 chars (budget for ` (#NN)`), body = triage summary + fix list. `gh pr checks --watch`; flake → re-run, breakage → fix; NEVER weaken/neutralize a gate; plain merge only when the owner says so (no `--admin`, no autonomous merge).
6. Update `implementations-plan/index.md` (add this plan's row); `agent-worktree status` at each gate; suggest `agent-worktree done capture-await-write-sweep` after merge.

## Delivery

**Single-arc**: one branch (`worktree-capture-await-write-sweep`), one PR into dev. No stack. Phases 1–4 all land in that PR (sweep artifacts + fixes + pins). If phase 2 yields NEEDS-DESIGN findings, they ship as documented findings in triage.md + index follow-up rows, not code.

## Seeds

(Implementation proceeds in THIS session under the owner's standing brief; seeds recorded for protocol completeness and for any resumed session — run them INSIDE this worktree via `agent-worktree resume capture-await-write-sweep`.)

**Recommended — `/goal`:**
```
/goal All four phases marked ✓ in implementations-plan/capture-await-write-sweep/plan.md; candidates.md + triage.md committed with row-count parity (no silent drops) and every CONFIRMED row carrying an interleave scenario; every fix commit paired with a colocated pin whose revert-probe (red/green) is logged in lessons/; /code-review max --fix applied+committed; the codex fix loop converged (resumed pass reporting no new material findings, quoted in transcript); PR to dev exists (gh pr view output in transcript) with `bun run audit:vue` exit 0 quoted; e2e:agent green quoted if dApp/network/PXE surfaces were touched.
```

**Alternative — `/loop 15m`:** drive plan.md forward per firing: reality-check plan.md + lessons/ + git status; pick the next pending phase step; validate with `bun run lint` + targeted tests after each edit; consult `/codex xhigh` on disputable verdicts instead of waiting; mark phases ✓ only when their written gate passes; after all ✓ run the Post-implementation section verbatim; stop after 5 failures on one step and reassess.
