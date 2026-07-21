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

---

# Codex post-implementation audit (session `019f84d1-ef87-7160-98d6-50e61f7b3bf9`)

## Verdict

`reject (flow-ownership and retry races can corrupt or leak wallet sessions)` — 4 High, 4 Medium,
2 Low + test-integrity findings. Disposition (fix round committed as
`fix(faucet): post-impl audit round …`):

1. (H) `retryCapabilities` acquired no flow token → concurrent capability requests. FIXED:
   no-ops while any flow is live; acquires/releases the token for its own run. Pinned.
2. (H) The wallet-side `onDisconnect` handler wiped state without bumping the epoch → a late
   `registerContracts` continuation could set `connected` over the wipe. FIXED: the handler runs
   `wipeToIdle()` (epoch bump + flow release + sync wipe) and clears the preference when the
   remembered path was in flight. Pinned (disconnect-mid-setup test).
3. (H) Capability/build/setup failures retained provider/wallet/subscription; "Retry connection"
   discovered over a live session. FIXED: `connect()` sweeps residue at entry (sync cleanup +
   best-effort disconnect of the captured stale provider). Pinned.
4. (H) Stale-continuation cleanup dereferenced the MUTABLE session fields → an old continuation
   could disconnect the NEW flow's provider; no staleness check after `buildManifest`. FIXED:
   every continuation captures its own handles (`flowPending`/`flowProvider`/`flowWallet`) and
   cleans up via those; staleness checked after `buildManifest`. Pinned (call-count-delta on the
   captured provider; the newer flow's provider asserted untouched).
5. (M) `cancelVerification`/`disconnect` awaited SDK teardown before wiping → an overlapping new
   flow could be clobbered and its lock released. FIXED: `wipeToIdle()` wipes synchronously
   (epoch bump, cleanup, terminal transition, lock release) BEFORE any awaited teardown on
   captured handles.
6. (M) Remembered path starved the picker: a non-claimant announcing first sat hidden until the
   60s natural end. FIXED: the ambiguity window opens on the FIRST announcement of any kind;
   at fire, a sole claimant auto-connects, otherwise the picker shows. Pinned (absent-remembered
   test: picker at ~1s, not 60s).
7. (M) Post-selection buffered yields still appended rows during verification. FIXED: the
   discovery loop stops once status leaves discovering/choosing. Pinned.
8. (M) Test-integrity: stale-confirm test strengthened (call-count delta on the captured
   provider + newer provider untouched); disconnect-mid-setup and retry-noop cases added; the
   post-abort stream emulation is retained deliberately (it is the SDK's observable behavior —
   buffered yields ARE delivered post-cancel; the epoch guard is the defense either way);
   e2e 2b's natural-end path kept (the fake-timer window variants live in the unit suite).
9. (M) `BridgeWalletPanel` parity: switch affordance (chip + idle hint), choosing-disable, and
   capability-rejected → retry routing added.
10. (L) The persisted wallet NAME is now capped at write (and defensively at read), so the idle
    hint can't render a multi-megabyte claimed name.
11. (L) The modal got a minimal Tab focus trap (cycling within the dialog).

Post-fix gates: lint 0, typecheck:all 0, faucet units 492, faucet e2e 15, faucet build 0.

## Re-verification (fresh session — the original session was destroyed by a host /tmp wipe
## mid-arc; the fresh session read the committed findings + disposition instead)

**Verdict: `approve` — "All High and Medium findings are fixed in substance; no new blocking
interleaving was found."** Two Low residuals, both fixed in the same round:
1. (L) `reset()` dropped live pending/provider handles without SDK teardown — now runs the same
   best-effort cancel/disconnect as the production paths (Promise.resolve-wrapped: the SDK types
   these void).
2. (L) The focus trap allowed an immediate Shift+Tab escape while focus sat on the dialog
   container — container-focus now wraps to the last focusable.

Operational note: this re-verification ran via DIRECT `codex exec` with per-run home-scratch
files — a deliberate, documented deviation from the run-codex.sh helper, which crashes on this
host since the /tmp wipe (empty-heredoc prompts + lost session dirs). No fixed shared paths were
used.


---

# Tri-audit round (user-requested): 3× codex xhigh, disjoint lenses, PR #306

Run via direct `codex exec` (per-run home-scratch files; the run-codex.sh helper remains broken
on this host after the /tmp wipe). Legs: A regression, B concurrency + test integrity,
C improvements/UI/security/copy. Each read the five prior rounds' dispositions first.

## Verdicts
- **Leg A (regression): `approve` — no new findings**, with a verified-unchanged ledger: session
  return shape, error-category routing, every panel status, all faucet/bridge/fuel consumers
  gated on `connected` ("choosing" reaches no transaction branch), sibling smoke mocks still
  faithful.
- **Leg B (concurrency): `reject`** — 1 High + 1 Medium (below), everything else verified sound
  (retry-noop/disconnect-mid-setup/captured-handle/M6/M7 pins genuinely fail on regressions;
  switch-wallet races sound; concurrent panel connects serialize; jsdom e2e's ending-stream gap
  acceptable given unit coverage).
- **Leg C (quality): `conditional approve`** — 4 Medium + 2 Low (below), "well-built" on the
  selection/ownership/cleanup core and the icon allowlist (no executable bypass found).

## Fixed in this round (commit `fix(faucet): tri-audit round …`)
1. (H, leg B) **`confirmVerification` was re-entrant**: `pending` was cleared only after the
   await — two same-tick confirms (the verification dialog renders in multiple always-mounted
   panels) would both call `confirm()` and race competing wallet wrappers over one MessagePort.
   `pending` is now CLAIMED synchronously before the first await. Pinned (double-confirm → one
   `confirm()`).
2. (M, leg B) Entry-sweep pin strengthened: the swept session's captured `onDisconnect` callback
   firing after re-entry is asserted inert (replacement flow untouched), not just
   `disconnect()`-was-called.
3. (M, leg C) **Production CSP blocks the allowlisted icon schemes** (`public/_headers`:
   `img-src 'self' data:` — https and chrome-extension icons would render broken). Decision:
   keep the CSP tight; the modal now degrades via `@error` → glyph fallback (tracked per key).
   Under prod CSP only `data:image/*` icons render; everything else falls back gracefully.
4. (M, leg C) a11y: per-row accessible names (`Connect <name> (<type>)`), `aria-live="polite"`
   on the rows list, `role="alert"` on the collision warning.
5. (M, leg C) Security-sensitive copy corrected: collision warning now says "Multiple wallets…
   names and icons are self-reported… the emoji check verifies only the connection to the wallet
   you select"; the idle hint says "Next connect will try X" (no page-load-reconnect
   implication); README describes collision detection as best-effort within the scan window.
