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
