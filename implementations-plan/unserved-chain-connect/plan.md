---
plan: unserved-chain-connect
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: none (subagent run; the owner signs off through the coordinator's page)
harden: not scheduled
budget: "recon: 1 agent; code-review: off; codex at high, fix loop at most 3 rounds"
branch: fix/unserved-chain-connect
base: origin/dev at 18a38265
---

## Outcome & Quality Bar

**Done when** a dApp that asks to connect on a chain the wallet has no network for gets no
session. The user sees a notice that says why, and a dApp connected on a chain that later
disappears gets a typed error it can act on. Nothing else about connecting changes.

**For whom.** The person whose app asked for the wrong chain: today they press Allow and every
call then fails with "The wallet could not process the request.", and a refresh does not help.
The dApp developer: today they get an untyped string. The user should see:
- No dead connection. Nothing they allowed should break silently.
- A notice that names the app the way the connect window does, and says what to do.
- No difference at all on a chain the wallet serves.

## The bug (root cause, verified)

The owner's report (2026-10-01, production 0.29.0): with the wallet locked, an app connects. The
owner unlocks with a passkey, checks the emojis and presses Allow. The app's `requestCapabilities`
then fails with "The wallet could not process the request.", no capabilities window opens, and a
refresh does not fix it. The app was unleashed, and it asked the V6 wallet for the V5 testnet
chain (1816023401; the wallet serves 2904119610).

1. `handleDiscovery` (`apps/extension/src/wallet/services/wallet-sdk/background.ts`) never asks
   whether the profile has a network for the requested chain. The connect window opens, and
   Allow writes a `DappSession` for `(origin, 1816023401)` (`persistAndApprove` →
   `addDappSession`).
2. Every chain-bound method resolves the session's chain in `WalletSdkDispatcher.resolveNetwork`
   (`packages/wallet-bridge/src/dispatcher.ts`), which throws a plain
   `Error("No network configured for chainId 1816023401")`.
3. `toWalletResponseError` (`wallet-sdk/error-envelope.ts`) does not classify a plain error, so
   the dApp gets the constant "The wallet could not process the request."
4. After a refresh, the remembered row auto-approves the same handshake
   (`autoApproveExistingSession`, keyed on `(origin, chainId)`), and the next call fails the same
   way.

The lock only decides when the window appears. Track A proves it on a served chain:
`apps/extension/tests/e2e/network/connect-locked-queue.test.ts` connects while locked and
unlocks with a password and with a passkey. It then runs requestCapabilities, getAccounts,
registerContract, a utility read and simulateTx, refreshes, and runs them again: green on Chrome and on
Firefox (lessons/phase-1.md).

## Owner decisions (relayed by the coordinator, 2026-10-01)

- **A notice in the wallet (option b).** It opens exactly where today's connect window would open
  for that `(origin, chain)`: a new connection, including the locked-queue drain after unlock.
  The app still gets silence, and no `DappSession` row is written.
- **Stale rows.** A remembered row for an unserved chain stops auto-approving and is dropped, so
  the origin's next discovery takes the new-connection path and shows the notice. No migration.
- **Caps and dedupe.** The notice goes through the connect window's caps and dedupe
  (`checkDiscoveryPopupCaps`, `pendingDiscoveryPromises`).
- **Dismissal.** Escape and Close both dismiss it, and nothing is approved.
- **The typed error.** A live channel whose network disappears gets the typed 4901
  `CHAIN_NOT_SUPPORTED` error.
- **Copy** (no em dash):
  - Title: "Network not available".
  - Body: "This app asks for a network your wallet doesn't have. The app and your wallet need to
    be on the same network."
  - One button: "Close".
  - The app's origin is shown the way the connect window shows it. Every element has a
    `data-testid`. The window reuses the connect window's layout and components.
- **Signed off by the owner, 2026-10-02.** In chat: "Signed-off details." The coordinator's
  sign-off page (https://claude.ai/artifact/MV1LVGp2urYWAXaE1PwY8m) records three answers:
  - The body's second sentence: "same" (10:05:05Z), the line above. It replaced "Switch the app to
    a network your wallet uses."
  - The muted "Requested chain: N" line: "drop" (10:05:18Z). The payload no longer carries the
    chain id.
  - The notice as pictured, both themes, and when it shows: approved, no note (10:05:30Z).

## Architecture & Implementation

1. **`ChainNotSupportedError`** in `packages/extension-messaging/src/errors.ts`:
   - Code `CHAIN_NOT_SUPPORTED`, a constant message, no details.
   - Registered in `KnownWalletErrorPayload` and `walletErrorFromPayload`, and added to the
     `errors.test.ts` sweep.
2. **Dispatcher.** `resolveNetwork` throws it when the profile has no row for the session's chain.
   The `dispatcher.test.ts` pin moves from the message to the class.
3. **Envelope.** `toWalletResponseError` maps the class to `{ code: 4901, message: <constant>,
   data: { walletErrorCode: "CHAIN_NOT_SUPPORTED" } }`. EIP-1193 4901 means "the provider is not
   connected to the requested chain". The envelope names no chain the wallet does serve.
   `isExpectedRefusal` logs it at debug, since a connected dApp polls.
4. **`NetworkService.servesChain(profileId, chainId)`**: `isChainLive`, except that a profile with
   no network rows, or one whose first activation is writing them, counts as having the default
   seeds' chains. A new profile's rows are seeded by the shell's first bootstrap, which the
   activation's drain of queued discoveries can outrun, one row at a time, and the active network
   can never be deleted, so an empty profile is always one about to be seeded. An in-memory
   `seedingProfiles` set, held across `getOrInitNetworks`' seed loop, covers the gap between the
   two writes. Without this, a dApp queued before a first profile exists could get the notice for
   a default chain. Lock-free, like `isChainLive`.
5. **Discovery gate** in `handleDiscovery`:
   - The profile-switch epoch is captured before the profile read, as `handleWalletMessage` does.
   - `served = servesChain(profile.id, chain)` is awaited before the session lookup, as
     `isLegalCurrent` is. That keeps the lookup as the last yield before the dedupe registration.
   - After the lookup, a changed epoch refuses the discovery: `served` is the captured profile's
     answer and the lookup reads the active profile's rows, so after a switch one profile's
     networks would decide over another's session. The check is synchronous, so the no-yield
     invariant holds.
   - A remembered row auto-approves only when `served`.
   - The Terms gate stays where it is.
   - A duplicate of a pending key on an unserved chain is refused at once.
   - The caps apply to both windows. An unserved chain then goes to the notice runner and never
     to `runDiscoveryPopup`.
6. **Notice runner** (`background.ts`). It registers the dedupe promise before any await, refuses
   the discovery (silence) before opening anything, and drops the stale row if there is one. It
   then opens the notice and releases the key in `finally`. Its outcome is ignored: no path
   from it reaches `approveDiscovery` or `addDappSession`. The drop re-reads the row's own
   profile and chain first, and keeps the row when that chain is served again or the profile
   switched since entry.
7. **The write after Allow.** `persistAndApprove` re-reads `servesChain` before `addDappSession`:
   the connect window opened on a served chain, and the user can remove that network while it is
   up. The read comes before the profile check, which stays the last await ahead of the write. A
   refusal there gives the window's reservation back like the other refusals in that function.
8. **`DappInteractionService.notifyNetworkUnavailable(params)`**:
   - A new interaction type, `network-unavailable`, with a `{ notice, params: { dappMetadata } }`
     payload.
   - `resolveInteraction` refuses it ("Invalid id", non-disclosing), so a page cannot turn it into
     a discovery approval. `isDiscoveryPayload` excludes it.
   - `rejectInteraction` dismisses it.
9. **Window `apps/extension/src/popup/windows/network-unavailable/index.vue`**:
   - It reuses `DappStatusStrip`, `DappIdentityBlock` (the connect window's origin rendering) and
     the verify window's single-button footer.
   - Close and Escape reject the interaction and close the window.
   - testids: `network-unavailable-title`, `-body`, `-close-btn`, `-hostname`, `-dapp-name`.

**UI impact** (signed off by the owner, 2026-10-02, § Owner decisions):
- Before: a wrong-chain app opens the connect window (Deny/Allow), and Allow leads to a dead
  connection.
- After: the same request opens the notice above, with no Allow. A served chain is unchanged.
- Screenshots: `before-dark.png` and, with the signed-off copy, `final/after-dark.png` and
  `final/after-light.png`. They stay local and uncommitted; the PR body links the sign-off page.

## Security & Adversarial Considerations

- **The dApp controls `chainInfo`.**
  - It cannot make the wallet approve, write, probe or derive anything for an unserved chain. The
    only effect is a notice, under the connect window's caps (4 per origin, 32 global) and
    `(origin, chain)` dedupe.
  - A dApp could spam notices exactly as it can spam connect windows today; no new amplification.
- **No oracle.**
  - The dApp gets silence on an unserved chain and silence until the user acts on a served one,
    so discovery reveals nothing about which chains the wallet serves.
  - The 4901 envelope is constant and names no served chain. It fires only for a session the dApp
    already holds whose chain disappeared, a fact about its own session.
- **Spoofed identity.** The notice's name is the sanitized `appName ?? appId`
  (`sanitizeWireString`, as the connect window's), and its hostname comes from the trusted
  content-script origin. Nothing on the notice is actionable.
- **Never approve unserved.**
  - The discovery is refused before the notice opens.
  - The notice payload cannot be resolved as a discovery (`resolveInteraction` refuses it).
  - The background ignores the window's outcome.
- **Stale-row purge.** It deletes only the `(profile, origin, chain)` row the lookup returned,
  which the profile's own earlier Allow wrote, and only while that row's own profile still does
  not serve its chain and no profile switch has happened since the discovery's entry. The delete
  emits `onDappSessionDeleted`, so any live channel for that pair is torn down, which matches a
  chain the wallet no longer serves. That teardown matches channels by `(origin, chain)` alone,
  which is why the drop refuses after a switch. A switch inside the delete's own lock wait and
  storage write would still reach the new profile's channel on that pair: it needs the user to
  unlock another profile within milliseconds, and costs a reconnect, not a grant. The expiry sweep
  has the same cross-profile reach today; scoping the teardown is filed in `follow-ups.md`.
- **Profile switch mid-discovery.** The served check reads the captured profile and the session
  lookup the active one. A switch between them is caught by the switch epoch, read synchronously
  after the lookup, and the discovery is refused: no notice, no drop, no approval.
- **Logging.** The chain id is a number, safe to log. Request ids go through
  `describeExternalId`. A refusal that a dApp can repeat logs at debug.
- **A network removed during a connection.** Removed while its connect window is up: the
  re-read before the write refuses the Allow, and no row is written. Every later removal ends as
  a session whose network went away, the owner's 4901 case, which the origin's next discovery
  turns into the notice and a dropped row. That covers a removal after the write, a remembered
  row's reconnect queued behind the origin's budget, and a duplicate approved on its twin's row.
  A removal racing the write itself needs no compensation: network deletion never purges
  sessions, so a row written as the removal starts ends exactly like one written just before.

## Assumptions

- `servesChain` is the right predicate: it treats a network mid-deletion as unserved, and an
  empty or mid-seeding profile as the defaults it is about to hold. A first seeding that fails
  outright leaves an empty profile that still answers the defaults until the next bootstrap
  re-seeds it: the uncertain answer leans to the connect window, whose worst case is a typed 4901
  and a notice at the next connect.
- No production user holds a row the purge should keep: a row for an unserved chain has never
  been able to serve a call.
- Network deletion keeps its current behavior (sessions stay, calls get 4901). Purging sessions
  on deletion would replace the typed error with a teardown; the owner asked to keep the error.

## Tests

- **Unit, `extension-messaging`.** Class shape and round trip (the sweep).
- **Unit, `wallet-bridge`.** `resolveNetwork` rejects with `ChainNotSupportedError` for a chain
  with no row.
- **Unit, envelope.** 4901, constant message, `walletErrorCode`, no chain list.
- **Unit, discovery** (`background.unserved-chain.test.ts`, mocked SDK handler, `fakeSdkServices`
  with a served-chain option):
  - A new origin on an unserved chain is refused, opens the notice, and writes no session.
  - A remembered row on an unserved chain does not auto-approve, is deleted, and opens the
    notice.
  - A duplicate while a notice is up is refused and opens no second window.
  - The caps refuse past the per-origin cap.
  - A served chain is unchanged (connect window, approve).
  - The locked drain reaches the same gate.
  - A profile switch during the reads refuses the discovery and keeps the row.
  - The drop keeps a row whose chain is served again by the time it runs.
  - A network removed while its connect window is up: Allow writes no row and is refused.
  - A profile switch during that re-read refuses the Allow and writes no row.
  - The last four each fail with their fix undone (mutation probe, not committed).
- **Unit, network service.** `servesChain`: an unseeded profile serves exactly the default
  seeds' chains, and so does one paused between its two seed writes (fails without the seeding
  set); a seeded one serves only its live rows, not a removed network nor one mid-deletion.
- **Unit, interaction service.** `notifyNetworkUnavailable` opens the window type, refuses
  `resolveInteraction`, and settles on reject.
- **Component, the window.** Renders the copy and testids. Close and Escape reject and close.
  Nothing calls `resolveInteraction`.
- **E2E** (`apps/extension/tests/e2e/network/connect-unserved-chain.test.ts`, Chrome and
  Firefox):
  - The playground on the V5 chain gets the notice (by testid) and no session row. Close closes
    it.
  - The same origin on the served chain then connects and is granted capabilities.
  - A deleted network: `getAccounts` gets the typed 4901 and the row stays; after a reload the
    connect shows the notice and drops the row.
- **E2E, Track A.** `connect-locked-queue.test.ts`, extended: the only e2e of a locked connect plus
  unlock (password and passkey) followed by real calls and a refresh.

## Validation gates

`bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`,
`bun run check:plans`, and the two e2e files above on Chrome and on Firefox, run through
`bun run e2e:agent` under the host lock.

## Audit verdicts

**Round 1** (codex, GPT-6 Astra at `high`, adversarial, static review): `changes-required`.

- **F1, major: the served check expires before the approval.** A connect window opens on a served
  chain, the user removes that network, then presses Allow: the row is written. Codex extends it
  to a remembered row's reconnect queued behind the origin's budget and to duplicates approved
  after their twin's window.
  - Accepted for the write: `persistAndApprove` re-reads `servesChain` before `addDappSession`,
    with a unit test.
  - Not gated: the queued reconnect and the duplicate approve on a row written while the chain
    was served. Both end as the owner's 4901 case, healed by the next discovery.
  - Rejected: compensating a row whose write races the removal. Network deletion never purges
    sessions, so that row ends exactly like one written just before the removal.
- **F2, major: the drop can reach another profile's row.** `served` reads the captured profile
  while the lookup reads the active one, so a switch between them could drop the new profile's
  valid row, or approve its row on the old profile's answer. Codex also flags that the deletion's
  teardown matches live channels by `(origin, chain)` alone.
  - Accepted: the switch epoch is captured before the profile read and checked synchronously after
    the lookup, refusing the discovery on a change.
  - Accepted: the drop re-reads the row's own profile and chain, and refuses after a switch.
  - A unit test pins each.
  - Deferred: scoping `wireSessionTeardown` by the channel's profile stamp. The expiry sweep has
    the same cross-profile reach today, and the teardown is also the revocation path, so changing
    its predicate is its own change; filed in `follow-ups.md`.
- **F3, found by self-review in the same round: the notice for Testnet on a first profile.** A
  new profile's networks are seeded by the shell's bootstrap, which the activation's drain of
  queued discoveries can outrun, so `isChainLive` could answer false for every chain. Fixed with
  `servesChain`, which counts an empty profile as its default seeds, with unit tests.
- **Found sound:**
  - The notice registers its dedupe promise before its first await, and the caps apply.
  - The discovery is refused before the notice opens, and `resolveInteraction` refuses a notice.
  - The 4901 envelope names no chain, and the typed refusal logs at debug.
  - The identity block reuses the sanitized name and the trusted origin.
  - The shared footer CSS is declaration-identical.
  - The tests carry served-chain controls.
  - The e2e selects only by testid and uses the browser-seam helpers.

**Round 2** (resumed session, same model and effort): `changes-required`.

- **F1, major: the new re-read widened the profile check's window.** `persistAndApprove` checked
  the profile, then awaited `servesChain`; a switch during that await would let `addDappSession`
  write under the newly active profile, and the approval marker would carry it.
  - Accepted: the re-read now comes before the profile check, which is again the last await ahead
    of the write. A unit test switches the profile during the re-read.
  - Not taken: binding the writer to the approving profile's fence. The remaining gap, between the
    profile check and `addDappSession`'s own fence capture, predates this change and needs the user
    to unlock another profile within it.
- **F2, major: a row count does not say seeding finished.** `getOrInitNetworks` writes Testnet,
  then Local Network, so between the two writes `servesChain(profile, 0)` answered false; and a
  seeding that fails outright leaves an empty profile answering the defaults.
  - Accepted: the `seedingProfiles` set, held across the seed loop, counts the defaults while they
    are written. A unit test pauses the second write.
  - Accepted as a residual: the failed seeding's empty profile (§ Assumptions).
- **F3, minor: the epoch check does not cover the delete's own awaits.** A switch during
  `deleteDappSession`'s lock wait could let its teardown reach the new profile's handshake on the
  same pair.
  - Not taken here: it needs the user to unlock another profile within that lock wait, and costs a
    reconnect, not a grant. Scoping the teardown by profile is the follow-up already filed, and
    must not weaken revocation's teardown.
- **Also fixed after this round:** `test:all` failed `browser-seam.test.ts`'s shrink-only reload
  count, since the two e2e files reloaded the playground with `page.reload()`. Both now reload
  through the seam's `reloadExtensionPage`. The locked-queue file also uses `selectPgBundle` in
  place of an inline bundle select.
- **Found sound:** the epoch listener runs before the unlock drain, so drained discoveries capture
  the updated epoch; the epoch check and the notice registration keep the no-yield invariant; the
  re-read refuses an Allow whose network was removed and gives its reservation back; keeping rows
  authorized before a later removal matches the 4901 policy.

**Round 3** (resumed session, the last round): `approve`, confidence moderate, static review. No new
finding. Codex checked the reordered `persistAndApprove`, the `seedingProfiles` lifecycle (cleared
in `finally`, never overlapping under the network lock, gone with a restart), the epoch and dedupe
ordering, and the new tests; the empty-profile fallback and the teardown follow-up stay as
recorded above. The loop converged in three rounds.

## Post-implementation

Run the codex fix loop at `high`, adversarial, until clean, with a hard stop at 3 rounds. Record
each finding and its resolution here.

## Delivery

One PR into `dev` once the owner has signed off the screenshots and codex has converged:
`fix(dapp): show a notice for an unserved chain instead of a dead connection`. Its body quotes
the sign-off. Merging is the owner's call.
