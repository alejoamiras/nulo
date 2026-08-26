# capture-await-write-sweep — targeted concurrency sweep

**Tier**: `/blueprint light` (owner-fixed; escalation rule: CONFIRMED count > 2 → add the mid-tier dual-audit legs on the fix diff).
**Branch/worktree**: `worktree-capture-await-write-sweep`, based on dev `4f2833ab` (post audit-448 batch 9).
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
3. If everything triages SAFE: the table itself is the deliverable — a clean bill closing the theme.

## Phase 0 answers (derived from the task brief — owner pre-answered)

- **Success criterion**: triage table covers 100% of enumerated candidates; CONFIRMED sites fixed + pinned (revert-probe log per pin); `audit:vue` green; smoke/network e2e per repo rules when their surfaces are touched.
- **Scope in**: `apps/extension/src/wallet/services/**`, `packages/wallet-core/src/**`, `packages/aztec-runtime/src/**`; UI composables ONLY where they write through services. Background/SW code paths are the focus.
- **Scope out**: already-fenced sites (exclusion list in recon.md), UI-pure composables/components, faucet/playground apps, e2e/test code (except pins added by this plan), findings adjudicated REFUTED in the 2026-08-24 verdict (esp. N-20's defective proof c5-3 — never adopt).
- **Quality bar**: production. This is a wallet; races here are security-adjacent.
- **Validation layers**: typecheck/lint/unit on every phase; `audit:vue` as the pre-PR gate; `test:e2e` (smoke) if popup/UI surfaces change; `e2e:agent` (network, SOLO on this host) if dApp/network/PXE behavior changes.
- **Escalation**: CONFIRMED > 2 → treat fixes as a mid-tier arc (independent max review of the diff in addition to the codex loop).
- **Delegation**: routine verdicts resolved in-session; genuinely disputable SAFE-vs-CONFIRMED calls go through the codex adversarial pass (phase 2 gate). NEEDS-DESIGN findings are documented, not silently fixed or dropped.
- **/harden**: not scheduled — this sweep IS a targeted hardening pass; a future whole-repo `/harden` remains an owner call.

## Method (from the brief, operationalized)

1. **Enumerate mechanically** (phase 1): fan out read-only agents over a file census of the scope; every function where a value read from shared state crosses an `await` and then feeds a write, transition, or dispatch is a candidate. Over-inclusion is fine; silent omission is the failure mode. Grep seeds: `getGeneration`, `getOperation`, epoch/generation/fence identifiers, storage-facade writers, EntityStorage mutations after awaits, active-profile/network reads, cache snapshots.
2. **Triage** (phase 2) with three questions per candidate:
   - (a) Can the state the snapshot came from change during the await? (deletion, profile/network switch, claim, restore, SW restart, lock/unlock)
   - (b) Does the write recheck or CAS at commit?
   - (c) Is an existing fence idiom already guarding it?
3. **Verdicts**: `SAFE-<reason>` (fenced / under-lock-both-sides / immutable-state / no-mutator-with-search-trail / by-design-last-write-wins with harm ceiling stated) · `CONFIRMED` (constructible interleave with durable or cross-identity harm) · `NEEDS-DESIGN` (racy, but the fix exceeds established idioms — documented finding, not fixed here; precedent: backup-restore-residuals proved some fences are multi-PR epics).
4. **Fix policy** (phase 3): nearest established idiom only — capture-at-entry epochs (`captureRestoreEpochs`/`assertRestoreEpoch`), generation fences (`createRunFence`, required `getGeneration`), CAS (`transitionIfStage`), ownership (`requireOwnedRow`, ticketed `Lock`), switch-epoch trackers. Capture must precede the FIRST await it guards (hold points and e2e gates are first-class parks). Every fix ships its discriminating pin IN THE SAME COMMIT, revert-probed red.
5. **Adversarial framing** everywhere: construct the interleaving; never accept "single-threaded so it's fine". Also never accept "test-only/e2e-only window" as an exemption.

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
- Worktree base = origin/dev `4f2833ab` (all 9 audit-448 batches merged: #453–#463 line; index rows 129–143).
- Gate commands exist at root `package.json`: `audit:vue`, `test`, `test:all`, `lint`, `typecheck:all`, `test:e2e`, `e2e:agent`.
- Template plans + lessons exist under `implementations-plan/{export-integrity,migration-lifecycle,dapp-profile-binding,lock-ownership,data-safety,shell-identity-fences,service-fences,journal-reaper,runtime-edges,fix-state-fences,fix-account-generation-fence,reimport-pxe-fence}/`.
- N-20 adjudicated REFUTED with defective proof c5-3 (runbook § adjudication deltas); N-21 latent; N-03's orphan inert; N-10's harm ceiling = transiently stale same-address balance.
- Recon idiom inventory + exclusion list: see `recon.md` (file:line for every idiom).
- Census: 280 production files in scope, 122 at async-write score ≥2 (34,437 LOC) forming the enumeration universe, pre-packed into 6 LOC-balanced slices (recon.md §5). Score 0/1 exclusions carry per-file bases; carve-outs (`wallet/{config,logger,base}/`, `syncedRef.js`) are census-documented absences re-verified by a cheap parent skim at triage.
- Fence implementations themselves (lock.ts, rw-guard.ts, restore-fence.ts, …) are IN the enumeration universe — prior batches found real bugs inside fences (N-11).

**Inferences** (attackable):
- The census + function-level enumeration net catches the shape (risk: reads laundered through helper calls or object aliasing evade the "local snapshot" pattern-match; mitigation: enumeration instructions include field-reads-off-this, destructured reads, and helper-returned snapshots, and the codex pass is explicitly asked what the net misses).
- The extension SW's concurrency model is single-threaded JS with interleaving at awaits — races are await-boundary races, not data races. (Matches every prior batch's model.)
- Score-0/1 census files (pure types/codecs, no shared-state writes) can be excluded from function-level enumeration without silent drops — the census's own grep basis is the audit trail.

**Asks** — none open. Pre-answered by the brief: tier (light + escalation rule), scope, fix policy (established idioms only), clean-bill deliverable, adversarial codex framing. Standing instructions authorize codex consults and feature-branch pushes; PR is opened at delivery, merge stays with the owner.

## Phases & validation gates

### Phase 1 — census-sliced mechanical enumeration
Fan out 6 read-only enumeration agents over recon.md §5's slices; each reads EVERY assigned file fully and returns per-function candidates (`file:line · state read · await(s) crossed · write · visible guard · interleave hypothesis`) + an explicit per-file coverage statement (zero-candidate files still listed with a reason). Sites with visible fences are LISTED and marked, never dropped — the parent verifies fence sufficiency at triage. Parent consolidates into `candidates.md` (dedup, no verdicts yet).
**Gate**: slice-union == the 122-file census set; every slice reports 100% of its files examined (⚠ files re-covered by the parent); candidates.md committed. Commands: none (read-only phase) — gate is the coverage cross-check recorded in candidates.md. Layers: n/a.

### Phase 2 — triage + adversarial pass
Parent reads each candidate site in the code and issues verdicts per the three questions; produce `triage.md` (the full table). Known-deferred D13 residuals triage as KNOWN-DEFERRED citing backup-restore-residuals (never re-flagged as new, never silently fixed). Parent also skims the census carve-outs (`wallet/{config,logger,base}/`, `syncedRef.js`) to confirm the documented absences. Then a codex `xhigh` adversarial pass over the table + diff-less code refs: attack SAFE verdicts, confirm/refute CONFIRMED interleavings, flag net-misses.
**Gate**: table row count == consolidated candidate count (no silent drops); every CONFIRMED row has a written interleave scenario; codex pass completed with its challenges resolved (adopted or rebutted in the table). Commands: none (analysis phase). Layers: n/a.

### Phase 3 — fixes + discriminating pins (skipped if zero CONFIRMED)
Per CONFIRMED site: nearest-idiom fix + colocated pin in the SAME commit; revert-probe each pin (strip fence → pin red → restore → green) and log the probe in `lessons/phase-3.md`.
**Gate**: `bun run lint` + `bun run typecheck:all` + `bun run test:all` exit 0; every pin's revert-probe logged red/green. Layers: typecheck/lint · unit.

### Phase 4 — full battery + delivery prep
**Gate**: `bun run audit:vue` exit 0 (typecheck ∥ unit+component ∥ lint, then build). If any popup/UI file changed: `bun run test:e2e` green. If any dApp/network/PXE behavior changed: `bun run e2e:agent` green, run SOLO (no concurrent suites/audits on this host; flake → re-run once before triaging). Layers: all applicable.

## Post-implementation (self-contained — the implementing session executes THIS section)

1. **`/code-review max --fix`** on the whole sweep diff → skim applied fixes → commit them separately from implementation commits.
2. **Codex audit** (`/codex xhigh`, fresh session): the net diff + triage.md + this plan + summary of code-review commits + the adversarial/security ask (construct interleavings; attack SAFE verdicts; new-failure-mode check on every fix) + BOTH rules verbatim:
   - No-over-engineering: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Comment-quality: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
3. **Iterative fix loop**: verify codex's factual claims against the repo first; apply accepted fixes; commit; log consult + verdict in `lessons/`; RESUME the same codex session with the fix diff; repeat until a round yields no new material findings (>3 material rounds → stop and surface).
4. **Escalation leg** (only if CONFIRMED > 2): an independent max-effort Claude review of the diff (own revert-probes), findings folded before the codex loop closes.
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
