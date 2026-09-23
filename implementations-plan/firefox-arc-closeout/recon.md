# Recon — firefox-arc-closeout

Base: dev `60da5d66` (the worktree's own base). Two read-only explorers (dApp transport; canaries + CI pins);
the parent re-verified every load-bearing claim marked **✔** against the tree before persisting it.
`@aztec/wallet-sdk` read at the installed `5.2.0`.

## Reuse map

### Item 1 — a dApp call in flight when the background dies

| Capability needed | What exists | Verdict |
|---|---|---|
| A wallet→dApp message that needs **no session key** (a restarted background has none) | The SDK's own `session-disconnected` (background→content script), forwarded to the page as `WalletMessageType.DISCONNECT`. Sent **unencrypted** by `BackgroundConnectionHandler.terminateSession()`; the content-script handler needs only its own `ports` map, which lives in the tab and survives the background's death | **reuse-as-is** (the wire shape) |
| The dApp rejecting what it has in flight | `ExtensionWallet.handleDisconnect()` rejects **every** in-flight promise with `Error("Wallet disconnected")` and fires `onDisconnect`. `apps/playground/src/lib/wallet.ts` already subscribes. The SDK's only other exit is its heartbeat: PING every 5 s while a call is in flight, self-declared dead after **300 s** of silence — which is the hang measured at 210 s, not yet expired. The dApp owns that option; the wallet cannot shorten it | **reuse-as-is** |
| Something that *sends* it after a restart | Nothing. All four teardown call-sites (`wireSessionTeardown`, `wireProfileSwitchTeardown`, `wireTabLifecycle`, the identity-guard fail path in `background.ts`) go through `handler.terminateSession(sessionId)`, which returns early when the session is not in the **current** handler's in-memory map — always the case on a fresh boot. `handlePing()` silently drops a PING for an unknown session | **build new** — a small dispatch that produces the same wire shape for a session the handler does not know |
| Where an incoming content-script message is inspected before the SDK sees it | `content-script-validator.ts` (`validateContentScriptMessage`, `isSubframeSender`) inside `buildContentTransport` (`background.ts`), fed by `content-message-relay.ts` — the **single** `runtime.onMessage` listener for content-script traffic. `sessionId` and `sender.tab.id` are already in hand there. Pre-attach the relay buffers **only** `discovery-request`; every other type is dropped (its arrival still wakes the background) | **adapt** — the reactive check belongs in this chain, never in a second listener |
| Knowing, at boot, which tabs held sessions | Nothing persisted: `DappSessionService` rows (`chrome.storage.local`) carry no `tabId` and no transport `sessionId` (a different id from `DappSession.id`); `chrome.storage.session` holds `nulo:liveness`, the session bearer, logs, e2e gates. Search: `storage.session` repo-wide (43 hits, none session-shaped); `dapp-session/spec.ts` read in full | **build new** only if the design pushes proactively at boot |
| Boot-time reconciliation pattern | `JournalReaper`'s boot sweep (`operation-journal/reaper.ts`, armed from `runtime.ts` after `services.start()`), `DiscoveryQueue`'s constructor-time badge reconcile (F-B16). Both reconcile durable state against an in-memory state that reboots empty; neither talks to a tab | **reuse the pattern** |
| The wallet's own UI for the interrupted send | The send's journal record is already reaped to `failed` (`sw_restart_post_prove` / `stale_on_resume` / `stuck_queued`) and rendered by `TransactionTerminalCard`'s amber "Interrupted" card | **reuse-as-is** — no UI change expected |
| Error wording precedent | `SESSION_INVALID_ERROR` (4900, "Session no longer valid — reconnect") in `error-envelope.ts`; its own comment says the code carries the meaning and the teardown carries the behaviour | reference only — no live channel exists to send a *response* through after a restart |
| Reproducing "a call in flight when the background dies" | `holdProofGate` / `releaseProofGate` (`fixtures/proof-gate.ts`, proverless builds), `stopBackground` / `backgroundAlive` (the driver seam), `readLivenessBaseline` / `waitForWorkerLiveness`. The 210 s measurement spec was deleted after its two runs (`firefox-background-kill/lessons/phase-2.md`) | **reuse helpers, build the spec** |
| Content-script-side detection of a dead background | Nothing: the SDK's content script discards `sendMessage`'s result; no `onDisconnect`, no `lastError` handling. The content script is 22 lines of SDK wiring | not needed by the chosen design; **do not build** |

**Fences this change must not cross ✔:** the single-listener rule in `content-message-relay.ts`; `legal/call-sites.test.ts`
(no new `assertCurrent` caller); `log-payload-ban.test.ts` (object-argument logging, `describeExternalId` for session
ids); `storage-facade-ban.test.ts`; `InternalMessageType` is **not** exported by the SDK, so the literal is hardcoded
with a citation, as `content-script-validator.ts` already does for the other wire strings. The manifest has no
`"tabs"` permission and needs none: `tabs.sendMessage(sender.tab.id)` works from the sender.

**A stated asymmetry:** F-B16 deliberately chose "clean loss, the dApp times out at 60 s" for a *queued discovery*.
This plan chooses the opposite for an *established session with a call in flight*, because there the dApp's only
timeout is 300 s and the user is mid-transaction. The plan must say so; a reviewer will notice.

### Item 2 — the two execution canaries on Firefox

| Item | Finding | Verdict |
|---|---|---|
| `network/frozen-account-canary.test.ts` | Already follows the Firefox-safe recipe: every extension page is closed before `stopBackground` (the seed popup closes itself; execute popups self-close on approve), a fresh popup wakes the successor, `ensureUnlocked` handles the strict-mode lock. One comment mentions the offscreen re-boot, which is Chrome's | **port as-is** — drop the skip, reword the comment |
| `network/passkey-execution-canary.test.ts` ✔ | Keeps `anchorPopup` open for the whole test — including across the kill at stage 4 — because on **Chrome** the virtual authenticator is scoped to that page. On Firefox the kill is declined under an open extension page, so as written stage 4 would throw after 15 s. **But** `FIREFOX.md` records that Firefox's virtual authenticator is *session-scoped* — "a credential outlives the window that made it" — so on Firefox the popup can be closed before the kill and a new one opened after | **adapt** — a driver-level fact ("the credential outlives its page"), not a test-level `isFirefox`; fallback if it does not hold: stage 4 skips in-file on Firefox, stages 1–3 still run |
| CI wiring of the frozen canary ✔ | Chrome canary shard: `transfers`, `tx-sendTx-default`, `frozen-account-canary` (`pr-extension-network-e2e.yml`). Firefox canary shard: the first two (`pr-extension-network-e2e-firefox.yml`, with a now-false comment). Nightly mirrors both. One `presto-server` per job serializes proofs; job `timeout-minutes: 30`, shared | **edit both lists + nightly** |
| CI wiring of the passkey canary ✔ | **In no workflow at all** (zero matches in the PR lanes and nightly). Not being in the proverless pool's `exclude_files`, it is sharded into Chrome's **proverless** pool on every PR: the file whose header says "run prover-ON" has never run prover-ON in CI | **pre-existing QA gap** — an Ask |
| The pin | `scripts/ci-cd/behavior-gating.test.ts`: `CHROME_ONLY_CANARY` names only the frozen canary; the PR and nightly assertions are "Firefox runs Chrome's files minus it". Its partition check asserts `exclude_files == union(dedicated lists)`, not "every spec sits in exactly one deliberate pool" — which is how the passkey gap went unseen | **edit in the same commit as the YAML**; consider pinning the canary set by name |
| `CHROME_ONLY.canary` + the seam scan | The constant goes when no file uses it. `RELOAD_DEBT` entries for both canaries are dApp-page reloads, already unguarded on Firefox in `session-reconnect` | constant: **remove**; scan: no change |
| Docs that state the rule ✔ | `FIREFOX.md:28` (the canonical row), `CLAUDE.md` (Firefox-lanes bullet), `CI.md:85`, `.github/README.md:15`, `e2e-testing/SKILL.md:29` and `:366-368`, `aztec-update/SKILL.md:29`, `firefox-background-kill/plan.md` Ask A1. The bump-gate rule (`CLAUDE.md` § Account-address freeze, `UPDATE.md:21,120`, `aztec-update/SKILL.md:93-113`) is Chrome-implicit | **edit together** with the pin |
| Frozen-account code | `packages/aztec-runtime/src/account/` has no browser API anywhere | browser-independent |
| Cost | The only wall-clock on record: frozen canary alone, prover-ON, homelab, 107.8 s. No Firefox proving time on record; the first real run decides whether the 30-minute job budget holds | **measure in a phase gate** |

### Item 3 — the one-round-trip residual in Firefox's `stopBackground`

Closing it needs an identity check inside the privileged script body, which sessions do not author or edit. Codex
rated the residual acceptable for a test harness (`firefox-background-kill/lessons/phase-3.md`, round 3). Default: drop.

## Open questions carried into the plan

1. Reactive (answer an unknown `sessionId` with `session-disconnected`) vs proactive (persist `{sessionId, tabId}` and
   push at boot) vs both. Reactive needs no new state and is bounded by the dApp's 5 s PING; the pre-attach relay
   can answer too, because before attach *no* session can exist.
2. The passkey canary's CI gap: fix here, or file it.
3. Whether the `@aztec` bump gate names Firefox.
4. Whether a Firefox canary shard with four files fits 30 minutes.
