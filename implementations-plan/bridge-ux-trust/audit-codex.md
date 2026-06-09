# Codex audit transcript — bridge-ux-trust

## Round 0 — independent plan draft (session 019eae00, xhigh, read-only)

**Independent Plan**

Recommendation: do this in storage/security-first order. The current bridge UI is split across `DepositCard` and `WithdrawCard` in `BridgeView` ([packages/faucet/src/views/BridgeView.vue:20-27](packages/faucet/src/views/BridgeView.vue:20)), but the real risk sits underneath: single-slot localStorage, global in-flight flags, and balance-based completion in `useDeposit` / `useWithdraw` ([packages/faucet/src/composables/useDeposit.ts:49-83](packages/faucet/src/composables/useDeposit.ts:49), [packages/faucet/src/composables/useDeposit.ts:184-191](packages/faucet/src/composables/useDeposit.ts:184), [packages/faucet/src/composables/useDeposit.ts:236-245](packages/faucet/src/composables/useDeposit.ts:236), [packages/faucet/src/composables/useWithdraw.ts:31-60](packages/faucet/src/composables/useWithdraw.ts:31)). I would not build the unified form on top of those primitives.

**Target Design**

**Storage schema**
Use the existing pure bridge-core recovery layer as the canonical journal surface, not ad-hoc JSON in the faucet. `bridge-core` already has injected `KV` storage and two array-backed keys (`DEPOSITS_KEY`, `WITHDRAWALS_KEY`) ([packages/bridge-core/src/recovery.ts:17-24](packages/bridge-core/src/recovery.ts:17), [packages/bridge-core/src/recovery.ts:72-88](packages/bridge-core/src/recovery.ts:72)).

Proposed persisted types:

```ts
type BridgeJournalRecord = DepositJournalRecord | WithdrawJournalRecord

interface BaseJournalRecord {
  schemaVersion: 2
  id: string
  amount: string
  isPrivate: boolean
  chainId: number
  portalAddress: string
  bridgeAddress: string
  l1TokenAddress: string
  l2TokenAddress: string
  createdAt: number
  updatedAt: number
  migratedFromLegacy?: boolean
}

interface DepositJournalRecord extends BaseJournalRecord {
  kind: "deposit"
  id: string // secretHashHex
  stage: "depositing" | "syncing" | "claimable" | "claiming" | "done"
  l1Address: string
  recipient: string
  secretHashHex: string
  depositTxHash?: string
  leafIndex?: string
  claimTxHash?: string
  publicSecret?: string
  privateRecovery?: {
    mode: "prepared" | "finalized" | "legacy-unauthenticated"
    blob: string
  }
}

interface WithdrawJournalRecord extends BaseJournalRecord {
  kind: "withdraw"
  id: string // exitTxHash
  stage: "exiting" | "proving" | "consumable" | "consuming" | "done"
  l1Address: string
  l2Address: string
  recipientL1: string
  exitTxHash: string
  exitBlock?: number
  consumeTxHash?: string
}
```

Authenticated private envelope design:
- `prepared` blob is sealed before the irreversible L1 deposit and contains `secretHex + recipient + amount + l1Address`.
- `finalized` blob is re-sealed after the deposit receipt lands and contains `secretHex + recipient + amount + leafIndex + depositTxHash + l1Address`.
- Claim path opens the blob and verifies `recipient`, `amount`, and `leafIndex` against the outer record before sending `claim_private`.
- This uses AES-GCM authenticity from `EncryptionKey.encrypt/decrypt` ([packages/wallet-crypto/src/encryption-key.ts:34-46](packages/wallet-crypto/src/encryption-key.ts:34), [packages/wallet-crypto/src/encryption-key.ts:54-69](packages/wallet-crypto/src/encryption-key.ts:54)); I would bind the metadata by sealing the payload, not by inventing a second MAC format.

Done-record handling:
- On confirmed claim/consume success, scrub `publicSecret` / `privateRecovery.blob` immediately.
- Keep a sanitized `done` record until explicit `Discard`, so the journal has a visible terminal state without retaining the bearer secret.

Seal self-test cache:
- New key: `nulo-bridge-seal-cache:v1`
- Shape: `{ [addressLower]: { chainId: 11155111, verifiedAt: number, messageVersion: 1 } }`
- Positive verdicts only. Do not persist permanent negatives.
- Invalidate on cache-version bump, chain mismatch, or any later `openRecordSecret` failure.
- If a cached “deterministic” wallet later fails unseal, clear the cache entry, leave the bridge record pending, and fail closed with guidance to reconnect the original Ethereum wallet/account.

