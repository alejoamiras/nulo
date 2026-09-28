# Phase 5 · The owner's stack sign-off ✓

The owner answered the stack's sign-off page on 2026-09-28
(<https://claude.ai/artifact/WD1NGANFrHcE7fsrJKXPMp>, its `answers` store). For this batch:
"Tooltip text contrast: Pass 4.5:1", and "Everytihng else looks good." for every state it built
as recommended. The change is `100ab8eb`. The arcs above were restacked onto it and carry the
owner's two other changes, batch 4's P8 and batch 5's P11. The gate below ran on the stack top
for all three phases.

## The change

- `DottedTerm.vue` (`.definition`) and `BalanceView.vue` (`.label_text`) draw `--txt-body`
  instead of the drawn `--nulo-secondary`.
- On the bubble (`--nulo-surface-highest`), `--txt-body` measures 5.05:1 dark and 4.82:1 light,
  and `--nulo-secondary` 3.98:1 and 4.09:1. WCAG AA for this 12px text is 4.5:1.
- `packages/design/src/theme-contrast.test.ts` pins `--txt-body` on `--nulo-surface-highest` at
  AA in both themes.
- A throwaway network spec, never committed, focused Home's Private Fee Juice on Chrome at
  `49a42355` in each theme and read the bubble: text `rgba(245, 240, 230, 0.6)` on
  `rgb(54, 52, 51)` dark, `rgba(0, 0, 0, 0.58)` on `rgb(220, 217, 211)` light. Its captures are
  on the sign-off page.

## Review

A codex session at high (`01a0e7ab-…`) read the three changes and the restack.

- Round 1: "No material findings; three comment/documentation nits." All three were taken. This
  arc's comment lost its design history. Arc 4's comment had named a screen that confirms
  nothing. The program plan's "opens no snack" became "no success snack", since the import form's
  "Error is copied" stays.
- Round 2: "No material findings or further nits."

## The gate (`df1849a2`, then `9900de28`)

Two clean detached checkouts of `df1849a2`: the network files at retry 0, Chrome prover on with
the `@requires-proverless` files proverless, and Firefox proverless; smoke at its config's two
retries, which no test used. The six local rows are not browser-bound, so they ran once, in
Chrome's checkout.

| Step | Result |
|---|---|
| `bun run lint` | exit 0 (2 s) |
| `bun run typecheck:all` | exit 0 (24 s) |
| `bun run test:all` | exit 0 (121 s) |
| `bun run test:ci-gating` | exit 0 (35 s) |
| `bun run build` | exit 0 (24 s) |
| `bun run --cwd apps/extension build-storybook` | exit 0 (12 s) |
| Chrome network, prover on, 95 files | exit 0 (4,381 s) |
| Chrome network, the 7 `@requires-proverless` files, proverless | exit 0 (892 s) |
| Firefox network, proverless, 102 files | exit 1 (5,236 s) |
| Chrome smoke, after its build exited 0 | exit 0 (1,090 s) |
| Firefox smoke, after its build exited 0 | exit 0 (1,322 s) |
| `bun run e2e:reap`, in each checkout | exit 0 |

Files, then tests:

- Chrome network, prover on: 92 passed and 3 skipped of 95; 132 passed and 5 skipped of 137.
- Chrome network, proverless: 7 passed of 7; 18 passed of 18.
- Firefox network: 1 failed, 98 passed and 3 skipped of 102; 1 failed, 147 passed and 7 skipped
  of 155.
- Chrome smoke: 38 passed and 3 skipped of 41; 157 passed and 7 skipped of 164.
- Firefox smoke: 39 passed and 2 skipped of 41; 153 passed and 11 skipped of 164.

Then, on Firefox, proverless at retry 0:

| Run | Result |
|---|---|
| `send-picker` alone, a third clean checkout of `df1849a2`, three runs | exit 0 each (172 s, 158 s, 191 s) |
| The whole suite on `9900de28`, in three shards run at once | exit 0 each (2,053 s, 2,075 s and 2,170 s) |

The file's one test passed in each of its three runs, at load averages of 116 to 132.
Each shard ran in its own clean checkout of `9900de28`, with its own sandbox, and the load
average read 124 to 131 as they ended. Their file lists, balanced by each file's time on
`df1849a2`, cover the suite's 102 files once each; CI's Firefox lane splits the suite
too, into eight jobs.
The whole suite's files: 99 passed and 3 skipped of 102.
Its tests: 148 passed and 7 skipped of 155.
`9900de28` is the stack top with this gate's first records, and its code outside
`implementations-plan/` is `df1849a2`'s. The six local rows exited 0 there too.

Both execution canaries passed prover on in Chrome's network suite, `frozen-account-canary`
and `passkey-execution-canary` with two tests each. `cap-window` and `cap-request-rerequest`
passed in both browsers' network suites, and `onboarding-import` and `import-paths` in both
smoke suites. The Firefox canaries wait for CI's `Firefox / Run / canary / real-proving` job on
the stack top's head, which must show the substantive tests passed, retry 0, with Presto
enforced and native proofs in the server log.

Firefox's one red network file on `df1849a2` was `network/send-picker`. After Home showed the
imported ALT balance, no ALT row was visible within 15 s of the click on the picker's trigger
(`send-picker.test.ts:35`, "Waiting failed: 15000ms exceeded"). Dev's nightly failed the same
way on 2026-09-26 without this stack (run 36230567767, on `b15f5218`), then #703's CI (run
36271135463); the program plan keeps it as a follow-up. The stack changes neither the test nor
the picker's components, `SelectTokenPopup.vue` and `SelectTokenCard.vue`, but it changes the
`Popup.vue` they render in: the focus trap takes in the snack, a popup created already shown
activates, and the sheet places the snack. So the stack's part in the failure is not ruled
out. It is consistent with the earlier sightings, and its mechanism is not known.

## `test:all` under host load

`bun run test:all` failed twice on earlier tops of this code: `49a42355`, before arc 4's pin, and
`e41bde52`, the pin's first version. Both times the failure was vitest's 5 s default timeout
running out during a cold dynamic import inside a test body.

- `apps/extension/src/wallet/services/wallet-sdk/content-message-relay.test.ts`, both times.
  - Its first test timed out (5,014 ms, then 5,016 ms) in `freshRelay()`'s
    `await import("./content-message-relay")`, which also loads the validator and zod.
  - Vitest moved on. When the import resolved, the orphaned `registerContentMessageRelay()` pushed
    its listener into the next test's freshly reset `chromeListeners`.
  - So the second test failed too: "expected [ [Function], [Function] ] to have a length of 1 but
    got 2".
- `packages/wallet-bridge/src/method-descriptors.test.ts`, the second time: the exhaustiveness
  test's `await import("@nulo/wallet-sdk-schema-patch/register")` and
  `await import("@aztec/aztec.js/wallet")` (5,084 ms).

The host has 192 cores; its load average read 130 to 220 when checked during these runs.
Of the six `test:all` runs on this stack's tops that day, two failed: the first on
`49a42355`, which then passed a rerun at a load average of 217 and its gate chain's run, and
the only one on `e41bde52`. Both runs on `df1849a2` passed.
The stack changes neither test nor the modules whose imports timed out. A possible mitigation,
not validated, is to warm each import in a `beforeAll` with its own timeout. The relay test
resets modules before every test, so a trial must show that each test still gets a fresh
module while the import inside it gets faster. It belongs to dev, not this stack.
