# Plan 6 — faucet-cluster — lessons (phase 1: both PRs)

Round-2 plan 6 of 7. PR-a `createAztecWalletSession.ts` (BL/E, 74 → 70), PR-b the fuel/withdraw/claim/backup
cluster (BL/C, 70 → 62). One codex session for the plan (blueprint audit → PR-a review → PR-b review).

## Codex consults

| Turn | Ask | Verdict | Folded |
|---|---|---|---|
| 1 | Blueprint audit | conditional approve | (a) the awaited `settleDiscoveryEnd` would add a microtask on the picker / no-wallet paths → sync classifier, `await proceedWith` + throw stay in `connectImpl`; (b) a defaulted Permit2 token lets a future caller silently approve `L1_USDC` → `token` REQUIRED in a named object, identity-pinned across allowance/approve/typed-data/witness/calldata; (c) share the router leg only through hash persistence, receipt→parse stays per caller; (d) `buildFuelClaimInteraction` stays `async`, `stop()` creates a fresh Error per call; (e) F6 corrections — `fuel-smoke` mocks `useFuelFlow`, bridge-core already has a 13-test `backup.test.ts`, counts 21/14/2/51; (f) pins: 28-key surface, session isolation, hostile remembered map (mandatory), fuel failure classification on five paths, stop-precedence conflicts, backup complements in bridge-core; (g) residue surfaced, not changed: `preferred-wallet.id` unbounded on read, provider announcements unbounded |
| 2 | PR-a review | approve | non-blocking: the isolation pin samples public state only (timer/unsubscribe/provider-key/notice-counter isolation is by construction inside `createSessionState`); don't describe the storage pins as covering ALL hostile wallet storage |
| 3 | PR-b review | — | — |

## Lessons

- **A "sync in substance" async function must stay async.** Changing `buildFuelClaimInteraction` to a sync signature would turn thrown parsing errors from rejections into synchronous throws at the call site — signature is contract.
- **State object + module functions beats a class here.** The factory returned a plain object of functions; `SessionState = ReturnType<typeof createSessionState>` keeps every `Ref` type inferred exactly (no hand-written `Ref<UnwrapRef<...>>` mismatches) and the surface pin (`Object.keys` in order) proves the 28 members survived.
- **Compute keys before the ref that reads them.** The old closure had a documented TDZ hazard (`preferredWalletName`'s initializer called a hoisted function reading a `const` declared above it). `readPreferredFor(storageKey)` as the primitive removes the hazard instead of preserving it.
- **The Write tool renders `\uXXXX` escapes as raw bytes.** Rewriting the file turned the alias-sanitizer regex into literal control characters (grep then treats the file as binary — use `grep -a`). Restore such lines byte-exact from git (`git show HEAD:path | grep`) and assert zero control bytes before committing.
- **Codex's recon corrections were real.** The Explore recon missed `packages/bridge-core/src/backup.test.ts` (its `find -iname "*backup*"` claim was wrong) and mis-counted three suites; verify absence claims with a second search before writing a plan that "adds" coverage.
- **Guard precedence is a contract worth pinning.** When a validator or a fail-closed builder splits into per-branch helpers, the ORDER of its guards is what the message-level contract users see; conflict cases (several guards true at once) pin it in a way single-guard tests cannot.

## Gotchas (tooling)

- The Bash tool's cwd persists; a `cd apps/faucet` breaks later repo-relative `git add` paths (`apps/faucet/apps/faucet/...`). Use `git -C <root>` or absolute paths.
- `gh pr checks --json` omits the aggregator check (`smoke-e2e-status`) while its rerun is in progress; poll for the job name instead of the aggregator when watching a rerun.
