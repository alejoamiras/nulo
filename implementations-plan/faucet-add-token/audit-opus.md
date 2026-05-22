# Opus adversarial audit — `faucet-add-token` plan

Model: Opus 4.7 via Agent subagent (general-purpose). Date: 2026-05-22.
Prompt: the plan at `implementations-plan/faucet-add-token/plan.md` with explicit adversarial-review instructions and a six-category breakdown (technical, attacker, trust, least-privilege, deprecation scope, UX). Subagent had read access to the repo and was instructed to verify claims against the code rather than speculate.

## Verdict

The plan is well-organized but the popup-confirmation defense-in-depth case is **fiction as currently shaped** — `register_token` does NOT trigger a popup over the wallet-sdk path because the dispatcher bypasses `DappInteractionService` for non-`sendTx` methods, AND even if it didn't, the access-level / confirmation-level check fails (`AppState=1 >= Transactions=5` is false). This invalidates the entire §8 threat model and is the central defect.

Three BLOCKERs, six HIGHs, seven MEDIUMs, four NITs.

## BLOCKERs

**B1 — `register_token` does NOT fire a popup over the wallet-sdk path.**
The plan asserts (§3 D5, §8.2) that every `registerToken` call shows the OperationCard.
- `WalletSdkDispatcher.dispatch()` (`packages/wallet-bridge/src/dispatcher.ts:243-252`) calls `executionService.executeOperations(...)` directly for everything except `sendTx`, `requestCapabilities`, `getAccounts`, `batch`.
- The popup is gated by `dappInteractionService.execute()` → `isConfirmationNeeded` (`packages/extension/src/wallet/services/dapp-interaction/service.ts:345-364`), which checks `accessLevel >= payload.session.confirmationLevel`.
- Sessions are seeded with `confirmationLevel: AccessLevel.Transactions` at `wallet-sdk/background.ts:400` (value 5); `register_token` is `AccessLevel.AppState` (value 1). Even if the dispatcher *did* route through `DappInteractionService`, `1 >= 5` is false.
- Defense collapses: a dApp that holds `accounts` cap can spray tokens silently.

**Fix options (Opus suggested):**
- (a) Route `register_token` through `dappInteractionService.execute()` in the dispatcher, mirroring `handleSendTx` (line 386).
- (b) Special-case `register_token` in `executionService.executeRegisterToken` to open the popup itself before `tokenService.addToken`.
- (c) Keep silent + add a `canRegisterToken: false` default to `accounts` cap that the faucet must request.

**B2 — Recon claim about extension-side schema validation is wrong.**
The plan §2 says "Extension `BackgroundConnectionHandler` Also validates `message.type` against `WalletSchema` and rejects unknown types." Per the upstream source (`extension/handlers/background_connection_handler.ts:330-331`), `BackgroundConnectionHandler.handleEncryptedMessage` just decrypts + dispatches — no schema check. The extension's schema patch is therefore NOT required for routing; the dispatcher already accepts by string name. The extension patch is still useful for SDK parity (popup test harnesses, any `ExtensionWallet.create()` consumers inside the extension), but the §3 D3 reasoning is wrong.

**B3 — `BatchedMethodSchema` is built from `WalletMethodSchemas`, not `WalletSchema`.**
Per `@aztec/aztec.js@4.2.0/dest/wallet/wallet.js:330`: `WalletSchema = { ...WalletMethodSchemas, batch: ... }`. The runtime patch mutates `WalletSchema` but does NOT add `registerToken` to `WalletMethodSchemas`, which means `wallet.batch([{ name: "registerToken", ... }])` Zod-rejects on the dApp side. Document this AND add a test that asserts batch rejection, so future "batch all-the-things" attempts fail loudly.

## HIGHs

**H1** — Playground `(wallet as any).registerToken(...)` cast (§5.16) bypasses `noExplicitAny`. Use the same typed `Wallet & { registerToken(...): Promise<void> }` cast as the faucet composable.

**H2** — `executeRegisterToken` is NOT DoS-safe. Each call hits `parseTokenInterface` (PXE round-trip) AND writes a `token_import` journal entry (`token/service.ts:133`) BEFORE the idempotency check at line 149. A malicious dApp can flood `registerToken(account, RANDOM_ADDR)` → unbounded PXE traffic + journal growth. Idempotency only helps for re-adds of the same address, not new junk. Mitigation: short-circuit before journal writes if `findToken(profileId, chainId, contract)` succeeds (already-known); add a soft rate-limit (e.g. drop attempts after N pending PXE parses for the same session).

**H3** — `Requested by <origin>` rendering is attacker-controlled. Origin pinning during ECDH means the string IS the connected origin, but the display can be `https://usdc.faucet-evil.com`. Render host only AND ensure visual treatment doesn't make the origin look like a token name. Filed text-truncation polish or it becomes a phishing surface.

