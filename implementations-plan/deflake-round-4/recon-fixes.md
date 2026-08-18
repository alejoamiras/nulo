# Recon — crash-truth fixes (phase 0.4, deep tier)

Four read-only scouts over the fix surfaces. Feeds fix-plan.md and every audit:
auditors must check the design against this reuse map.

## A. PXE fence surface (packages/aztec-runtime)

**Bug confirmed one-sided.** `assertGenerationCurrent` (pxe/service.ts:797-807)
special-cases only `kind === "live"`; `deleting` AND `deleted` (any generation)
collapse into one unconditional throw that deliberately omits the
`PXE_STORE_KEY_MISSING` marker. `provisionChainStoreKey` (service.ts:725-756)
already implements the intended asymmetric allow (`deleted(different-gen)` →
install; only deleted-same-gen and live-different-gen reject). The fix locus is
`assertGenerationCurrent` ALONE — do not touch provision.

**Key mechanism insight (changes the fix shape).** The clear flow crypto-erases
the store key at `deleting` time (`storeKeys.delete`, service.ts:686). So a
`deleted(different-gen)` capture that FALLS THROUGH the fence reaches
`registry.ensure` (service.ts:840/886), whose factory throws the
`PXE_STORE_KEY_MISSING`-marked error naturally (chain-runtime.ts:145) — the
client's once-only retry (client.ts:153-168) then provisions via
`storeKeyProvider` and retries. No new marker-throwing branch needed; the fence
just needs to fence ONLY: `deleting` (any gen) and `current.gen === captured`
(replay of the erased incarnation). Doc comment at service.ts:789-796 must be
updated to describe the deleted(different-gen) pass-through.

**G2→G3 race is already safe under this shape**: the client stamps the capture
once (client.ts:124-152; stamp-once proven by client-capture.test.ts:63-79) and
the retry reuses the ORIGINAL capture. If the provider provisions G3 while the
op captured G2, the service goes `live(G3)` and the retried G2 op hits the
live-mismatch branch → fenced without marker (correct). The earlier
"provision.generation === captured" refinement is therefore NOT needed at the
provision layer — verify in audits.

**Lifecycle surface map**: state maps service.ts:145,161; writes 675 (deleting),
686 (key erase), 710 (deleted), 754-755 (live+install); reads 662-672
(clearProfileState guards), 744-753 (provision gate), 797-807 (op fence), 840/886
(storeKeys.get → ensure). Fence call sites: withPxeRead:825, withPxeWrite:877 —
gates EVERY pxe op (10 read ops + 11 write ops enumerated in the scout report).
Marker: constant chain-runtime.ts:16, thrown chain-runtime.ts:145, client match
client.ts:158 (plain substring), log classification service.ts:859-866.

**Client retry mechanics**: once-only try/catch; guard = not provision itself +
marker substring + profileId + storeKeyProvider (client.ts:158). A provisioning
failure replaces the original error as caller-visible. Generation provider
absent → fail-fast pre-send (client.ts:147-149).

**Existing tests + the gap**:
- incarnation-fence.test.ts — the D4 matrix. Pins provision buckets (72-142),
  purge epochs (144-173), and "old-gen op rejected while successor live"
  (175-191). MISSING: "fresh-gen op arrives while `deleted(old-gen)`, fresh gen
  NOT yet provisioned" — exactly the bug. Fixtures `makeService`/`net(gen)`
  (23-54) reusable as-is.
- client-capture.test.ts — stamp-once + marker-retry with a FABRICATED marker
  error (66); never exercises a non-marker rejection. Harness `makeClient` +
  transport stub (19-45) reusable.
- service.test.ts — op-failure log classification stubs the runtime factory;
  no lifecycle overlap.
- NO test composes client↔service end-to-end — why the bug escaped. Both sides
  pass locally-correct contracts that don't compose.

