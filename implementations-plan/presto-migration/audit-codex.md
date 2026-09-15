# audit-codex.md — Codex (GPT-6 Astra, `high`, read-only) audit of plan.md v1

Round 1, 2026-09-15. Prompt: the full packet (adversarial/security review, attack the Assumptions,
critique the Architecture & Implementation, pick between the two outlines), with the owner's UX
decisions and repo rules as context. Response pasted verbatim below; every factual claim was then
verified against source before folding into plan.md v2 (see the Decision ledger there). Line
references are repo-relative or name the Presto repo file.

---

reject (with blocking findings: uncorrelated proving events, incomplete journal schema changes, overstated transport guarantees, and validation gates that cannot pass as sequenced)

**Confidence: high** for source-backed findings; **moderate** for browser-specific behavior requiring a real extension run. This is a source review; I did not execute builds or tests.

## Security

- **High — §A / transport policy:** The negative-grep proves absence of a build stamp, not absence of plaintext proving. `presto-core/config.ts` explicitly allows `PRESTO_HTTPS_ONLY` to override the browser default, and the proposed public options admit `httpsOnly:false` in default mode. **Fix:** explicitly set `httpsOnly:true` in production clients; derive the CI exception from required mode internally instead of exposing an independent switch. Keep both stamp checks, and add a production-policy test proving HTTPS failure never sends an HTTP `/prove`.

- **High — Security / port squatting:** HTTPS reduces the threat but does not authenticate the Presto application. Browser fetch accepts browser-trusted certificates; it does not pin Presto's CA. Furthermore, Presto's `certs.rs` persists the leaf private key with owner-only permissions: another process running as that owner may read it and impersonate the server. **Fix:** state the bounded guarantee—protection against squatters lacking a usable trusted certificate/key—and explicitly retain same-user malware and compromised trust stores as residual risks. Name constraints constrain certificate names, not process identity.

- **Medium — §F / message channel:** `sender.id === chrome.runtime.id` does not establish "sent by our offscreen document"; content scripts also use internal runtime messaging. Validate the expected offscreen URL/document identity, message schema, and active proving attempt. Do not accept arbitrary journal identifiers without matching them to a registered attempt. [Chrome messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)

- **Medium — §B / binary installation:** Checking a release-controlled sidecar before unrestricted extraction does not extend the repository's binary pin to other archive entries. The pinned executable could remain unchanged while the archive contains hostile additional files. **Fix:** preferably pin the tarball too and verify before extraction; otherwise extract only the expected regular-file member into a controlled destination. Continue checking the binary on cache hits. Independently verifying the source/release relationship remains necessary when initially accepting either pin.

- **Medium — CI and npm exceptions:** `PRESTO_ALLOW_ALL=1` permits any browser page running in the job to consume prover resources. This is tolerable under the stated ephemeral-runner restriction, but it also bypasses the production authorization path. Scope it to the server process and test authorization separately. Package-name min-age exclusions cover future resolutions too; comments do not expire them—the stale accelerator exclusion demonstrates that. Record exact artifact/provenance identities and make removal an assigned, dated deliverable.

## Assumptions

### Facts

- **F1 needs qualification:** `MIGRATION.md` says the applications are separate installations requiring renewed approvals and certificate setup, while the wire protocol remains compatible. An old Accelerator can therefore answer a new Presto client. A healthy endpoint does not prove the installed product is Presto. Include coexistence/upgrade recovery instructions.

- **F8 / Security are misstated:** `banners/src/element.ts` uses `attachShadow({mode:"open"})` and `innerHTML`; its anchors use `noopener`, without `noreferrer`. This is privileged extension code, not a sandbox. Constant links and upstream escaping look reasonable, but review the actual rendering surface.

- **F11 is incomplete:** Widening the TypeScript union alone is insufficient. `apps/extension/src/wallet/services/operation-journal/spec.ts:184` has a separate Zod proving schema without `backend`; parsed records will lose that field. Include this schema and persistence/RPC round-trip tests in the change map.

- **State semantics are overstated:** `needsDownload` means a download is needed, not underway. `unconfirmed` also covers dismissed prompts and obscured requests, not just absence. Minimal `/health` can report availability without proving origin approval or exposing versions. Keep the approved visual states, but avoid copy asserting those stronger conclusions.

### Inferences

- **I1 is unsafe and duplicates upstream behavior:** `presto-transport.ts` already queries `loopback-network`, falling back to `local-network-access` only when unsupported, after a failed request. A page-side short-circuit can report blocked despite a successful host-permitted extension request. Remove the short-circuit; retain the SDK diagnosis. Chromium's extension guidance supports the host-permission exemption. [Chromium discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk)

- **I3 is already falsifiable:** `fsm.ts` rejects `proving → proving`, and the journal calls that guard directly. Plan a narrowly scoped backend update under the existing transition lock; preserve timestamps and ignore updates after proving ends.

- **I7 confuses reachability with correctness:** READY proves that messaging works, not reliable attribution, ordering, or lifetime during proving. `sendMessage` returns a promise and can reject. Telemetry failures must never affect proof generation.

