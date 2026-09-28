# Follow-ups

Open follow-ups lifted out of closing plans, one entry each, or a pointer to the GitHub issue that owns it. Read when planning; delete an entry when it resolves. A plan never closes while it still owns an open follow-up.

- **P1, the first release after the tools extraction** (from [tools-extraction](tools-extraction/plan.md), 2026-09-28). The next `release: promote dev → main` carries the tools removal, #711 and #713 to `main`, and with them the first production build of `nulo-landing` from `main` with the routes-free config. After `attach-assets`, re-run that build in the Cloudflare dashboard, confirm it succeeded, and check that `curl -s https://nulo.sh` links `releases/tag/v<version>` and that `curl -sI` returns every header in `apps/landing/public/_headers`. Delete this entry when it passes.
- **The gas link and USDC on mainnet** (owner UI calls, 2026-09-28). The fee card's get-gas link opens unleashed's testnet app on every network, on its `workers.dev` host; the mainnet USDC seed is the retired bridge's token. Revisit when unleashed has its own domain or a public mainnet bridge.

## ux-feedback: taken by a follow-up plan

The full records are in the closed plan's [Follow-ups](ux-feedback/plan.md). Delete an entry when the plan it names merges.

- `ux-owner-picks`: the incoming row's 8-character amount drops whole-number digits (`utils/amount.ts`).
- `ux-owner-picks`: History's received rows read "Token" and "+1,000,00" with no dollar value, where Home shows "TST", "+1,000" and "≈ $1,000.00".
- `ux-owner-picks`: until its tokens load, Send's token card reads "No available tokens" and a tap opens the import popup.
- `ux-owner-picks`: with no saved choice, Send and the execute card default to the first sponsor in storage order, not Nulo's.
- `ux-owner-picks`: a failed send from the wallet's own Send page reads "Reported by app" on its journal page.
- `wallet-safety-fixes`: once fees are set, the Revoke authwits and authwit-registry popups confirm on any Enter that reaches the document, so Enter on × or on a fee method sends the transaction (seen in a unit test, not yet in a browser).
- `wallet-safety-fixes`: three older `createAuthWit` refusals carry request values into Error-level logs. The owner, 2026-09-24: "Yes. Defer to afterwards."
- `wallet-safety-fixes`: `setTrustAllow` and `setTrustReject` write trust with no ownership fence after their awaits.
- `wallet-safety-fixes`: `nulo:ui:pinnedTokens@<profileId>` outlives the profile's deletion.
- `wallet-safety-fixes`: the operation journal's id comment says 128 bits, but `nextRandomId(storage, 16)` draws 64.
- `grant-check-address-case`: `matchesPattern` compares a scope's contract address by exact string (it fails closed), while the permission window's Details table merges addresses case-blind.
- `e2e-reliability-fixes`: Chrome's launch fixture can lose its scratch page when a fresh wallet's popup closes itself, and vitest 4.1.10's in-test retries cannot recover a failed fixture setup.
- `e2e-reliability-fixes`: once an attempt of `network/send-picker` has imported ALT, its retries cannot pass.
- `e2e-reliability-fixes`: two unit tests can time out on a cold dynamic import under load (`content-message-relay.test.ts`, `method-descriptors.test.ts`).
- `e2e-reliability-fixes`: `network/backup-restore-integrity` waits on public networks; its test-side fix keeps only the sandbox's account-state slice.
- `e2e-reliability-fixes`: every sponsor row in the fee menu shares the testid `send-fee-method-sponsored`.

## ux-feedback: owner decisions

- One connect window that turns into the emoji check after Allow (item 4B). The owner, 2026-09-23: "B (one connect window) is a follow-up arc, not this one". It needs its own blueprint, since it touches the verify path; round 1's "A + B" drawing is its design. [Record](ux-feedback/plan.md)
- About 45 older strings join two clauses with an em dash. The owner, 2026-09-25: "separate follow-up for those 45 older strings". Find them by scanning `apps/extension/src` for " — " outside comments, logs and thrown errors; the empty-value "—" stays, and each string's pinning test changes with it. [Record](ux-feedback/plan.md)
- The emoji-check window's header reads "NO ACCOUNT" before an account is chosen, and "chain 0" rather than the network's name on a reconnect. [Record](ux-feedback/plan.md)
- The backup import's product questions: should an import skip preloaded contracts as it skips protocol ones, and should it wait on public networks at all? [Record](ux-feedback/plan.md)
- Layout around batch 4's surfaces that predates the program: row gaps, Home's row height, the History and Settings title offsets, History's date heading, Home's section labels and Settings' account header. The owner, 2026-09-25: "(a) follow-up maybe?". [Record](ux-feedback/plan.md)
- The popup's Terms sheet sits at z-index 9000, above the snack's 2000, so a snack raised while the sheet is open stays hidden. [Record](ux-feedback/plan.md)
- A-27: which form of an unknown contract's address a screen reader hears in the permission window's Details rows. `DetailsTable.test.ts` holds it as a `test.todo`. [Record](ux-feedback/b5-permissions/lessons/phase-6.md)
- The glossary's `where` for "authorization" reads "Permission window · approval window", while the term is dotted in the permission window and in Settings → Connected apps. A copy change. [Record](ux-feedback/b5-permissions/lessons/phase-3.md)
- Whether a dApp should learn that a call was refused for scope: the error envelope gives it the unclassified message today, and classifying it is a product and privacy call. [Record](ux-feedback/b5-permissions/lessons/phase-4.md)

