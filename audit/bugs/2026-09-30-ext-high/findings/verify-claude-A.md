# Verification A (Claude) — B-01 .. B-05

Method: code read first from each finding's title + failing path, own counter-example written down, then compared with the finding and checked against upstream `node_modules` source (@aztec/wallet-sdk 5.2.0, @aztec/pxe 5.2.0).

## B-01 — confirmed

- **Own counter-example (before reading the finding):** a dApp awaits `wallet.sendTx(...)` with `wait` omitted. `dapp-send-executor.ts:754-758` branches only on `NO_WAIT`, then does one `node.getTxReceipt(txHash)` right after broadcast. A just-sent tx cannot be mined yet, so the receipt is PENDING (or DROPPED on a lagging replica). Reachable on the most ordinary path.
- **Compared with the finding:** matches. Reference wallet `BaseWallet.sendTx` (`wallet-sdk/dest/base-wallet/base_wallet.js:388-411`) returns on `NO_WAIT`, otherwise `waitForTx(aztecNode, txHash, {...waitOpts, initialDelay})`, which honours `waitForStatus`, `timeout` and `dontThrowOnRevert` and throws on revert. No other wait exists on our path (`dispatcher.ts:1133-1149` only unwraps the result; `sentTxRecorder` only records). The one test (`dapp-send-executor.test.ts:436-460`) pins the single call with no `(BUG PIN)` note, so it is not declared intended.
- **Severity:** Major. Every dApp that awaits inclusion (the default) proceeds on a PENDING receipt. A later revert or drop never reaches it. It is user-visible and on the main dApp path, but funds are not lost.
- **Tightened counter-example:**
  1. dApp calls `sendTx(payload, {from})` with no `wait`.
  2. User approves; `proveAndSend` broadcasts (`dapp-send-executor.ts:738-751`).
  3. `:754` is false, so `:757` `getTxReceipt` runs once. Result is `{receipt: PENDING}` (`isMined()` false).
  4. dApp's `await` resolves, and it reads state or shows "done" before any block exists. Same at NO_FROM `:935-939`.
- **Refined fix:** in both branches replace the single `getTxReceipt` with upstream `waitForTx(node, txHash, {...walletOpts, initialDelay})`, same as BaseWallet: pass `op.opts.wait` through when it is an object, skip one poll interval first, and cap the timeout below the SDK's 300 s call ceiling. Extract one helper `awaitDappReceipt(node, txHash, wait)` used by both sites. Sibling that already does the job: `TransactionService.waitForTx` (`transaction/service.ts:237`, bounded 120 s, has the DROPPED debounce). Prefer reusing its debounce for replica lag.
- **Test to add:** in `dapp-send-executor.test.ts`, stub `node.getTxReceipt` to return PENDING twice then MINED; with `wait` undefined assert the result is the MINED receipt and the stub was polled 3 times; with `{waitForStatus: CHECKPOINTED}` assert it waits for that status; a reverted receipt throws unless `dontThrowOnRevert`.
- **Effort:** M.
- **Final confidence:** high.
- **ELI5:** A dApp that waits for "transaction confirmed" is told "done" the instant the tx is broadcast, before it is in any block, and never hears about a later revert or drop.

## B-02 — confirmed

- **Own counter-example (before reading the finding):** `PreviewSnapshots` is a `SingleShotTtlCache(ESTIMATE_REUSE_TTL_MS = 120_000)` (`transfer-estimate-reuse.ts:39`), entry physically deleted by timer at TTL and also rejected in `take` by age. The approval lives up to `INTERACTION_TIMEOUT_MS = 10 min` (`dapp-interaction/service.ts:62`). If the user confirms after 2 min, `take` returns `missing`, so there is no `reuseId` (`:704-705`), the rebuild rediscovers the authwit hashes, and `assertWithinPreview` (`preview-snapshots.ts:52-74`) throws `ESTIMATE_INCOMPLETE_MESSAGE` for any non-empty recomputed set. An SW restart empties the in-memory map, which gives the same result.
- **Compared with the finding:** matches, including the second trigger: `confirm-disabled` (`execute/index.vue:689-698`) has no `estimatingOps`/`previewingOps` term, so a Confirm inside the 500 ms debounce after a fee change sends a stale or absent `previewId`. I did not trace the `approve` delta to prove `previewId: undefined` on that path, so the second trigger is moderate. The first trigger alone is enough. No popup timer re-estimates (only fee-change, debounced), so nothing refreshes the snapshot. Only ops with discovered witnesses are hit (`recomputedHashes.length`), as stated.
- **Severity:** Major. The send fails terminally, for authwit-bearing dApps only, after a slow read. The user can re-initiate from the dApp, nothing is signed or lost.
- **Tightened counter-example:**
  1. dApp `aztec_sendTx` with a private authwit; fee `fj` or `fpc`. Estimate stashes `{discoveredHashes:[h]}` (`dapp-send-executor.ts:395`) at t=0.
  2. User reads the card for 130 s and clicks Confirm.
  3. `takeStandardPreview` (`:704`) gets `missing`, so `reuseId` is undefined and `resolveStandardBuild` (`:713`) rebuilds with `discoveredHashes=[h]`.
  4. `assertWithinPreview(missing, [h])` (`:719`) throws "Fee estimate did not complete — retry the estimate". NO_FROM: `:1031` via `enforcePreview`.
