# Codex audits — firefox-first-class-spike

## Round 1 — plan v1 (2026-09-18)

GPT-6 Astra at `high`, read-only. Full audit packet: adversarial, assumption attack, implementation critique, competing outlines. Response verbatim; the adopted-vs-rejected log is in `plan.md` → Decision ledger.

reject (with blocking findings: unsafe CI dispatches, incomplete browser lifecycle ownership, behavior-changing page discovery, and invalid validation gates)

Confidence: **high** for source-backed findings; **unknown** for untested Firefox behavior. Read-only review; no builds or tests executed.

Paths: `E` = `apps/extension`; `T` = `E/tests/e2e`; `W` = `.github/workflows`; `P` = `implementations-plan/firefox-first-class-spike/plan.md`.

## 1. ADVERSARIAL / SECURITY

- **[High] Dispatch validation is unsafe and tests the wrong source.** The nightly command omits `dry_run=true`; publishing defaults on. Even dry runs share `concurrency: nightly`, potentially cancelling a real publishing run. Nightly checks out resolved `origin/dev`; release resolves the supplied tag—not the feature commit. Use an isolated, non-publishing validation workflow bound to the candidate SHA. (`P:164`; `W/nightly.yml:51,58,93,405`; `W/release.yml:173`)

- **[High] Advisory isolation needs more than separate check names.** Reusable-workflow caller jobs cannot take the proposed job-level `continue-on-error`; the `rp-host-live` example is an ordinary job. Existing log artifact names also collide across browsers, potentially failing Chrome uploads. Keep Firefox outside required dependencies, preserve failures visibly, and namespace artifacts/cache/concurrency by browser. (`P:159`; `W/nightly.yml:255`; `W/_extension-smoke-e2e.yml:111`; `W/_extension-network-e2e.yml:348`)

- **[High] Loopback does not isolate hostile local processes.** Either accept trusted host co-tenants explicitly or run automation in an isolated environment. Register every session separately: the existing ownership record has three service PID slots, while tests launch additional browsers. Require bounded requests and cleanup in `finally`, including partial startup failures. (`P:174,177`; `T/lockfile.ts:56`; `T/network/account-balance-orphans.test.ts:155`)

- **[Medium] PRF fallback preserves UV and credential restriction, but can lose identity.** `runGet` permits missing `userHandle`; returning it directly discards the known creation handle, causing profile creation to allocate another ID. Preserve that handle and test cancellation, credential restriction, and missing-handle assertions. No demonstrated cryptographic downgrade. (`E/src/wallet/utils/passkey-ceremony.ts:79,89,122,138`; `E/src/wallet/services/profile/service.ts:739`)

- **[Medium] Supply-chain gates are incomplete.** Pin `web-ext` instead of executing unversioned `bunx`; explicitly verify the Firefox version selected. Guard both soft-token preference names in shipped artifacts. Presto-required belongs in test builds: production already rejects its marker. (`P:121,175,178`; `W/_build-extension.yml:131`)

## 2. ASSUMPTION ATTACK

- **[High] Facts:** Your stated check names conflict with the tree. Workflows produce `extension-smoke-e2e-status` and `extension-network-e2e-status`; CLAUDE documents dev’s cutover and main’s outstanding migration. Reconcile this before touching CI; do not rename anything implicitly. Fact 1 also describes the pre-fix baseline, not current source. (`CLAUDE.md:71`; `W/pr-extension-smoke-e2e.yml:131`; `W/pr-extension-network-e2e.yml:248`; `E/src/wallet/utils/passkey-ceremony.ts:109`)

- **[Medium] Inferences:** I1 remains unproved for hardware authenticators. I2 is behaviorally unsafe—see below. I3 needs actual discovery/approval, as proposed. I4 is under-tested: reading a balance does not demonstrate native proving; require a transaction and Presto activity. I5 is false. I6 remains unknown; advisory status and cancellation do not reserve runner capacity. (`P:129–131,200–205`; `W/_extension-network-e2e.yml:300`)

- **[Medium] Asks:** A1–A3 remain owner decisions; evidence from Firefox 153 does not establish the proposed minimum of 150. A4’s whole-test skip is already decided. Additional skips or shrinking to smoke need explicit approval, not merely a logged reason. (`P:133,151,208–211`)

