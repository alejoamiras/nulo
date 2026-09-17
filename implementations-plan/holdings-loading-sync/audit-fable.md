# Fable audit — holdings-loading-sync (round 1, plan draft)

Leg: same-family top-tier reviewer (Plan subagent, Fable 5.1), read-only over the worktree. Full audit
packet: adversarial/security, assumption attack, implementation critique, recon check.

**Verdict: conditional approve** — conditions: (1) derive scan health from every tick outcome, not only
the forward-scan `catch`; (2) capture the scan floor when the account is created, and narrow I4; (3) break
the `getSeedStatus` kick + refetch-on-event loop; (4) start the "stalled" clock from the current failure
streak, not a persisted `lastSuccessAt`; (5) `phraseOrigin` has six row-construction sites and needs no
backup-schema change; (6) put the "name known" placeholder claim and the silent multi-day imported backfill
back in front of the owner.

## 1. Adversarial / security

- **High — the stalled line cannot fire when the node is down.** `resolveScanInputs` swallows tips/network
  failures and returns before the `try` (`incoming-transfer/service.ts:1374-1375,1465-1478`); non-standard
  class and missing checkpoint hash also return early (`:1386-1396`); a validator-dropped page returns
  without throwing (`public-events.ts:250,279`), so "any pass that did not throw" would refresh success
  forever while making no progress. Change: `scanPublicContract` returns an outcome
  (`progress | idle-at-tip | no-progress | failed`), counted at the poll level; success =
  `!dropped && (reachedTip || coverage advanced)`.
- **High — the scan floor is captured too late.** Scans exist only once a token row exists
  (`buildSchedulerDescriptors:790-791`), i.e. after seeding. A4 flow: seed fails → user shares address and
  receives → RETRY days later → floor = tip at retry → receipt lost. Change: fetch tips and persist the floor
  in `onAccountAdded` for the first account of the (profile, chain); tips failure → 0.
- **High — I4 is false in code.** `deriveAccountSeed(master, l1ChainId, type, index)`
  (`account/service.ts:268`) yields the same address on every Aztec network sharing an L1; network
  delete + re-add re-creates index 0 with the same address (`:264`) after `clearChain` wiped records; an
  exported phrase may have been used elsewhere first. Loss is display-only. Change: only an account created
  in a generated profile's create flow whose address is on no other row of the profile starts at the floor;
  chain re-add and later networks fall to 0; never re-capture after `clearChain`; self-heal
  `tips.checkpointed < floor → floor = 0` (hostile tip, sandbox restart on the same chainId).
- **Medium — reorg escalation bound is weaker than stated.** 30 s tick quantisation puts the third failure
  near 150 s + RPC timeouts; counters are in memory so a SW restart resets them; Retry must reset only
  `nextAttemptAt`, never `consecutiveFailures`; add a durable fallback (escalate when the anchor is older
  than N minutes). `pendingPageReorged` (`:1655-1663`) is a second any-throw-is-reorg path the plan omits.
  Checks out: a hostile node gains no new capability; the ancestry marker is client-generated.
- **Medium — the kick loop.** `getSeedStatus` kicks → pass end emits → consumer refetches → kick. With the
  node down the 3 attempts burn within seconds of opening the popup; with zero accounts
  (`seeder.ts:280`) no attempt is consumed so the loop is unbounded. Change: split the read from an explicit
  `ensureSeeding()` run once per SW lifetime per (profile, chain); emit only on a real status change;
  `retrySeed` refuses keys not in `getSeeds()` (`updateMarker` creates any key).
- **Low.** Placeholder literal trust claim checks out; specify `TokenSeedRow` as inert (no `RouterLink`).
  RETRY on a `PinMismatchError` invites retrying a security rejection — distinct copy or no button (owner
  sign-off). Transient scan failures log at `debug`; `warn` only on escalation or a stalled transition.

## 2. Assumption attack

- **Facts.** 1, 2, 3, 4, 7, 8, 9, 10, 13, 15 check out; the sync-state API's only consumer is `TokensView` +
  tests. Fact 10 line range is `:812-829`. Fact 11: `:232` is a programmer-error throw; the reader also
  propagates schema-parse and node throws (`:225,256,263,266,327`). Misstated: `phraseOrigin` "two creation
  paths" — six row-construction sites (`profile/service.ts:566,717,2115,2174,2373,2541`), incl. passkey
  create/import. Misstated: "backup slice schema" — profile rows are block-listed and re-derived on restore
  (`backup/README.md:21`); restore stamps `imported` at its two commit sites. Misstated: UI row 1 "symbol +
  name known" — `DefaultTokenSeed` has no name.
- **Inferences.** I1 safe (`batchedViewSimulation` classifies utility/public/private, has a slow arm, no
  import cycle). I2/I3 acceptable only with the durable fallback. I4 unsafe. I5 plausible.
- **Asks to surface.** (a) placeholder subtitle: name vs symbol only vs a compiled-in display name;
  (b) imported profile on a busy token backfills at ~100 logs / 30 s — possibly days, new receipts invisible
  meanwhile, and nothing tells the user; (c) hero can stay hidden indefinitely; (d) pin-mismatch copy.

## 3. Implementation critique

- **High — `lastSuccessAt` gives a false stalled line after unlock.** No scanning while locked, so
  `now − lastSuccessAt` is hours at unlock; two cold-boot failures flip `stalled` within a minute. Build:
  in-memory `firstFailureAt` per streak, `stalled = failures ≥ 2 && now − firstFailureAt > 10 min`; drops
  the persisted field and its five `persistCursorLocked` sites; re-derive on skipped ticks (the flip comes
  from time passing).
- **Medium — the classifier buys little once the dot is gone.** Spurious reconciliation is idempotent and
  bounded by the finality gap; its only user-visible harm was the dot. Simpler: keep any-throw-with-anchor →
  reconcile, add only backoff + outcome counting; drops I2, I3 and the `aztec-runtime` marker.
- **Medium — hero skeleton can stick.** Fenced-off job leaves `updatedAt === 0` until
  `reconcile-pairs:145`; a hostile user-added token whose simulation hangs blanks the total; a `pending`
  seed with no account holds forever. Cap the hold (~10–15 s) then fall back to the partial aggregate. Seed
  state must be owned once and passed to both siblings (two composables = two clients, two kicks).
- **Medium — complexity.** `scanPublicContract` (`:1372-1458`) is at the 80-line cap: delete the four
  `emitSyncStateIfChanged` calls before adding branches, or extract `handleScanFailure`. `onAccountAdded` is
  already nested five deep: extract `resetPublicCursors` first.
- **Low.** Dedupe placeholders against seed-origin `TokenImportRow`s by contract. All gate scripts and files
  exist; no phase is un-shippable. Recon rows 2, 3, 5, 6, 8 are followed. Competing outline: nothing worth
  adopting.
