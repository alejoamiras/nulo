# Closing ledger — the Firefox arc

What the arc (`firefox-first-class-spike` → `pxe-timer-throttling` → `firefox-background-kill` → this plan) leaves
in each of four states. Everything here is stated in the code and the docs it names; this page is the index.

## Done

| What | Where it lives | Proof |
|---|---|---|
| A dApp call in flight when the background dies is rejected within seconds, on both browsers, and the dApp reconnects from the same page | `wallet-sdk/stale-session.ts` + the content wrapper in `wallet-sdk/background.ts`; `ARCHITECTURE.md` §8 | `inflight-call-background-death.test.ts` (three kills, the deadline asserted), `background.transport.test.ts`, `stale-session.test.ts`, the SDK pins in `ping-pong.test.ts`; Phase 1 red on both browsers, Phase 2 green (Chrome 1.8–2.2 s / 5.0 s / 12–15 ms; Firefox 5.8–6.4 s / 5.2–5.3 s / ~250 ms) |
| The reply is tab-bound: an id another tab holds is answered like an absent one, the owning tab is never written to | D22; `sessionKnownTo(handler, sessionId, tabId)` | "no liveness oracle" and the tab-binding table tests |
| The frozen-account canary runs on Firefox | `frozen-account-canary.test.ts` (plain `describe`, `restartBackground`) | Phase 4: 2 passed / 0 skipped on both browsers, three native proofs each |
| The passkey canary runs on Firefox through a driver fact | `BrowserDriver.credentialOutlivesPage` (Chrome `false`, Firefox `true`); the spec closes the anchor popup before the kill where true and runs the ceremony in a fresh popup; the seam scan bans the fact in shared fixtures and helpers outside the driver files (a spec may read it, to state a real difference) | Phase 5: all four stages on both browsers, 2 passed / 0 skipped, three native proofs each; **stage 4 passed on Firefox** — the pre-declared stop was not reached |
| Every canary lane runs the same four prover-ON files on both browsers, and a canary that skipped, vanished or never ran reds the job | the three callers' lists; `_extension-network-e2e.yml` `Assert canary results` (`canary*`) over vitest's json report (`NULO_E2E_RESULTS_FILE`, `e2eReporters()`) against `scripts/ci-cd/canary-expectations.json`; `scripts/ci-cd/assert-canary-results.ts` | `behavior-gating.test.ts` "canary lanes" pins (a)–(e) over all four lanes, six mutations red then green; `assert-canary-results.test.ts` on reports captured from real runs |
| `CHROME_ONLY` names two files, both capability statements | `fixtures/browser/index.ts`: `backgroundKillUnderPage`, `cdpFetch` | `browser-seam.test.ts`; `FIREFOX.md` row 1 |
| The bump rule, everywhere it is stated | `CLAUDE.md` (§ Account-address freeze; the Firefox-lanes bullet), `CI.md`, `.github/README.md`, `UPDATE.md` ×2, the `e2e-testing` skill (§3, the restart paragraph, ledger #33), the `aztec-update` skill, `FIREFOX.md` | Phase 7's grep for "Chrome-only", "four files", "canary" |

## Consciously accepted

- **The one-round-trip residual in Firefox's `stopBackground`** — owner: *"Drop it"*. The privileged termination is
  polite: under an open extension page Firefox leaves the event page running and still reports the call done, so
  every spec closes its extension pages first, and `backup-restore-sw-restart` (which must kill under the open
  restore page) stays Chrome-only. A session never authors or edits the privileged script body; closing the
  residual would have needed the owner's own lines.
- **Recovery from a *cold* background rides on the dApp's heartbeat** — owner: *"leave it alone"* (the relay). A
  message that itself wakes a cold background is still dropped before the listener exists; the SDK heartbeats
  (5 s) only while a call is pending, so "within seconds" is what an attached background answers and "at once" is
  the next message after it attaches.
- **Four stated limits** (`ARCHITECTURE.md` §8, D13): a dApp with no heartbeat or a long custom interval has nothing
  on the wire to answer and ends at its own timeout; a hidden tab's throttled timers stretch "seconds" to about a
  minute; an invalidated extension context (the add-on reloaded or updated under the page) has no receiver; a
  handshake in progress when the background dies ends at the dApp's discovery / key-exchange timeouts — deliberate,
  and the opposite call from the queued-discovery case, for the reasons §8 gives.
- **The Firefox canary is a rule, not a required check.** The Firefox network lane stays advisory until its
  time gate (below); a red Firefox canary on an `@aztec` bump holds the bump because CLAUDE.md and the
  `aztec-update` skill say so, and the bump PR's reviewer reads that job by hand.

## Noted for a later look (outside this arc)

- **A page choosing a discovery `requestId` equal to another tab's live session** (D18, D22). SDK behaviour that
  exists today: the session id is the page-chosen discovery `requestId`. The tab-bound reply gives such a page no
  oracle and never writes to the owning tab, and isolation rests on approval, the browser-supplied tab id and the
  content script's port match — but whether the SDK should refuse a colliding id at discovery is upstream's
  question, untouched here.
- **A queued discovery lost with the background** (`implementations-plan/fix-discovery-restart-durability/`) keeps
  its accepted clean loss; §8 records why it is treated differently from an established session.

## Only time-gated

- `extension-smoke-e2e-firefox-status` becomes required after **14** consecutive green nightlies of
  `smoke-firefox-against-artifact`; `extension-network-e2e-firefox-status` after **30** consecutive green nightlies of
  the four `network-e2e-*-firefox` jobs (CLAUDE.md § Staged-rollout switches) — the owner's call, through the
  protection runbook.
- The first stable release's `smoke-firefox-against-artifact` green (the release chain's advisory Firefox job).
- The AMO gecko id (`wallet@nulo.sh`) the owner still confirms before a listing.
- `firefox-first-class-spike`'s index row flips to *completed* once the nightly + release evidence above is in.
