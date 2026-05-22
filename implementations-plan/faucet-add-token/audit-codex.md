# Codex adversarial audit — `faucet-add-token` plan

Model: GPT-5.x via `codex exec` (xhigh reasoning). Date: 2026-05-22.
Session ID: `019e5105-390b-7662-8c4e-ef989238a79d` (CODEX_DIR: `/var/folders/p9/5vbplm5s6p5bjy78gdqnh0500000gn/T/codex-zP0XMztb`).
Verbatim response copied below.

## Verdict

> This is not shippable as written. The two core claims the plan relies on, "popup-confirmed" and "per-account," are both false in the current code.

Codex independently arrived at Opus's B1 (popup gate is fiction) AND surfaced a NEW BLOCKER (B2): the feature is NOT per-account in the current code. Five HIGHs + one MEDIUM round out the findings.

## Findings

### BLOCKERs

**B1 (consensus with Opus)** — `registerToken` will not show a confirmation popup if you only patch `WalletSchema`. `WalletSdkDispatcher.dispatch()` sends every non-`sendTx` method straight to `executionService.executeOperations()` (`packages/wallet-bridge/src/dispatcher.ts:238-252`); only `sendTx` goes through `DappInteractionService.execute()` (`packages/wallet-bridge/src/dispatcher.ts:341-389`, `packages/extension/src/wallet/services/dapp-interaction/service.ts:140-147`). So `getOperationAccessLevel("register_token") = AppState` does nothing for this path today. The security claims at `plan.md:295`, `389-390`, `422` are wrong unless `registerToken` is rerouted.

**B2 (NEW — Codex only)** — The feature is NOT per-account, and the requested account is NOT authoritative.
- Dispatcher ignores the dApp-supplied account and uses the first session-authorized account from `resolveNetworkAndAccount()` when building `register_token` (`packages/wallet-bridge/src/dispatcher.ts:658-660, 764-767, 833-847`).
- Token dedupe is only `(profileId, chainId, contract)` (`packages/extension/src/wallet/services/token/service.ts:149-159, 474-476`).
- `onTokenAdded()` creates balances for EVERY account on that chain (`packages/extension/src/wallet/services/token-balance/service.ts:170-175`).
- UI is account-filtered only at render time (`packages/extension/src/popup/components/modules/general/TokensView.vue:223-227`).
- The plan's user story says "per-account, per-chain"; the code says "profile+chain watchlist, then fan out."

### HIGHs

**H1** — Cancel/error handling in the plan is internally inconsistent. The plan branches on `normalized.code === 4001` (`plan.md:188-192`), but `NormalizedError` has no `code` field — only `category`, `message`, `raw` (`packages/faucet/src/lib/errors.ts:21-25`). The existing helper already normalizes user rejection via `code===4001` or message matching (`errors.ts:54-60`).

**H2** — E2E plan does NOT fit the current harness.
- Network suite only includes `tests/e2e/network/**/*.test.ts` (`packages/extension/vitest.e2e.network.config.ts:10-13`), but plan places the new test at `packages/extension/tests/e2e/faucet-add-token.test.ts`.
- Global setup only allocates/spawns anvil + aztec + playground (`tests/e2e/README.md:25-30`, `tests/e2e/global-setup.ts:33-39,336-379`). Shared helper only injects `playgroundUrl` (`tests/e2e/fixtures/playground.ts:15-33`).
- Faucet dev server is hard-pinned to `5176` with `strictPort: true` (`packages/faucet/vite.config.ts:12-18`). Plan's claim "already supports per-worktree dev ports" is FALSE.
- Faucet's own e2e is jsdom mock-based, not browser automation (`packages/faucet/tests/e2e/README.md:11-24`, `tests/e2e/faucet-smoke.test.ts:1-14,45-47`).

**H3** — Deprecation scope is INCOMPLETE. Beyond dispatcher / capability-map / scope-enforcement, also:
- `packages/wallet-bridge/src/dapp-interaction-protocol.ts:42-72,124-146` — `GetCompleteAddressRequest`, `SimulateViewsRequest` request union exports
- `packages/extension/src/wallet/services/dapp-interaction/spec.ts:11-39` — re-exports
- `packages/extension/src/wallet/services/execution/models/index.ts:33-58` — re-exports
- `packages/wallet-bridge/src/scope-enforcement.test.ts:212-224` — tests still reference
- `packages/extension/src/popup/windows/execute/humanize.test.ts:28-36` — humanize tests reference
- `packages/playground/README.md:55` — doc reference
- `packages/playground/src/sections/meta.ts:1-6`, `simulation.ts:1-8` — leading comments

Verified by Codex: `simulate_views` still has internal callers at `balance-projector.ts:121-127` and `execution/service.ts:1509-1521, 1537-1549`. **NO** equivalent internal caller for `get_complete_address`.

**H4** — Schema patch / drift-test design is too weak. The guard only checks key presence (`plan.md:116-125`), not signature; if upstream ships a different `registerToken`, the patch becomes a silent no-op. The proposed shape-only contract test that does NOT import the three actual patch files (`plan.md:331-333`) can't catch a missing side-effect import or a drifted copy. It proves a hypothetical shape, not production reachability.

**H5** — Phishing and auditability defenses are overstated.
- The popup card currently shows ONLY the contract address (`OperationCard.vue:193-197`); name/symbol fetched AFTER approval in `executeRegisterToken()` (`execution/service.ts:1043-1050`). "User saw the address" is a weak anti-phishing story.
- `TokenImportRow` only renders in-flight or recently failed imports — disappears on success (`TokenImportRow.vue:4-11`, `TokensView.vue:37-40,51-62`). The "Requested by <origin>" trail isn't durable post-success, even though the subtitle is set (`token/service.ts:136-142`).
- The acceptance/security claims at `plan.md:391-392, 421` overstate what the UI actually preserves.

### MEDIUMs

**M1** — Playground patch should go next to `packages/playground/src/lib/wallet.ts` (the module that directly imports `WalletManager`), not `main.ts`. The plan currently points to `main.ts`.

**M2** — `zod` should be declared as a direct dep in `faucet/package.json` and `playground/package.json` if those packages import it (it's transitive today via `@aztec/aztec.js`).

(Codex explicitly rated the "WalletSchema-read-too-early" race risk as LOW — the runtime SDK entrypoints in this repo are narrow.)

## ADOPT (Codex's distilled list)

1. Reroute `registerToken` through `DappInteractionService.execute()` (or an equivalent popup path) before shipping anything.
2. Decide the real scoping model: either make token registration truly account-specific, OR change the product copy/tests to "profile+chain" and remove the fake account arg.
3. Replace the shape-only schema test with production reachability tests against the real patch files and real entrypoints.
4. Move the playground patch next to `packages/playground/src/lib/wallet.ts`, not just the app entrypoint.
5. Fix cancel handling to key off normalized rejection category / parsed 4001, and make `rejected` actually return to idle.
6. Treat "show resolved token metadata before Allow/Deny" as **near-term security work, not low-priority polish**.

## REJECT (Codex's distilled list)

- Don't add "trusted session can skip the popup" for `registerToken`; once popup routing is fixed, per-call confirmation is doing real work.
- Don't split out a new `tokens` capability in this PR unless you want a much wider permissions redesign.
- Don't bump storage version for this; no storage-schema change justifies it.
- Don't chase a theoretical schema-read race; import reachability and popup routing are the real failures.
