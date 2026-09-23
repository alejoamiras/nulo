# Phase 2 lessons — reset-flow flakes (Fixes 2 & 5)

## The reset-checkbox flake reproduced LOCALLY, solo, idle — and it overturns the plan's hypothesis

Ran `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts`
twice on the idle homelab. **Both runs failed identically** at `resetProfile`'s 5s
checkbox wait (`helpers.ts:1039`) — i.e. the CI flake reproduces WITHOUT any load. That
alone falsifies the drafted "renderer starvation under CI load" root cause (which both
auditors independently doubted — fable called the corroboration confounded, codex called
it unproved).

### The instrumented parked-state dump (decisive)

Added a timeout diagnostic to `resetProfile`. On the second (instrumented) failure:

```json
{"hash":"#/popup/general","pageRootMounted":false,"checkboxInDom":false,
 "checkboxStyle":null,"checkboxRect":null,
 "testidsOnPage":["incoming-trust-contract-expand","incoming-trust-contract",
   "incoming-trust-contract-full","incoming-trust-contract-copy","incoming-trust-reject",
   "incoming-trust-allow","account-selector","network-button","header-lock",
   "balance-amount",...,"nav-general","nav-activity","nav-settings"],
 "readyState":"complete"}
```

The checkbox never mounts because **the router is not on the reset route** — it is fully
back on `#/popup/general` (all general-page testids present, `readyState: complete`).

### Real root cause: a one-shot navigation wait races a competing re-navigation to general

`navigateByHash` (`helpers.ts:1002-1015`) sets `window.location.hash` and then does a
ONE-SHOT `waitForFunction(hash === target)`. Setting `location.hash` updates the URL
synchronously, so that wait passes on the first poll — **before vue-router has committed
the navigation**. A competing navigation back to `/popup/general` then supersedes the
in-flight reset navigation, and the hash reverts. `resetProfile` waits 5s for a checkbox
on a route the app already left.

This is exactly the pattern the `e2e-testing` skill documents: *"One-shot route checks
race vue-router settling — use settle loops."*

Competing-navigation source (narrowed, not yet 100% pinned between candidates, but the
FIX is identical for all): the popup re-runs `loadProfile()` on SW-port reconnect
(`app.vue:238-245` `isBackgroundConnected` watcher) and on the post-unlock bootstrap from
`reopenAndRecoverAfterImport`. `bootstrapActiveProfile` + the notification/incoming-trust
re-check churn fires around the same window. Whichever fires, it issues a `router.push`
that lands after `navigateByHash`'s one-shot wait returned. The `incoming-trust-*` prompt
atop the parked page is a teleported overlay from that bootstrap re-run.

**This is load-independent** (a logic race, present on an idle box) — which is why it
reproduced locally when the genuinely-environmental smoke-roundtrip flake did not.

### The causal fix (changes WHAT is awaited, not how long)

`resetProfile` must make the navigation SETTLE-STABLE: navigate, then wait for the
checkbox to appear AND the hash to REMAIN on the reset route across a short settle window;
if the hash reverted, re-navigate and retry. The awaited signal becomes "the reset route
committed and stuck", not "the hash momentarily equalled the target." No timeout raise —
a genuinely different, causal signal. Diagnostics stay (cheap future-red insurance).

De-spamming the 40× refresh loops is now SECONDARY hygiene (it reduces the SW-reconnect
churn that raises the race probability, and it shortens the purge via the ReadWriteGuard
reader-drain coupling) — it is NOT the root cause. Do not claim it as such.

## Fix 5 (purge completion) — audit-driven signal correction

Tombstone ABSENCE alone is not "purge complete" — it is also true BEFORE deletion starts
and after a pre-tombstone rejection (both auditors). Causal predicate: capture the profile
id, PROVE its row exists before submit, then require (row absent AND exact tombstone
`nulo:core:profile-tombstones@<id>` absent AND the test's owned roots cleared). `security-reset.test.ts`
has a 30s file-level test timeout the sweep must fit inside.
