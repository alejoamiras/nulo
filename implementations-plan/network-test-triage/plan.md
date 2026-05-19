# Network test triage — plan

## Scope

Network suite (`bun run e2e:agent`) is currently **46 / 66 passing**. Goal of this triage: take each of the 18 remaining failures and determine **before any code changes** which of the following it is:

- **(a) test finds a real wallet/playground bug** — assertion is correct, code is wrong
- **(b) badly implemented test** — assertion or timing is wrong, app behaves correctly
- **(c) test is stale** — app behavior changed (intentionally) and the test wasn't updated
- **(d) niche** — flake / infra / aztec sandbox issue / something orthogonal

The output of this plan is a **bucketed action list** per cluster, not fixes. Fixes happen in follow-up PRs once we agree on the categorization.

This plan was sent to two independent audit agents (codex `xhigh` + opus 4.7 general-purpose). Their notes live in `audit-codex.md` and `audit-opus.md` alongside this file. Final decisions reconcile both audits before any implementation.

## Materials reviewed (verified, not inferred)

- `packages/extension/tests/e2e/network/transfers.test.ts` — 8 tests, all use file-scoped `tokenReadyExtension`
- `packages/extension/tests/e2e/network/fee-methods.test.ts` — 5 tests; 2 use `tokenReadyExtension`, 3 use `feeJuiceImportedExtension`
- `packages/extension/tests/e2e/network/token-management.test.ts` — 1 test, `tokenReadyExtension`
- `packages/extension/tests/e2e/network/contacts-sender.test.ts` — 4 tests, `localNetworkExtension`
- `packages/extension/tests/e2e/network/data-registerSender.test.ts` — 1 test, `dappConnectedExtension`
- `packages/extension/tests/e2e/fixtures/extension.ts:285-558` — fixture bodies for `tokenReadyExtension` / `feeJuiceReadyExtension` / `feeJuiceImportedExtension`
- `packages/extension/tests/e2e/fixtures/helpers.ts:197-362` — `addContact`, `closeStuckPopup`, `importToken`
- `packages/extension/tests/e2e/fixtures/playground.ts:1-100` — `waitForPgResult`, `callExpectingNoPopup`, `snapshotResultSeq`
- `packages/extension/src/popup/components/popups/NewTokenPopup.vue` — wallet-side import flow
- `packages/extension/src/popup/components/popups/EditContactPopup.vue` — wallet-side edit flow + `applySenderDelta`
- `packages/extension/src/wallet/services/token/service.ts:280-400` — `parseTokenInterface`
- `packages/extension/src/wallet/services/token/utils.ts` — `isTokenComplete`
- `packages/extension/src/wallet/services/contact/service.ts` — pure storage, no PXE awareness
- `packages/wallet-bridge/src/dispatcher.ts:616-635` — playground `aztec_registerSender` dispatch

## Failure inventory: 18 tests → 5 root-cause clusters

```
Cluster                                              Victim tests   Root cause type
─────────────────────────────────────────────────────────────────────────────────
A. tokenReadyExtension fixture: importToken           11/18  →  ?fixture-cascade
   • transfers.test.ts: 8
   • fee-methods.test.ts: 2 (sponsored)
   • token-management.test.ts: 1
B. feeJuiceImportedExtension fixture: setup/import     3/18  →  ?fixture-cascade
   • fee-methods.test.ts: 3 (public/private FJ + gas balance)
C. contacts-sender: edit migrates sender                2/18  →  candidate (a) real bug
   • test 3 "edit address with sender ON migrates"
   • test 4 "edit address + flip sender OFF drops both"
D. contacts-sender: sender-chip 10s timeout             1/18  →  candidate (b) tight timeout
   • test 1 "delete-confirm exposes unregister-sender toggle"
E. data-registerSender: 15s waitForPgResult timeout     1/18  →  candidate (b) tight timeout
   • test 1 "silent path adds sender to PXE"
─────────────────────────────────────────────────────────────────────────────────
                                                       18/18
```

**Critical finding from the read-through, contradicting our prior assumption:**

We previously said (STATUS.md, in conversation) that contacts-sender tests 3+4 are *over-spec'd because the wallet's "keep old sender" behavior is intentional*. **This is wrong.** The wallet code at `EditContactPopup.vue:199-230` (`applySenderDelta`) explicitly intends to **migrate** when the address changes:

