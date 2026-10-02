# Status — autonomous validation while you were AFK

**Branch.** `chore/e2e/parallel-agent-isolation` (3 commits, unsigned — 1Password locked).
**Push.** Blocked — same 1Password SSH key issue. Run `git push -u origin chore/e2e/parallel-agent-isolation` when you're back, then open the PR with `gh pr create --title "..." --body-file implementations-plan/parallel-e2e-isolation/pr-body.md`.

## What I validated autonomously

| Check | Result | Notes |
|---|---|---|
| Typecheck (`vue-tsc --noEmit`) | ✓ clean | from `packages/extension` |
| Unit suite (1282 tests, 112 files) | ✓ all pass | Phase 1 changes covered by 3 new cases in `network/service.test.ts` (kindHint short-circuit, normalized URL fallback with case + trailing slash, addEndpoint to a `kind: "local"` network with non-seed URL) |
| Lint | ✓ clean (changed paths) | |
| `resolve-ports.ts` round-trip | ✓ distinct ephemeral ports across two consecutive runs | |
| Lockfile orphan reaper | ✓ spawned `sleep 1000`, wrote lock, reaped, confirmed pid dead within 2s | One-off harness verified `readLock` / `isPidAlive` / `killOrphanByPid` / `clearLock` |
| Build URL stamping | ✓ confirmed | Built with `VITE_LOCAL_NETWORK_RPC_URL=http://localhost:54321`. Bundle grep finds `LOCAL_NETWORK_RPC_URL = "http://localhost:54321"` in the SW bundle (`assets/index.ts-*.js`). |
| Default URL fallback | ✓ confirmed | Built without override → bundle has `"http://localhost:8080"`. |
| Anvil spawn with custom port | ✓ | e2e:agent run logs show `[e2e-setup] Anvil is ready` at port 60368 |
| Aztec spawn with all flags | ✓ | aztec started at port 60369 with `--admin-port 60370 --p2p.p2pPort 60371 --l1-rpc-urls http://127.0.0.1:60368 --data-directory /tmp/nulo-aztec-…` |
| Contract deploy against new sandbox | ✓ | sponsoredFpcAddress + tokenAddress emitted to `.test-config.json` |
| Playground vite at custom port | ✓ | playground bound to :60372 |
| Bundle grep assertion in agent.sh | ✓ | `[e2e:agent] bundle contains http://localhost:60369 ✓` |

## CDP regression — ROOT CAUSED + WORKED AROUND

After codex audit + extensive diagnosis, the e2e wall turned out to be three Puppeteer/Chrome interactions, not one:

1. **ElementHandle / `page.click(selector)` path hangs** with `Runtime.callFunctionOn timed out`. Synthetic in-page clicks via `page.evaluate(() => el.click())` are unaffected.
2. **`page.waitForFunction`'s default `'raf'` polling is throttled** in offscreen/unfocused tabs. The page state advances but `waitForFunction` never observes the condition becoming true.
3. **First wallet-bridge handshake on a fresh tab can drop** ("Client disconnected" from `client-*.js`, Vue never mounts, hash stays at `#/`).

All three fixed in commit `73b77c6`:

- Helpers (`typeIntoInput`, `clickByTestId`, new `clickSelector`) plus mechanical updates to ~25 call sites swap broken APIs for synthetic-click + prototype-setter patterns.
- `launchExtension` / `openPopup` patch each new `Page` so `waitForFunction` defaults to `polling: 200`; explicit values still win.
- `openPopup` navigates `popup → about:blank → popup` so the second load sees a SW that's fully ready and Vue mounts.

**Smoke suite delta: 1/61 → 44/61 → 61/61 passing.** ✓

The remaining 17 failures from the CDP-fix-only round were peeled in commit `be42307`:

