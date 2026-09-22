# Codex audits — firefox-arc-closeout

GPT-6 Astra, `high`, read-only sandbox, under tmux. The first attempt died mid-run on the default login's weekly
usage limit (no verdict returned); the audit was re-run from scratch on a roster account with headroom
(`CODEX_ACCOUNT=best`). The session transcripts live in that session's CODEX_DIR, not in the repo.

## Round 1 — plan rev 1 (2026-09-21) — **reject**

Audit packet: adversarial/security · assumption attack · implementation critique · regression-fence audit, with
`recon.md` as context. Verbatim:

> reject (with blocking findings: ineffective transport fences, failure-triggered canary skipping, and loss of
> proof enforcement after the proposed shard split).
>
> SDK filenames below refer to the installed 5.2.0 source. Inspection only; no builds, tests, or workflows ran.
>
> **1. Adversarial / security**
>
> - **Low · high confidence — The security explanation overstates page access.**
>   `content_script_connection_handler.ts:97` accepts only discovery through window messages; `:172` binds
>   subsequent messages to the port's captured session ID. `:236` returns immediately when a disconnect names an
>   unknown port: no page message, port creation, or presence disclosure. Ports originate at discovery approval
>   (`:164`), **before** key exchange. Correct `plan.md:290–301` accordingly. Browser-supplied `sender.tab.id` is
>   the right reply destination; an envelope-supplied tab ID is not.
> - **Medium · high confidence — Pin isolation at the actual boundary.** The new branch neither terminates
>   background sessions nor replies to another tab, but `background.ts:298` broadcasts within the sender's tab,
>   and subframe rejection has a build-time escape hatch (`:334`). Add transport tests for another tab's session
>   ID, subframes, repeated disconnects, and non-content-script passthrough. Require validated content-script
>   envelopes explicitly. Flooding introduces one outbound send per admitted message, potentially delivered to
>   multiple frames; no persistent state growth, but debug logging is not rate limiting. Correct that threat
>   description.
> - **High · high confidence — Splitting weakens a named CI fence.** `_extension-network-e2e.yml:370` rejects
>   zero successful proofs only when `SHARD_LABEL = "canary"`. The proposed `canary-accounts` label escapes it.
>   Add the reusable workflow to the change map and extend—and mutation-test—the enforcement. No proposed list
>   edit otherwise raises privileges or converts an existing required check to advisory.
>
> **2. Assumption attack**
>
> - **Facts — Medium · high confidence.** `plan.md:124` conflates discovery and key exchange:
>   `extension_provider.ts:62` has a separate key-exchange timeout. `plan.md:183` also understates B's advantage:
>   `fixtures/browser/index.ts:118` records immediate Chrome successor startup versus Firefox's event-triggered
>   startup. Amend both statements. Facts 1–7 are otherwise substantially supported; Fact 3 needs "after
>   attachment," since the relay drops pre-attach non-discovery traffic (`content-message-relay.ts:93`).
> - **Inferences — Medium · high confidence.** Handshake ordering is correct:
>   `background_connection_handler.ts:330` registers before sending the response; `extension_provider.ts:69–85`
>   resolves afterward. However, `getPendingDiscovery` is not a handshake indicator: termination restores an
>   approved discovery (`background_connection_handler.ts:402–412`), including profile-switch teardown
>   (`background.ts:138`). Thus it suppresses recovery if the original disconnect was missed. Remove this
>   unnecessary guard, or narrowly justify it with termination, profile-switch, and rediscovery tests.
> - **Inferences — Medium · high confidence.** Heartbeats continue while requests remain pending
>   (`extension_wallet.ts:287`), but the interval is configurable (`:94`); boot duration is unbounded by this
>   plan. A missing receiver can reject `sendMessage`; the content script ignores its result (`content.ts:12`).
>   An invalidated extension context cannot be repaired by A. Scope the 15-second criterion to a functioning
>   content script, default heartbeat, and measured successful boot; separately record listener failure/context
>   invalidation. Phase 1 must prove Firefox wake, not merely eventual rejection.
> - **Asks — High · high confidence.** Owner approval for silently abandoning Firefox passkey stage 4 is absent
>   from the quoted decisions. `plan.md:137` assumes that authority. Replace the fallback with diagnosis and an
>   explicit disposition before reducing coverage.
>
> **3. Implementation critique**
>
> - **Medium · high confidence — Keep A, simplify its contract.** `plan.md:95` calls a function with mutable
>   handler lookups "pure." Pass validated inputs and a session-existence result, or describe it honestly as a
>   decision helper. Preserve arrow-wrapped handler methods. Recon's transport, disconnect message, journal UI,
>   and proof-gate reuse are appropriate; no replacement subsystem is needed.
> - **Medium · moderate confidence — B and C deserve accurate trade-offs.** B improves idle/no-heartbeat sessions
>   whenever another event boots the background; on Firefox it cannot itself cause that boot. Its persistence
>   lifecycle still makes A preferable for this bounded task. C can retain existing validation without buffering
>   more traffic; rejecting it is reasonable scope control, not a security necessity. Replace `plan.md:178–187`'s
>   absolute latency claims with measured criteria.
> - **High · high confidence — The driver fact is sound; the fallback is not.** `firefox.ts:519` creates a
>   session-scoped authenticator, supporting `credentialOutlivesPage`. A failed ceremony after closing the page
>   does not establish `backgroundKillUnderPage`. Require that recovery stage to pass. The filename inventory pin
>   is useful, but also assert effective `proverless: false`, exactly-one placement across all four lanes, and
>   executed substantive tests. The 22-minute threshold is reasonable only for total job duration, including
>   setup; specify timeout handling too.
>
> **4. Regression-fence audit**
>
> - **High · high confidence — Two claimed fences bypass the changed code.**
>   `background.admission.test.ts:24,45,48` discards transport and mocks initialization/attachment;
>   `background.init-order.pins.test.ts:22,41` likewise never attaches it. For `background.ts`, `stale-session*`,
>   and `sdk-wire*`, require actual wrapper execution, live-session PONG, delayed handshake, receiver
>   disappearance, and disconnect delivery—not merely lookup stubs.
> - **High · high confidence — Reload masks broken reconnect.** `plan.md:206` reloads the dApp;
>   `session-reconnect.test.ts:53` does too. Broken same-page recovery can pass both. Reconnect without reload on
>   both browsers. Red-first is sound without committing red, but require the expected assertion failure,
>   confirmed death/proof hold, unchanged spec, and subsequent green run.
> - **Medium · high confidence — Complete the gate map.** Scripts exist (`package.json:17–40`), but Phase 2 lacks
>   executable e2e commands. Specify cwd, browser/prover environment, selected files, substantive pass counts,
>   and allowed skips. Map both canaries/all three drivers to both-browser recovery runs; workflows/pins to all
>   four partitions; every documentation/ledger edit to a consistency checklist.
>
> Looks fine: existing wire reuse; no keys persisted; no new dependency or permission; privileged Firefox script
> untouched.

