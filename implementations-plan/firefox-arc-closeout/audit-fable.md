# Fable audit — firefox-arc-closeout

The same-family leg: an independent top-tier Claude planning agent (`Plan`, Fable 5.1), read-only, given the same
audit packet as codex and `recon.md` as context. Paths rewritten repo-relative. It read and grepped; nothing ran.

## Plan rev 1 (2026-09-21) — **conditional approve**

Conditions: C1 a fence that drives the real wrapper · C2 the split path's aggregator hole · C3 Phase 1 must
prove the heartbeat wakes the successor, with a Firefox branch decided in advance · C4 pin what "prover-ON"
means · C5 tighten the Phase 2 and Phase 6 gates · C6 say how the passkey fallback is expressed in the spec.
"Design A is the right structure. Nothing below argues for B."

### 1. Adversarial / security

- **No presence leak (confidence high).** The manifest sets `all_frames: true`
  (`apps/extension/manifest/manifest.config.ts:36`), so `tabs.sendMessage` reaches every frame's content script;
  a frame's handler posts `DISCONNECT` only if it holds a port for that id
  (`content_script_connection_handler.ts:236-244`); that port is created on `DISCOVERY_APPROVED` (`:164-170`),
  not by the key exchange as the plan's Security section said. A subframe present at approval already received
  `walletInfo` through the existing F-002 broadcast, so the reply discloses nothing new. **Low:** fix the wording
  and have the pin assert "no port unless an approved discovery".
- **No cross-session disconnect (high).** A page cannot choose a `sessionId`: the content script closes over it
  (`:172-206`) and `window.postMessage` accepts only discovery (`:113`). `sender.tab.id` is set by the browser.
  Subframes are rejected before the verdict. A flood is self-limiting because the first reply closes the port.
- **Low:** if `state.late.handler` is ever undefined the verdict must return "forward", never "disconnect".
- **High — CI weakening on the pre-decided split path.** The `status` job runs with `if: always()`
  (`pr-extension-network-e2e.yml:253`) and checks a hand-written `needs.X.result` list (`:279-284`);
  `behavior-gating.test.ts:356-366` pins only `needs`. A `canary-accounts` job added to `needs` but left out of
  that list can go red under a green required check. Nightly has the same shape (`nightly.yml:404-425`,
  `:519-538`), plus hard-coded job names at `behavior-gating.test.ts:388`. Smallest change: the split step names
  the result loops and nightly, and a pin asserts every suite job in `status.needs` appears as
  `needs.<job>.result` in the status step's script.

### 2. Assumption attack

Facts 1–7 verified. Inferences:

- **(i) True.** `activeSessions.set` (`:330`) and `pendingDiscoveries.delete` (`:331`) run synchronously before
  `sendToTab` (`:339`), no await between; the dApp creates `ExtensionWallet` only after the key-exchange response
  (`extension_provider.ts:66-79`).
- **(ii) True while a call is in flight.** The timer starts in `postMessage` and stops when `inFlight` is empty
  (`extension_wallet.ts:272-285`); a failed PING is caught and the timer keeps running (`:303-307`). **Low:**
  hidden tabs are timer-throttled, down to about one tick a minute after five minutes hidden — document "within
  seconds on a visible tab".
- **(iii) Wake on Firefox is already evidenced**: `cold-wake-discovery` passes there and wakes the background
  through a content-script `sendMessage`. The discarded promise resolves `undefined` because the relay listener
  exists at module scope; a rejection would surface only as an unhandled rejection in the content script's
  isolated world, which exists today. **Medium:** Phase 1 runs on the unfixed tree, so it cannot by itself prove
  or kill the inference, and the previous plan's measurement never recorded whether a successor woke. The red
  run should record `backgroundAlive` at about +10 s on both browsers, and the Firefox branch if the heartbeat
  does not wake should be pre-decided (no design helps there — nothing boots): the Firefox leg then opens the
  popup and asserts rejection within 15 s of the wake, criterion 2 is restated per browser, and the owner is
  told. On Chrome the successor starts on its own, so "woken only by the heartbeat" cannot be tested there.
- **(iv) The guard is right; every case is redundant, never wrong.** Profile switch, tab-lifecycle, Settings →
  Disconnect and the identity-guard fail path all call `terminateSession`: it sends the disconnect, the content
  script closes the port, and the discovery is restored as approved (`:402-412`) — result "forward".
  `terminateForTab` deletes both maps only after the disconnect went out or the tab is gone. A re-discovery
  under a new id leaves the old session known. `clearAll()` has no caller in Nulo. The clause cannot be reached
  by an honest flow, so e2e cannot fence its wiring — acceptable, because the failure mode is a redundant reply.
