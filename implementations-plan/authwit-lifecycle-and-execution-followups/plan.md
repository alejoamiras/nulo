# authwit-lifecycle-and-execution-followups (v2 — post dual-audit)

Make the public-authwit lifecycle (grant → consume → revoke → registry toggle) testable — by machine (network e2e) and by hand (playground panel) — and land the execution follow-ups from PR #83. Tier: **mid**.

v1 was dual-audited (codex: reject, 2 blockers; fable: conditional approve, 7 conditions — transcripts in `audit-codex.md` / `audit-fable.md`). v2 adopts the converged findings; the decision ledger records every flip.

## Why now

- `revokeAuthwits` + `setRegistryEnabled` (`auth-registry/service.ts:93,149`) call `executeSendTransaction` directly with ZERO e2e coverage (execution-decomposition Ask A4; codex post-impl MED).
- Nothing in the repo CONSUMES an authwit, so revoke is unprovable. The playground's authwit section creates **private witnesses** only (`account.createAuthWit`) — today's "grants" never touch the registry the revoke/toggle settings act on (fable F13).
- Three cheap follow-ups from PR #83 + two audit-found gaps (anvil soft-skip; locked-wallet cancel pin).

## Approved scope (Phase 0 answers + audit deltas)

- Authwit: e2e + playground UI panel (manual surface).
- cancelJob ownership: silent no-op on **profile** mismatch (D2; accountAddress deliberately NOT checked — D6).
- Done bar: CI green incl. the new lifecycle e2e + one manual playground pass by the user. No RC ceremony.
- CI: new e2e joins the regular 5-way shards (noted as a ~6-prove file for shard balance — fable F11).

## Consumer shape: Outline B is now PRIMARY (ledger D1v2)