- **I4/I5 remain browser acceptance risks:** The Mac HTTP-disabled check does not establish Firefox behavior or Linux certificate trust. Neither does it verify that "site permissions beside the address bar" is an operable recovery path in an extension popup.

### Asks

- Surface the remaining behavioral decision: how Settings explains **Presto origin denial** when `/health` still reports available. Its Retry only checks health; it cannot establish that `/prove` approval was restored.

- A3 is optional recognition UX, not a launch prerequisite. Verify the actual origin header and approval display during the first real proof; a canonicalization function alone does not prove browser integration.

- A4 needs a measurable bundle budget or reported dependency graph. Listing onboarding-named assets misses shared chunks and does not prove absence of `@aztec/*`.

## Implementation

- **High — §F needs request correlation.** Locks are per **profile and chain**, not merely chain. Delayed events can arrive after cancellation/completion or during another operation; the proposed observer signature does not even carry chain identity. Thread an opaque attempt identifier through the prove RPC, register its journal target before dispatch, and clear it in `finally`. Bind callbacks while that attempt owns the PXE operation. Route validated messages through extension wiring into an injected coordinator observer.

- **High — "first message wins" produces false subtitles.** Presto can emit `transmit`, then fail and fall back to WASM. It can also emit `proved` before discovering an unreadable/undecodable response and falling back. Apply backend changes throughout the active attempt; `proved` neither identifies the backend nor establishes operation completion. Test `transmit → fallback`, late events, cancellation, and overlapping profiles/chains.

- **Medium — observer failures need isolation.** Wrap production observation so synchronous exceptions and rejected sends cannot abort proving. Keep required-mode enforcement separate. Throwing on `secure-connection-unavailable` and `version-mismatch` is valid: those diagnostic emissions occur outside the SDK's transport catch. The final `fallback` guard remains essential for other failure paths.

- **Medium — composable contract:** `PrestoClient` has no public abort/dispose API; P5 cannot honestly promise cancellation of its network probe. Ignore stale completions after disposal. Follow C1's injected-client/function pattern where applicable, and define whether caching is per component or shared per page context. Separate composable instances do not share the SDK's ten-second cache.

- **High — phase gates and arc boundary are broken:**
  - P2 deletes accelerator config while the old onboarding composable still imports it; its typecheck and zero-residue gate cannot pass before P5/P6.
  - P5 deletes that composable before P6 replaces its consumer.
  - Arc 1 switches to HTTPS before P5 adds the HTTPS host permission.
  - P8 runs `e2e:agent` from the extension package, which has no such script; invoke the root script.
  - "`data-backend` present when known" can pass with every backend unknown. Require exact native and fallback subtitles.
  - Add a real tray approval/denial/recovery test and a production-policy no-HTTP-proof test. The HTTP allow-all canary establishes neither.

## Competing outline

Choose the **page-side client**, retaining all approved UX. Onboarding should not require an initialized PXE. The competing outline unnecessarily couples offscreen status routing with dropping requested features.

Prefer **one coherent delivery arc** here. Two arcs are defensible only after moving permissions and compatibility fixes into arc 1 so each independently builds and works. Keep the proving-event implementation explicitly correlated; a new general event framework is unnecessary.

## Looks fine

- Explicit `WASMSimulator`, heavy SDK offscreen, lightweight status client in pages.
- Witness-free HTTP diagnosis with production HTTPS proving.
- Existing shells, pure subtitle helper, and no storage migration.
- Binary verification on cache hits and prover-ON canary evidence.
- Approved banner placement and popup design require no visual reconsideration.

---

## Driver verification (before folding)

Every claim above was checked against the worktree at `323380f6` + plan v1 and the Presto clone at
`6051b11`. All source-backed claims held. Notes:

- Transport policy — confirmed: `sdk-core/src/lib/config.ts` lets `PRESTO_HTTPS_ONLY` override the browser default; v2 passes `httpsOnly: true` explicitly in default mode and confines `httpsOnly: false` to the `required` arm's type.
- Port squatting — confirmed: `presto/core/src/certs.rs` writes the leaf key to disk (0o700 dir, CA key in memory). v2 states the bounded guarantee.
- Message channel — confirmed and stronger than stated: `packages/extension-messaging/src/offscreen/client.ts:60` filters events by `message.from === this.service` and never inspects `sender`; v2 adds a sender gate there.
- Journal — confirmed: `operation-journal/spec.ts:184` Zod proving schema lacks `backend`; `fsm.ts:46` has no `proving → proving`; `service.ts:316` asserts on every transition.
- Locks — confirmed per `(profileId, chainId)` in `execution-mutex.ts`; the SW marks `proving` (`execution-coordinator.ts:196`) before the offscreen lock.
- `e2e:agent` — root `package.json:22` only.
- `PrestoClient` — no abort/dispose API (`sdk-core/src/lib/presto-client.ts`).
- Health tiering (raised by Fable, relevant to "state semantics") — `presto/core/src/server.rs:415-445`.


---

# Fresh-context final pass, round 1 (on plan v2 + ledger) — 2026-09-15