**Collision risks**: three SEPARATE resurrection guards — profileLifecycles (D4,
per-profile generation), chainPurgeEpochs (per-chain epoch, service.ts:131-137,
"MED #4"), clearProfileState's own gen-mismatch guard (667-671). Do not merge or
generalize. `#281 D4` comments (chain-runtime.ts:61; service.ts:147,731,789;
client.ts:75,132; spec.ts:111,118) are the SPEC the fix must satisfy.
mintPxeGeneration + provider wiring live SW-side (apps/extension) and are
correct — the bug is contained in assertGenerationCurrent.

## B. Messaging client surface (packages/extension-messaging)

**No Port-side handshake exists.** service.ts:37-52 `onConnect` authenticates the
sender (F-09) and registers — it sends NOTHING back. `ClientState.Connected`
means "a Port object exists" (chrome.runtime.connect returns one synchronously
with no live worker); `ensureTransportReady` (client.ts:102-112) returns void the
instant state===Connected. base-service.ts has an `initialized` gate but it is
never surfaced over the wire.

**Shipped precedent for queue-behind-liveness (candidate i)**: the OFFSCREEN
sibling transport — `onReady()` overridable pre-request hook
(offscreen/client.ts:87-101) + `ensureOffscreenRunning()` single-flight with a
real ping/pong health probe (apps/extension/src/wallet/utils/offscreen.ts:283+,
123-140). No SW-ping equivalent exists today; building one is new infra.

**Fast-rejection reliers (the case AGAINST a blanket queue)**:
- fire-and-forget LoggerServiceClient.log from the offscreen console sniffer
  (offscreen/index.ts:36-43) — expects fast reject, swallowed by
  `isBenignSwDisconnect` (apps/extension/src/offscreen/is-benign-sw-disconnect.ts:23
  — NOTE: hardcodes "Client disconnected" instead of importing the constant;
  drift risk if the message contract changes).
- app.vue account-switch syncTransactions (per the e2e fixture comment
  extension.ts:171-178); e2e filters match the exact string.
- **External dApp contract**: wallet-sdk/error-envelope.ts:61-73 maps
  RpcDisconnectedError → transient retry-safe (-32603 + RPC_DISCONNECTED,
  deliberately NOT 4900). Fix must preserve retry-ability semantics.
- Queuing new calls silently converts today's fast benign noise into 60s hangs
  (DEFAULT_RPC_TIMEOUT_MS) unless the handshake resolves within the respawn
  window.

**Caller-level bounded-retry house precedent (candidate iii)**:
apps/extension/src/composables/importPreflight.ts:1-40 — per-attempt 5s timeout,
backoff [2000,4000], absolute shared deadline, explicitly commented for an
unresponsive SW. The existing template for a narrow flow-local retry.