- **Refined fix:** (1) give `PreviewSnapshots` its own TTL of at least `INTERACTION_TIMEOUT_MS` and evict on interaction settle (the snapshot holds hashes only; the 120 s bound matters for the reuse cache that retains signed requests, not here). Smallest change: a separate `new SingleShotTtlCache(INTERACTION_TIMEOUT_MS)` and drop the `Date.now() - builtAt > ESTIMATE_REUSE_TTL_MS` check in `take`. (2) Add `estimatingOps[i] || previewingOps[i]` to `confirm-disabled` for `aztec_sendTx`. The transfer path's `estimateReuse` has no equivalent hard fail (it falls back to a rebuild), which is why only the dApp path shows this.
- **Test to add:** in `dapp-send-executor.test.ts`, with fake timers: stash a snapshot with hashes `[h]`, advance 121 s, confirm a send whose rebuild discovers `[h]`, and assert it signs rather than throws `ESTIMATE_INCOMPLETE_MESSAGE`. Add `preview-snapshots.test.ts`: a snapshot is still `found` at 5 min.
- **Effort:** S.
- **Final confidence:** high.
- **ELI5:** If you stare at a dApp's approval card for more than two minutes and then press Confirm, the wallet refuses with "retry the estimate" and the request is dead.

## B-03 — confirmed

- **Own counter-example (before reading the finding):** `PxeService.profileTx` (`aztec-runtime/src/pxe/service.ts:621-623`) calls `pxe.profileTx(request, {profileMode, skipProofGeneration, scopes})` and nothing else, while its siblings `proveTx` (`:501`) and `simulateTx` (`:584`) pass `senderForTags: scopes[0]`, with a comment saying 5.x throws "Sender for tags is not set" otherwise. A dApp profiling any private call that emits a tagged private log (token `transfer_to_private`, private transfers) hits that.
- **Compared with the finding:** matches. Upstream `@aztec/pxe` `profileTx` accepts and forwards `senderForTags` into `#executePrivate` (`pxe.js:669,695`). The oracle's `getSenderForTags()` returns `Option.none()` when unset (`private_execution_oracle.js:120`). Reference `BaseWallet.profileTx` passes `senderForTags: this.senderForTagsFrom(opts.from, opts.sendMessagesAs)` (`base_wallet.js:365`). Our `view-executor.test.ts:76` mocks `pxe.profileTx`, so the gap cannot show there. The exact throw text for profile mode I inferred from the repo's own sibling comment, not reproduced; hence one notch below "certain".
- **Severity:** Major. A whole dApp RPC (`aztec_profileTx`) is broken for most real private calls. Send and simulate are fine, and profiling is a developer/gas-estimation surface, so it is not Critical.
- **Tightened counter-example:**
  1. Connected dApp calls `profileTx` for Token `transfer_to_private` from account A (`profileMode: "gates"`).
  2. `executeAztecProfileTx` (`view-executor.ts:403-407`) passes `scopes: [A, ...additional]`.
  3. `PxeService.profileTx` (`service.ts:621-623`) drops the sender.
  4. Private execution asks for the tag sender, gets `None`, and the call rejects.
- **Refined fix:** in `service.ts:621-623` add `senderForTags: scopes[0]` to the options, using the sibling's `AztecAddress.schema` parse. Copy the `:480-490` invariant comment reference rather than a new one.
- **Test to add:** a `PxeService.profileTx` unit test with a fake PXE asserting the options passed include `senderForTags` equal to `scopes[0]`, next to the existing proveTx/simulateTx pins. Optionally one real-PXE case behind the existing skip-env pattern.
- **Effort:** S.
- **Final confidence:** high.
- **ELI5:** A dApp asking the wallet to profile a normal private token transfer gets an error instead of gate counts.

## B-04 — partially confirmed

