---
plan: tools-readiness
tier: light
driver: claude-code
eli5_mode: artifact
code_review: off
budget: recon 1 agent; codex at high; no /code-review (owner directive 2026-09-03)
base: dev @ 94e412a6
status: draft (v1) — awaiting codex audit
---

# tools-readiness — the account-widening feature and the readiness cells

The follow-up to `tools-self-testing`. Two things ship: a feature that exists on neither side
today — a dApp session that was granted some of a wallet's accounts can be widened to a new one
without forgetting the app — and the test cells `implementations-plan/tools-self-testing/readiness.md`
lists as the gap between the suites and production evidence. No wallet-sdk patches: both halves
use `requestCapabilities` and `getAccounts` as the SDK ships them.

## Scope (from the Phase 0 answers)

**In**
1. **Account widening.** Extension: a repeat `accounts` request from a dApp whose session does not
   cover every visible account on the session's chain opens the capability popup with the new
   accounts selectable and the already-granted ones pre-checked and locked; a decline keeps the old
   grant. Tools: an "Add accounts…" action in the account switcher that re-requests through the
   session's existing quiet path, and a `getAccounts` re-read when the page becomes visible again.
   One extension network e2e and one tools cell prove it end to end.
2. **Multi-account cells.** Tools: the six cells of readiness § 5. Extension: the two holes —
   an active-account switch under a live dApp session, and a second-account send end to end.
3. **Readiness § 1 test gaps.** Dropped and consumed recovery branches, Permit2 signature fields,
   a hostile token-list entry, wallet loss mid-flow (Ethereum leg; between authwit and exit), a
   two-tab provenance cell, two narrower viewports.

**Out** (explicitly): the two wizard warts (preflight-deferred stand-down, value-keyed route watcher)
and the deterministic FPC equality gate (readiness § 2–3); the testnet nightly canary; any change to
`@aztec/wallet-sdk` (the probe's origin-only filter stays worked around); promoting the advisory
aggregators. Nothing in `apps/extension/**` or the wallet packages is touched from the tools arcs, and
nothing in `apps/tools/**` or `packages/bridge-core/**` from the extension arc (CLAUDE.md § Two
products, one repo).

## Success criterion

Every cell below is a named test that passes at retry 0 in its suite's full local run (sharded) and
on the PR's CI; the widening feature is proven by an extension e2e (Nulo) and a tools cell (stock
wallet); the three PRs are green and merged in order by the owner.

## Delivery — three arcs, one stack

| Arc | Branch | Phases | Stacks on | code_review |
|---|---|---|---|---|
| 1 extension | `worktree-tools-readiness` (adopted as layer 1 via `gh stack init --adopt`) | 1, 2 | `dev` | off |
| 2 tools accounts | `tools-readiness/tools-accounts` | 3, 4 | arc 1 | off |
| 3 tools gaps | `tools-readiness/tools-gaps` | 5, 6, 7 | arc 2 | off |

Arc 2 depends on arc 1 only by stacking discipline (its widening cell runs against the stock test
wallet, which already widens); arc 3 on arc 2 for the `accounts.spec.ts` helpers. Each arc gets its
own codex loop at its boundary, then one cross-arc pass; PRs open only in Delivery (`gh stack submit
--auto`, `gh pr edit` bodies). `gh stack merge` is the owner's.

## Phases

