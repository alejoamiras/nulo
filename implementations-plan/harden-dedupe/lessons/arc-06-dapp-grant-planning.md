# Arc 6, dapp-grant-planning: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh): REVISE.** It found one blocker, three should-fix findings and two nits, all adopted (see the batch plan's Decisions). The blocker: a malformed held grant is storable, because the row schema checks a grant only as a non-null object and the session writers store unprojected grants. Routing `contractsRequestCovered` through `inAddressList` would therefore change a reachable `TypeError` text. Its probe produced both texts.
- **Opus panelist: APPROVE** with text corrections. It judged the error-text difference unreachable. The driver sided with Codex: in a no-behaviour-change program the stricter reading is the safe one.
- **The four Asks:** both legs agreed on all four. `runPopupOperation` is dropped to the follow-ups, no empty-name guard is added to coverage, `refusedInBatch` is adopted with a derived `Set`, and the matchers are exported from `method-scope-checkers.ts`.

## Build

- **Engine-specific `TypeError` text.** The unit suites run on Bun, which is JavaScriptCore, so two pins had to be written engine-independently:
  - **The malformed held grant.** JSC appends the transformed source, including vite's `__vite_ssr_import_N__` names, to `e.contracts.some is not a function`. That suffix would change when the code moved to a new module even though the expression did not. The test pins the class and the leading expression text (`startsWith`), which holds on V8, JSC and SpiderMonkey alike.
  - **The `{ toString: "x" }` sender.** JSC says `No default value`, where V8 says `Cannot convert object to primitive value`. The expected error is computed in the test by running `String()` on the same value, which pins that the throw is the engine's own conversion error, raised before account resolution.
- **A store note pins dispatcher line numbers.** `apps/extension/scripts/store-listing.test.ts` requires every `path:line` citation in `apps/extension/store/remote-code.md` to fit inside its file. The move shortened `dispatcher.ts` to 1,232 lines, so the note's `:1660-1667` citation failed `test:all` and `audit:vue`. Its own commit repoints both citations (`:1099-1106` for the registerContract operation, `:604-628` for the silent createAuthWit path). The old `:1660-1667` was already about six lines off its target before this arc.
- **Byte-identity of the move:** a scratch script took the 534-line span from the parent commit's `dispatcher.ts` and the new module's body, stripped the import block and the leading `export ` keywords, and diffed them: 0 diff lines. The run was repeated against `HEAD~1` after the commit.
- **Imported back by `dispatcher.ts`:** 10 values plus the 2 types `CapabilityPlan` and `CapabilityManifest`. It also re-exports `dataFieldsCovered`, `projectKnownCapability` and `ungrantedAccounts`, so `src/index.ts` and every test import are untouched.
- **Frozen tests:** `git diff <phase-1>..HEAD -- '*.test.ts' packages/wallet-bridge/src/index.ts` shows only `fee-detection.test.ts`, which lost its import of the deleted function and that function's block.
- **Phase 1 passed on the unchanged code:** 85 new wallet-bridge cases and 17 journal rows.
- **Mutation check:** each of the ten mutations was applied alone, the file was restored from an in-memory copy (never with git), and every one turned at least one test red:
  1. `===` in place of `sameFieldAddress`: red on the case-changed and malformed-address rows.
  2. Dropping the function wildcard: red on the wildcard-function row.
  3. Dropping `Array.isArray`: red on the address-book-only row.
  4. Dropping `e[flag] &&`: red on the flag-mismatch row.
  5. Marking `grantPublicAuthwit` `refusedInBatch`: red on the registry-wide table and the drift pin.
  6. Moving the check into the dispatch loop: red on two ordering rows.
  7. `!from` in place of `== null`: 9 wallet-bridge and 3 journal rows red.
  8. Dropping `String()`: red on the `Fr` and `toString: "x"` rows on both sides.
  9. Dropping the NO_FROM test: 3 wallet-bridge and 2 journal rows red.
  10. Keying the entrypoint on `requestedSenderOf`: 6 sendTx rows red.