**Test placement**: composition layer is the WRONG home (COMPOSITION-TESTS.md
D1-D6 govern the wallet service graph, not the wire). Home =
packages/extension-messaging client.test.ts (describe "port onDisconnect →
reconnect", L470-516 already pins churn basics) using
src/testing/transport-harness.ts — which needs ONE new primitive: a doomed-port
fake (mockClientPort L63-116 always attaches a live listener; leaving
connectServiceClient un-invoked simulates the respawn gap).

**Conventions/collisions**: next AUDIT letter+digit comment convention,
cross-linked to errors.ts; any NEW lifecycle EventHandler must be added to
`reservedEventNames` (client.ts:37, hardening.test.ts:156-164) or it becomes a
forgeable-event surface; every terminal path goes through settle()
(base-client.ts:230-246), never direct resolve/reject; PRESERVE the
synchronous-send fast path for steady-state Connected (client.ts:102-112 +
base-client.ts:104-110); connect() reentrancy is only guarded by the state
enum — a new Handshaking phase must gate the same way.

## C. SW-side provisioning + deletion wiring (apps/extension)

**Provider authority is already correct and race-hardened**: runtime.ts:214-229
registers the store-key provider against ProfileService — reads the row's LIVE
pxeGeneration under the facade lock (undefined if deletion-reserved), derives
via HKDF, then RE-READS the generation and refuses to provision on mismatch
(the delete+same-id-reimport-mid-derivation race, comment runtime.ts:221-224).
A cheap generation-only provider (runtime.ts:232) stamps every op's capture.

**Provisioning is 100% lazy BY DESIGN**: zero call sites of
provisionChainStoreKey outside the client's missing-key retry. The first PXE op
after import/unlock (execution registerAccount, incoming-transfer scheduler,
balance refresh) is the provisioning trigger. ⇒ open ask #2 resolves:
fence fix is OFFSCREEN-ONLY; no SW-side eagerness needed — the fall-through
makes the existing designed channel reachable.

**Deletion flow**: deleteProfile three-phase (service.ts:887-944; tombstone
carries pxeGeneration; coordinator purges roots then clearProfileState LAST with
the tombstone-carried generation, coordinator.ts:120); tombstone-resume replays
idempotently (service.ts:947-980). Offscreen clearProfileState: different-gen
lifecycle entry → reject (protects live successor); deleting marked sync;
key crypto-erased; deleted(gen) retained FOREVER — which is why a re-imported
profile never sees `unseen` again in that offscreen lifetime (the bug's root).

**Fix options framed**: (a) fence passes deleted(different-gen) through →
registry.ensure throws the REAL PXE_STORE_KEY_MISSING (storeKeys was erased at
clear) → existing marker/telemetry/debug-classification path reused, client
retry provisions; (b) fence throws a NEW provision-required marker + client gate
extension — second string to keep in sync, collides with the
incarnation-fence.test.ts:175-191 "NOT the missing-key marker" assertion for the
same-gen case. Recon leans (a): one extra in-op round trip, zero new contract
surface.

**Existing test gap** (same finding as scout A): service.integration.test.ts
covers deletion lifecycle but stops at the ProfileService boundary (PXE mocked);
incarnation-fence.test.ts:175-191 pins old-gen-rejected-while-successor-live but
NOT fresh-gen-while-deleted(old)-unprovisioned. client-capture.test.ts:63-79
pins retry-reuses-original-capture (must not break — it is what makes the
eventual real-stale rejection work).

## D. Delivery + ledger mechanics

**Skip convention** for PR-1: unconditional skips carry a `// SKIP —` block
stating MEASURED reasons + a backticked lessons citation (exact model:
sw-resilience.test.ts:169, citing "(deflake-round-3 `lessons/phase-3.md`)").
`skipIf(boolean)` is for environment gates only. FIX-side convention exists too
("// LEDGER ENTRY 1 (e2e-deflake) FIX:", backup-roundtrip.test.ts:148).

**The ledger** = implementations-plan/e2e-deflake/flake-ledger.md. Entries to
close (exact locations): the importFullBackup-300s OPEN pair (table row :349,
prose :351-369 — its settled design was "expose a restoreStage ref advancing at
real stage boundaries", WHICH ROUND 4 ALREADY BUILT; close-out reshapes it to
this outcome) and the two-tests-broken-primitive entry (:394-399 — this test
drops off; frozen-account-canary stage 5 remains). Round-4 plan.md:196-198
already names both for closure. Ledger format: dated top-level section, CLOSED/
OPEN subsections, bold headline claim + evidence + disposition tag.

**e2e-testing skill**: single SKILL.md; new durable lessons append as a dated
`## Deflake-round-4 lessons (…)` section at EOF (no round-3/4 section exists
yet). Wait-taxonomy lives in the ledger, cross-referenced not duplicated.

**index.md**: format `- [plan](plan/plan.md) — status — hook`; deflake-round-4
has NO entry yet — add it during the stack.

**Round-4 plan.md drift**: its Delivery section still says "One PR" — fix-plan.md
supersedes it for delivery; add a pointer note in plan.md during PR-1/PR-4.

**gh stack precedent**: extension v0.1.0 installed; verified working on this repo
in fee-estimation-speedup/lessons/phase-0.md (init/add/submit/sync/view/unstack;
recorded stack-vs-chained-PRs fallback as acceptable). Round-3 used classic
sequential PRs — this arc is the repo's first production gh stack use.
PR-mapping convention: one explicit line in the plan (single-sim-estimates
plan.md:88 model), including inter-PR merge-gating conditions.

**Branch state**: deflake-r4/crash-truth = 17 commits ahead of dev, tree clean.