In-memory only:
- `autoContinueIds: Set<string>` for bridges initiated in the current page session.
- `recordRunLocks: Set<string>` for per-record dedup.
- `walletPromptQueue` (one L1 prompt lane, one Aztec prompt lane) so prompt-free polling can run concurrently but promptful actions do not stack on the user. Current code uses global `claimInFlight` / `consumeInFlight` booleans because there is only one record today ([packages/faucet/src/composables/useDeposit.ts:104-105](packages/faucet/src/composables/useDeposit.ts:104), [packages/faucet/src/composables/useWithdraw.ts:85-87](packages/faucet/src/composables/useWithdraw.ts:85)); that must become per-record plus per-wallet serialization.

**UI tree**
Keep:
- `L1WalletPanel.vue`
- `BridgeWalletPanel.vue`
- `BridgeAddToken.vue`

Delete:
- `DepositCard.vue`
- `WithdrawCard.vue`
- `DepositCard.test.ts`
- `WithdrawCard.test.ts`

Add:
- `BridgeForm.vue`
- `BridgeJournal.vue`
- `BridgeJournalCard.vue`
- `useBridgeJournal.ts`
- `useL1TokenBalance.ts`
- `useL1UsdcMint.ts`
- `BridgeForm.test.ts`
- `BridgeJournal.test.ts`
- `useDeposit.test.ts`
- `useWithdraw.test.ts`

Form behavior:
- One direction toggle: `Ethereum (Sepolia) -> Aztec` / `Aztec -> Ethereum`
- One amount input
- One Aztec privacy toggle that switches the Aztec side between public/private balances
- Live balances on both sides
- Separate secondary action: `Get test USDC on Sepolia (L1)`
- Primary action: `Bridge to Aztec` or `Bridge to Ethereum`
- Status/progress lives on journal cards, not duplicated in the form

Recommended testids to add in `packages/faucet/src/lib/testids.ts` (current bridge ids are still split deposit/withdraw: [packages/faucet/src/lib/testids.ts:66-93](packages/faucet/src/lib/testids.ts:66)):
- `bridgeForm`
- `bridgeDirectionL1ToL2`
- `bridgeDirectionL2ToL1`
- `bridgeFlip`
- `bridgeAmount`
- `bridgeFromBalance`
- `bridgeToBalance`
- `bridgePrivacyPublic`
- `bridgePrivacyPrivate`
- `bridgeMintL1Usdc`
- `bridgeSubmit`
- `bridgeJournal`
- `bridgeJournalCard(id)`
- `bridgeJournalStage(id)`
- `bridgeJournalAction(id)`
- `bridgeJournalDiscard(id)`
- `bridgeJournalPrivacy(id)`
- `bridgeJournalAmount(id)`
- `bridgeJournalDirection(id)`

Copy direction:
- The faucet tab already says it mints fixed USDC/ETH into Aztec public/private balances ([packages/faucet/src/views/FaucetView.vue:25-29](packages/faucet/src/views/FaucetView.vue:25)).
- `BridgeAddToken` already explains the bridged USDC is a separate token from the faucet’s token ([packages/faucet/src/components/BridgeAddToken.vue:9-10](packages/faucet/src/components/BridgeAddToken.vue:9), [packages/faucet/src/components/BridgeAddToken.vue:53-67](packages/faucet/src/components/BridgeAddToken.vue:53)).
- The new L1 mint CTA should therefore say exactly that it mints Sepolia USDC to the Ethereum wallet and is not the Faucet tab’s L2 drip.

Suggested private deposit copy:
- Cache miss: `Private to Aztec uses a sealed bearer recovery secret. This Ethereum wallet will sign twice this first time only. Later private bridges from this wallet on this browser sign once.`
- Cache hit: `Recovery already verified for this Ethereum wallet on this browser. Private bridge will sign once to seal the claim secret.`
- Restored private records after refresh: `Stored details are re-verified when you claim.`

**Phase 0 — Baseline / branch point**
Files:
- none, but branch from `dev` only after PR #78 merges

Plan:
- Rebase after PR #78 and re-read any conflicts in `BridgeView.vue`, `useDeposit.ts`, `useWithdraw.ts`, `testids.ts`, and `bridge-deployments.ts`.
- Capture current passing baseline before touching storage.

Validation:
- `bun run --cwd packages/bridge-core typecheck`
- `bun run --cwd packages/bridge-core test`
- `bun run --cwd packages/faucet typecheck`
- `bun run --cwd packages/faucet test`

