# Codex plan audit — pxe-timer-throttling

GPT-6 Astra at `high`, read-only, one session. Round 1 audited the draft plan, recon and spike; round 2 is a resume of the same session on the revision. No tests, builds or workflows were run by the reviewer. Dispositions: `plan.md` § Audit verdicts.

## Round 1

conditional approve (with conditions: correct the lifecycle evidence, add failure and performance gates, and record owner acceptance of the remaining lifetime risk)

Confidence: **high** for source/data findings; **moderate** for untested lifecycle risks. No tests, builds, or workflows were run.

- [High] **Facts — the ten-minute survival claim is false.** `implementations-plan/pxe-timer-throttling/spike/results.jsonl:45` and `:46` both contain `pxe: {"absent":true}`. The harness compares two undefined timestamps and reports `pxeSurvived:true` (`spike/spike.patch:473`). Only six-minute frame survival is demonstrated. Correct `plan.md:210` and `spike/README.md:54`; repeat the no-dApp soak with an actual frame and require nonempty instance identities.

- [Medium] **Facts — performance conclusions exceed the experiment.** `spike/README.md:14` identifies 3.0 s as **masked Firefox**; Chrome measured 3.8 s (`:17`). Thus the plan’s opening Firefox-versus-Chrome comparison is mislabeled. One run per arm supports the mechanism, not platform-wide equality or proven batch fragmentation. “Every late timer” is also too broad: `spike/results.jsonl:23` includes late keepalive intervals. Say “dominant throttling-related delay.”

