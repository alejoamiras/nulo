# Phase 1 — Pin bump + CI pin dedupe

- Edits: `package.json#packageManager` → `bun@1.4.0`; `setup-bun/action.yml` version + both cache-key occurrences → 1.4.0; `pr-quick.yml` commitlint job's 11-line inline setup block (setup-bun + cache + install) replaced with `- uses: ./.github/actions/setup-bun` (checkout already precedes it); CLAUDE.md:30 pin prose now also states the local ≥1.4 minimum (lockfile v2 + `--parallel` scripts); CLAUDE.md Renovate drift note corrected — the composite is now the ONLY second pin site, and a Bun bump requires the machine bun ≥ the pinned line pre-merge.
- Gate run (isolated `~/.bun-versions/1.4.0/bin/bun`): `bun run lint:actions` exit 0 · `bun test scripts/ci-cd/` 7 pass / 0 fail (behavior-gating parses the edited workflow fine) · `grep -rn '1\.3\.14' package.json .github/ CLAUDE.md` → no matches.
- No surprises; no retries.
