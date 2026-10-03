# Arc 19, dapp-windows: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh) and an Opus pass both returned REVISE.** Both found the dedup sound. The reconciled revisions are recorded under the batch plan's Decisions. The ones that changed the build:
  - **The json/logger guard left the arc** and is now arc 19b.
  - **Q-07 (d), `isApprovalCancelled`, is declined.**
  - **The slow path is pinned.** The tick at which `untilSessionChecked` resumes is now a literal, and a mutant that removes `stop()` must turn the watcher-evaluation count red.
  - **The worker's refusal path carries microtask markers.** A mutant that adds an `await Promise.resolve()` before the refusal `return` must be caught.
  - **The screenshot surfaces grew:**
    - `send_transaction` without an embedded fee;
    - discover's waiting state after Allow;
    - an origin with `:8443`;
    - an explicitly untrusted reconnect;
    - the queue-full path, asserted on the real worker.

## Build

- **Phase 1 (`a8dc2c19`) passed on the unchanged code.** It touches five test files:
  - appended: `useDappHostname.test.ts`, `useDappApprovalWindow.test.ts` and `execute/index.test.ts`;
  - new: `verify/index.window.test.ts` and `background.verify-reservation.pins.test.ts`.
  - Each existing path was checked with `ls` and `git status` before any write.
- **The worker's microtask rungs were observed, not guessed.** The first literal guesses were wrong. The test now dumps the observed effect order once, and the pins are copied from that dump.
- **The Warn filter needs its level prefix.** The recording logger also captures the Info line `Discovery rejected (pending popup…)`, so the filter matches on `startsWith("2:")`, not on the text.
- **Phase 2 (`77969642`) touched no test file.** The diff between the two phase commits lists:
  - the five source files;
  - the new `utils/close-current-window.ts`;
  - the two regenerated auto-import declaration files.

## Mutation check

- **Method:** 26 mutants, each applied alone to a copy of the Phase 2 file. Each ran only the tests the plan names for it, and the file was restored from a scratch copy, never with git.
- **Result: 25 of 26 killed.** The survivor is the equivalent mutant the plan declares: dropping `immediate: true`. The caller guarantees `false` when the watcher is created, so the watcher fires on the next change either way. The killed mutants:
  - **verify:** shows the raw `url`; its flag is fixed `false`; the flag and hostname are swapped;
  - **hostname composable:** drops the `xn--` test; drops the >127 loop; makes the label test case-insensitive;
  - **`closeCurrentWindow`:** drops the id guard; calls `getCurrent(cb)`;
  - **session wait:** awaited without the caller's test, once in verify and once in the hook; `untilSessionChecked` made `async`; `stop()` removed;
  - **worker:** either site drops the refusal `return`; the refusal check is removed; the texts are swapped; the log is skipped; `consumesToken` or `needsWindow` is flipped; `admitVerifyWindow` is made `async`; `await Promise.resolve()` is added before the refusal `return`;
  - **execute:** either send label is removed; `feeSettings` or `pushUniqueAccount` is dropped from the arm.
- **An ambiguous anchor skips a mutant without saying so.** The first anchor for `approveAfterPopup` also matched inside the `runDiscoveryPopup` line, so the replacement could not apply and the mutant never ran. Re-anchored on `\n\tapproveAdmitted`, it ran red. A mutation script should fail when an anchor does not match exactly once.

## Gates

- **Phase 2 head (`77969642`):** `lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` (which includes `build`) all exit 0. The build left no further change to the generated declaration files.

## Screenshots

The program's local harness compared base `0a9e48f9` with head `77969642`. It ran Chrome and Firefox (153.0.4), dark and light, at 360×600@2x, on the real build, then a `--stability` pass on the head.

- **Batch `dapp-windows`: 44 of 44 identical, and 44 of 44 stable.** The windows open on stubbed ports. The 11 surfaces:
  - **verify:**
    - a new connection from `https://dapp.example:8443`;
    - an untrusted reconnect sharing an account;
    - a punycode origin with its warning line;
  - **discover:** ready; Allow pressed and waiting for verify capacity;
  - **capabilities:** ready;
  - **network-unavailable:** ready;
  - **execute:**
    - `aztec_sendTx` with an embedded fee, and self-pay;
    - `send_transaction` with an embedded fee, and without one (the selectable fee card).
- **Batch `dapp-windows-queue`: 4 of 4 identical, and 4 of 4 stable,** on the real worker against a served playground.
  - **Setup:** the playground origin holds both verify windows on chain 0 and queues four reconnects. A tab asking for the Testnet chain then gets the connect window, which is the shot.
  - **The assertion ran in all 12 captures:** after Allow, the window closes within 10 s, the verify-window count stays at 2, and the tab never connects.
  - **The refusal reason is inferred, not observed.** `rejectDiscovery` sends the dApp nothing it can read, and the worker's Warn line is reachable only through the log viewer. The other exits are ruled out:
    - an admitted connection opens a third verify window;
    - `expired` cannot fire inside a 55 s deadline;
    - the waiting window closes only in the worker's `finally`.
- **Head images were opened by eye, not trusted from the report.** They show the punycode warning, the busy Allow, the fee card's chevron on `send_transaction` without a fee, and the reconnect's "Account 1" strip.
- **Harness gotchas:**
  - **`innerText` applies `text-transform`.** The identity strip's "Account 1" reads `ACCOUNT 1`, so a text check reads `textContent` instead.
  - **`inject("playgroundUrl")` returns `undefined` under the smoke config.** It does not throw, so `openPlayground`'s env fallback never runs. The queue surface builds its URL from `PLAYGROUND_URL` itself.
  - **A relative log path breaks a child with its own `cwd`.** The playground child runs in `PG_DIR`, so its relative stdout path fails as `ENOENT … posix_spawn 'bun'`, which looks like a missing binary.
  - **A 60 s lock retry loses to other agents' runs.** A 5 s retry took the lock on the next free slot.