**H4** — Token name/symbol displayed in the popup are attacker-controlled. §8.3 risks-accepted is too weak — this is the #1 phishing surface for `wallet_watchAsset`-style RPCs on every major wallet. Elevate to a named follow-up plan with explicit acceptance criteria for name-collision detection, not a roadmap bullet.

**H5** — Faucet composable's `4001 = rejected` mapping (§5.4) doesn't cover the case where the dispatcher returns "Unsupported wallet method" (e.g. patched on the dApp but not on the extension yet, or schema not applied in time). User would see a hard error. Add a test + `unsupported` status branch.

**H6** — No new deps added — document this explicitly in §10 with respect to the 7-day age policy.

## MEDIUMs

**M1** — Don't delete `simulate_views` branches from `materialize.ts` (line 91, 94) and `dapp-interaction/service.ts:291, 388` — they're dead for the wallet-sdk path but alive for the legacy `dapp-interaction` popup path (older dApps). Only drop `get_complete_address` from those files.

**M2** — Keep `OperationCard.vue:234` `simulate_views` template — same reasoning as M1.

**M3** — Contract test design needs adjustment. §7.1 says "assert on shape, not by importing the production copies" — but constructing an equivalent Zod entry IS a 4th copy. Better: have the test import the extension's `nulo-schema-patch.ts` (workspace import) and assert `WalletSchema.registerToken.parameters().items.length === 2` after import. Faucet + playground copies drift-tested by e2e roundtrip.

**M4** — Per-(profileId, chainId) scoping correct, but missing edge case: `parseTokenInterface(networkId, ...)` could return a `chainId` from the wallet's mismatched network if the dApp's chain isn't in the wallet's registry. Add a test: registerToken for chain-X token while session is on chain-Y → should refuse rather than register under wrong chain.

**M5** — E2E parallel-safety for the faucet dev server (§7.2 step 3). The plan optimistically says "the suite supports per-worktree dev ports" — verify before adding the spec. If not, hardcoding `localhost:5173` collides between parallel worktree agents.

**M6** — Verify no jest/vitest snapshot of `dispatcher.test.ts` contains `get_complete_address`. If yes, regenerate.

**M7** — Dispatcher contract test should pin BOTH `getRequiredCapability("registerToken") === "accounts"` AND `getOperationAccessLevel("register_token") === AccessLevel.AppState`. Without the access-level pin, a refactor that drops it from `getOperationAccessLevel` silently degrades the popup gate (once B1 is fixed).

## NITs

**N1** — `useFaucetAddToken` status union should include `"unsupported"` to distinguish dispatcher rejection from network errors.

**N2** — §5.6 wording "FIRST import" is too strict — the only ordering constraint is patch < first `ExtensionWallet.create()` call. Soften.

**N3** — §5.18 docs should also explicitly say `getCompleteAddress` and `simulateViews` were dropped, not just that `registerToken` was restored, so future contributors don't reintroduce them.

**N4** — §7.3 "smoke only" — no smoke gates touch the schema patch. Note explicitly.

## ADOPT (Opus's list)

- Fix B1 (popup gate for `register_token`) by routing through `dappInteractionService.execute()` OR opening the popup inside `executeRegisterToken`. Without this, §8 is fiction.
- Fix B2: correct recon table on `BackgroundConnectionHandler` schema validation; extension patch is for proxy parity, not routing.
- Add DoS mitigation for unbounded `registerToken(account, RANDOM_ADDR)` calls (H2): short-circuit `parseTokenInterface` + journal write when the contract is already known.
- Tighten playground caller with a typed cast (H1) — drop the `as any` escape hatch.
- Pin both capability and `AccessLevel` for `register_token` in dispatcher contract tests (M7).
- Keep `simulate_views` branches in `materialize.ts` + `validateSession` + `OperationCard.vue` (M1, M2). Only drop `get_complete_address`.
- Track "token name/symbol phishing detection" as a named follow-up plan, not a "risk accepted" bullet (H4).
- Document "no new deps" explicitly w.r.t. 7-day age gate (H6).
- Confirm e2e parallel-safety for the faucet dev server (M5) before adding the network spec.

## REJECT (Opus's list)

- A new `canRegisterToken` sub-permission on `AccountsCapability` (suggested in B1 fix option (c)). Don't change `wallet-bridge`'s public capability shape for one method; the popup-per-call gate is the better gate.
- A 4th "shared Zod entry" helper to dedupe the patch across three copies (M3 alternative). D1 is correct; just be honest in the test about what's verified vs. trusted.
- Hiding the "Add to wallet" button after `ok` (UX micro-tuning). Plan §5.5 already justifies keeping it visible; keep that decision.