> Truth table 1 1 1 → add(new), delete(old) — "migrate registration old → new"

The function is documented, named, and tested for the migration case. Tests 3+4 assert exactly this behavior. So the candidate category is **(a) real bug or race** — either `accountStateService.deleteSender` actually fails at runtime (PXE issue) or the test reads `getSenders` before the deletion has propagated. Cluster C must be re-investigated, not re-spec'd.

## Per-cluster analysis

### Cluster A — `tokenReadyExtension` cascade (11 victims)

**What the fixture does** (extension.ts:285-349):

1. Launches a fresh extension + registers a profile
2. Switches to Local Network
3. Reads the popup account address
4. Script-side: mints 1000 test tokens to the popup account using `createSponsoredFeeOptions`
5. Calls `importToken(page, aztecConfig.tokenAddress)` to import the token via the popup UI
6. Polls `refreshBalances` for up to 30 × 5s = 150s for "1,000" to appear

**Where tests fail (per STATUS.md observation):** the call to `importToken()` at step 5 times out at 60s on `waitForToast(page, "New token has been added", 60_000)`.

**Why the toast might not fire** (read of `NewTokenPopup.vue:58-90` + `parseTokenInterface`):

```
handleAddToken:
  parsingResult = await tokenService.parseTokenInterface(...)
  if (!parsingResult.isComplete) {
    error.value = "Couldn't auto-detect this token's interface. ..."
    return    ← NO TOAST FIRED
  }
  newToken = await tokenService.addToken(...)
  tokenBalances = await tokenBalanceService.getTokenBalances(...)
  openToast({ label: "New token has been added" })
```

Two distinct failure modes are folded into "60s timeout":

A1. **`parseTokenInterface` is slow** (>60s end-to-end). PXE introspection: `getContractInstance` + `getContractArtifact` + `registerContract` on a fresh PXE that has just synced blocks. Plausible if PXE block sync stalls.

A2. **`isComplete: false` short-circuit**. `isTokenComplete` (utils.ts:18-27) requires ALL 9 candidate fns: name, symbol, decimals, balanceOfPrivate/Public, transferPrivate/Public, transferPublicToPrivate, transferPrivateToPublic. If artifact discovery returns *any* candidate as null/empty, the popup shows the "Couldn't auto-detect..." error and never toasts. The helper sees no toast, times out at 60s.

The fixture's mint step at #4 *also* uses the same token address via the script-side `createTestWallet` PXE; if that PXE is fine but the *popup-side offscreen PXE* sees a different artifact, A2 is plausible.

**Categorization (tentative, needs runtime confirmation):**

- If A1 → **(a)** PXE perf bug or contract-introspection inefficiency in the wallet
- If A2 → **(a)** isTokenComplete false-negative — wallet bug
- If both fail intermittently → still **(a)**, but a worse, racier wallet bug

**(d) is unlikely** because the cascade is reproducible (per STATUS, 11 of 11 victims fail).

**(b)/(c) are unlikely** because the helper closely mirrors what a user does (open dropdown → import → enter address → click import → wait for toast).

**Investigation step (Phase 0):** instrument `importToken()` to capture, on timeout: (i) the popup's `error` text, (ii) whether `[data-testid="import-token-button"]` is in loading state, (iii) the value of `parsingResult.isComplete` if reachable via console intercept. **Without this signal we can't distinguish A1 from A2.** Cost: ~30 minutes; output: a single test run reveals the actual code path.

### Cluster B — `feeJuiceImportedExtension` cascade (3 victims)

**What the fixture does** (extension.ts:426-558):

1. Phase 1 (script-side): `setupPreFundedAccount(wallet, node, feePayer)` — derives a master, brings a Schnorr account on-chain, then bridges + claims FeeJuice (both public + private) and mints 1000 test tokens.
2. Phase 2 (popup-side): launches fresh extension, imports the master via `importPlain`, switches to Local Network, asserts gas-balance card shows non-zero pub + priv FJ, and finally calls `importToken()` (same as Cluster A).

**Where tests fail (per STATUS.md):** the LMDB error `mdb_txn_begin: 22 - Invalid argument` originates in `setupPreFundedAccount` (script-side `EmbeddedWallet`). This is *not* the same as Cluster A — it's the script-side PXE blowing up before the extension even launches.

**Categorization:**