Smallest proof:
- Green baseline only.

NEEDS-MANUAL-TEST:
- none

**Phase 1 — Journal, envelope, seal-cache foundation**
Files:
- `packages/bridge-core/src/recovery.ts`
- `packages/bridge-core/src/recovery.test.ts`
- `packages/bridge-core/src/recovery-crypto.ts`
- `packages/bridge-core/src/recovery-crypto.test.ts`
- `packages/bridge-core/src/index.ts`
- `packages/faucet/src/composables/useBridgeJournal.ts` (new)
- `packages/faucet/src/composables/useBridgeJournal.test.ts` (new)

Plan:
- Upgrade `recovery.ts` from “array of records” into the canonical versioned journal schema with helpers for `upsert`, `patch`, `remove`, `scrubSecrets`, and migration metadata.
- Extend `recovery-crypto.ts` beyond `sealRecordSecret` / `openRecordSecret`. Today `sealRecordSecret` signs the same per-record message twice for seal + self-test ([packages/bridge-core/src/recovery-crypto.ts:70-84](packages/bridge-core/src/recovery-crypto.ts:70)). Split it into:
  - deterministic signer self-test prep
  - payload sealing/opening
  - prepared/finalized private envelope helpers
- Add pure seal-cache helpers.
- Add faucet-side `useBridgeJournal.ts` as the only place that touches browser storage and migrates the legacy faucet keys.

Validation:
- `bun run --cwd packages/bridge-core typecheck`
- `bun run --cwd packages/bridge-core test`
- `bun run --cwd packages/faucet typecheck`
- `bun run --cwd packages/faucet test`

Smallest proof:
- `recovery-crypto.test.ts`: tampering outer `recipient` / `amount` / `leafIndex` against a finalized private blob fails verification.
- `recovery-crypto.test.ts`: cache helpers write/read/invalidate correctly.
- `recovery.test.ts`: multiple deposit records keyed by `secretHashHex` coexist; multiple withdraw records keyed by `exitTxHash` coexist.
- `useBridgeJournal.test.ts`: migrates one legacy deposit + one legacy withdraw into journal arrays.

NEEDS-MANUAL-TEST:
- none

**Phase 2 — Flow rewrite on top of the journal**
Files:
- `packages/faucet/src/composables/useDeposit.ts`
- `packages/faucet/src/composables/useWithdraw.ts`
- `packages/faucet/src/composables/useDeposit.test.ts` (new)
- `packages/faucet/src/composables/useWithdraw.test.ts` (new)
- optional shared helper if needed: `packages/faucet/src/composables/useBridgeFlow.ts`

Plan:
- Remove direct `PENDING_KEY` logic from both composables. Today both still hand-roll single-record localStorage ([packages/faucet/src/composables/useDeposit.ts:49-83](packages/faucet/src/composables/useDeposit.ts:49), [packages/faucet/src/composables/useWithdraw.ts:31-60](packages/faucet/src/composables/useWithdraw.ts:31)).
- Remove the “block second deposit” guard in `useDeposit` ([packages/faucet/src/composables/useDeposit.ts:264-269](packages/faucet/src/composables/useDeposit.ts:264)); allow multiple pending records, isolated by `secretHashHex`.
- Persist `depositTxHash` as soon as the portal tx hash exists, then finalize the private blob after the receipt yields `leafIndex`.
- Persist `claimTxHash` after `claim_*` send, and use the Aztec tx receipt’s success status to decide completion. Do not use aggregate balance deltas anymore; the current `preBalance + amount` clear path is exactly the fragile surface ([packages/faucet/src/composables/useDeposit.ts:184-191](packages/faucet/src/composables/useDeposit.ts:184), [packages/faucet/src/composables/useDeposit.ts:230-245](packages/faucet/src/composables/useDeposit.ts:230)).
- Persist `consumeTxHash` per withdraw record and keep the current “wait existing tx instead of re-sending” recovery behavior, but keyed by `exitTxHash` instead of a singleton ([packages/faucet/src/composables/useWithdraw.ts:112-126](packages/faucet/src/composables/useWithdraw.ts:112), [packages/faucet/src/composables/useWithdraw.ts:179-181](packages/faucet/src/composables/useWithdraw.ts:179)).
- Keep the current sync/proving mechanics intact:
  - deposit gate stays `claim_*.simulate()` polling with the existing public/private revert regex ([packages/faucet/src/composables/useDeposit.ts:97-117](packages/faucet/src/composables/useDeposit.ts:97), [packages/faucet/src/composables/useDeposit.ts:201-223](packages/faucet/src/composables/useDeposit.ts:201))
  - withdraw stays `waitForProven -> getTxEffect -> computeL2ToL1MembershipWitness -> portal.withdraw` ([packages/faucet/src/composables/useWithdraw.ts:130-182](packages/faucet/src/composables/useWithdraw.ts:130))
