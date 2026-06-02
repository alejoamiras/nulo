# v3 follow-ups — execution-mutex queue cap (P1) + NO_FROM concurrency e2e (P2)

Status: **P1 shipped, P2 deferred** (deep-plan protocol, Tier B). Two deferred
findings from the v3 post-impl codex review
(`../dapp-interaction-lock-fix-v3/audit-codex-postimpl.md`).
Audit transcript: [`audit-codex.md`](audit-codex.md). Owner adopted the hybrid cap
(⭑ below) at the approval gate.

Owner's clarifying answers: P1 = cap all sendTx + reject overflow; P2 = full
both-confirm via funding fixture. **Codex audit upgraded P1's cap design** — see ⭑.

**Ship as two separate PRs** (codex + opus agree): P1 is a ready behavior/security
fix; P2 is spike-gated test-infra research. Don't couple them.

**P2 outcome — DEFERRED as a documented follow-up.** The spike found no
NO_FROM-compatible private call that reaches an active stage: the realistic
`transfer_public_to_private` candidate fails at the kernelless discovery sim
(`Cannot satisfy constraint 'self._is_some'`, selector 851827960) because
DefaultEntrypoint carries no account-contract context to authorize a user-account
transfer. Both the confirm test and the boundary fallback need an active stage, so
both are infeasible without new fixtures, and chasing the Noir constraint is
open-ended. The execution mutex is already e2e-proven on the STANDARD path (v3
`concurrent-sendtx-confirm`, merged) and the NO_FROM path reuses the byte-identical
`acquireExecutionSlot` integration (unit-tested + codex ship-it), so a
NO_FROM-specific e2e is largely redundant. Full investigation:
[`lessons/phase-5.md`](lessons/phase-5.md). The unused P2 playground scaffolding
(`pg-btn-sendTx-noFrom-private`) was reverted so the P1 PR ships clean.

---

## P1 — execution-mutex queue backpressure cap

### Done =
A `(profileId, chainId)` execution lane cannot accumulate unbounded pending
sendTx, **and no single dApp origin can monopolize the shared lane**. Overflow is
rejected with a structured, dApp-parseable error; the rejected request's journal
record is terminalized (never left stuck/invisible). Applies to every sendTx that
reaches `acquireExecutionSlot`.

### ⭑ Cap principal — THE decision (codex-driven, changes the owner's first answer)
The owner first chose a simple per-lane cap ("all sendTx, reject beyond N"). The
codex audit shows that's a **cross-origin griefing primitive**: the lane is shared
across all dApps on one profile+chain, so hostile dApp A filling it would turn
innocent dApp B's sendTx from a *delay* (today) into a hard *reject*. Recommended
instead — a **hybrid**, the smallest design that fixes the real threat:

