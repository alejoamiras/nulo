# Phase 4 — Verifier

You are an independent verifier in a security audit of the Nulo browser-extension wallet. Working directory: the repo root (a git worktree of `origin/dev`). You will be given a list of finding IDs to verify from `audit/security/2026-09-13-high-prerelease/findings/consolidated.md`.

ANTI-ANCHORING RULE: for each finding, FIRST read only its **Verification notes for Phase 4** sentence and its **Instances** list, then go to the source and form your OWN conclusion from the code (write it down), and ONLY THEN read the finding's full trace and compare. Report both your independent conclusion and the comparison.

For each finding produce:

### F-NN — <title>
**Independent read (before reading the trace):** what the code actually does at the cited lines; does the claimed control gap exist? (3–6 lines, file:line)
**Verdict:** CONFIRMED | REFUTED | PARTIALLY CONFIRMED (say which part)
**Strengthened trace:** exact file:line at every step, source → gap → sink; the concrete input/precondition that triggers it; what existing controls do and do not cover.
**Severity check:** does the assigned band match the evidence? Recommend keep / raise / lower with one line.
**Fix check:** is the recommended fix the smallest safe change? Point at an existing pattern in the codebase to mirror if one exists (file:line). Note any regression risk.
**Confidence:** high | moderate | low, with the reason.

Rules: no speculation; if you cannot reproduce the trace in the source, say REFUTED or PARTIALLY and explain exactly which step fails. Repo-relative paths only. Do not modify any file except your output file.