- LMDB error → **(d) niche / aztec sandbox** (not wallet code; script-side `EmbeddedWallet` hits a corrupted aztec data dir under repeat use).
- The downstream `importToken()` failure (if Phase 1 succeeds) would look like Cluster A.

**Investigation step (Phase 0):** rerun the FJ tests with a clean aztec data-dir each time and see if the LMDB error reproduces deterministically. If yes, file aztec-side; if no, it's a flake. Cost: ~10 minutes.

### Cluster C — contacts-sender edit/migrate (2 victims)

Two tests at `contacts-sender.test.ts:125-225`:

**Test 3** (`edit contact address with sender ON migrates the sender registration`): adds a contact with sender ON → edits the address → asserts the sender chip stays on the renamed contact (NEW address registered) AND that re-adding the OLD address as a fresh contact shows no sender chip (OLD unregistered).

**Test 4** (`edit contact address + flip sender OFF drops both`): same shape but ALSO flips sender OFF in the edit popup → asserts both NEW and OLD have no sender chip.

**Wallet code intent** (`EditContactPopup.vue:199-230`, with truth table at :185-194):

```
applySenderDelta(oldAddress, newAddress):
  shouldAddNew    = desiredIsSender && (addressChanged || !initialIsSender)
  shouldDeleteOld = initialIsSender && (addressChanged || !desiredIsSender)
  try:
    if shouldAddNew:    accountStateService.addSender(networkId, newAddress)
    if shouldDeleteOld: accountStateService.deleteSender(networkId, oldAddress)
    return true
  catch err:
    desiredIsSender.value = initialIsSender.value
    return false
```

Tests assert what the function *intends* to do. So **(c) test stale vs app** is ruled out — the wallet behavior the test asserts IS the intended behavior.

**Why might it fail at runtime?** Three plausible mechanisms:

C1. `accountStateService.deleteSender` throws (PXE removeSender not implemented or misbehaving) → the `try` block aborts, the function returns false, the toast says "sender migration incomplete", BUT a partial mutation (addSender succeeded) has happened. The test then sees the OLD address still registered.

C2. `deleteSender` succeeds but returns before PXE's getSenders read reflects the deletion. The test re-reads via `addContact` which on open calls `getSenders` → still has OLD → renders the sender chip on the freshly-added OLD-address contact.

C3. The script-side fixture or the e2e setup has registered OLD as a sender via *another* path (e.g., the sandbox-deployed accounts, or a prior test in the file leaked state).

**Categorization:** **(a) real wallet behavior bug**, mechanism is one of C1/C2/C3.

**Investigation step (Phase 0):** add `console.log` to `applySenderDelta` to capture which branches fire + whether `deleteSender` resolved or threw. Add `await accountStateService.getSenders(networkId)` immediately before AND after the delta to log the actual state. Run test 3 in isolation. **If C1 → wallet bug in `removeSender`. If C2 → consistency bug in `getSenders` cache. If C3 → cross-test leak.** Cost: 30-45 min; reveals which mechanism is real.

### Cluster D — contacts-sender chip 10s timeout (1 victim)

Test 1 (`delete-confirm exposes unregister-sender toggle for a registered-sender contact and unregisters on submit`):

```
await addContact(page, "SenderContact", ADDR_SENDER, { registerAsSender: true })
await page.waitForSelector(
  '[data-testid="contact-row"][data-contact-name="SenderContact"] [data-testid="contact-sender-chip"]',
  { visible: true, timeout: 10_000 },
)
```

**What the test asserts:** sender registration is async; the chip on the row should appear within 10s of `addContact` completing (which has its own internal wait for the contact row, but NOT for the chip).