- **Shared FIFO lane unchanged** (preserves mutex ordering + PXE chainGuard alignment).
- **Per-origin contribution cap** `N_origin` — each dApp origin can have at most
  `N_origin` pending in the lane. Keyed by the **canonical browser origin**
  (`ctx.origin` / the session's `dappMetadata.url`), threaded as a dedicated
  `originKey` — NOT `sessionId` (a hostile site reopens tabs to multiply a
  session-keyed quota) and NOT `LocalTxOrigin.name` (that's user-facing DISPLAY
  text, set inconsistently — `ctx.origin` on the dispatcher path but
  `dappMetadata.name` on the popup/silent paths — and spoofable). [codex-final]
- **Coarse total-lane cap** `N_total` — memory/backpressure ceiling across origins.
- Proposed: `N_origin = 8` (matches journal in-flight visibility), `N_total = 32`.

→ **Approval-gate decision:** adopt the hybrid (recommended) vs the simple per-lane
cap the owner first picked (only if cross-origin hard-fail is explicitly accepted).

### Design (assuming the hybrid)
**`ExecutionMutex`** — FIFO stays keyed by lane; cap accounting gains an origin dimension:
- `laneDepth: Map<laneKey, number>`, `originDepth: Map<\`${laneKey}|${originKey}\`, number>`.
- `acquire(laneKey, { signal?, originKey, maxOriginDepth, maxLaneDepth })`:
  atomically (before enqueue) reject with `ExecutionMutexCapacityError` if
  `laneDepth >= maxLaneDepth` OR `originDepth >= maxOriginDepth`. Else increment
  both + enqueue on `laneKey` as today. `originKey` is **REQUIRED** for P1 — every
  caller reaching `acquireExecutionSlot` is dApp `aztec_sendTx` (UI
  `send_transaction` doesn't use this path); a sentinel principal, not `undefined`,
  only if ever extended to non-dApp callers. [codex-final: avoids a conditional-
  decrement bug]
- Invariants (codex): increment ONLY after passing both caps; capacity-reject
  mutates nothing; `release` is the SOLE decrement path (decrements both,
  unconditionally — safe because `originKey` is required so both were incremented);
  idempotent via the existing flag.
- **Abort accounting → conservative over-count** (codex; reverses an earlier lean):
  keep the `prior.finally(release)` chaining. It can temporarily over-count (reject
  a request that would've fit) but **cannot bypass the cap or underflow**; it only
  persists until the current holder releases (if that's wedged, the lane's dead
  regardless). Immediate-decrement is rejected: a guard bug there becomes an
  under-count → `>N` admitted / counter corruption, the worse class.
- Cap stays a **soft** backpressure cap (atomic within one acquire; ±concurrency is fine).

**Reject plumbing:**
- New `TooManyPendingError extends WalletError` (`extension-messaging/errors.ts`),
  `CODE = "TOO_MANY_PENDING"`, message carries **no** origin/profile detail (no oracle).
- `error-envelope.ts`: `TooManyPendingError` → `{ code: -32005, message,
  data: { walletErrorCode: "TOO_MANY_PENDING" } }` (-32005 = JSON-RPC "Limit
  exceeded", closest standard bucket; EIP-1193 has none).
- `acquireExecutionSlot`: do the cap reject **before** registering the
  abort-controller + `beginExecutionWait` (fast reject, no heartbeat churn). On
  `ExecutionMutexCapacityError` → throw `TooManyPendingError`.
- **Journal terminalization (codex catch — silent-path bug):** the rejected
  request's `queuedJournalId` record must be explicitly transitioned to `failed`
  on the capacity-reject path. Relying on the background catch is WRONG: it only
  terminalizes records still at `queued`, but the **silent path fast-forwards
  `queued→pending` before execution**, so a capacity-reject there would leave a
  stuck `pending` card until reaper grace (~2 min) — user-visible + attacker-
  triggerable. Terminalize directly.

### Phases (P1) — its own PR
1. `ExecutionMutex`: lane+origin depth, dual cap, `ExecutionMutexCapacityError`.
   Unit tests (codex's matrix): reject beyond `N_origin` and beyond `N_total`;
   depth decrements on release; **middle-waiter abort, tail abort, repeated abort
   signal, reject-before-enqueue**; no-negative-depth / key-GC; uncapped calls
   unaffected; over-count releases on holder-release.
2. `TooManyPendingError` + `error-envelope` mapping + envelope unit test.
3. Wire caps into `acquireExecutionSlot`; cap-reject before controller
   registration; explicit `queuedJournalId` terminalization on BOTH the standard
   and NO_FROM acquire-reject paths (covers silent-path `pending`). Thread the
   canonical dApp origin (session origin / `dappMetadata.url`, NOT the display-name
   `origin.name`) as `originKey`: dapp-interaction layer → `executeOperations` →
   both send paths → `acquireExecutionSlot`.
4. Focused test of the reject path (capacity → `TooManyPendingError` → journal
   `failed` for BOTH popup-queued and silent-pending records).

---

## P2 — NO_FROM concurrency e2e (both confirm) — separate PR, spike-gated

### Done =
A reliable network e2e: two concurrent NO_FROM (DefaultEntrypoint, nonce-less)
sendTx, both approved, both **confirm (`ok`)** — the on-chain proof the mutex
serializes the nonce-less path.

### The reframed key unknown → SPIKE first (codex catch)
The blocker is NOT "sandbox flakiness." **DefaultEntrypoint supports exactly one
PRIVATE function**, and the playground's NO_FROM payload is
`transfer_public_to_public` — a *public* call — so NO_FROM rejects it outright
(that's why `tx-sendTx-noFrom` is lenient `["ok","error"]`; it's effectively
always-error). So the first spike question is **"what single private call do we
use?"** (e.g. `transfer_public_to_private` or another single private transfer —
`buildNoFrom` requires exactly one top-level private call), THEN whether deploy /
public balance / private-note state / authwit are sufficient for a deterministic
`ok`. **[codex-final]** A call being *accepted* by DefaultEntrypoint is weaker than
*deterministically confirms* — the private call can enqueue public work internally,
so the spike must verify the full end-to-end state prerequisites, not just the
function type.

### Phases (P2)
1. **SPIKE (timeboxed ~½ day).** Pick a single private call compatible with
   DefaultEntrypoint; iterate setup (deploy, balance, notes, authwit) until a
   *single* NO_FROM sendTx returns `ok` ≥3 runs straight. Likely needs a
   playground button for the private-call NO_FROM (or the test builds the exec
   directly). **Exit:** deterministic single-tx `ok`. If infeasible in the
   timebox → STOP, report, fall back to the boundary-only test. Does NOT block P1.
2. **Funding/setup fixture** encoding the spike recipe (reuse
   `mintPublicTokensForAccount` / `feeJuiceReady` / `tokenReady` patterns; cost in
   the fixture hookTimeout, not the test budget).
3. **`concurrent-sendtx-noFrom-confirm.test.ts`** (heavy job): two NO_FROM, approve
   both, assert both `ok` + distinct rows. Wire into `pr-network-e2e.yml` — fold
   into `network-e2e-heavy-concurrent`'s `test_files` (sequential with the standard
   confirm; ~4 proves/run, within the 30-min budget) + add to `exclude_files`.

---

## Security & Adversarial Considerations
- **P1 is the security deliverable** — but the cap itself must not become a
  cross-origin denial primitive. The hybrid (per-origin cap, origin-keyed) is the
  mitigation; pure per-lane is the vulnerability. Session-keying is bypassable.
- **No oracle:** the `-32005` reject message carries no origin/profile/account detail.
- **Counter integrity:** the conservative over-count cannot underflow or admit
  `>N`; the test matrix pins no-negative-depth + cap-not-bypassed under abort.
- **P2 is sandbox-only test infra** — test minter keys, no prod secrets, no egress
  beyond the local sandbox; sponsored-FPC salt via the existing env path.
- **Supply chain / crypto:** neither task adds a dependency or alters nonce/auth/crypto.

## Adopted / rejected (audit provenance)
- ADOPTED (codex): hybrid origin-scoped cap; origin-not-session keying; conservative
  over-count; silent-path journal terminalization; P2 "single private call" reframe.
- ADOPTED (opus pass, codex-agreed): split P1/P2; cap-reject before controller registration.
- REVERSED (opus→codex): abort accounting — opus first leaned immediate-decrement;
  codex's "under-count is the worse class" argument won → conservative over-count.
- ADOPTED (codex-final): `originKey` = canonical browser origin (`ctx.origin` /
  `dappMetadata.url`), NOT the display-name `origin.name`; `originKey` REQUIRED
  (not optional); spike must prove end-to-end confirm, not just DefaultEntrypoint
  acceptance.
- DECISION DEFERRED to owner: cap principal (hybrid vs simple per-lane).

## Open risks
- P1 cap-principal decision (the design fulcrum) — owner call at the gate.
- P2 spike feasibility — single-private-call NO_FROM may still need non-trivial
  setup; timebox + boundary fallback bound it.
