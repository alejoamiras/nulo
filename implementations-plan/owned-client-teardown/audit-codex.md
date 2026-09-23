# Codex audits — owned-client-teardown

GPT-6 Astra at `high`, read-only, via the codex skill's `run-codex.sh`. Both rounds are verbatim
responses; file links were rewritten to repo-relative paths.

## Round 1 — plan v1 (dual audit, alongside `audit-fable.md`)

conditional approve (with conditions: fix test isolation, strengthen the port-count proof, and correct the e2e execution and cleanup gates).
design pick: lead — document-scoped sharing fixes the observed growth without introducing logger ownership and asynchronous draining into every client’s reconnect state machine.

Confidence: **high** on source findings; **moderate** on runtime/bundling conclusions. Inspection only; no tests, builds, installs, or e2e configurations executed.

1. **[High] The singleton changes existing tests’ lifetime assumptions.**  
   `apps/extension/tests/vitest.setup.ts:88` replaces Chrome before each test; `:116` clears listeners afterward. Meanwhile, `apps/extension/src/wallet/services/profile/client.test.ts:14` statically imports its client and constructs another at `:54`. After sharing, subsequent cases reuse a logger still marked Connected to the previous test’s fake port. Logging can silently disappear into that stale mock while requests accumulate timers.

   **Smallest fix:** explicitly mock `forDocument()` in unrelated client tests; isolate the real logger tests with dynamic imports and complete transport cleanup. Merely adapting the two named logger tests is insufficient. `vi.resetModules()` is sound only when all relevant runtime imports follow the reset; it neither disposes old instances nor clears registered mocks (`apps/extension/node_modules/vitest/dist/index.d.ts:603`).

2. **[Med] The proposed proof needs positive delivery and settlement assertions.**  
   Real constructors genuinely reproduce the leak: `apps/extension/src/wallet/services/config/client.ts:13` allocates the logger, and `packages/extension-messaging/src/background/client.ts:56` logs on connection. S1/S2 therefore need not be vacuous. However, counts alone could pass with one functioning logger and several broken borrowers. An indiscriminate success responder also hides malformed requests.

   **Smallest fix:** use real outer classes and their real logger path; assert each borrower’s source/message reaches the expected port. Validate request envelopes and correlate responses by request ID on the originating port. Make posting after closure fail. Drain responses before teardown and assert no outstanding requests/timers. Add one deliberately pending logger request during S4, explicitly observe its rejection, then verify successful delivery through the replacement. A `(BUG PIN)` passing baseline is fine, but demonstrate the final one-port assertion fails against the old implementation.

3. **[Med] The local network gate does not reproduce the repository’s deliberate suite partitioning.**  
   Argument forwarding is correct (`apps/extension/scripts/e2e/agent.sh:207`), and separate worktrees isolate builds. But unrestricted `--shard=K/3` recombines heavy tests that CI explicitly separates because they disturb subsequent files (`.github/workflows/pr-extension-network-e2e.yml:140`, `:175`). It also inherits two retries per test (`apps/extension/vitest.e2e.network.config.ts:46`), while the plan describes one file rerun.

   **Smallest fix:** specify identical exclusions for all three lightweight shards, run the heavy groups separately, and set `NULO_E2E_RETRY=0` if “one rerun” is the intended acceptance policy. Record actual executed/skipped files and exits. Proverless canary execution must not count as real-proving coverage; CI supplies that separately.

4. **[Med] “Reap reports no owned processes left” is not an available guarantee.**  
   `apps/extension/tests/e2e/reap.ts:26` signals recorded processes and then deletes data and clears the lock. `apps/extension/tests/e2e/lockfile.ts:113` only sends SIGTERM; it does not wait, escalate, or verify termination. Separate worktrees also do not reserve host resources: `apps/extension/scripts/e2e/resolve-ports.ts:197` releases allocated ports before the build.

   **Smallest fix:** retain ownership records and verify owned process groups actually exit before removing helper worktrees; include Chrome cleanup verification. Start with sequential shards or explicitly coordinate concurrent reservations through the host registry. Check exclusive ownership of the smoke build path: `apps/extension/tests/e2e/global-setup-smoke.ts:21` kills every matching Chrome, including a live run sharing that path.

