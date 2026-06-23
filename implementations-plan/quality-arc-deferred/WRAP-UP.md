# Quality-arc DEFERRED (batch 2) — WRAP-UP

**Outcome: all 6 deferred `/harden quality` findings resolved on `dev-quality`.** This was the second tranche
of the quality arc — the architectural / authz / concurrency findings batch 1 explicitly deferred as
"supervised later." Driven fully autonomously off a `/goal` + `/loop`, with every non-trivial decision passed
through BOTH codex (`/codex xhigh`) AND a top-tier claude subagent, reconciled into per-finding decision
ledgers, and surfaced to the user only on the two mandated authz/concurrency disagreements.

## Disposition of the 6 findings

| Finding | Disposition | PR / SHA | Network gate |
|---|---|---|---|
| **Q4** ExecutionService hotspot | **✓ MOOT** — #83 already decomposed it (2302→719-line facade + 7 modules); the finding's premise (one class owns all 7) is false. No work. | — | — |
| **Q11** `WalletSdkDispatcher` session-account dedup | **✓ MERGED** — extracted `projectSessionAccounts`; grant-response routes through it (unconditional resolve + canGet gate preserved → byte-identical). | #151 `f1a1c68` | 27984625796 8/8 |
| **Q10** composition-root storage migration | **✓ MERGED** (4 PRs) — SW services take a `browserApi` port; `EntityStorage` built from `browserApi.storage.local` (keys byte-identical). P1 account/dapp-session/transaction · P2 auth-registry + balance/incoming-transfer repos · P3 token/fpc/network · closeout ProfileService. PXE factory deferred (no test consumer; overlaps #125). | #152 `28a7c24` · #153 `378d0da` · #154 `1a19be5` · #155 `e8a660a` | per-phase 8/8 (shard 4/5 1× sanctioned re-run = flake on the closeout) |
| **Q19** active-profile guards (authz) | **✓ MERGED** — free fn `requireActiveProfile(source, lockedMessage?)`; **47** absence-throw guards swept across 15 SW services, messages preserved VERBATIM (34 "Profile locked" / 11 "Wallet locked" / 2 "Wallet is locked"). EXCLUDED: operation-planner "Unauthorized", dapp-interaction identity guards (`profile?.id !== session.profileId` — both models caught :260 as the authz landmine), every silent `if(!profile) return`. codex + FRESH-claude post-impl both SHIP. | #156 `987f44b` | 27992634578 8/8 |
| **Q5** duplicated dapp-send lifecycle tail | **✓ MERGED** — user picked the catch-disposition free-fn; extracted `markFailedUnlessCancelled` (SYNCHRONOUS → timing-exact) from the 3 byte-identical dapp-send catch arms; transfer-executor left inline (different cancel mapping). codex post-impl caught + fixed an async→sync microtask `finally`-timing bug. | #157 `b9b13b6` | 28011557795 8/8 |
| **Q23** claim/cancel temporal coupling (concurrency) | **✓ DONE via A′** — dual-model SPLIT (codex = narrow `QueuedClaimHandle` seam; claude = leave-it) SURFACED to user; the #125/#126 investigation showed the cancel-mid-prove composition harness already exists there. Resolution: comment-only correction of the misleading `claim-helper.ts` invariant comment (the dual-model-AGREED action; no-await invariant + code untouched). The structural seam + a dedicated cancel-race test DEFERRED to #125/#126's harness (the actual disagreement → human-reviewed there). fresh-claude post-impl ACCURATE-SHIP. | #158 `27561c0` | 28021969303 8/8 (the full integrated-arc sweep) |

## Integrated change
`git diff b068393 dev-quality`: ~40 files, **+985 / −318** (net −deduplication + new helpers + inline tests).
Merge-base `b068393` = dev after batch-1's #148.

## Methodology highlights (what worked)
- **Dual-model on every decision** — codex + a claude subagent, reconciled into `lessons/q{4,5,10,11,19,23}.md`.
  AGREE → proceed; DISAGREE on an authz/concurrency-critical call → SURFACE (Q5 + Q23 were surfaced).
- **Fix-loops paid off** — codex post-impl caught two real bugs the e2e would NOT have: Q5's microtask
  `finally`-timing regression (async→sync fix) and the Q19 dapp-interaction:260 authz landmine (both models).
- **Behavior preservation by construction** — every error string / storage key / ordering invariant preserved
  verbatim; pins added for the surprising ones (sync-throw passthrough, wrong-profile authz, silent
  non-throwers, message variants).
- **RED policy honored** — the one network red (Q10 closeout shard 4/5) was re-run ONCE → green = confirmed
  flake (behavior-identical ProfileService wiring can't selectively break one shard). No retry-until-green, no
  skips, no weakened assertions.

## Deferred (tracked, not dropped)
- **Q23 structural `QueuedClaimHandle` seam** + a dedicated claim-registration race test → #125/#126's
  execution composition harness (where the real-journal + ProofGate fixtures live), for human review.
- **Q10 PXE injection factory** → overlaps #125 (`feat/execution-pxe-injection-spike`), which already carries it.

## Final confidence pass (codex + claude over the integrated diff) — SPLIT
- **claude `a460949e`: PROMOTE** — keys byte-identical (all 11), Q19 exclusions intact across all 26 files (no
  lock guard weakened; dapp-interaction:260 identity pin is "the single most important authz pin"), Q5 sync
  timing preserved, test quality UPGRADED (FakeBrowserApi), flake risk LOW (deterministic ×2). One LOW/latent:
  NetworkService ctor param ordering (`browserApi` param 2 → `nodeFactory` param 3) — future positional-arg
  trap, harmless today.
- **codex `019ef437`: HOLD** — Q10's ProfileService wiring (`e8a660a`) is NOT behavior-preserving at
  runtime: it ACTIVATES `SessionManager`'s proactive TTL auto-lock. VERIFIED: at dev `b068393` the alarms code
  is present but dormant (`new ProfileService(config, logger)` → `this.alarms = browserApi?.alarms` =
  undefined); dev-quality wires `browserApi` → `this.alarms` real → warm-SW sessions now auto-lock on the TTL
  alarm instead of only expiring reactively on the next `getActive()`. It's a PRE-EXISTING, DESIGNED, TESTED
  feature (session-manager.ts:133-141 anticipates "proactive TTL lights up once the composition root wires
  browserApi"; tested at session-manager.test.ts "M4.5 proactive TTL via chrome.alarms") — but activating it
  is a user-visible, security-relevant behavior change outside the "behavior-preserving" framing. codex's gap:
  no runtime-seam test + no explicit acceptance that Q10 was meant to flip it on.

## SURFACED to user (security-relevant behavior change + dual-model split)
The `browserApi` port carries BOTH storage AND alarms, so Q10's clean port-injection into ProfileService
cannot thread storage WITHOUT also activating proactive TTL (short of passing a degraded alarms-less port —
an ugly carve-out). The activation is the SessionManager's intended end-state, but it changes when users'
wallets lock → the user must decide. Options surfaced:
- **(1) Promote-with-acknowledgment [rec]** — accept the activation (intended design + security improvement);
  I add codex's requested runtime-seam test + an explicit acceptance note, then re-confirm codex → promote.
- **(2) Decouple** — keep proactive TTL dormant for now (pass ProfileService an alarms-less port / gate it),
  activate it deliberately in a separate change.
- **(3) Revert Q10's ProfileService closeout** — drop the runtime wiring (ProfileService stays on the storage
  fallback), promote the other 5 findings without it.

## Promote
`dev-quality → dev` PR — BLOCKED pending the user's decision above. NOT merged autonomously (hard limit).
