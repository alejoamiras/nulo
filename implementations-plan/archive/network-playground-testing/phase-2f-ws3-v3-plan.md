# Plan v3.1 — Fee Methods via Pre-Funded Account Import (WS3 RESURRECTED, post-audit)

> Status: **APPROVED MENTAL MODEL, awaiting user approval on v3.1 corrections**. Codex `xhigh` + Claude general-purpose audits both confirmed Q1 (mint feasibility) GREEN. Both flagged W3.2 implementation details needing correction; v3.1 incorporates all H/M-priority fixes. Codex called it "major W3.2 rework"; Claude called it "greenlight with 3 H edits" — same substance, different framing.

## v3.0 → v3.1 delta (audit-driven)

| Area | v3.0 (wrong) | v3.1 (corrected) | Source |
|---|---|---|---|
| chainId for Local | "Read PXE chainId via `pxe.getNodeInfo().l1ChainId` (or `rollupVersion` — TBD)" | **Hardcoded `0`** for Local Network (`network/service.ts:85`); other networks use `(l1ChainId ^ rollupVersion) >>> 0` (`:281-289`) | Both audits |
| SDK API for script wallet | `getSchnorrAccount(pxe, secret, signingKey, salt)` | **Stale.** Use `SchnorrAccountContract` + `getSchnorrAccountContractAddress` OR call `NuloAccount.new(...)` directly to mirror Nulo's path | Codex |
| Script wallet deployment | (omitted) | **Add explicit deploy step**: `account.getDeployMethod().send({ fee: { paymentMethod: sponsoredFee } }).wait()` before any claim/mint | Both audits |
| `mint` send | `await fpc.withWallet(scriptWallet).methods.mint(amount, Fr.zero(), leafIndex).send()` | **Add `additionalScopes: [fpc.address]`** per canonical `private.test.ts:103-105` | Codex |
| Public FJ funding | "Bridge + claim from script wallet" | **Reuse existing Nulo helper** (`fixtures/aztec.ts:228-241`). Public claim is recipient-bound, sender-agnostic — no need for same-secret wallet. Same-secret ONLY needed for private `mint` | Codex |
| Bridge salt / instance salt | Both implied as `Fr.zero()` | **Bridge salt = `Fr.random()`** per fixture invocation (avoid nullifier collision on retries); **Instance salt = `Fr.ZERO`** for `registerPrivateContract` (matches Nulo's auto-discovery) | Claude |
| Account auto-creation timing | "importPlain creates account synchronously" | **Wrong.** `importPlain` only opens the profile session. Popup's `onActiveProfileChanged → initNetworks → initAccount` creates first account on **default Testnet**. Switching to Local creates SECOND account on chainId 0. Plan's "switch after import" works, but must wait for `nulo:ui:activeAccount` watcher to settle on Local-chain account | Both audits |
| Test deps | (assumed available) | **Add `viem` + `@aztec/l1-artifacts`** to `packages/extension/package.json` test deps (used by `bridgeForMint` port) | Codex |
| Manual checkpoint | (open question) | **YES, do it first.** 30-min Node script: derive `accountAddress` + paste masterBase64 into dev extension on Local + compare. Catches encoding drift before fixture work | Claude |

---

## User's mental model — verified canonical (BOTH audits)

**Q1 GREEN.** From `aztec-fee-payment/src/nr/private_contract/src/main.nr:135-165`: `mint` binds proof to `claimer = self.msg_sender()` and reconstructs FeeJuice nullifier from claimer. From `private.test.ts:76-111` canonical success: `bridgeForMint(..., alice, ...)` binds secret to `alice` → `FeeJuice.claim(...).send({ from: alice })` → `fpc.mint(...).send({ from: alice, additionalScopes: [fpc.address] })` succeeds.

The "wrong-claimer reverts" test at `private.test.ts:213-242` is Bob calling Alice's claim — irrelevant when script's wallet IS Alice (same secret as eventual import).

---

## Architectural recon — fee strategies (unchanged from v3.0)

4 registered strategies. `fjwc` reachable only from dApp `embedded` paths via `wallet-bridge` (`detectEmbeddedFeePayment` at `fee-detection.ts:8-12`, strategy map at `execution/service.ts:210-214`). `EditClaimParametersPopup.vue` is **dead UI code** — popup never opened. Worth a separate cleanup ticket; NOT blocking WS3.

---

## Goal

Re-enable both `fee-methods.test.ts` skipped cases (`:62` "transfer with public Fee Juice"; `:126` "gas balance card non-zero FeeJuice") via script-side pre-funding.

---

## WS3 — 5 sub-steps (audit-reordered)

### W3.0 — Manual derivation parity checkpoint (~30 min) — NEW

Before any L1 work, prove address derivation parity:
1. Write a throwaway Node script that:
   - Generates a random master 32-byte secret
   - Derives `account_secret = poseidon2Hash([Fr(master), Fr(0), Fr(AccountType.Nulo_v1), Fr(0)])` — `chainId = 0` literal for Local
   - Calls `NuloAccount.new(account_secret, logger)` — get the address (mirrors `account/service.ts:106-117`)
   - Logs `accountAddress` + `masterBase64`
2. Run it with `bun run`
3. Open dev Chrome with the extension (HEADLESS=0, fresh profile), navigate to `#/popup/import`
4. Manually paste `masterBase64` into private-key field, set password, submit
5. Switch to Local Network in popup
6. Read the popup's account address (header)
7. **Assert equal to step 1's `accountAddress`.** If not equal: fix derivation before proceeding.

This 30-min check prevents 2-3 hr of debugging if any encoding diverges (Fr vs number, byte order, etc.).

### W3.1 — Add testids to `import.vue` (~30 min)

`import.vue` uses `selectedImportOption` ('private_key' | 'seed' | 'public_key' | 'passkey') with SettingItem rows, NOT tabs. Updated testid naming (Claude correction):
- `import-option-private-key` — corresponds to `'private_key'`
- `import-option-seed` — for mnemonic
- `import-option-public-key` — for encrypted backup
- (passkey is direct-action, no tab needed)
- `import-name-input`
- `import-private-key-input`
- `import-password-input` + `import-password-confirm-input`
- `import-private-key-submit-btn` — disambiguated per option

Validate: rebuild + smoke (privacy/appearance) still passes.

### W3.2 — Build `setupPreFundedAccount` helper (~3-3.5 hr)

In `fixtures/aztec.ts`:

```ts
async function setupPreFundedAccount(node, l1Wallet, opts: {
  publicAmount: bigint
  privateAmount: bigint
}): Promise<{ masterBase64: string; accountAddress: AztecAddress }>
```

#### Step 1 — Derive identity (mirrors Nulo exactly)
```ts
const master = randomBytes(32)
const chainId = 0  // LITERAL — Local Network per network/service.ts:85
const account_secret = poseidon2Hash([
  Fr.fromBuffer(master), 
  new Fr(chainId), 
  new Fr(AccountType.Nulo_v1),  // = 1 per account/spec.ts:3
  new Fr(0)
])
// Use NuloAccount.new directly to get the same instance Nulo will compute post-import
const accountContract = await NuloAccount.new(account_secret, logger)
const accountAddress = accountContract.address
```

#### Step 2 — Get script-side wallet
The installed `@aztec/accounts/schnorr` exports `SchnorrAccountContract` + `getSchnorrAccountContractAddress`, NOT `getSchnorrAccount` (Codex correction). Use the contract directly:
```ts
const schnorrContract = new SchnorrAccountContract(deriveSigningKey(account_secret))
// Pass through Nulo's adapter for instance creation (already handles salt=Fr.ZERO)
// OR construct AccountManager-equivalent via SchnorrAccountContractArtifact + manual instance
const account = await AccountManager.create({
  pxe,
  secret: account_secret,
  accountContract: schnorrContract,
  salt: Fr.ZERO,
})
const scriptWallet = await account.getWallet()
```

#### Step 3 — Deploy script wallet (NEW — Codex H)
The script wallet must exist on-chain before `mint` can run. Use SponsoredFPC for the deploy fee:
```ts
const sponsoredFpc = await getSponsoredFPCInstance()  // from existing fixture infrastructure
const sponsoredFee = new SponsoredFeePaymentMethod(sponsoredFpc.address)
await account.getDeployMethod().send({ fee: { paymentMethod: sponsoredFee } }).wait()
```
Reference: `holonym-aztec-bridge/bridge-script/utils/deploy_account.ts:31-41`, `tests/e2e/fixtures/aztec.ts:118-133`.

#### Step 4 — Public FJ (REUSE existing helper, Codex M)
```ts
// Use existing Nulo bridgeFeeJuice + claimFeeJuice — they claim to a recipient,
// sender-agnostic. No need to route through scriptWallet.
const claim = await bridgeFeeJuice(node, l1Wallet, accountAddress, opts.publicAmount)
await claimFeeJuice(node, accountAddress, claim)  // existing Nulo helper
// Result: feeJuice.balance_of_public(accountAddress) > 0
```

#### Step 5 — Private FJ (PrivateFPC mint)
```ts
const fpc = await registerPrivateContract(scriptWallet, Fr.zero())  // INSTANCE salt = Fr.ZERO (matches Nulo auto-discovery)
const bridgeSalt = Fr.random()  // BRIDGE salt — random per invocation (Claude H, avoids nullifier collision on reruns)
const { secret, leafIndex } = await bridgeForMint(  // ported from @wonderland/test/harness.ts:179-297
  node, l1Wallet, fpc.address, accountAddress, bridgeSalt, opts.privateAmount
)
// Claim — sender doesn't matter for FJ.claim, but use scriptWallet for consistency
await feeJuice.withWallet(scriptWallet).methods.claim(fpc.address, opts.privateAmount, secret, leafIndex).send().wait()
// Mint — MUST be from scriptWallet (msg_sender == accountAddress == claimer)
await fpc.withWallet(scriptWallet).methods.mint(opts.privateAmount, bridgeSalt, leafIndex)
  .send({ additionalScopes: [fpc.address] })  // Codex H — canonical pattern from private.test.ts:103-105
  .wait()
// Assert balance landed before fixture returns
const privateBal = await fpc.withWallet(scriptWallet).methods.balance_of(accountAddress).simulate()
if (privateBal.result <= 0n) throw new Error("PrivateFPC mint did not credit balance")
```

#### Step 6 — Return
```ts
return { 
  masterBase64: Buffer.from(master).toString("base64"),  // 32 raw bytes → base64 (profile/service.ts:490)
  accountAddress,
}
```

### W3.3 — Build `feeJuiceImportedExtension` fixture (~45-60 min)

```ts
feeJuiceImportedExtension: ExtensionContext & { accountAddress: string }
```

Steps:
1. Run `setupPreFundedAccount(...)` → `{ masterBase64, accountAddress }`
2. `launchExtension` (fresh browser)
3. Open popup → navigate to `#/popup/import`
4. Click `import-option-private-key`
5. Fill name, private key (`masterBase64`), password, password confirm via testids
6. Click `import-private-key-submit-btn`
7. Wait for `/popup/general` redirect — popup creates account on **default Testnet** here (audit caught this)
8. Call `switchToLocalNetwork(page)` — popup's network watcher creates SECOND account on chainId 0
9. **Wait for `nulo:ui:activeAccount` watcher to settle** on Local-chain account address (Codex M):
   ```ts
   await page.waitForFunction(
     (expected) => {
       const accountText = document.querySelector('[data-testid="account-address"]')?.textContent
       return accountText?.includes(expected.slice(0, 10))  // partial match — header may truncate
     },
     { timeout: 15_000, polling: 500 },
     accountAddress.toString()
   )
   ```
10. **Assert** `getAccountAddress(page) === accountAddress.toString()` — runtime derivation parity check (also caught at W3.0 manual checkpoint)
11. Trigger + verify `getGasBalances` for both kinds (`gas-balance-private` only renders if `privateFormatted !== null` per `GasBalanceCard.vue:121`):
    ```ts
    await page.waitForFunction(
      () => {
        const pub = document.querySelector('[data-testid="gas-balance-public"]')?.textContent
        const priv = document.querySelector('[data-testid="gas-balance-private"]')?.textContent
        return pub && !pub.includes("0 FJ") && priv && !priv.includes("0 FJ")
      },
      { timeout: 60_000, polling: 2_000 },
    )
    ```
12. Return `{ ...ctx, accountAddress: accountAddress.toString() }`

### W3.4 — Wire fee-methods tests (~15 min)

- `fee-methods.test.ts:62` "transfer with public Fee Juice" — fixture swap: `feeJuiceReadyExtension` → `feeJuiceImportedExtension`
- `fee-methods.test.ts:126` "gas balance card non-zero FeeJuice" — same swap; private FJ assertion now valid (script set it up)
- Convert both `test.skip` → `test.skipIf(!hasConfig)`
- Run targeted

---

## Order of execution within WS3 (audit-reordered)

**W3.0 → W3.1 → W3.2 → W3.3 → W3.4**

W3.0 (manual checkpoint) FIRST — catches derivation issues in 30 min before sinking hours into the fixture.

---

## Risks (revised v3.1)

| Risk | Severity | Mitigation |
|---|---|---|
| Address derivation parity | LOW (was HIGH) | W3.0 manual checkpoint catches it |
| chainId encoding (Fr vs number) | LOW | Hardcoded `0`; `poseidon2Hash` accepts both |
| `bridgeForMint` port complexity | MEDIUM | Self-contained per audits; copy verbatim from `harness.ts:179-297` |
| Network switch + activeAccount timing race | MEDIUM | Explicit poll on Local-chain address visibility |
| `viem` + `@aztec/l1-artifacts` not in extension's package.json | LOW | Add as test deps; or rely on transitive deps if already present |
| Smoke regression from import.vue testid additions | LOW | Toggle.vue precedent — additive testids didn't regress |
| Nullifier collision on test reruns | LOW | Random `bridgeSalt` per invocation |
| `gas-balance-private` not rendering when `privateFormatted === null` | LOW | Poll for non-zero text; if balance is 0, mint failed → fail test loudly |

---

## Estimate (revised v3.1)

- **W3.0 manual checkpoint**: 30 min
- **W3.1 testids**: 30 min
- **W3.2 setupPreFundedAccount**: 3-3.5 hr (chainId fix + SDK API fix + account deploy + additionalScopes + salt split + public FJ reuse + bridgeForMint port)
- **W3.3 fixture**: 45-60 min (network-switch wait + assertions)
- **W3.4 test wiring**: 15 min
- **Total: 4.5-5.5 hr realistic, 6-7 hr worst case**

---

## Out-of-scope notes

- **Private cold-start fee strategy** (`pfjwc` parallel to `fjwc`): real product gap, NOT needed here — script does setup. Tracked at `~/.claude/.../memory/project_private_cold_start_gap.md`.
- **`fjwc` UI cleanup**: `EditClaimParametersPopup.vue` is dead UI code (popup never opened anywhere). Worth a tiny separate ticket; NOT blocking.
- **Holonym reference**: confirms public FJ + generic FPC patterns. NOT applicable to PrivateFPC mint (different architecture). Cite `@wonderland`'s own `private.test.ts` as canonical reference.

---

## Open questions — RESOLVED

1. **Mint feasibility** — GREEN. Script wallet IS the claimer if same secret.
2. **chainId source** — `0` for Local, `(l1ChainId ^ rollupVersion) >>> 0` for others.
3. **Account auto-creation** — popup creates on default Testnet first, then on Local after switch. Plan's "switch after import" works with explicit watcher wait.
4. **`bridgeForMint` portability** — self-contained, port verbatim, ensure viem + l1-artifacts deps.
5. **Holonym comparison** — different architecture (generic FPC + bananaCoin); not authoritative for PrivateFPC.
6. **`fjwc` reachability** — only from dApp `embedded` paths; `EditClaimParametersPopup.vue` is dead.
7. **Manual checkpoint** — yes, do it first (W3.0).
8. **Cross-PXE** — no problem; both PXEs register independently on demand.

---

## Decision points for user

- [ ] **Approve v3.1?** All H/M-priority audit edits incorporated. Estimate revised to 4.5-5.5 hr.
- [ ] **Order**: W3.0 → W3.1 → W3.2 → W3.3 → W3.4. OK?
- [ ] **W3.0 manual checkpoint** approach — Node script + dev Chrome compare. Note: needs YOU to do step 4-7 manually (paste secret + observe extension). 5-10 min of your time. OK?
- [ ] **PR strategy**: 1 PR for whole WS3? Or split (W3.1 testids as separate, W3.2-W3.4 as fixture+tests)? My default: **1 PR** — they're tightly coupled (testids exist to drive the fixture's import flow).

If approved, I'll proceed: W3.0 (parity check — coordinate with you for the manual paste step), W3.1 (testids), W3.2 (heavy lifting), W3.3 (fixture), W3.4 (test wiring), validate, push, PR.

---

**End of plan v3.1. Awaiting final approval.**
