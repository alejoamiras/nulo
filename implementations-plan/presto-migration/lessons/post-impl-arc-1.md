# Arc 1 — codex fix loop (2026-09-15)

Reviewer: `/codex` (GPT-6 Astra, `high`, read-only sandbox) over the arc-1 range `323380f6..HEAD` with the arc-1 review prompt (facts, the two documented deviations, adversarial asks, both verbatim rules, "do not run vitest e2e configs"). One session, resumed per round.

## Round 1 — "Changes requested", 5 findings + 6 comment nits

| # | sev | finding | verdict | fix |
|---|---|---|---|---|
| 1 | MED | `offscreen/client.ts`: an event with `to === uid` bypassed the sender gate; every extension page sees the uid on the request broadcast, so a popup-shaped sender could forge a schema-valid higher-seq phase (not reachable from a content script or dApp) | accepted — reproduced by reading the listener | responses are matched by uid only; every event needs `isOffscreenPageSender`, addressed or not; test: addressed event from a popup sender dropped, from the offscreen page delivered, a response from a popup sender still resolves |
| 2 | MED | coordinator recorded `attempt.backend` before the journal write; a transient rejection suppressed every later event with that backend, leaving the journal on the stale backend | accepted | `attempt.backend` set only after the write resolves; test: reject once at `fallback`, the next `browser` event lands |
| 3 | LOW | malformed-payload assertions ran after the attempt was deleted, so the map lookup alone made them pass | accepted | new test on a live attempt: bad phase / bad backend / fractional and negative seq change nothing and do not consume the seq |
| 4 | LOW | the "Firefox" gate test used a `chrome-extension://` url; the last test promised a response assertion it never made | accepted | `getURL` stubbed to `moz-extension://` for that case; the response assertion moved into the addressed-event test; the sender-drop test renamed |
| 5 | LOW | shim copy "Presto is fetching its prover" — a health probe starts no download; the SDK downloads on the first prove | accepted (the shim is deleted in P7, but arc 1 ships it) | "Presto downloads its prover at your first send — nothing to do now. Skip to continue." |
| c1 | — | `advanceProve` doc: `transmit` is emitted before the POST (intent, not delivery); "never undo" contradicted `transmit → fallback` | accepted | reworded |
| c2 | — | `bunfig.toml` / `agent.sh`: lesson and review provenance in permanent comments | accepted | provenance removed; expiry, trust limitation and the build-stamp invariant kept |
| c3 | — | `prove-phase-sink.ts` header narrated the wiring | accepted | one line |
| c4 | — | `ProveBackend` / `waitForAwaitingCardBackend` were inserted between a doc comment and its symbol | accepted | moved |

Codex noted it could not run vitest in its read-only sandbox (vite config write + worker timeouts); its two reproductions ran in memory. The driver ran the gates after the fixes:

| gate | result |
|---|---|
| `extension-messaging` `offscreen/client.test.ts` | 32/32 |
| extension `execution-coordinator.prove-phase.test.ts` | 11/11 |
| `wallet-core` `bun run test` | 247/247 |
| `aztec-runtime` `bun run test` | 223/223 |
| `bun run typecheck:all` | exit 0 |
| `bun run lint` | exit 0 |
| `scripts/check-no-brand.sh`, `bun run lint:actions` | ok / exit 0 |

"Looks fine" from the round: `activeProve` scoped inside the per-chain write lock; denial-generation logic; the HTTPS-only client behaviour on all three failure scenarios; the archive/hash/cache-hit/`PRESTO_ALLOW_ALL` CI posture; the two documented deviations (coordinator-owned denial records, `onProvePhase` naming).
