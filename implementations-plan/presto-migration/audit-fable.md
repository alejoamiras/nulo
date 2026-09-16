# audit-fable.md — Fable 5.1 (Plan subagent, fresh context) audit of plan.md v1

Round 1, 2026-09-15, run in parallel with the Codex audit on the same packet. Response pasted
verbatim below (file paths rewritten to repo-relative; Presto files name the Presto repo). Every
factual claim was verified before folding into plan.md v2 — see the Decision ledger there; one
claim was corrected (the SW-side event gate, noted at the end).

---

`conditional approve (with conditions: move the `https://127.0.0.1/*` manifest permission into arc 1/P2; replace I3 with a journal `updateProgress` seam or a non-journal carrier; carry a per-prove correlation id instead of `chainId`; drop the composable's LNA `permissions.query` short-circuit; put `httpsOnly` on the `required` arm only; handle the card banner's dismissal; add a `denied` surface; rewrite the health-tier assumptions in §C/§E)`

## Security

**High — arc 1 alone silently disables native proving for real users.** Production goes HTTPS-only in P2 (`resolveHttpsOnly` → `true` in the offscreen document, `sdk-core/src/lib/config.ts:32-40`), but `https://127.0.0.1/*` only lands in P5. `apps/extension/manifest/manifest.config.ts:20` grants `http://127.0.0.1/*` only, so the offscreen's HTTPS probe runs without host permission: CORS applies and, on Chrome 142+, LNA applies to a document that has no UI to answer a prompt. Default mode swallows this as `secure-connection-unavailable → fallback`. CI cannot catch it (required mode uses HTTP). Fix: manifest change in P2; add a `chain-runtime.test.ts` case is not enough — add the manifest assertion to P2's gate.

**Medium — `httpsOnly:false` is representable in default mode.** §A puts `httpsOnly?` on `PrestoEndpoint`, shared by all three arms. Move it to the `required` arm only so the type, not the negative bundle-grep, is the first line. Keep the grep.

**Medium — `nulo:prover-phase` sender check is weaker than the repo's own primitive.** `sender.id === chrome.runtime.id` is also true for the extension's content script (`matches: *://*/*`, `all_frames`). Use `isTrustedInternalSender` (`packages/extension-messaging/src/core/sender-auth.ts`) and additionally require `sender.url === chrome.runtime.getURL("src/offscreen/index.html")`. Impact is cosmetic (a subtitle), so Medium, not High.

**Medium — a `denied` prove is invisible everywhere.** Presto prompts per origin on `/prove`, not `/health`; 60 s auto-deny then a 30 s cooldown (`authorization.rs:228,467-489`). Settings → Proving will read "Presto · connected" (health is fine) while every tx proves in WASM. The plan forwards only `transmit|fallback|proved`. Forward `denied` (and `version-mismatch`) and keep a SW-memory "last prove outcome" the Settings page renders with the Presto → Sites recovery step. The onboarding copy "approve Nulo in Presto's prompt" is at the wrong moment; the prompt appears at first tx.

**Low — banner facts misstated in the Security section.** Shadow root is `open`, not closed (`element.ts:246`); rendering is `innerHTML` of static templates with `escapeHtml(href)` (`render.ts:504`), fine under the extension CSP; `fonts="none"` verified to skip the Google Fonts link (`fonts.ts:99`). No `img` loads, so COEP `require-corp` is safe.

**Low — sidecar is not defense in depth against origin compromise** (same origin as the tarball); it only catches transfer corruption. Keep the extracted-binary pin as the boundary; say so in the action comment.

**Low — min-age excludes wider than needed.** presto/presto-core clear the 7-day gate at 2026-09-15T22:29Z/22:58Z; only `presto-banners` needs an exclude past that. Exclude only what is still gated at install time. `npm audit signatures` needs a package-lock; name the actual command used (attestation verify).

## Assumptions