- Change auto-resume rules:
  - same-page-session records can auto-continue through prompt-free and promptful stages
  - rehydrated records never auto-send `claim_*` or L1 `withdraw`
  - rehydrated records expose explicit `Claim` / `Finish` / `Discard`
- Account mismatch refusal on private claim stays, but it must compare against authenticated recipient from the unsealed blob, not just raw localStorage. The current mismatch refusal is correct in intent but trusts the stored `recipient` field ([packages/faucet/src/composables/useDeposit.ts:372-378](packages/faucet/src/composables/useDeposit.ts:372)).
- Scrub logging. Current bridge composables are intentionally verbose (`console.log` wrappers at [packages/faucet/src/composables/useDeposit.ts:20-21](packages/faucet/src/composables/useDeposit.ts:20), [packages/faucet/src/composables/useWithdraw.ts:25-26](packages/faucet/src/composables/useWithdraw.ts:25)) and `useDeposit` still logs a redacted-but-still-sensitive pending object on resume ([packages/faucet/src/composables/useDeposit.ts:380-382](packages/faucet/src/composables/useDeposit.ts:380)). Switch to record IDs, stages, and tx hashes only.

Validation:
- `bun run --cwd packages/bridge-core test`
- `bun run --cwd packages/faucet typecheck`
- `bun run --cwd packages/faucet test`
- `bun run lint`

Smallest proof:
- `useDeposit.test.ts`: two deposits can coexist; starting B does not overwrite A.
- `useDeposit.test.ts`: tampered outer `recipient` / `amount` / `leafIndex` on a private record is detected before `claim_private`.
- `useDeposit.test.ts`: unrelated balance increase does not clear a record anymore.
- `useDeposit.test.ts`: rehydrated record does not auto-claim; same-session record does.
- `useDeposit.test.ts`: cached determinism skips the second seal signature on the second private deposit.
- `useWithdraw.test.ts`: two withdraws coexist; `consumeTxHash` recovery remains per-record.
- `useWithdraw.test.ts`: rehydrated withdraw does not auto-consume.
- `useWithdraw.test.ts`: `consumeTxHash` success drives completion, not any balance heuristic.

NEEDS-MANUAL-TEST:
- none required yet if the tx/send boundaries stay mocked

**Phase 3 — Unified bridge form + multi-card journal UI**
Files:
- `packages/faucet/src/views/BridgeView.vue`
- `packages/faucet/src/components/BridgeForm.vue` (new)
- `packages/faucet/src/components/BridgeJournal.vue` (new)
- `packages/faucet/src/components/BridgeJournalCard.vue` (new)
- `packages/faucet/src/components/DepositCard.vue` (delete)
- `packages/faucet/src/components/WithdrawCard.vue` (delete)
- `packages/faucet/src/components/BridgeForm.test.ts` (new)
- `packages/faucet/src/components/BridgeJournal.test.ts` (new)
- `packages/faucet/src/lib/testids.ts`
- `packages/faucet/src/composables/useL1TokenBalance.ts` (new)
- `packages/faucet/src/composables/useL1UsdcMint.ts` (new)
- maybe light copy tweak in `BridgeAddToken.vue`

Plan:
- Replace `DepositCard` + `WithdrawCard` with one `BridgeForm`.
- Reuse existing Aztec balance plumbing from `useTokenBalance`, which already reads `balance_of_public` through `simulate` and `balance_of_private` through `executeUtility` ([packages/faucet/src/composables/useTokenBalance.ts:19-27](packages/faucet/src/composables/useTokenBalance.ts:19), [packages/faucet/src/composables/useTokenBalance.ts:117-137](packages/faucet/src/composables/useTokenBalance.ts:117)).
- Add an L1 ERC-20 balance composable using `useL1Wallet().publicClient`; `publicClient` already exists on the canonical viem singleton ([packages/faucet/src/composables/useL1Wallet.ts:20](packages/faucet/src/composables/useL1Wallet.ts:20), [packages/faucet/src/composables/useL1Wallet.ts:97-111](packages/faucet/src/composables/useL1Wallet.ts:97)).
- Split “get Sepolia USDC” out of deposit. Today `deposit()` mints, approves, then deposits ([packages/faucet/src/composables/useDeposit.ts:302-345](packages/faucet/src/composables/useDeposit.ts:302)); after this phase, `deposit()` becomes approve+deposit only, and mint moves to the explicit secondary CTA.
- Direction flip swaps side labels and which balance sits on the “from” side.
- Privacy toggle changes only the Aztec side semantics:
  - L1 -> L2: `depositToAztecPrivate` / `claim_private`
  - L2 -> L1: `burn_private` / `exit_to_l1_private`
  The private/public paths are already wired in the composables ([packages/faucet/src/composables/useDeposit.ts:331-334](packages/faucet/src/composables/useDeposit.ts:331), [packages/faucet/src/composables/useWithdraw.ts:220-233](packages/faucet/src/composables/useWithdraw.ts:220)).