Every gate includes the fast layers for the touched packages: `bun run lint`, `bun run --cwd <pkg>
typecheck`, `bun run --cwd <pkg> test` (bridge: `packages/wallet-bridge`; extension: `apps/extension`;
tools: `apps/tools`). Heavy layers are named per phase. The owner asked for full suites locally,
**sharded**: the tools suite runs as three parallel `--shard=i/3` launchers (each boots its own
sandbox; if the host mass-fails under three sandboxes — the memory says the extension network suite
does — fall back to sequential shards and log it); the extension network suite runs one file at a
time (`NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/<file>`), the smoke suite whole and
alone against an armed build (the `e2e-testing` skill's command).

### Arc 1 — extension

#### Phase 1: The wallet widens a session on a repeat `accounts` request
- `packages/wallet-bridge/src/dispatcher.ts` `handleRequestCapabilities`: after `computeCapabilityDelta`,
  when the manifest asks for `accounts`, the type is covered and absent from the delta, read the
  profile's accounts on the session's chain straight from `accountService.getAccounts` (NOT through
  `loadAvailableAccountsForPopup`, which provisions a default account when the profile has none —
  a widening check must never create an account) and, if any address is not in
  `dappSession.accounts`, add the request's `accounts` capability to the delta with `reRequested`
  carrying `"accounts"` and a new `CapabilityParams.grantedAccounts: string[]` = the session's
  current accounts. `isCapabilityCovered` stays pure (no profile reads); the membership rule is its
  own helper, `ungrantedAccounts(profileAccounts, sessionAccounts)`.
  The decision path is unchanged: `selectedAccounts` from the popup → `addAccounts` = selected minus
  existing; the `accounts` grant record is kept, not replaced; a rejection keeps the old grant
  (`applyCapabilityDecision`'s existing invariant).
- `packages/wallet-bridge/src/dapp-interaction-protocol.ts`: `grantedAccounts?: string[]` on
  `CapabilityParams`.
- `apps/extension/src/popup/windows/capabilities/index.vue` `init()` + `AccountSelectRow.vue`: rows
  whose address is in `grantedAccounts` render pre-checked and locked (`data-granted="true"`, not
  toggleable — this prompt widens, it never revokes); the copy says which accounts the app already
  has and which it is asking to add. A widening with nothing new to add never reaches the popup
  (the delta stays empty).
- Unit tests: `dispatcher.test.ts` — the `:543` same-shape pin becomes two: same shape with every
  visible account granted → no popup; same shape with an ungranted account → popup with
  `grantedAccounts`; approve adds only the new address; decline leaves the old grant; a hidden
  account does not count as ungranted. `capabilities/index.test.ts` — granted rows pre-checked and
  locked; approve returns granted ∪ picked.
- **Validation gate**: fast layers for `packages/wallet-bridge` and `apps/extension` (`bun run lint`,
  `bun run --cwd packages/wallet-bridge test`, `bun run --cwd apps/extension typecheck`, `bun run --cwd
  apps/extension test -- src/popup/windows/capabilities`), exit 0. Layers: lint · typecheck · unit.

#### Phase 2: Extension e2e — widening, the active-account switch, the second-account send
- `apps/extension/tests/e2e/network/cap-widening.test.ts`: grant one account to the playground
  (`grantCapBundle`), `createAccount(setupPage, "Second")`, re-request `accounts` from the playground:
  the popup lists two rows, the first pre-checked and locked (`cap-account-item[data-granted]`);
  approve → `getAccounts()` returns both; a second run declines → `getAccounts()` still returns one.
- `apps/extension/tests/e2e/network/account-switch-live-session.test.ts`: two accounts granted; the
  popup's active account switched to B; `getAccounts()` (no popup) returns the same two in the same
  order; `sendTx` with `from: A` is signed by A (the tx's sender read from the receipt).
- Second-account send: `apps/playground/src/sections/transactions.ts` gains a `from` selector
  (`pg-select-account`, the authwit section's existing pattern) so `sendTx default` can name account
  2; `apps/extension/tests/e2e/network/multi-account-from.test.ts` gains the case the #39 docstring
  calls out: a send from account 2 lands, account 2's balance moves, account 1's does not. Update the
  docstring.
- **Validation gate**: the three files each green alone at retry 0 (`NULO_E2E_PROVERLESS=1 bun run
  e2e:agent tests/e2e/network/<file>`); the smoke suite whole against an armed build (the phase-10
  lessons' command), exit 0; `bun run test:ci-gating` (the playground and extension paths trip the
  existing filters — nothing to change, the test proves it). Layers: lint · unit · e2e (live sandbox).
- **Arc boundary**: codex loop on the arc-1 diff (plan § Post-implementation), then `gh stack add
  tools-readiness/tools-accounts`.

### Arc 2 — tools accounts

#### Phase 3: "Add accounts…" and the visibility re-read
- `apps/tools/src/composables/useAccountWidening.ts` (new, the `useTokenGrant` shape without the
  token scope): `addAccounts()` — no-op while a flow owns the session or an operation is in flight
  (`MID_FLOW_STATUSES`, `opsInFlight`), otherwise `session.retryCapabilities()`; the outcome is the
  difference between the grant before and after: `added: n` or `nothing new`, exposed for the switcher's
  status line. Single-flight through the same queue discipline as `useTokenGrant`.
- `createAztecWalletSession.ts`: `refreshAccounts()` — when `connected` and no flow owns the session,
  `wallet.getAccounts()` parsed by `parseGrantedAccounts` into `s.accounts` (the selected account is
  kept when still granted, otherwise the first); called on `document.visibilitychange` → `visible`
  from `useWalletConnection.ts` (a listener the composable installs once and disposes). No prompt is
  ever raised by a re-read — the extension's `getAccounts` is session-scoped by design, so this only
  reflects widenings, aliases and hides made elsewhere.
- `AccountSwitcher.vue` `.foot`: "Add accounts…" (`TESTIDS.accountMenuAddAccounts`), disabled while
  busy; a one-line status under it after a run ("Added 1 account" / "No new accounts in your wallet")
  (`TESTIDS.accountMenuAddStatus`). Copy stays plain.
- Unit tests: `useAccountWidening.test.ts` (busy → no-op; grant grew → added n; unchanged → nothing
  new; declined → the old list stands); `createAztecWalletSession.test.ts` (refreshAccounts keeps the
  selection, drops it when no longer granted, is inert while a flow owns the session);
  `AccountSwitcher.test.ts` (the button, its disabled state, the status line).
- **Validation gate**: `bun run lint`, `bun run --cwd apps/tools typecheck`, `bun run --cwd apps/tools
  test`, exit 0. Layers: lint · typecheck · unit.

#### Phase 4: The accounts cells
- `apps/tools/tests/browser/specs/accounts.spec.ts`, `test.use({ family: "accounts", cells: 7, l1Index: 8 })`,
  two funded actors per cell where a switch is involved:
  1. **Widening**: connect as A (a one-account grant is not possible with the pool, so pick A among
     the pool), `window.__nuloTestWallet.addAccount(secret, salt)` in the wallet frame for a fresh seed,
     "Add accounts…" → the switcher lists the new address (`grantedAccounts`); a second click reports
     "No new accounts".
  2. **Wrong account, interrupted deposit**: deposit as A with the claim held (24a's `holdNext`),
     reload, connect as B: the record shows the mismatch card and `walletCalls(...).sendTx` stays 0;
     `switchAccount(A)`: the claim lands from the journal.
  3. **Switch refused mid-send**: start a deposit as A; during the Ethereum leg open the switcher and
     pick B: the row is disabled / the switch does not happen (the chip still shows A) and the send
     completes for A.
  4. **Feed per account**: A's records absent from B's feed after a switch, present again under A.
  5. **Gas gate re-read**: A holds credit, B nothing: a review opened as A then a switch to B stands
     down; B's amount step says `none`; back under A it sends.
  6. **Reload remembers a non-first account**: connect choosing B, reload, `driveToConnected` lands on
     B without a chooser.
  7. **One-account grant**: the `plain` profile with a seed list of one (a per-test init-script
     override of `__nuloTestWalletSeeds`) connects straight to `connected`, no chooser.
- Testids that may be missing (added in `apps/tools/src/lib/testids.ts` + the components before a
  cell names them): the mismatch card's note, the switcher row's disabled state.
- **Validation gate**: `bun run e2e:tools -- tests/browser/specs/accounts.spec.ts` green at retry 0
  on a fresh sandbox; then the full tools suite in three parallel shards, all green at retry 0.
  Layers: lint · unit · e2e (live sandbox, real browser).
- **Arc boundary**: codex loop on the arc-2 diff, then `gh stack add tools-readiness/tools-gaps`.

### Arc 3 — tools gaps

#### Phase 5: Recovery — dropped and consumed
- Test wallet: `dropNext("sendTx")` on the node hand-off proxy (`observeSubmissions`) — records the
  submission and returns its hash without forwarding the transaction (one shot).
- `recovery.spec.ts` cell 24c **dropped**: fueled deposit as A with `dropNext` armed for the claim; the
  journal polls the receipt, three straight `dropped` reads clear the hash and the card says "The claim
  was dropped - claim again from this card"; click claim: it lands; balances as 24a.
- Harness: `pages/relayer.ts` `claimAsRelayer(actor, record)` — builds `HubClaimParams` from the page's
  journal record (token block, recipient, amount, leaf index, the public claim secret) and claims
  through `claimViaHub` with `actor.s.relayerOpts`.
- `recovery.spec.ts` cell 24b **consumed**: public deposit as A with the claim held; after the Ethereum
  leg, the harness claims through the relayer; reload; the page's record ends `done` with no claim of
  its own (`walletCalls(...).sendTx` 0, `claimTxHash` undefined, the token balance credited once).
- **Validation gate**: `bun run e2e:tools -- tests/browser/specs/recovery.spec.ts` green at retry 0.
  Layers: lint · unit · e2e.

#### Phase 6: Permit2 fields, a hostile token list
- `fixtures/l1-wallet.ts`: record every `eth_signTypedData_v4` payload; `permits()` on the control
  returns the parsed Permit2 messages (`permitted.token`, `permitted.amount`, `spender`, `nonce`,
  `deadline`).
- `deposit-token.spec.ts` cell 1 and `deposit-token-gas.spec.ts` cell 13: after the send, exactly one
  permit; `spender` is the generation's router, `permitted.token` the ERC-20, `permitted.amount` the
  review's units (the whole amount for token-only, the token leg plus the slice for token+gas), `deadline`
  in the future at signing time.
- `fixtures/egress.ts`: the token-list fixture is selectable per test (`test.use({ tokenList })` worker
  option or a per-test route override); `tests/e2e/fixtures/token-list-hostile.json`: one entry with
  `decimals: 300`, one with a non-address, one duplicating a manifest token's symbol with a different
  address.
- `tokens.spec.ts` cell 34b: the hostile list — the malformed entries never become tiles while the
  manifest tokens and the valid community entries still do (`token-list.ts:141` validates entries one
  by one after the chain filter, so a bad entry is skipped, never the list).
- **Validation gate**: the three spec files green at retry 0. Layers: lint · unit · e2e.

#### Phase 7: Wallet loss mid-flow, two tabs, viewports
- `fixtures/l1-wallet.ts`: `holdNext("transaction" | "signature")` — the next call never answers.
- `l1-wallet.spec.ts` cell 26d: the Ethereum leg held; the stepper shows the send waiting on the
  wallet; reload; the journal holds no record of a deposit that never left (nothing to resume); the
  review is reachable again; `signatures` counts the one attempt.
- `exits.spec.ts` cell 31b: `holdNext("sendTx")` on the exit after the authwit; reload; the exit record
  is offered again / resumes and lands; the credit is charged once.
- `activity.spec.ts` cell 40 two tabs: `context.newPage()`; a send in tab A while tab B sits on
  Activity; B's feed shows the record, B never adopts it into a stepper (`tl-stepper` count 0 in B);
  A's stepper completes.
- `spike.spec.ts`: the connect + a public deposit at 390 px and at 1024 px (`page.setViewportSize`);
  the ActivityDock overlays below 1100 px and must not cover the wizard's action row (the confirm is
  clickable without scrolling tricks).
- **Validation gate**: the four spec files green at retry 0; then the full tools suite in three parallel
  shards at retry 0; `bun run test:all` and `bun run lint && bun run lint:actions` exit 0. Layers:
  lint · unit · e2e.

## Architecture & Implementation

**Extension (arc 1).** The widening decision lives where coverage is already decided,
`handleRequestCapabilities` (`dispatcher.ts:1039-1113`): a covered `accounts` type is re-examined
against the profile's visible accounts for the session's chain; the existing
`loadAvailableAccountsForPopup` supplies them. Keeping `isCapabilityCovered` pure means the coverage
unit tests keep their shape and the membership rule gets its own small helper
(`ungrantedAccounts(available, session.accounts)`), unit-tested alone. The popup receives one new
field (`grantedAccounts`) and renders locked, pre-checked rows through the existing
`AccountSelectRow`; approval returns the union, and `applyCapabilityDecision` (`dapp-session/service.ts:282`)
already unions `addAccounts` and preserves the older grant on a decline. Alternative not taken: an
"add this account to app X" screen in the extension's connected-dApps management UI — it needs the
same storage path but gives the dApp no signal (the SDK has no accounts-changed event), so the app
would only learn on a re-read; the re-request path lets the dApp ask when the user wants it.

**Tools (arc 2).** `useAccountWidening` mirrors `useTokenGrant` (single-flight queue, status gate,
`retryCapabilities`) because that composable is the proven way to widen a live session's grant
without flipping the panel to "awaiting permissions". `refreshAccounts()` is a session method so the
selected-account rule (keep if still granted, else first) lives beside `chooseGrantedAccount`, which
already owns the account list. The listener lives in `useWalletConnection` (the singleton that owns
the session's lifecycle), not in a component. Alternative not taken: polling `getAccounts` on an
interval — it costs a wallet round trip per tick for a rare event; visibility is the moment a user
returns from the wallet.

**Cells (arcs 2–3).** Every new cell reuses the fixtures the suite already has (`grantedAccounts`,
`switchAccount`, `driveToConnected`, `walletFrame`, `holdNext`, `keptFor`, the journal readers). Three
small fixture additions: `dropNext` on the node hand-off proxy, typed-data recording and a hold in
the L1 wallet, a selectable token-list fixture. One harness helper: the relayer claim from a journal
record. No product code changes in arc 3.

**File map.** Arc 1: `packages/wallet-bridge/src/{dispatcher.ts,dispatcher.test.ts,dapp-interaction-protocol.ts}`,
`apps/extension/src/popup/windows/capabilities/{index.vue,index.test.ts,AccountSelectRow.vue,AccountSelectRow.test.ts}`,
`apps/playground/src/sections/transactions.ts`, `apps/extension/tests/e2e/network/{cap-widening,account-switch-live-session,multi-account-from}.test.ts`,
`apps/extension/tests/e2e/README.md`, `packages/wallet-bridge/README.md`. Arc 2:
`apps/tools/src/composables/{useAccountWidening.ts,useAccountWidening.test.ts,createAztecWalletSession.ts,createAztecWalletSession.test.ts,useWalletConnection.ts}`,
`apps/tools/src/components/{AccountSwitcher.vue,AccountSwitcher.test.ts}`, `apps/tools/src/lib/testids.ts`,
`apps/tools/tests/browser/specs/accounts.spec.ts`, `apps/tools/tests/browser/README.md`,
`apps/tools/README.md`. Arc 3: `apps/tools/tests/browser/{test-wallet/{main.ts,wallet.ts,globals.d.ts},fixtures/{l1-wallet.ts,egress.ts},pages/relayer.ts,specs/{recovery,deposit-token,deposit-token-gas,tokens,l1-wallet,exits,activity,spike}.spec.ts}`,
`apps/tools/tests/e2e/fixtures/token-list-hostile.json`, the plan's `readiness.md` (rows closed).

**Critical flow (widening).** dApp `requestCapabilities({accounts})` → dispatcher: covered, delta
empty → profile accounts on chain − session.accounts ≠ ∅ → delta += accounts, `grantedAccounts` set →
popup: granted rows locked, new rows unchecked → approve → `selectedAccounts` → decision
`addAccounts` = new only → `applyCapabilityDecision` unions → response `granted.accounts` re-derived
from the stored grant (`enrichGrantedCapabilities`) → tools `chooseGrantedAccount` replaces
`s.accounts` → the switcher lists the new account.

## Security & Adversarial Considerations

- **Consent boundary.** A session never widens without the popup; the re-read path (`getAccounts`) is
  session-scoped by construction (`projectSessionAccounts`), so a dApp cannot enumerate ungranted
  accounts by polling. `grantedAccounts` and `availableAccounts` are wallet-derived, never taken from
  the manifest; a dApp cannot inject a phantom address into either list.
- **No revocation through the widening prompt.** Locked rows cannot be unchecked; the decision only
  adds. Revocation stays in the extension's own management UI.
- **A declined widening keeps the older grant** — the existing `applyCapabilityDecision` invariant,
  pinned again by a unit test.
- **Prompt fatigue as an attack.** A dApp could re-request in a loop to nag; the popup only opens when
  something is genuinely ungranted, and the extension's existing rejection tracking applies. Tools only
  re-requests on an explicit click.
- **Test-only surfaces.** `dropNext`, `holdNext`, `permits()` live on the test wallet and the L1
  fixture (`window.__nuloTestWallet`, `__nuloL1Request`) — pages the suite serves only on loopback and
  the shipped builds never list. The hostile token list is a fixture served inside the egress fence.
- **Supply chain / CI.** No new dependencies; workflow permissions unchanged (`contents: read`).
- **Domain.** The relayer claim in the consumed cell exercises the hub's "consumed by another
  submitter" path the integration suite already covers; the Permit2 cells make the signature's
  `spender` an asserted invariant, the classic drain shape.

## Assumptions

**Facts (verified)**
1. `isCapabilityCovered("accounts")` compares only the two boolean flags — `dispatcher.ts:264-266`,
   `:443-448`; a same-shape re-request returns the stored grant with no popup (`:1058-1071`, pinned by
   `dispatcher.test.ts:543`).
2. `applyCapabilityDecision` unions `addAccounts` and keeps a REJECTED type's older grant —
   `apps/extension/src/wallet/services/dapp-session/service.ts:306-315`.
3. `CapabilityParams` carries `availableAccounts` (wallet-derived) and the popup pre-selects only when
   exactly one is available — `dapp-interaction-protocol.ts:143-156`,
   `popup/windows/capabilities/index.vue:136-179`.
4. `handleGetAccounts` intersects the profile's accounts with `session.accounts` — `dispatcher.ts:736-793`.
5. Tools re-requests on a live session through `retryCapabilities` and replaces `s.accounts` from the
   answer — `createAztecWalletSession.ts:734-751`, `:818-855`; no `getAccounts` call and no
   visibility listener exist in `apps/tools/src` (recon trail).
6. The test wallet answers every `requestCapabilities` with all imported accounts, read fresh —
   `tests/browser/test-wallet/wallet.ts:72-82`; `addAccount` imports a seed into the live PXE —
   `main.ts:124`; the node hand-off proxy exists — `wallet.ts` `observeSubmissions`.
7. The journal clears a claim hash after three straight `dropped` receipt reads and asks for a
   re-claim — `useBridgeJournal.ts:1238-1275`; a nullified message completes the record —
   `:1296-1330`, `isMsgConsumed` `:63-64`.
8. Permit2 typed data names `spender: g.router`, `nonce`, `deadline` — `send-flow.ts:249-256`;
   `l1-wallet.ts:118-121` serves `eth_signTypedData_v4` and records only a count.
9. The playground has `pg-select-account` in the authwit section and none in transactions —
   `sections/authwit.ts:37`, `sections/transactions.ts:27-30`; `multi-account-from.test.ts` documents
   the gap.
10. Used `l1Index` values are 1–7; `actorKeys` defaults to 12 — `deploy.ts:115`.
11. `loadAvailableAccountsForPopup` provisions a default account when the profile has none on the
    chain — `dispatcher.ts:1118-1130`; the token list validates entries one by one after the chain
    filter — `packages/bridge-core/src/token-list.ts:33,141`.

**Inferences (unverified — the audit should attack)**
- The hidden-account rule: an account the user hid in the wallet should not count as ungranted (no
  nag to add a hidden account). The popup's copy ("unhide one of its accounts, then try again")
  implies `accountService.getAccounts(profileId, chainId)` omits hidden accounts; inferred from that
  copy, to be confirmed in Phase 1 before the membership helper is written.
- Three parallel tools shards fit this host (three sandboxes, three Chromiums); the fallback is
  sequential shards.
- The `capabilities/index.test.ts` harness can mount the popup with a synthetic `CapabilityParams`
  (its existing tests do for chain-mismatch cases).

**Asks** — none open. Settled at Phase 0: scope (items 1–3), heavy suites locally and sharded,
three-arc stack, `code_review: off`. `/harden`: not scheduled — the change adds no trust boundary
beyond a consent prompt the extension already owns.

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`: `/code-review` is not
run at any point.

1. **Per arc, at its boundary** (all its phases ✓, before `gh stack add`): send `/codex high` the
   arc's diff, this plan.md + `recon.md`, the arc map ("this is arc N of 3; later arcs build X on
   it"), the adversarial/security ask ("What could go wrong? What would an attacker target? What are
   we trusting that we shouldn't? Where are the supply-chain / least-privilege weaknesses?"), and both
   rules below verbatim.
2. **Iterative fix loop**: verify codex's factual claims against the repo; apply the accepted fixes;
   commit; log the round (consult + verdict) in `lessons/phase-N.md`; RESUME the same codex session
   with the fix diff. Repeat until a round yields no new material findings (rejected nitpicks don't
   count). Still material after 3 rounds → stop and surface: a scope smell.
3. **Final cross-arc pass**: after all three arcs are green and looped, a FRESH codex session over the
   net diff from `94e412a6` asking for cross-arc issues (seams, duplication across arcs, drift from
   this plan), same loop until clean.
4. **Delivery**: the FIRST time any PR is opened. `gh stack sync` if `dev` moved, `gh stack submit
   --auto`, `gh pr edit` each body (what/why, gates run), `gh pr checks --watch`; a red new check is
   fixed on its arc branch and re-pushed (bounded, logged). Update `implementations-plan/index.md`.
   Never merge; `gh stack merge` is the owner's.

**The no-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted
improvements only. Do not propose speculative abstractions, extra configuration surface, new layers,
or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it
alone."*

**The comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per
character. Flag any comment that narrates what the code visibly does, restates its line, references
implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag
places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are
permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and
exact."*

**Autonomy**: decisions the plan leaves open are settled by a logged `/codex high` consult, never by
waiting on the owner. Hard limits: no merge, no publish, no history rewrite on branches others touch,
no scope beyond this plan, no secrets. Pushing the arc branches after `<test>` + `<lint>` pass is
authorized.

## Seeds

Recommended: `/goal` (completion is transcript-observable). The `/loop` alternative is in the ELI5.

```
/goal All 7 phases marked ✓ in implementations-plan/tools-readiness/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its phase's validation gate as written in plan.md reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/tools-readiness/lessons/phase-N.md`; `/code-review` was NOT run (plan.md says code_review: off); the codex fix loop converged for each of the three arcs at its boundary AND for the final cross-arc pass, each convergence evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; the three-PR stack exists on GitHub, created only after all loops converged (`gh stack view` output in the transcript); `bun run test:all` and `bun run lint && bun run lint:actions` both report exit 0 in the transcript; and no turn ended waiting on owner input — every decision point was settled by a logged codex consult (plan.md § Autonomy).
```
