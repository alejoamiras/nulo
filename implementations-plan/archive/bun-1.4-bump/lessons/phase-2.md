# Phase 2 — Lockfile v2 migration → deferred (not forcible)

- Expectation (changelog + codex + our own scratch test of a FRESH lockfile): 1.4 writes `lockfileVersion: 2`; 1.3.14 cannot read v2 (that part stays true and verified).
- Reality on an EXISTING v1 lockfile: `bun install` (1042 installs checked, "no changes") leaves v1; `bun install --save-text-lockfile` leaves v1; even a write-triggering `bun remove` in a v1 scratch project rewrites the lockfile *still as v1*. No `--lockfile-version` flag exists in `bun install --help`. Conclusion: 1.4 never migrates existing lockfiles; v2 is fresh-lockfile-only.
- The only migration route is deleting `bun.lock` and re-resolving — full semver re-resolution, forbidden by this arc's resolution-neutrality rule (and it would interact with `minimumReleaseAge` across the whole tree).
- Decision: defer. Ship v1 (keeps 1.3.14 agents working — the fleet-cutover risk from the codex audit is thereby RETIRED for this PR; the machine upgrade remains for `--parallel` scripts + CI parity). The deliberate regeneration + the original tuple-diff/fixed-point gate transfer to Arc B, which regenerates the lockfile for the linker experiment anyway.
- Note for Arc B: when regenerating, expect BOTH the v2 flip AND (if catalogs/nested overrides are ever adopted) v3 — v3 is unreadable by anything <1.4.
- The pre-migration tuple snapshot (1157 entries) is parked in the session scratchpad; Arc B should re-extract fresh.
