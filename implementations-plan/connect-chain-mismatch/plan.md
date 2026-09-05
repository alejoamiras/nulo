# connect-chain-mismatch — blueprint light

```
tier: light
code_review: off            # owner directive 2026-09-03 + 2026-09-05: no /code-review; the codex fix loop is the review
eli5_mode: artifact
budget: recon 1 agent (sonnet); codex plan audit until explicit approve; codex post-impl loop ≤3 rounds
approval: owner pre-approved the direction in chat (2026-09-05: "move forward into implementing"); open
          questions go to codex, not the owner; PR is babysat to green and squash-merged by the agent
recon: recon.md
```

## Summary

When a dApp asks for the `accounts` capability on chain X while the wallet's active network is chain Y
and the profile has no rows on X, the connect popup blocks with "No accounts on this chain". The rows
are missing only because the wallet derives a chain's default account lazily — at profile bootstrap and
on each network switch — never for a chain the user has not visited. The dispatcher already resolves the
dApp's OWN chain and nothing downstream needs the active network to match (sessions and execution are
chain-scoped), so the fix is: derive the default account on demand where the popup's account list is
built, tell the user which chain the app is on, and offer — never require — switching the wallet to it.

Owner-locked UX (2026-09-05, artifact `Connect on Another Chain`): a neutral banner (no orange), title
**"Connecting on {dApp chain}"**, body **"Your wallet is on {active}. Approve as is, or switch to see
{dApp chain} balances."**, one action **"Switch wallet to {dApp chain}"**; after switching the banner
settles to the done tone **"Wallet switched to {dApp chain}"** / **"Balances and activity now follow
{dApp chain}."**; Approve is never blocked by the mismatch itself (the footer is only held for the
seconds an in-window switch is running); the window closes on either decision exactly as today (no
toast). The identity line reads "is requesting permissions on {dApp chain}".

## Assumptions

### Facts (verified)
- F1 Accounts are per chain: `l1ChainId` is a key-derivation input (`account/service.ts:236-238`), so an
  Alpha row and a Testnet row are different addresses; a profile only ever on Alpha has zero Testnet rows.
- F2 The default account is derived only for the ACTIVE network — `useProfileBootstrap.ts:105` at
  bootstrap and `popup/network-switch.ts:70-71` on switch (both `ensureDefaultAccount(profileId, chainId,
  AccountType.Nulo_v1, "Account")`).
- F3 `loadAvailableAccountsForPopup` (`dispatcher.ts:1123-1131`) resolves the dApp's chain via
  `resolveNetwork(ctx)` (`:1416`, throws `No network configured for chainId` when no row) and reads
  `getAccounts(profileId, network.chainId)`; an empty list makes the popup set `noAccountsAvailable`
  (`capabilities/index.vue:132-155`) and refuse approval.
- F4 The dispatcher only runs under an unlocked profile (`wallet-sdk/background.ts:880`
  `requireActiveProfile(..., "Wallet is locked")`) — an ENTRY gate: it makes `createAccountInternal`'s
  `getProfileSecret` (`account/service.ts:225-229`) succeed at dispatch time, nothing more. A lock
  landing after the secret read still lets the (benign, secret-free) row write complete, exactly as an
  in-flight network switch would; a deletion is fenced by the epoch assert (`:254`). Kinds
  `mainnet`/`testnet`/`local` derive with no I/O (`SEED_L1_BY_KIND`, `network/service.ts:57-61`);
  `custom` and legacy `devnet` probe their endpoint (`:366-380`).
- F5 The popup already receives the dApp chain as `payload.session.chainId` (string) and holds every
  network row of the profile in `appStore.networks` (filled in every popup realm, including the
  `windows-*` routes, by `useProfileBootstrap.ts:63`); the active row is `appStore.network`.
- F6 `activateNetworkGuarded` (`utils/guarded-network-activation.ts`) is the ONE sanctioned way to switch
  the active network from a view: admits through `commitScopeChange` before persisting; sole caller
  `settings/networks/[id].vue:48-89` with the in-flight-send guard and a 3-toast result ladder.
