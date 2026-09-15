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