**Two-account canonical-token consumption.** Account A grants a public authwit naming account B as caller for `transfer_public_to_public(A, B, amount, nonce)` on the aztec-standards test token (the e2e's deployed token — `tests/e2e/fixtures/aztec.ts:23,99`; NOT "transfer_in_public", fable F4). B sends the transfer; the token's `_validate_from_public` consumes A's registry approval when `from != msg_sender` (verified from embedded artifact source by both auditors).

Why B beat A (v1's primary, the custom `AuthwitGate` Noir contract):
- A needed an **artifact-delivery story to the extension PXE** (codex blocker #2: known-artifacts are compiled in; playground registration sends instances without artifacts) — B uses the already-known token.
- A added committed transpiled artifacts — a reviewer-hostile supply-chain surface (codex #3 / fable F7) — B adds none.
- A needed the rc.2 Noir compile pipeline in a new package — B needs no Noir at all.
- Fable confirmed B proves the IDENTICAL on-chain lifecycle path (token → registry consume); A's only real edge is modeling contract-shaped consumers — recorded as a future arc (`AuthwitGate` with a proper artifact-delivery design), not a bail-out here.
- Multi-account e2e precedent exists: `createAccount` (`fixtures/helpers.ts:226`), `switchToAccount` (`:244`), `multi-account-from.test.ts` (v1's "thin support" claim was stale — fable).

## The irreducible new scope: emitting the grant (both audits' #1)

Nothing auto-injects public-authwit grants. The ONLY trigger is the `add_public_authwit` action inside a `send_transaction` operation (`tx-request-builder.ts:197-265`), an Azguard-shape action (`wallet-bridge/src/action.ts:33`) with **zero current users**; the planner maps dApp authwits to `add_private_authwit` only (`operation-planner.ts:178-188`). The playground speaks wallet-sdk (`aztec_sendTx`) which cannot express it. `trackAuthwit` (`service.ts:73`) — the thing that populates the revoke settings UI — fires only on this path.

**Phase 2 designs and lands this surface** (it gates everything): the playground gains a small wallet-bridge (Azguard-shape) client used ONLY by the authwit panel to send `send_transaction` with `[{ add_public_authwit: { consumer: token, innerHash } }]`, mirroring how the bridge dispatcher already accepts it. Permission-gating per action kind already exists (`dapp-interaction/service.ts:376-382`) — the e2e choreographs the approval popup like any sendTx. ALTERNATIVE if the bridge client proves awkward (recorded, pre-authorized): extend the Nulo schema patch with a custom grant RPC — but bridge-first, since the action path is the one real dApps would use.

## Single-use semantics drive the e2e script (fable F1 — the v1 plan was vacuous)

The canonical AuthRegistry **burns approvals on consume** (`consume` writes `false` after the check — embedded AuthRegistry source). Every lifecycle step therefore uses a FRESH grant (unique nonce), and the revoke negative test targets an **unconsumed** grant:

1. Grant G1 → consume OK (G1 burns). Settings now show the tracked-then-pruned state the wallet's `syncAuthwits` produces — assert the SYNC behavior, don't fight it.
2. Grant G2 → **revoke G2 via `RevokeAuthwitsPopup`** (testids added first) → consume attempt FAILS. G2 was never consumed → the failure proves REVOKE.
3. Grant G3 → **registry disable via `ChangeAuthwitsRegistryPopup`** → consume FAILS (`reject_all` checked before approvals — proves the TOGGLE) → re-enable → consume G3 OK (G3 survived untouched).
4. Cleanup: registry left ENABLED; all actions on a dedicated fresh account (never the shared minter) — on-chain residue inert (fable F11 / codex #6).
5. Phase-3 gate includes a **non-vacuity check**: step 2's failure message/state is asserted distinguishable from "already consumed" (e.g. by ALSO asserting G2 was consumable pre-revoke via `isAuthwitConsumable`).

Funding: the dedicated account receives minted tokens + uses sponsored-FPC fees; the file runs ~6 proven txs (noted for shard balance).

## Phases

### Phase 0 — Housekeeping + baselines (0.25d)
- Add missing `incoming-trust-state-machine-refactor` entry to `implementations-plan/index.md` (shipped PR #75).
- Pin CURRENT cancelJob accepts-any-id behavior as `(BUG PIN — replaced in Phase 1)` in `execution-lane.test.ts`.
- **Gate**: `bun run lint` exit 0; `bun run --cwd packages/extension vitest run src/wallet/services/execution/execution-lane.test.ts` green (lint · unit). (Gate commands cwd-explicit — fable F12.)

### Phase 1 — Execution follow-ups batch (0.5d) — FRONT-LOADED (fable F8: zero deps on authwit work; cheapest, pure-unit, immediate value)
- **cancelJob ownership**: lane loads `operationJournal.getOperation(id)`; `record.profileId !== activeProfile.id` → silent drop (identical to unknown-id). Pins: match cancels / mismatch drops / record-absent drops / **locked wallet (no active profile) drops** (fable F10a). accountAddress NOT checked — ledger D6.
- **`dapp_execute` start-path unification**: `beginDappExecuteJournal` moves into `ExecutionLane`; facade delegate + executor `beginJournal` wiring point at the lane. Zero behavior change; claim-helper/executor tests untouched.
- **Setup-gate hardening**: loud failure under `E2E_REQUIRE_SETUP=1` for BOTH ungated soft-skip paths — node-health (`global-setup.ts:375-384`) AND anvil-start (`:288-296`) (fable F5).
- **Gate**: `bun run lint` + `bun run test` exit 0 incl. new pins (lint · unit). Ships as its own commit block, PR-splittable if the arc stalls.

### Phase 2 — Grant-emission surface + playground panel (0.5-1d)
- Wallet-bridge client in the playground's authwit section (grant-only scope); panel: "grant public authwit" (consumer = test token, caller = account B, explicit amount/nonce — **hard-scoped to the fixture token**, codex #4) and "consume (transfer-from)" (switches/uses account B → `transfer_public_to_public(A, B, amount, nonce)` via normal wallet-sdk sendTx). Grant and consume are SEPARATE buttons — never bundled in one tx (fable F3).
- Prove the tracking link: after grant approval, the authwit appears in settings (`getAuthwits`) — unit/integration assert `trackAuthwit` fired.
- **Gate**: minimal consume-once e2e (`bun run e2e:agent tests/e2e/network/authwit-consume-smoke.test.ts`) green; lint + unit green (lint · unit · e2e-network). **Outline-A reconsideration point**: if the bridge-action path is unworkable here, STOP and surface — do not improvise scope (replaces v1's compile-attempts bail-out; fable F9).

### Phase 3 — Lifecycle e2e (0.5-1d)
- `tests/e2e/network/authwit-lifecycle.test.ts` per the single-use script above; testids added to both popups BEFORE the test (currently zero testids — verified); data-testid-only selectors; dedicated fresh account; cleanup re-enables registry.
- **Gate**: lifecycle file green ×2 consecutive locally; full `bun run e2e:agent` green; non-vacuity assertion present (e2e-network full).

### Phase 4 — Arc close (0.5d)
- `/code-review max --fix` (separate commit) → codex post-impl audit (net diff + code-review summary + plan + adversarial ask) → fix loop → docs (playground README authwit note) → single PR to dev → **user's manual playground pass** gates merge.
- **Gate**: PR CI green (Quality required; Network e2e shards incl. both new files); codex verdict with high/critical addressed.

## Security & Adversarial Considerations

- **Confused deputy (codex #4)**: the playground already holds broad capabilities; the new panel is hard-scoped — fixed fixture token, explicit caller/amount, no free-form consumer field on the grant button; the wallet's approval popup remains the trust boundary for every grant/consume/revoke/toggle tx.
- **cancelJob**: profile-scoped silent no-op; existence non-disclosure preserved (drop ≡ unknown-id). The messaging layer has no sender validation (`extension-messaging/src/background/service.ts:40-48`), so this check is the only guard — pinned accordingly. Same-profile cross-account cancel stays allowed by design (one human per profile) — D6.
- **On-chain residue**: dedicated fresh account; registry re-enabled in cleanup; approvals are per-account map entries — inert cross-test (both audits).
- **Supply chain**: ZERO new deps, zero committed artifacts (Outline B's structural win).
- **Crypto**: authwit hashing stays in aztec.js / account contracts; the inner-hash construction for the grant button reuses the existing playground callIntent helpers.

## Assumptions

### Facts (verified by main + re-verified by ≥1 auditor)
- Playground authwit section creates private witnesses only (93 lines; `sections/authwit.ts`); revoke/toggle popups exist with ZERO data-testids.
- `revokeAuthwits` `service.ts:93-143` (set_authorized false via `executeSendTransaction`); `setRegistryEnabled` `:149-170`; `trackAuthwit` `:73`; `syncAuthwits` prune via `isAuthwitConsumable` (`utils/auth-registry.ts:42-49`).
- `add_public_authwit` injection: `tx-request-builder.ts:197-265`, zero current users; planner emits `add_private_authwit` only (`operation-planner.ts:178-188`).
- AuthRegistry consume burns approvals; `reject_all` checked before approvals (embedded protocol-contract source).
- Test token = aztec-standards `TokenContract`, rc.2-compiled, with `transfer_public_to_public(from,to,amount,_nonce)`; `_validate_from_public` checks the registry when `from != msg_sender` (embedded source).
- Multi-account e2e precedent: `fixtures/helpers.ts:226,244`; `multi-account-from.test.ts`.
- Soft-skip paths: node-health `global-setup.ts:375-384` AND anvil `:288-296` ungated; binary/CLI/deploy paths gated.
- `getOperation` `operation-journal/service.ts:364`; `OperationRecord.profileId` `spec.ts:65`; current `cancelJob` checks nothing (`execution-lane.ts:111-140`).

### Inferences (remaining attack targets)
- The bridge dispatcher accepts `send_transaction` + `add_public_authwit` from the playground origin once permission-granted (the action kind is permission-gated at `dapp-interaction/service.ts:376-382`; full path untraveled — Phase 2's smoke gate is the proof point and the STOP point).
- The settings revoke targets exactly the tracked hash (revoke reuses the stored hash verbatim — `service.ts:101-121`; hash construction matches on-chain — fable verified inner/outer hash equality).
- A ~6-prove e2e file fits the regular shard budget without rebalancing (monitored at Phase 3's full-suite gate).

### Asks
- None open. (v1's silent asks were surfaced by the audits and resolved: single-use semantics → script redesign; grant-path design → Phase 2; token identity → aztec-standards; panel modes → separate buttons; funding → minted + sponsored-FPC; lockfile → moot under Outline B.)

## Decision ledger

| # | Decision | Source | Rejected alternative + why |
|---|---|---|---|
| D1v2 | **Outline B primary** (two-account canonical token); Outline A (AuthwitGate contract) → future arc | both audits | v1 had A primary; A carried 3 structural complications (PXE artifact delivery — codex blocker; committed artifacts — codex/fable; Noir pipeline) for zero extra lifecycle coverage (fable: identical on-chain path). A's dApp-shape value is real → recorded as future arc with an artifact-delivery design. |
| D2 | cancelJob silent no-op over explicit error | user (Phase 0) | Error shape leaks job-id existence. |
| D3 | (v1: fixture-contracts package) — MOOT under D1v2 | — | — |
| D4 | `beginDappExecuteJournal` moves into the lane | PR #83 follow-up | Two start paths = codex LOW finding. |
| D5 | Follow-ups FRONT-LOADED as Phase 1, PR-splittable | fable F8 | v1 held them hostage behind the riskiest phases. |
| D6 | Ownership check = profileId only; accountAddress NOT checked | main, vs codex #5 | Profile = the human boundary; same-profile cross-account cancel is the user cancelling their own job from another account view. Codex's "if IDs escape" concern is real but the escape vector is cross-PROFILE, which IS checked. Documented for the final pass to contest. |
| D7 | Grant emission via wallet-bridge action path, schema-patch RPC as recorded fallback | main + codex #1/fable F2 | Action path is what real dApps use; a custom RPC would test wallet-internal plumbing instead of the dApp surface. |
| D8 | v1's compile bail-out replaced by a Phase-2 STOP-and-surface gate | fable F9 | The deduced risks land at the consume smoke, not at compile (and B has no compile). |

## Audit verdicts

- **Fable (round 1, v1)**: conditional approve — 7 conditions, ALL adopted in v2 (single-use redesign; grant-path design; aztec-standards correction; bail-out window; anvil gate; lockfile [moot]; front-load Phase 4→1).
- **Codex (round 1, v1)**: reject — blockers #1 (grant path) and #2 (artifact delivery) both dissolved by v2 (Phase 2 design + Outline B flip). #3 artifacts (moot under B), #4 confused-deputy (hard-scoping adopted), #5 accountAddress (contested — D6), #6 residue (cleanup adopted).
- **Codex (final fresh-context pass, v2)**: _pending._

## Seeds (DRAFT — finalized post-approval)

```
/goal All phases 0-4 marked ✓ in implementations-plan/authwit-lifecycle-and-execution-followups/plan.md, each ✓ backed by its phase's validation gate (as written in plan.md) passing in the transcript; LESSONS_FILE=implementations-plan/authwit-lifecycle-and-execution-followups/lessons/phase-N.md printed per phase; /code-review max --fix applied + committed separately; codex post-impl audit complete with high/critical addressed; bun run lint and bun run test exit 0 in transcript; authwit-lifecycle.test.ts green inside a full e2e:agent run with the non-vacuity assertion present; single PR to dev opened (never merged autonomously); playground manual-pass instructions delivered in chat. Constraints: data-testid-only selectors; Phase-2 STOP-and-surface if the bridge action path is unworkable (never improvise scope); no scope beyond plan.md.
```

```
/loop 15m Drive implementations-plan/authwit-lifecycle-and-execution-followups forward. Never idle. Each firing: 1) read plan.md + lessons/ (authoritative), git status, git log -5; PR? gh pr view --json statusCheckRollup. 2) CI in flight: watch up to 10 min, prep next phase meanwhile. 3) No task? Next pending phase step (edit → bun run lint → bun run test → e2e:agent per the phase gate → commit). 4) Stuck or non-trivial decision? /codex xhigh, decide together, log in lessons/. Hard limits: never merge to dev/main, never publish, no scope beyond plan.md; Phase-2 unworkable → STOP and surface to me. 5) Same step failed 5×? Stop, reassess with codex. 6) Phase gate green (as WRITTEN in plan.md)? Mark ✓, lessons entry, print LESSONS_FILE=..., advance. 7) All ✓? /code-review max --fix → separate commit → codex post-impl audit → fix loop → PR to dev → manual-pass instructions in chat → wrap-up with contentious decisions ELI5'd → stop.
```
