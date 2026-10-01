# hygiene · recon

Read at `85c4d20f` (`dev` once #719 merged); files #719 did not touch were read at `f32b1e0a`, the same bytes. Paths are repo-relative; `e2e/` is `apps/extension/tests/e2e/`.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Run a one-time deploy + import once per file, so a retried body reuses it | #719's `altToken` file-scoped fixture, `e2e/network/send-picker.test.ts:20-37` (the in-file `base.extend` form of `e2e/network/window-placement.test.ts:42`) | **adapt**: the same fixture, parameterised by the token list. See T1 in plan.md for whether it becomes one shared factory or stays per file |
| Deploy extra tokens for the wallet's account | `deployExtraTokensForAccount` in `e2e/fixtures/aztec.ts`, loaded lazily in every caller to stay off the WASM load | reuse-as-is |
| Import a token and prove its fresh balance row | `importTokenAndWaitForBalance`, `e2e/fixtures/helpers.ts:1007-1024` (90 s freshness-gated) | reuse-as-is |
| Seed a USD quote and remount | `seedUsdQuoteAndReload`, `e2e/fixtures/helpers.ts:1026-1034` (overwrites the key, so a retry re-runs it safely) | reuse-as-is |
| Reset the pin state a failed attempt left | no helper clears pins; the key is `pinnedTokensKey(profileId)` = `nulo:ui:pinnedTokens@<id>` (`apps/extension/src/utils/profile-ui-keys.ts:6`, `:12`); e2e files already import from `@/` (`e2e/rows.test.ts:6`, `e2e/tooltips-glossary.test.ts:5`); the storage-write-from-page idiom is `seedUsdQuoteAndReload` and `seedLegalAcceptance` (`e2e/fixtures/extension.ts:189-197`) | **build new**: `clearPinnedTokens(page)` in `e2e/fixtures/helpers.ts` beside `pinFromTokenPage` / `readPinState` (`:1057-1075`); nothing today removes a storage key by prefix from a test |
| Reset holdings' sort, search and fold between attempts | component refs in `apps/extension/src/popup/components/modules/holdings/TokenList.vue:34-36`, reset on every mount; nothing persists them | not needed (a fresh popup remounts them) |
| Move a cold dynamic import out of a timed unit-test body | #719's `content-message-relay.test.ts` async `beforeEach` (`apps/extension/src/wallet/services/wallet-sdk/content-message-relay.test.ts:17-27`) | **adapt** for `apps/extension/src/presto/client.test.ts`: two module instances, and without that hook's raised 30 s budget, so vitest's 10 s hook default holds (C2 removes the relay's raise too) |
| Prove derivation parity end to end | `feeJuiceImportedExtension`, `e2e/fixtures/extension.ts:886-957` (derives the address test-side via `setupPreFundedAccount` → `e2e/fixtures/aztec.ts:540-551`, imports through `importSeed`, switches to Local, waits for `nulo:ui:activeAccount` to equal it); `e2e/network/frozen-account-canary.test.ts:109-140` (hand-rolled seed formula, set-equal to the wallet's addresses); `packages/aztec-runtime/src/account/derivation-vectors.test.ts:21-53` (reference vectors, seed → keys → address, in `test:all`). The fixture runs wherever a network file uses it; the canary runs on every required Chrome network lane | reuse-as-is: together they cover everything `e2e/scripts/check-derivation-parity.ts` checked, so the script is deleted (T2) |
| A real pointer click that fails naming its cover | `pointerClick`, `e2e/helpers/legal-drivers.ts:69-97` | reuse-as-is (it is the proof for C4) |
| Hold one service's replies in the page to force a settle race open | #719's row-40 probe: wrap the page's `chrome.runtime.connect` and queue a port's responses until a release (`implementations-plan/e2e-reliability-fixes/lessons/phase-7.md`) | **adapt** for C11 on the `price` port (`PRICE_SERVICE_NAME`, `apps/extension/src/wallet/services/price/spec.ts:1`), queueing `refreshIfStale` |
| Wait for Home's hero | `waitForHomeTotal`, `e2e/fixtures/helpers.ts:999-1002` (skeleton gone only; `fiat-display.test.ts:15-19` relies on it resolving on a true $0.00) | reuse-as-is; C11 adds a priced-hero wait inside `incoming-arrival.test.ts` instead of changing it |
| A settled signal that a quote has landed | none in the DOM: the hero's skeleton tracks balances only (`BalanceView.vue:193-212`); `balance-fiat-partial` also depends on every holding being priced | **build new**, test-local: the hero's text is a dollar figure other than $0.00 (every sandbox contract prices as USDC, `price-map.ts:44-69`), or equals the previous call's final value |
| Read a key's fate past a capture-phase `stopPropagation` | `pressEscape`, `e2e/helpers/pointer-probes.ts:67-91` (window capture listener, `defaultPrevented` read in a `setTimeout(0)`) | reuse-as-is: the chrome-extension-debug skill points at it |
| A place for Firefox behaviour rows | `e2e/FIREFOX.md` table (`:28-48`) | reuse-as-is (four rows added) |
| A place for harness gotchas | e2e-testing skill § 2 "Never bypass the helpers" (`.claude/skills/e2e-testing/SKILL.md:230-293`), § 4 "Evidence channels" (`:545-568`) | reuse-as-is (bullets added in the sections that own each helper) |
| Typecheck e2e code | nothing: `apps/extension/tsconfig.json:22` includes `src/**` only, so `typecheck:all` never reads `tests/e2e/**` | **build new**, uncommitted: a scratch tsconfig over the new fixture and its four users (plan P2 step 2) |
| Guard that a deleted script leaves no exemption behind | `apps/extension/scripts/e2e/browser-seam.test.ts:10-15` (`EXEMPT`) | adapt: drop the script from `EXEMPT` and its doc comment |

## Conventions to match

- e2e selects only by `data-testid`; no new testid is needed (the reset reads storage, the probes are uncommitted).
- A file-scoped fixture that a body requests but does not read is destructured as `altToken: _altToken` (#719's form, `send-picker.test.ts:40` on its branch).
- Lazy `await import("../fixtures/aztec")` inside the fixture, never at module top.
- Test titles and `describe` names are live descriptions; renames keep the words that say what is tested.
- A deleted comment leaves no blank ` *` line or empty block behind.
- CLAUDE.md edits follow the `update-docs` skill: the approved plan's text is the propose-and-confirm step.
- Workflow YAML edits run `bun run lint:actions`.

## Collision and dedup risks

- **#719 merged at `85c4d20f`.** It added the pattern this plan copies, ledger rows 37-43 in `e2e-testing/SKILL.md` (row 43 is C11's), a port paragraph and the scratch-page row in `FIREFOX.md` (the table moved to `:28-48`), three technical entries in `follow-ups.md` (and moved the Firefox entry's WASM sentence into the failed-send-check entry), the timing-budget line in `lessons.md`, and removed the `post-impl` line from `e2e/network/backup-migration-roundtrip.test.ts`. The plan's Facts and table rows are re-read at `85c4d20f`.
- **`fix/send-amount-exact`** shifts `AmountCard.test.ts` by about 39 lines above `:375`; the describe rename is re-located by its text.
- **`layout-polish`** (wave 2) may edit `e2e/network/home-cap.test.ts`'s measurements; this plan edits only its setup (`:26-39`) and the body's parameter list. Whichever lands second rebases. If `layout-polish` takes F-3 (Home's hero before its quotes), it changes `BalanceView.vue`, which C11's test reads; C11's wait still holds, since a priced figure stays the settled signal.
- **`failed-send-check`** (wave 2) edits `apps/extension/src/utils/journal-state.ts`'s failed arms (`:217-225`) and likely `operation-journal/spec.ts:185-187`; this plan edits `journal-state.ts:130` and `spec.ts:96-110`, `:238-241` only. Line-level merges will be clean; read the other branch's hunk before resolving.
- **`amount-honesty` / `send-states`** touch `AmountCard.vue`; this plan touches only `AmountCard.test.ts:375`'s describe string.
- **Four near-identical fixtures.** With #719's `send-picker` there would be four copies of "deploy these tokens, import each, close the page". CLAUDE.md's three-copy rule makes that a refactor signal; T1 decides.
- **The comment sweep's counts at `85c4d20f`**: "Phase 2 follow-up" 10 lines in 8 files; "post-impl" 51 lines in 27 files under `apps/extension/src` and `packages`, 9 lines in 8 files elsewhere; 41 files in all, 10 of them production code.
- **The comment sweep is narrower than the class.** 222 lines in 94 files under `apps/extension/src` and `packages` still name codex, opus or fable, and 67 files carry `Phase N` / `P<n>` tags (some are live runtime phases, which stay). This plan edits only the blocks that carry "post-impl" or "Phase 2 follow-up"; the rest is a follow-up.
