# Codex audit transcripts — crash-truth fixes (deep tier)

Codex (gpt-5.6-sol, xhigh) planning session; four engagements so far; the
final fresh-context pass runs in a NEW session and is appended at the end.
Paths rewritten repo-relative.

## 1. Independent planning leg (summary)

Decided the five asks: (1) transport fork → (iii)-shaped but CAUSAL: the
liveness-gated single-shot rollback (await a new `nulo:liveness` write —
written after full service wiring — then explicitly reconnect the dedicated
profile client, then `deleteProfile` exactly once; ceiling only surfaces
`rollback-failed`); (2) fence → offscreen-only; `deleted(different-gen)`
capture emits `PXE_STORE_KEY_MISSING`; client guard
`provision.generation === captured`; (3) scenario-A retry strict AND the
control strict (empty summary); (4) consoleErrors blind spot → ledger; (5)
respawn tests → unit, not composition. 4-PR stack with per-PR gates;
`-t` filters for targeted e2e runs. Consolidation adopted (1)-(5) nearly
wholesale; the liveness design became Decision 1.

## 2. Contradiction check (resumed) — verdict: findings (5)

1. HIGH — inverse-stale marker: generations are UNORDERED; `deleted(G2)` +
   delayed G1 capture also receives the marker. D4 holds through the
   authority chain, but the Security section over-claimed "G1 captures are
   marker-less forever". → folded: marker-as-authority-REQUEST rewording +
   inverse-stale pin 6.
2. HIGH — equality guard vs the documented uncaptured-client contract →
   folded: capture-conditional guard + pin 9.
3. HIGH — prover-ON certification of the crash file is structurally
   impossible (rendezvous is proverless-only; file lacked the
   `@requires-proverless` marker → hang not refusal) → folded: control split
   into `pxe-fence-reimport.test.ts` (prover-capable, the prover-ON leg);
   crash file gains the marker (ledger row 9).
4. MODERATE — reopen the Ready-handshake → NOT adopted: every enumerated
   failure mode fails closed to the torn backstop; the independent fable
   enumeration conceded the same attack (ledger row 1).
5. MODERATE — dropped stack-top full local suite gate → ledgered as row 10
   (per-PR CI + cert campaign substitution; objection recorded).

## 3. Double audit (resumed) — verdict: reject (blocking findings)

1. CRITICAL — provider→provision authority race: the provision send can be
   arbitrarily delayed by the offscreen client's `onReady`, which may
   RECREATE the offscreen (lifecycle map reset — the pre-existing residual
   of concurrency audit HIGH #1); a concurrent delete + recreation lets a
   stale provision land on `unseen`. The plan's "stale capture never
   executes" invariant could not coexist with the open path. → folded:
   readiness-await → provider re-read → abort-on-change → send (window
   collapses to the A5-residual microtask); pin 10; ledger row 11.
2. HIGH — control-split fold incomplete (gates ran one file while claiming
   both; no file map; no no-false-skip assert; helper cross-import risk) →
   folded: PR-1 file map + shared-helper extraction + control-file contract
   assert + two-file gates across PR-1/2/3.
3. MEDIUM — capture guard must snapshot the POST-STAMP `args[0]`
   generation → folded into Decision 2 + pin 7 (auto-stamped, asserts no
   provision and no second original RPC).
4. Assumption attacks → folded: baseline wording ("next successful
   strictly-later write, whoever wrote the baseline"), crypto-erase nuance
   (inside-the-try; deleting fences on a dispose throw), neutral fence
   message, commit count. Phase-3 util fork → resolved to concurrent
   event+poll via `StorageArea.onChange` (ledger row 12).

## 4. Fold re-review, round 1 (resumed) — verdict: reject

Blocking: the folded ordering still re-entered readiness before send — both
provision and retry route through `super.request` → `ensureTransportReady` →
`onReady`, a SECOND readiness check after authority validation that can
recreate the offscreen. Required an already-ready send path (or pre-send
authority callback). Plus: single provider invocation + key zeroization
incl. abort paths; stale Components-touched line; liveness cleanup pin.
→ all folded (already-ready non-recreating sends; ordering pin counts
readiness invocations; pin 11; file-map fix; cleanup pin).

## 5. Fold re-review, round 2 (resumed) — verdict: conditional approve

Conditions (all folded): (1) the already-ready primitive must be
protected/internal on the offscreen client, reuse the complete request
machinery, no generic public readiness bypass; its file + unit test added to
the map (PR-2 now touches `packages/extension-messaging/src/offscreen/`);
(2) pin 11 extended to the provision/send-rejection path; base64
non-zeroizability acknowledged; (3) pin 10's "readiness once" scoped to the
recovery sequence. "No further security hole appears if the already-ready
capability remains narrowly internal."

## 6. Final fresh-context pass (NEW session) — verdict: conditional approve

Zero Critical. "I would not overturn row 1. Row 11's shape is right once its
actual atomic boundary is specified." Conditions (all folded):
1. HIGH — bypass concurrency: a readiness-bypass flag held across the request
   promise would let concurrent ordinary RPCs skip readiness → one-call
   synchronous bypass reset (or factored correlator core); pins 10b (+
   no-microtask wire assertion in pin 10).
2. MEDIUM — false premise corrected: readiness does NOT make recreation
   impossible (ensure can resolve mid-replace, the documented benign race);
   the enforced invariant is NO SUSPENSION from the provider's
   post-generation read through the sendMessage invocation — Decision 2
   rewritten to state exactly that.
3. MEDIUM — failure semantics: provision/retry send failures PROPAGATE AS
   THEMSELVES (current diagnostic behavior preserved; pin 10c) — the plan's
   earlier "abort → original error" wording corrected.
4. LOW — liveness wording: proves its WRITER completed startup; a validated
   inference, not a Port handshake; fail-closed rejection path pinned.

Assumption attack: Facts check out; Inferences appropriately E2E-gated; no
product decision remains.

## 7. PR-1 review (resumed) — reject → approve (1 fix round)

Findings: HIGH — both agent-contract tests checked `NULO_E2E_REQUIRE_CONFIG`,
which nothing sets (agent.sh exports `E2E_REQUIRE_SETUP=1`) — the no-false-skip
guard was inert through all seven evidence runs; MEDIUM — the post-finalize
unit pin was vacuous (no account-state slice in the fixture backup, so the
rejecting mock was never invoked; the chain-sync runner also contractually
records rather than throws). Both fixed in commit 3f27b4ab (live variable;
data-override slice surviving the remap + called-assertion + truthful
comment + finished-stage assert); codex verified and APPROVED. The
independent second-lens review (fable-role) converged on the same pin,
verdicted conditional-approve, and its three Lows were folded (honest
console-tap comment, skipIf-restoration notes, "across runs" qualifier).