## 3. IMPLEMENTATION CRITIQUE

- **[High] `pages()` is not a mechanical substitution.** `waitForPopup` uses URL novelty, not identity; preserve request-ID matching and frame readiness. `callExpectingNoPopup` retains creation events, catching transient windows that snapshots miss. `countVerifyWindows` becomes asynchronous, requiring caller changes. Journal discovery currently catches failures per target; retain that resilience. Keep #624 interception on held CDP targets—page discovery cannot replace pre-navigation arming. (`T/fixtures/popups.ts:35,52,425`; `T/fixtures/playground.ts:239`; `T/fixtures/journal.ts:147`; `T/network/session-reconnect-flood.test.ts:49`; `T/helpers/rpc-intercept.ts:24,113`)

- **[High] Teardown contract is missing.** Existing callers use `browser.close()`, while the shim swallows `session.end`. Add one idempotent context disposer and migrate every caller. Preserve caller-owned profiles across relaunches; unconditional removal breaks migration. Also attach before calling `browser.pages()`—the numbered sequence reverses those steps. (`T/fixtures/extension.ts:531`; `T/migration.test.ts:120,131`; `P:76–78`)

- **[High] Coverage/gates are wrong.** Heavy lanes are not generally Chrome-only. Preserve portable heavy tests and real-proving canaries alongside proverless shards. One arbitrary Chrome shard cannot validate shared popup changes. Run the complete Chrome topology before accepting the refactor. The CI-gating test imports `bun:test`: use `bun run test:ci-gating`. `lint` does not execute the pre-commit path guard. (`W/pr-extension-network-e2e.yml:169,192,213,241`; `E/scripts/e2e/agent.sh:78`; `scripts/ci-cd/behavior-gating.test.ts:13`; `package.json:26,35`; `.githooks/pre-commit:4`)

- **[Medium] Arc 3 is not independently revertible beneath dependent arcs.** Probes also require Firefox launch/build plumbing before its scheduled implementation. Establish minimal plumbing first; keep temporary probes outside normal suite discovery. (`P:135,139,221–223`)

## 4. COMPETING OUTLINES

- **[Medium] Prefer D:** shared test bodies with browser-specific launch, disposal, and discovery implementations; initially preserve Chrome’s target logic. Hybrid-always is reasonable for Firefox; Puppeteer-only cannot replace the verified authenticator path. B violates full-suite parity; C lacks evidence justifying another driver. Env selection is adequate—projects are optional, not inherently simultaneous. (`P:105–108`; `T/fixtures/passkey.ts:113`)

**Looks fine**

- **[Low]** Chrome-only background-kill/CDP-interception exceptions (`P:18`; `T/helpers/rpc-intercept.ts:84`).
- **[Low]** PRF-required failure behavior and manifest decisions remaining explicit (`E/src/wallet/utils/passkey-ceremony.ts:131`; `P:208–210`).

## Final fresh-context pass — plan v2 (2026-09-18)

New session, GPT-6 Astra at `high`, read-only. Given plan v2, the decision ledger, recon and both round-1 audits. Response verbatim.

reject (with blocking findings: ineffective validation gates, insufficient PR-workflow permissions, and completion before the owner’s done line)

Confidence: **high** for source-backed findings; **unknown** for untested Firefox behavior. Read-only; no builds or tests executed.

Paths: `P` = `implementations-plan/firefox-first-class-spike/plan.md`; `E` = `apps/extension`; `T` = `E/tests/e2e`; `W` = `.github/workflows`.

## 1. ADVERSARIAL / SECURITY

- **[High] The proposed permissions break the copied PR detector.** `contents: read` alone does not authorize dorny’s PR-files API path. Retain `pull-requests: read`, preferably scoped to `changes`; this requires no write permission or stored secret. (`P:164,183`; `W/pr-extension-smoke-e2e.yml:18,38`; `W/pr-extension-network-e2e.yml:24,44`.)

- **[Medium] Trusted co-tenants is defensible, with limits.** It explicitly excludes malicious host processes; it does not mitigate them. Disposable profiles and unfunded keys make that acceptable for this tooling. The comparison with a debugging pipe is misleading, and trust does not prevent accidental cross-agent kills. Stale PID records need process-identity verification before signalling, and teardown must confirm exit before deleting profiles. Existing orphan cleanup checks only PID liveness. (`P:59,181`; `T/lockfile.ts:100,113`.)