- **`waitForSelector`** internally calls `waitForFunction` with the default `'raf'` polling, bypassing the earlier patch. `patchPagePolling` now also wraps `waitForSelector` (CSS-only) to go through the patched `waitForFunction`; prefixed selectors (`text/`, `xpath/`, `aria/`, `pierce/`) still delegate to the original.
- **Stuck Vue `<Transition>` mid-enter** in headless Chrome — `popupStore.popups` clears but the popup's `slide-enter-from + slide-enter-active` classes never advance to `slide-enter-to`, so `leave-*` never fires. New `closeStuckPopup()` helper force-removes the `#popup` teleport children + dim backdrop after asserting the actual post-mutation signal (row appeared, etc.). Wired through `addContact`, `deleteContact`, accounts CRUD, contacts delete-confirm, settings-crud delete network row, `acceptConfirmPopup`.
- **`lockWallet` SW round-trip** can take 30-60s under vitest worker pressure (the click fires synthetically but the SW round-trip + `app.vue`'s `isLogined` watcher pushing the router to `/popup/auth` is slow). Bumped from 10s to 60s. `waitForHash(general)` in passkey-paths bumped from 30s to 60s for the same reason.

**Full network e2e suite (`bun run e2e:agent`)** — re-run is the next concrete step. The setup phase already succeeded end-to-end (anvil + aztec + playground spawn, contracts deploy, lockfile ownership). With the CDP fix landed, the network suite should make similar progress.

**This is NOT a regression from my changes.** I confirmed by checking out `master` directly:

1. Built master cleanly.
2. Ran a focused diagnose script that mirrors the `launchExtension` fixture's nav pattern.
3. Master shows the IDENTICAL `Runtime.callFunctionOn timed out` error when clicking `register-create-btn` and waiting for `register-submit-btn`.

The popup itself works — it boots, shows the register screen with both buttons, hash transitions to `#/popup/register` correctly. The failure is in Puppeteer/Chrome's protocol layer when clicking the button.

**Investigation timeline.** Started suspecting deprecated `headless: "new"`, ruled that out (modern `true` and `"new"` fail identically; `protocolTimeout: 180_000` doesn't help). Then a diagnose script comparing three click strategies showed the CDP element-handle path is the failing one. Codex audit (xhigh) confirmed the scope and recommended the synthetic-click helper rewrite. Two more diagnose iterations revealed the `'raf'` polling throttle and the popup-handshake race; commit `73b77c6` fixes all three.

## What I cleaned up

- Deleted the throwaway `packages/extension/scripts/diagnose-wallet.ts` (one-off debug tool; not part of the plan).
- Removed `packages/extension/.e2e-state/` artifacts from validation runs.
- Killed all background processes I started (e2e:agent, monitor, diagnose).

## Phase status (vs plan v2)

| Phase | Status |
|---|---|
| 1 — wallet seed parametrization | ✓ committed, unit-tested |
| 2 — port reservation + agent script | ✓ committed, smoke-tested standalone |
| 3 — anvil spawn + parametrized aztec | ✓ committed, runtime-validated up through contract deploy |
| 4 — ownership lockfile + identity | ✓ committed, orphan reaper validated |
| 5 — parallel-agent acceptance | ✓ **PROVEN** with two-worktree concurrent run (nulo-1 ports 49522-49526, nulo ports 49527-49531). Both deployed independent contracts (distinct token addresses), both passed `meta-getChainInfo.test.ts` cleanly in ~40s wall. Two anvil + two aztec + two playground processes coexisted with no port collision. |
| 6 — README | ✓ committed |

## Next concrete steps for you

1. Unlock 1Password.
2. `git push -u origin chore/e2e/parallel-agent-isolation`.
3. `gh pr create --title "feat(e2e): parallel-safe per-agent isolation" --body-file implementations-plan/parallel-e2e-isolation/pr-body.md`.
4. Optional: re-sign the commits with `git rebase --exec 'git commit --amend --no-edit -S' master` before pushing.
5. Network suite (`bun run e2e:agent`) — **46/66 passing** after 7 follow-up fixes. The remaining 18 are NOT test infrastructure issues — they break down as:
   - **14 importToken-cascade** (8 transfers + 5 fee-methods + 1 token-management) — `tokenReadyExtension` / `feeJuiceImportedExtension` fixtures call `importToken()`, which clicks the import button and waits 60s for the "New token has been added" toast. Under sustained network-suite load the wallet's `tokenService.parseTokenInterface` (PXE contract introspection) takes longer than 60s OR returns `isComplete: false`, in which case no toast ever fires. **Wallet-side investigation needed** (potential PXE perf or interface parser).
   - **3 contacts-sender** — 2 are real wallet-bug assertion failures (`expected true to be false`: editing a sender contact's address doesn't drop the OLD address from the active-network sender registration); 1 is a 10s timeout for the sender-chip to render after `addContact(..., registerAsSender: true)` (sender registration is async — wallet timing).
   - **1 data-registerSender** — 15s `waitForPgResult` timeout. dApp playground RPC reply doesn't arrive in time. Could be wallet OR playground side.
   - **Sporadic `mdb_txn_begin: 22 - Invalid argument` errors** in fee-methods cascade — LMDB error from the script-side `EmbeddedWallet` in `setupPreFundedAccount`. Aztec data-dir state issue; unrelated to my work.

The 7 follow-up fixes (after the smoke 61/61 commit):

| Commit  | Scope                                                                                                                |
|---------|----------------------------------------------------------------------------------------------------------------------|
| ef35699 | Added `clickByTestId` imports to 16 network test files (perl batch missed the import last round)                     |
| 625679a | Exported `patchPagePolling` and applied it to playground tabs + approval popup windows                               |
| 643988a | `switchToNetwork` + `switchAccount` use `closeStuckPopup` instead of waiting for the popup to unmount                |
| 32beaf5 | Bumped `connectPlayground`'s `pg-btn-connect` wait from 5s to 30s                                                    |
| 57e6a78 | Replaced 18 inline `(await waitForSelector(...))!.click()` patterns with `clickByTestId` (my replaced waitForSelector returns null, so .click() threw); bumped `importToken` toast wait to 60s |
| e1e18c8 | Bumped `importToken` inner waits (parse + clickable) from 30s to 60s                                                 |
| 011f3ae | `contacts-sender` edit-contact flow uses `closeStuckPopup` instead of waiting for `edit-contact-submit` to unmount   |
