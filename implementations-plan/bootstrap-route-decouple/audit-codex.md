# Codex audits — bootstrap-route-decouple

## Round 1 (2026-08-12, gpt-5.6-sol xhigh, fresh context, read-only)

Session: 019ff68b-866a-7e83-94d4-3e88cd1f13b5. Scope: plan.md + recon.md, standard packet,
owner UX settled. Full response retained at the session's CODEX_DIR.

**Verdict: reject** (blocking: skip errors are dropped; the marker clears before the restore is
actually terminal; popup-only races abandon unbounded attacker-amplified SW/offscreen work).

### Findings + dispositions (adopted-vs-rejected log)

**C1 — Synthetic skip records silently discarded** (collector reads per-sender/per-contract
`restoreError` only, `full-backup-helpers.ts:79`; also throw-risk on malformed items):
**ADOPTED** (= fable High-1). Skip records become a bounded explicit variant
`{networkId, restoreError, senders: [], contracts: []}` — never spreading attacker items;
`collectRestoreErrors` gains a presence-guarded top-level account-state check (also fixes the
latent `account-state/service.ts:227-235` vanishing malformed-item bug); unit pins: skips flip
`isRestoreHasErrors`, Continue wins over auto-route, malformed items don't throw.

**C2 — Marker cleared at finalize leaves the post-finalize account-state leg undetected**:
**ADOPTED as option (b)** (codex's own alternative): the marker's guarantee is explicitly
NARROWED to storage-slice restoration ([restore-start → finalize-entry]); the post-finalize
chain-registration leg is bounded + user-visible (Continue gate) but NOT crash-durable —
surfaced as a new owner Ask. Option (a) (generation-bound completeRestore machinery) rejected:
it recreates the durable-deferral arc the owner rejected. Combined with fable Medium-3, the
marker clears at finalizeRestore ENTRY (the call itself proves slices complete), so
finalize-throw survivors keep their documented unlock recovery (no false positive).

**C3 — runExclusive is not durable atomicity**: **ADOPTED**. Marker-before-row ordering with
compensation on row-write failure; marker value binds {profileId, pxeGeneration}; markers with
no matching profile row or generation mismatch are ignored/purged; cleared on live deletion AND
crash-resume deletion cleanup; BOTH restore branches (password + passkey — fable High-2);
service tests pin every crash boundary.

**H4 — Shape A bounds popup patience, not system work → demand Shape B+ with real AbortSignal
through the node-fetch boundary**: **PARTIALLY ADOPTED / plumbing REJECTED for this arc.**
Adopted: input caps + dedupe + probe semaphore (H6), preflight-gating (unreachable networks are
never dialed at all), and a service-local signature-unchanged fail-fast inside
`AccountStateService.restore` (after a connectivity-class failure on a network, skip its
remaining items — fable's A-compatible refinement). With caps, abandoned work is a small
constant (≤ caps × the transports' own self-terminating envelopes), not unbounded. Full
deadline/cancellation plumbing through SW/offscreen/node is a separate infra arc → ledger
follow-up + owner Ask. Codex itself concedes plain Shape B "would not fix this".

**H5 — InvalidChain must not count as reachable**: **ADOPTED** (overrides fable Low-8's
"acceptable conscious choice"). Only `Active` proceeds; `InvalidChain` → per-item
"wrong network" failure through the Continue gate.

**H6 — Attacker-controlled slice: unbounded fan-out/memory**: **ADOPTED**. Zod validation +
normalization of the account-state slice at the SW restore entry (null-safe items, deduped
networkIds, caps on networks/items/senders/contracts, bounded strings); probe semaphore;
constant-size log summaries.

**H7 — Unlock-only detection gaps + unreachable surface**: **ADOPTED, with a simplification
that shrinks bundled item 3**: the check moves to `openSessionVerified` entry (single locked
chokepoint — safe now that finalize-entry clearing removes the import false-positive) + the
`SessionManager.restore` rehydration callback (defense-in-depth); detection yields a typed
`RestoreTornError` unlock outcome rendered ON the auth screen (message + the existing
Delete-profile affordance) — the barrier component, blocked-record repository, and second
storage root are DROPPED (codex proved the barrier was unreachable: withheld user sits on auth,
which the barrier exempts). Precedence: torn check runs before the integrity delegate;
fail-closed (no record write required — the marker read decides).

**M8 — 66s is not a proof**: **ADOPTED**. Relabeled a modeled envelope; Phase 1 records
measured timings; ONE absolute deadline (`importChainSyncDeadline`) is passed so preflight +
registration share a total budget and later steps get only the remainder.

**M9 — Inference 5 unsupported (fresh account creation does NOT register the contract with
PXE, `account/service.ts:150`; export arrays may be empty)**: **ADOPTED**. Phase 1 becomes a
BLOCKING gate: decrypt + inspect the exact smoke-exported backup, assert the account-state
slice content, reproduce the stall with the REAL exported backup against a controlled endpoint;
if the account-state leg is NOT the stall, STOP and reassess (root-cause attribution shifts).

**M10 — The e2e pair only exercises the preflight-skip path**: **ADOPTED**. Third stateful
variant: answers the preflight probe correctly, then blackholes the registration boot call
(method-discriminating stub); 127.0.0.1 bind, socket tracking + finally-close, per-test
`retry: 0`, assert account-state engagement before submit.

**M11 — Gates not faithful**: **ADOPTED**. `bun run --cwd apps/extension test:components`;
Phase 5 pre-push = full armed smoke + FULL `NULO_E2E_RETRY=0 bun run e2e:agent` SOLO (the
deflake protocol); targeted network files move to the Phase 4 gate as diagnostics.

**M12 — Failure emits must carry complete TokenBalanceInfo** (TokensView replaces rows from
the event payload; five listeners — fable Medium-6): **ADOPTED**. Re-read live row before the
failure write; don't resurrect deleted rows; emit the full updated value; sweep all five
listeners incl. `tokens/[id].vue` rendering.

**M13 — Explicit lock-race tests at the new waits**: **ADOPTED**. Lock during preflight /
during registration race / at Continue click: no route advance, no session resurrection,
`needs-unlock` authoritative.

**L14 — Persisted error size/privacy**: **ADOPTED**. `syncFailure.message` bounded/truncated
normalized text; full diagnostics transient-only.

**Hidden Asks surfaced** → folded into plan Asks 4-7 (marker-guarantee scope; cancellation
plumbing deferred; cap values; integrity-vs-torn precedence — resolved by ordering, stated).

### Cross-auditor dispute resolutions (recorded)

- InvalidChain classification: codex H5 adopted over fable L8.
- Marker chokepoint: fable said "NOT openSessionVerified" (import false-positive); codex said
  openSessionVerified + rehydration. RESOLVED by finalize-ENTRY clearing, which removes the
  false-positive and lets the single chokepoint stand (+ rehydration callback).
- Marker coverage: fable M3 (false positive → narrow/clear earlier) vs codex C2 (clears too
  early → covers too little). RESOLVED: entry-clear + explicitly narrowed guarantee + owner Ask.

## Round 2 — final fresh-context pass

*(pending — runs on the consolidated plan + this decision trail)*

## Round 2 — final fresh-context pass (2026-08-12, gpt-5.6-sol xhigh, fresh)

Session: 019ff6a0-a7d2-7613-8c18-656d3d83c282. Saw the consolidated plan + both round-1 audit
records + recon.

**Verdict: reject** (blocking: uncancelled preflight amplification and contradictory budget
semantics; RestoreTornError lacks a viable RPC and rehydration contract).

### Findings + dispositions

**H1 — preflight is UI-bounded but amplifies uncancelled SW work; budget claims contradictory**
(withTimeout doesn't cancel; each probe retains the 60s×4 envelope → up to 24 abandoned probes;
refused path can eat the full 21s because a 5s wrapper races the retry backoff; a stateful
8-network backup can traverse ~12min of sequential 90s offscreen calls post-abandonment; the
21s/30s/45s/51s numbers weren't one implementable model): **ADOPTED in full** — new
`probeChainId(rpcUrl, timeoutMs)` port+adapter+fake method (single non-retrying attempt,
AbortController fires at the boundary — codex-endorsed LOCAL cancellation, not the rejected
plumbing) exposed as `NetworkService.probeNodeStatus`; explicit deadline arithmetic
(`deadlineAt = tailStart + 45s`; preflight ≤ min(21s, remainder); registration =
min(30s, remainder)); additive zod-validated `deadlineMs` param on the registration RPC so the
SERVICE stops launching items at the deadline; probes only networks with ≥1 registrable
sender/contract post-normalization (empty child arrays ⇒ zero probes).

**H2 — RestoreTornError flattens across the RPC boundary; rehydration throw aborts service
init**: **ADOPTED in full** — registered `WalletError` subclass in
`packages/extension-messaging/src/errors.ts` + reconstruction switch + round-trip transport
test; the `SessionManager.restore` lookup returns `undefined` on a marker (silent session
close) instead of throwing (`session-manager.ts:341` doesn't catch).

**M1 — Phase 1 isolation gaps**: **ADOPTED** — checksum-recompute doctoring documented;
negative control (same backup minus account-state must complete against the same dead
endpoint); stub logs observed JSON-RPC methods; empty-child-arrays = falsification.

**M2 — e2e causal/timeout assertions**: **ADOPTED** — stateful stub must answer `getNodeInfo`,
observe `getL1ContractAddresses`, then blackhole (method-sequence assertion); the smoke
Continue branch consumes the REMAINDER of one `submittedAt + 90_000` deadline (a fresh
post-click wait would silently raise the bound).

**M3 — cap normalization underspecified**: **ADOPTED** — ONE pure shared normalizer
(merge-by-networkId first; aggregate per-network caps; item-count + total-bytes caps; networks
argument validated; fixed-size excess summary).

**M4 — marker corruption + entry-clear edges**: **ADOPTED** — undecodable-but-present marker
fails CLOSED (tombstone existence precedent); explicit test list (double-finalize, non-restored
finalize, wrong-id finalize, post-entry-clear unlock failures, corrupt marker,
generation-mismatch purge, rehydration-close without init failure).

**L1 — Phase 6 docs had no delivery path post-merge**: **ADOPTED** — ledger + skill updates
ride the pre-merge post-cert docs-only commit (deflake precedent).

**L2 — stale "RPC-bound syncTransactions" comment in the smoke test**: **ADOPTED** — corrected
with the wait change.

**Resolved-correctly list** (round-1 folds verified by the fresh pass): skip variant reaches
the Continue gate; marker mechanics internally coherent; integrity-delegate precedence by
ordering; Active-only GO + InvalidChain failure; stateful e2e design sound once
method-sequenced; gates + certification faithful; token-balance event-consumer concern
addressed.

## Round 3 — resumed re-verdict

*(pending)*

## Round 3 — resumed re-verdict (same session)

**Verdict: reject** (one blocking: enforce the service deadline before EVERY sender/contract
offscreen launch, not only before each outer network item; pin the slow-success case).
Findings + dispositions:
- **H (per-launch deadline)**: ADOPTED verbatim — absolute deadline at entry, checked before
  every `registerSender`/`registerContract` launch (one network can hold 96 registrations,
  `account-state/service.ts:236,250`); `deadlineMs` clamped 0…30_000; slow-success-crossing-
  deadline service test pinned in Phase 2.
- **L (arithmetic)**: ADOPTED — table ≤~60s (storage ≤15s + shared 45s tail); marker window ≤45s.
- **L (Shape B reframe)**: ADOPTED — rejected design = SW-ONLY/cancellation; the additive
  `deadlineMs` argument is acknowledged as adopted.
- **L (RPC surface + wording)**: ADOPTED — file map covers `network/{service,spec,client}.ts`;
  Phase 2 repeats the `getNodeInfo → getL1ContractAddresses → blackhole` sequence assertion.
Resolved-correctly (round-2 folds verified): bounded probe; typed-error transport +
non-throwing rehydration; Phase-1 negative control; stateful e2e causal design; single 90s
smoke deadline; shared normalizer + aggregate caps; corrupt-marker fail-closed + edge tests;
skip-record collector/settled-append; Phase-5 docs delivery.

## Round 4 — resumed re-verdict on the round-3 folds

*(pending)*

## Round 4 — resumed re-verdict (same session)

**Verdict: conditional approve** (condition: rewrite plan.md's stale "restore RPC signature is
unchanged" in the Competing outline — the chosen design adds `deadlineMs`). **APPLIED** same
session (Shape A pros now name the one additive clamped argument and the untouched trust-gate/
rollback semantics). No further implementation-level blocker remains — audit loop complete.