**Why it might time out:** `accountStateService.addSender` is a PXE call (registers a sender on the active network's PXE database). Under e2e load, PXE writes can take >10s. The contact row renders immediately (storage write); the chip lights up later when the active-network sender list refreshes.

**Categorization:**

- If the chip eventually appears (just after the 10s mark) → **(b) bad timeout** — bump to 30-60s.
- If the chip never appears → **(a) real bug** in sender registration UI subscription.

**Investigation step (Phase 0):** bump the timeout to 60s *temporarily* and rerun — if it passes, it's (b). Cost: 5 min.

### Cluster E — data-registerSender 15s timeout (1 victim)

```
const result = await callExpectingNoPopup(dappConnectedExtension, page, "registerSender", async () => {
  await clickByTestId(page, "pg-btn-registerSender")
})
expect(["ok", "error"]).toContain(result.status)
```

The assertion is permissive (accepts `ok` or `error`). The failure is in `callExpectingNoPopup` itself, which awaits `waitForPgResult` with 15s timeout (per STATUS notes). `aztec_registerSender` dispatches through wallet-bridge → wallet → PXE.

**Categorization:**

- If the dispatch eventually returns ok/error within 30s → **(b) bad timeout**.
- If it never returns → **(a) wallet-bridge bug or PXE hang**.

**Investigation step (Phase 0):** bump waitForPgResult to 60s in this test only, rerun. If it passes, (b). Cost: 5 min.

## Phase 0: cheap diagnostics first

Before any "real" implementation work, run a single-test diagnostics pass that resolves the categorization for every cluster:

| Cluster | Diagnostic | Expected duration | Output we want |
|---|---|---|---|
| A | Add log/eval probe inside `importToken` helper to capture popup error text + button state at timeout. Run `transfers.test.ts > "balance shows minted tokens"` in isolation. | 15 min | A1 (slow) vs A2 (isComplete:false) vs neither |
| B | Run `fee-methods.test.ts > "transfer with public Fee Juice"` with `rm -rf /tmp/nulo-aztec-*` between runs. 3 attempts. | 10 min | LMDB deterministic vs flake |
| C | Add console.log in `applySenderDelta` for branch trace; add `getSenders` probe pre+post. Run test 3 isolated. | 30 min | C1 / C2 / C3 mechanism |
| D | Bump chip timeout to 60s in test 1 only. Rerun isolated. | 5 min | (b) vs (a) |
| E | Bump waitForPgResult to 60s in this test only. Rerun isolated. | 5 min | (b) vs (a) |

**Total Phase 0 cost: ~65 min.** After Phase 0, every test has a confirmed category and we can decide what to fix.

Phase 0 is intentionally **non-destructive** and **non-merging** — diagnostic logs land on a temp branch and get reverted before any real fix PR.

## Open questions for the user (decisions needed before Phase 1)

1. **Cluster A categorization stance** — if Phase 0 confirms `parseTokenInterface` is slow (>60s) on a fresh extension, do you want me to investigate the wallet's PXE introspection (likely 4-8 hr task), or is it fair to keep bumping the e2e timeout while we work around it? Wallet performance under fresh PXE is a real product concern, not just a test concern.

2. **Cluster B categorization stance** — if LMDB is deterministic, is filing this aztec-side enough, or do you want a workaround in `setupPreFundedAccount` (e.g., retry-with-fresh-data-dir)?

3. **Cluster C categorization stance** — once we know whether C1/C2/C3, do you still believe the "keep OLD sender" behavior is intentional (despite the wallet code clearly intending to migrate)? If yes, the test is **(c)** and we re-spec; if no, **(a)** and we fix the wallet. The audit agents are explicitly asked to challenge this.

4. **Phase 1 scope** — once Phase 0 categorizes everything, do you want a single "fix-all-network-flakes" PR or one PR per cluster? Smaller PRs are easier to review but increase merge churn.

5. **Phase 1 priority** — if not all clusters are fixable this sprint, which take priority? My instinct: A > C > D > E > B (A blocks the most tests; B is sandbox-side and less under our control).

## Anti-scope (what this plan does NOT do)

- No new test infrastructure (no fileParallelism changes, no fixture redesign).
- No build/CI changes.
- No edits to passing tests.
- No "while we're at it" refactors of helpers — only diagnostics added in Phase 0 and reverted before Phase 1.
- No retry-on-flake wrappers — they hide real bugs (codex was right about this in audit-codex.md from the parallel-isolation work).

## Audit checklist for both reviewers

I'm asking codex (xhigh) and opus 4.7 to **independently re-do the analysis above**, not just rubber-stamp it. Specifically:

1. Verify my categorization for each cluster against the actual files cited.
2. Challenge the contacts-sender re-categorization (C is the highest-risk re-spec).
3. Find any test I missed or miscategorized.
4. Suggest a faster Phase 0 — specifically, can the diagnostic probes be combined into fewer runs?
5. Find better hypotheses for Cluster A (importToken slowness) — is there a known PXE perf footgun we're missing?
6. Surface anything in `extension.ts:285-558` (fixture body) that I glossed over and that could be the actual culprit.
