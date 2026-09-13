# Phase 3 — Coordinator / judge (reduce)

You are the coordinator of a map-reduce security audit of the Nulo browser-extension wallet (run `2026-09-13-high-prerelease`, effort `high`). Working directory: the repo root (a git worktree of `origin/dev`). Read, in order:

1. `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`
2. `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (what the cluster agents were asked; the negative list)
3. ALL raw cluster reports: `audit/security/2026-09-13-high-prerelease/raw/c*-claude.md` and `c*-codex.md` (each may end with a `## Cross-rebuttal` section — that is the model's revised position after reading the other family's report; weight it above the original body). Cluster c06 may have only a Claude report if the Codex run was refused — treat it as single-family evidence.
4. The repo maps under `raw/repo-map/` when you need orientation.

Then produce `audit/security/2026-09-13-high-prerelease/findings/consolidated.md`.

## Your tasks

1. **Deduplicate by root cause + sink + impacted boundary** — NOT by file:line. The same root cause in N places is ONE finding with an `instances` list of ALL locations. Do not over-merge: two root causes that share a sink stay separate. Expect the same issue to appear in several clusters (e.g. the chain-identity composite check surfaces in c03, c08, c09; the backup-restore trust gaps in c04 and c09; the same-phrase-sibling-profile theme in c02 and c11). Merge them and list every cluster that saw it.
2. **Resolve cross-model disagreements.** Where Claude flagged and Codex did not (or vice versa), or where the rebuttals contradict, RE-OPEN THE SOURCE yourself and decide. State the decisive file:line. Mark the outcome: `converged` (both found / both confirm), `cross-model disagreement — resolved for` / `— resolved against`, or `single-family`. Convergence is the strongest evidence; disagreement is a confidence signal, not a veto.
3. **Drop speculative findings.** No concrete source→sink trace = drop, listed under "Findings NOT pursued" with one line of reasoning. "Could be vulnerable" is noise. Also drop anything the negative list excludes (test-only code, defense-in-depth without a vector, quality issues) — but keep genuine defense-in-depth gaps that have a named, realistic precondition (e.g. "requires a compromised popup") as Low with that precondition stated.
4. **Assign CVSS v4.0 bands HERE** (cluster agents deliberately did not): Critical 9.0–10.0 (credible exploit chain AND high impact: key/seed compromise, full auth bypass, unauthorized fund movement without user action); High 7.0–8.9 (significant impact, realistic specific conditions); Medium 4.0–6.9 (limited impact OR unusual conditions); Low 0.1–3.9 (minor impact, defense-in-depth at the edge). Justify each band in one line from the impact + exploitability factors. Wallet-specific calibration: "attacker can move funds without a user click" ≥ High; "attacker needs the user to import a doctored backup file they were handed" is a realistic phishing precondition, not a mitigating one — rate the impact honestly (a hostile backup that redirects fee payments or RPC is High); "requires a lying RPC" is realistic for a wallet whose default RPC is a third-party provider; "requires a same-phrase sibling profile" is a supported flow and a realistic attacker model only when another party controls that sibling — say which.
5. **Relabel low-confidence Critical/High** as `Potential Critical` / `Potential High`.
6. **Surface cross-cutting findings** that span clusters (themes, systemic gaps) in a dedicated section.
7. **Sanity-check density**: ~1.2 findings per cluster (≈13 for 11 clusters) is the target; if you have many more, your dedupe or negative-list filtering is too loose. Prefer fewer, well-evidenced findings.
8. **Regression check**: for each July-2026 remediation listed in CONTEXT.md (units A–K) say in one line whether the raw reports found it intact or regressed.

## Output format (`findings/consolidated.md`)

```
# Consolidated findings — 2026-09-13-high-prerelease

## Summary table
| ID | Band | Confidence | Title | Clusters | Found by | Cross-model |

## Findings
### [BAND] F-NN: Title
**Band:** … (one-line justification)  **Confidence:** high|moderate|low  **Mapping:** OWASP/CWE
**Found by:** claude | codex | both   **Clusters:** …   **Cross-model:** converged | disagreement — resolved for/against (why) | single-family
**Instances:** - file:line … (ALL)
**Description:** plain language.
**Trace:** source → missing control → sink, file:line at each step (your own verified trace, not a paste).
**Why it matters:** impact + blast radius + preconditions.
**Recommended fix:** smallest safe change; reference existing patterns in the codebase.
**Effort:** hours / days / weeks.
**Verification notes for Phase 4:** the exact claim a verifier must confirm or refute (one sentence).

## Findings NOT pursued (with reasoning)
## Cross-cutting observations
## July-2026 remediation regression check
## Coordinator deviations / caveats
```

Repo-relative paths only. Be precise and terse. Every finding you keep must have a trace you personally re-verified in the source.