- [High] **Inferences — heartbeat persistence needs a qualified contract.** API calls postponing suspension are primary-source confirmed in [Mozilla bug 1844041](https://bugzilla.mozilla.org/show_bug.cgi?id=1844041), fixed for Firefox 121. That does not guarantee indefinite survival. The heartbeat starts only after boot completes (`apps/extension/src/wallet/runtime.ts:255`); delayed execution, suspension, reload and termination remain relevant. Recon also omits the existing per-request 20-second keepalive (`packages/extension-messaging/src/offscreen/service.ts:79`), so the soak does not isolate the storage heartbeat’s causal contribution.

- [High] **Restart scope — defer the existing dApp reconnection repair, not proof of the new host’s lifecycle.** Both measurements stop before an execute window appears (`spike/results.jsonl:34`, `:44`); neither exercises a recreated PXE. Matching early failures cannot establish equivalent downstream recovery. Add a test bypassing the broken connection: terminate the background, establish a fresh connection, recreate exactly one PXE, and complete an operation. Terminate during proving too; verify journal recovery, released storage ownership, and no duplicate submission. Parking the broader repair is defensible only with those checks and explicit owner acceptance.

- [Medium] **Security — URL identity survives framing; instance identity remains absent.** `sender.url` identifies the iframe, while `tab` and consequently `frameId` need not exist for a background frame. [MDN documents these fields](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/MessageSender). `sender-auth.ts:38` accepts PXE replies by URL; `:82` still rejects that frame as a background requester because its URL differs. Pin both directions with the actual Firefox sender shape; do not introduce `frameId > 0` as authentication.

- [Medium] **Security — F-10 removal is reasonable, but “a second host cannot exist” is false.** An extension page can still create another frame or tab at the PXE URL; both responders receive background broadcasts and pass URL authentication (`apps/extension/src/wallet/utils/offscreen.ts:30`; `packages/extension-messaging/src/offscreen/service.ts:45`). F-10 never established exclusive authority over those contexts. Delete it for the eliminated orphan-window case, but narrow `plan.md:197` and explicitly retain this trust boundary.

- [Medium] **Security — distinguish origin privilege, CSP and messaging.** The current CSP has no `frame-src` restriction and retains the same script/WASM policy (`apps/extension/manifest/manifest.config.ts:46`); framing itself shows no new web-readable secret surface. However, non-web-accessibility prevents loading, not content-script messages: sender authentication supplies that protection. “Every extension page can script the background” also ignores private/container isolation, documented by [Mozilla](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts). Correct `plan.md:187` and `:189`; verify the final generated manifest excludes the PXE from web-accessible resources.

- [Medium] **Implementation — synchronous append removes only the handle-assignment race.** Removing the Firefox fence at `offscreen.ts:296` is sound if create remains synchronous. Keep single-flight and `trackedClose`. `isConnected` proves attachment, not successful loading or readiness. Test a connected 404/init failure, detached frame, failed PING, timeout cleanup and successful subsequent recreation. Existing jsdom (`apps/extension/vitest.config.ts:31`) is preferable to inventing a fake DOM.

- [Medium] **Implementation — stale READY remains uncorrelated.** `offscreen.ts:107` resolves whichever gate is current using URL alone. Exercise a queued READY from a removed predecessor after its replacement starts; likewise delayed PONG. If Firefox delivers it, correlate lifecycle messages to the creation generation. Synchronous append does not prove asynchronous message freshness.

- [Medium] **Validation — commands exist, but passing suites do not enforce the performance claim.** Root `package.json:15`, `:22`, `:32`, `:40` provide the named commands; smoke’s explicit preceding Firefox build is correct. Add a bounded timer-chain regression with masking off, plus headed macOS/Windows timing checks. Include reload/update, private-window operation, and controlled `extensions.background.idle.timeout` suspension. Preserve a separate unmodified-preferences run. CI’s Firefox proving canary is real (`.github/workflows/pr-extension-network-e2e-firefox.yml:180`).

- [Low] **Asks and delivery.** Resolve A1–A3 before implementation (`plan.md:226`; `CLAUDE.md:56`), including platform coverage and accepted interruption behavior. Grepping found another stale host comment in `apps/extension/tests/e2e/fixtures/browser/firefox-rpc-intercept.ts:14`; no additional operational window dependency surfaced.

Looks fine:

- Small host substitution, existing transport reuse, no timer monkeypatch or fallback.
- Single PR, review/fix loop before opening, Firefox advisory checks explicitly required for delivery, owner-controlled merge.

## Round 2 (resume, after the revision and the confidence round)

conditional approve

- **Condition 1 — corrected lifecycle evidence: no, not fully.** The five-minute live-frame soak is now valid (`spike/results.jsonl:75–76`). But a new **[High] false-success risk** undermines recovery claims: `spike/spike.patch:734` awaits `waitForPgResult()` then returns `"ok"` without checking status. That helper resolves for **both success and error** (`apps/extension/tests/e2e/fixtures/playground.ts:93`). Assert `assertPgOk` for capability requests and sends; preserve their results in the evidence. Existing `"outcome":"ok"` records alone prove settlement, not successful recovery.

- **Condition 2 — failure/performance gates: no, nearly.** The proposed failure cases and visibility gate are appropriate, but add stale-PONG coverage and correct the manifest gate below. The permanent restart spec must assert successful transaction results, changed background/PXE identities, and exactly one host—not merely print them.

- **Condition 3 — recorded owner acceptance: no.** A1–A4 remain unanswered asks (`plan.md:279–283`). This audit cannot supply the owner’s UI, scope, and lifetime acceptance.

- **[Medium] READY generation is sound with qualifications.** Retain extension-ID/path authentication, require a connected tracked frame, compare its generation, and reject missing/malformed URLs without throwing. Firefox’s captured URL supports this. However, `plan.md:245` overlooks a **PONG sent before removal but delivered afterwards**; `offscreen.ts:181` still accepts it by path alone. Apply generation matching to PONG too. Generation identifies the host; a probe nonce would additionally identify the particular health check.

- **[Medium] The manifest gate tests the wrong artifact.** `manifest.test.ts:5–6` imports source configuration; its own comment at `:34` acknowledges build-generated web-accessible resources. This does not satisfy `plan.md:231`’s promised built-manifest check. Check the generated manifest excludes the PXE HTML, including wildcard matches; do not require all generated resources to disappear.

- **[Medium] Narrow the interruption claims.** `spike/spike.patch:825` waits 15 seconds **after approval**, without confirming proving is active. The balance delta at `:848` is logged, not asserted. It demonstrates one net transfer during observation, not independently which attempt landed. Record/assert the recovery receipt and proving phase; say “no additional transfer observed,” not “never lands.” Likewise, “never settles” means “unsettled after 180 seconds.”

- **Visibility is defensible**, not a dodge: it directly guards this host regression without noisy timing limits. It is not a universal speed guarantee. I would not insist on Windows, private-window, reload/update, or masked-preference gates for this bounded change. Keep macOS verification and qualify the lifetime as **at most** the background’s lifetime: health checks can replace frames earlier.

Confidence: **high** on code/evidence findings; **moderate** on queued-message timing.