New session, no memory of round 1. Prompt: the ledger-soundness, adversarial, assumptions, phases/gates and simplicity asks over v2, `audit-fable.md` and this file. Response verbatim (paths repo-relative). Verification notes and the v3 disposition follow.

reject (with blocking findings: denial state is overwritten, proving subtitles remain hidden, Firefox events fail the sender gate, correlation plumbing is incomplete, and phase gates contradict the claimed sequencing)

**Confidence: high** for source-backed findings; **moderate** for browser acceptance risks. Reviewed sources and both audits; no builds or tests executed.

## Ledger

- **D2 — independent shipment is asserted, not established.** Arc 1 retains onboarding’s HTTP probe, Accelerator download link, and old recovery instructions while production requires HTTPS. An HTTP-healthy installation can appear active while proving falls back. Move the minimum transport-aware onboarding compatibility changes into arc 1, or deliver one arc.
- **D3 — journal choice is reasonable, but rendering is unresolved.** [`cardSubtitleFor`](apps/extension/src/popup/components/modules/general/RecentActivityView.vue:429) returns the active task’s `"Generating proof..."` before calling `stageSubtitle`. Passing `backend` only to the latter leaves the ordinary single-operation case unchanged. Give a known proving backend priority over task decoration.
- **D5 — correct security principle, incorrect Firefox predicate.** Firefox opens the offscreen page with `?instance=<token>`; exact equality against the query-free URL rejects legitimate events. See Security.
- **D6 — identifier strategy is sound; the implementation path is incomplete.** `proveTxTask` receives no journal ID; the four callers retain it behind `markJournal` closures. Neither executor appears in the change map. Also, the factory observer receives only `{proveId, phase}`, insufficient for the proposed forwarder to add runtime coordinates. Specify the ID handoff, coordinate capture, client event generic, and bootstrap wiring: `createPxeOffscreen()` currently returns `void`.
- **D17 — does not resolve either audit’s denial finding.** §F overwrites `lastProveOutcome` on **every phase**. Actual denial proceeds `denied → fallback → proving → proved → receive`; Settings therefore sees `receive`, not `denied`. Preserve denial independently of progress; retain it through cooldown attempts, and clear it only after confirmed native success. Test that entire sequence.
- **D19 — budget is concrete, measurement is premature.** P6 adds unused modules; P7 introduces their onboarding consumers. A green P6 measurement can measure zero added code. Measure after P7, using the actual reachable module/chunk graph; string-grepping `@aztec/` cannot establish dependency absence.

Thus the ledger’s “all resolved” disposition is premature. D2’s claimed concession depended on compatibility fixes that remain incomplete.

## Security