**Driver's verification before adopting (round 1):** the three claims that carried the Highs were checked in the tree and
hold — `background.admission.test.ts` mocks `@aztec/wallet-sdk/extension/handlers` and
`./content-message-relay`; the zero-proofs check reads `[ "$SHARD_LABEL" = "canary" ]`; the driver contract
says Chrome starts a successor within milliseconds. **Disposition:** every finding adopted — see plan.md's
Decision ledger (D1–D14). "Executed substantive tests" is adopted as explicit passed counts with 0 skips in the
gates plus CI's existing `PROVE_SUCCESS > 0`, without a new CI assertion. *(The final pass below rejected that
last sentence; see D16.)*

## Final pass — plan rev 2, a FRESH session (2026-09-21) — **reject**

A new codex session with no memory of round 1, given rev 2, both rev-1 audits, `recon.md`, and the one open
auditor disagreement (D1) to rule on. Verbatim, paths rewritten repo-relative:

> reject (with blocking findings: an unsatisfied cold-idle-call guarantee and incomplete permanent
> canary-execution gates).
>
> - **Inferences — High, high confidence: the idle test does not reliably exercise `secure-message` recovery.**
>   `plan.md:250` promises immediate rejection after a kill. But `content-message-relay.ts:93` drops **all**
>   pre-attach non-discovery messages. Firefox's first idle call can wake the background and be discarded;
>   rejection then depends on a later heartbeat. The no-heartbeat guarantee at `plan.md:134` is also false in
>   this case. **Smallest correction:** distinguish cold recovery from immediate rejection after attachment;
>   explicitly test both. Make the latter's deadline shorter than the heartbeat interval so PING cannot conceal
>   broken `secure-message` wiring.
> - **Inferences — High, high confidence: CI still permits a canary to stop executing silently.** `plan.md:450`
>   explicitly substitutes local passed-count inspection and aggregate `PROVE_SUCCESS > 0` for a permanent
>   execution assertion. `_extension-network-e2e.yml:370` counts proofs across the job. A future skipped passkey
>   canary passes the proposed placement/parity pins while transfers or the frozen canary supply successful
>   proofs—even after splitting. **Smallest correction:** require machine-checked results showing each named
>   substantive canary test passed, with zero skipped canary tests, in all four lanes; mutation-test skipping
>   either canary. Local inspection does not prevent subsequent QA drift.
> - **Inferences — Medium, high confidence: successor liveness does not establish heartbeat causation.**
>   `plan.md:258` observes a successor around ten seconds and treats absence as evidence that heartbeat wake
>   fails. Yet `apps/extension/src/wallet/index.ts:89` explicitly supports alarm-triggered startup; opening
>   nothing excludes only test-generated popup wakes. Conversely, one absent observation does not establish
>   permanent failure. **Smallest correction:** control unrelated wake sources and observe the heartbeat reaching
>   the relay, or add a heartbeat-disabled negative control. Diagnose over the stated rejection budget before
>   invoking the owner stop.
> - **Facts — Medium, high confidence: the security argument incorrectly treats session identifiers as
>   unchoosable.** `plan.md:366` says a page cannot pick one. Installed SDK
>   `content_script_connection_handler.ts:156` forwards the page's discovery request;
>   `background_connection_handler.ts:278` explicitly makes its `requestId` the session ID. The port captures
>   that value; it does not make the value wallet-generated. **Smallest correction:** say pages cannot override
>   an existing port's captured ID, but can choose discovery IDs. Base isolation on approval, browser-supplied
>   tab targeting, and port matching; include an adversarial chosen-ID case in the transport fence. This does not
>   establish a new cross-tab exploit.
> - **Facts — Low, high confidence: one exact gate count is wrong.** `plan.md:317` requires `1 passed`;
>   `frozen-account-canary.test.ts:38` and `:82` define two tests. **Smallest correction:** specify one file, two
>   passed tests, zero skips, including the substantive canary by name.
>
> **Asks — High, high confidence:** resolve the cold-first-call contract before approval. Keeping the relay
> untouched means explicitly accepting heartbeat-dependent cold recovery; preserving unconditional immediate
> rejection requires revisiting alternative C. Do not leave the implementer to discover this contradiction
> during the mandatory red/green gates.
>
> **D1 ruling — removal is correct; high confidence.** For the installed SDK's honest flow,
> `background_connection_handler.ts:330` registers the session before sending the response at `:339`;
> `extension_provider.ts:69` waits for that response before completing establishment. No normal first PING or
> encrypted call legitimately precedes registration. Termination restores an approved discovery at `:402` after
> deleting the session: that record does not make the old channel usable. Keeping the guard can suppress
> recovery after a missed disconnect. Add that missed-disconnect case to the real-wrapper tests.
>
> Looks fine: reuse of the SDK disconnect wire message; lazy handler lookup; real-wrapper fences; same-page
> reconnect; driver-owned authenticator distinction; split-job proof enforcement; no added dependency,
> permission, or privileged-script edit. Inspection only; no builds or tests ran.

