# Codex (xhigh) as a code-tracing debugger

Codex is expensive per call. Most useful when you have **a sharp question** and need **code traces verified across many files**. Less useful as a generic "tell me what's wrong" agent.

This investigation used codex 4 times. Three were valuable; one was a wasted round.

## Call 1 (parallel plan, xhigh) — partially valuable

Sent codex the same context brief as opus + main agent. Got back an independent plan. Codex's plan was:

- **Better than mine on file paths** — caught that `offscreen/index.ts` lives at `src/offscreen/`, not `src/wallet/offscreen/`.
- **Better than mine on cluster B surface** — correctly identified the wait is on `nulo:ui:activeAccount`, not PXE.
- **Wrong on the root cause** — said cluster B was account derivation slow. It's 23 ms.

Verdict: **useful for cross-checking but did not find the bug.** The codex plan's APPROVE was on a hypothesis tree that was largely wrong. Sending three independent plans through codex didn't find the bug because none of the agents was looking at the right surface.

## Call 2 (final codex review, xhigh, resumed session) — valuable as gate

Sent the consolidated plan back. Codex returned APPROVE-WITH-MINOR-FIXES, 6 wording/spec precision corrections. All correct.

Verdict: **useful as a sanity-check gate but didn't reroute the investigation.** The 6 corrections were valid. None addressed the actual bug because we hadn't run probes yet.

## Call 3 (post-probe deep-dive, xhigh, resumed session) — DECISIVE

Sent codex the probe trace + the actual code paths I'd traced + an explicit ask to falsify my "popup-side event propagation bug" theory.

Codex returned in one round with:

- The exact line: `handleSetActive at .vue:47`
- The exact race: `network` is a computed off `route.params.id`, becomes undefined after await
- The exact mechanism: test helper navigates → route changes → computed re-evaluates to undefined → `appStore.network = undefined` → watcher early-returns
- The exact fix: snapshot `network.value` before the await
- Bonus: identified that my "pool/isolate fix" was a no-op because vitest 4.1.5 already defaults to forks+isolate

Verdict: **best ROI of the four calls.** With concrete data (probe trace) and a sharpened question (why does WATCH-IN not fire after the click?), codex did code-tracing across 5+ files that would have taken me hours.

## Call 4 (6-remaining-failures, xhigh, resumed session) — valuable

After the race fix landed, asked codex to triage the 6 remaining failures.

Codex returned: Group A (batch payloads stale wrt the new getAccounts capability contract), Group B (frame-detached as known harness flake, mitigation: retry-on-detach), Group C (cap-popup readiness wait helper).

Implemented all three. Group A + C made tests pass. Group B partial — converged to retry-budget approach.

Verdict: **useful for fan-out triage.** When you have multiple independent failures, codex can split them by root cause faster than chasing one at a time.

## When to call codex vs grep

**Call codex when:**
- You have a sharp, specific question
- The answer requires code tracing across multiple files
- You've already done the work that doesn't require LLM-level reasoning (grep, read, run)
- A wrong answer from codex is recoverable (you can verify against the actual code)

**Don't call codex when:**
- The answer is one grep away
- You don't have a specific question yet (use the time to formulate one)
- The investigation surface is small and you can hold it in your head
- You're hoping codex will think for you — it won't, and the cost compounds

## On resuming codex sessions

`resume-codex.sh` worked well. By the time of call 3, codex had ~20 minutes of prior context about this investigation. The prompt for call 3 referenced "the probe trace in findings.md" and codex picked up the thread immediately. Without the resume, call 3 would have needed to re-explain the entire investigation, doubling the prompt size and probably losing fidelity.

The 5-minute prompt-cache TTL applies to claude-code-side context. Codex sessions persist on disk (under `/var/folders/.../codex-*/`). The `SESSION_ID` from call 1 was still resumable hours later.

## Total codex cost across investigation

4 calls at xhigh, each ~3-10 minutes. Roughly $X of API spend. The race fix that saved ~22 test files was worth >> the entire codex budget.
