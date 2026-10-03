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

## Mutation check

- **Method:** 24 mutants, each applied alone to the Phase 2 source by a scratch script, against the six frozen suites. The file was restored from an in-memory copy, never with git, and the tree was clean afterwards.
- **Result: 24 of 24 red.**
  - **Shared tx scope:** account, chain and profile dropped one at a time (1 to 3); chain check made truthy (4, killed by the chain-0 pins in both feeds).
  - **Incoming scope:** `incomingInScope` loses account (5) or network (6); Home drops its token check (7) or its profile guard (8, killed only by the new known-scope case); History gains the profile guard (9).
  - **Journal:** History gains a network rule (10); Home's journal token check dropped (11), killed by the token-feed case, not by the incoming token tests.
  - **Read order:** `incomingRow` builds its key before its sort key (12).
  - **Card fields:**
    - the title helper (13) or the terminal amount (14) looks the token up before the kind, killed by the `tokenById` spy;
    - each amount gate swapped (15, 16);
    - `||` and `??` swapped in the symbols and the title (17 to 19);
    - the transfer-type gate made truthy (20);
    - sanitization dropped (21);
    - the icons swapped (22).
  - **Routes:** a route swapped (23), and History's incoming `:to` dropped (24).

## Gates

- `gates.sh` at `7b0f13c6`: lint, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue` all PASS.

## Screenshots

- **Surfaces:** 22 per browser and theme. They cover Home, the token feed and History, each with rows of every kind (tx, receipt, awaiting, terminal, transfer and dApp) and its own `-end` scroll. They also cover the three feed empty states, the six settings `ListStatusMessage` empties, Holdings' no-results line and the token picker's.
- **The harness goes Home before every surface.** The first stability run failed on `token-feed-end`: an empty `reach` leaves an `-end` shot on Home, which shows both journals' awaiting cards. Every `-end` shot off Home now navigates back to its page.
- **Stability:** `eb06c37d` against itself, Chrome and Firefox, ALL IDENTICAL (132 entries, PNGs and style probes).
- **Base `eb06c37d` vs head `7b0f13c6`:** Chrome and Firefox, ALL IDENTICAL (132 entries).
- **Forced-diff head:** the head build with two nudges, `title_sep` coloured `--nulo-accent` and `ListStatusMessage`'s `empty_sub` composes dropped. It differs on exactly the nudged surfaces:
  - the eight feed surfaces with a separator, and the six `ls-*` empties;
  - in each browser and theme that is 14 PNGs and 10 style probes, so 96 entries in all.
- **The forced head moves nothing else:** the three feed empty states, both no-results lines and the empty token feed stay identical.
- **One unexplained extra in the forced build, Firefox dark only:** History's origin chip and the dApp chip wrap to two lines (computed width 1 to 2 px narrower), so the rows below shift. The cause is not established. Only the throwaway forced build shows it, never the head, and stability is clean on both browsers.