- **Own counter-example (before reading the finding):** `drainBalanceOutbox` captures `profile` once (`incoming-transfer/service.ts:2230`), then per row takes the service lock whose `isCurrent()` ticket only flips on lock-handoff, never on a profile or lock change (`:265-267`, `:2259-2274`). `TokenBalanceService.onActiveProfileChanged` clears `this.tokens` synchronously (`token-balance/service.ts:461`) and only refills after `await getTokensRaw` (`:466-472`). In that window `requestBalanceRefresh` finds no token (`:238-247`), returns `{missing:true}`, and the drain deletes the only durable marker. I could construct it, but only for a lock or a profile activation landing inside the drain's async gap.
- **Compared with the finding:** mechanism matches exactly, and the drain also runs every tick (`:1065`, `:1307`) and at init (`:357`). Mitigations the finding under-weights: (a) the drain only has work when an unanchored outbox row exists, which is a short-lived state between a receipt and the next tick; (b) the window is a few async storage reads (ms); (c) the balance is not gone, only stale: a popup refresh (holdings, home and token pages call the refresh) and any subsequent tx settle (`token-balance/service.ts:614-620`) re-project it. No `(BUG PIN)` covers it. The explicit `{missing:true}` doc ("verified absence") is indeed violated by an empty map.
- **Severity:** Minor (finding says Major). Real data-loss of a marker, but rare timing and self-healing on the next user-visible refresh. It would be Major only if the init drain can regularly race `onActiveProfileChanged` after unlock; I found no evidence the order makes that common, since init drains before any profile is active (returns at `:2232`).
- **Tightened counter-example:**
  1. Receipt raises A's balance; an unanchored outbox row is written.
  2. A poll tick runs `drainBalanceOutbox` (`:1307`): `getActiveProfile()` returns A, `listOutbox()` is awaiting.
  3. User locks (or a second window activates another profile). `TokenBalanceService` clears `tokens` (`:461`).
  4. `drainOutboxRow` runs `requestRefreshOrKeep` (`:2296`); `requestBalanceRefresh` returns `{missing:true}` (`:244`).
  5. `isCurrent()` is still true, so the row is deleted (`:2274`). The balance stays stale until a popup refresh or the next tx.
- **Refined fix:** smallest safe change is on the producer side: make `requestBalanceRefresh` return a retryable result (or throw, which `requestRefreshOrKeep` already maps to "keep") when `this.profile` is unset or the token map is mid-rebuild (compare `profileGeneration`). The transient-throw path (`requestRefreshOrKeep`) already does the right thing for throws. Optionally also re-check `(await getActiveProfile())?.id === profileId` just before the delete.
- **Test to add:** in `token-balance/service.test.ts`, after `onActiveProfileChanged(undefined)` (tokens cleared) `requestBalanceRefresh` must not return `{missing:true}` for a pair that exists in storage. Plus an incoming-transfer test that an outbox row survives a drain interleaved with a lock.
- **Effort:** S.
- **Final confidence:** moderate.
- **ELI5:** If your wallet locks at the exact moment it is about to refresh a just-received balance, it forgets to refresh and shows the old balance until you pull-to-refresh or send something.

## B-05 — partially confirmed

- **Own counter-example (before reading the finding):** `full.vue` fetches key material for the explicit `appStore.profile.id` (`:193`), then `assembleFullBackup` calls each slice `client.backup()` with no profile argument (`:295`; `full-backup-helpers.ts:137-142`). Services resolve the active profile at call time (`account/service.ts:748-750` `requireActiveProfile`). The only fence is the `generation` counter, bumped only in `onBeforeUnmount` (`:416`). A lock event routes the popup to auth (`locked-state.ts` `land`) and unmounts the page, so a plain lock is safe. A switch needs `SessionManager.open(B)` to replace the live session with no lock event first: `open` explicitly supports replacing (`session-manager.ts:323-335`), and `app.vue:198-218` handles a non-null profile event by only re-bootstrapping (no route change). Path: a second window creates or restores profile B (PBKDF2, seconds) while window 1's assembly is in progress.
- **Compared with the finding:** mechanism matches. I agree with the coordinator that likelihood is low (two windows, one window finishing a creation or unlock within the span of the later slices, e.g. account-state PXE reads). I could not construct a single-window path, and the lock-then-unlock-B variant is protected in practice because the lock event unmounts the page long before B's KDF finishes. The finding's "unlocks" wording slightly overstates it; "creates or restores B" is the realistic trigger. Nothing is lost from the live wallet; damage is a latent bad backup, and a keyless imported account row is dropped at restore (`account/service.ts:842,852`).
- **Severity:** Minor (finding: Major). Silent, integrity-relevant, but needs a rare cross-window timing and is latent. Keep Major only if the owner weights backup correctness above likelihood.
- **Tightened counter-example:**
  1. Window 1 runs Export full backup for A; `exportBackupMaterial(A)` returns (`full.vue:193`). Slices start (`:295`).
  2. Window 2 (Settings → add profile, or restore) finishes `open(B)`; `onChange` emits `onActiveProfileChanged(B)`; window 1's `app.vue:198` re-bootstraps, no unmount, `generation` unchanged.
  3. Remaining slices run `requireActiveProfile` and return B's rows; `onSlice` (`gen === generation`, `:296`) stays true.
  4. The checksum is valid; the filename (`:375`) reads B's name while the key material is A's.
- **Refined fix:** capture `appStore.profile.id` at start and extend the probe to `gen === generation && appStore.profile?.id === startId` (also capture the filename at start); this is one line at `:296` and makes the run abort with `AssemblyAbortedError`. The stronger service-side fix (pass the id to each `backup()`) is not needed for the realistic case. The same fence shape exists at `gen` checks elsewhere in the file.
- **Test to add:** a `full-backup-helpers.test.ts` (or component test) that flips the active profile id between two fake slices and asserts `assembleFullBackup` rejects with `AssemblyAbortedError` and no `payloadCompact` is published.
- **Effort:** S.
- **Final confidence:** moderate (high on mechanism, low on likelihood).
- **ELI5:** If you export a backup in one window while creating or restoring another profile in a second window, the file you download can silently mix the two profiles' data.