- Journal cards render newest-first and show:
  - direction
  - amount
  - privacy
  - current stage
  - explicit action button
- No manifest change expected. The shared Aztec session already grants bridge claim/exit/burn and bridge-token balance scopes ([packages/faucet/src/composables/useBridgeWallet.ts:1-8](packages/faucet/src/composables/useBridgeWallet.ts:1), [packages/faucet/src/lib/capabilities.ts:191-258](packages/faucet/src/lib/capabilities.ts:191)).

Validation:
- `bun run --cwd packages/faucet typecheck`
- `bun run --cwd packages/faucet test`
- `bun run --cwd packages/faucet build`
- `bun run lint`

Smallest proof:
- `BridgeForm.test.ts`: direction flip swaps labels, balances, and submit copy.
- `BridgeForm.test.ts`: private deposit copy shows “sign twice this first time only” on cache miss and “sign once” on cache hit.
- `BridgeForm.test.ts`: withdraw-private copy says no recovery secret is needed.
- `BridgeForm.test.ts`: `Get test USDC on Sepolia (L1)` copy is distinct from the faucet’s L2 drip language.
- `BridgeJournal.test.ts`: multiple records render concurrently with stable testids.
- `BridgeJournal.test.ts`: `Finish` / `Claim` / `Discard` resolve correctly by stage.

NEEDS-MANUAL-TEST:
- Real-wallet UX pass on desktop and mobile.
- First-ever private deposit copy + prompt count.
- Second private deposit from the same L1 address/browser profile shows one seal signature, not two.
- Reload mid-sync on a private deposit does not auto-claim on refresh.
- Reload mid-proving on a withdraw does not auto-consume on refresh.

**Phase 4 — Bridge e2e smoke + final regression**
Files:
- `packages/faucet/tests/e2e/bridge-smoke.test.ts` (new)
- `packages/faucet/tests/e2e/README.md`
- optional README/docs cleanup if desired

Plan:
- Add a bridge-tab jsdom smoke alongside the faucet smoke. The existing e2e harness is mock-wallet jsdom only; it does not cover bridge today ([packages/faucet/tests/e2e/README.md:9-14](packages/faucet/tests/e2e/README.md:9), [packages/faucet/tests/e2e/faucet-smoke.test.ts:1-14](packages/faucet/tests/e2e/faucet-smoke.test.ts:1)).
- Cover the selector contract and the non-auto-resume behavior under mocked persisted journal records.
- Final full regression.

Validation:
- `bun run --cwd packages/faucet test:e2e`
- `bun run --cwd packages/faucet typecheck`
- `bun run --cwd packages/faucet test`
- `bun run lint`
- `bun run audit:faucet`
- `bun run audit:vue`

Note on commands:
- `packages/faucet/package.json` has `typecheck`, `test`, `test:e2e`, and `build`, but no package-local `lint` script ([packages/faucet/package.json:6-17](packages/faucet/package.json:6)).
- Root `audit:vue` is not a faucet-specific gate: root `test` and `build` point at `packages/extension`, while `audit:faucet` is the faucet-specific regression (`package.json:16-18`, `package.json:30-31`).

Smallest proof:
- `bridge-smoke.test.ts`: bridge tab shows one form, not separate deposit/withdraw cards.
- `bridge-smoke.test.ts`: mocked restored record requires explicit action, not auto-claim.
- `bridge-smoke.test.ts`: all selectors use `data-testid`.

NEEDS-MANUAL-TEST:
- Public deposit end-to-end.
- Private deposit first-time and cached-time.
- Public withdraw end-to-end.
- Private withdraw end-to-end.
- Reload during `syncing`, `claiming`, `proving`, and `consuming`.
- Legacy record migration from a browser profile that still has the old single-pending keys.

