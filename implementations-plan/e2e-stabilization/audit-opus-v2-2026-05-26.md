# Tier-A independent plan: Network e2e stabilization (Issues #58, #59, cold-shard)

Opus, drafted cold from a fresh read of the repo at commit `6b2075e`. Scoped to the three open problems left by PR #46. NOT a full e2e overhaul; the bar is "5/5 shards green on 3 of 4 of 5 consecutive runs".

## 1. Root-cause map and smallest fix

### 1.1 Issue #58 — two remaining popup races

**A. Discover popup identity-load race** (codex audit-8 #5, MEDIUM, production phishing surface). [`packages/extension/src/popup/windows/discover/index.vue:198`](../../packages/extension/src/popup/windows/discover/index.vue:198) gates Allow on `!requestId`, but `requestId.value` is set inside [`useDappInteractionPayload.load`](../../packages/extension/src/composables/useDappInteractionPayload.ts:84) BEFORE `getInteractionPayload()` returns the dApp metadata. The button becomes clickable while `dapp.value` and `dappHostname` are still null. Tests don't reach this — popups render fast in CI. Production reaches it: slow logo fetch + auto-focused button + scripted Enter → user approves a session whose hostname they never saw.

**Fix.** Add `const isReady = ref(false)` to discover/index.vue; flip `true` at end of `init()` AFTER `loadInteractionPayload()` resolves AND `profile.value` is set. Gate `:disabled` on `!isReady || !requestId` for both Allow and Deny. Throw inside `approve()` if `!isReady.value` (loud-fail, per [`investigation-journey.md`](../network-followups/investigation-journey.md) lesson #1). ~8 lines.

**B. Authwits popups' Enter-key bypass** (codex audit-fix-review #2, #3). Both [`ChangeAuthwitsRegistryPopup.vue:114`](../../packages/extension/src/popup/components/popups/ChangeAuthwitsRegistryPopup.vue:114) and [`RevokeAuthwitsPopup.vue:167`](../../packages/extension/src/popup/components/popups/RevokeAuthwitsPopup.vue:167) had `.value` fixed but `onKeydown` doesn't mirror the visible button gate. Change → ignores `isLoading`. Revoke → ignores `isErrorOccurred` AND `isLoading`. Local-only popups (not dApp-driven), so e2e doesn't catch them — but it's the same bug class that killed us 19 iterations ago. Two one-line predicate changes per codex's recommended follow-up.

### 1.2 Issue #59 — `register-token.test.ts` budget overrun

**Mechanism.** The spec stacks two cold interaction flows in one test body: cap popup → approve → wait result, THEN execute popup → approve → wait result. Codex math at [`audit-codex-register-token.md:10`](../network-followups/audit-codex-register-token.md) shows worst-plausible inner-wait sum ≈ 210s against vitest's 60s test budget × 3 retries. Cap popup is the cold-path; on a fresh shard the SW + PXE + accountService warmup pushes the first `waitForPopup("capabilities")` and first `cap-account-item` render past 30s each.

**Fix (preferred): split into 2 specs + new file-scoped pre-grant fixture.** Add `dappConnectedExtensionWithAccountsCap` to [`fixtures/extension.ts`](../../packages/extension/tests/e2e/fixtures/extension.ts) that extends `dappConnectedExtension` with the `accounts` cap already granted via the popup flow, executed ONCE per file. Then:

- `register-token.test.ts` (retargeted, existing): uses new fixture, only exercises execute-popup flow. Budget shrinks to `{ timeout: 60_000 }`. Drop `skipDeferredSlow`.
- `register-token-cap-grant.test.ts` (new): exercises ONLY the cap popup against `dappConnectedExtension`. Becomes the cold-shard victim slot, but as a single-popup test with the same budget as `cap-request-basic.test.ts`.

**Fallback if Phase 2 slips:** bump existing spec to `{ timeout: 180_000, retry: 1 }` per codex. Defensible but preserves the structural anti-pattern.

### 1.3 Cold-shard rotation

Per [`audit-codex-shard-vs-serial.md`](../network-followups/audit-codex-shard-vs-serial.md): vitest's SHA-1-of-filename sharder picks ~9 files/shard; 5 shards run on independent runners. First cap-popup-driven test in shard 1 pays cold SW + cold PXE + cold bb.js cost. 25 network files use the cap flow (`grep -lE 'pg-bundle-select|approveCapabilities|cap-account-item'`), so quarantining the offender just promotes another.

This is NOT a wallet bug — it's a property of MV3 SWs + bb.js cold-boot. The test bug is that every shard's first cap test gambles against the cold cliff with a 30s waitForPopup.

**Fix: shard-scoped warm-up tap in `global-setup.ts`** (NOT a fixture). Run ONCE per shard before any test body. Drive `launchExtension → registerProfile → switchToLocalNetwork → connectPlayground → approveCapabilities (basic bundle) → approveExecute (no-op operation)` in a throwaway browser, then close it. The OS-level SW/bb.js wasm cache may survive the close within Chrome's installation; if so, the next test pays no cold cost. **Empirical-validation required** (Phase 3A): if state does NOT survive `browser.close()`, fall back to per-test cap-reset.

Codex's prior concern about a fixture-level warm-up was that it mutates state shared by subsequent tests. Running it in `global-setup.ts` with a disposable browser sidesteps that: per-test fixtures already spawn fresh browsers, file-scoped fixtures spawn after warm-up returns.

## 2. Local-first verification plan

Local iterations are seconds; CI is 10-15 min. Prove everything locally first.

### 2.1 Per-shard local repro

```bash
cd packages/extension

# Match CI matrix shard-by-shard:
for s in 1 2 3 4 5; do
  NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=$s/5 2>&1 \
    | tee /tmp/nulo-shard-$s.log
done

# One shard repeated 3× to gauge flake rate:
for i in 1 2 3; do
  NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5 \
    2>&1 | tee /tmp/nulo-shard1-run$i.log
done
```

Local is faster than CI; 3/3 local green is necessary but not sufficient.

### 2.2 Per-fix verification

**Issue #58 part A (discover isReady).** Vitest component test covering ≥10 cases per CLAUDE.md (Allow disabled while load pending, while profile null, becomes enabled only after both resolve, approve() throws if called before `isReady`, cancel flag during init doesn't leak, error path stays disabled, requestId-vs-payload-vs-profile ordering combinations, unmount during init, `clickByTestId` polling resolves only after `isReady`, existing behavior preserved).

```bash
bun run vitest run src/popup/windows/discover
bun run --cwd packages/extension test:e2e -- connect-dapp
bun run e2e:agent tests/e2e/network/connect-dapp.test.ts
```

**Issue #58 part B (authwits Enter).** Vitest component test, 5 cases each popup: Enter while not-ready → no-op; Enter while isLoading → no-op; Enter while isErrorOccurred (Revoke only) → no-op; Enter while ready → fires once; rapid double-Enter while loading → fires once.

```bash
bun run vitest run src/popup/components/popups/ChangeAuthwitsRegistryPopup
bun run vitest run src/popup/components/popups/RevokeAuthwitsPopup
```

**Issue #59 (register-token split).**

```bash
bun run e2e:agent tests/e2e/network/register-token-cap-grant.test.ts
bun run e2e:agent tests/e2e/network/register-token.test.ts
# File-scoped fixture stability:
for i in 1 2 3; do
  bun run e2e:agent tests/e2e/network/register-token.test.ts \
    tests/e2e/network/register-token-cap-grant.test.ts
done
```

Drop `skipDeferredSlow` from `register-token.test.ts:16` and confirm green.

**Cold-shard mitigation.** Local CPU masks the cold-boot cliff. Best local proxy:

```bash
rm -rf packages/extension/dist
NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5 2>&1 \
  | tee /tmp/nulo-cold-shard1.log
grep "cap-request\|register-token" /tmp/nulo-cold-shard1.log
```

With-vs-without warm-up: first cap test wall-time should drop ≥30%.

### 2.3 Local pre-push gate

```bash
cd packages/extension
bun run audit:vue                               # ~3min
NULO_E2E_SKIP_DEFERRED_SLOW=1 bun run e2e:agent --shard=1/5  # ~10min
git push origin HEAD
gh pr checks --watch
```

## 3. Phase ordering

```
[1] Phase 1 — Issue #58 popup races (1 PR, low blast radius)
     ├─ 1A: discover isReady + component tests
     ├─ 1B: authwits Enter predicates + component tests
     └─ Wallet review: codex pass on the 3 Vue files
[2] Phase 2 — Issue #59 register-token restructure (1 PR, independent)
     ├─ 2A: new dappConnectedExtensionWithAccountsCap fixture
     ├─ 2B: register-token-cap-grant.test.ts extraction
     └─ 2C: un-quarantine register-token.test.ts
[3] Phase 3 — Cold-shard warm-up (1 PR, depends on Phase 2 for clean measurement)
     ├─ 3A: SW-survives-close probe (1h spike)
     ├─ 3B: warm-up in global-setup.ts (or fallback impl)
     └─ 3C: README cold-shard section update
[4] Phase 4 — Acceptance gate (no code; 5 back-to-back workflow_dispatch runs)
```

Phase 1 and Phase 2 fully independent. Phase 3 depends on Phase 2 only to measure warm-up gain against a clean baseline. **3 PRs total** + 1 acceptance round.

## 4. Cold-shard mitigation options, ranked

Ranked by stability gain ÷ implementation cost.

1. **Warm-up tap in `global-setup.ts` (RECOMMENDED).** ~30-60s ONE TIME per shard before any test, in fixture-time budget (`hookTimeout: 300_000` already at `vitest.e2e.network.config.ts:16`). Codex's "mutates state" concern resolved by running in a throwaway browser. Risk: SW-state survival unverified — Phase 3A.
2. **Per-file pre-grant cap fixture for the first cap-driven file in shard.** Subset of #1; only helps cap tests. Falls into #1 if we build it.
3. **`agent.sh` pre-build SW activation.** Codex's prior critique: proves SW boots, doesn't pre-warm bb.js wasm (the actual cold cost). SKIP.
4. **`fileParallelism: true`.** Wrong direction — would compound per-shard cold cost. Each network file owns chrome+extension state and can't share. SKIP.
5. **Self-hosted runner with persistent SW.** Highest gain, highest cost, out of scope per user's constraint. Future v2.
6. **Force a fast file to position 1 via SHA-1 of filename.** Codex correctly called this brittle. Breaks on every file add/rename. SKIP.
7. **Fewer shards (concat 3-5).** Trades parallelism for fewer cold-starts. Regresses PR #46. SKIP.

Implementation: option 1, with option 2 as fallback if SW survival fails. Worst case: revert, document residual, accept advisory status until self-hosted.

## 5. Security and adversarial considerations

**5.1 Discover identity race (Issue #58A) — production phishing surface.** The fix IS a phishing defense, not a test fix. Pre-fix attack: malicious dApp races logo-fetch + manifest-parse with auto-focused button + scripted Enter. User sees blank popup, hits Enter expecting their previous prompt's "Continue", approves a session they never identified. The `isReady` gate closes it. Throw-vs-return makes the attempt observable via `consoleErrors` (production telemetry signal, not just silent no-op).

**5.2 Authwits Enter bypass (Issue #58B) — local privilege.** Limited blast radius (local popups only, not dApp-driven), but bypass DOES let user fire `setRegistryEnabled` / `revokeAuthwits` with wrong fee settings → real-fund cost + wrong on-chain state.

**5.3 Warm-up tap (Phase 3) — supply-chain surface.** Warm-up runs cap-popup flow with hard-coded test data. If it accidentally hits a real network (testnet RPC, real attestation), leaks IP + timing fingerprint per CI run. **Mitigation**: MUST only use locally-spawned anvil + aztec sandbox; validate via `grep -E "(testnet|mainnet|prod)" packages/extension/tests/e2e/global-setup.ts` after Phase 3 → must return 0 matches. Secondary: a bug in warm-up that throws silently could mask real fixture-setup failures. Wrap in try/catch; log `[warmup] skipped: <reason>` to stderr; do NOT throw — warm-up is perf optimization, not hard dependency.

**5.4 Fixture pre-grant (Phase 2) — test-isolation risk.** `dappConnectedExtensionWithAccountsCap` mutates shared file-scoped cap state. Mitigation: fixture is opt-in (only `register-token.test.ts` uses it); sibling cap-tests stay on `dappConnectedExtension`.

**5.5 Advisory CI gate as attack window.** Network e2e is currently advisory on `dev` (only `Quality / Status` required, per CLAUDE.md). A red-but-ignored gate trains contributors to dismiss the signal; real network-side regressions ship under the noise. The Phase 4 acceptance criterion ("3/4/5 consecutive 5/5 green") is the bar for re-asserting Network e2e as required. Security argument for not stopping at "good enough" — lower bar invites supply-chain attacks via dep bumps that break network path silently.

**5.6 Least-privilege.** Warm-up uses same chrome.* surface as existing tests. No new permissions, no new secrets, no new env beyond `agent.sh` set. Crypto + dep-policy + input-validation surface untouched.

## 6. Acceptance criteria

Maps to user's "5/5 green on 3 of 4 of 5 consecutive runs."

**Hard gates:**
- 5/5 green on **3 of 5** consecutive `pr-network-e2e.yml` runs after Phase 3 merges. Trigger via `gh workflow run pr-network-e2e.yml --ref <branch>` 5× in a row WITHOUT code re-pushes (we measure stability, not flake-via-churn).
- 5/5 green on **4 of 5** is the comfortable bar.
- 5/5 green on **5 of 5** is the celebrate-and-promote-to-required-check bar.

**Soft gates (informational):**
- First-in-shard cap test wall-time decreases ≥30% with warm-up.
- `register-token.test.ts` runs at `{ timeout: 60_000 }` cleanly on shard 1 without `skipDeferredSlow`.
- Component test count ≥ 30 across the 3 touched Vue files.

**Negative gates:**
- Smoke suite stays green; `bun run audit:vue` stays green; no new `consoleErrors`/`pageErrors`; Renovate weekly run stays green.

**Documentation gates:**
- `packages/extension/tests/e2e/README.md` cold-shard section updated; if warm-up doesn't fully resolve, document residual + retry strategy.
- `implementations-plan/network-followups/slow-tests-hypotheses.md` Issue #59 row moves "Quarantined" → "Closed by Phase 2".
- `CLAUDE.md` Quality gates section updated if Phase 4 hits 5/5 (Network e2e promoted to required).

## 7. Wallet-code touch list (for codex review)

**Phase 1A — `discover/index.vue` (~12 lines):**
- Add `const isReady = ref(false)`
- Flip `isReady.value = true` at end of `init()` after `loadInteractionPayload()` succeeds AND profile is set
- Change `:disabled` on `discover-allow-btn` (line 205) → add `|| !isReady`
- Change `:disabled` on `discover-deny-btn` (line 193) similarly
- Change `approve()` silent guard at line 80 → `throw new Error("...")` when `!isReady.value`
- Reset `isReady = false` in error catch at line 67

**Phase 1B — two one-liners:**
- `ChangeAuthwitsRegistryPopup.vue:114`: add `&& !isLoading.value`
- `RevokeAuthwitsPopup.vue:167`: add `&& !isErrorOccurred.value && !isLoading.value`

**Phase 2 — test files only (no production code):**
- `fixtures/extension.ts`: new `dappConnectedExtensionWithAccountsCap` fixture
- `network/register-token.test.ts`: drop cap section (lines 46-69), use new fixture, drop `skipDeferredSlow`
- `network/register-token-cap-grant.test.ts`: new file

**Phase 3 — global-setup + workflow (no production code):**
- `tests/e2e/global-setup.ts`: warm-up tap (conditional on env `NULO_E2E_WARMUP=1`)
- `.github/workflows/_network-e2e.yml`: set `NULO_E2E_WARMUP: "1"` in env
- `tests/e2e/README.md`: doc update

**Codex review prompt for Phase 1:**

> Review this diff for the discover/capabilities/authwits popup race fixes. Verify:
> 1. Does `isReady` flip ONLY after every state `approve()` reads is committed?
> 2. Is the throw-in-handler defensive enough that an injected Enter-keydown can't slip through?
> 3. Are there OTHER async-init popups with the same shape we missed?
> 4. Adversarial: what could an attacker do with slow-network + auto-focused button + scripted Enter? Is the hostname rendered BEFORE `isReady` flips? (If yes, the user sees the trust anchor before they can click — that's the actual fix.)

## 8. Estimate

| Phase | Code | Test | Codex | CI | Total |
|---|---|---|---|---|---|
| 1A discover isReady | 0.5h | 1.5h | 0.5h | 0.5h | **3h** |
| 1B authwits Enter | 0.25h | 1h | 0.25h | 0.5h | **2h** |
| 2A fixture | 1.5h | 0.5h | 0.5h | 0.5h | **3h** |
| 2B test split | 1h | 0.5h | 0.25h | 0.5h | **2.25h** |
| 2C un-quarantine | 0.1h | 0.1h | 0h | 1h | **1.2h** |
| 3A SW-survival probe | 1h | 0.25h | 0h | 0.25h | **1.5h** |
| 3B warm-up impl | 2h | 1h | 1h | 1h | **5h** |
| 3C docs | 0.5h | 0h | 0h | 0h | **0.5h** |
| 4 acceptance | 0h | 0h | 0h | 2.5h | **2.5h** |
| **Total** | | | | | **~20h** |

Calendar: 2-3 working days, single engineer, clean CI capacity. Add 1 day if codex surfaces a Phase 1 regression needing Phase 1.5. Add 1 day if Phase 3A probe shows SW state doesn't survive close and we switch to option (b).

## 9. Deliberately out of scope

- The other 2 quarantined slow tests (`multi-account-from`, `tx-sendTx-multicall`) — different root causes (bb.js cold start OR PXE block sync). Future PR.
- Self-hosted runners — too much infra for "Issues #58 + #59 + cold-shard ONLY".
- `clickByTestId` loud-failure assertion (from `investigation-journey.md` lesson #3). Worth doing; `isReady` + throw covers most of the safety for these 3 popups.
- Promoting Network e2e to required-check — only after Phase 4 hits 5/5 on 5/5.
- Bumping `register-token.test.ts` to 180s + retry 1 — that's the Phase 2 fallback, not the plan.

## 10. Open questions to resolve before approval

1. **Phase 3A probe outcome.** Does Chrome extension SW state survive `browser.close()` within the same installation? NO → option (b) (per-test reset). YES → option (a) straightforward. 1-hour spike before committing Phase 3 design.
2. **Fixture naming.** `dappConnectedExtensionWithAccountsCap` is accurate but long. Ping codex for naming-consistency with existing 11 fixtures at `extension.ts:240-269`.
3. **Warm-up always-on vs opt-in?** Opt-in via `NULO_E2E_WARMUP=1` lets us A/B compare cold-shard rate on same CI infra. Always-on adds ~30-60s to local dev. Lean opt-in for 2 weeks then flip after stability data.
4. **Merge order.** Phase 1 and 2 are independent. My instinct: ship 2 first (smallest blast, fastest to validate), then 1 (wallet code, codex review needed), then 3 (infra, most risk).
