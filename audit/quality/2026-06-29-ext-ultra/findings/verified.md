# Verified QUALITY Findings — synthesis (Phase 4)

Two independent verifiers re-read the cited source for the 22 consolidated findings:
- **Claude verifier** (all 22 + instance spot-checks) → `verified-claude.md`
- **Codex verifier** (cross-family, focused on the 5 single-source + 3 highest-blast) → `verified-codex.md`

## Result: 21 CONFIRMED · 1 ADJUSTED · 0 REFUTED

Every finding's core smell is real at the cited lines. Big instance lists (Q-01/02/03/12/13/14) spot-checked clean — no phantom/wrong-line entries. Notable: both verifiers **independently converged** on the same two corrections (strong signal).

### Corrections applied to the report
1. **Q-22 — drop one phantom instance.** The cited "wallet-core/README says `types: []`" does not verify (that text isn't in the README; only `tsconfig.json:11 "types":["node"]` is real, so there's nothing it contradicts). Both verifiers caught this. The rest of Q-22 stands (Aztec `4.2.0`→`5.0.0-rc.1` doc drift; wallet-crypto README PBKDF2 250k vs source `600_000`; stale extension-messaging README).
2. **Q-17 — count is 21, not 22.** There are 21 inline `lock.enter()/leave()` bypasses; the 22nd enter/leave pair is `runExclusive`'s own body. All 21 cited pairs match exactly. Effort stays "hours" but the refactor needs care around the zeroization / phased-crypto paths.

### Confidence stamps (final)
- **high** (cross-model `both` convergence + source-verified): Q-01, Q-02, Q-03, Q-04, Q-05, Q-06, Q-07, Q-09, Q-10, Q-11, Q-12, Q-13, Q-14, Q-15, Q-18.
- **high** (claude-only but Codex-verifier-confirmed in source): Q-16, Q-17, Q-19.
- **moderate**: Q-08 (`nulo-schema-patch` — duplication real, but the dedup is constrained by the "don't export wallet-bridge to third-party dApps" rule), Q-20 (config schema — local, design choice), Q-21 (host-seam — narrowed to 2 real drifts after the broad "adapter unsafe" hypothesis was falsified), Q-22 (doc drift, cosmetic).

### Strong corroborations called out by the verifiers
- Q-04: `as unknown as Operation` confirmed verbatim at `dapp-interaction/service.ts:294`.
- Q-05: the predicted drift is ALREADY real — `contractClasses` is absent from the dispatcher's capability delta branches (4 of 6 types handled).
- Q-06: the dual-role `masterKey: string` overload (base64 master key OR credentialId in one slot) is documented verbatim at `profile/spec.ts:250-262`.
- Q-16: the `null as unknown as ServiceClient` lie is self-documented in `utils/core.ts`'s own JSDoc.

Full per-finding verdicts: `verified-claude.md` + `verified-codex.md`. Full finding text + exhaustive instance lists: `consolidated.md`.
