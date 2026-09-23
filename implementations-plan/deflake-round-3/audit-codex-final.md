# deflake-round-3 — final fresh-context codex pass (xhigh)

Four rounds on plan v2→v4. Paths rewritten repo-relative. Round 4's conditions (stale mirror/script sections) were folded before implementation started.

## Round 1 — reject

reject (with blocking findings: Phase 1 cannot reliably select its decision table and still permits unsafe F1; auth readiness does not require a valid profile; the import stall detector is a disguised tighter bound).

### Critical

- **Phase 1b is not a discriminating experiment.** Under the current aggregators, cancelled duplicates fail, and a deliberately-red survivor also fails; every same-name check therefore has the same conclusion, so “which conclusion wins” is unobservable. A failing unit test exercises only `quality-status`, not smoke/network. There is also no mixed/inconclusive/per-workflow outcome. [plan.md:66](implementations-plan/deflake-round-3/plan.md:66), [pr-quick.yml:271](.github/workflows/pr-quick.yml:271), [pr-smoke-e2e.yml:122](.github/workflows/pr-smoke-e2e.yml:122), [pr-network-e2e.yml:235](.github/workflows/pr-network-e2e.yml:235).

- **The all-must-pass row resurrects rejected F1.** Emitting duplicate success after one finite observation still makes gate integrity depend on undocumented duplicate-selection semantics—the exact dependency the ledger says is forbidden. A later ordering/semantics change can let duplicate success beat a red survivor. Use measurement only to choose “1a only” versus identity-pinned survivor-mirroring; mirror for every durable-block case. Include an explicit inconclusive/mixed → stop/replan outcome. [plan.md:75](implementations-plan/deflake-round-3/plan.md:75), [plan.md:186](implementations-plan/deflake-round-3/plan.md:186), [audit-codex.md:13](implementations-plan/deflake-round-3/audit-codex.md:13).

### High

- **`hydrationSettled` alone does not close the auth bug.** On missing/stale-profile or hydration-rejection paths, `finally` becomes true while `appStore.profile` remains undefined; entering a password then enables submission and still throws at `profile.id`, which is swallowed. The plan even preserves that failure rather than proving it unreachable. Gate continuation on `hydrationSettled && valid profile.id`; test password, passkey, stale/not-found, and rejection branches. Normal no-profile first-run already redirects to registration. [plan.md:94](implementations-plan/deflake-round-3/plan.md:94), [auth.vue:58](apps/extension/src/popup/pages/auth.vue:58), [auth.vue:80](apps/extension/src/popup/pages/auth.vue:80), [index.ts:83](apps/extension/src/popup/index.ts:83).

- **The proposed import signal is not monotonic progress.** `restoreStatus` changes to `"progress"` before the restore and remains unchanged throughout all service restores, finalize, and chain sync until `"finished"`. Thus “no transition for N seconds” is simply a new, shorter restore timeout; local measurement cannot make it causal. Expose granular stage-completion transitions or retain only the 300-second terminal backstop; precommit “near/exceeds cap → diagnose product/resource, do not choose a stall window.” [plan.md:114](implementations-plan/deflake-round-3/plan.md:114), [useFullBackupImport.ts:217](apps/extension/src/composables/useFullBackupImport.ts:217), [useFullBackupImport.ts:703](apps/extension/src/composables/useFullBackupImport.ts:703).

### Medium

- Phase 3 must spell the default run as named import files: a default **full** network sweep is refused when proverless-only files are present. Certification and the SW/permission/defer resolutions otherwise carry correctly. [plan.md:203](implementations-plan/deflake-round-3/plan.md:203), [agent.sh:21](apps/extension/scripts/e2e/agent.sh:21).

---

## Round 2 — reject

reject (with blocking findings: survivor-mirror finality remains undefined; import measurement still observes the wrong signal).

### Critical

- **Identity pinning does not identify the final survivor.** In R1→R2→R3, R1 may select or finish mirroring R2 before R3 arrives; if R2 succeeds and R3 fails, R1 recreates wrong-ALLOW under ambiguous duplicate resolution. The plan must define recursive supersession chasing and a causal finality rule, then probe a deliberately delayed third delivery—not merely “poll the surviving run.” [plan.md:87](implementations-plan/deflake-round-3/plan.md:87), [plan.md:90](implementations-plan/deflake-round-3/plan.md:90).

### High

- **Phase 3 still measures `restoreStatus`, not `restoreStage`.** Because `restoreStatus` stays `"progress"` throughout, that measurement yields no per-stage envelopes and cannot safely size the proposed stall window. Make observability a preliminary subphase: add/log `restoreStage`, measure every stage on both modes, then select behavior. A measurement-sized absence window remains a bound unless each watched stage has internal monotonic progress or a product-owned deadline; otherwise use stages for diagnostics while retaining only the 300-second outer failure. [plan.md:124](implementations-plan/deflake-round-3/plan.md:124), [plan.md:129](implementations-plan/deflake-round-3/plan.md:129).

The auth fix and Phase-3 command correction are sound. Also synchronize stale `data-restore-status`/“3 pins” entries in the change map before implementation.

---

## Round 3 — reject

reject (with blocking findings: recursive mirroring still lacks future-event finality; internal stage progress is not made observable).

- **Critical:** Re-listing after the newest run terminates only proves “newest now.” A label event arriving after that re-list creates R3 after R1 has already mirrored R2 success; if R3 fails, the old success can still wrong-ALLOW under the nondeterministic semantics the design claims to tolerate. The delayed-third probe tests one timing, not arbitrary future deliveries. Either eliminate same-SHA re-trigger duplicates or STOP for semantics where older checks can win. [plan.md:87](implementations-plan/deflake-round-3/plan.md:87)

- **High:** `data-restore-stage` advances only at stage boundaries. A stage’s internal monotonic progress does not help unless that progress is also exposed and consumed by the stall detector; otherwise the window remains a fixed inactivity bound. Require an observable progress counter/marker per eligible stage, or restrict early failure to product-owned deadlines. [plan.md:136](implementations-plan/deflake-round-3/plan.md:136)

---

## Round 4 — conditional approve

conditional approve (with conditions: synchronize the remaining stale sections before implementation).

The revised designs are gate-safe and rule-compliant. However, the plan still directs implementers toward the removed mirror/API design:

- “Common plumbing” still specifies supersession scripts, `actions: read`, and API polling. [plan.md:90](implementations-plan/deflake-round-3/plan.md:90)
- The change map still schedules status-job scripts and aggregator modules. [plan.md:193](implementations-plan/deflake-round-3/plan.md:193)
- The Decision ledger still chooses “survivor-mirror” and claims it is universally safe. [plan.md:211](implementations-plan/deflake-round-3/plan.md:211)
- Phase 1b/gate still describes duplicate-success/red-survivor probes instead of the two new load-bearing source-elimination probes. [plan.md:66](implementations-plan/deflake-round-3/plan.md:66)

Remove those contradictions and the plan is approved.
