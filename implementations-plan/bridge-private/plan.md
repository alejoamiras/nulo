# Bridge — private L1↔L2 flows

Branch: `feat/bridge-private` (off dev's `5470839`, the merged public bridge).
Goal: add the PRIVATE deposit + withdraw paths to the faucet bridge, testnet-validated, faucet quality. Reuse the proven public infra (the `claim_*.simulate()` sync-gate, the in-flight dedup, the persisted recovery, the proven-epoch wait); add only the private contract calls, the bearer-secret seal, and the public/private toggles.

## Why private differs (load-bearing facts)
- Private deposit content hash = `get_mint_to_private_content_hash(amount)` — **amount only, no recipient** (`packages/bridge-aztec/token_bridge/src/main.nr:114`). So the claim secret is a **bearer credential**: whoever holds `secret` + `leafIndex` can `claim_private` to their own address.
- Therefore the private claim secret MUST be sealed at rest (`packages/bridge-core/src/recovery-crypto.ts`: `recoveryKeyFromSignature` → `sealSecret` / `openSecret`), and the UI must warn before any export. Never log it.
- Private balance is `balance_of_private` (a `#[external("utility")]` — read via `executeUtility`, not `.simulate()`).
- The combined manifest already scopes `claim_private` / `exit_to_l1_private` / `burn_private` (sim + tx) — verify in PV4.

## Phases (status = source of truth)
- **PV1 — private deposit** 🔄 — `useDeposit` gains an `isPrivate` mode: L1 `depositToAztecPrivate(amount, secretHash)` (no recipient) → `claim_private`; seal the secret on persist; confirm credit via `balance_of_private`. `DepositCard` public/private toggle.
- **PV2 — private withdraw** ⬜ — `useWithdraw` gains an `isPrivate` mode: `burn_private` auth-wit → `exit_to_l1_private`; the proving→consume tail is identical to public. `WithdrawCard` toggle.
- **PV3 — seal + bearer warning** ⬜ — wire `recovery-crypto` into the private deposit's persist/resume; add the bearer-credential UI warning; minimize the plaintext-secret window.
- **PV4 — scopes + tests** ⬜ — verify the manifest private scopes; capabilities + component tests; `bun run audit:vue`.
- **PV5 — gates** ⬜ — `/code-review max --fix` → codex post-impl audit → address high/critical → stop.

## Security & adversarial
- Bearer secret: sealed at rest; UI warns before export; never logged (the public-flow resume-log leak is already fixed on dev).
- Deterministic-signature reliance for the seal key (RFC-6979). Non-deterministic wallets → unrecoverable seal → stranded private claim on refresh. Surface a clear failure; consider a fallback. (codex this in PV3.)
- Recipient-commitment alternative (bind recipient into the content hash, hidden on L1) is structurally stronger but a **contract change** (bridge-aztec + re-deploy + re-audit) — deferred; sealing is the MVP path.

## Manual-test handoff (the loop can't prove these headless)
Private deposit/withdraw need real Aztec + Rabby signatures and a private-note claim. The loop implements + unit/integration-tests each path, then STOPS that thread with a `NEEDS MANUAL TEST: <action + expected>` note — never fakes a pass.

## Seeds
`/loop 20m` driving prompt — created in the chat that scaffolded this plan; re-paste it to resume the arc.