**Migration Story**
- Legacy public deposit (`nulo-bridge-pending-deposit` with `secretHashHex` and `leafIndex`): auto-migrate to a journal deposit keyed by `secretHashHex`, stage `syncing` or `claimable` depending on whether a claim tx hash exists.
- Legacy public/private deposit with `secretHashHex` but no `leafIndex`: migrate as `depositing` legacy. If there is no `depositTxHash` anchor, it is not safely recoverable; show a discard-only card with explicit copy saying this record predates tx-hash persistence.
- Legacy private deposit with `sealedSecret`: migrate as `privateRecovery.mode = "legacy-unauthenticated"`. Never auto-continue it. Allow explicit accept-and-finish only, with a warning that it predates metadata authentication.
- Legacy withdraw (`nulo-bridge-pending-withdraw`): auto-migrate to a journal withdraw keyed by `exitTxHash`; preserve `consumeTxHash`; stage `consuming` if it exists, else `proving`.
- Remove the old singleton keys only after the new journal write succeeds.
- If both new journal and old singleton keys exist, new journal wins and the old keys are ignored after one logged migration warning.

**Security & Adversarial Considerations**
- LocalStorage tamper is the direct attacker for this arc. Today a resumed private claim trusts `recipient` from storage ([packages/faucet/src/composables/useDeposit.ts:168-180](packages/faucet/src/composables/useDeposit.ts:168)); the fix is to authenticate private `recipient + amount + leafIndex` inside the sealed payload and verify before any claim send.
- The current deposit clear signal is also storage-sensitive because it destroys recovery state on `balance >= preBalance + amount` ([packages/faucet/src/composables/useDeposit.ts:184-191](packages/faucet/src/composables/useDeposit.ts:184), [packages/faucet/src/composables/useDeposit.ts:236-245](packages/faucet/src/composables/useDeposit.ts:236)). An unrelated incoming transfer can satisfy that. Completion must instead follow the specific claim/consume tx hash.
- XSS still beats at-rest sealing. If same-origin script execution is lost, the attacker can read journal state, trigger wallet prompts, or exfiltrate secrets after unseal. This plan hardens localStorage tamper and stale resume, not active XSS. The mitigation remains CSP discipline and “never log/plaintext-persist private secrets.”
- The seal-cache is a UX optimization, not a trust root. A tampered cache can suppress the extra self-test prompt and increase testnet fund-stranding risk, but it cannot redirect funds if the private envelope verification is in place. Because this is explicitly TESTNET-only, I would accept that residual DoS risk; I would not accept it on mainnet without a stronger cache proof.
- Restored private cards have a copy/phishing surface because their outer display fields are still browser storage. I would mark them visually as `unverified until claim` and only treat the unsealed envelope as authoritative.
- Multiple concurrent bridges create a prompt-flood risk. Per-record locks are not enough; promptful work must still serialize per wallet lane, or two same-session records will race two Aztec prompts or two L1 prompts into the user.
- Persist contract addresses and chain ID into each record. Private unseal already binds `chain + portal + bridge + secretHash` into the recovery-key message ([packages/bridge-core/src/recovery-crypto.ts:16-31](packages/bridge-core/src/recovery-crypto.ts:16)); public records need an explicit stale-deployment refusal path too.
- Scrub secrets on `done`. The journal can keep a visible finished card, but it should not keep any bearer-capable payload after tx confirmation.
- Copy must keep L1 and L2 verbs separate. The faucet hero is L2-drip language ([packages/faucet/src/views/FaucetView.vue:25-29](packages/faucet/src/views/FaucetView.vue:25)); the bridge mint CTA must say Sepolia/Ethereum explicitly to avoid training users to approve the wrong wallet action.

**Assumptions**

