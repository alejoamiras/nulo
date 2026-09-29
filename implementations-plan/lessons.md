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

## CI & gates

- On a `gh stack` program the plans gate runs on every arc head, so an arc cannot link a plan file that a later arc adds: name it as text, and let the arc that adds the file restore the link. [Evidence](ux-feedback/lessons/final-pass.md)
- The extension's unit vitest auto-imports only `vue` and `vue-router` and registers no components, unlike the build: an auto-imported composable or store throws "is not defined" and a bare component tag stays unresolved, so import them or pass `global.components`. [Evidence](ux-feedback/b5-permissions/lessons/phase-7.md), [more](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-3.md)
- The tracked declarations in `apps/extension/src/types/` regenerate only when Vite builds or serves (vitest runs with `dts: false`), so local gates can pass on a stale copy and CI's build job then fails on the diff: build before you commit a new auto-imported export or component. [Evidence](ux-feedback/b5-permissions/lessons/phase-4.md), [more](ux-feedback/b3-tooltips-glossary/lessons/phase-3.md)
- Under `vi.useFakeTimers()` a natively dispatched event runs only the first Vue listener it reaches, since runtime-dom skips listeners attached no earlier than the event's `_vts`: dispatch with `wrapper.trigger`, which stamps `_vts` 1 ms ahead, or advance time 1 ms first (Vue 3.5.41, 2026-09). [Evidence](ux-feedback/b3-tooltips-glossary/lessons/phase-1.md), [more](ux-feedback/b3-tooltips-glossary/lessons/phase-4.md)

## Extension runtime

- A wire-shaped field fixture must stay below the BN254 modulus (`0x3064…`): `0x` + `aa` × 32 is above it, so the capability validator refuses it as malformed, while `0x` + `0a` × 32 passes. [Evidence](ux-feedback/b5-permissions/lessons/phase-6.md)

## Authorization checks

- Validate both sides before comparing normalised keys: `key(a) === key(b)`, where `key` returns `undefined` for bad input, matches two bad inputs, and plain string equality let a malformed listed contract match an identical call target ([red run](grant-check-address-case/lessons/phase-1.md)).