- **Duplication (scoped script):** unchanged at 3,829 duplicated lines and 216 clones. The total fell from 218,422 to 218,390 lines (1.7530 % to 1.7533 %). The copies removed are shorter than jscpd's 50-token floor, so the script cannot see them; the arc's gain is the single predicate, not the metric.
- **Stale line pointers left alone:** `tests/e2e/network/tx-sendTx-noFrom.test.ts:12` (`dispatcher.ts:82-88,334-348`) and `cap-request-repeat-noPopup.test.ts:13` were already stale, and both are frozen test files. The `architecture/codex-notes/` pointers name a path that moved two refactors ago.

## Local gates (arc head)

- `lint`, `typecheck:all`, `test:ci-gating` and `build` all exit 0.
- `test:all` and `audit:vue` exit 0 after the store-note commit. Before it, each had the one `store-listing` failure above.
- **Network e2e, local, at the code head:** the nine files (`batch-mixed`, `batch-partial-failure`, `meta-batch`, `cap-request-basic`, `cap-request-repeat-noPopup`, `cap-widening`, `scope-refusal`, `authwit-variants`, `tx-sendTx-noFrom`) ran through `bun run e2e:agent` with `NODE_OPTIONS=--dns-result-order=ipv4first`: 9 files and 12 tests green on Chrome, and the same on Firefox (`NULO_E2E_BROWSER=firefox`). CI's full lanes are still to run at the PR.

## Codex code review round 1: NOT CONVERGED

- **Restacked first.** Arc 7 landed ahead, so the arc was replayed onto `harden-dedupe` at `7450928c`. The one conflict was in `queued-journal.test.ts`, where arc 7's chain-id block and its `ActiveSession` import sit beside the sender table.
- **Two should-fix findings, three nits, all adopted** (see the batch plan's Decisions). The material one: a stored `scope: [null]` changed the coverage `TypeError` from `ep.contract` to `pattern.contract` on Bun once `scopeCovers` called `matchesPattern`.
- **Audit of every coverage site switched to a shared matcher.** A scratch Puppeteer probe (not committed) ran the original and shared expressions in-page on Firefox and Chrome against `null`, `5`, `{}`, `{ toString: 1 }`, `{ toString: 1, valueOf: 1 }`, `[]` and `"s"`:
  - The pattern rule differs on `null` on Bun and on Firefox (`ep is null` against `pattern is null`); V8 words both alike.
  - The address-list rule differs only on elements `String()` cannot convert, and only on Firefox (`can't convert x to string` against `item`). Bun and V8 never name the variable there.
  - Both `scopeCovers` and `privateEventsCovered` are back to their original expressions, and `matchesPattern` and `inAddressList` are private again. What Q-19 still dedupes is the one typed `grantsOfType`.
  - Lesson: a dedup that routes a throwing expression through a helper changes the error text on any engine that names the variable. Probe all three engines before calling a shared predicate equivalent; Bun alone hides the SpiderMonkey case.
- **Engine-portable pins.** Each new row computes its expected error from a reference that binds the production variable name (`ep.contract` on a null `ep`, `String(x)` and `String(item)`), so the exact class and message hold on every engine.
- **Order.** The test commit is red at its own commit on the null-pattern row, and green from the code commit on. After that commit the coverage block matches the pre-arc dispatcher exactly, comments aside (the move-check script, run against the Phase 1 commit, leaves only comment lines and the relocated `grantsOfType`).
- **Mutation:** swapping `scopeCovers` back to `matchesPattern` turns the null-pattern row red on Bun (`'ep.contract'` expected, `'pattern.contract'` received). The private-events row can go red only on SpiderMonkey; on Bun the unit suite cannot tell the two forms apart.
- **Gates at the code head:** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all exit 0. `wallet-bridge` has 596 tests, the extension 8,900. Network e2e was not rerun: the code change restores expressions the e2e already ran against before this arc.

## Codex code review round 2

- Code round 2: CONVERGED, one README nit adopted.