**Facts (verified)**
- The bridge tab currently mounts separate `DepositCard`, `WithdrawCard`, and `BridgeAddToken` components in `BridgeView` ([packages/faucet/src/views/BridgeView.vue:20-27](packages/faucet/src/views/BridgeView.vue:20)).
- `sealRecordSecret` signs the same recovery message twice today: once to seal, once to reopen/self-test ([packages/bridge-core/src/recovery-crypto.ts:70-84](packages/bridge-core/src/recovery-crypto.ts:70)).
- `useDeposit` stores a single pending record under `nulo-bridge-pending-deposit`, blocks a second deposit if that key exists, auto-resumes when the Aztec wallet reconnects, and clears by observing balance growth ([packages/faucet/src/composables/useDeposit.ts:49-83](packages/faucet/src/composables/useDeposit.ts:49), [packages/faucet/src/composables/useDeposit.ts:264-269](packages/faucet/src/composables/useDeposit.ts:264), [packages/faucet/src/composables/useDeposit.ts:401-410](packages/faucet/src/composables/useDeposit.ts:401)).
- `useWithdraw` stores a single pending record under `nulo-bridge-pending-withdraw`, persists `consumeTxHash`, and auto-resumes when the L1 wallet reconnects ([packages/faucet/src/composables/useWithdraw.ts:31-60](packages/faucet/src/composables/useWithdraw.ts:31), [packages/faucet/src/composables/useWithdraw.ts:179-181](packages/faucet/src/composables/useWithdraw.ts:179), [packages/faucet/src/composables/useWithdraw.ts:287-296](packages/faucet/src/composables/useWithdraw.ts:287)).
- The bridge claim sync-gate today is PXE-side `claim_*.simulate()` polling with public/private revert-wording tolerance ([packages/faucet/src/composables/useDeposit.ts:97-117](packages/faucet/src/composables/useDeposit.ts:97), [packages/faucet/src/composables/useDeposit.ts:201-223](packages/faucet/src/composables/useDeposit.ts:201)).
- The withdraw finalization today is `waitForProven -> getTxEffect -> computeL2ToL1MembershipWitness -> portal.withdraw` ([packages/faucet/src/composables/useWithdraw.ts:130-182](packages/faucet/src/composables/useWithdraw.ts:130)).
- `useTokenBalance` already has the right Aztec split: `balance_of_public` via `simulate`, `balance_of_private` via `executeUtility` ([packages/faucet/src/composables/useTokenBalance.ts:19-27](packages/faucet/src/composables/useTokenBalance.ts:19), [packages/faucet/src/composables/useTokenBalance.ts:117-137](packages/faucet/src/composables/useTokenBalance.ts:117)).
- `useL1Wallet` is already a canonical viem singleton with a shared `publicClient` for L1 reads ([packages/faucet/src/composables/useL1Wallet.ts:5-14](packages/faucet/src/composables/useL1Wallet.ts:5), [packages/faucet/src/composables/useL1Wallet.ts:20](packages/faucet/src/composables/useL1Wallet.ts:20), [packages/faucet/src/composables/useL1Wallet.ts:97-111](packages/faucet/src/composables/useL1Wallet.ts:97)).
- The Aztec bridge session is shared with the faucet session (`useBridgeWallet` re-exports `useWalletConnection`) ([packages/faucet/src/composables/useBridgeWallet.ts:1-8](packages/faucet/src/composables/useBridgeWallet.ts:1)).
- The combined capability manifest already scopes bridge token balance reads, `claim_public/private`, `exit_to_l1_public/private`, `burn_public/private`, sponsor, and auth registry txs ([packages/faucet/src/lib/capabilities.ts:191-258](packages/faucet/src/lib/capabilities.ts:191)).
- The faucet tab’s copy is explicitly L2-drip language, and `BridgeAddToken` already distinguishes bridged USDC from the faucet’s token ([packages/faucet/src/views/FaucetView.vue:25-29](packages/faucet/src/views/FaucetView.vue:25), [packages/faucet/src/components/BridgeAddToken.vue:9-10](packages/faucet/src/components/BridgeAddToken.vue:9), [packages/faucet/src/components/BridgeAddToken.vue:53-67](packages/faucet/src/components/BridgeAddToken.vue:53)).
- `App.vue` uses `v-show`, so both tabs stay mounted and in-memory state survives tab switches but not reloads ([packages/faucet/src/App.vue:45-48](packages/faucet/src/App.vue:45)).
- Current faucet package scripts expose `typecheck`, `test`, `test:e2e`, and `build`, but not `lint`; root `audit:vue` and `audit:faucet` are different gates ([packages/faucet/package.json:6-17](packages/faucet/package.json:6), [package.json:16-18](package.json:16), [package.json:22-31](package.json:22)).
- Current e2e smoke is jsdom + mock wallet only, with no real browser or live network ([packages/faucet/tests/e2e/README.md:9-14](packages/faucet/tests/e2e/README.md:9), [packages/faucet/tests/e2e/README.md:29-37](packages/faucet/tests/e2e/README.md:29)).

**Inferences (unverified, attackable)**
- `node.getTxReceipt` in the faucet layer should be enough to confirm claim success the same way it already supports withdraw proving and the extension’s tx service, but that exact claim path is not wired in the faucet yet.
- Address-only seal-cache keying is probably the practical baseline; wallet-brand fingerprinting on injected providers is too brittle to trust as a hard invalidation rule.
- Keeping restored records “manual only” after reload is the safer interpretation of `Auto-continue ONLY for a bridge initiated in the same page session`, even though some read-only polling could technically continue without prompts.
- Done cards should probably persist until explicit `Discard`; that best matches the requested visible `done` stage and explicit journal actions.

