# Lessons

Gotchas from closed plans, read before every task. One line each, linking its evidence; under 8 KiB, so a new entry dedupes, retires what it supersedes and dates its tool version.

## Bun & deps

- Bun never re-checks a warm cache against the lockfile's sha512, so a poisoned cache survives a frozen install: a job making release bytes restores none (1.4.2, 2026-09). [Evidence](archive/tools-extraction/lessons/phase-2.md)
- An incremental `bun install` leaves a removed dependency on disk, so a leftover import passes locally and fails on CI: prove removals on a fresh install (1.4.2, 2026-09). [Evidence](archive/vitest-vite8-dedupe/lessons/phase-2.md)
- Under the isolated linker `bunx <tool>` at the repo root sees only root dependencies and fetches the rest from npm `@latest`, past the lockfile and age gate: use workspace scripts (1.4.2, 2026-10). [Evidence](plans-scaffolding/lessons/phase-7.md)
- When one `bun run --parallel` leg fails, Bun SIGINTs the rest, so `audit:vue` can exit 130: the cause is the leg that printed `Exited with code N` (1.4.2, 2026-09). [Evidence](archive/isolated-linker-store/lessons/phase-1.md)
- `@aztec-labs/*` throws from `expect.addEqualityTesters` in a cold-cache `bun test` (use a `bun` subprocess; 6.0.0-rc.1, 2026-10); bb.js threw `std::bad_cast` in jsdom (use `// @vitest-environment node`; 5.2.0). [Evidence](archive/tools-extraction/lessons/phase-2.md), [more](archive/harden-2026-09-remediation/lessons/b4.md)

## CI & gates