- **[Medium] Advisory isolation is plausible, not absolute.** Distinct names, concurrency groups and artifact namespaces remove direct coupling. Shared reusable workflows/actions can still break Chrome, and shared runner capacity remains coupled. Namespace cache **restore prefixes**, too—the current Puppeteer prefix is browser-independent. Phase 3 dispatches legitimately emit required **Chrome** checks; bind acceptance to the tested SHA and invalidate it after changes. (`P:88,132,163`; `.github/actions/setup-puppeteer/action.yml:10`; `W/pr-extension-network-e2e.yml:157,248`.)

## 2. ASSUMPTION ATTACK

- **[Medium] Facts:** The 36-close/16-file count checks out, but those sites include a standalone Puppeteer script with no `ExtensionContext`; migration is not uniformly `ctx.close()`. The interface actually exposes `cleanup()`, not the claimed `dispose()`. “CI runs retry: 0” is false for smoke, which hardcodes two retries. (`P:64,130,132`; `T/scripts/check-derivation-parity.ts:60,207`; `T/fixtures/passkey.ts:102`; `E/vitest.e2e.config.ts:41`.)

- **[Medium] Inferences:** Pinned UUID plus storage retention is a reasonable experiment, not proof of equivalent restart semantics. Probe R should verify migration execution and onboarding behavior after temporary reinstallation, not merely surviving storage. Installation itself triggers onboarding. Capacity inference 6 has no probe despite the ledger’s claim. (`P:142,213,287`; `T/migration.test.ts:114,131`; `E/src/wallet/index.ts:30`.)

- **[Medium] Asks:** A3 and A6 require explicit implementation branches: choosing ESR support or explanatory copy adds product behavior and validation absent from the phases. “Two prompts” should describe the fallback path, not every Firefox authenticator. Keep these owner decisions pending. (`P:118,124,219,222`; `CLAUDE.md:55`.)

## 3. IMPLEMENTATION CRITIQUE

- **[High] The static seam guard will never run.** Its proposed location is excluded from units and absent from their include list. Put it under `scripts/**/*.test.ts`; scope it to executable usages, excluding itself and explicitly handling standalone tools. Another missed URL exists in `network/session-profileSwitch.test.ts:36`. (`P:130`; `E/vitest.config.ts:34,48`.)

- **[High] Phase 6 does not reproduce CI.** Its dedicated-lane command omits proverless mode even for `concurrent-sendtx-confirm`, whose barrier requires it. Real-proving commands also omit CI’s Presto-required configuration. Specify commands per lane, including retry policy. Other named scripts exist or are explicitly introduced. (`P:146,156`; `W/pr-extension-network-e2e.yml:195,216`; `W/_extension-network-e2e.yml:122`; `T/fixtures/proof-gate.ts:11`.)

- **[Medium] Ownership needs a concrete contract.** Per-launch records are preferable to extending singleton `OwnedState`, but `resolve-ports.ts` is a bind-and-release allocator—not the claimed shared registry. Specify per-launch reservations and crash recovery without copying the singleton state-file pattern. (`P:69,74`; `E/scripts/e2e/resolve-ports.ts:8,184`; `T/lockfile.ts:56`.)

- **[Medium] Probe T’s failure branch remains underspecified.** Preserve transient-window detection, request identity, readiness and synchronous diagnostics; “same signatures” alone guarantees none of these. (`P:138`; `T/fixtures/playground.ts:239`; `T/fixtures/popups.ts:35`; `T/fixtures/journal.ts:298`.)

- **[High] Completion contradicts acceptance.** Post-merge observation is honest only while status remains pending. `P:251` marks completion before nightly/release evidence required by `P:15,170`. Six arcs work top-down; arc 1 cannot be functionally reverted independently while Firefox passkey acceptance remains expected (`P:226`; `recon.md:44`).

## 4. THE LEDGER