**Facts**
- F13 misstated: the offscreen `Service` base already has a typed push primitive, `sendEvent()` (`packages/extension-messaging/src/offscreen/service.ts:64-69`), gated by `isTrustedInternalSender` on the receiving side. `PxeService` can declare an `EventsMap` and emit `provePhase`; a raw string message is not "the same primitive as READY", it is a step backwards from the existing typed channel.
- F9: line 20, not 18. Trivial.
- F8 incomplete: the card variant renders a close button (`render.ts:573`) and dismissal persists 7 days in `localStorage["presto:banner:card:offline"]` (`element.ts:441-447`). A user who dismisses once and later resets the wallet never sees the pitch again; `reset.vue` clears `chrome.storage`, not page `localStorage`. Handle `presto-banner:dismiss` as Skip and call `clearDismissal` on mount, or set `dismiss-days` to a value that matches the onboarding semantics.
- F4/F3 hold. Verified `createChonkProof` has no try/catch around `client.prove` (`presto-prover.ts:170-186`), so an `onPhase` throw propagates — the required-mode guard works.
- F6 verified at the `presto-v1.1.1` tag (283/475).

**Inferences**
- I3 is false. `_transitionLocked` calls `assertCanTransition(existing.progress.stage, progress.stage)` unconditionally (`operation-journal/service.ts:316`) and `proving → proving` is not in the table (`fsm.ts:46`). Same-stage rewrite throws `IllegalTransitionError`. The seam is required, not optional; write it into P8 now.
- I1 is moot: the SDK already queries `loopback-network` then `local-network-access` on every probe failure (`presto-transport.ts:176-197,774`) and skips the retry on denial. The composable's pre-probe short-circuit duplicates it and produces a `permission-blocked` the client never cached, so `bannerStatus` and `state` diverge. Drop it.
- I7 holds (`sendMessage` is fire-and-forget; READY proves the channel), but `chainId` attribution is unsafe: the SW journals `proving` before the offscreen `withPxeWrite` lock (`execution-coordinator.ts:196`, `service.ts:467`), so two ops can be `proving` on one chain while one actually proves. Pass a per-prove correlation id through the `proveTx` RPC, set it on the runtime inside the write lock, include it in the event. Otherwise attribute only when exactly one op is in `proving` for that chain, else leave `backend` unknown.
- I5: Presto desktop ships `https_enabled: false` on a clean install and the wizard enables it (`config.rs:96-101,134`); users who decline the wizard step land in `https-disabled`. Handled by the state machine, but make sure P6's e2e covers it.
- New, unlisted: `/health` is tiered by origin (`server.rs:413-445`). An unapproved `chrome-extension://` origin gets the minimal body, so until the user has approved Nulo at first prove: `needsDownload` is always false (the `downloading` state is unreachable), `appVersion`/`nativeAztecVersion` are absent (§E Details rows are "—"), and the HTTP diagnostic can only yield `presto-reachable`, never `https-disabled`/`tls-or-trust-failure`. §C's copy must treat `presto-reachable` as the primary arm and the Details block must degrade gracefully.
- I2 plausible; the alias may be unnecessary if the published package exports resolve cleanly — verify before keeping it.

**Asks to surface**
- A3 needs a prerequisite: a manifest `key` so unpacked/dev IDs are stable; otherwise every dev reinstall re-prompts in Presto and the verified-sites entry cannot be filed.
- Firefox MV3 treats `host_permissions` as optional; the user must grant them. Not a regression (already true for HTTP), but the new HTTPS-only default makes the failure user-visible. Decide whether Firefox gets a `permissions.request` step or stays best-effort.
- Whether `__AZTEC_VERSION__` (derived from `@aztec/pxe`, `vite.shared.ts:30`) is the version the page-side client should send; the offscreen prover sends the SDK's own `@aztec/stdlib` pin. Both are 5.2.0 today; pin the equality with a test or derive one from the other.

## Implementation