- The root `test`, so `audit:vue`, runs only `apps/extension`; CI also runs `test:all`, `test:release` and `test:ci-gating`: run them for changes elsewhere. [Evidence](archive/harden-2026-09-remediation/lessons/b1.md)
- `bun run lint` prints Biome's first 20 of 31 standing diagnostics, so a new error can hide behind `Found 1 error`: rerun on the changed files (2.5.13, 2026-09). [Evidence](archive/wallet-error-resilience/lessons/phase-1.md)
- `vue-tsc` skips an SFC whose script lacks `lang="ts"` (149 of the extension's 205, 2026-09), so a bad prop or field there passes `typecheck:all`. [Evidence](archive/storage-migration-backup/lessons/phase-6.md)
- `src/types/auto-imports.d.ts` regenerates only under Vite and keeps a removed export's global: build before committing an auto-import; delete a stale line by hand (unplugin-auto-import 21.1.0, 2026-09). [Evidence](archive/send-amount-exact/lessons/phase-8.md)
- Vue unit tests (3.5.41, VTU 2.4.11, 2026-09): only `vue` and `vue-router` auto-import; `@nulo/design`'s `Button` recurses unless stubbed; fake timers run a native event's first listener only; a second `mount` strips the first's stubs; a `defineModel` write reads back late. [Evidence](archive/ux-feedback/b5-permissions/lessons/phase-7.md), [more](archive/ux-feedback/b3-tooltips-glossary/lessons/phase-1.md)
- A test that something never happens, or that accepts `ok` or `error`, passes code that always fails: pair it with a success-path control. [Evidence](archive/connect-window/lessons/post-impl.md)
- `describe.skipIf` still runs its body at collection, so a top-level read of build output fails the file where nothing was built: read it inside `it` or a hook. [Evidence](archive/swap-fuel/lessons/phase-6.md)
- Timed tests (`e2e/config`) time out under parallel `test:all` load: rerun the file alone; a cold dynamic import in a timed body is one cause. [Evidence](archive/e2e-reliability-fixes/lessons/phase-2.md)

## Git & GitHub

- A `pull_request` run takes workflows from the merge ref but builds `head.sha`, so a fix `dev` gained after the branch point is absent: merge `dev` before debugging. [Evidence](archive/dedup-ledger/README.md)
- A job needing a skipped job is skipped unless its `if` calls a status function, and `always()` also runs after a cancel: guard side effects with `always() && !cancelled()`. [Evidence](archive/release-pipeline-hardening/lessons/phase-1.md)
- `git diff -M` pairs renames by shared lines, so R100 is not byte identity (compare blob ids and modes); a pathspec cuts the diff before pairing, splitting a move across it into a delete and an add. [Evidence](plans-scaffolding/lessons/phase-5.md), [more](plans-scaffolding/lessons/phase-7.md)
- A `gh stack` runs the plans gate on every arc head, so an arc cannot link a later arc's file; after the squash merge, merging `dev` into a branch on the old head is add/add. [Evidence](archive/ux-feedback/lessons/final-pass.md), [more](archive/amount-honesty/lessons/phase-3.md)

## Extension runtime

- A popup-to-background call rejects after 60 s unless its client overrides `getRequestTimeoutMs`, so a call that waits on a proof fails while the send lands. [Evidence](archive/e2e-reliability-fixes/lessons/phase-6.md)
- `PopupManager` mounts every registry popup at start, locked or not, and never unmounts one: setup work must wait for `show` or sit behind a `v-if`. [Evidence](archive/home-holdings-pin/lessons/post-impl-arc-B.md)
- `EventHandler.invoke` drops an async handler's promise: awaiting it waits for nothing, a rejection escapes, and cleanup chained on an event is fire-and-forget. [Evidence](archive/backup-restore-corruption-fix/lessons/phase-5.md)
- Moving a span into an awaited helper, as complexity fixes tend to, adds a microtask that breaks a span which must finish in one tick: keep it inline. [Evidence](archive/approval-scope-follow/lessons/phase-5.md)
- A typed error survives only hops that name it: `walletErrorFromPayload` and `classifyOperationCatch` pass listed codes, `viaPxe` rethrows `Error`: register the code. [Evidence](archive/harden-2026-09-remediation/lessons/b3.md)
- EntityStorage hides a row it cannot decode from `getAll()`, so a purge, dedupe or max+1 id over decoded rows misses it: key off `getKeys()`. [Evidence](archive/backup-restore-security-hardening/lessons/phase-1.md)
- The local network's chain id is 0, so a truthiness guard on `chainId` skips the chain every network e2e runs on: test `chainId === undefined`. [Evidence](archive/ux-owner-picks/lessons/phase-2.md)
- An error message carries text the log redactor never sees (`JSON.parse` quotes its input): log a fixed failure category, never the message. [Evidence](archive/backup-log-hygiene/lessons/arc-3-call-sites.md)
- Classify a dApp call by address, selector and arguments, never its dApp-written name; validate both sides before comparing normalised keys, or two bad inputs match. [Evidence](archive/dapp-preexisting-fee/lessons/phase-1.md), [more](archive/grant-check-address-case/lessons/phase-1.md)
- A MAC binds only what it names, and a row's stored `id` moves with the row: anchor it on the storage key, and on a MAC failure refuse, never self-heal. [Evidence](archive/mac-identity-binding/lessons/phase-1.md)

## Aztec

- Aztec 5 mints a block only when a tx is pending, so a helper that waits N blocks or makes one with `.simulate()` hangs on a quiet sandbox: send a real tx. [Evidence](archive/aztec-5.0-upgrade/lessons/phase-6.md)
- Blocks above the proven tip can be pruned and a symbolic tag can name another fork per call: pin reads to one block hash; reconcile what was recorded above the tip. [Evidence](archive/incoming-public-transfers/lessons/phase-5.md)
- The node client retries a failed POST but not a 4xx refusal, so a refused retry can hide a send that landed; it also resolves `null` as `undefined` (6.0.0-rc.1, 2026-10). [Evidence](archive/failed-send-check/lessons/phase-7.md)

## Agent tooling

- The agent's Bash tool evals each command left of an `&&`, where zsh ignores `set -e`; a pipe returns its last stage's status, `$FILES` stays one word. Redirect, then test each exit code (5.9, 2026-09). [Evidence](archive/stable-release-0.27.0/lessons/phase-3.md)
- `pgrep -f` matches the agent's `zsh -c` wrapper, so a teardown can kill itself: signal your launcher's pgid, never `$$`/`$PPID`. [Evidence](archive/harden-findings-remediation/lessons/phase-F.md)
- Take a red/green proof's old copy from the base SHA, never `HEAD`; rerun a red that looks environmental on the base before blaming the box. [Evidence](archive/firefox-first-class-spike/lessons/phase-10.md), [more](archive/aztec-5.0.1-line/lessons/phase-p2.md)