## ux-feedback: technical

- `presto/client.test.ts` makes the same cold dynamic import after `vi.resetModules()` as the two unit tests `e2e-reliability-fixes` takes, and timed out with them under load; that plan's record omits it. [Record](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-5.md)
- After a declined widening, the wallet answers transaction and simulation capabilities with the requested capability, not the stored grant. Enforcement keeps the older grant, so only the dApp's view is wrong. [Record](ux-feedback/b5-permissions/lessons/phase-5.md)
- `tests/e2e/scripts/check-derivation-parity.ts` clicks `import-option-private-key`, which the import picker no longer renders; nothing runs the script. [Record](ux-feedback/b1-first-run-wording/lessons/phase-2.md)
- `legal-acceptance.test.ts` parks the mouse and waits out the download snack, with a comment that predates the snack's footer inset and its first-open timer. [Record](ux-feedback/b4-snackbar-rows-arrivals/plan.md)
- Comments that cite workflow history, which CLAUDE.md § Code-comment style bans: "Phase 2 follow-up" at 12 sites in `apps/extension/src` (7 in production code), and "post-impl" review references in 35 files. [Record](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-4.md), [more](ux-feedback/b5-permissions/lessons/phase-5.md)
- CLAUDE.md's local gate table says `bun run typecheck`, which exits 127 at the repo root because `vue-tsc` is not a root dependency under the isolated linker; `bun run typecheck:all` works. [Record](ux-feedback/b2-window-placement/lessons/phase-1.md)
- CLAUDE.md § Vue component test conventions says the global `chrome` stub needs no per-test setup, but its `storage` is an empty object, so a test whose code reads storage stubs `chrome` itself. [Record](ux-feedback/b5-permissions/lessons/phase-3.md), [more](ux-feedback/b1-first-run-wording/lessons/phase-2.md)
- The e2e-testing skill's "Reproduce like CI" block runs `bun run e2e:agent` after `cd apps/extension`, but that script exists only in the root `package.json`. [Record](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-4.md)
- The chrome-extension-debug skill reads a key's fate from a bubble-phase `window` keydown listener, which an open Tooltip starves: its Escape handler stops propagation at `window` capture. [Record](ux-feedback/b3-tooltips-glossary/lessons/phase-3.md)
- Harness findings to verify and route into the e2e-testing skill: headless Chrome ignores `windows.create` sizes under the suite's `--window-size` flag and moves focus only when a window is created; `asPage()` pages get no viewport; `protocolTimeout` is set per launch and per connect call; `inject()` returns undefined for a key no global setup provided; `clickByTestId` cannot click an SVG `<Icon>`; a resting pointer gets hover without move events on Chrome; a page a failed test left open can take the next test's state; a hash change right after `openPopup` loses to the start-up route; `settleClosedPopup` returns true in the normal mid-leave state. Records: [b1 phase 5](ux-feedback/b1-first-run-wording/lessons/phase-5.md), [b2 phase 3](ux-feedback/b2-window-placement/lessons/phase-3.md), [b2 phase 4](ux-feedback/b2-window-placement/lessons/phase-4.md), [b3 phase 3](ux-feedback/b3-tooltips-glossary/lessons/phase-3.md), [b4 phase 2](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-2.md), [b4 phase 4](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-4.md), [b4 phase 6](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-6.md), [b5 phase 4](ux-feedback/b5-permissions/lessons/phase-4.md).
- plans-scaffolding's archive arcs and ux-feedback: J lists it as a closed row (completed 2026-09-28, #699 to #704, outcome in `plan.md`) and reads its `closed, awaiting archive` line as closed, `mine.ts --verify` accepts the curated entries this close-out added, and the move fixes the tree's depth in `design/shots.mjs` (`:11` `../../..` → `../../../..`; the paths at `:2`, `:3`, `:19`) and `design/mocks/build.py:9` (`parents[3]` → `parents[4]`). [Record](plans-scaffolding/plan.md)
- Firefox findings to verify and route into FIREFOX.md: BiDi cannot emulate media features, a Tab walk past the last stop leaves the document for browser UI, an overflowing scroll area becomes a Tab stop, and `windows.getLastFocused` ignores `windowTypes`. For the aztec-update skill: a local Firefox prover-ON run without Presto proves in WASM and overran `sendTransfer`'s 300 s wait under load (cause not established). Records: [b1 phase 5](ux-feedback/b1-first-run-wording/lessons/phase-5.md), [b2 phase 3](ux-feedback/b2-window-placement/lessons/phase-3.md), [b3 phase 3](ux-feedback/b3-tooltips-glossary/lessons/phase-3.md), [b3 phase 4](ux-feedback/b3-tooltips-glossary/lessons/phase-4.md), [b5 phase 9](ux-feedback/b5-permissions/lessons/phase-9.md).
