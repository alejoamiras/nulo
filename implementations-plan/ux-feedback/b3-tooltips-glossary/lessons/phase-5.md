# Phase 5 · The owner's stack sign-off ✓

The owner answered the stack's sign-off page on 2026-09-28
(<https://claude.ai/artifact/WD1NGANFrHcE7fsrJKXPMp>, its `answers` store). For this batch:
"Tooltip text contrast: Pass 4.5:1", and "Everytihng else looks good." for every state it built
as recommended. The change is `100ab8eb`. The arcs above were restacked onto it and carry the
owner's two other changes, batch 4's P8 and batch 5's P11. The gate below ran once, on the stack
top, for all three phases.

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

## The gate (`df1849a2`)

Two clean detached checkouts of the stack top: the network files at retry 0, Chrome prover on, with
the `@requires-proverless` files run proverless, and Firefox proverless; smoke at its config's two
retries, which no test used.

| Step | Chrome | Firefox |
|---|---|---|
| `bun run lint` | exit 0 (2 s) | not browser-bound |
| `bun run typecheck:all` | exit 0 (24 s) | not browser-bound |
| `bun run test:all` | exit 0 (121 s) | not browser-bound |
| `bun run test:ci-gating` | exit 0 (35 s) | not browser-bound |
| `bun run build` | exit 0 (24 s) | not browser-bound |
| `bun run --cwd apps/extension build-storybook` | exit 0 (12 s) | not browser-bound |
| Network suite, retry 0, 102 files | prover on: exit 0; files 92 passed, 3 skipped of 95; tests 132 passed, 5 skipped of 137 (4,381 s). The 7 `@requires-proverless` files, proverless: exit 0; files 7 passed of 7; tests 18 passed of 18 (892 s) | proverless: exit 1; files 1 failed, 98 passed, 3 skipped of 102; tests 1 failed, 147 passed, 7 skipped of 155 (5,236 s) |
| `network/send-picker` alone, retry 0, in a third clean checkout | not run | proverless, three runs: exit 0 each; files 1 passed of 1; tests 1 passed of 1 (172 s, 158 s, 191 s) |
| Smoke (its build exit 0 / 0) | exit 0; files 38 passed, 3 skipped of 41; tests 157 passed, 7 skipped of 164 (1,090 s) | exit 0; files 39 passed, 2 skipped of 41; tests 153 passed, 11 skipped of 164 (1,322 s) |
| `bun run e2e:reap` | exit 0 | exit 0 |

Both execution canaries passed prover on in Chrome's network suite, `frozen-account-canary`
and `passkey-execution-canary` with two tests each. `cap-window` and `cap-request-rerequest`
passed in both browsers' network suites, and `onboarding-import` and `import-paths` in both
smoke suites. The Firefox canaries wait for CI's `Firefox / Run / canary / real-proving` job on
the stack top's head, which must show the substantive tests passed, retry 0, with Presto
enforced and native proofs in the server log.

Firefox's one red network file was `network/send-picker`. After Home showed the imported ALT
balance, no ALT row was visible within 15 s of the click on the picker's trigger
(`send-picker.test.ts:35`, "Waiting failed: 15000ms exceeded"). Dev's nightly failed the same way
on 2026-09-26 without this stack (run 36230567767, on `b15f5218`), then #703's CI (run
36271135463); the program plan keeps it as a follow-up. The stack changes neither the test nor
the picker's components,
`SelectTokenPopup.vue` and `SelectTokenCard.vue`. It does change the `Popup.vue` they render in:
the focus trap takes in the snack, a popup created already shown activates, and the sheet
places the snack. None of these touches the popup's slot, where the rows render. Run alone at
retry 0 in a third clean checkout of `df1849a2`, the file then passed three times, at load
averages of 116 to 132.

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
The stack changes neither test nor the modules whose imports timed out. The fix, warming each
import in a `beforeAll` with its own timeout, belongs to dev, not this stack.