- F7 dApp windows are routes under `popup/app.vue`, whose `watch(appStore.network)` →
  `createNetworkSwitchHandler` (`app.vue:107`) reloads accounts and the active account after a switch —
  in the window's realm too.
- F8 The e2e fixtures switch to Local Network BEFORE connecting precisely because of this bug
  (`tests/e2e/fixtures/extension.ts:514-518`); e2e builds seed Testnet as the active network
  (`network/service.ts:96-98`); the playground's default `Fr.ZERO/Fr.ZERO` chainInfo resolves to chain 0
  (Local Network). So "wallet on Testnet, dApp on Local Network, no switch" reproduces the bug 1:1. The wallet's
  Testnet bootstrap still polls the public Testnet RPC (as every e2e does before its
  `switchToLocalNetwork`); the derivation and the switch target stay inside the sandbox.
- F9 Biome budgets: cognitive ≤ 15, ≤ 80 non-blank lines per production function; the baseline may only
  shrink (`CLAUDE.md` § Complexity budgets). `handleRequestCapabilities` is 78 raw lines already.
- F10 `Banner`'s action `<button>` has no `data-testid`; e2e selects by testid only (`CLAUDE.md` § testid).

### Inferences (codex round 1 revised I1/I2/I4)
- I1 Deriving on a dApp's request is a NEW trigger for a persistent write (an account row +
  `onAccountAdded`), taken before the user approves anything. It is bounded to what the user's own
  switch would write for that chain, and further narrowed by the unattended rule below: no endpoint
  probe ever runs on a dApp's request, and a chain that already has rows (hidden or imported included)
  is never touched. The row persists if the user then rejects — it is the chain's deterministic default
  account, the same one a later switch would create. Decided, not silently assumed (see Asks).
- I2 Derivation is never swallowed: a rejection (`unauthorized` from a lock/deletion race, a storage
  failure) propagates as the dApp-side error envelope, like every other dispatch failure. The popup's
  hard error is reserved for the two declined cases (custom/devnet chain, chain with only hidden or
  imported rows), where its tooltip names the remedy.
- I3 After the in-window switch, the pending interaction is unaffected: it is keyed by `requestId` and the
  session's chain, and `approve()` resolves it with CAIP accounts of the dApp chain
  (`capabilities/index.vue:202`); the shell's network watcher only reloads the store (`app.vue:113`).
  Activation serialization is per popup realm (`guarded-network-activation.ts:15`) — same as Settings.
- I4 "Only hidden / only imported rows on that chain": mirrors the network switch, which checks rows of
  ANY visibility and type before creating (`network-switch.ts:67-71`, `getAccounts(…, true)`). The
  dispatcher declines to derive, the popup shows the hard error, and the mismatch banner is hidden in
  that state so "Approve as is" is never shown next to a disabled Approve.
- I5 The discover window stays untouched: `DiscoveryParams` carries no chain
  (`dapp-interaction/spec.ts:93-95`), and a dApp may legitimately connect with a permissive `Fr.ZERO`.

### Asks (resolved)
- A1 Merge authority: owner said "babysit the PR until green and merged" → the agent squash-merges once
  the three required gates are green. Not an AFK action; an explicit instruction.
- A2 `/code-review`: off (owner directive).
- A3 Copy: locked above; codex may propose tightening but the owner's wording wins.
- A4 Unattended-derivation policy (codex asked for it to be explicit): derive only when the chain's L1
  identity needs no probe (`mainnet`/`testnet`/`local`) AND the chain has no rows of any kind; the row
  persists after a reject. Owner may veto; the rule lives in ONE method (`provisionDefaultAccount`).

## Architecture & Implementation (compact)