- **(v)** Nothing in the locked state touches `ping` or `secure-message` before the wrapper.

### 3. Implementation critique

- **A is right.** B adds a persisted record with four writers and gains about one heartbeat of latency; A already
  fails fast on an idle dApp's next call. **Rejecting C is right**; change the trigger to "measured more than
  10 s on either browser, or CI boot-to-attach over 5 s".
- **Medium — the 15 s hard assertion has almost no margin.** Worst case is first PING (≤ 5 s) plus
  5·⌈boot/5⌉ s; the relay's comment gives a 1–3 s boot; a CI boot over 5 s reaches 15 s, in a required lane at
  retry 0. Assert ≤ 30 s, log the measured value, judge the 15 s criterion from recorded numbers. The kill must
  also land inside the proof gate's 20 s safety release (`src/e2e/chrome-storage-proof-gate.ts:19`).
- `staleSessionVerdict` and the lazy lookup are consistent with how `state.late` is used: `buildContentTransport`
  runs before the handler exists, so the lookup must be a closure over `state`.
- **Medium — recon missed `ping-pong.test.ts`**: a real-handler pin whose second case pins "an unknown session
  is silently ignored" (`:64-68`) and which simulates the wrapper rather than running it. List it in the change
  map and house the SDK pins there, not in a parallel pins file. `lock-cancels-dapp-send.test.ts` is the closest
  template for the new spec, which needs the `@requires-proverless` marker.
- `credentialOutlivesPage` is acceptable — readonly driver facts have precedent (`kind`, `scheme`,
  `targetGone`). Add it to `browser-seam.test.ts`'s banned reads for `fixtures/**` and `helpers/**`.
- **Medium — the fallback is not well-defined.** The four stages are one `test` body on
  `freshExtensionPerTest`; "skips in-file" means an early return, a silent partial pass. The title would have to
  say stage 4 did not run, and `backgroundKillUnderPage` is the wrong reason if what fails is the ceremony.
- **Medium — pin (a) must define prover-ON as `with.proverless !== true`.** Today's assertion checks
  `dedicated`, which includes the proverless heavy jobs (`behavior-gating.test.ts:252`, `:262-265`); the
  partition check reads only the Chrome PR file (`:244`); nightly's lists differ (`nightly.yml:189`) and are
  unpinned. Assert each canary is in every lane's `exclude_files` as well.
- **The 22-minute rule is sane** — define it as the job's duration as GitHub reports it, the slower browser, the
  maximum over at least two runs; sum Phases 4 and 5's local wall times first, so the required Chrome job does
  not discover a timeout on the PR.

### 4. Regression fences

- **High — the named subframe/malformed fence cannot work.** `background.admission.test.ts` mocks the SDK
  handler with `initialize() {}` (`:22-47`) and mocks `attachContentListener` (`:48`); the wrapper is installed in
  no unit test. A regression that passes every gate: the verdict moved above the subframe check, so subframes get
  replies (there is no subframe e2e). Add a test that runs `initWalletSdkHandler` with the real SDK handler and a
  relay that captures the listener — subframe or malformed → no `tabs.sendMessage`; unknown top-frame `ping` /
  `secure-message` → exactly one reply to the sender's tab, not forwarded; seeded live session → PONG and no
  disconnect; approved discovery → nothing.
- **Medium — gates.** Phase 2's smoke specs have no command, and smoke does not build (`FIREFOX.md:5`), so a
  stale `dist/firefox` greens old code — add the build line. Phase 2 runs only one directory, but the
  log-payload, legal and storage-ban pins live elsewhere — run the full `bun run test`. Phase 5's
  `bun run test -- scripts/e2e` needs the `apps/extension` cwd. Phase 6 should add `bun run lint` and the seam
  tests; `tests/e2e/**` is outside typecheck (`apps/extension/tsconfig.json:22`).
- **Low:** add an idle-dApp case to the new spec (kill, then the next call rejects at once) — the only
  end-to-end cover for the `secure-message` branch.
- "Red first, never committed red" is sound.

### Looks fine

The relay untouched and the single-listener rule kept; no new state, permission or dependency; reusing
`sendToTab` and its receiver-gone handling; debug-level logging with `describeExternalId`; removing
`CHROME_ONLY_CANARY` strengthens parity; moving the passkey canary to prover-ON strengthens the gate; the
privileged script untouched; UI impact none.

**Disposition:** every condition adopted in plan rev 2 (Decision ledger D1–D14). One point goes against this
audit: the pending-discovery guard is **removed** (D1, codex's position) — this audit itself found a reply in
every case the guard covers "redundant, never wrong", and without it a dApp that missed the wallet's own
disconnect recovers. The "approved discovery → nothing" case in the proposed transport test is therefore not
adopted; the rest of that case table is.