5. **[Low] The advertised two-port bound depends on callers, not the interface.**  
   The proposed `Map<string | undefined, …>` accepts infinitely many contexts (`implementations-plan/owned-client-teardown/plan.md:86`). Moving a profile ID or request ID into that argument would recreate unbounded growth.

   **Smallest fix:** constrain contexts to the actual document tags plus `undefined`, or explicitly document that arbitrary/dynamic context values are prohibited. Keep two ports for now: preserving existing context values is cheaper and safer than introducing mutable context routing. If one port later matters, use immutable context-bound views, never mutate a shared client’s context.

6. **[Med] Availability and encapsulation claims are too absolute.**  
   Returning `ILogger` hides `disconnect()` from ordinary typed consumers; it does not remove that method or make the object immutable. The redaction tests already overwrite `request` through a cast (`apps/extension/src/wallet/services/logger/client.test.ts:19`). Also, `log()` synchronously executes `trim()` (`logger/client.ts:34`), whose object walk can invoke getters (`apps/extension/src/wallet/logger/utils.ts:255`). Fire-and-forget therefore does not imply “RPC blast radius stays zero.” Rejection handlers themselves issue unobserved logging promises (`apps/extension/src/wallet/logger/console-forwarding.ts:21`), so persistent logger failure can sustain a rejection cascade.

   **Smallest fix:** qualify these claims and distinguish existing failure behavior from the enlarged shared-instance impact. Preserve `ILogger`; do not add a security wrapper solely to defend against already-compromised extension code. No production borrower disconnecting or mutating its logger was found.

**Facts attack**

- **F1 confirmed:** 23 production logger construction sites.
- **F2 is literally incorrect:** `disconnect()` references the logger indirectly through `logDebug` (`packages/extension-messaging/src/background/client.ts:76`). Say “never closes its logger.”
- **F6’s reasoning is incorrect:** `BaseService.start()` sets `initialized` only **after** awaiting initialization (`packages/extension-messaging/src/core/base-service.ts:64`); concurrent calls or retries after failure can rerun it. Production safety comes from the runtime’s single-flight start (`apps/extension/src/wallet/runtime.ts:147`) and retry veto before registration (`:230`).
- **PXE inventory is nine, not eight:** recon missed `TokenService`’s factory (`apps/extension/src/wallet/services/token/service.ts:114`; `pxe/shallow-port.ts:36`). These remain bounded worker-lifetime clients. The deletion coordinator constructs its client in its constructor, not `init()` (`profile-deletion/coordinator.ts:63`). No additional growing owned messaging-client population was found.
- **F9 needs qualification:** the extension fake rejects repeat service names even after disconnect because its disconnect is a no-op (`apps/extension/tests/vitest.setup.ts:59`).
- Recon’s passkey double-disconnect example is stale: `popup/windows/passkey/index.vue:55` disconnects; its unmount hook at `:64` only aborts the ceremony.

**Inferences attack**

- **I1 — moderate confidence:** current aliases and multi-page inputs support one resolved logger module per production document (`apps/extension/vite.config.ts:34`, `:312`). “Rollup never duplicates modules” is not a universal guarantee. Inspect emitted entry/chunk graphs during the planned build; HMR and module-reset tests are separate lifetimes.
- **I2 supported:** no production identity-dependent behavior found.
- **I3 unproven:** small payloads are not enforced; FIFO applies to port delivery, not necessarily invocation ordering while connection readiness is pending.
- **I4 false:** singleton reuse creates the stale-test-port problem above.
- **I5 unknown:** validate host capacity before concurrency.
- **I6 insufficient:** successful proverless execution does not establish equivalent coverage.

**Asks attack**

- A1 follow-ups are reasonable; test isolation is required work, not optional harness consolidation.
- A2 is reasonable only with explicit real-proving CI evidence.
- State whether existing logging-failure behavior is accepted unchanged; do not silently describe it as harmless.