- **High** — Use `PxeService` events instead of a raw `nulo:prover-phase` string (see F13). `ProvePhaseObserver = (phase) => void` in §A also contradicts §F's `chainId`; make the observer receive `{ profileId, chainId, proveId, phase }`.
- **High** — P8 must specify the journal seam (`updateProgress(id, patch)` that only widens the current stage's payload, under the same `transitionLock`) or use the non-journal path: `proveTxTask`'s `StepContent` label, which `RecentActivityView.vue:431-441` already renders over `stageSubtitle` when the task matches unambiguously. The label route needs no schema or FSM change; weigh it.
- **Medium** — (d) Throwing on `secure-connection-unavailable`/`version-mismatch` is redundant (`#fallbackToWasm` always emits `fallback` afterwards, `presto-prover.ts:206`) but harmless; keep only for the clearer message and say so in the test.
- **Medium** — (g) `usePrestoStatus` constructing its own `PrestoClient` breaks the C1 letter ("receives a connected client"). Accept an injected client (default factory in the caller) — it also makes the ≥10-case test cheap without `vi.mock`. `dispose()` cannot cancel a `checkStatus` (no abort signal); it can only drop the late result — reword P5's test.
- **Medium** — (h) Do not write `uiStateFromStatus`; `stateFromStatus` (`banners/src/status.ts`) is the exact rule set and is exported. Wrap it: `{ kind: stateFromStatus(s), diagnosis, info }`. One source of the `unconfirmed` rule.
- **Medium** — (f) Gates: all commands exist (`test:ci-gating`, `lint:actions`, `typecheck:all`, per-package `test`, `check-no-brand.sh`). But the soak dispatch passes `shard_label: soak-N`, so the `PROVE_SUCCESS ≥ 1` assert is printed, not enforced (`_extension-network-e2e.yml` enforces only `canary`). The P3/P8 gate is observable from the notice but the enforced gate is the PR canary job; state that explicitly. P6's e2e must craft the HTTP body per `isDetailedHealthBody` (`presto-transport.ts:330-340`) or it will get `presto-reachable`, not `https-disabled`.
- **Low** — F16-based P1: after tonight only one exclude is needed.

## Competing outline

Neither as written. Take the plan's two-arc shape with these edits: arc 1 = SDK + CI + **manifest** + `PxeService` prove-phase event + journal/label seam (the runtime truth); arc 2 = onboarding, settings, subtitle rendering. The competing outline loses because a bare HTTPS `/health` fetch cannot produce the diagnosis — correct — but the plan's page-side client also cannot see denial; the offscreen event channel is what makes "the wallet tells the truth" true, so it belongs in arc 1 where the canary exercises it.

## Looks fine

Tried and could not break: the required-mode HTTP path (`allowsHttpDowngrade` is true while HTTPS never answered, so HTTP pins; `assertLoopbackHost`/`assertPort` reject any non-loopback config); the production HTTPS-only squatting story (a foreign 200 on 59834 fails `isRecognizedHealthBody`, TLS fails without the name-constrained CA, HTTP diagnostic never pins or POSTs); `PRESTO_ALLOW_ALL=1` (verified in README and `health_is_detailed`'s `None` arm — headless allow-all also serves the detailed body, so CI preflight sees `bb_available`); `pkill -TERM presto-server` name; `presto-server` health/log literals; `definePrestoBanner` is idempotent; `isCustomElement` predicate does not collide with `unplugin-vue-components`; `proveTx` is serialized per chain under `withPxeWrite`; the negative-grep DCE pairing (stamp and factory branch key off the same constant, same mechanism as proverless).

### Critical files for implementation
- `apps/extension/manifest/manifest.config.ts`
- `packages/aztec-runtime/src/pxe/chain-runtime.ts`
- `apps/extension/src/wallet/services/operation-journal/service.ts`
- `packages/extension-messaging/src/offscreen/service.ts`
- Presto repo: `packages/sdk-core/src/lib/presto-transport.ts`

---

## Driver verification (before folding)

All claims checked against source. One correction: **F13's "gated by `isTrustedInternalSender` on
the receiving side" is wrong for events.** `isTrustedInternalSender` guards *requests* arriving at
the offscreen/background `Service`; the SW-side `OffscreenClient` listener
(`packages/extension-messaging/src/offscreen/client.ts:60-83`) accepts any runtime message whose
`from` equals the service name and never reads `sender`. The typed `sendEvent()` primitive is still
the right carrier, but v2 adds the sender gate on the client (`isTrustedInternalSender(sender)` plus
the offscreen page URL) rather than assuming it exists. Everything else held, including the health
tiering (`presto/core/src/server.rs:415-445`), the auto-deny/cooldown constants
(`authorization.rs:228`), and the dismissal persistence (`banners/src/persistence.ts`).
