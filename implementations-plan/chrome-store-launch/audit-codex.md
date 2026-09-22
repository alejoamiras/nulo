# Codex audit — chrome-store-launch

Model GPT-6 Astra, effort `high`, read-only. Inputs: `plan.md` (draft at `2ebf09c8`), `recon.md`, the repo, and the Chrome Web Store docs. Dispositions are in `plan.md` § Audit — codex. Paths are repo-relative as returned.

## Round 1 — VERDICT: reject

(Transcript pasted verbatim below; every High/Medium claim was re-verified by the driver before adoption: the v1 sunset sentence on the API page, the v2 upload/fetchStatus/publish references and enums, the `production` environment's rules via the GitHub API, `resolve`'s outputs, the Firefox stub coupling, `inject("extensionPath")` in the fixtures, `Bun.Image`'s prototype.)

---

## 1. Adversarial / security

**High — The credential boundary is asserted, not established. Confidence: high; actual GitHub settings: unknown.**  
`implementations-plan/chrome-store-launch/plan.md:95` calls `production` “reviewer-gated,” but `.github/workflows/release.yml:510` only references the environment. The current checkout at line 512 also uses the dispatch ref, while the artifact was built from `resolve.outputs.sha`.

Repository writers can dispatch a workflow against another branch. Environment restrictions apply to the workflow’s ref, not the separately supplied release tag. The plan must specify the trusted publisher-script ref and make environment reviewers, permitted refs and bypass settings explicit account-session prerequisites. Keep credentials scoped to the publishing step. Using `production` alone does not establish those protections. [GitHub dispatch rules](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [environment rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

**High — The proposed dry-run wiring can lose the safety flag. Confidence: high.**  
The plan takes `DRY_RUN` “from resolve” (`plan.md:42`), but `resolve` exports only tag, version, SHA and prerelease status (`.github/workflows/release.yml:142`). An empty output interpreted as false could publish during a requested dry run. Use the actual dispatch input, as `attach-assets` already does at line 272. Test that dry-run performs **zero token, upload or publish requests**, and that invalid boolean values fail closed.

**Medium — Dependency-free fetch is sensible; logging needs a tighter contract. Confidence: high.**  
The in-repo script avoids handing credentials to another npm package (`plan.md:55`). However, `buildRequests` contains credentials and `interpret` proposes emitting provider error text (`plan.md:40`). Require:

- No request objects, authorization headers, token responses or raw exception dumps in logs.
- Mask the newly minted access token; GitHub does not automatically register derived secrets.
- Emit bounded, sanitized operation/status errors; handle non-JSON responses without dumping their bodies.

Test error paths with recognizable fake secrets and assert their absence from captured output. [GitHub secret-handling guidance](https://docs.github.com/en/actions/reference/security/secure-use).

**Low — The selected artifact is correct, with one necessary distinction. Confidence: high.**  
`attach-assets` zips the Chrome build contents directly, then uploads both browser ZIPs and checksums (`.github/workflows/release.yml:295`, `:303`). Publish exactly `dist/release/nulo-chrome-${VERSION}.zip`, not the enclosing Actions artifact or a glob matching both ZIPs. Verify its checksum and manifest version locally. This preserves the existing build and smoke gates; rebuilding inside the credential-bearing job would weaken that provenance.

**High — “Collects no user data” is not an honest blanket disclosure. Confidence: high.**  
The proposed answer at `plan.md:36` conflicts with:

- Plaintext accounts, contacts, connected dApp sessions, balances and transaction history (`SECURITY.md:271`).
- CoinGecko learning the requesting IP and unlocked-wallet activity (`SECURITY.md:291`). The fixed query is verified in `apps/extension/src/wallet/services/price/service.ts:322`; it protects holdings confidentiality, not all user information.
- Developer-supplied dRPC defaults, including the initially active Alpha network (`apps/extension/src/wallet/services/network/service.ts:99`). “Your chosen RPC” omits the default behavior.
- RPC queries and transaction submission, including polling the original submission endpoint after a primary-endpoint change (`SECURITY.md:229`).

Google requires disclosure of local data handling too. Inventory authentication, financial, contact and connected-site data; distinguish local processing from transmissions and from developer-operated collection. “No developer analytics” is a narrower defensible statement. Include deletion/retention behavior and exported-backup handling in the privacy copy. [Google’s user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

**High — CSP does not prove “no remote code.” Confidence: high on the evidence gap; moderate on rejection risk.**  
`'wasm-unsafe-eval'` is permitted MV3 syntax; its presence is not itself a violation (`apps/extension/manifest/manifest.config.ts:41`). However, the wallet accepts dApp-supplied contract artifacts (`apps/extension/src/wallet/services/execution/service.ts:832`), registers them with PXE (`packages/aztec-runtime/src/pxe/service.ts:445`) and executes contract utility calls (`:573`).

The plan must examine and explain that execution boundary before preselecting “No.” Google explicitly discusses interpreters executing externally supplied logic, even when delivered as data. Verify packaged JS/WASM separately from contract bytecode; provide a concrete reviewer explanation instead of treating CSP as the answer. [MV3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), [remote-logic policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).

**Medium — Permission justifications are mostly sound, but set equality proves only coverage. Confidence: high.**  
`downloads` genuinely supports user-initiated exports (`apps/extension/src/utils/files.ts:61`). The content script delegates to the discovery/message relay (`apps/extension/src/content-script/content.ts:9`); describe its behavior as “does not read page contents,” rather than implying it cannot access the DOM. Explain why discovery needs arbitrary sites **and frames**: the manifest sets `all_frames: true` at line 33.

Keep the `https://nulo.sh/` permission and explain its passkey binding. Also preserve the RPC distinction: HTTPS for remote endpoints, HTTP permitted only for loopback (`apps/extension/src/wallet/services/network/spec.ts:150`). Broad permissions need behavioral justification, not merely matching paragraphs. [Store privacy-field guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## 2. Assumption attack

### Facts

- **Low — RP ID is misstated. Confidence: high.** `plan.md:107` calls `https://nulo.sh/` the RP ID. The RP ID is **`nulo.sh`**; the URL-shaped string is its manifest host permission (`SECURITY.md:26`). The build gate does enforce that relationship.

- **Medium — Fixture exports exist, but standalone reuse is false. Confidence: high.** `plan.md:113` is literally correct about exports and Puppeteer. However, `launchExtension` calls Vitest’s `inject("extensionPath")` (`apps/extension/tests/e2e/fixtures/extension.ts:37`), and the module constructs fixtures with `base.extend` at line 520. I tested a direct Bun import: it fails with **“Vitest failed to find the current suite.”** The proposed standalone screenshot command cannot consume this module unchanged.

- **Low — Bun image resizing is now verified. Confidence: high.** On installed Bun **1.4.0**, I decoded the actual 512×512 logo, resized it to 16×16, encoded PNG and decoded the result entirely in memory. `plan.md:61` can replace the weak “function exists” evidence with a working resize/encode probe.

- **Low — Rename risk is small. Confidence: high.** No literal `Nulo (V5)` selector appeared in the e2e search. Extension discovery uses the service-worker URL (`extension.ts:105`); profile registration uses test IDs (`:273`). `displayName` controls manifest/UI text, not RP ID or storage identity (`manifest.config.ts:15`, `vite.shared.ts:32`). Keep the smoke gate, but this is not an unresolved selector risk.

### Inferences

- **High — Start with API v2. Confidence: high.** The v1 endpoints in `plan.md:117` exist, but Google now states that v1 support ends **October 15, 2026**. Building new automation against it on September 7 creates an immediate migration obligation. Furthermore, the proposed v1 interpreter is incorrect: publish success is `OK`, not `SUCCESS`; `ITEM_PENDING_REVIEW` represents an already-under-review failure, not proof this ZIP was submitted. Uploads can return `IN_PROGRESS`, and publish errors use `statusDetail[]`. [V1 reference](https://developer.chrome.com/docs/webstore/api/v1).

  Use the documented v2 upload/publish endpoints, add publisher ID to the account handoff, handle upload polling and distinguish **submitted for review** from **published**. Validate returned item/version identifiers. [V2 upload](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload), [V2 publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

- **Low — ZIP layout is supported by the source. Confidence: high.** `.github/workflows/release.yml:295` places `manifest.json` at archive root, matching Google’s requirement. Store acceptance of permissions, code and version remains separate from archive layout. [Packaging requirements](https://developer.chrome.com/docs/webstore/prepare).

- **Medium — Promo composition is not demonstrated by resize support. Confidence: high.** `plan.md:32` assumes canvas creation/compositing. The installed `Bun.Image` prototype exposes resize/encode operations but no composite or drawing method. Specify an actual supported route. Existing browser tooling can render the ring, background and text; “no font rasteriser” is not a convincing limitation when Chromium is already available.

- **Medium — `Nulo V5` is viable; coexistence is not guaranteed by different names. Confidence: high on policy, moderate on future review.** The manifest name appears in the store, so the requested rename is appropriate. For V6, explain the distinct Aztec compatibility and user need; a version suffix alone does not overcome Google’s prohibition on duplicate functionality. This need not block V5, but the plan should not promise unconditional coexistence. [Manifest naming](https://developer.chrome.com/docs/webstore/prepare), [duplicate-extension policy](https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse).

### Asks

- **High — Do not default to trusted testers after the owner selected Unlisted. Confidence: high.** `plan.md:124` introduces a different audience. Unlisted permits anyone with the URL; trusted testers is private distribution. For the requested flow, preserve the dashboard’s unlisted visibility. Current API publishing preserves existing visibility; `default` does not mean “make public.” [Distribution settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [API visibility behavior](https://developer.chrome.com/docs/webstore/using-api).

- **Medium — Surface the environment controls and unresolved disclosure classification.** These require explicit account-session decisions or evidence, not silent defaults. Also clarify that the first automated update needs an appropriately increased manifest version after the manual publication.

- **Low — Name and contact are already decided.** `plan.md:15` records them; asking again adds no value. Bare-mark artwork is a reasonable reviewable design choice.

## 3. Implementation critique

**High — The marketplace workflow cannot simply keep its existing gate. Confidence: high.**  
Enabling `publish_marketplaces` also enables Firefox’s unconditional `exit 1` (`.github/workflows/release.yml:528`, `:545`), which the status aggregator treats as failure (`:585`, `:588`). Keep AMO explicitly disabled until implemented, and update the input description.

The Chrome stub also has no Bun setup (`:511`). Install pinned Bun; this dependency-free runner does not require a workspace installation. Address the workflow’s documented skipped-ancestor behavior with explicit successful dependency checks (`:184`), rather than blindly retaining line 507.

**Medium — Keep the two-file split, simplify request construction. Confidence: high.**  
The pure decision module plus injectable runner matches `scripts/release/verify-live.ts:44` and `verify-live-run.ts:71`. But constructing all three requests upfront is awkward: authenticated requests depend on the token response. Build requests where their inputs become available; keep response interpretation pure. No request framework or generic client is needed.

**Medium — Committed PNGs plus drift checking are reasonable. Confidence: high.**  
They make assets reviewable and keep builds independent of regeneration. Keep `--check` read-only and deterministic on pinned Bun. The promo tile needs the concrete composition fix above; generating icons on every build offers little benefit for four static assets.

**Medium — Screenshot automation is optional; the proposed mechanism is broken. Confidence: high.**  
Besides the Vitest import failure, a normal wrapper page cannot simply iframe the popup: only the logo is web-accessible (`manifest.config.ts:55`). Capture the actual popup first, then compose that image into the promotional frame.

For three launch screenshots, manual capture/composition is proportionate. If automation stays, use an opt-in Vitest capture run that actually reuses the fixtures. `registerProfile` creates a profile, not a funded account or pending dApp approval (`extension.ts:262`); specify how the three distinct screens are reached. This corrects the overly optimistic reuse claim in `recon.md:17`.

**Medium — Several phase gates do not execute their promised checks. Confidence: high.**

| Gate | Assessment |
|---|---|
| `check:rp-id`, `build:chrome`, `test:e2e` | Real commands (`apps/extension/package.json:8`). Smoke loads the existing build; run it explicitly after building. |
| Asset test | `scripts/**/*.test.ts` is included (`apps/extension/vitest.config.ts:39`). Appropriate. |
| Listing test | Proposed `store/listing.test.ts` is **excluded by omission** from the include list. Phase 2 also never invokes tests (`plan.md:73`). Put it under `scripts/` and run it. |
| `test:release` | Real Bun suite (`package.json:32`), already run in CI (`.github/workflows/_unit-tests.yml:27`). Add HTTP failures, malformed responses, upload-in-progress, pending-review and dry-run coverage. |
| `lint:actions` | Real actionlint command (`package.json:26`); it cannot prove credentials, API behavior or dispatch semantics. |
| Privacy preview | Existing Vite preview already supplies the site-wide CSP (`apps/landing/vite.config.ts:14`). Add a runnable browser check, rather than leaving it only in “Pass.” |

**Low — Multi-page Vite is the appropriate privacy-page change. Confidence: high.**  
`apps/landing/vite.config.ts:18` has no competing routing structure. Token-free HTML passes the existing plugin (`scripts/release-html-plugin.ts:46`), and the site-wide headers apply. Reuse CSS directly; the shared `src/main.ts:5` imports feed behavior that a static privacy page does not need. No router or shared-page framework is warranted.

**Low — Complexity budgets are realistic. Confidence: high.**  
The 80-line limit is **per production function**, not per file (`CLAUDE.md:82`). Small token/upload/poll/publish functions and flat validation fit naturally. Mirror the existing runner boundary, but do not copy its verbose workflow-history comments: `CLAUDE.md:409` explicitly rejects that style.

## 4. What you would build differently, and why

1. Implement a small **v2** publisher with bounded upload polling, safe error summaries and strict dry-run parsing.
2. Wire a **Chrome-only opt-in** path, pinned Bun and an explicit trusted code/artifact relationship.
3. Rewrite disclosures from actual data flows, and resolve contract-bytecode interpretation before answering the remote-code question.
4. Keep committed icons and drift checking; manually compose launch artwork or use the existing fixtures through Vitest.
5. Add the privacy HTML entry and fix the missing test invocations. Preserve the existing release ZIP pipeline.

VERDICT: reject (with blocking findings: deprecated and incorrectly interpreted publishing API; unsafe dry-run wiring and unverified credential boundary; coupled Firefox failure; inaccurate data-use claims and unsupported no-remote-code conclusion)

## Round 2 — VERDICT: reject

(Resumed session over the revised plan at `4da4aa60`; every finding re-verified in the code before adoption: `release.yml:11/:184/:266/:368`, `setup-bun/action.yml:28`, `dapp-interaction/service.ts:313/:558/:627`, `offscreen/index.ts:100-122`.)

---

## 1. Adversarial / security

**High — The new environment policy would break existing releases. Confidence: high.**  
`implementations-plan/chrome-store-launch/plan.md:124` restricts shared `production` to tags `v*`. But releases run on **push to `main`** (`.github/workflows/release.yml:11`), and `attach-assets` and `refresh-landing` already use `production` (`:266`, `:368`). GitHub checks the workflow’s `GITHUB_REF`; checking out a tag’s SHA does not change it. Ordinary releases would therefore be blocked even with Chrome publishing disabled. Adding reviewers also makes those previously automatic jobs interactive.

Smallest fix: permit the intended `main` workflow ref and document that review now applies to existing production jobs. If approval should apply exclusively to Chrome publishing, use a dedicated environment for its credentials. Explicitly document the dispatch `--ref` separately from the `tag` input. [GitHub environment rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

**High — Ask 4 still proposes an explanation containing unsupported and incorrect claims. Confidence: high on confirmation behavior; moderate on store interpretation.**  
`plan.md:126` says contract execution happens “only after the user approves the request in the confirmation window.” That is not universally true: `apps/extension/src/wallet/services/dapp-interaction/service.ts:313` takes a silent execution path when confirmation is unnecessary; the decision at `:558` uses the session’s confirmation threshold. Utility execution is classified as `PrivateData` at `:627`. Prior capability approval and per-request confirmation are different.

“Isolated from extension APIs” also needs a precise technical qualification. PXE is initialized in an offscreen document that uses `chrome.runtime` (`apps/extension/src/offscreen/index.ts:100`, `:122`). A restricted bytecode instruction set may provide isolation, but that is not demonstrated merely by calling the runtime bundled or offscreen. Google specifically addresses interpreters of externally supplied logic and separately describes exempt isolated contexts.

Remove the universal claim about other Aztec wallets. Describe the actual bytecode/oracle boundary and authorization behavior, and keep policy classification unresolved until that evidence supports the answer. Owner confirmation cannot establish technical facts. [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).

## 2. Assumption attack

**Facts — Medium: the setup composite always installs dependencies. Confidence: high.**  
`plan.md:44` specifies the repo’s `setup-bun` composite while asserting “no `bun install`.” Its implementation unconditionally runs `bun install --frozen-lockfile` (`.github/actions/setup-bun/action.yml:28`).

Use pinned `oven-sh/setup-bun` directly for this dependency-free job. Otherwise the proposed security boundary unnecessarily includes workspace dependency installation before the credential-bearing step.

**Inferences — Medium: twelve polling attempts do not establish a time bound. Confidence: high.**  
`plan.md:42` specifies “12 × 10 s,” but no request timeout or polling deadline. A stalled response can consume the job timeout without completing the advertised polling sequence.

Specify abortable requests and an overall deadline. Test exhausted polling and assert that publish is never called afterward. Also explicitly fail closed on absent, unspecified or `NOT_FOUND` upload state; these are possible responses, not success. [Upload states](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/UploadState), [fetchStatus contract](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus).

**Asks — High: Ask 2 must distinguish workflow ref from release tag; Ask 4 must distinguish consent from factual verification.**  
These remain the unresolved decisions described above. Neither can safely retain its current proposed wording.

## 3. Implementation critique

**High — The revised Chrome job still omits the skipped-ancestor guard. Confidence: high.**  
The condition at `plan.md:44` adds `needs.attach-assets.result == 'success'` but still lacks a status-check function. This retains the exact dispatch skip-propagation problem documented in `.github/workflows/release.yml:184`.

Use the existing explicit pattern:

```yaml
if: |
  always() && !cancelled() &&
  github.event.inputs.publish_chrome == 'true' &&
  needs.resolve.result == 'success' &&
  needs.attach-assets.result == 'success'
```

The account-session dry run must verify that this job actually **executed**, rather than accepting a green workflow where it was skipped.

**Low — `page.css` alone cannot reproduce the landing shell. Confidence: high.**  
`plan.md:40` now specifies only `page.css`. The homepage loads design base styles, landing overrides and page styles, in that order (`apps/landing/src/main.ts:1`). `page.css:15` depends on `--font-headline`; document colors and typography also come from the omitted files (`apps/landing/src/styles/overrides.css:13`).

Load the same three stylesheets through the static HTML entry. No JavaScript is needed. The proposed zero-console-error check would not detect missing CSS variables or incorrect typography.

**Low — The final publish summary contradicts the accepted states. Confidence: high.**  
`plan.md:42` always prints “submitted for review,” including for `STAGED` and already-published results. `STAGED` means approved and awaiting publication; it will not automatically become live merely because the job succeeded. Emit the actual state and corresponding next action. [Item states](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/ItemState).

VERDICT: reject (with blocking findings: tag-only protection would block existing main releases; Chrome dispatch still lacks the skipped-ancestor guard; remote-code explanation still asserts unsupported isolation and incorrect per-request confirmation)

## Round 3 — VERDICT: approve

Resumed session over the plan at `162994ca`: "No remaining material findings in the revised implementation plan. Confidence: high. Approval covers repo implementation; the documented account and policy prerequisites still apply before submission."


---

# Revision 2 — round 4 (GPT-6 Astra, high, 2026-09-21)

Prompt: adversarial audit of the revised plan (Firefox joins, keyless Chrome publish) against the repo on `dev` at `2540271a`. Disposition of every finding: `plan.md` § Audit.

reject

1. **Blocking — The release tag can select untrusted code inside both credential jobs.**  
   **Claim:** Checking out `resolve.outputs.sha` while dispatching from `main` establishes the credential boundary (`plan.md:55,127–130`).  
   **Evidence:** `.github/workflows/release.yml:169–181` checks only that the tag exists. It never proves its commit belongs to `main`. A tag pointing at another branch can therefore supply the publisher script while OIDC still says `refs/heads/main`. Environment approval does not change that distinction.  
   **Smallest fix:** Before executing release-commit code, require the resolved SHA to be an ancestor of the dispatch’s trusted `main` SHA. The existing full-history `resolve` checkout can perform this check. Show the resolved tag and SHA to the approver.

2. **Blocking — The documented source installation fails outside a Git repository.**  
   **Claim:** Extract the source archive, then run `PUPPETEER_SKIP_DOWNLOAD=1 bun install --frozen-lockfile` (`plan.md:51`).  
   **Evidence:** Root `package.json:42` defines `prepare: git config core.hooksPath .githooks`. `git archive` excludes `.git`; that command fails in a standalone extracted archive. Extracting underneath an existing checkout can conceal the defect by configuring the parent repository instead.  
   **Smallest fix:** Make `prepare` conditional on a `.git` entry existing in the project root. Test the archive outside every checkout. Keep Puppeteer’s download suppression.

3. **Blocking — Phase 5’s new workflow cannot initially be dispatched as written.**  
   **Claim:** Dispatch `source-rebuild.yml --ref worktree-chrome-store-launch-firefox` before opening the stacked PRs (`plan.md:112,188`).  
   **Evidence:** The file is new and absent from the default branch, `dev`. GitHub requires it on the default branch before its initial `workflow_dispatch`; supplying another ref does not bootstrap it. [GitHub dispatch requirements](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).  
   **Smallest fix:** Give this secret-free workflow a narrowly scoped feature-branch `push` trigger for pre-PR validation, retaining dispatch/schedule for subsequent use. Record the exact run ID rather than relying on an ambiguous `gh run watch`.

4. **Blocking — Chrome always polls a field that need not exist after a successful upload.**  
   **Claim:** Upload, then poll `fetchStatus.lastAsyncUploadState` until `SUCCEEDED`; missing means failure (`plan.md:47`).  
   **Evidence:** Upload itself returns `uploadState`. `lastAsyncUploadState` describes an asynchronous upload within the preceding 24 hours; Google instructs clients to poll when upload returns an in-progress state. An immediate successful upload need not populate it. [Upload/poll instructions](https://developer.chrome.com/docs/webstore/using-api), [status response](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus).  
   **Smallest fix:** Branch on the upload response: `SUCCEEDED` proceeds; either documented in-progress spelling polls; everything else fails. Validate returned item identity and manifest version before proceeding. Add the immediate-success/missing-async-field case.

5. **Blocking — The reproducibility gate proves the wrong equality and permits failure.**  
   **Claim:** Two archive rebuilds demonstrate equivalence to the shipped artifact; documented differences may pass (`plan.md:53,109–113`).  
   **Evidence:** Neither rebuild consumes the release artifact. `_build-extension.yml:60–71` also modifies the extension version before building, which a plain archive rebuild does not reproduce unless the committed version already matches. Mozilla requires matching output; documenting differing files is not an exemption. [Source submission requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/).  
   **Smallest fix:** Compare the archive rebuild against the actual unsigned Firefox release ZIP for the same SHA/version, as well as comparing architectures. Require an empty content diff. Assert committed-version equality or reproduce the release’s version override explicitly. Give architecture artifacts distinct names.

6. **Blocking — Disclosure does not establish compliance with Mozilla’s modified-library rule.**  
   **Claim:** The rule “is met by disclosure of the four patches” (`plan.md:134`).  
   **Evidence:** Mozilla explicitly prohibits modified third-party libraries; its linked guidance does not create a disclosure exception. The repo has four patch entries for **two package names**, plus browser-build substitutions and artifact transformations in `apps/extension/vite.config.ts:61–108`. [Add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/), [library guidance](https://extensionworkshop.com/documentation/publish/third-party-library-usage/).  
   **Smallest fix:** Replace the compliance claim with an unresolved review prerequisite. Explain that the Noir patches alter package resolution metadata, disclose the other substitutions accurately, and obtain Mozilla’s assessment or remove the disallowed modifications. Disclosure remains necessary evidence, not permission.

7. **Blocking — The remote-code decision still rests on an unsupported default.**  
   **Claim:** Contract bytecode cannot reach the network; unanswered support correspondence eventually becomes “No remote code” (`plan.md:45,164`).  
   **Evidence:** Installed `@aztec/pxe/src/contract_function_simulator/oracle/utility_execution_oracle.ts:536–547` lets contract execution cause node storage requests through an oracle. Direct arbitrary networking and mediated RPC access are different claims. The host also uses `chrome.runtime` (`apps/extension/src/offscreen/index.ts:108`). Google expressly addresses remote interpreters; Mozilla separately prohibits remote-code execution. [Chrome policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements), [Mozilla policy](https://extensionworkshop.com/documentation/publish/add-on-policies/).  
   **Smallest fix:** Describe the precise direct/mediated capabilities and keep classification evidence-dependent. Support silence is not evidence for “No.” Reconcile the resulting explanation with `legal/privacy.md:48–49,324–326`, which already makes unconditional claims.

8. **Should-fix — WIF protects an environment/ref, not this particular publisher workflow or step.**  
   **Claim:** The condition and step-scoped token provide the stated narrow publishing boundary (`plan.md:56,127–128`).  
   **Evidence:** Another approved workflow on `main` using the same environment and `id-token: write` satisfies the condition. A similarly configured job in `release.yml` does too. Every step in the authorized job can request OIDC, including before `auth`; skipping `auth` does not revoke that capability. Ordinary fork and `pull_request` runs fail the stated claims, but a suitably configured `pull_request_target` workflow can run with the base ref. [GitHub OIDC claims and permissions](https://docs.github.com/en/actions/reference/security/oidc).  
   **Smallest fix:** Add exact `workflow_ref` and `event_name == 'workflow_dispatch'` conditions. Document that all steps/actions in the approved job remain trusted; step-scoped AMO secrets likewise do not isolate them from earlier malicious code persisting in that job.

9. **Should-fix — Chrome’s version and warning contracts need precise definitions.**  
   **Claim:** Refuse a published/submitted version “not lower than ours,” and report bounded warnings (`plan.md:47,96`).  
   **Evidence:** The repo emits four-part `manifest.version`, while `VERSION` matches semver `version_name` (`manifest.config.ts:12–18`). Store versions occur inside each revision’s `distributionChannels[]`. String ordering is wrong for values such as `0.9.0.0` and `0.10.0.0`; ordinary semver parsers may reject four components. With `blockOnWarnings: true`, warnings arrive through `error.details`; successful-response warnings use `warningInfo.warnings`. [Version comparison](https://developer.chrome.com/docs/extensions/reference/manifest/version), [publish response](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).  
   **Smallest fix:** Compare validated integer tuples, padded to four components, against the ZIP’s `manifest.version`; examine every distribution channel. Specify valid absent revisions versus malformed present ones, reject unknown states, and test the actual warning envelopes.

10. **Should-fix — AMO partial failure has no recovery procedure.**  
    **Claim:** Creating a version and failing its source patch is adequately handled by printing the version ID (`plan.md:49,121`).  
    **Evidence:** That leaves a real version behind. Re-running the whole job encounters consumed-upload/duplicate-version constraints; deleting a version does not free its number. A timed-out create can also succeed remotely without returning its ID. [AMO API](https://mozilla.github.io/addons-server/topics/api/addons.html), [duplicate-version validation](https://raw.githubusercontent.com/mozilla/addons-server/master/src/olympia/versions/utils.py).  
    **Smallest fix:** Document recovery by inspecting the existing version and attaching the matching source through Developer Hub or PATCH, without recreating/deleting it. Read and validate the reviewer-notes block **before** upload. Require a valid version ID and matching returned version/channel before patching. Mask derived JWTs as well as the key, and include them in log-leak tests.

11. **Should-fix — The proposed disclosure answers omit existing data handling.**  
    **Claim:** Chrome needs only financial/authentication categories; transmissions go only to the node, CoinGecko and approved apps; Firefox’s financial category settles the inventory (`plan.md:43,163,165`).  
    **Evidence:** Contacts contain names and addresses (`contact/spec.ts:9–17`); connected-app records contain URLs (`dapp-session/spec.ts:35–50`). Google includes local processing and visited/interacted-with domains in disclosure scope. The policy also describes local-prover transmission and proving-parameter requests (`legal/privacy.md:220–237`). [Google’s data definitions](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).  
    **Smallest fix:** Include Chrome web-history handling for connected-site URLs and assess personally identifying information for contacts/profile names. Describe each actual destination separately. For Firefox, financial information is defensible, but explicitly assess authentication, browsing and website activity against **outbound** flows; local password handling alone does not justify copying Chrome’s categories. [Firefox taxonomy](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/). **Confidence: moderate on final category classification.**

12. **Should-fix — Archive and checksum acceptance are underspecified.**  
    **Claim:** Check bare source paths and use `sha256sum --ignore-missing` to verify the selected ZIP (`plan.md:49–55`).  
    **Evidence:** The source archive prefixes every path with `nulo-${VERSION}/`. The release artifact contains both ZIPs and their checksums (`release.yml:306–324`); a checksum invocation can succeed for the other ZIP without establishing that the selected ZIP had a checksum entry.  
    **Smallest fix:** Check the exact prefixed source entries. Require one checksum entry for the exact selected filename and verify it from the correct directory. Require the release manifest’s numeric version as well as `version_name`, and validate the settled Firefox declaration rather than merely accepting any nonempty array—including `["none"]`.

13. **Should-fix — The account-session “proof” skips authentication, and its legal gate cannot pass.**  
    **Claim:** The dry run proves setup; filling `BEFORE-LAUNCH.md` §1 removes the DRAFT banner (`plan.md:195,200`).  
    **Evidence:** Dry run deliberately skips Google authentication and all store requests. Separately, `legal/privacy.md:3` still contains the effective-date placeholder, scheduled in §3, while Terms listing URLs are deferred until afterwards. Rendering marks each document draft while placeholders remain (`apps/landing/scripts/legal-pages.ts:155–161`).  
    **Smallest fix:** Call the dry run an artifact/wiring check. During the owner session, separately mint credentials and perform read-only store requests. Resolve the privacy effective date before submission and explicitly sequence Terms listing URLs instead of promising every banner disappears after §1 alone.

14. **Should-fix — Phase 3 unnecessarily references an unconfigured Firefox environment.**  
    **Claim:** Move the still-failing Firefox stub into `environment: firefox-add-ons`, while environment creation waits for the account session (`plan.md:92,129`).  
    **Evidence:** GitHub documents automatic creation of referenced missing environments without protection rules. Enabling the stub before setup can therefore create precisely the unprotected environment the plan warns about. Whether an entirely skipped job causes registration was not established here. [Environment creation semantics](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).  
    **Smallest fix:** Split the inputs in Arc 1, but add Firefox’s environment reference with its real publisher in Arc 2. Verify protections even if an environment already exists.

15. **Should-fix — Phase 1 mixes a production build with the ordinary smoke configuration.**  
    **Claim:** `build:full && … && test:e2e` is the complete renamed-build smoke gate (`plan.md:79`).  
    **Evidence:** The smoke command never builds. CI distinguishes production-artifact mode from fixture builds: `_extension-smoke-e2e.yml:45,95–106`; the Chrome driver suppresses the live price host only in artifact mode (`fixtures/browser/chrome.ts:51`). `FIREFOX.md` explicitly documents the required fixture flags.  
    **Smallest fix:** For the production bundle, invoke the smoke suite with the existing `NULO_E2E_ARTIFACT_RUN=1` mode. Use the documented fixture build separately when fixture-dependent coverage is intended. Keep local browser runs exclusive as already required.

16. **Nit — Correct the remaining factual imprecision.**  
    **Claim/evidence:** Fact 1 says “up to four integers”; `manifest.config.ts:17` always emits four. Fact 6 suggests extension transmission to the passkey host; `legal/privacy.md:152–155` expressly says it does not fetch that page. Fact 8 calls four patch entries four packages; `package.json:55–59` names two packages at two versions. The out-of-scope `/forms/*` links are stale: Settings now uses `mailto:` (`settings/about.vue:87,95,103`).  
    **Smallest fix:** Correct those sentences. Label Fact 3’s linter result as recorded evidence, not a fresh run. Fact 5’s live environment settings and Fact 8’s release-asset sizes remain **unverified in this audit** because GitHub API reads could not connect.

17. **Nit — Simplify documentation machinery and preserve only useful comments.**  
    **Claim:** Extract shell commands from Markdown and test parity (`plan.md:53,108`).  
    **Evidence:** This creates a second representation of the rebuild procedure without testing whether it reproduces the release. Existing comments in touched areas also contain expendable history: `release.yml:184–190`; the declaration comment at `manifest.test.ts:119–120` will become stale.  
    **Smallest fix:** Make `source-rebuild.sh` canonical and have the document invoke it; drop extraction/parity machinery. Replace stale declaration commentary and shorten the workflow comment to the skipped-ancestor invariant. Add one concise comment explaining that dispatch ref protection does not authenticate the checked-out tag SHA.

Checked and found correct:

- Facts 1–4, 6–9 otherwise match the cited repository files; those files are unchanged from `2540271a`. The archive measured **27,571,417 bytes**. Generated extension declarations are tracked; landing-generated files are not extension build inputs. ARM64 determinism and 10 GB memory suitability remain experiments, not established facts.
- The proposed `always() && !cancelled()` guards, explicit successful dependencies, stable-only gate, artifact name and status-aggregator wiring are sound. A shallow checkout contains the tree needed by `git archive "$SHA"`. Older tags lacking publisher scripts fail as documented.
- Owner self-review works when prevention is disabled; public personal repositories support the protections. `--ref main` supplies the branch checked by deployment rules. [GitHub environment rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- Google auth’s specified inputs support access-token output without a credentials file; the action masks that output. A missing token must remain acceptable before the dry-run return. [Action implementation](https://raw.githubusercontent.com/google-github-actions/auth/v3/src/main.ts).
- Pending-review refusal, both in-progress spellings, staged publication and its 30-day window are reasonable. AMO’s HS256/60-second JWT and create-then-source-PATCH sequence are valid; manually created listed add-ons can receive API versions and inherit their previous license.
- The updated plan’s `unzip -p`/`unzip -Z1` approach resolves ZIP inspection without installing dependencies. Arc 1 otherwise has no necessary compile-time dependency on Arc 2.

**Confidence: high on repository and workflow findings; moderate on store classification outcomes; unknown on inaccessible account settings and unmeasured rebuild behavior.** No files modified, builds run, or tests executed.

---

# Revision 2 — round 5

reject

1. **Blocking — `store_check` still performs release writes and deployments.**  
   **Claim:** The credential-check dispatch uploads nothing (`plan.md:57,204`).  
   **Evidence:** With `store_check=true` and `dry_run=false`, existing `.github/workflows/release.yml:351–359` uploads assets with `--clobber` and overwrites release notes; `:379,416` permit deployment hooks. Conversely, combining both flags skips Chrome authentication and returns before either credential check.  
   **Smallest fix:** Suppress release uploads, note edits and deployment hooks when `store_check=true`. Reject `store_check=true && dry_run=true` early, preserving the promise that dry runs never authenticate.

2. **Blocking — Chrome’s credential check rejects the very submission it should inspect.**  
   **Claim:** `MODE=check` stops after publish preflight (`plan.md:49`), immediately after the manual first submission (`:200,204`).  
   **Evidence:** That preflight rejects pending review and any equal-or-higher store version. The manually submitted version will be pending or already equal. Both runners also require publish artifacts before reaching their read-only check.  
   **Smallest fix:** Branch into check mode after validating mode, identity and credentials. Perform the GET, validate its response and report state without applying publish eligibility rules. ZIP, source, reviewer notes and proposed version should not be required for this mode. Keep those checks on the publish path.

3. **Blocking — The proposed `reference` job cannot have both described implementations.**  
   **Claim:** One job downloads a release when `tag` exists, otherwise calls `_build-extension.yml` (`plan.md:55`).  
   **Evidence:** A reusable-workflow caller cannot also contain ordinary steps. Moreover, `_build-extension.yml:15,36` defaults to building both browsers and uploading no artifacts; its Firefox artifact is named `extension-firefox` (`:177`). [GitHub’s supported caller-job syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#supported-keywords-for-jobs-that-call-a-reusable-workflow).  
   **Smallest fix:** Use mutually exclusive download-reference and build-reference jobs. Pass `target: firefox`, `upload_artifacts: true` and the resolved SHA explicitly. Make comparison require the selected reference job’s success despite the other being skipped. Define that `tag` resolves the archive SHA too; an independently supplied `ref` must not silently select another tree.

4. **Blocking — Phase 6’s dry-run gate depends on a release that cannot yet exist.**  
   **Claim:** Test the new runner against “the v release’s Firefox zip” before completing Arc 2 (`plan.md:122`).  
   **Evidence:** Existing builds declare `["none"]` (`apps/extension/manifest/manifest.firefox.config.ts:31–32`); the new runner explicitly rejects that. A release containing Phase 4’s declaration arrives only after implementation and merge (`plan.md:197`). The command also omits `LISTING_PATH`; both dry-run commands omit `MODE`, without defining defaults.  
   **Smallest fix:** Package the Firefox output already validated in Phase 5, using its committed package version and matching source archive. Supply `LISTING_PATH` and `MODE=publish` explicitly; supply `MODE` in Phase 3’s command too. This gate needs no published release.

5. **Should-fix — Firefox’s numeric-version validation remains unspecified.**  
   **Claim:** The create response must contain “our version string” (`plan.md:51,123`).  
   **Evidence:** Firefox preflight only specifies checking `version_name`. The manifest generator produces `version: "0.27.0.0"` and `version_name: "0.27.0"` (`apps/extension/manifest/manifest.config.ts:12–18`). AMO uses the manifest version, so comparing its response with `VERSION` would fail after creating the version. [AMO version/upload response fields](https://mozilla.github.io/addons-server/topics/api/addons.html).  
   **Smallest fix:** Explicitly validate and retain `manifest.version` before uploading; compare AMO’s version fields against that value. Keep `VERSION` for release naming and the `version_name` check.

6. **Should-fix — AMO’s selected GET does not establish publishing access.**  
   **Claim:** Reading `/addons/addon/wallet@nulo.sh/` proves the configured credentials (`plan.md:51,204`).  
   **Evidence:** Once public, add-on detail is publicly readable. Valid credentials belonging to another account can therefore pass this check. [AMO detail versus authenticated author-list endpoints](https://mozilla.github.io/addons-server/topics/api/addons.html).  
   **Smallest fix:** Read the authenticated author-only add-on list and require `wallet@nulo.sh` in the results. Fail rather than accepting public visibility as evidence of access.

7. **Should-fix — The data inventory still contradicts the implementation, and Ask 3 contradicts the inventory.**  
   **Claim:** Passkey material and profile names are “local only”; Firefox excludes other categories on that basis (`plan.md:45,167`). Ask 3 still names only financial/payment and authentication categories (`:165`).  
   **Evidence:** `passkey-ceremony.ts:45–55` passes the profile-derived label and identifier to the authenticator. `legal/privacy.md:157–160` explicitly describes possible provider synchronization. Meanwhile, `plan.md:45` also requires Chrome’s PII and web-history boxes.  
   **Smallest fix:** Add the browser/authenticator-mediated flow to the inventory and qualify “local only.” Reassess the Firefox categories against that flow before freezing the constant; the exact classification remains a policy question. Rewrite Ask 3 from the same inventory, including all four Chrome categories and accurate per-destination disclosures.

8. **Should-fix — Fact 8’s modification inventory is incomplete.**  
   **Claim:** The exact inventory lists the Noir patches, `function-bind`, `bb.js` and artifact stripping; Ask 9 describes two substituted modules (`plan.md:45,150,171`).  
   **Evidence:** `apps/extension/vite.config.ts:54–58` also replaces `detect-node` with `src/shims/detect-node.ts`, whose implementation is `export default false` (`:6`). This changes dependency behavior to select browser logging.  
   **Smallest fix:** Add that substitution and its reason to Fact 8, reviewer notes and Ask 9. Keeping Mozilla’s acceptance unresolved is correct; the submitted inventory must still be complete.

9. **Should-fix — The revised legal sequence omits required companion changes.**  
   **Claim:** Set the privacy effective date, deploy, then remove Terms’ draft status by filling listing URLs (`plan.md:168,198,205`).  
   **Evidence:** `packages/legal/src/manifest.test.ts:42–46` requires the document date to match `LEGAL_MANIFEST`; both entries remain `null` (`manifest.ts:16–17`). `BEFORE-LAUNCH.md:35–42` also requires coordinated history/manifest updates. Terms retains its own effective-date placeholder (`legal/terms.md:3`).  
   **Smallest fix:** Make the owner checklist explicitly update each affected document’s header, history and manifest entry together. Schedule Terms’ effective date as well as its URLs, and reconcile the changed timing with `BEFORE-LAUNCH.md` §3. These can remain owner work outside implementation scope.

10. **Should-fix — The approver cannot see a protected job’s first-step output before approving it.**  
    **Claim:** Echoing tag and SHA in the first publish-job step lets the approver see the release target (`plan.md:57`).  
    **Evidence:** Environment protection blocks the job before its steps execute. [GitHub deployment protection semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).  
    **Smallest fix:** Print tag, resolved SHA and `on_main` in `resolve`’s summary, which exists before approval. Including the tag in the protected job’s display name is also useful.

11. **Should-fix — Phase 4’s installation procedure will not show the required consent prompt.**  
    **Claim:** Manually install `dist/firefox` in Firefox ≥153 and capture the install prompt (`plan.md:106`).  
    **Evidence:** Temporary loading of an unpacked extension silently grants install-time permissions. Testing that prompt requires a packaged extension and, before signing, Nightly/Developer Edition with signature enforcement disabled in the test profile. [Mozilla’s permission-testing procedure](https://extensionworkshop.com/documentation/develop/test-permission-requests/).  
    **Smallest fix:** Specify packaging `apps/extension/dist/firefox` and installing through **Install Add-on From File** in a separate qualifying test profile. Do not use temporary loading for this gate.

12. **Should-fix — Phase 5 can watch the wrong run and return success for a failed run.**  
    **Claim:** Select the latest branch run, then `gh run watch <run id>`; exit zero proves the gate (`plan.md:114–115`).  
    **Evidence:** The selector does not constrain commit or event. The three-path trigger also excludes a subsequent fix confined to `vite.config.ts` or root `package.json`, so the latest matching run can remain an older one. `gh run watch` needs `--exit-status` to propagate failure. [Run selection](https://cli.github.com/manual/gh_run_list), [watch exit behavior](https://cli.github.com/manual/gh_run_watch).  
    **Smallest fix:** Select with the pushed commit SHA and `--event push`, require a matching run, then watch with `--exit-status`. Record SHA alongside run ID. Ensure the pre-merge trigger can cover actual rebuild fixes without accepting an earlier run.

Checked and found correct:

- The ancestry check addresses the original tag-trust gap. Full-history checkout supplies the ancestry needed on automatic `push: main`; publishing remains opt-in. Emit a boolean for a non-ancestor rather than letting Git’s status `1` abort `resolve`.
- The added `workflow_ref` and `event_name` conditions close the other-workflow route. Another job in the same workflow with the same environment and `id-token: write` would still qualify; trusting all steps is correctly stated. [OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).
- Owner self-approval, selected `main` deployment branches, bypass disabled, and creating environments beforehand are sound. Moving Firefox’s environment key to Arc 2 fixes that sequencing concern. [Environment rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [environment creation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- Google auth’s inputs support access-token output without a credentials file. The dependency-free runner plus system `unzip` is viable. [Auth action](https://github.com/google-github-actions/auth).
- Chrome’s synchronous/asynchronous split is corrected. In particular, `crxVersion` is legitimately absent during an asynchronous upload. Tuple comparison and both warning envelopes are appropriate. [Upload response](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload), [publish response](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).
- The non-git install guard, extraction outside a checkout, exact checksum filename, canonical rebuild script, strict content comparison and AMO partial-failure recovery are substantive fixes.
- The new push trigger can run before merge. It also runs on matching merges into `dev` and `main`, launching the rebuild comparison again; the path filter imposes no branch restriction.
- The planned comment edits preserve useful invariants and remove historical narration. Dropping doc-parity machinery is appropriate.

**Confidence: high** on the concrete workflow, gate and repository findings; **moderate** on Firefox’s final data classification. Other repo-backed Assumptions remain consistent with the inspected files. Live GitHub settings and release-asset sizes could not be independently reconfirmed because API reads failed. No files modified; no builds or tests run.

---

# Revision 2 — round 6

conditional approve

1. **Should-fix — Arc 1 advertises checks it cannot perform.**  
   **Claim:** `store-check.yml` accepts `chrome | firefox | both`, but Arc 1 contains only its Chrome job ([plan.md:61](implementations-plan/chrome-store-launch/plan.md:61), `:69,95`).  
   **Evidence:** A Firefox selection has no corresponding job; `both` can complete having checked only Chrome. The account checklist also supplies only the two-store commands (`:205`).  
   **Smallest fix:** Arc 1 should accept only `chrome`. Add `firefox` and `both` with the Firefox job in Arc 2. Include the Chrome-only account commands and state that `both` requires both environments to be configured.

2. **Should-fix — Trigger-removal timing contradicts itself and leaves evidence transfer unspecified.**  
   **Claim:** Architecture removes the push trigger in the last Arc 2 commit; Phase 5 removes it in that phase’s last commit ([plan.md:55](implementations-plan/chrome-store-launch/plan.md:55), `:115`).  
   **Evidence:** Removing it after Phase 5 prevents subsequent implementation/audit fixes from exercising the pre-merge gate. Removing it after the final successful run also produces a different final SHA. A trigger-only change does **not** invalidate the build comparison, but the recorded run does not directly test that final commit.  
   **Smallest fix:** Keep the trigger through the final fix loop. Remove it in an isolated, trigger-only commit; record that its diff changes no build inputs and rerun actionlint. Any intervening build-input change requires another rebuild run before removal. Reconcile both sections accordingly.

3. **Should-fix — Ask 5 still excludes PII using a contradicted premise.**  
   **Claim:** `personallyIdentifyingInfo` is excluded because profile names stay local; the remaining passkey judgment concerns only `authenticationInfo` ([plan.md:168](implementations-plan/chrome-store-launch/plan.md:168)).  
   **Evidence:** The corrected inventory at `:45` acknowledges the exception. `passkey-label.ts:51–53` incorporates the normalized profile name, and `legal/privacy.md:157–160` describes possible authenticator-provider synchronization. Mozilla’s PII category includes names and identifiers. [Mozilla’s taxonomy](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/#taxonomy).  
   **Smallest fix:** Remove the unconditional “profile names stay local” rationale. Assess both PII and authentication categories under the same browser/authenticator judgment. This does not establish that either category must be added; it establishes that the current exclusion argument is incomplete.

4. **Should-fix — Firefox’s success message assumes an unobserved review state.**  
   **Claim:** Always print “awaiting review,” because a wallet goes to human review ([plan.md:51](implementations-plan/chrome-store-launch/plan.md:51)).  
   **Evidence:** Mozilla describes risk-based escalation to human reviewers, not mandatory human review for every wallet submission. AMO exposes distinct version states. [Mozilla’s wallet-review explanation](https://blog.mozilla.org/addons/2025/05/30/crypto-wallet-scams-thwarting-a-new-threat/), [AMO version states](https://mozilla.github.io/addons-server/topics/api/addons.html#version-detail).  
   **Smallest fix:** Report “version submitted; source attached; check Developer Hub,” or report the actual returned state. Remove the guaranteed-human-review explanation; no additional polling is needed.

Checked and found correct:

- **CEL:** `assertion.workflow_ref in ['…', '…']` is valid list membership in a WIF attribute condition. The surrounding repository, owner, environment, ref and event restrictions remain intact. [WIF conditions](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#define_an_attribute_condition), [CEL list operators](https://github.com/cel-expr/cel-spec/blob/master/doc/langdef.md#list-operators).
- **Check workflow:** Separating it from `release.yml` removes release uploads and deployment hooks. Explicit `MODE`, early check-mode branching and artifact-free checks resolve the previous defects.
- **Checkout:** Using the triggering `main` commit is appropriate for a credential check with no independent tag input. Default checkout uses the triggering event’s ref/SHA; no release ancestry check is needed there. [Checkout behavior](https://github.com/actions/checkout).
- **Missing environment:** After Arc 2, selecting `both` with one environment missing can create that environment unprotected, then fail for missing configuration. It does not gain missing credentials. The existing create-and-protect-before-dispatch prerequisite remains essential; no new environment-management layer is necessary. [GitHub behavior](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- **Reproducibility:** One resolved SHA, mutually exclusive reference jobs, explicit reusable-workflow inputs, distinct artifacts and comparison against the selected reference are coherent.
- **Gates and sequencing:** Phase 6 no longer needs a future release. The packaged Firefox consent check, legal-date coordination, pre-approval release summary and commit-filtered `--exit-status` watch are substantive fixes.
- **Facts and comments:** No further contradiction found in the repo-backed Assumptions; the cited implementation files remain unchanged from the previously inspected baseline. The planned comment edits are useful and concise.

**Confidence: high** on workflow and repository findings; **moderate** on Firefox’s ultimate passkey classification. No new blocking credential-boundary defect found. Live account settings and actual rebuild results remain unverified. No files modified, builds run or tests run.

---

# Revision 2 — round 7

approve

All four round-6 findings are resolved and no material plan findings remain; confidence is **high** in this plan review, while implementation correctness, CI execution, cross-architecture reproducibility and memory use, live credentials/environment protections, and store-policy acceptance remain unverified.

---

# Arc 1 implementation — round 1

Prompt: the net diff of Phases 1–3 (`git diff 2540271a..HEAD`), adversarial, read-only; findings ranked must-fix / should-fix / note with `path:line`.

**Must-fix**

- [scripts/release/publish-chrome-store.ts:155](scripts/release/publish-chrome-store.ts:155) — **Async uploads bypass item identity validation.** An upload returning `itemId: "different", uploadState: "IN_PROGRESS"`, followed by status for that different item with `SUCCEEDED`, reaches `publish` for the configured item. Reproduced with injected responses. Validate identity on the initial async response and every poll.

- [scripts/release/publish-chrome-store.ts:81](scripts/release/publish-chrome-store.ts:81) — **Preflight accepts states whose semantics are unknown.** The allowlist includes `DEPLOYING`, `UNPUBLISHED`, and `TAKEN_DOWN`, absent from Google’s documented [ItemState enum](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/ItemState), plus its unused unspecified value. A `DEPLOYING` revision reached upload and publish in reproduction. These must fail closed.

- [apps/extension/store/listing.md:22](apps/extension/store/listing.md:22) — **The public description falsely limits outbound destinations.** Browser proving with an empty CRS cache downloads from `crs.aztec-cdn.foundation`, with `crs.aztec-labs.com` as fallback (`@aztec/bb.js/src/crs/browser/cached_net_crs.ts:35`, `src/crs/net_crs.ts:4`). Neither belongs to the description’s exhaustive “only” list. The inventory at line 47 already contradicts it.

- [apps/extension/store/remote-code.md:27](apps/extension/store/remote-code.md:27) — **The note overstates CSP enforcement.** `'wasm-unsafe-eval'` permits compilation of supplied WASM bytes; it does not establish that those bytes came from bundled files. The manifest also has no `connect-src` or `default-src` restriction. Fetched WASM bytes therefore are not excluded by this policy. Describe bundling as a property of the actual loaders, rather than a CSP guarantee. [WebAssembly CSP semantics](https://github.com/WebAssembly/content-security-policy/blob/main/proposals/CSP.md).

**Should-fix**

- [scripts/release/publish-chrome-store-run.ts:110](scripts/release/publish-chrome-store-run.ts:110) — **Malformed responses escape the logging boundary.** A successful HTTP response containing `publishedItemRevisionStatus: null` throws an uncaught `TypeError`; the CLI’s top-level await prints the raw exception. Reproduced. Validate response shapes and catch failures around interpretation and ZIP reads.

- [apps/extension/store/remote-code.md:35](apps/extension/store/remote-code.md:35) — **The oracle-boundary citation points to unrelated code.** `acir_callback.ts:8–10` defines `UnavailableOracleError`; it does not construct or restrict the foreign-call handler. The relevant implementation starts at line 21. A reviewer following the citation cannot verify the claimed boundary, while the citation test passes because it checks only file length.

verdict: reject — confidence: high. Release tests: 116 passed; icon drift and both manifests’ permission coverage passed. Store unit tests remained unverified because workers timed out; live WIF/environment protections, store acceptance, builds and E2E remain unverified.


---

# Arc 1 implementation — round 2

Confirmed at `03dcda52`: **M1, M2, M3, M4, S1 and S2 are resolved**, including the corrected loader and oracle citations.

**Must-fix**

- [scripts/release/publish-chrome-store.ts:116](scripts/release/publish-chrome-store.ts:116) — **Malformed channel data now bypasses preflight.** The new fallback converts every non-array `distributionChannels` into `[]`. Reproduced with `publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: { crxVersion: "99.0.0.0" } }`: publishing `0.27.0.0` proceeds through `fetchStatus → upload → publish` and exits 0. Previously this malformed object stopped execution. Reject present, non-array values instead of treating them as absent; add a runner test asserting no upload.

**Should-fix:** None newly identified.

Validation: 120 release tests passed; icon drift, both manifests’ permission coverage and 17 citation ranges passed separate checks.

verdict: reject — confidence: high; store unit tests timed out starting workers, and live WIF/environment protections, store acceptance, builds and E2E remain unverified.


---

# Arc 1 implementation — round 3

verdict: approve — confidence: high; the round-2 finding is resolved at `feb03368`, all earlier fixes remain intact, and no material findings remain; 120 release tests and icon drift checks pass, while store unit tests remain unverified after prior worker timeouts, alongside live WIF/environment protections, store acceptance, builds and E2E.


---

# Arc 2 implementation — round 1

Prompt: the net diff of Phases 4–6 over Arc 1's tip (`git diff 0826e151..HEAD`), adversarial, read-only, as a Mozilla reviewer and as an attacker; findings ranked must-fix / should-fix / note with `path:line`.

**Must-fix**

- **Source can disagree with the submitted version.** [.github/workflows/release.yml:647](.github/workflows/release.yml:647): a stable tag `v0.28.0` on a `main` commit whose package version remains `0.27.0` passes the publish gates. The build overrides the version, but `git archive` preserves `0.27.0`. Source validation checks filenames only, so AMO receives a version whose supplied rebuild script immediately refuses to run. Assert the committed package version equals `VERSION` before uploading.

- **The reviewer instructions falsely say Node is unused.** [apps/extension/store/SOURCE-BUILD.md:10](apps/extension/store/SOURCE-BUILD.md:10): `build:firefox` invokes `cross-env` and Vite through Node shebangs, without `--bun`. A reviewer installing only the stated runtime cannot build; changing ambient Node also changes an unacknowledged build input. A harmless launcher probe confirmed execution under Node.

- **The modification inventory understates the patches.** [apps/extension/store/SOURCE-BUILD.md:62](apps/extension/store/SOURCE-BUILD.md:62) says two patch files. The archive contains—and `package.json` activates—four: two packages at two versions each. Mozilla receives contradictory modification inventories between this document and the reviewer notes.

**Should-fix**

- **Unexpected failures after version creation omit recovery instructions.** [scripts/release/publish-firefox-amo-run.ts:149](scripts/release/publish-firefox-amo-run.ts:149): if reading the source archive throws after creation, the outer catch prints only `unexpected failure (Error)`. An injected read failure reproduced this: version 9001 exists, but no “do NOT re-run” instruction appears. Preserve creation state across the exception boundary.

- **Hidden-file differences can pass reproducibility comparison.** [.github/workflows/source-rebuild.yml:90](.github/workflows/source-rebuild.yml:90): the reference and rebuild uploads omit `include-hidden-files`, whose [pinned action default is false](https://github.com/actions/upload-artifact/blob/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/action.yml). A release zip containing an extra or different `.hidden/config.json` loses that file before comparison; otherwise identical trees pass. Transfer complete archives or explicitly preserve hidden files.

- **Valid credentials fail when the add-on falls beyond page one.** [scripts/release/publish-firefox-amo.ts:131](scripts/release/publish-firefox-amo.ts:131): the interpreter treats absence from the first response as lack of authorship. [AMO defaults to 25 results and provides pagination](https://mozilla.github.io/addons-server/topics/api/addons.html#list). An account owning more add-ons can therefore fail the credential check despite owning `wallet@nulo.sh`.

verdict: reject — confidence: high. Release tests: 151 passed; extension tests failed to start workers. Live AMO behavior, environment protections, rebuild execution, and Mozilla’s policy acceptance remain unverified.


---

# Arc 2 implementation — round 2

Prompt: the six round-1 fixes listed with their commits; same scope and rules.

**Must-fix**

- **The corrected Node description still misidentifies the release runtime.** [apps/extension/store/SOURCE-BUILD.md:13](apps/extension/store/SOURCE-BUILD.md:13) says release builds use Node 24. Neither build workflow selects Node; the [Ubuntu 24.04 runner image defaults to Node 22.23.2](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). A reviewer therefore receives an incorrect description of the build environment. Select Node 24 explicitly or document the actual tested runtimes.

- **The archive contradicts “No … generated code is checked in.”** [apps/extension/store/SOURCE-BUILD.md:61](apps/extension/store/SOURCE-BUILD.md:61): tracked inputs include generated `apps/extension/src/types/auto-imports.d.ts` and `components.d.ts`, plus the vendored compiled `packages/aztec-runtime/src/account/artifacts/SchnorrAccount.json`. Its provenance explicitly identifies a precompiled upstream artifact, consumed by `frozen-artifact.ts`. A reviewer inspecting the supplied archive finds generated inputs the instructions deny exist. Narrow the statement and identify these exceptions.

- **The new exception test cannot detect removal of the recovery guards.** [scripts/release/publish-firefox-amo-run.test.ts:309](scripts/release/publish-firefox-amo-run.test.ts:309): the fourth-fetch exception is handled inside the existing `call()` catch. The throwing `jti` replacement at line 315 happens after execution and is never invoked. An in-memory mutation removing both new guards preserved the fetch-test outcome; a fourth-`jti` exception then lost `RECOVERY`. Inject that exception before execution and assert recovery. The implementation fix works; its new regression test does not protect it.

verdict: reject — confidence: high. All 156 release tests pass; live AMO behavior, environment protections, updated rebuild execution, extension tests, and Mozilla policy acceptance remain unverified.