**Looks fine**

- Static memo/private constructor is acceptable; a module function with an unexported class is also idiomatic, but switching offers little benefit here.
- No service-worker construction path into the proposed factory was found; worker services receive `LoggerStore` (`apps/extension/src/wallet/runtime.ts:451`).
- Sharing preserves client-side redaction and Chrome-derived sender checks (`logger/client.ts:34`; `packages/extension-messaging/src/background/service.ts:44`).
- Phase 1/2 script names exist. No dependency, cryptographic, permission, or wire-protocol change is needed.
## Round 2 — fresh session on plan v2 and its decision ledger (2026-09-16)

A new codex session (not a resume), given plan v2, recon, and the adversarial, assumption-attack,
implementation-critique and ledger-re-evaluation asks. Its conditions are folded into plan v3 as
D6, D15 and D18–D25.

conditional approve (with conditions: close the test-isolation and proof gaps, correct Phase 4 cleanup and scheduling, and tighten failure classification)
design: agree — Document-scoped sharing fixes the ownership error without changing the messaging state machine.

Confidence: **high** on source findings; **moderate** on production bundling. Read-only inspection; no tests, builds, installs, or e2e configurations executed.

1. **[High] Reap verification can pass without checking surviving groups.**  
   Phase 4 reads `owned.json` **after** the last run (`implementations-plan/owned-client-teardown/plan.md:493`), but normal teardown already deletes it (`apps/extension/tests/e2e/global-setup.ts:818`). Its termination check follows the child leader’s exit, not the entire group’s disappearance (`:840`); descendants can survive after the leader exits. The resulting empty ownership list makes verification vacuous.  
   **Smallest fix:** capture each run’s ownership record while it exists, retain it outside `.e2e-state`, and verify those groups after **every** run, including failed boots and retries. Verify disappearance after SIGKILL too, before deleting helper worktrees.

2. **[Med] Lane-B staggering does not establish collision-free execution.**  
   Ports are released before building (`apps/extension/scripts/e2e/resolve-ports.ts:197`). Waiting for A’s first `boot-ready` only protects against that currently bound pack; A’s subsequent shard or retry can allocate while B is building. The sentinel can also be stale until `agent.sh:50` clears it. I5 claims a capacity check before B, but Phase 4 only specifies preflight before A.  
   **Smallest fix:** run all seven workloads sequentially. Otherwise coordinate every allocation-to-bind interval and validate a fresh run-specific sentinel. Express exclusions as a Bash array, like CI (`_extension-network-e2e.yml:233`), rather than an unspecified `$EXCL` string that zsh will not ordinarily word-split.

3. **[Med] The failure policy can misclassify regressions as acceptable.**  
   “Same file red on baseline” does not establish the **same failure**, and an isolated green rerun can hide an ordering regression (`implementations-plan/owned-client-teardown/plan.md:490`). CI deliberately fails test failures immediately (`_extension-network-e2e.yml:252`). Also, the helper checks out `HEAD`; no gate explicitly ensures it includes the implementation being tested.  
   **Smallest fix:** pin and record one committed candidate SHA for both lanes. Compare matching assertions/error signatures under equivalent conditions; rerun the original shard for ordering-sensitive failures. Label exceptions as exceptions to local acceptance, not CI-equivalent passes. Unclassified nonzero exits must block.

4. **[Med] D6’s rejection leaves a concrete isolation defect.**  
   The Chrome stub and listener registries reset per test (`apps/extension/tests/vitest.setup.ts:88`, `:116`), while `profile/client.test.ts:54` constructs clients from a statically imported module. The singleton remains Connected to the first test’s port. Subsequent logging bypasses the current fixture and accumulates unanswered requests with timers (`base-client.ts:135`). “Nobody asserts logger traffic” does not make that isolated or deterministic. Some unanswered-request debt predates this change; that does not justify preserving the new stale singleton.  
   **Smallest fix:** mock `documentLogger` with a no-op logger in tests that exercise real outer transports but do not test logging. No repository-wide harness rewrite is needed.