**Where it lives / what is reused** (see `recon.md`):
- `packages/wallet-bridge/src/services-contract.ts` — new `IAccountProvisioner {
  provisionDefaultAccount(profileId: string, chainId: number): Promise<void> }`; the dispatcher's
  constructor takes `IAccountReader & IAccountProvisioner` (`IAccountReader` keeps its honest read-only
  meaning for `account-order.characterization.test.ts`). TSDoc: ensures the chain's default account
  exists when the wallet may create it UNATTENDED (a chain with no rows of any kind whose L1 identity
  needs no endpoint probe); a no-op otherwise; rejects on an authorization/storage failure. The caller
  re-reads accounts afterwards — the method returns nothing on purpose.
- `apps/extension/src/wallet/services/account/service.ts` — `provisionDefaultAccount(profileId, chainId)`
  under the same per-tuple serialization as `ensureDefaultAccount`: any live row on the chain
  (hidden/imported included, mirroring `network-switch.ts`'s `getAccounts(…, true)` check) → return;
  else `createAccountInternal(profileId, chainId, AccountType.Nulo_v1, DEFAULT_ACCOUNT_NAME,
  { unattended: true })`, whose ONE network lookup refuses to probe (below) — so "offline only" is
  enforced at the row read that derivation actually uses, not by a preflight a concurrent
  delete-and-re-add could invalidate. The refusal (`ERR_UNATTENDED_PROBE`) is the one error the method
  catches and turns into a no-op; everything else propagates. The concrete service satisfies the
  contract structurally — no wiring adapter.
- `apps/extension/src/wallet/services/network/service.ts` — `resolveVerifiedL1ChainId(profileId,
  chainId, opts?: { unattended?: boolean })`: when the row's kind has no seeded constant AND
  `opts.unattended`, throw `ERR_UNATTENDED_PROBE` instead of probing (`spec.ts` constant, same prefix
  convention as the other `ERR_*`). Canonical L1 validation of seeded rows is unchanged. The probe-free
  set stays private to the service that owns it.
- `packages/wallet-bridge/src/dispatcher.ts` — `loadAvailableAccountsForPopup`: read visible rows → if
  empty, `await provisionDefaultAccount` then re-read visible rows (the switch's own pattern: a row
  created concurrently, or a derived-then-hidden row, is settled by the re-read, never by the
  provisioner's return value) → project. No try/catch: a rejection propagates like every other dispatch
  failure (I2). `handleRequestCapabilities` is untouched (budget).
- `apps/extension/src/wallet/services/account/spec.ts` — `DEFAULT_ACCOUNT_NAME = "Account"`; the two
  popup call sites use it.
- `apps/extension/src/composables/useNetworkActivation.ts` (C1) — extracts `[id].vue`'s
  `handleSetActive` core. Receives the persist/read callbacks from the parent
  (`useNetworkActivation({ persist: (id) => managers.network.setActiveNetwork(id), read: () =>
  managers.network.getActiveNetwork() })`) — no hidden manager ownership, no subscriptions, nothing to
  dispose. `activate(target: Network): Promise<NetworkActivationResult>` owns the in-flight-send
  pre-check (returns `"blocked"` without calling the service) and the failure toasts (`blocked` →
  "Finish or cancel your pending transaction first", `unconfirmed` → the warning toast, `stale` →
  silent); callers own their success feedback. `[id].vue` becomes a thin caller (its `isActive`
  short-circuit and success toast stay).
- `apps/extension/src/popup/windows/capabilities/chain-mismatch.ts` — pure
  `resolveDappChain(sessionChainId, networks, activeChainId): { chainId, name, network?, mismatch }`;
  name = row name, else `getChainName(chainId)`.
- `apps/extension/src/popup/windows/capabilities/index.vue` — `dappChain` computed from
  `payload.session.chainId` + `appStore.networks` + `appStore.network`; `switchedTo` + `isSwitching`
  refs; the banner (`data-testid="cap-chain-banner"`) has two states and one gate:
  `data-state="switched"` when `switchedTo` names the CURRENT active chain (the done tone, no action),
  `data-state="mismatch"` when `dappChain.mismatch` (the invitation + action, only with a matching row);
  neither renders while `noAccountsAvailable` (codex: never show "Approve as is" beside a disabled
  Approve). `switchToDappNetwork()` ignores re-entry (`isSwitching`) and a pending approve (`isLoading`),
  calls the composable, sets `switchedTo` on `"activated"`. **A pending switch and the window's close are
  coordinated**: while `isSwitching`, the footer's Approve and Reject are disabled and `approve()`
  early-returns, so a footer decision can never abandon an activation. `reject()` itself stays
  UNCONDITIONAL — `useDappApprovalWindow` binds it to `beforeunload` and to the lock/profile-change
  guard (`useDappApprovalWindow.ts:79,103`), and a lock landing mid-switch must still reject the pending
  interaction while the shell navigates to auth (`app.vue:172`); only the footer button is held. Identity
  line `is requesting permissions on {name}`; the hard-error tooltip becomes "This app asked for
  accounts on {name}. Switch the wallet to {name} in Settings to set one up, or unhide one of its
  accounts, then try again from the app." No change to `approve()`'s grant assembly.
- `packages/design/src/ui/Banner.vue` — `action.testId?: string` forwarded as `data-testid` on the action
  button (both directions). One test case.

**Critical flow**: dApp `requestCapabilities(accounts)` → dispatcher resolves the dApp chain row →
visible rows empty → `provisionDefaultAccount` (no rows of any kind + probe-free kind → derive index 0;
otherwise a no-op) → re-read visible rows → popup opens with the account listed (or the hard error) →
the popup computes `mismatch` from `session.chainId` vs `appStore.network.chainId` → banner →
(optional) switch via `useNetworkActivation`, Approve/Reject held while it runs → `appStore.network`
moves, the shell reloads accounts, the banner settles to "switched" → Approve → unchanged
`resolveInteraction` → dispatcher persists the grant → window closes.

**Trade-offs / alternatives not taken**
- Carry `{ chainId, name }` in `CapabilityParams` from the dispatcher: rejected — the popup already has
  the chain id and every network row; a wire field would be a second source that can drift from renames.
- Derive at Approve time instead of popup-open: rejected — the row's address must be listed before
  approval, and derivation is idempotent and deterministic.
- Optional provisioning hook on the contract (no test churn): rejected — a method the production path
  always needs must be required; the 23 typed fakes get a one-line stub (a shared `unreachable` helper
  in each test file).
- A wiring-site adapter carrying `AccountType.Nulo_v1` + the default name into `background.ts`: rejected
  in favour of `AccountService.provisionDefaultAccount` — the unattended policy (probe-free kinds, no
  existing rows) belongs to the service that owns rows, where `service.test.ts` can pin it.
- Swallowing derivation failure into `[]` (popup hard error): rejected after codex — operational
  failure is not evidence of account absence; the dApp gets the error envelope.
- Deriving for custom/devnet chains too: rejected — a dApp must never be able to make the wallet probe
  an endpoint, and a failed probe would be retried on every request.
- Inline the activation ladder in the window: rejected — the in-flight guard and toast copy would then
  live in two places.

## Security & Adversarial Considerations

- **Threat model**: the dApp controls `chainInfo` and therefore WHICH configured chain gets a derived row
  and is offered for sharing. It cannot name an endpoint (rows are wallet-configured), cannot bypass the
  account picker (the user still selects + approves), cannot read the address before approval (it only
  reaches the popup). Chain enumeration by error text (`No network configured` vs a popup) exists today.
- **Derivation side effects**: one idempotent row per (profile, chain), only for probe-free kinds and
  only when the chain has no rows at all; no deployment, no key export, no endpoint I/O on a dApp's
  request (custom/devnet are declined → hard error, so a dApp cannot make the wallet probe anything,
  and there is no retry surface). The row persists after a reject (A4).
- **Locked wallet**: dispatch is gated on an unlocked profile at entry; a lock landing before the secret
  read rejects with `unauthorized` (error envelope to the dApp, no popup); after it, the secret-free row
  write completes as an in-flight switch would. A deletion is fenced by the epoch assert.
- **Rendering**: `Network.name` is user-controlled text rendered through Vue interpolation (escaped);
  the dApp name/hostname path is unchanged (still sanitized in `DappIdentityBlock`).
- **Logging policy**: no new log line — the dispatcher does not catch; the existing error envelope
  path scrubs as today. Nothing new can carry an address.
- **Switch from a dApp window**: goes through the same guard as Settings (in-flight send refused,
  admit-before-persist, reconcile on failure); the pending interaction is not moved by it (I3).
- **Supply chain / crypto / least privilege**: no new dependencies, no new secrets, no workflow changes.

## Phases

### Phase 1 — the dispatcher provisions the dApp chain's default account ✓
- `services-contract.ts`: `IAccountProvisioner.provisionDefaultAccount`; dispatcher constructor param
  `IAccountReader & IAccountProvisioner`.
- `dispatcher.ts` `loadAvailableAccountsForPopup`: visible rows → if empty, provision then re-read; no
  catch.
- `dispatcher.test.ts`: stub the new method on the fakes (`unreachable`); three new tests — empty first
  read provisions once and the popup payload lists what the re-read returns; non-empty first read never
  provisions; a no-op provision + empty re-read yields `availableAccounts: []`; a rejection propagates
  out of `requestCapabilities` (no popup, no persisted rejection). `account-order.characterization.test.ts`:
  stub only.
- `network/spec.ts` `ERR_UNATTENDED_PROBE`; `network/service.ts` `resolveVerifiedL1ChainId` `unattended`
  option (+ `service.test.ts`: a custom row under `unattended` throws it and never probes; a seeded row
  resolves as before); `account/spec.ts` `DEFAULT_ACCOUNT_NAME` (used by `useProfileBootstrap.ts` +
  `network-switch.ts`); `account/service.ts` `provisionDefaultAccount` + `service.test.ts` cases: derives
  on an empty probe-free chain (one visible index-0 row lands); no-op (no row) when the resolver
  refuses the probe; no-op when the chain holds only a hidden row; no-op when it holds only an imported
  row; a second call is a no-op (the row already exists); a non-refusal rejection propagates.
- **Validation gate**: `cd packages/wallet-bridge && bun run test` · `cd apps/extension && bun run test
  src/wallet/services/account src/wallet/services/network` (exit 0, new tests green) · `bun run lint` ·
  `bun run typecheck` (root; exit 0). Layers: lint/typecheck · unit.

### Phase 2 — `useNetworkActivation` composable (extract, no behavior change) ✓
- New `composables/useNetworkActivation.ts` + `useNetworkActivation.test.ts` (≥10 cases: activated
  with no toast, blocked via the in-flight pre-check without calling persist, blocked from the guard
  with its toast, unconfirmed toast copy, stale silent, the persist/read callbacks are the ones invoked,
  the target reaches `store.network`, activations serialize, a throwing persist reconciles).
- `settings/networks/[id].vue` calls it; its two toasts for blocked/unconfirmed move into the composable;
  success toast stays in the page.
- **Validation gate**: `cd apps/extension && bun run test src/composables/useNetworkActivation.test.ts`
  · `bun run lint` · `bun run typecheck` (exit 0). Layers: lint/typecheck · unit.

### Phase 3 — the popup: banner, switch action, identity line ✓
- `Banner.vue` `action.testId`; `Banner.test.ts` +1 case.
- `chain-mismatch.ts` + `chain-mismatch.test.ts` (known row, renamed row, unknown id fallback, no active
  network, same chain).
- `capabilities/index.vue`: `dappChain`, `switchedTo`, `isSwitching`, the two-state banner (owner copy
  verbatim, hidden while `noAccountsAvailable`), the action (only with a matching row; re-entry guarded;
  Approve/Reject held while it runs), the identity line; hard-error tooltip updated to name the chain
  and the remedy.
- `capabilities/chain-switch.test.ts` (deterministic component test, sibling of the lifecycle oracle —
  same mock shape): mismatch renders the banner + action; same chain renders neither; hard error hides
  the banner; a deferred `activate` holds the footer's Approve/Reject disabled and ignores a second
  click, then "activated" flips the banner to `switched` and re-enables the footer; a "blocked" result
  leaves the invitation in place; a profile-change event during the deferred activation still rejects
  the interaction (lifecycle rejection is unconditional).
- **Validation gate**: `cd apps/extension && bun run test src/popup/windows/capabilities` +
  `cd packages/design && bun run test` · `bun run lint` · `bun run typecheck` (exit 0) ·
  `bun run baseline:complexity` reports no manifest change. Layers: lint/typecheck · unit · component.

### Phase 4 — network e2e + fixture note
- `tests/e2e/network/cap-chain-mismatch.test.ts`, two tests on `registeredExtensionPerTest` (wallet
  stays on Testnet) → `connectPlayground` (Local Network) → popup waiter armed BEFORE the request →
  request `accounts`:
  1. **approve without switching** — `cap-chain-banner[data-state="mismatch"]` text contains
     "Connecting on Local Network" and "Your wallet is on Testnet"; exactly one `cap-account-item`; the
     strip (`data-testid="identity-network"` added to `IdentityStrip`) reads "Testnet" — asserted BEFORE
     approval, since approval closes the window; `approveCapabilities` → playground result ok, the
     granted address equals the listed one.
  2. **switch, then approve** — click `cap-switch-network-btn` → `cap-chain-banner[data-state=
     "switched"]` and the strip reads "Local Network" → `approveCapabilities` → result ok, same address.
  Approve/Reject racing a pending switch is guarded in the window (`isSwitching`/`isLoading`), not
  e2e-tested — a timing race is not a deterministic browser test.
- Refresh the fixture comment at `fixtures/extension.ts:514-518` (the switch stays: the suite needs
  Local Network accounts with sandbox funds, not just the derived default).
- **Validation gate**: `bun run e2e:agent tests/e2e/network/cap-chain-mismatch.test.ts` (exit 0) and,
  because the fixtures changed, `bun run e2e:agent tests/e2e/network/cap-request-accounts.test.ts`
  (exit 0). Run the network suite alone on the host (memory: concurrent load mass-fails it). Layers: e2e
  (sandbox).

### Phase 5 — docs + wrap
- `apps/extension/tests/e2e/README.md` gets one line on the mismatch spec if the README lists specs;
  `implementations-plan/index.md` status; lessons per phase.
- **Validation gate**: `bun run audit:vue` (typecheck ∥ test ∥ lint, then build; exit 0) ·
  `bun run lint:actions` not needed (no workflow change). Layers: all fast layers + build.

## Post-implementation (self-contained — the implementing session executes THIS)

1. `/code-review` is **off** for this plan (front matter). Do not run it.
2. **Codex audit** (`/codex xhigh`, fresh session via `~/.claude/skills/codex/scripts/run-codex.sh`):
   the net diff from the plan baseline (`git diff origin/dev...HEAD`), this plan.md, recon.md, and:
   - the adversarial/security ask: *"What could go wrong? What would an attacker target? What are we
     trusting that we shouldn't? Where are the supply-chain / crypto / least-privilege weaknesses?"*
   - the no-over-engineering rule, verbatim: *"Report bugs and small, targeted improvements only. Do not
     propose speculative abstractions, extra configuration surface, new layers, or rewrites — the
     smallest change that fixes each real problem. If code works and is clear, leave it alone."*
   - the comment-quality rule, verbatim: *"Audit the comments for value per character. Flag any comment
     that narrates what the code visibly does, restates its line, references implementation plans /
     phases / reviews, or spends a paragraph where a sentence works — and flag places where a
     non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent
     context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Iterative fix loop**: verify each finding against the repo first (codex misreads), apply accepted
   fixes, commit, log round + verdict in `lessons/post-impl.md`, then RESUME the same session
   (`resume-codex.sh`) with the fix diff for a re-review. Stop when a round yields no new material
   finding. Still material after 3 rounds → surface to the owner.
4. **Delivery** (single arc): only now `gh pr create` against `dev` with a Conventional-Commit title
   ≤ 93 chars, e.g. `fix(popup): connect on another chain derives its account and offers the switch`;
   body = summary + test evidence; then `gh pr checks --watch`. Required gates: `quality-status`,
   `smoke-e2e-status`, `network-e2e-status`. Red = flake → re-run once (memories: smoke SW-kill,
   multicall approvable, wallet-locked-mid-session are known flakes); real → fix. Green → `gh pr merge
   <n> --squash --delete-branch` (owner-authorized in chat 2026-09-05). Then mark the index entry
   completed and suggest `agent-worktree done connect-chain-mismatch`.

## Delivery

Single arc, single PR: Phases 1–5 → one branch (`worktree-connect-chain-mismatch`) → `gh pr create`
after the codex loop converges. No stack ceremony. `code_review: off`.

## Audit log

- Codex round 1 (session `01a07268-aca2-79d2-86a7-3eed84474c4d`): **conditional approve** (conditions:
  correct probe and lock assumptions, preserve all-hidden behavior, distinguish operational failures,
  gate misleading copy, add no-switch and switch-race coverage). Adopted: unattended rule (probe-free
  kinds only, no existing rows of any kind) in `provisionDefaultAccount`; no swallowing; F4 corrected;
  banner hidden on the hard error; no-switch e2e; re-entry guard; C1 receives callbacks; the action only
  with a matching row; `IAccountProvisioner` split instead of widening `IAccountReader`. Rejected: a
  timing test for a lock landing after the secret read (the write is secret-free and identical to an
  in-flight switch's — benign); an e2e for the approve-vs-switch race (non-deterministic). Transcript:
  `audit-codex.md`.
- Codex round 2 (resumed): **conditional approve** (conditions: enforce offline resolution at use,
  restore the visible-account re-read, fix success-banner gating, coordinate pending switches with
  window closure). All four adopted: `unattended` option on `resolveVerifiedL1ChainId` (refusal at the
  row read derivation uses; `ERR_UNATTENDED_PROBE`) instead of a `derivesOffline` preflight;
  `provisionDefaultAccount` returns `void` and the dispatcher re-reads; two-state banner keyed on
  `switchedTo` = current chain; Approve/Reject held while `isSwitching` + a deferred-activation component
  test. Lows fixed: the "same row" contradiction, the manager-ownership test, the stale critical flow,
  the no-switch strip asserted before approval. Q3 (row persists after reject): codex sees no harm.
- Codex round 3 (resumed): Q1 (the refusal throw vs the deletion fence) confirmed clean. One Medium
  adopted: `reject()` stays unconditional (lifecycle rejection on lock/profile change/`beforeunload`);
  only the footer's Reject is held while switching, pinned by the deferred-activation test. Low
  adopted: the "Approve stays enabled throughout" wording.
- Codex round 4 (resumed): **approve** — "No remaining material findings in the revised blueprint."

## Seeds

ELI5 companion: Artifact `https://claude.ai/code/artifact/28d9dcd6-3ec4-498a-ae69-82798bca654e`
(source `implementations-plan/connect-chain-mismatch/eli5.html` — redeploy the same file to update).

Recommended: `/goal` (completion is transcript-observable).

```
/goal All five phases marked ✓ in implementations-plan/connect-chain-mismatch/plan.md (the phase headers in the file), each ✓ backed by its validation gate reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/connect-chain-mismatch/lessons/phase-N.md`; `/code-review` was NOT run (code_review: off); the post-implementation codex fix loop converged (a resumed codex pass reporting no new material findings, quoted in the transcript); a single PR against dev exists, created only after the loop converged (`gh pr view` output in the transcript) and `gh pr checks` shows quality-status, smoke-e2e-status and network-e2e-status green; the PR was squash-merged (`gh pr view --json state` = MERGED in the transcript); `bun run test` and `bun run lint` both report exit 0 in the transcript.
```

Alternative: `/loop 15m` — same reality-check/drive template as the blueprint skill, with
`<lint>` = `bun run lint`, `<test>` = `bun run test`, single-arc close-out per the Post-implementation
section above.
