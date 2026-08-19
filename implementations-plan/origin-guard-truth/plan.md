# origin-guard-truth + getTokenInterface removal [light]

Arc B of the post-remediation follow-on (parent: `implementations-plan/remediation-followups/plan.md`). Two halves, one PR: (B1) settle the "dead tabs.onUpdated origin guard" finding empirically; (B2) delete `getTokenInterface` from the token RPC surface (owner-authorized by the arc goal; zero production callers).

## B1 — the origin-guard truth

**The finding under investigation** (from the remediation audit): `wireTabLifecycle`'s `chrome.tabs.onUpdated` cross-origin session guard was suspected DEAD — the manifest declares no `"tabs"` permission, and `changeInfo.url` is permission-gated, so the guard's `if (changeInfo.status === "loading" && changeInfo.url)` branch would never see a URL.

**Recon inference vs empirical truth — the pin FALSIFIED the recon.**

Recon inferred the guard likely fires in production: `content_scripts.matches` with the all-URLs pattern would be an effective host-access grant exposing `changeInfo.url`. The first version of the empirical pin asserted exactly that (extension page registers `tabs.onUpdated`, dApp tab navigates to a localhost origin covered by neither `"tabs"` nor `host_permissions`) — and it FAILED in all 3 retries: no URL was ever delivered. The recon's "live evidence" (playground session lifecycle works on localhost) was itself blind — lifecycle works via realm teardown, not the guard. Chromium's tabs-API scrubbing checks **explicit hosts only** (`host_permissions`), never scriptable hosts (content-script matches).

**Settled verdict: the guard's cross-origin branch is DEAD for ordinary web origins.** It executes only when the navigation *destination* matches an explicit grant (`https://nulo.sh/`, `http://127.0.0.1/*` — any port, match patterns ignore ports). And the second recon conclusion stands unchanged: **belt-and-suspenders, no security hole either way.** Navigation destroys both MessagePort ends (per-document realms — the content script's ports map dies with the document); the sessionId is a `crypto.randomUUID` the page never sees; the ECDH sharedKey never leaves the two parties. A stale ActiveSession is inert memory, cleaned by `tabs.onRemoved` (fires without any URL grant), SW eviction, the DappSession deletion sweep, and the 7-day TTL.

**Deliverables (document + pin; NO manifest change):**

- `wallet-sdk/tab-lifecycle.ts` header records the truth: mostly-dead guard, the exact visibility rule, and the classification (bookkeeping hygiene + reconnect UX; the security boundary is realm teardown + unguessable session material).
- **Two-sided empirical pin** (`session-tabNavigate.test.ts`, new test): leg 1 navigates the dApp tab to `127.0.0.1:<node-port>` (explicit grant) and asserts the URL ARRIVES (also capturing the tab id from the event); leg 2 navigates the same tab to the localhost node origin (no grant) and asserts status events flow but NO event satisfies the guard's own `status === "loading" && url` predicate with the localhost URL. Either grant-class change in a future manifest reds a leg.
- **Blind-test fix**: the pre-existing test navigated to `about:blank` — `changeInfo.url` withheld, guard branch never executed, transport died via realm teardown; the test passed for the wrong reason. Now navigates to `127.0.0.1:<node-port>` (cross-origin AND guard-visible), so the guard branch genuinely runs. Guard logic stays covered by `tab-lifecycle.test.ts` units.

**OWNER-GATED recommendation (NOT shipped, per the goal's hard boundary):** making the guard live for all origins requires adding the `"tabs"` permission — a store-listing-visible manifest change ("Read your browsing history" warning class). Given the guard is UX hygiene and every cleanup fallback holds without it, the recommendation is to LEAVE IT AS IS unless dangling-transport UX complaints materialize; if the owner ever wants it live, `"tabs"` is the switch and the two-sided pin will red on leg 2, flagging the doc for update.

## B2 — getTokenInterface deletion

Owner-authorized by the arc goal. Zero production callers (verified: only the service/spec/client definitions and the F-Q09 characterization pins referenced it). Removed:

- `token/service.ts` — the method (81 lines) + its `rpcMethods` entry
- `token/spec.ts` — the interface signature
- `token/client.ts` — the passthrough entry (`definePassthroughsExhaustive` enforces both directions, so a stale entry would not typecheck)
- `token/service.composition.test.ts` — the F-Q09 characterization block (pins existed to guard a refactor of live behavior; the behavior is deleted, so the pins go with it)

All shared helpers (`ensureRegistered`, `requireOwnedRow`, `getTokenFnCandidates`, …) remain used by `parseTokenInterface` — no dead imports.

## Validation

- `bun run lint` + `typecheck:all` green; token composition suite 12/12; tab-lifecycle units 6/6.
- SOLO proverless run of `session-tabNavigate.test.ts` (both tests) — see audit ledger.
- Single codex xhigh end-diff pass (light tier) — see audit ledger.

## Audit ledger

(appended as legs complete)