**Asks**
- Is PR #78 expected to land changes in the bridge tab files above? If yes, I would treat rebase/conflict resolution as a real Phase 0 gate.
- Do you want `done` cards to remain visible until explicit `Discard`? My recommendation is yes.
- For legacy private records created before metadata authentication, do you want “manual accept-and-finish with a loud warning” or “discard only”? My recommendation is manual accept-and-finish, because the task explicitly asks to handle legacy records.
- Do you want me to add a package-local `lint` script to `packages/faucet/package.json` so the package can be gated with `bun run --cwd packages/faucet lint` literally? My recommendation is no unless your CI expects it; root `bun run lint` already exists.

## Round 1 — contradiction-check (resumed session 019eae00)

Verdict: consolidation mostly sound; 1 BLOCKER + 2 HIGH + 1 NIT, all folded into plan.md (D2 legacy-leafIndex exception, D4 receipt-fallback, D5/P2 stale-deployment refusal, P3 L2-retention pin). L2 dispute CONCEDED in favor of retain-until-Clear.

1. **BLOCKER** — **Legacy-private migration contradicts the leafIndex trust rule.**  
   D2 says private claims resolve `leafIndex` from `envelope -> depositTxHash receipt -> never bare localStorage` ([plan.md:56](implementations-plan/bridge-ux-trust/plan.md:56)). But D5 promises legacy private records (`sealedSecret`) are still “manual accept-and-finish” ([plan.md:79](implementations-plan/bridge-ux-trust/plan.md:79)). Current legacy records have `leafIndex` but **do not persist `depositTxHash`** (`useDeposit` only stored `leafIndex`, not deposit tx hash: [packages/faucet/src/composables/useDeposit.ts:354-355](packages/faucet/src/composables/useDeposit.ts:354)). So as written, those records have no allowed leafIndex source.  
   **Fix:** either:
   - explicitly allow one-time use of legacy bare `leafIndex` under `legacy-unauthenticated` with loud warning, or
   - change A2/D5 to `discard-only unless depositTxHash exists`.

2. **HIGH** — **D4 hardcodes `DROPPED`, but Assumptions says that behavior is unverified and the fallback is not planned.**  
   D4 relies on `node.getTxReceipt` returning `dropped` for claim recovery ([plan.md:67-69](implementations-plan/bridge-ux-trust/plan.md:67)). But Assumptions immediately says this is only an inference and may throw instead ([plan.md:152](implementations-plan/bridge-ux-trust/plan.md:152)). P2’s proof list tests the `dropped` path, not the “throws/unknown forever” fallback ([plan.md:98](implementations-plan/bridge-ux-trust/plan.md:98)).  
   **Fix:** amend D4/P2 to include a concrete fallback state machine: repeated receipt-lookup failure after budget => `attention: unknown-outcome` or manual re-claimable; add a unit test for thrown/unknown receipt lookups.

3. **HIGH** — **L4 (stale-deployment refusal) made the ledger and schema, but not the phases.**  
   The ledger adopts deployment binding + stale refusal ([plan.md:127](implementations-plan/bridge-ux-trust/plan.md:127)), and the schema carries `chainId/portal/bridge` ([plan.md:23-27](implementations-plan/bridge-ux-trust/plan.md:23)). But no phase bullet or smallest-proof item actually says “compare against current deployment and block resume/claim/finish with `attention: stale`.” It is effectively ledger-only.  
   **Fix:** add a P2 implementation bullet and proof case: mismatched deployment tuple marks record `stale`, skips auto-resume watchers, and disables Claim/Finish.

4. **NIT** — **I concede L2 (retain blob until Clear) for testnet, but it needs an explicit proof pin.**  
   The retention rationale is coherent: it downgrades forged `claimTxHash` from blob-destruction to user-mediated loss ([plan.md:78](implementations-plan/bridge-ux-trust/plan.md:78), [plan.md:142](implementations-plan/bridge-ux-trust/plan.md:142)). I would **not** push scrub-on-done here.  
   **Fix:** add one P2/P3 test asserting a completed private record still retains the sealed blob until `Clear`, and that `Clear` is distinct from `Discard`.

Otherwise, the consolidation is mostly sound; the real misses are the legacy-leafIndex contradiction and the unimplemented stale-deployment / receipt-fallback paths.