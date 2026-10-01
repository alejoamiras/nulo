# Investigation journey: 19 iterations to find a Vue template race

This doc is a brief retrospective on the network-e2e investigation. It collapses what used to be `audit-codex-rootcause-{2..7}.md` (six dead-end leads) into a single timeline so future contributors don't have to read seven false-trail audits to find the actual fix.

## The bug (in one sentence)

The discover / capabilities / execute approval popups had `:disabled` gates that didn't include `!requestId`, while `approve()` handlers had a `if (!requestId.value) return` silent early-exit. Under CI cumulative-shard load, `clickByTestId` would click the button after it became visible but before `loadInteractionPayload()` set `requestId`. The click hit the silent guard. The wallet never received the approval. The test waited 30s for the next popup that would never come.

Fix in `ef42139`: add `!requestId` (or `!session` for verify) to each popup's button `:disabled` gates. The existing `clickByTestId` already waits for `:disabled=false`, so this forces it to wait until init completes before clicking.

## Why it took 19 iterations

The failure surfaced as `connectPlayground:awaitVerifyPopup — Timed out after waiting 30000ms`. Every layer we instrumented pointed AWAY from the actual race:

| Iter | What we tried | Why it didn't work |
|------|---------------|--------------------|
| 1 | Shard the suite + bundle-grep | Bundle-grep had a `set -e -o pipefail` bug; matrix structure was sound |
| 2 | Quarantine 2 slow tests + retry 2→4 | Helped narrow flake set; didn't address root cause |
| 3-6 | Comprehensive 15s→30s timeout sweep | Wallet wasn't slow — it never ran the code path under failure |
| 7 | Codex's verify-popup race fix (audit-2) | Real bug but not the bottleneck for shard 5 |
| 8 | Inner phase-tagging in connectPlayground | Diagnostic — proved `awaitVerifyPopup` was the cliff |
| 9 | Codex's upstream wallet-sdk 2s→10s patch (audit-3) | Made things worse (regressed to 1/5); the 2s ECDH timeout was a red herring |
| 10 | Codex's "keep SW hot" fix (audit-4) | Made things worse (0/5); MV3 SWs aren't kept alive by pages |
| 11 | Revert to iter #8 state | Back to 2-3/5 baseline (the floor) |
| 12-14 | Playground-only KEY_EXCHANGE patch via Vite plugin (audit-5) | Rigorous validation of the 2s hypothesis — definitively ruled out |
| 15 | Wallet-side timing instrumentation (audit-6) | Probe didn't surface — SW console wasn't captured |
| 16 | SW console hookup in fixture | Probes finally landed — wallet completes onSessionEstablished in **6ms** |
| 17 | Probe `chrome.windows.create` resolves | Resolved with valid windowId every time — wallet IS creating verify |
| 18 | Fixture-probe enumerates browser targets | **Smoking gun**: in failing flows, NO wallet-probe lines fire after discover-approve — click went to a void |
| 19 | Fix Vue button `:disabled` gates | **5/5 green** |

## What we learned

1. **A silent early-exit guard is the cruelest possible failure mode.** `if (!requestId.value) return` looks defensive but it's actually a footgun — every layer downstream times out in confusing ways. Throw instead.

2. **Codex audits 3 + 4 were confidently wrong.** Both suggested fixes regressed CI from 2/5 → 1/5 and 0/5. Even with `xhigh` reasoning effort, a tracing-based audit can mislead when the failure mode is "click silently dropped". Lesson: validate hypotheses with isolated probes BEFORE applying them.

3. **`clickByTestId` should fail loudly if click doesn't have an effect** within some sentinel timeout. We have no such helper today; PR #58 follow-up could add one (e.g., assert that the popup closed or some side-effect happened within Nms).

4. **Prior-art was right.** PR #46's `implementations-plan/network-test-triage/full-suite-findings.md` documented "rotating flake under cumulative load" and decided to "accept the flake (for now)". That doc was correct about the symptom and the load-correlation — but the assumed cause (PXE / aztec backpressure) was a red herring. The actual mechanism: popup Vue mount runs slower under load → race window widens → silent guard fires more often.

## Audit transcripts preserved

The original Tier-A audits (`audit-codex.md`, `audit-opus.md`, `audit-codex-rootcause.md`) are kept. The audit-8 transcript (`audit-codex-rootcause-8.md`) is kept too — its findings spawned [Issue #58](https://github.com/alejoamiras/nulo/issues/58) for 5 latent same-shape races elsewhere.

The dead-end chase transcripts (audit-2 through audit-7) are not preserved separately — their content is captured in the iteration table above. To recover any specific one, `git log --all --diff-filter=D -- implementations-plan/network-followups/audit-codex-rootcause-N.md`.
