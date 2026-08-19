# origin-guard-truth + getTokenInterface removal [light]

Arc B of the post-remediation follow-on (parent: `implementations-plan/remediation-followups/plan.md`). Two halves, one PR: (B1) settle the "dead tabs.onUpdated origin guard" finding empirically; (B2) delete `getTokenInterface` from the token RPC surface (owner-authorized by the arc goal; zero production callers).

## B1 — the origin-guard truth

**The finding under investigation** (from the remediation audit): `wireTabLifecycle`'s `chrome.tabs.onUpdated` cross-origin session guard was suspected DEAD — the manifest declares no `"tabs"` permission, and `changeInfo.url` is permission-gated, so the guard's `if (changeInfo.status === "loading" && changeInfo.url)` branch would never see a URL.

**Recon inference vs empirical truth — the pin FALSIFIED the recon.**

Recon inferred the guard likely fires in production: `content_scripts.matches` with the all-URLs pattern would be an effective host-access grant exposing `changeInfo.url`. The first version of the empirical pin asserted exactly that (extension page registers `tabs.onUpdated`, dApp tab navigates to a localhost origin covered by neither `"tabs"` nor `host_permissions`) — and it FAILED in all 3 retries: no URL was ever delivered. The recon's "live evidence" (playground session lifecycle works on localhost) was itself blind — lifecycle works via realm teardown, not the guard. Chromium's tabs-API scrubbing checks **explicit hosts only** (`host_permissions`), never scriptable hosts (content-script matches).

**Settled verdict: the guard's cross-origin branch is DEAD for ordinary web origins.** It executes only when the navigation *destination* matches an explicit grant (`https://nulo.sh/`, `http://127.0.0.1/*` — any port, match patterns ignore ports; a runtime tab-specific/site-access grant would be another visibility route, none exists in the default manifest/fixture state). And the second recon conclusion stands unchanged: **belt-and-suspenders, no security hole either way.** The boundary is realm teardown, NOT session-id secrecy — codex's end-diff pass caught that the first draft overclaimed here: the PAGE generates the discovery `requestId` that the background adopts as the `sessionId` (vendored SDK `extension_provider.ts` / `background_connection_handler.ts`), so the sessionId is not a secret from the dApp. What actually holds: navigation destroys both MessagePort ends and the content script's per-document ports map, and the ECDH sharedKey dies with that realm. A stale ActiveSession is inert memory, cleaned by `tabs.onRemoved` (fires without any URL grant), SW eviction, the DappSession deletion sweep, and the 7-day TTL.

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

- **Empirical falsification (the arc's pivot):** the first pin (assert `changeInfo.url` arrives for a localhost nav via the content-script grant) FAILED 3/3 retries → recon inference overturned; deliverables reshaped to the two-sided pin + mostly-dead doc + owner-gated `"tabs"` recommendation. The main test's cross-origin nav moved `about:blank` → `127.0.0.1:<node-port>` so the guard branch genuinely executes.
- **SOLO proverless e2e** (`session-tabNavigate.test.ts`): 2/2 green on the two-sided truth (main flow + visibility pin). Re-run pending on the codex-tightened predicates.
- **Codex end-diff (xhigh, single pass per light tier): `conditional approve`** — conditions: (1) rebase onto current origin/dev (arc A had merged mid-review) — DONE; (2) correct the sessionId-secrecy claim (page generates the requestId that becomes sessionId — verified in the vendored SDK; boundary restated as realm/port teardown + ECDH key loss) and qualify the grant statement with the runtime site-access route — DONE in tab-lifecycle.ts + this plan; (3) tighten the pin: leg 1 now matches the guard's exact `status === "loading" && url` predicate, leg 2 waits for the navigation's terminal `status === "complete"` before the negative assertion — DONE. Codex independently confirmed the two-sided conclusion against Chromium's permission model (scriptable vs explicit hosts), found no harmful double-termination, and confirmed B2 has no live caller routes.
- **Codex note on "architecture inventory":** the remaining `getTokenInterface` mentions live only in `audit/**` historical run records (frozen findings artifacts) and `implementations-plan/` history — not in any live inventory (ARCHITECTURE.md / package READMEs are clean). Deviation documented: historical audit records are immutable; not edited.