6. (M-value, leg C) `switchWallet` moved INTO the session (single implementation; both panels
   consume it). The larger reducer-extraction refactor is recorded as a follow-up, not done.
7. (L, leg C) Code-point-safe `truncateName` shared by the picker display cap and the persisted
   name cap (no split surrogate pairs). Pinned.
8. (L, leg C) `bridgeL2SwitchWallet` testid added — the bridge panel no longer reuses the
   faucet panel's switch testid (registry scoping convention).

Post-fix gates: lint 0, typecheck:all 0, faucet units 495, faucet e2e 15, build 0.

## Round 9 — post-UX-iteration audit (gpt-5.6-sol, xhigh; scoped to the last 4 commits)

Scope: `a1f6650..23ba54d` only (immediate picker-on-connect, split connect button +
preference-keeping switch, in-chip switch removal, button-morph setup states).

Verdict: race-sensitive paths sound — no reachable `selectWallet` during the hidden remembered
window, cancel invalidates timer/stream/natural-end continuations, picker cleanup complete,
switch/capability re-clicks guarded, no testid/aria regressions. Two findings, both fixed:

1. (MED) The new capability sublines under-claimed the grant ("nothing else") while both tabs
   share ONE combined manifest (faucet drips + bridge claims/exits + burns + balance reads).
   Fixed first as one honest shared subline; then REMOVED entirely on owner review (post-merge
   follow-up PR): the long line looked bad and widened the panel (row-wrap bug), and "no claim"
   is equally honest — the wallet's own approval prompt enumerating the real grant is the trust
   anchor. The audit's objection was to a FALSE claim, which removal also satisfies.
2. (LOW) After a remembered-id collision, `autoReconnectDisabled` (sticky, non-reactive) left the
   split button promising "Connect <name>" while `connectImpl` would force the picker. Fixed:
   the flag is now a reactive ref exported by the session; the split button renders only while
   auto-reconnect will actually be attempted; `reset()` clears it. Collision pin extended.

## Recorded follow-ups (not fixed)
- Reducer-style extraction of the discovery/remembered-window policy (leg C #4's larger half).
- Integration-level "scanning persists + cancel-mid-scan" e2e (jsdom smoke's ending-stream gap).
