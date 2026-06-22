# E2E stabilization audit — codex (session 019e26f8)

## 1. Verdict

**Partially correct.** The network side is probably mostly defensive now, but the smoke clustering, runner-upgrade branch, Phase 0 shape, and several speed estimates are weaker than the plan claims.

## 2. Per-cluster review

- **S1**: **Disagree with the cluster and accepted mechanism.** `appearance.test.ts:70-88` does not show a credible `navigateByHash` or SW-write race: `setTheme()` only returns after `html[theme]` flips (`tests/e2e/fixtures/helpers.ts:733-745`), driven by app-root `applySetting` (`src/popup/app.vue:42-54`), and route changes do not remount the app root (`src/popup/index.ts:45-96`). The only real S1 issue I can justify is **`security.test.ts` reusing a file-scoped fixture after password rotation** (`tests/e2e/security.test.ts:79-84`; `fixtures/extension.ts:205-224`). For `appearance`, I would treat the skip as defensive until reproven.
- **S2**: **Agree with the stale-comment call.** `deleteContact()` does not use `waitForToast`; it waits for row disappearance (`fixtures/helpers.ts:332-384`). The skipped test's only extra surface versus the passing sibling (`contacts.test.ts:103-130`) is the brittle `consoleErrors/pageErrors` assertion (`contacts.test.ts:91-100`).
- **S3**: **Agree: fix, don't delete.** Neither `security.test.ts` nor `registration.test.ts` covers SW death; `stopServiceWorker()` returns immediately after `Runtime.terminateExecution` (`sw-resilience.test.ts:7-19`), so the flake is helper timing, not redundancy.
- **S4**: **Agree on profile-first, disagree on runner-upgrade option.** This repo's remote is user-owned (`git@github.com:alejoamiras/nulo.git`), and GitHub larger runners require **organization/enterprise** Team or Enterprise Cloud setup, not a magic `ubuntu-latest-large` label.
- **A**: **Mostly agree.** PR #70's account-on-network-switch fix is still live (`src/popup/app.vue:131-160`), and `switchToNetwork()` still waits for header text plus `nulo:ui:activeAccount` settle (`fixtures/helpers.ts:147-183`).
- **B**: **Mostly agree, but don't over-separate it from A.** These tests still ride the same token-import/setup surface; the remaining risk is cumulative load, not a clearly distinct deterministic fixture bug.
- **C**: **Mostly agree and likely defensive now.** The sender-migration tests already carry the PR #70-style guards (`contacts-sender.test.ts:166-211`, `246-290`); I would unskip before designing new wallet work.
- **D**: **Mostly agree and likely defensive now.** `addContact()` now waits for the sender chip before closing (`fixtures/helpers.ts:253-263`), which is exactly the race PR #70 fixed.
- **E**: **Agree and likely defensive.** The timeout is already 60s (`network/data-registerSender.test.ts:17-44`).
- **F**: **Agree.** This is architectural mismatch, not stabilization scope (`network/batch-partial-failure.test.ts:10-28`).
- **G**: **Agree.** Current test sleeps 1.5s and hopes discovery is queued (`network/connect-locked-queue.test.ts:28-44`); without an explicit queued signal, it stays probabilistic.

## 3. Phase 0 critique

`5× local + 5× CI` is too blunt as a default.

- Local isolated reruns miss the **known full-suite cumulative-load** failure mode.
- CI reruns on the same PR can still differ from a fresh-host boot.
- For network, the right first probe is **one full hosted run with all unskips**, then targeted repeats only for failing clusters.

Use this order instead:

1. One full smoke CI run with all 8 unskipped.
2. One full network CI run with all 20 unskipped.
3. Only then do isolated 3-5× reruns for the actual failing tests.
4. Locally, run on Linux or a constrained VM/container; macOS is the wrong substrate.

Also preserve **cold-start semantics**. `bun run e2e:agent` is good for network because README says it always allocates fresh ports; direct `vitest` can reuse sandboxes.

## 4. Phase 3 numbers verification

- `navigateToSettings`: the `200ms` sleep is real (`fixtures/helpers.ts:108-110`), but `11 sites` is wrong. Codex counts **26 smoke call sites** and **32 total** across smoke+network.
- `refreshBalances`: the `500ms + 2s` padding is real (`fixtures/helpers.ts:391-400`, `432-445`), but `~10 tests` is the wrong unit. The real cost is in **fixture loops** (`fixtures/extension.ts:323-344`, `407-420`, `541-550`).
- `sendTransfer`: the post-fee-estimation `5s` sleep is real (`fixtures/helpers.ts:602-604`). The `~25s` is directionally right only because there are **5 total call sites**; it is not "5 transfer tests" in the strict sense.
- `openPopup`: triple navigation is real (`fixtures/extension.ts:676-684`). This could be a bigger win than stated because there are **75 smoke** / **103 total** `openPopup()` calls, but the `~500ms` saving is unmeasured and the risk is understated.
- `retry: 2 → 1`: directionally reasonable, but the claimed `~10 min` win is not evidenced.

## 5. Divergence-log audit

- **Parallel-Claude clearly won S2** and the **runner skepticism**.
- **Neither source plan actually won S1.** Primary's "navigation race" is not supported, but parallel-Claude's accepted "SW-write race" is also not convincing for `appearance`; only the **security fixture contamination** read holds up.
- The consolidated divergence table overstates the speed case: `retry:2 → 1` is not obviously the biggest CI win.

## 6. Things missed

- `plan-consolidated.md:313` has a hard arithmetic bug: **"14 of the smoke skips"** is impossible when smoke has **8** skipped tests.
- The proposed `navigateToSettings → waitForSelector(landed-page testid)` speed fix is **not low-risk**: the helper has no generic per-route selector contract today.
- A bigger hidden padding candidate than some of the cited wins is `waitForTxConfirmation()`'s hard `10s` sleep (`fixtures/helpers.ts:623-624`).
- Skip inventory is correct **only if you exclude slow**: raw `test.skip` count is **29** = **20 network + 8 smoke + 1 slow**.

## 7. What looks fine

- Re-checking PR #70 fixes in source before touching network was the right instinct.
- **F** and **G** should stay out of the main stabilization pass.
- Deleting the SW-respawn tests would be a coverage regression.
- Keeping the speed pass separate from stabilization PRs is correct.

---

**Reference docs used for S4 verdict:**
- https://docs.github.com/en/actions/concepts/runners/larger-runners
- https://docs.github.com/en/actions/how-tos/manage-runners/larger-runners/manage-larger-runners
