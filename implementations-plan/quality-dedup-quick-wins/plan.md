# Plan — Quality dedup quick-wins batch (mid)

**Origin:** the ≤1-day dedup findings from `/harden quality` run `2026-06-11-ultra-50b45d`. **Re-scoped after the dual audit** (both codex + the Claude planner caught that the week-old audit snapshot was stale): **5 arcs — Q16, Q22, Q20, Q7, Q14** — one phase = one arc = one PR, sequential on `dev`. **Q21 dropped** (mooted by PR #91) and **Q19 demoted** to its own plan (see Decision ledger).

**Tier:** mid. Rubric — novelty LOW, irreversibility LOW (per-PR revertible), migration NONE, external coupling NONE, blast-radius LOW-per-arc, security LOW-after-demoting-Q19. The dual audit earned its keep: it re-scoped 3 arcs against the current tree before any code was written.

## Core approach (every phase)
- **One arc per branch/PR**, branched off **freshly-merged `dev`** (sequential; no cross-arc conflicts; each validates against latest).
- **Behavior-preserving.** Preserve every documented constraint verbatim; pin surprising preserved behavior with a BUG-PIN test. **First step of every phase: re-verify the arc against current `dev`** (grep the cited symbols/sites; the audit snapshot is stale — confirm before touching).
- **Per-arc workflow:** re-verify → dedup + tests → local gate → push → (label `e2e:network` only on network-gated arcs) → CI → **auto-merge `--admin` when the gate's CI checks are green AND verified-to-have-run**.
- **Auto-merge rule (user-approved, hardened per codex):** `gh pr merge <n> --squash --admin --delete-branch` fires only when `Quality / Status` is SUCCESS **and** the gate's heavy check is **proven to have actually run** (not skipped). ⚠ **Both the network-e2e AND smoke reducers report green-when-skipped** (`pr-network-e2e.yml:222,244`; `pr-smoke-e2e.yml:141`) — never trust the `Status` rollup alone. Proof-of-run via `gh pr view --json statusCheckRollup` + `gh run view`:
  - network-gated arc (Q7, Q22): confirm **every** network execution job ran (NOT skipped) — `Run / shard *` AND `Run / heavy`, `Run / heavy / concurrent-confirm`, `Run / canary` (`pr-network-e2e.yml:158,200`).
  - smoke-gated arc (Q14): confirm the `Run / Vitest + Puppeteer` smoke job ran (not skipped).
  - Any red → re-run once → still red → STOP + surface (a human judges flake-vs-real; the network suite is mid-de-flake by another agent).
- **Standard local gate:** `bun run lint` + `bun run --cwd packages/<pkg> typecheck` + `bun run --cwd packages/<pkg> test` for each touched package. (`typecheck:all`/`audit:vue` are NOT gates — `@nulo/faucet` typecheck is pre-existing-broken.)

**Validation depth is SELECTIVE (per the audits), not universal network-e2e** (deviates from the original "network-e2e per cycle" ask — surfaced as ratification item R1):
- Network-e2e gate ON for arcs that touch a runtime/config path it actually exercises: **Q7** (it changes the e2e configs themselves), **Q22** (wire-format on the RPC path).
- Network-e2e NOT gated for **Q16** (dead-code in `private` pkgs), **Q20** (pure CAIP functions, pinned by `caip.test.ts`), **Q14** (restore path — covered by the **smoke** full-backup import test). These gate on unit (+ smoke for Q14).
- **Caveat (codex):** Q20 (`packages/wallet-bridge/**`) and Q14 (`…/services/network/**`) match the network-e2e auto-trigger paths-filter (`pr-network-e2e.yml:40`), so CI may launch network-e2e on those PRs anyway. That's **advisory** for these arcs — a network-e2e red on Q16/Q20/Q14 does **NOT** block auto-merge; only the arc's gate-defined checks (Quality + the proven heavy check above) block.

**Ordering — cheapest/safest first:** Q16 → Q22 → Q20 → Q7 → Q14.

---

## Phase 1 — Q16: remove dead symbol-level surface  *(network-e2e: no)* ✓
**DONE** — re-verified each symbol's call-sites (incl. tests) before deleting; removed 2 dead modules+tests, `getRandomElement`, `dequeueBatch`, `getVersion`/`setVersion`/`findByPredicate`+their tests, the `@aztec/stdlib` dep (bun.lock synced), and the dead `ENCRYPTION_GUARD` index re-export. Gate: typecheck 0, lint 0, wallet-core/wallet-crypto/extension-messaging tests green. `LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-1.md`

Delete proven-dead exports/subpaths (all in `"private": true` pkgs, none auto-imported):
- `extension-messaging/src/lazy-listener.ts` + `subscribe-with-snapshot.ts` (zero importers; operation-journal references are *comments*, verified); `wallet-core` `utils/random.ts` `getRandomElement`, `utils/queue.ts` `Queue.dequeueBatch`, `storage/entity_storage.ts` `getVersion`/`setVersion`/`findByPredicate` (no prod callers); `wallet-crypto/package.json` unused `@aztec/stdlib` dep; `wallet-crypto/src/index.ts` dead `ENCRYPTION_GUARD` **index re-export only** (it's used internally in `password-secret-box.ts` — remove only the re-export).
- **Constraint:** do NOT touch the `ENCRYPTION_GUARD` canary tripwire test, `IllegalTransitionError`'s subpath export (operation-journal test consumes it), the `src/setup/*` vite entry, or any live export. Per-symbol removal, each gated by `! grep -rn "<symbol>" packages/*/src` (excluding the def + its test) + a test run.

**Validation gate** — `bun run lint` + typecheck+test for `wallet-core`, `extension-messaging`, `wallet-crypto` + per-symbol zero-importer grep. `bun.lock` updates for the `@aztec/stdlib` removal (frozen-lockfile-safe). Push → CI Quality. Auto-merge on Quality green. Layers: typecheck · lint · unit.

## Phase 2 — Q22: share the BigInt/Error replacer (constraint-bounded)  *(network-e2e: yes)*
`wallet-core/src/utils/serialization.ts` (bigint→`"123"`, Error→`{name,message,stack?,code?,details?}`) and `jobs/error.ts` (bigint→`"123n"`, Error→`{__error:true,…}`, truncation) duplicate overlapping logic. Extract a low-level replacer **only for the genuinely-common Error-shaping subset**.
- **Constraints:** `serialization.ts:1-4` mirrors `@aztec/foundation/json-rpc` — **wire shape frozen**; `jobs/error.ts` divergences (`"123n"`, `__error`, truncation) are **deliberate** — preserve; **the never-throw fallback at `jobs/error.ts:37` is load-bearing** (codex) — preserve + name it. `arrays.ts` untouched. Do NOT force one core across both.
- **Test fix (codex):** the real `jsonStringify` wire-pins live in **extension** `wallet/utils/serialization.test.ts` — keep green. `jobs/error.test.ts` does NOT currently pin `__error`/`"123n"`/never-throw → **add those pins** as part of this phase before refactoring. The never-throw pin must assert the **exact fallback envelope** emitted at `jobs/error.ts:37` (not merely "the function didn't throw").

**Validation gate** — `bun run lint` + typecheck+test for `wallet-core` + `bun run --cwd packages/extension test wallet/utils/serialization.test.ts` + the new `jobs/error.test.ts` pins green. Push → label `e2e:network` → CI Quality + network-e2e. Auto-merge when Quality green AND network shards ran+green. Layers: typecheck · lint · unit · network-e2e.

## Phase 3 — Q20: single-own the CAIP runtime helpers  *(network-e2e: no)*
**Corrected scope (audits):** the bridge **already owns the CAIP types** (`wallet-bridge/src/index.ts:11` exports them; the extension imports them via `dapp-interaction/spec` re-export). Only the **runtime functions** (`formatCaipChain`/`formatCaipAccount`/`parseCaipAccount`/`resolveNetworkByChainId`) are duplicated. Make the bridge the single owner of the functions; extension re-exports. Preserve the extension's extra `parseCaipChain`.
- **Constraint (registry #15):** ownership moves **downward** only (bridge ← extension). Add a small **parity test** (both sides produce identical output for a fixed vector) — codex. **There is NO "Used by: dispatcher" header to fix** (the original plan's instruction was wrong — neither `caip.ts` contains it).

**Validation gate** — `bun run lint` + typecheck+test for `wallet-bridge` + `extension` (`caip.test.ts` + the new parity test green). Push → CI Quality. Auto-merge on Quality green. Layers: typecheck · lint · unit.

## Phase 4 — Q7: de-fork the Vite/Vitest config sprawl  *(network-e2e: yes — it validates the change)*
`resolvePackageFile`, aliases, define blocks, e2e runner settings duplicated under "Keep in sync" comments across the configs — and **the sync already failed**: `vitest.e2e.all.config.ts` lacks the noir aliases + `retry`/`pool:"forks"`/`isolate` that `vitest.e2e.network.config.ts:17,43,44` has (verified live). Extract shared config helpers; compose wrappers via `mergeConfig`/factories; **fix the `e2e:all` drift**.
- **Constraint (registry #16):** the host-specific noir-alias comment travels with the shared helper. Browser wrappers must stop mutating the imported base in place. Diff resolved configs before/after to prove no unintended change.

**Validation gate** — `bun run lint` + `bun run --cwd packages/extension typecheck` + `bun run --cwd packages/extension test` + `bun run --cwd packages/extension build` + resolved-config diff. Push → label `e2e:network` → CI Quality + network-e2e (this is what proves the network config still resolves on CI). Auto-merge when Quality green AND network shards ran+green. Layers: typecheck · lint · unit · build · network-e2e.

## Phase 5 — Q14: extract the restore-result accumulation helper  *(network-e2e: no — smoke covers restore)*
**Re-scoped (audits): 14 files**, not 10 — config/account/contact/token/transaction/network/fpc/auth-registry/account-state/token-balance/**profile** services + the non-service `useFullBackupImport.ts`/`full-backup-helpers.ts`. `account-state` has **2** sites. Extract **only the per-item result/error accumulation helper**; per-service validation/locking/id-allocation stay as hooks (registry #11).
- **Carve-outs (audits):** `fpc/service.ts:485` pushes a **hardcoded** `restoreError: "Token FPC deprecated…"` (not err-derived) — the helper must not mangle it. `account-state` uses a **nested** shape (×2 sites).
- **R3 → NORMALIZE (user override at gate):** `contact/service.ts:290` stores the raw `err` object while the other 13 use `.message`. The user chose to **fix it here** — normalize contact to `err instanceof Error ? err.message : String(err)` so all 14 sites use the helper's normalized path (contact stops being a special case; the extraction gets cleaner). This is a **ratified behavior change** (`contact` `restoreError` shape: object → string). Add a test asserting the normalized shape. **Pre-check:** grep `tests/` + `tests/e2e/` for anything pinning the old raw-`err` contact shape and update it (the `contact/service.test.ts` restore assertion at `:227` likely needs flipping).

**Existing coverage is thin (codex):** `useFullBackupImport.test.ts` mocks every service client (no service-loop coverage); direct restore tests exist only for `contact/service.test.ts`, `network/service.test.ts`, `profile/service.integration.test.ts` (`account-state/service.test.ts` is sender-aggregation, NOT restore). **So this phase MUST add a targeted unit pin for every exceptional restore site it touches** — the helper itself (accumulate + error→`.message` path), the `fpc:485` hardcoded-string carve-out, the `account-state` nested ×2 shape, and the **now-normalized contact error shape (R3)** — not lean on the existing suite. Smoke is **orchestration-only** (its full-backup fixture is profile+network+account+token, `import-drivers.ts:236` — it does NOT exercise the 14-file surface).

**Validation gate** — `bun run lint` + `bun run --cwd packages/extension typecheck` + `bun run --cwd packages/extension test` (the NEW per-site pins above + each existing restore test green) + `bun run --cwd packages/extension build && bun run --cwd packages/extension test:e2e`. Push → CI Quality + smoke. **Auto-merge only when Quality green AND the smoke job is proven to have run (not skipped) + green.** Layers: typecheck · lint · unit · smoke-e2e.

---

## Assumptions
**Facts (re-verified this session against current `dev`):** Q21 checkers moved to `method-scope-checkers.ts` (#91) — `scope-enforcement.ts` now only `enforceScope`/`enforceScopeWithSession`/`validateAccountScopes`; Q14 = 14 files with `restoreError`; Q19 = 90 `getActiveProfile()` sites; Q20 types already bridge-owned (`wallet-bridge/src/index.ts:11`); Q7 drift live; Q22 `serialization.ts`↔`jobs/error.ts` independent (no cross-import); network-e2e reducer reports green-when-skipped (`pr-network-e2e.yml:222,244`); `e2e:network` label trigger (`:97`); faucet typecheck pre-existing-broken.
**Inferences (challenge):** (a) the 5 kept arcs are genuinely independent + ≤1-2d each post-re-scope; (b) selective network-e2e (Q7+Q22 only) + smoke (Q14) covers the "didn't break the app" intent without universal cost; (c) dropping Q21 is safe (#91 did the dedup; residual is small/different + its tests use broad regexes so re-doing it needs new pins — out of scope here); (d) `--admin` squash produces a GitHub-signed dev commit.
**Asks (ratify at gate):**
- **R1 (scope):** batch is now **5 arcs** (Q16/Q22/Q20/Q7/Q14). Confirm **dropping Q21** (mooted) and **demoting Q19** to its own plan — or insist on keeping them (Q19 then needs its own careful ~90-site classification phase, not a "quick win").
- **R2 (validation):** **selective** network-e2e (Q7+Q22) + smoke (Q14) + unit (Q16/Q20), vs your original "network-e2e per cycle" universal. Default: selective (audits: universal is wasted risk on a mid-de-flake suite).
- **R3 → RESOLVED (user @ gate): NORMALIZE** the contact raw-`err` to `.message` as part of Q14 (ratified behavior change; all 14 sites share the helper's normalized path).

## Security & Adversarial Considerations
- **Demoting Q19 removes the batch's biggest authz risk** (a mechanical `requireActiveProfile()` sweep misclassifying any of the ~37 deliberate non-throwers would silently weaken a lock gate or change a dapp-facing error contract — `background.ts:619` returns "Wallet is locked" to dapps). It belongs in its own plan with a full thrower/non-thrower classification.
- **Wire-format (Q22, Q20):** `serialization.ts` mirrors the `@aztec/foundation/json-rpc` wire shape; CAIP strings cross the dapp boundary. Preserve shapes verbatim (pinned by tests + the new parity test); ownership downward only. No interop/replay change.
- **Auto-merge `--admin`:** bypasses branch protection — scoped to this agent's own feature PRs with verified-green gates, never main/release. The green-when-skipped network-e2e hole is closed by requiring shard-execution proof.
- **Supply chain:** Q16 *removes* an unused dep (`@aztec/stdlib`) — reduction. No new deps, no crypto, no privilege surface.

## Decision ledger
| # | Decision | Source | Rationale / rejected alt |
|---|---|---|---|
| D1 | **Drop Q21** from the batch | both audits | PR #91 moved checkers to `method-scope-checkers.ts` + derived them; `scope-enforcement.ts` no longer holds the dup family; residual is small/different + its tests use broad `/Scope violation/` regexes (no exact-string pin). Re-doing it needs new pins — its own task, not a quick win. |
| D2 | **Demote Q19** to its own plan | both audits | 90 sites, ~37 deliberate non-throwers (codex named 4+ beyond the audit's 2). Mechanical sweep = authz risk + external-contract change. Not quick; highest risk. |
| D3 | **Keep per-arc (5 PRs)**, reject package-batching | both audits | Per-arc rollback clarity > batching, once network-e2e is selective. |
| D4 | **Selective network-e2e** (Q7+Q22), smoke for Q14, unit for Q16/Q20 | both audits | Universal network-e2e on a mid-de-flake suite is wasted risk for non-RPC arcs. Surfaced as R2 (deviates from the original ask). |
| D5 | **Harden auto-merge:** require network shards *ran* (not skipped-green) before `--admin` | codex | Reducer reports green-when-skipped (`pr-network-e2e.yml:222,244`). |
| D6 | **REVISED at gate → Q14 NORMALIZES the contact raw-`err` to `.message`** (user override of the audits' preserve-default) | user @ gate | Ratified behavior change (object→string); all 14 sites now share the helper's normalized path (contact stops being a carve-out). Pre-check tests for old-shape pins before flipping. |
| D7 | **Q22: add `jobs/error.test.ts` pins (`__error`/`"123n"`/never-throw) before refactoring** | codex | The wire shapes aren't currently pinned where the original plan claimed. |
| D8 | **Q20: corrected scope** (types already owned; dedup fns only; add parity test; no "Used by" header) | both audits | Original plan overstated the dup + cited nonexistent text. |
| D9 | Process: Fable 5 unavailable → fable audit slot = Claude `Plan` subagent | env constraint | Cross-family rigor preserved via codex. |
| D10 | **Process lesson:** drafted against the week-old audit snapshot; re-verification now baked as step 1 of every phase | the audits catching it | Don't trust a >1-week audit instance-list without re-grepping current `dev`. |
| D11 | Auto-merge proof-of-run covers **all** network jobs (shard + heavy + heavy-concurrent + canary) AND the smoke job; both reducers report green-when-skipped | codex final | Closes the phantom-green hole for both gate types. |
| D12 | Q14: smoke is **orchestration-only** (minimal fixture); add **targeted unit pins per touched restore site** (helper, fpc hardcoded, account-state nested ×2, contact BUG-PIN) — existing suite is thin | codex final | Backup-import test mocks the services; don't lean on it. |
| D13 | Q22: never-throw pin asserts the **exact fallback envelope** (`jobs/error.ts:37`), not "didn't throw" | codex final | Pins the load-bearing fallback shape. |
| D14 | Non-gated arcs (Q20, Q14) may auto-trigger network-e2e via paths-filter — **advisory there, doesn't block** | codex final | "Selective" is about the gate, not what CI happens to launch. |

**Audit verdicts (mid — dual audit + final pass):**
- **Claude-slot (fable substitute):** `reject` → 3 arcs scoped against a stale tree. RESOLVED: Q21 dropped, Q19 demoted, Q14/Q20 re-scoped.
- **Codex round 1:** `conditional approve` → re-scope Q19/Q21, expand Q22 pins, selective network-e2e + run-proof. RESOLVED: all folded (D1–D8).
- **Codex final pass:** `conditional approve` → 5 tightening conditions (Q14 smoke run-proof + thin coverage, all-network-jobs proof, Q22 exact envelope, non-gated advisory). RESOLVED: all folded (D11–D14). Net: ready for the gate.

## Competing outline (considered, rejected)
Package-batched (3 PRs: wallet-core Q16+Q22 / wallet-bridge Q20 / extension Q7+Q14). Rejected by both audits: it hides attribution + couples rollback without reducing real risk, once network-e2e is selective. Per-arc wins.

## Seeds (FINAL — approved 2026-06-18; scope 5 arcs, selective network-e2e, R3=normalize)

**Recommended — `/loop`** (multi-PR create→CI→auto-merge→advance):
```
/loop 15m Drive implementations-plan/quality-dedup-quick-wins forward, one arc per PR, in plan.md order (Q16→Q22→Q20→Q7→Q14). Never idle. Each firing: (1) read plan.md + lessons/ (authoritative); `git status`; `git log --oneline -5`; if a PR is open, `gh pr view <n> --json statusCheckRollup`. (2) CI in flight? Confirm progress (`gh run watch` up to 10m); use the wait to prep the next arc. (3) No arc in hand? Take the next pending phase: FIRST re-verify the arc against current dev (grep the cited symbols/sites — the audit snapshot is stale), then dedup + tests; run `bun run lint` + the touched packages' typecheck+test; commit → push; for network-gated arcs (Q7,Q22) add the `e2e:network` label. (4) Phase green = its plan.md gate passes (commands+criteria): for network-gated arcs confirm EVERY network execution job (Run/shard*, Run/heavy, Run/heavy/concurrent-confirm, Run/canary) ACTUALLY RAN (not skipped — the reducer reports green-when-skipped) and is green; for Q14 confirm the smoke job actually ran + green; then `gh pr merge <n> --squash --admin --delete-branch`, mark ✓ in plan.md, file lessons, print LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-N.md, advance to the next arc off freshly-merged dev. (5) Heavy check red? Re-run once; still red → STOP and surface (I judge flake-vs-real). Advisory network-e2e on non-gated arcs (Q16/Q20/Q14) does NOT block. (6) Stuck/decision? `/codex xhigh`, reach a defensible call, log it. Hard limits: never merge to main/release, never publish, never expand scope past plan.md (Q19/Q21 are OUT). (7) All 5 arcs ✓+merged? `/code-review max --fix` on the batch → codex xhigh post-impl audit → address high/critical → wrap-up + stop. Keep the ASCII checklist visible.
```

**Alternative — `/goal`:**
```
/goal All 5 phases (Q16,Q22,Q20,Q7,Q14) marked ✓ in implementations-plan/quality-dedup-quick-wins/plan.md, each backed by its plan.md validation gate reported green AND its PR squash-merged to dev (gh pr view shows MERGED); for each phase the agent printed LESSONS_FILE=implementations-plan/quality-dedup-quick-wins/lessons/phase-N.md; for network-gated arcs (Q7,Q22) the network execution jobs and for Q14 the smoke job are confirmed to have actually run (not skipped) before merge; `/code-review max --fix` + codex post-impl audit complete with high/critical addressed; `bun run lint` exit 0 in the transcript.
```
Use exactly ONE per session. Start in the permission/AFK mode you intend (auto-merge `--admin` needs no prompt-stall).