5. **[Med] The proof does not explicitly establish continuous ownership.**  
   Closed-port throws do **not** necessarily expose a borrower calling `logger.disconnect()`: the next request reconnects automatically (`packages/extension-messaging/src/background/client.ts:100`). If preceding lines have settled, all delivery assertions and the final live count can still pass despite churn. S4 verifies one module instance, not the production chunk graph.  
   **Smallest fix:** in S1/S2 assert cumulative logger opens, stable port identity, and zero logger disconnects. Cover every context’s wire tag. Keep S3’s deliberately held rejection observable. For Phase 3, hold reconciliation pending and assert the additional disconnect happens only **after settlement**; invocation order alone would accept premature teardown. Auth’s preservation test must also prove the successful continuation ran.

6. **[Low] The proposed type duplicates an existing, different `LogContext`.**  
   The shared type is `"sw" | "offscreen" | "popup" | "content"` (`packages/wallet-core/src/logger/interfaces.ts:19`), already re-exported by the extension logger barrel. The new union includes onboarding and excludes worker/content contexts.  
   **Smallest fix:** call it `DocumentLogContext`; record the existing type in recon. This preserves the useful restriction without creating two identically named contracts.

**Facts attack**

- **F14 is overstated.** Creation’s poll checks only `isLogined` (`new-profile-helpers.ts:24`), not profile identity or a bootstrap generation. A truthy profile event does not first clear that flag (`popup/app.vue:139`), and `initAccount` can return without creating anything (`useProfileBootstrap.ts:100`). Correct the claimed guarantee.
- **F16’s partitioning is accurate**, but the actual aggregate name is `extension-network-e2e-status` (`pr-extension-network-e2e.yml:248`), not `network-e2e-status`.
- **F17 is accurate but incomplete:** normal teardown’s earlier lock deletion defeats the proposed later verification.
- The encapsulation and four-instance bounds are **TypeScript contracts**, not runtime guarantees. The returned object retains its constructor and mutable implementation; the exported reset can create another live generation. No current production caller exploiting those paths was found.

**Inferences attack**

- **I1:** plausible, moderate confidence; source configuration is not emitted-graph evidence. No concrete production duplication path found.
- **I4:** reject the isolation rationale; see finding 4.
- **I5/I6:** unproven capacity and incomplete coordination; see finding 2.
- **I7:** supported independently of F14. `AccountServiceClient` contains event handlers and passthrough methods, not profile/network state (`account/client.ts:14`); disconnected instances reconnect. I found no requirement for a fresh instance. Existing activation races must not be represented as solved by `??=`.
- Availability wording needs correction: a Connected but unresponsive port does not heal merely because another line is logged. Timeout settlement does not disconnect it (`base-client.ts:261`; `background/client.ts:107`).

**Asks attack**

A1–A4 remain explicit owner decisions. A3 must precede Phase 3; A2 requires actual canary success, not merely a green aggregate that permits skipped suites. A4 accepts existing rejection recursion and per-request connection polling; sharing reduces connection retry loops, not every outstanding waiter. Surface the pre-existing creation-handshake weakness separately without silently expanding scope.

**Ledger positions**

- **D2: uphold.** Removing the class export improves ordinary JS import enforcement. It is an API boundary, not a security boundary.
- **D6: reverse narrowly**, as finding 4 describes.
- **D15: reverse.** Retain a one-time emitted module/chunk graph check during the already-required build. Minified identifier names do not prevent inspecting module metadata or sourcemaps.
- **D7/D8: keep rejected.** Neither globally importing the memo nor resetting module identity is necessary.
- **D16: keep dropped** from this change; no need to modify shared disconnect semantics.
- **D9/D11:** findings were faithfully recorded, but implementation conditions remain incomplete—findings 1 and 5.
- **D10:** partitioning was resolved; scheduling and acceptance-policy parity were not.
- **D14:** uphold `??=`, but replace its overstrong F14 justification.
- The `/loop` seed forbids concurrent e2e despite Phase 4’s two lanes, and pushes after merely touched-file validation (`plan.md:630`). Align it with the selected schedule and required push gates.