- **[Medium] Fully specified at plan level:** rows **2,6,7,8,11,12,14,16,17**. **Partial:** **1** completion; **3** finder semantics; **4** seam adoption; **5** ownership; **9–10** lane gates; **13** independent-revert exception. See findings above and `P:267–283`.
- **[Low] Rejections 15,18,19 are reasonable:** bundle grep adds little; cross-workflow `needs` is unavailable; Firefox must not report under Chrome’s required names. Row 19 does not prohibit genuine Chrome dispatches. (`P:281,284–285`.)
- **[Medium] No entire round-1 topic disappeared**, but discovery-contract details were compressed away; “all adopted” overstates resolution (`audit-codex.md:35`; `audit-fable.md:18`).

**Looks fine**

- PRF restriction + credential equality + original handle, preserving required UV (`P:118`; `E/src/wallet/utils/passkey-ceremony.ts:79,89`).
- Whole-file Chrome exceptions and geckodriver hash verification.
- Browser seam rather than a second test framework.

## Re-review of plan v3 — same session resumed (2026-09-18)

conditional approve (with conditions: finish the executable validation commands and add Firefox-specific trigger coverage)

Confidence: **high** for source-backed findings. Read-only; no tests or builds executed.

Paths: `P` = `implementations-plan/firefox-first-class-spike/plan.md`; `E` = `apps/extension`; `T` = `E/tests/e2e`; `W` = `.github/workflows`.

## 1. ADVERSARIAL / SECURITY

- **[Medium] Firefox-only CI edits can escape their own tests.** “Same path filters” copies filters containing the Chrome caller filenames, without the new Firefox callers or `setup-geckodriver`. A subsequent Firefox-workflow-only PR could report success through skipping. Add both Firefox workflow paths and the geckodriver action to the relevant filters, and pin this coverage in `behavior-gating.test.ts`. (`P:171,173`; `W/pr-extension-smoke-e2e.yml:76–81`; `W/pr-extension-network-e2e.yml:82–88`.)

## 2. ASSUMPTION ATTACK

- **[Low] Facts: the revised Chrome transport claim is still false.** The fixture does not request `pipe: true`; installed Puppeteer defaults to `pipe = false` and adds a debugging port. Remove the pipe comparison rather than reversing the earlier claim. This does not invalidate the explicit co-tenant trust decision. (`P:188`; `T/fixtures/extension.ts:65–100`; `node_modules/.bun/puppeteer-core@25.8.0/node_modules/puppeteer-core/lib/puppeteer/node/ChromeLauncher.js:45,66`.)

## 3. IMPLEMENTATION CRITIQUE

- **[Medium] Phase 6’s partition and proving modes now match, but the commands remain incomplete.** CI also sets `VITE_NULO_FEE_MULTIPLIER=10`; the table omits it entirely. Firefox selection and zero retries are prose requirements rather than executable settings. Provide a common command preamble exporting `NULO_E2E_BROWSER=firefox`, `NULO_E2E_RETRY=0`, and the multiplier. Represent exclusions as an array, matching CI, rather than ambiguous scalar `$EX` expansion. Specify Presto’s origin authorization for the canary: merely running its default server does not reproduce CI’s `PRESTO_ALLOW_ALL=1`. (`P:156–163`; `W/_extension-network-e2e.yml:129,137,193,233–246`.)

- **[High] Phase 5 cannot satisfy its stated skip gate as written.** `test:e2e` neither builds nor arms migration tests. Without `NULO_E2E_MIGRATION_FIXTURE=1`, migration coverage skips; the build must also carry its matching stamp. Explicitly build the Firefox smoke artifact with the reusable smoke workflow’s flags, then run with the runner flag. Define the four files as **additional browser exclusions**, since existing conditional skips also exist. (`P:152`; `E/package.json:25`; `T/migration.test.ts:37,109`; `T/backup-migration.test.ts:45,98`; `W/_extension-smoke-e2e.yml:71–82,105`.)

## 4. THE LEDGER

- **[Medium] Row 22 overstates exact CI reproduction** until the remaining command settings above are supplied (`P:299`).
- **[Medium] Inference 6 introduces an ambiguous scope escape:** “fallback (narrow their triggers)” conflicts with full per-PR coverage unless explicitly owner-approved. Label it an owner-only scope change, consistent with row 16 and the autonomous hard limit. (`P:18,224,267,292`.)

No remaining material finding against the two-state completion rule.