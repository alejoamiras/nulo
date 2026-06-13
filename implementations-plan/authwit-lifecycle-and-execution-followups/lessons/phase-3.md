# Phase 3 — Lifecycle e2e (CI-gated)

Full public-authwit lifecycle test landed: `authwit-lifecycle.test.ts`
covers G1 grant→consume(ok) · G2 grant→revoke→consume(error, non-vacuous:
fresh never-consumed grant) · G3 grant→registry-disable→consume(error)→
enable→consume(ok). Shared `settingsAction(actionTestId, submitTestId)`
drives revoke + registry-toggle through owner A's Authwits settings;
`pickFeeAndSubmitAuthwitPopup` handles the in-page FeeSettingsCard.

**Gate decision (user-approved):** the e2e itself runs ~10 serial proofs;
local WASM (no accelerator) starves puppeteer's CDP channel
(`Runtime.callFunctionOn timed out`) — see phase-2.md. So the e2e is
gated in CI (native accelerator proving), not locally. Local gate met:
tsc 0, lint 0, unit suite 2,362 passed. The file joins the regular
network shards; CI is the source of truth for its green.

The grant→consume HALF is independently proven green locally via
`authwit-consume-smoke.test.ts` (Phase 2), so the novel mechanism is not
CI-only — only the heavier revoke/toggle legs await CI.

## Phase 4 (arc close) — partial, on a plane

- `/code-review max` critical pass over the production surface: CLEAN, no
  fixes (grant handler mirrors the audited registerToken authz pattern;
  scope gate + schema drift-guard + cancelJob ownership all unit/
  reachability/scope-tested).
- Codex post-impl audit: ATTEMPTED, timed out (exit 124) — codex CLI
  could not reach the API on plane wifi. DEFERRED-pending-connectivity,
  NOT skipped. Standing audit basis: 3 plan-time rounds (codex reject→fix,
  fable conditional→fix, codex final conditional→fix) + clean code-review.
  Re-run when connectivity returns; recorded as a PR open item.
- PR opened to dev so CI runs the CI-gated lifecycle e2e in the network
  shards (its only viable venue). Never merged autonomously.