**Looks fine**

- Module-private class, lazy factory, and test-only reset are a reasonable small design.
- No executable service-worker call into the proposed factory was found.
- Redaction, `DummyLogger`, sender validation, permissions, dependencies, and cryptography remain unchanged.
- Phase 1–3 command names exist; CI exclusions, heavy groups, proverless flags, fee multiplier, and exit-86 retry match the repository.
## Round 3 — fresh session on plan v4 (2026-09-17)

A new codex session given plan v4, recon, both prior codex rounds and the Fable review, asked to
attack the four v4 changes (D26–D29) and re-check the interface, the test seams, the citations and
the ledger. Its conditions are folded into v4 as D30–D33 plus two wording fixes (Phase 1 scope,
the `/loop` seed). Verbatim:

---

conditional approve (with conditions: repair S3’s rejection-observation seam, settle redaction-test requests, fix A5’s per-run cleanup verification if selected, and reconcile stale instructions).

Confidence: **high** on source findings; **moderate** on runtime ordering. Read-only review at `c543c18d`; no tests or builds run. Below, `plan.md` means the reviewed plan.

1. **[High] A5 reintroduces the cleanup hole round 2 rejected.**  
   `plan.md:623` repeatedly overwrites one ownership snapshot; `:600` verifies only after all five shards. A surviving descendant from shard 1 can therefore overlap shard 2 and disappear from the evidence when its snapshot is replaced. Normal teardown deletes the original record (`apps/extension/tests/e2e/global-setup.ts:818`). Worse, missing or invalid capture can still produce `VERIFY=0` (`plan.md:645,656`).  
   **Smallest fix:** use a fresh snapshot per shard/attempt, validate its provenance and JSON, and verify groups **before starting the next attempt**. Missing capture must be unresolved unless evidence establishes that no processes started. Stop the watcher reliably on exit. These conditions apply only if A5 selects local execution; the excludes, array expansion, five-shard arguments and environment flags match CI.

2. **[Med] S3 lacks a workable browser-rejection observation mechanism.**  
   `plan.md:129` discards the promise, while `:274-277` expects the test to observe its rejection through the page handler. The suite uses jsdom (`apps/extension/vitest.config.ts:29`); a rejected runtime promise does not automatically become a Chrome `PromiseRejectionEvent`. Existing coverage explicitly invokes the handler with synthetic events (`apps/extension/src/wallet/logger/console-forwarding.test.ts:52-55`). Merely adding `self.onunhandledrejection` does not establish the proposed test.  
   **Smallest fix:** return the underlying promise from the view—still assignable to `ILogger`—and use a test-only typed cast to observe the rejection before closing the port. Keep handler demotion covered by the existing synthetic-event test. Alternatively, specify an explicit runtime-to-page bridge without suppressing unrelated failures.

3. **[Med] The replacement redaction seam must answer requests.**  
   Capturing actual wire parameters is sound and strengthens the serialization check, but `plan.md:231` specifies only recording `postMessage`. Today’s helper returns an already-resolved promise (`apps/extension/src/wallet/services/logger/client.test.ts:19-21`); the real transport creates timeout and warning timers (`packages/extension-messaging/src/core/base-client.ts:131-151`). Resetting `shared` does not clear them.  
   **Smallest fix:** explicitly require correlated microtask responses and settlement before reset/teardown in **both** real-logger test files. Decode wrapped parameters and preserve the positive Error/Note assertions; do not merely retain negative secret searches.

4. **[Med] I5 overstates smoke’s detection power.**  
   `plan.md:459-463` claims missing ports, wrong tags and hung logging will surface. Wrong tags and silently dropped logging can leave every UI assertion green. The fixture itself documents that forwarded application logs bypass its console capture (`apps/extension/tests/e2e/fixtures/extension.ts:238-251`). A hung logger also does not synchronously block client RPCs.  
   **Smallest fix:** describe smoke as integration execution and UI-regression coverage, with delivery/tag correctness established by S1–S4. This does **not** justify restoring local network runs: I found no concrete regression class uniquely detectable locally rather than by the required CI partition.

