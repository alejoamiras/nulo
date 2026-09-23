# Fable audit — firefox-first-class-spike

## Round 1 — plan v1 (2026-09-18)

Same-family leg (`Plan` subagent, Fable 5.1), read-only, full audit packet. Findings condensed from its report, evidence kept; the adopted-vs-rejected log is in `plan.md` → Decision ledger.

**Verdict:** conditional approve (with conditions: (1) replace `continue-on-error` on reusable-workflow call jobs with a mechanism GitHub supports; (2) rewrite the Phase 7 dispatch gates, which cannot go green before merge; (3) give `ExtensionContext` a `close()` seam for the 36 `browser.close()` sites; (4) test `targets()`/`waitForTarget` on BiDi before committing to the `pages()` rewrite; (5) fix the Fact 9 check names and the invalid gate commands; (6) decide whether the portable heavy/canary lanes run on Firefox).

### 1. Adversarial / security
- **[High]** `continue-on-error` is not available on `uses:` jobs; every existing use is on a `steps:` job (`nightly.yml:241,259`, `pr-quick.yml:290`, `_lint-and-typecheck.yml:102`). `pr-extension-network-e2e.yml:20-22` has workflow-level `cancel-in-progress`. Put Firefox PR legs in their own workflow files, which also keeps edits out of files whose `jobs.status` is pinned by `scripts/ci-cd/behavior-gating.test.ts:83-97`.
- **[High]** Dispatching `release.yml` on a branch ref runs branch-authored workflow code up to `attach-assets` (`environment: production`, `release.yml:266`); `dry_run` is only an env flag read inside steps.
- **[Medium]** Three unauthenticated loopback ports, not two: geckodriver HTTP, BiDi websocket, and Marionette (chosen by geckodriver outside the port registry). geckodriver's Host/Origin checks stop the playground page; any local process can still reach it. Keep funded keys out of Firefox runs.
- **[Medium]** The PRF fallback does not pin the assertion to the credential just created and returns `runGet`'s possibly-undefined `userHandle` (`passkey-ceremony.ts:121-122`). Assert `rawId` equality; return the caller's handle. No downgrade found. Firefox users see two prompts.
- **[Low]** The `webauthn_enable_softtoken` negative grep protects nothing: profile prefs cannot enter an extension bundle.

### 2. Assumption attack
- **Facts.** [High] Fact 9 wrong: required checks are `quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status` (`CLAUDE.md:71`, `behavior-gating.test.ts:83-85`); the proposed Firefox aggregator names break the `extension-*` rule. [Medium] Fact 1's line reference holds only at HEAD. [Medium] Finder and literal counts too low: `popups.ts:37,41,425`, `playground.ts:239-248`, `journal.ts:116,147,302`, seven test files calling `browser.targets()` directly (e.g. `network/session-tabClose.test.ts:43`, `network/concurrent-sendtx.test.ts:93`, `network/connect-deny.test.ts:41`), `onboarding-tab.test.ts:279` (`waitForTarget`); extra `chrome-extension://` literals at `migration.test.ts:133`, `onboarding-tab.test.ts:129,272,283`. [Medium] `PasskeyAuthSetup` exposes `anchorSession: CDPSession` and `perPopupSessions` (`fixtures/passkey.ts:93-99`); no test reads them — remove rather than keep.
- **Inferences.** [High] I5 false for the gate: `release.yml` checks out the tag, `nightly.yml` always uses `origin/dev`; the Firefox jobs would run a tree without the Firefox fixtures. [High] I2 unsafe: CDP `pages()` is async, initialises a `Page` per target, can throw on a closing window, polls where `waitForTarget` reacts; `callExpectingNoPopup` needs `targetcreated`; `captureTargetInventory` needs a synchronous read (`journal.ts:294-303`). [Medium] I6: `cancel-in-progress` does not reduce job starts.
- **Asks.** Surface that `passkey-execution-canary` is Chrome-only (passkey-signed execution gets no Firefox network coverage); surface the heavy-lane decision; surface the two-prompt UX.

### 3. Implementation critique
- **(a) [High]** The `pages()` rewrite may be unnecessary: Puppeteer 25's BiDi browser implements `targets()` and re-emits `targetcreated`/`targetdestroyed` (`puppeteer-core/lib/puppeteer/bidi/Browser.js:198-205,302`). Unverified at runtime; add `targets()`, `waitForTarget`, `type() === "page"` to the probe. If they pass, the refactor shrinks to `extensionUrl()` plus moving the launcher and Chrome's finders stay byte-identical.
- **(b) [High]** No teardown seam: 36 `browser.close()` sites in 16 files; on BiDi `close()` kills Firefox and orphans geckodriver and the session. Add `ctx.close()`.
- **[High]** Ownership bookkeeping does not fit: `OwnedState` is written only by network global-setup (`lockfile.ts:56-61`); smoke writes no lock; `launchExtension` runs per test in forked workers; `newDataDir("firefox-profile")` does not exist; `reap.ts:48` matches only `nulo-aztec-*`. Needs a per-launch pid-file scheme and a second reap pattern.
- **(c)** One env var is right.
- **(d) [High]** Phase 4 gate weak: one shard of five with local `retry: 2` vs CI `retry: "0"`. `bun run e2e:agent --shard=1/5` passes `--shard=1/5` to `grep` as a file target (`agent.sh:22-28`), the error is swallowed and the proverless guard is bypassed; CI uses `NULO_E2E_PROVERLESS=1` plus `exclude_files`. Dispatch `pr-extension-network-e2e.yml` (`workflow_dispatch`, line 4) on the pushed branch instead.
- **(e)** [Medium] Arcs revert only top-down. [Medium] A probe under `tests/e2e/network/` is picked up by Chrome's shard glob (`vitest.e2e.network.config.ts:14`); `e2e:agent` builds only `dist/chrome` (`agent.sh:92,105`). [Medium] "Chrome-only heavy lanes" is a mislabel: `fee-methods`, `selfpay-phase`, `concurrent-sendtx-confirm`, `transfers`, `tx-sendTx-default` are portable; skipping them means Firefox never produces a real proof in CI.
- **(f)** Invalid commands: the `behavior-gating` test imports `bun:test` → `bun run test:ci-gating`; the `e2e:agent --shard` forms lack proverless + excludes; both Phase 7 `gh workflow run` gates unreachable; `agent.sh` hardcodes `dist/chrome` in ~10 assertions (lines 111-179).
- **(g) [High]** Temporary add-on restart: set `extensions.webextensions.keepStorageOnUninstall` and `keepUuidOnUninstall`; pin `extensions.webextensions.uuids` to a fixed UUID so the origin is deterministic. That removes "discover the origin from the onboarding tab", which fails on a relaunch with no onboarding tab (`migration.test.ts:131`).
- **(h) [Medium]** CI cost: ≥5 extra 30-minute jobs, each with a full 16 GB vite build, per network-touching PR. Real mitigations: `needs:` on Chrome smoke success, skip draft PRs.

### 4. Competing outlines
B and C remain worse given the owner decisions. **Fourth shape, D:** keep target-based fixtures on both protocols, build `firefox.ts` + classic authenticator + pinned UUID, put Firefox lanes in separate workflow files — smallest blast radius on the required Chrome gates.

### Looks fine
PRF fix direction; the `session.new` shim; not copying the `pkill` cleanup; `setup-presto-server` as the template; env var over vitest projects; the Chrome-only set of nine files; `lint:actions`, `audit:vue`, `build:firefox` exist; `web-ext lint` via `bunx`.
