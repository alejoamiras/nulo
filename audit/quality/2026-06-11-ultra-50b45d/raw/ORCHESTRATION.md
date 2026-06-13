# Orchestration state — ultra run 2026-06-11-ultra-50b45d

(Working notes; not part of the report. Codex session dirs are per-session temp paths recorded in the conversation, not here.)

## Phase 2 wave 1 (launched)

| Cluster | claude-1 | claude-2 | codex-1 task | codex-2 |
|---|---|---|---|---|
| C1 execution | launched | launched | launched | pending (launch after codex-1 returns) |
| C2 service fleet | launched | launched | launched | pending |
| C3 wallet-bridge | launched | launched | launched | pending |
| C4 popup UI | launched | launched | launched | pending |
| C5 pxe+messaging | launched | launched | launched | pending |
| C6 core+infra | launched | launched | launched | pending |

Claude agents write `raw/c<N>-claude-<i>.md` themselves. Codex responses must be `cp`'d from each session's RESPONSE_FILE to `raw/c<N>-codex-<i>.md`.

## Remaining pipeline

1. Wave 2: codex instance-2 per cluster (fresh sessions, same prompt files `/tmp/claude-501/codex-quality-c<N>.md`).
2. Phase 2.5 Round 1 cross-rebuttal: per cluster, one Claude rebuttal agent (reads both codex files + both claude files, appends `## Cross-rebuttal` to each claude file or a combined `raw/c<N>-rebuttal-claude.md`) and one codex rebuttal (resume codex-1 session with claude file paths → append to `raw/c<N>-codex-1.md` as `## Cross-rebuttal`).
3. Phase 2.5 Round 2 push-back (ultra): resume each side with "What did you miss? What did you over-assert? Where were you anchored?" → `## Round 2 push-back` sections.
4. Phase 3 coordinator: Codex xhigh fresh session over all raw files → findings/consolidated.md (cp from response). Dedupe by root cause; instances lists; priority = scope × blast radius × change frequency; cross-model disagreement markers; density sanity ~1.2/cluster.
5. Phase 4 verifier: verify ALL findings (ultra). Fable verifier agents stating own conclusion BEFORE reading prior claim; codex converge on contested. → findings/verified.md.
6. Phase 5: report.md (markdown only). Report absolute path in chat.

## Scope note for methodology

In scope: extension, wallet-bridge, wallet-core, wallet-crypto, aztec-runtime, extension-messaging. Excluded: bridge-core, faucet, playground (user), design (not extension-wired — no `@nulo/design` imports in packages/extension/src), node_modules/dist/generated types. Effort: ultra. Pain-point prior: execution/service.ts size. User said "no specific priors" otherwise.