- **Medium — sender authentication breaks legitimate delivery.** [`offscreen.ts:279`](apps/extension/src/wallet/utils/offscreen.ts:279) appends Firefox’s instance token. Validate the extension identity and exact page path while explicitly handling that query parameter; test the real URL shape and stale-instance behavior. Keep the web-content-script rejection. Add runtime payload validation; TypeScript event types do not validate messages.
- **Medium — D13 still trusts archive/cache structure.** Rejecting “other regular files” does not reject a symlink, hardlink, or duplicate named `presto-server`. Require one regular executable member and reject links/duplicates before extraction. Cache only the intended executable, or reject unexpected restored entries before adding its directory to `PATH`. Initial hashes calculated beside a same-origin sidecar establish a pin, not independent source provenance.
- **Medium — P1 names an unestablished provenance mechanism.** Presto publishes npm provenance and verifies it with `scripts/verify-sdk-package-signatures.ts`; its workflow does not show GitHub artifact-attestation publication. Bare `gh attestation verify --owner …` searches GitHub’s attestation API, not npm’s registry. Use an isolated npm signature/provenance verification fixture and bind the verified digest to the expected repository/workflow/commit. [GitHub CLI documentation](https://cli.github.com/manual/gh_attestation_verify)
- **Medium — the requested production-policy test remains missing.** P2 checks constructor arguments, but round 1 explicitly requested a real-client test showing HTTPS failure causes **no HTTP `/prove`**, including after an HTTPS endpoint previously succeeded. Add it; required-mode HTTP canaries cannot prove production policy.

The explicit production `httpsOnly:true` does defeat the environment override. The required-only type is useful compile-time protection; runtime construction must still derive policy from the mode. The bounded squatting statement is now accurate. `PRESTO_ALLOW_ALL` scoping is acceptable under the stated ephemeral-runner restriction.

## Assumptions

### Facts

- **F1–F3, F7, F9–F14, F18–F22:** the principal source-backed claims hold, subject to qualifications below. **F5/F6** agree with the headless source/tag; I did not independently retrieve release assets.
- **F4:** not every version mismatch emits `version-mismatch`. A legacy health-version mismatch reaches the generic unavailable fallback. D10 provides more precise errors only on paths that emit that phase.
- **F8:** behavior holds, but several line citations are stale at `6051b11`. **F21’s certificate source is `packages/presto/src-tauri/src/certs.rs`**, not `core/src/certs.rs`.
- **F15:** the host-permission exemption is supported by the [Chromium discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk). It does not establish that address-bar permission recovery works in extension pages or defeats managed policy.
- **F16:** the clearance times are reversed relative to the listed packages: Presto clears at **22:58Z**, core at **22:29Z**. Publication timestamps and **F17’s unset variable** remain recorded snapshots, not freshly verified facts.
- **F19:** minimal-body handling is correct **when an unapproved Origin is present**. Verify actual GET and POST headers separately; source authorization logic cannot establish browser header behavior.

### Inferences

- **I2:** appropriately deferred to published-package inspection.
- **I4/I5:** remain acceptance risks; Mac validation establishes neither Firefox nor Linux coverage.
- **I7:** a registry establishes attribution and lifetime, not delivery or ordering. State the tolerated event-loss behavior, serialize asynchronous journal updates, and test delayed delivery relative to RPC completion.
- **I8:** plausible, but `service.pxe-seam.test.ts` only checks construction and explicitly makes no RPC. Add a real codec round-trip assertion for `proveId`.
- **I9:** its fallback weakens P7’s required validation. Resolve interception feasibility before promising those gates, or provide an equivalent browser test mechanism.

### Asks

A1/A2/A3/A7 have sensible recommendations. A4 needs the corrected measurement above.

**A5** overstates reinstall instability: unpacked Chrome IDs are path-derived unless a key is supplied. A stable dev key remains useful across worktrees, but has no assigned implementation phase/gate.

**A6’s “off by default” premise is outdated:** Firefox grants requested MV3 host permissions through installation from version 127; users can revoke them. Distinguish installation, added permissions on update, and revocation. Best-effort support must not promise `permission-blocked` when the SDK may return `unconfirmed`. [Mozilla’s explanation](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/)

## Phases & gates

- **P1 explicitly allows red typechecking**, contradicting the sequencing rule and audit disposition. Combine dependency replacement with import conversion, or temporarily retain the old dependency.
- **P2/P7** correctly preserve the old composable until its consumer is replaced.
- **P3/P4:** commands exist, but soak produces `soak-N`, never a “canary lane.” Assert native subtitles inside the selected test regardless of shard label when required mode is armed. Use the actual aggregator name, `extension-network-e2e-status`.
- **P5’s residue check conflicts with required coexistence documentation** naming Aztec Accelerator. Define intentional documentation exceptions.
- **P7’s manual denial-surface check precedes P8’s Settings implementation.** Move that acceptance check after P8.
- Root/per-package test, lint, build, and actionlint scripts exist. Passing them has not been demonstrated.

## Simplicity

Keep the journal seam, correlated event, and small registry. Cut proving additions to `ShallowPxe`: it deliberately excludes proving. A coordinator-owned `Map` is sufficient unless the registry has substantive behavior. Derive CI plaintext policy from `provingMode`; the extra `httpsOnly:false` option is redundant.

## Looks fine

D1/D4/D7/D9–D12/D14/D16/D18/D20 are defensible. I could not break the SDK’s HTTPS-only downgrade refusal, witness-free diagnostic, or the banner’s constant-link/static-template rendering boundary. Journal timestamp preservation, late-stage no-ops, shared page caching, and dated min-age removal are appropriate.

---

## Driver verification (before folding into v3)

Every source-backed claim held: `cardSubtitleFor` returns the task label before `stageSubtitle` (`RecentActivityView.vue:429-444`); Firefox opens the offscreen page as `<getURL(path)>?instance=<token>` (`apps/extension/src/wallet/utils/offscreen.ts:279`); `proveTxTask` has one call site (`proveAndSend`, `execution-coordinator.ts:197`) whose `ProveAndSendContext` carries a `markJournal` closure and no journal id (`:57-72`; the lane holds `queuedJournalId`); `createPxeOffscreen` returns `Promise<void>` (`packages/aztec-runtime/src/offscreen/entry.ts:43`); the SDK's WASM fallback emits `fallback → proving → proved → receive` after `denied` (`presto-prover.ts:186-215`, `presto-client.ts:538`), so an every-phase `lastProveOutcome` loses the denial; the native path is `detect → serialize → transmit → proving → proved → receive`; `certs.rs` is under `packages/presto/src-tauri/src/`; Presto publishes with `npm publish --provenance` and verifies via `scripts/verify-sdk-package-signatures.ts` (`npm audit signatures` in an isolated fixture), not GitHub artifact attestations; F16's clearance times were reversed in v2. Firefox ≥ 127 grants MV3 host permissions at install (Mozilla add-ons blog, 2024-05-14).


---

# Fresh-context final pass, round 2 (on plan v3 + ledger) — 2026-09-15

New session again. Prompt: per-finding resolution check of r1, ledger soundness of the primed decisions, adversarial pass on v3's mechanisms, assumptions, phases/gates, simplicity. Response verbatim (paths repo-relative; Presto files prefixed `presto:`). Verification notes and the v4 disposition follow.

reject (with blocking findings: incomplete journal-ID plumbing, an incompatible arc-1 onboarding shim, incorrect event-loss semantics, and an unworkable npm provenance gate)

**Confidence: high** for source-backed findings; **moderate** for browser acceptance risks. This was a read-only review; builds and tests were not executed. References below use [plan.md](implementations-plan/presto-migration/plan.md).

## r1 findings

- **Denial overwritten — partially resolved.** Separate `lastDenial` fixes the ordinary sequence (§F:333–343), but dropped/reordered phases can falsely establish “native success.”
- **Subtitle hidden — resolved.** Known backend explicitly precedes the task label, with a component assertion (§F:344–349).
- **Firefox `?instance=` — partially resolved.** Origin/path comparison accepts legitimate URLs; the claimed stale-instance filtering is incorrect (§F:318–328).
- **Correlation: journal ID — not resolved.** §F:301–303 names the wrong context builder and assumes `queuedJournalId` is the actual journal ID.
- **Correlation: sink — resolved.** Factory observer → sink → service subscription is explicit (§F:310–317).
- **Correlation: client generic — resolved.** Both service and client receive `PxeEvents` (Interfaces:373–375).
- **Correlation: bootstrap — resolved.** `createPxeOffscreen` receives the sink as a dependency; no return-value fiction remains (§F:310–314).
- **P1 red typecheck — resolved narrowly.** Dependencies coexist until P2 (P1:597); its provenance gate remains broken.
- **Arc 1 independently shippable — partially resolved.** HTTPS probing and download destination move forward, but the shim’s stated contract is incompatible with its consumer (P2:608).
- **Archive member rules — resolved.** Exactly one regular member, no links/duplicates/extras, and restricted cache contents (§B:184–194).
- **npm provenance mechanism — partially resolved.** Correct verifier family; incorrect lockfile-only fixture (Security:509–515).
- **Production-policy test — resolved at plan level.** Real client, failed HTTPS, and previously successful HTTPS are required (P2:611).
- **P3/P4 gate semantics — mostly resolved.** §B:208–214 correctly distinguishes soak from canary; P4:630 still incorrectly says “canary lane’s console capture.”
- **P5 residue exceptions — resolved.** Identifier-only pattern permits the coexistence product name (P5:635).
- **P7/P8 manual sequencing — resolved.** Settings denial/recovery is now P8 (P8:659).
- **A4 measurement — partially resolved.** P7 measures reachable chunks, but its arc-1 baseline already includes the newly introduced client (P7:653).
- **A5/A6 wording — resolved.** Path-derived IDs and install/update/revocation distinctions are corrected (Asks:582–583).
- **I7 — not resolved.** Serializing writes does not recover missing phases or restore emission order (§F; I7:572).
- **I8 — resolved at plan level.** A genuine codec round-trip test is required (P4:625).
- **I9 — partially resolved.** Browser fallback remains required, but feasibility is checked in P6 after P2 already depends on HTTPS interception (P2:608–612; P6:646).

## Ledger

- **D2′:** Two arcs remain defensible, but independence is still asserted prematurely. P2 calls `getPrestoClient()`, introduced in P6. More seriously, the existing [composable](apps/extension/src/onboarding/composables/useAcceleratorStatus.ts:21) uses `idle | detecting | not-detected | no-bb | active`, not the proposed `checking`/`not-installed`. Returning `not-installed` leaves the existing page without its terminal Skip/download controls. Move the factory into P2, retain the exact contract, force-refresh explicit retries, and remove the false Windows-unavailable statement in arc 1. One arc avoids this temporary compatibility work; it is not inherently worse.

- **D5′:** The predicate is sound, but “stale Firefox instance … excluded by the `from`/service handshake” is unsupported. Events use the constant service name, not an instance token. Existing `OFFSCREEN_ADOPT_INSTANCE` self-closing behavior is a separate mechanism. Correct the claim and test stale-instance delivery against the active-attempt map.

- **D6′:** Contexts are built in [transfer-executor.ts:147](apps/extension/src/wallet/services/execution/transfer-executor.ts:147) and `dapp-send-executor.ts:480,584,787`, not `execution-lane.ts`. Thread the actual created/claimed `journalId` through all four callers, including the existing undefined-ID case. Also explicitly wire the coordinator’s journal callback and event subscription from `ExecutionService`; the coordinator currently owns neither dependency.

- **D17′:** Separate denial memory is justified, but “native `proved`” is inferred from potentially incomplete received history. That is insufficient; see Security. Also update `copyFor`’s contract and P6’s denial tests to consume `{outcome, denial}`, rather than the old single outcome argument.

- **D19′:** Correct measurement mechanism, wrong baseline for the total migration cost. Compare against the pre-migration build, include static and dynamic reachable imports, and enable the build manifest explicitly. A4 itself still contains the superseded P6/string-grep wording.

- **D23:** Correct alternative rejection, incomplete replacement: Presto’s verifier actually installs packages before auditing.

## Security

- **High — false backend/approval evidence under the promised loss model.** Start with a remembered denial. A cooldown attempt emits `transmit`, then `fallback` **without another `denied`**. Lose `fallback`: the subsequent WASM `proved` clears `lastDenial` because the receiver still believes the backend is Presto. A reordered `transmit` can similarly overwrite browser attribution. `transitionLock` only serializes arrival-order writes. Carry source-derived backend evidence and an emission sequence, reject stale updates, and test missing/reordered fallback explicitly. If delivery guarantees are required instead, establish and test them; do not claim loss always produces a generic subtitle.

- **Medium — provenance fixture cannot verify its targets.** Local npm 11.16’s `auditSignatures()` calls `arb.loadActual()`. A fresh `--package-lock-only` fixture has no installed dependencies to audit. Match [Presto’s verifier](presto: scripts/verify-sdk-package-signatures.ts:88): actual `npm install --ignore-scripts`, then `npm audit signatures --json --include-attestations`; require verified provenance for every exact target and bind its statement to the expected repository/workflow/commit. [npm documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/)

- **Low — cache validation should state file type explicitly.** Apply the regular-file/no-symlink requirement to cache hits too, before hashing or modifying permissions.

The mode-derived plaintext policy holds. Preserve its constructor assertions and real-client test; exercise `prove()`, including failure of a POST after cached HTTPS success, rather than merely checking health.

## Assumptions

**Facts**

- F1–F4, F7–F14, F18–F22, F24–F25 broadly match the inspected source.
- F5/F6 match the headless source and packaging workflow; I did not independently retrieve release assets.
- F15’s host-permission exemption is supported by the [Chromium discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk). It does not establish usable address-bar recovery for extension popups or managed restrictions; Algorithms:421 still overclaims.
- F16/F17 remain dated snapshots requiring the specified rechecks.
- **F23 is materially wrong about who constructs the context.**
- F24 needs a qualification: native `proved` precedes response-body reading/decoding ([client:486](presto: packages/sdk-core/src/lib/presto-client.ts:486)); it does not establish a completed usable native proof.

**Inferences**

I2 is appropriately deferred. I4/I5 are honestly identified acceptance risks; Mac success cannot establish Firefox/Linux support. I8 has a concrete resolving test. I7 remains false as described; I9 must move before P2’s dependent gate.

**Asks**

A1/A2/A3/A7 are sensible. A4 needs the baseline and wording correction. A5 is useful but requires explicit development-build presence and production-build absence checks. A6’s revised best-effort recommendation is reasonable and consistent with [Mozilla’s installation-permission change](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/).

## Phases & gates

The named package scripts, actionlint, CI-gating command and soak inputs exist. Every phase is **not yet independently passable as specified**: P1’s provenance procedure fails; P2 depends on P6 and misstates its retained contract; P4 omits the actual context callers.

P3’s observed native-proof count is acceptable as a manually inspected phase criterion. P4 must assert native subtitles in the selected soak test, without referring to a nonexistent canary shard. Move I9’s probe/fallback into P2. A5 needs an actual development-build command.

Arc 1 is not approval-ready until those compatibility and correlation fixes are explicit.

## Simplicity

The typed event, narrow journal seam, sink and coordinator-owned map are appropriate. Cut the unused profile/chain event coordinates unless they are actually checked. Keep backend/ordering evidence that correctness requires; no registry class or general event framework is needed.

## Looks fine

D3′, D13′, D21, D22 and D24 are defensible. I could not break explicit HTTPS-only enforcement, witness-free diagnosis, required-mode fallback rejection, constant-link banner rendering, journal timestamp preservation, or late-stage no-ops. Shared page caching, dismissal reset, deferred denial acceptance testing and dated exemption removal remain sound.

---

## Driver verification (before folding into v4)

Every source-backed claim held: the legacy composable's contract is `idle | detecting | not-detected | no-bb | active` (`useAcceleratorStatus.ts:21`) and `accelerator.vue` gates the download on `isWindows` (`:116,125`); `ProveAndSendContext` is built at `transfer-executor.ts:147` and `dapp-send-executor.ts:480,584,787`, each closing over a possibly-undefined `journalId` (`dapp-send-executor.ts:244`), not in `execution-lane.ts`; `ExecutionCoordinator` is constructed with `(tasks, logger, proofGate)` and `ExecutionService` owns both the `PxeServiceClient` and the `OperationJournalService` (`execution/service.ts:95,178`); events carry the constant service name, so v3's stale-instance sentence was unsupported; a lost `fallback` with receiver-side inference would indeed clear a denial on the WASM `proved` — fixed in v4 by deriving `backend` and a `seq` at the source (the runtime observer sees every phase in order) so the receiver only copies; the native `proved` precedes body decoding (`presto-client.ts:486-497`); Presto's verifier installs before auditing (`scripts/verify-sdk-package-signatures.ts:88`); `vite build --mode development` exists (`apps/extension/package.json:16` uses it for Firefox). One point not adopted: Codex's suggestion that a single arc "avoids the compatibility work" — kept as an owner choice at the gate (the shim is small, two PRs review better), recorded in the ledger.


---

# Fresh-context final pass, round 3 (on plan v4 + ledger) — 2026-09-15 — FINAL

New session again; told that a third reject sends residuals to the owner rather than producing a v5. Response verbatim (paths repo-relative; Presto files prefixed `presto:`). Verification notes and the disposition follow.

reject (with blocking findings: A4’s zero-Aztec gate conflicts with the existing router graph; P8 prescribes an unavailable denial-recovery action)

**Confidence: high** for source findings; **moderate** for browser acceptance. Read-only review; no builds or tests executed.

## r2 findings

References below refer to [plan.md](implementations-plan/presto-migration/plan.md).

- **Source-derived backend + sequence — partial.** §A/§F fixes the dropped-`fallback` and reordered-`transmit` counterexamples. The shared denial hint still has a cross-attempt ordering hole.
- **Four context builders — resolved.** §F/P4 correctly names `transfer-executor.ts:147` and `dapp-send-executor.ts:480,584,787`, preserving undefined IDs.
- **ExecutionService wiring — resolved.** §F/P4 explicitly injects callbacks and subscribes the owned PXE client.
- **Exact shim contract — resolved.** P2 preserves `idle | detecting | not-detected | no-bb | active`, `detect`, and `info`.
- **Windows note — resolved.** P2 removes both the false note and `isWindows` gating.
- **Factory timing — resolved.** `getPrestoClient()` now lands in P2.
- **Real-install provenance fixture — resolved.** Security/P1/D23′ requires actual installation, ignored scripts, verified attestations, and repository/workflow/commit binding.
- **I9 timing — resolved.** Probe and fallback now precede the dependent P2 smoke gate.
- **A4 baseline/manifest/dynamic imports — partial.** All three corrections are present; the expanded closure exposes an existing Aztec dependency that makes the absolute prohibition unachievable within the listed changes.
- **Stale-instance claim — partial.** §F removes the service-name fiction, but replaces it with another unsupported assertion: matching `proveId` does not establish “same evidence.”
- **Canary wording — resolved.** §B/P3/P4 distinguish observed soak counts from enforced canary counts and require in-test native subtitles.
- **`copyFor` pair — resolved.** §C/P6 consumes `{ outcome, denial }`.
- **Cache-hit file type — resolved.** §B explicitly checks regular file, no link, and no extra restored entries before hashing/chmod/PATH.
- **`prove()` policy test — resolved at design level.** Security/P2 includes failed POST after cached HTTPS success.
- **A5 build assertions — resolved.** P2 names development presence and production absence checks.
- **F23/F24 — resolved.** Builders and construction ownership match source; native `proved` is correctly qualified as preceding body decoding.
- **LNA recovery — resolved with acceptance condition.** Algorithms/A6 acknowledge extension permissions, managed restrictions, and platform uncertainty; actual operability remains manually gated.
- **Profile/chain fields — resolved.** §F removes unused coordinates.

## Ledger

- **D2″:** Two arcs are defensible; one arc is not technically worse. The final owner-choice paragraph is honest, but “No live dispute” earlier contradicts it. Preserve this as a reviewability preference.
- **D5″:** The sender predicate is sound. The map rejects **unknown attempts**, not stale documents independently. A matching ID requires the separate invariant that only one offscreen execution owns that attempt.
- **D6″:** The corrected builders and injection follow the source. One implementation detail remains: `withPxeWrite` currently supplies only `(pxe, node)` ([service.ts:935](packages/aztec-runtime/src/pxe/service.ts:935)); expose the locked runtime narrowly when setting `activeProve`.
- **D17″:** Correct within one attempt; insufficient for the global denial record across attempts. See Security.
- **D19″ — blocking:** Onboarding imports the shared `~pages` table ([index.ts:16](apps/extension/src/onboarding/index.ts:16)). Its generator includes popup pages ([vite.config.ts:110](apps/extension/vite.config.ts:110)), including a live `@aztec/wallet-sdk/crypto` import ([connected-app page:17](apps/extension/src/popup/pages/settings/connected-apps/[id].vue:17)). Walking **all dynamic imports** therefore includes existing Aztec modules. The rejected measurement alternatives are weaker, but the chosen acceptance premise remains false.
- **D23′:** Sound; matches Presto’s actual verifier. No remaining mechanism objection.

## Security

- **Medium — cross-attempt denial clearing.** Attempt A emits native `proved`, delayed in transit. A newer attempt B emits `denied`, which arrives first. A’s delayed event then clears B’s denial because sequence checks are per attempt. Both maps can remain live because native `proved` precedes body reading. Small conservative fix: capture a denial generation at attempt dispatch and clear only if no newer denial was observed; test this interleaving.
- **Medium — nonexistent recovery, blocking P8.** Presto’s Settings lists approved origins and offers **Remove**, not Allow ([settings.js:90](presto: packages/presto/src-tauri/frontend-src/settings.js:90)). Denial saves no approval. Change §E/P8 to: wait out the 30-second cooldown, send another transaction, then choose Allow in the new prompt. Health Retry cannot perform this recovery.
- **Low — overclaimed evidence.** Events carry cumulative **backend**, not cumulative denial evidence. Losing `denied`, or receiving a higher sequence first, can hide that denial. State this explicitly. Likewise, native `proved` is historical evidence of an accepted response, not proof that approval remains current.
- **Implementation condition:** Keep sequence acceptance and in-memory hint changes synchronous before awaiting journal writes; catch rejected journal updates. Source-side observer isolation alone does not handle receiver-side promise rejection.

The sender gate, Zod validation, restricted archive extraction, cache verification, provenance fixture, and HTTPS policy are otherwise appropriately bounded. Remaining trust includes the authenticated extension context, SDK phase semantics, certificate store, publisher identity, and initially accepted binary pins.

## Assumptions

**Facts**

- F2–F4, F7–F14, F18–F22, and F25 broadly match the inspected source.
- F1’s rename table holds, but “migration is a rename” understates additional behavior: `MIGRATION.md` also documents newly thrown `PrestoHttpError` cases.
- F5/F6 match source and packaging descriptions; release asset bytes were not independently retrieved.
- F15’s host-permission exemption is supported by the [Chromium discussion](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/pUDh8RiTjJk).
- F16/F17 remain dated snapshots, correctly scheduled for rechecking.
- F23/F24 are corrected. F24’s unusable-response qualification matters.
- Recon’s “onboarding imports no Aztec code” must distinguish direct imports from the complete reachable graph.

**Inferences**

- I2 is appropriately deferred.
- I4/I5 remain explicit Firefox/Linux acceptance risks.
- I7 overstates both cross-attempt ordering and cumulative denial evidence.
- I8 has a concrete codec test; the generated `PXEProxy` already forwards trailing arguments.
- I9 now has the right sequencing and a browser-level fallback.

**Asks**

A1/A2/A3/A5/A7 are sensible. A6’s installation/update/revocation distinction agrees with [Mozilla’s explanation](https://blog.mozilla.org/addons/2024/05/14/manifest-v3-updates/).

**A4 requires an owner decision:** fund isolation of the onboarding dependency graph, or approve a migration-specific “no newly introduced Aztec modules” criterion alongside the total gzip budget. The implementer must not silently weaken the existing gate.

## Phases & gates

The named package scripts, actionlint, CI-gating command, and soak inputs exist. **Every phase is not independently passable as written:**

- **P2:** The policy test imports `PrestoClient` inside `aztec-runtime`, which does not directly declare `presto-core`; the SDK does not re-export that class. Add an explicit test dependency or relocate the test to the extension workspace.
- **P7/P8:** Build **before** smoke tests. The smoke setup only checks an existing `dist/chrome/manifest.json`; it does not rebuild. Current ordering tests the preceding phase’s artifact.
- **P7:** A4 blocks as described above.
- **P8:** Replace the unavailable Settings→Allow recovery action.
- **Arc 1:** Its dependency/permission/status-contract ordering now works. Carry two copy fixes: `active` must not promise native proving before approval, and `no-bb` must not imply merely waiting downloads the binary. Native usability still needs real-tray acceptance if arc 1 ships separately.

## Simplicity

§F is close to minimal: typed event, source backend, sequence, small map, and narrow journal seam. Keep those. Add only the conservative denial-generation guard; no general event framework is warranted.

## Looks fine

I could not break per-attempt backend attribution with lost fallback or reordered transmit, unknown-attempt rejection, journal timestamp preservation, late-stage no-ops, explicit HTTPS-only proving, required-mode fallback rejection, or the revised provenance procedure. The remaining blockers concern concrete acceptance and recovery behavior; surface them to the owner under the third-pass rule.

---

## Driver verification and disposition (v4.1 — the gate version)

Both blockers verified: `apps/extension/src/onboarding/index.ts:16` imports the shared `~pages` table, whose generator (`vite.config.ts:110`) includes the popup pages, and `popup/pages/settings/connected-apps/[id].vue:17` imports `@aztec/wallet-sdk/crypto` — so the onboarding entry's dynamic closure reaches Aztec code before this plan touches anything; Presto's Settings renders approved origins with a Remove control only (`presto: packages/presto/src-tauri/frontend-src/settings.js:80-110`), and a denial stores nothing, so the only recovery is the next prompt after the 30 s cooldown. Also verified: `withPxeWrite`'s callback receives `(pxe, node)` (`packages/aztec-runtime/src/pxe/service.ts:935`); `aztec-runtime` does not declare `presto-core`; the smoke global setup only checks that `dist/chrome/manifest.json` exists (`tests/e2e/global-setup-smoke.ts:38-40`); `MIGRATION.md` §B7 documents the typed `PrestoHttpError`.

Disposition: the two blockers are acceptance criteria, not designs, and both need the owner — filed as **A8** (Aztec criterion for the onboarding closure: migration-scoped "no newly reachable Aztec module" vs funding an isolated onboarding router) and **A9** (acknowledge wait-and-resend as the only denial recovery). The Medium (cross-attempt denial clearing) is fixed with a denial generation captured at dispatch (D17‴). Every stated condition is folded: policy test relocated to the extension workspace, build before smoke in P2/P7/P8, the two shim copy lines, the locked runtime exposed for `activeProve`, synchronous receiver updates with caught journal writes, the non-cumulative-denial statement, the "no live dispute" wording. No fourth pass: Codex's own closing line asks for exactly this.
