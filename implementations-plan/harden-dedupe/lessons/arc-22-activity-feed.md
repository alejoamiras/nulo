# Arc 22, activity-feed: lessons log

## Plan audit

- **Codex (GPT-6 Astra, xhigh), the only leg at LIGHT tier, returned REVISE with two blockers.** Both were adopted, with every other finding (see the batch plan's Decisions). The two that changed the design:
  - **An empty active profile id is reachable** through restore, so swapping Home's and TokensView's truthy profile clauses for `isForeignProfile` was not a no-op. Both clauses stay inline, and the difference is drift.
  - **The single card builder looked the token up before the kind**, and one `v-bind` moved the awaiting card's field evaluation across `cardSubtitleFor`. It became per-field helpers, each checking the kind first, with Home's bindings left separate and in order.
- The History incoming profile guard moved to arc 22b, because a route-2 fix ships in its own arc.

## Build

- **Base `eb06c37d`,** as the coordinator set. `origin/harden-dedupe` gained `fe9e6777` (restore-wiring) meanwhile, which touches none of this arc's files.
- **Phase 1** passed on the unchanged code: 36 row tests (two files) and 131 card tests (`journal-state.test.ts`, `RecentActivityView.test.ts`). The read-order pins use a recording `Proxy`, so short-circuit order and the sort-key-before-id order are literal arrays.
- **`amount.callers.test.ts` counts `balanceFormatted` calls per file.** It is the guard for the compact-amount policy. A shared `journalCardAmount` helper moved Home's call into `journal-state.ts` and broke the count (2 → 1). Rather than edit a frozen test, the formatter call stays at both sites, and the plan's helper table drops that row. A shared formatter would have to update that pin in its own commit.
- **Phases 2 and 3** touched no test file. The build regenerated `auto-imports.d.ts` and `.eslintrc-auto-import.json` with the eight new globals, and nothing else.
- **Built CSS:** `._title_sep_<shared>` is the only `title_sep` rule in each chunk that carries it. The local classes compose with no declarations of their own.

## Code review, Codex round 1: NOT CONVERGED

- **Blocker: the terminal card's evaluation order.** The first build routed the terminal builder through the awaiting card's per-field helpers. That read the title and the transfer type before formatting the amount, looked the token up twice, and read `ctx.tokenById` on dApp cards. With a schema-valid `amountRaw: "bad"`, a Vue render then tracked `token.symbol` and `op.transferType` before the format threw. The equivalence claim covered output values but not the read sequence. Every builder a reactive render calls needs its reads pinned, not just its output.
- **Fix:** `transferCardFields` and `dappCardFields` are back in base order. They share three kind-free private leaves (`transferTitle`, `dappTitle`, `transferTypeLabel`) with the awaiting card's helpers. Each leaf reads exactly what the inline expression it replaced read.
- **New test file, not an edit to a frozen one:** `apps/extension/src/utils/journal-terminal-order.test.ts`.
  - Its three terminal cases are green on base, checked by putting base's `journal-state.ts` in place and restoring HEAD's copy, which had no uncommitted edits. All three are red on the first build.
    - the transfer read sequence (one lookup; `amountRaw`, `decimals` and both `symbol` reads before `transferType`);
    - the throwing amount stopping at `token.decimals`;
    - the dApp card with no lookup read at all.
  - A fourth case pins `journalCardTitle` skipping the lookup for a dApp op. The new mutant 13 survived without it, because the terminal builder no longer calls that helper. Base had the same logic in the SFC's `cardTitleFor`, so the case has no base twin to run against.
- **Should-fix: price state.** The first forced run's Firefox capture priced the tx and receipt rows (`≈ $12.50`, `≈ $3.00`) where base did not. The fiat line widened the amount column, which squeezed the shrinkable chips into two lines. Neither nudge did it; it was a live quote landing in one capture only. The surfaces now pin the price port (below).

## Mutation check

- **Method:** 27 mutants, each applied alone to the code at `5e588b2b` by a scratch script, against the six frozen suites plus `journal-terminal-order.test.ts`. Each file was restored from an in-memory copy, never with git, and the tree was clean afterwards.
- **Result: 27 of 27 red, in the full re-run at `5e588b2b`.**
  - **Shared tx scope:** account, chain and profile dropped one at a time (1 to 3); chain check made truthy (4, killed by the chain-0 pins in both feeds).
  - **Incoming scope:** `incomingInScope` loses account (5) or network (6); Home drops its token check (7) or its profile guard (8, killed by the new known-scope case and by the incoming read-order test); History gains the profile guard (9).
  - **Journal:** History gains a network rule (10); Home's journal token check dropped (11), killed by the token-feed case, not by the incoming token tests.
  - **Read order:** `incomingRow` builds its key before its sort key (12).
  - **Card fields:**
    - Home's title helper looks the token up before the kind (13, killed by the new `journalCardTitle` case);
    - the terminal dApp card reads `ctx.tokenById` (14);
    - each amount gate swapped (15, 16);
    - `||` and `??` swapped in the symbols and the title (17 to 19);
    - the transfer-type gate made truthy (20);
    - sanitization dropped, terminal (21) and Home (26);
    - the icons swapped (22).
  - **Terminal order:** the first build's order, title and type before the format with a second lookup (25), and the title read before the format with one lookup (27). Both are killed by the transfer read-sequence case and the throwing case.
  - **Routes:** a route swapped (23), and History's incoming `:to` dropped (24).

## Gates

- `gates.sh` at `7b0f13c6`: all PASS.
- `gates.sh` at `5e588b2b`: lint, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all PASS.

## Screenshots

- **Surfaces:** 22 per browser and theme. They cover Home, the token feed and History, each with rows of every kind (tx, receipt, awaiting, terminal, transfer and dApp) and its own `-end` scroll. They also cover the three feed empty states, the six settings `ListStatusMessage` empties, Holdings' no-results line and the token picker's.
- **The harness goes Home before every surface.** The first stability run failed on `token-feed-end`: an empty `reach` leaves an `-end` shot on Home, which shows both journals' awaiting cards. Every `-end` shot off Home now navigates back to its page.
- **Prices are pinned.** Every fresh document arms a wrap of `chrome.runtime.connect` while it boots on Settings, before Home builds a price client. The wrap answers the price port's `refreshIfStale` and `getQuotes` with one quote (usd 1) and drops the worker's pushed updates. Every data surface asserts, before the shot and after it:
  - feeds: exactly `≈ $12.50` and `≈ $3.00`;
  - empties: no fiat at all;
  - in both cases, that the wrap served at least one request whenever fiat shows.
- **Round 2, all at the price-pinned surfaces:**
  - **Stability:** `eb06c37d` against itself, Chrome and Firefox, ALL IDENTICAL (132 entries, PNGs and style probes).
  - **Base `eb06c37d` vs head `5e588b2b`:** Chrome and Firefox, ALL IDENTICAL (132 entries).
  - **Forced-diff head:** `5e588b2b` with two nudges, `title_sep` coloured `--nulo-accent` and `ListStatusMessage`'s `empty_sub` composes dropped. It differs on exactly the nudged surfaces:
    - the eight feed surfaces with a separator, and the six `ls-*` empties;
    - in each browser and theme that is 14 PNGs and 10 style probes, so 96 entries in all.
  - **The forced head moves nothing else.** The three feed empty states, both no-results lines and the empty token feed stay identical.
  - **The feed diffs are the separator dots alone:** 17 to 84 px in every browser and theme, with no non-colour computed-style leaf. The first forced run's Firefox chip wrap does not recur, which bears out the price explanation. There was no cascade or `composes` defect.
- **Round 1, before the price pin:** stability and base vs `7b0f13c6` were ALL IDENTICAL on both browsers, but those captures had no price control.
