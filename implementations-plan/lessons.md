# Lessons

Curated gotchas promoted out of closed plans, read at the start of every task so the same dead end is never walked twice. One line per entry, each linking its evidence: an archived lessons log or a permalink. The budget is 8 KiB; a new entry deduplicates against the rest and retires what it supersedes, and anything tied to a tool version carries its date.

## Tooling

- Bun trusts a warm cache (1.4.2, 2026-09): it never re-checks the lockfile's sha512 against its cache, so a poisoned cached file survives `bun install --frozen-lockfile`; a job that produces release bytes restores no cache ([evidence](tools-extraction/lessons/phase-2.md)).
- Under `bun test`, loading `@aztec/*` in process throws from `expect.addEqualityTesters` on a cold transpiler cache; run such checks in a `bun` subprocess ([evidence](tools-extraction/lessons/phase-2.md)).
- Tests with a timing budget (`content-message-relay`, `presto/client`, `e2e/config`) time out under the full parallel `test:all` / `audit:vue` load; rerun the file alone before treating it as breakage (2026-09) ([evidence](tools-extraction/lessons/phase-1.md)).

## Cloudflare

- A Pages project with many deployments cannot be deleted (error 8000076): purge its deployments with `?force=true` first; the active production one goes with the project (2026-09) ([evidence](tools-extraction/lessons/phase-2.md)).
- wrangler reconciles custom domains only when `routes` lists one (4.129.1, 2026-09), and Workers Builds takes only user tokens: with a Workers-only build token, attach the domain outside the config and commit no `routes` ([evidence](tools-extraction/lessons/phase-2.md)).
- Cloudflare Access protects a `workers.dev` host as a self-hosted app with no zone involved ([evidence](tools-extraction/lessons/phase-2.md)).
- An agent session's permission layer refuses DNS and domain changes, and Pages project deletes, even with a token in hand: plan them as owner steps ([evidence](tools-extraction/lessons/phase-2.md)).