**Driver's verification:** all five hold — the relay returns before buffering for any type but
`discovery-request` (`content-message-relay.ts:93`); `PROVE_SUCCESS` is a `grep -c` over the whole job's server
log; the price alarm's listener is module-scope (`src/wallet/index.ts:96`); `approveDiscovery` sets
`sessionId = requestId` (`:278-281`); each canary file declares two tests. **Disposition:** all adopted as plan
rev 3 — Decision ledger D15–D18; D1 marked ruled.

## Re-verdict — plan rev 3, the same session resumed (2026-09-21) — **conditional approve**

> conditional approve (with conditions: pin substantive canary execution, use post-attachment readiness, and
> correct wake attribution).
>
> - **High · high confidence — The results assertion can still accept a missing substantive canary.**
>   `plan.md:189` requires only ≥1 passed test per file. Both canary files contain a separate setup-contract test
>   (`frozen-account-canary.test.ts:38`; `passkey-execution-canary.test.ts:49`). If the substantive test is
>   deleted or conditionally never registered, that contract passes, no skip appears, and another file supplies
>   proofs. Every proposed permanent CI gate remains green; the phase's manual two-test count does not prevent
>   later drift. **Smallest change:** require each substantive canary's test identity to appear with status
>   `passed`, alongside zero skips/todos. Add a mutation that removes its report entry while retaining the
>   passing contract entry.
> - **Medium · high confidence — Test 3's readiness inference remains unsupported and unnecessarily fragile.**
>   `plan.md:281` equates the locked screen with listener attachment. But service RPCs become available during
>   `services.start()` (`runtime.ts:236`), before SDK initialization at `:253`; the popup's lock decision uses
>   profile RPCs (`boot-session.ts:41`). An early screen can cause an intermittent failure—or pass when attachment
>   happens before the subsequent call—so Inference 6's promised diagnostic is unreliable. **Smallest change:**
>   reuse `readLivenessBaseline` and `waitForWorkerLiveness` after opening the replacement popup. The successor
>   writes liveness after SDK initialization (`runtime.ts:255`). Start the three-second rejection clock only
>   afterward.
> - **Medium · high confidence — Recording an alarm's period does not control its firing time.** `plan.md:298`
>   still concludes causation from "alive in treatment, absent in control." Separate thirty-second windows can
>   straddle different phases of the three-minute alarm (`price/service.ts:27`), producing exactly that
>   observation without heartbeat wake. Criterion 2 still demands dApp-caused wake at `plan.md:51`. **Smallest
>   change:** clear unrelated alarms before both diagnostic kills, or record and exclude their scheduled firing
>   windows. Otherwise label this outcome merely suggestive and remove the causal claim from criterion 2.

**Driver's verification:** all three hold — `initWalletSdkHandler` at `runtime.ts:253`, the first liveness write
at `:255`, `services.start()` at `:243`; both liveness helpers exist in `tests/e2e/fixtures/helpers.ts` and the
kill specs already use them; `PRICE_REFRESH_PERIOD_MINUTES = 3`. **Disposition:** all three adopted as written —
plan rev 4, Decision ledger D19–D21. With its conditions met, codex's standing verdict is conditional approve.


