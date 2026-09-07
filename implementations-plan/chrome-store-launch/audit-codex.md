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