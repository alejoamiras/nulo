# origin-guard-truth + getTokenInterface removal [light]

Arc B of the post-remediation follow-on (parent: `implementations-plan/remediation-followups/plan.md`). Two halves, one PR: (B1) settle the "dead tabs.onUpdated origin guard" finding empirically; (B2) delete `getTokenInterface` from the token RPC surface (owner-authorized by the arc goal; zero production callers).

## B1 — the origin-guard truth

**The finding under investigation** (from the remediation audit): `wireTabLifecycle`'s `chrome.tabs.onUpdated` cross-origin session guard was suspected DEAD — the manifest declares no `"tabs"` permission, and `changeInfo.url` is permission-gated, so the guard's `if (changeInfo.status === "loading" && changeInfo.url)` branch would never see a URL.

**Recon verdict: belt-and-suspenders, NOT load-bearing — and likely NOT dead either.**

1. **The guard likely fires in production.** `content_scripts.matches` with the all-URLs pattern (manifest.config.ts) is an effective host-access grant — the grant class that exposes `changeInfo.url`, independent of `"tabs"` and `host_permissions`. Live evidence: the playground runs on a localhost origin covered by neither declared grant, and session lifecycle works. Not 100% confirmable statically → closed with an empirical e2e pin (see below).
2. **Even if it were dead, no security hole opens.** Navigation destroys both MessagePort ends (per-document realms — the content script's ports map dies with the document); the sessionId is a `crypto.randomUUID` the page never sees; the ECDH sharedKey never leaves the two parties. A stale ActiveSession is inert memory, cleaned by `tabs.onRemoved` (fires without any URL grant), SW eviction, the DappSession deletion sweep, and the 7-day TTL.

**Deliverables (per the goal: document + pin, NO manifest change):**

- `wallet-sdk/tab-lifecycle.ts` header now records the URL-visibility source and the guard's classification (bookkeeping hygiene + reconnect UX; the security boundary is realm teardown + unguessable session material).
- **Empirical pin** (`session-tabNavigate.test.ts`, new test): an extension page registers `chrome.tabs.onUpdated`; the dApp tab navigates to the aztec node's localhost origin (host-permitted by neither `"tabs"` nor `host_permissions` — match patterns ignore ports, so a 127.0.0.1 destination would have been contaminated evidence); assert `changeInfo.url` arrives. If a future manifest change drops the content-script grant class, this reds and the guard is genuinely dead.
- **Blind-test fix**: `session-tabNavigate.test.ts` navigated to `about:blank`, which the content-script pattern does not match — Chrome withheld `changeInfo.url`, the guard's cross-origin branch never executed, and the transport died only via realm teardown (the test passed for the wrong reason). Now navigates to the real cross-origin node URL so the guard branch runs for real. Guard logic itself stays covered by `tab-lifecycle.test.ts` units.

**OWNER-GATED half not shipped:** no manifest permission change was needed (the guard is not URL-starved), so the gated recommendation path was never triggered.

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
