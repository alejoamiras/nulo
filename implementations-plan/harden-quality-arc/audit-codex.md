reject (blocking: routine `--admin` bypass, stale `dev-quality` base assumption, and missing fail-closed gates for the trust-boundary seams)

1. A beats B. With “validate each implementation” plus full network per PR, A’s per-finding PRs are the right default because they preserve isolation, bisection, and rollback. B loses because a red mega-batch tells you almost nothing. Strongest argument for B: full-network-per-PR makes A brutally expensive, and B would reduce repeated CI plus repeated seam scaffolding across Q-01/Q-02/Q-03/Q-06/Q-07.

2. Sequencing is mostly right, but the plan overstates “✓” finality. Q-01 can invalidate Q-03’s generated PXE/client surface if result validation metadata moves. Q-02 can invalidate Q-04/Q-05’s policy invariants if dispatch/request derivation drops special handlers or scope checks. Treat earlier `✓` as locally green, not permanently settled. Q-03 before Q-02 is right. Q-06/Q-07 before Q-01 is right only if Q-06 is storage/wire-shape-preserving and Q-07 does not change error semantics.

3. Tiering is underweighted. Q-17 is not light: `runExclusive` is non-reentrant, sits on session restore/TTL/zeroization paths, and a mechanical wrap can deadlock or hold the lock over crypto. Q-13 is probably deep, not mid, because ownership/cascades across seven services are behavioral. Q-10 is mid-to-deep because 600+ call sites plus resolver/wrapper contracts are not just token typing. Q-02 is correctly mega-deep; Q-01 should probably also be mega-deep.

4. Misstated fact: `dev-quality` is not absent here; `origin/dev-quality` exists. P0 needs an explicit recreate/reuse/base verification rule. Another operational contradiction: the plan makes `gh pr merge --squash --admin` routine, while `CLAUDE.md` says `--admin` bypasses both status checks and signatures and is emergency-only. Unsafe inference: “no backwards compat” does not mean “no persisted-state risk.” Existing unlocked-session restore, persisted passhash, base64 master keys, and backup restore are active test/e2e contracts; Q-01/Q-06 can break them without any production migration question.

5. Fail-open risks are concrete. Q-02 must ask: can any crafted method, prototype key, batch leg, hook path, or tuple mismatch reach a sink with fewer grants than before? Did `getAccounts`, `grantPublicAuthwit`, `registerToken`, `batch`, and session account-scope validation keep their exact gates? Q-04/Q-05 must ask: does any missing registry row default to grant, `AccessLevel.None`, “covered,” or “no delta”? Are unknown capabilities rejected? Does `contractClasses.register` remain denied? Q-01 must ask: did any decoder become laxer than the old cast in a way that turns hostile input into trusted domain objects?

6. Autonomy is too broad. Beyond listed hard limits, halt on any dApp permission semantics choice, intentional fail-open/fail-closed behavior change not already pinned, session/backup shape break requiring “wipe vs tolerate,” or repeated CI failure caused by infra rather than code. RED plus “try/fix” is not enough for semantic ambiguity; five failed attempts just bounds time, not risk.

7. Biggest break path: happy-path network e2e plus autonomous `--admin` lets a Q-02/Q-05/Q-01 registry/codec mistake merge even though malicious dApp cases are untested. Full network is necessary, not sufficient.

**What’s Solid**

A’s granularity, the three explicit coupling pairs, full network per PR, re-verify-first, BUG-PIN discipline, and adversarial review for trust-boundary work are all directionally right. The plan becomes viable after fixing merge enforcement, branch-base handling, tiering, and explicit fail-closed invariant tests before each seam refactor.

---

# Final fresh-context codex pass (Phase 3)

conditional approve (conditions: delete the unsigned/`--admin` fallback and HALT on signing/protection failure; add an explicit diff gate proving frozen authz/crypto oracle ranges are unedited; expand P15’s black-box adversarial suite to cover capability negotiation and Q-01 decoder fail-closed cases, then mandate it after P15/P18/P19/P20)

1. The v1 codex blockers are mostly fixed: P0 now prunes/verifies `dev-quality`, routine merge is plain self-authored squash, and trust-boundary gates no longer rely on network e2e. But the `git -c commit.gpgsign=false` / possible one-off `--admin` clause reopens the bypass path. In autonomous mode, that must be a hard halt.

2. HALT-on-oracle-edit is conceptually solid but needs an operational check, not just prose. Add `git diff --exit-code` or range-specific equivalent for `FROZEN_*`, existing authz cases, and key vectors after each trust-boundary phase. P15 “establishes” wording is a small loophole since current `dev` already has the oracle.

3. The adversarial suite is concrete enough for dispatcher bypasses: missing grant, batch smuggling, prototype names, tuple mismatch, dropped checker. It is not yet broad enough for P19/P20’s biggest fail-open risk: capability request parse/covers/delta/merge/enrich drift or decoder laxness/defaulting to grant.

4. Moving messaging-base typing into P18 is the right ordering fix. P19 before P20 is acceptable only if P20 reuses, not bypasses, P19’s decoders and the expanded adversarial suite covers malformed RPC/capability payloads.

5. Q-01 `parseOrDelete` fail-loud-under-test is acceptable with the planned write-read corpus. It exposes self-rejecting codecs; it does not by itself prove prod will not silently drop legacy/corrupt data.

Single biggest remaining ship risk: P19/P20 preserve the frozen metadata oracle while weakening runtime semantics outside that oracle, especially capability negotiation or decoded argument/session shapes that default to “covered”, “no delta”, or granted.

What’s now solid: stale-branch handling, network e2e demotion to cooperative smoke, standing frozen oracle strategy, Q-09 narrowing, Q-06 no-longer-type-only treatment, and owner-only final promote.