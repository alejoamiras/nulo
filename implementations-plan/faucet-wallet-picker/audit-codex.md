# Codex audits — faucet-wallet-picker (light tier: 3-round plan audit, one session)

gpt-5.6-sol @ xhigh, read-only sandbox, one resumed session (`019f849e-cd65-7f11-ac1a-d74fb8bcdabc`)
across three rounds. Round 1 audited plan v1; the session was resumed with the v2 and v3
revisions so codex evaluated each against its own prior findings.

## Round 1 — on v1: REJECT

`reject (with blocking findings: spoofable identity is treated as trusted, SDK cancellation
semantics are mishandled, and the state machine/gates are incomplete)`

Key findings (all verified against the SDK source by codex, all adopted):
- `provider.id` is the wallet's OWN `walletId` config — unauthenticated, un-deduped; a malicious
  extension can claim `"nulo"` and win a remembered-id match; emoji verification proves channel
  integrity with the selected endpoint, NOT identity. → v2's "Threat framing" section,
  announcement-keyed rows, fail-closed remembered path.
- The SDK buffers `pendingProviders`; `cancel()` doesn't clear the buffer (post-cancel yields
  arrive); keeping discovery open is not side-effect-free (other wallets allocate ports/pending
  sessions); re-entry re-announces providers. → epoch guard + cancel-on-selection.
- PRE-EXISTING BUG: the session's `onDisconnect` subscription is registered before `confirm()`,
  when the SDK returns a no-op — wallet-side disconnect cleanup never fires today. → fixed in
  scope.
- State machine: epoch/mutex over status-name guards; synchronous `selectWallet` transition;
  remembered-vs-manual ordering; error-status routing for remembered failures; explicit terminal
  semantics per discovery outcome.
- Gates: faucet `test:faucet` EXCLUDES `tests/e2e/**` (must name `test:e2e`); the faucet e2e is
  a mocked-wallet jsdom smoke; three always-mounted `v-show` panels share the session (selector
  scoping); the extension repo's network e2e never consumes the faucet flow.
- Icon/name hardening beyond CSS ellipsis; localStorage fallibility.

## Round 2 — on v2: REJECT (narrowed)

`reject (remembered-claim ambiguity is not actually enforced)`

- v2's "exactly one claimant so far" was self-defeating: the first match always satisfies it,
  the immediate cancel discards the buffered yields that would reveal the second claimant — a
  first-announcing spoofer still auto-connects. → v3's bounded 1s ambiguity window (remembered
  path only; discovery stays live during it).
- Epoch invalidation must clean up SDK side effects, not just discard state: stale establish →
  `pending.cancel()`; stale confirm → `provider.disconnect()`; late capability/setup →
  disconnect + never persist; tests assert the CALLS. → adopted.
- `activeFlow` as an owning token (a stale flow's `finally` must not release a newer flow's
  guard). → adopted.
- Icon allowlist rejected `chrome-extension:` — Nulo's own icon scheme — so every extension icon
  would fall back; plus source-length caps. → adopted.
- Everything else from round 1 confirmed "resolved in substance".

## Round 3 — on v3: CONDITIONAL APPROVE (final verdict)

`conditional approve (with conditions: describe the 1s collision window as best-effort
detection, not proof of uniqueness)`

- Window semantics confirmed sound: discovery remains active during the window, so buffered AND
  live yields are observed; cancellation afterward + epoch checks handle the remainder.
- SDK cleanup calls, owning-token `activeFlow`, icon scheme/length hardening: "all land
  substantively".
- Residual (folded as the condition): a claimant deliberately arriving after 1s is undetected —
  "unambiguous" means "no collision observed during the window". The plan now states this
  best-effort framing explicitly, and the window timer is epoch-owned (inert after manual
  selection/cancel/disconnect) with a dedicated Phase 1 test.

Both conditions are folded into plan.md (Threat framing, remembered-path design, Phase 1
required tests, and the inline verdict section).
