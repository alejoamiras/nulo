# Phase 6 — retry once on the unregistered-contract code, around single pre-submission calls

**Status:** ✓ arc-2 gate green — `bun run typecheck:all` 0 · `bun run test:tools` 1458/1458 · `bun run lint` 0 · `bun run build:tools` 0 · `bun run e2e:tools` **69 passed (0 failed), playwright exit 0**.

## Gate (also the arc-2 gate, as written)
| Command | Result |
|---|---|
| `bun run typecheck:all` | exit 0 (all four workspaces) |
| `bun run test:tools` | 102 files, **1458** tests, 0 fail |
| `bun run lint` | exit 0 (32 warnings / 5 infos pre-existing, complexity-baseline OK) |
| `bun run build:tools` | exit 0 |
| `bun run e2e:tools` | **69 passed (54.3m), playwright exit 0** — the whole tools browser suite, one sandbox, run solo |

## What shipped
- **`useWalletConnection.ts`** — `retryOnUnregistered(session, wallet, op)`: run `op`; on a throw whose `walletErrorCodeOf(e) !== "CONTRACT_NOT_REGISTERED"` rethrow (the STRUCTURED code only, never the substring category); before re-registering, if `session.wallet.value !== wallet` rethrow the original (the op outlived its session); `await session.reregisterContracts()` → `false` rethrows the original; re-check `session.wallet.value === wallet` again before the retry; run `op` once more; a second throw of any kind propagates untouched. Structural `RetrySession` param so a mock session satisfies it.
- **Four wrapped pre-submission single calls** (each completes no submission before it can raise the code): `createAuthWit` for the private burn witness and both `preflightHubExit` simulates in `useHubExit.ts` (via a `session` field added to `ExitCtx`); the `executeUtility` balance read in `useTokenBalance.ts`; the drip `sendTx` in `useDrip.ts`; the fuel-claim `simulateTx` in `fuelClaim.ts` — threaded as an OPTIONAL `retry` dep (`FuelClaimRetry`, identity default) so `fuelClaim` stays singleton-free, bound by the caller (`useSend.ts` `buildHubClaim`/`probeHubClaim` and the `claim` dep, through `deposit-flow.ts` `buildFeeJuiceClaimDep`).
- **Deliberately NOT wrapped** (multi-transaction workflows; wrapping would replay completed legs): the hub claim and the public-exit workflow. They keep the Phase 5 eager gate + the named error only.
- **Display seams** — `sendFailureCopy` (`useSend.ts`) and a new `exitFailureCopy` (`useHubExit.ts`) run `normalizeError` and, for `contract-not-registered`/`chain-desync`, show that category's copy; everything else keeps today's path (a confirmation-window timeout translated, unknowns passed through).

## Tests
- `useWalletConnection.test.ts`: 7 `retryOnUnregistered` branch cases (ok / unrelated error / substring-without-code no-retry / code→reregister→ok / reregister-false→original / code-twice→second propagates, op called exactly twice / session-replaced-mid-flight→original, no reregister).
- `useSend.test.ts` + `useHubExit.test.ts`: the two envelope categories render their copy at the display seams; an ordinary plumbing failure keeps today's humanized copy. Node-env files reproduce the readiness predicate inline and pass through `retryOnUnregistered`.
- `registration-retry.spec.ts` (browser): case 1 lazy retry (a faulted drip `sendTx` re-registers once — `registerContract` delta > 0 — and resends — `sendTx` delta 2 — landing at `data-drip-status="ok"`); case 2 setup-pending (a drip during a held quiet re-grant is refused with the SETUP_PENDING copy and `sendTx` delta 0, then proceeds on release).

## Dead ends / lessons
- **Fresh-worktree blocker**: `bun run e2e:tools` first died at `sandbox:up` — a fresh worktree lacks `contracts/bridge/evm/lib` (gitignored forge deps, not carried by `.worktreeinclude`). Fixed by copying the pinned libs from the canonical clone. Recorded in memory (recurs for any worktree e2e:tools run). A transient `[aztec] Address already in use` during boot is a red herring (the sandbox retries).
- **Browser case 2 took four tries to stabilise.** Two wrong observables: (1) `sendGrantPending` cleared before the re-check when holding `registerContract`, and the deposit proceeded because a pre-granted token (`usdc`) short-circuits `ensureGranted` — no re-grant fires. (2) A single post-release recovery drip raced the resumed deposit for the wallet and stuck at `error`. The working shape: a FRESH (guaranteed-ungranted) token so confirming its deposit drives a real re-grant; hold `requestCapabilities` (retryCapabilities clears `contractsReady` before awaiting it, so the whole held window is connected-but-not-ready and `status` stays `"connected"` → SETUP_PENDING, not the not-connected message); wait for the held call by its `walletCalls().requestCapabilities` count delta rather than any transient UI state; and re-issue the recovery drip in a `toPass` loop (idle/refused → re-click, dripping → wait) until it lands.
- No new complexity acceptances; `retryOnUnregistered`'s catch stays well under cognitive-15.

## Codex loop
Recorded in [`post-impl-arc-2.md`](../lessons/post-impl-arc-2.md) (arc-2 boundary) and the cross-arc pass note.
