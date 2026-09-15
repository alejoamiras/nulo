# Arc 2 — codex fix loop (2026-09-15)

Reviewer: `/codex` (GPT-6 Astra, `high`, read-only sandbox) over the arc-2 range `worktree-presto-migration..HEAD` with the arc-2 review prompt (the verified SDK facts, the five documented deviations, the fixture-filter fact, adversarial asks 1–6, both verbatim rules, "do not run vitest e2e configs"). One session, resumed per round.

## Round 1 — "Changes requested", 3 findings + 3 nits

| # | sev | finding | verdict | fix |
|---|---|---|---|---|
| 1 | MED | `settings/index.vue`, `proving.vue`: the pages disconnect the `ExecutionServiceClient` but not the `LoggerServiceClient` it owns; codex reproduced three logger ports left open after three connect/disconnect cycles | **declined for this arc — pre-existing and repo-wide.** Every one of the 28 service clients in `apps/extension` constructs its own `LoggerServiceClient` in its ctor and hands it to the messaging base, which logs "Connected"/"Disconnected" through it — so `disconnect()` itself re-opens the logger port, and no consumer in the tree (`send.vue`, the execute window, `RecentActivityView`, `balances.store.ts`) can reach it. The two new pages are the same shape as every existing consumer. The fix is one change in `@nulo/extension-messaging`'s client base (tear the owned logger down after the final log), which is arc-1 territory and a behaviour change for every client; listed as a follow-up in the wrap-up | — |
| 2 | MED | `fixtures/extension.ts` `isPrestoProbeNoise`: accepted every "Failed to load resource" text (a 500, a certificate failure) and a regex that also matched swapped scheme/port pairs and `/health-anything` | accepted | the text must carry `net::ERR_CONNECTION_REFUSED` and the URL must equal one of the two health URLs, now imported from the new `fixtures/presto.ts` (which also owns the health bodies and `interceptHealth`, previously duplicated by `onboarding-tab.test.ts` and `settings-proving.test.ts`) |
| 3 | MED | `usePrestoStatus.test.ts` "autoDetect=false never probes": ran the composable in a bare `effectScope`, where `onMounted` is a no-op — deleting the `autoDetect` guard in production would still pass | accepted — a test that cannot fail | two mounted-host cases (`@vue/test-utils` + `defineComponent`): the default probes exactly once on mount; `autoDetect: false` never does |
| n1 | — | `downloading` copy promised "every proof is native"; `needsDownload` only says the version is missing from the cache. `rowDescriptionFor` said "encrypted connection off" for a certificate failure | accepted | "…which starts with your next proof."; "Presto · encrypted connection unavailable" (test updated) |
| n2 | — | `PrestoStatusCard.vue` header inventoried the template; `detailRowsFor` doc claimed every value degrades to `—` (Connection stays `Encrypted`) | accepted | one line each |
| n3 | — | the fixture helper was inserted between `launchExtension` and its doc comment | accepted | moved above the comment |

Codex's other checks (quoted): "No attacker-controlled markup/URL path or dismissal bypass found. The banner mounts after a non-null SDK status is assigned; dismissal clearing precedes that mount, and wrapper listeners are removed. Both settings routes require authentication. The status client only requests the two intercepted health URLs and refuses redirects."

Gates after the fixes:

| gate | result |
|---|---|
| `usePrestoStatus.test.ts` + `presto-ui-state.test.ts` + `PrestoStatusCard.test.ts` | 60/60 |
| armed build | exit 0 |
| smoke: `onboarding-tab`, `settings-proving`, `accounts`, `navigation` | 4 files, 23 tests, exit 0 |