5. **[Low] D28’s phase instructions contradict each other and the resume seed.**  
   `plan.md:281-282` still says Phase 1 writes S1–S4; `:501-504` correctly defers S3–S4. The loop seed says commit after each meaningful edit (`:821`), contradicting the explicit uncommitted-red-test exception (`:507`).  
   **Smallest fix:** consistently specify S1–S2, exempt Phase 1 from automatic commits, and record the baseline SHA, exact command, count failures and pending uncommitted test in lessons. That is adequate red evidence; a temporary pin commit adds no necessary proof.

6. **[Low] Several ledger entries remain stale.**  
   D26 explicitly supersedes D10/D18, but D1 still promises a replacement port “per context”; D9 still says S3 “awaits” the line despite the discarded promise; D12/D23 retain obsolete encapsulation wording (`plan.md:760,768,771,782`). D20 promises verification after every run, contradicting A5. D19’s whole-workload rerun rule also conflicts with smoke’s file-only rerun (`:581`).  
   **Smallest fix:** mark superseded clauses directly and distinguish surviving requirements from historical rationale. The principal runtime/configuration line citations I checked match HEAD.

Looks fine:

- The generic constrains wire methods, not subclass public-method names; the proposed `log` introduces no base-class collision.
- `void` does not handle rejection. No production promise consumer, logger identity dependency or `instanceof` dependency was found.
- Restart ordering has the existing closed-port-before-notification window; sharing enlarges its logging blast radius, already acknowledged.
- The console-forwarding mock needs a hoisted `documentLogger` spy returning `{ log }`, replacing its constructor/tag assertion.

D27: **agree** — simpler ownership; fix the test seam.  
D28: **agree** — recorded red evidence suffices; reconcile resume instructions.  
D29: **agree** — neither double works unchanged; optional multi-port support is possible but broader work. Listed features support S1–S4.  
D26: **agree**, subject to owner approval — smoke plus actual CI execution is sufficient; A5’s optional cleanup script currently regresses v3’s guarantees.
---

**Closure check (resumed session, same day).** Asked whether the four conditions were satisfied by
the folded plan, with the owner answers A1–A5 stated. Verbatim:

---

Confidence: **high** from inspection. `plan.md` below is `implementations-plan/owned-client-teardown/plan.md`.

1. **A5 cleanup — not satisfied for the optional script.** Per-attempt verification and stopping the pool are fixed, but snapshot provenance remains unchecked. **[Med]** The watcher can copy an existing, previous attempt’s `owned.json` (`plan.md:648`); verification accepts any JSON containing a `.pids` object (`:685`). A missed current-attempt capture can therefore masquerade as valid evidence. Also, the watcher remains active during verification (`:652-655`), allowing copying to race the verifier’s two reads. **Smallest fix:** require the ownership record’s `startedAt` to belong to this attempt, and stop **and wait for** the watcher before verification. With **A5 = none**, this does not block the selected execution.

2. **S3 seam — satisfied.** The view returns the underlying promise (`plan.md:129`); S3 captures and observes its rejection, while synthetic events cover page-handler demotion (`:277-282`).

3. **Redaction seam — satisfied.** Both real-logger files must provide correlated responses and drain before resetting; decoded wire assertions retain positive Error/Note checks (`plan.md:291-296`).

4. **I5 — satisfied.** Smoke is explicitly integration/UI coverage, with delivery and tag correctness assigned to S1–S4 (`plan.md:471-477`).

The remaining closure condition—reconciling stale instructions—is also satisfied: Phase 1 consistently covers S1–S2, the loop exempts its red test from commits, and the ledger distinguishes superseded decisions.

The verdict applies to the owner-selected scope, including **A5 = none**.

approve
---

The remaining Med on the unused A5 script (snapshot provenance; watcher racing the verifier) was
fixed the same day: the watcher copies only a record whose `startedAt` postdates the attempt, is
stopped and waited for before verification, and the verifier rejects a record from an earlier
attempt (D31, amended).
