# Phase 4 · Arc gate and review

## Codex fix loop (`/codex high`, GPT-6 Astra)

| Round | Verdict | # | Severity | Finding | Resolution |
|---|---|---|---|---|---|
| 1 | changes-requested, confidence high | 1 | major | `fixtures/playground.ts` built `PLAYGROUND_TEST_PAGE` at module load; the smoke setup provides no `playgroundUrl`, so `inject()` returned `undefined` past the fallback's `catch` and every smoke file threw a `TypeError` importing `fixtures/extension.ts` | `dfef5f06`: `playgroundTestPage()`, built on call by `openPlayground` and the placement spec. The suggested import-regression test is **rejected**: every smoke file already imports `fixtures/extension.ts`, so the smoke suite fails loudly on this at import |
| 1 | | 2 | minor | A rejection during the placement fixture's setup (registration, the control popup, the network switch) skipped `ctx.close()` and leaked the browser | `2f43f3b3`: everything after the launch runs in a `try` whose `finally` closes the context |
| 1 | | 3 | minor | `plan.md` said a minimized anchor's bounds are refused and get the size-only retry; the adapter drops the window's state, and Firefox clamps positions | `0e70e75e`: the inference now says a minimized anchor gets no special handling and the retry runs only on a rejected position. No product change |
| 1 | | 4 | minor | Two comments in `window-placement.test.ts` restated `REQUESTED_HEIGHT` and `lastFocused` | `79b82823`: both deleted; the comment on why the anchor stays below 600 tall is kept |

Round 1's session: `01a0d5fc-1b4f-71f1-af1d-2aefc6918f86`.
