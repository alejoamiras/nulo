# Phase 3 · The owner's decision page

## The page

- **URL**: https://claude.ai/artifact/CkFrJzKMAmyTkWSN7mXV7G (private to the owner). Its `answers`
  database holds one document per call (`o1` … `o5`: the choice, an optional note, the time) and
  `blanket` (signed, the time, the answers it covered).
- Read back once after publishing: `answers` holds no document, so nothing is answered yet.
- Layout: B1 and B2 first (the drawing, today and built side by side, with light and Firefox under
  a fold), then O1 to O5, each option built and pictured, the recommended one marked. The sign-off
  button covers B1, B2 and every call answered with its recommended option.

## Drawings

Rebuilt with the ux-feedback plan's own scripts while that plan is still in place
(`implementations-plan/ux-feedback/design/mocks/build.py`, then `design/shots.mjs` into the scratch
dir), then cropped to the drawn popup: `11-rows` A, `10-snackbar` (History), `12-incoming` A (Home)
and B (Settings).

## The builds

All armed smoke builds (the gate's `VITE_NULO_E2E_*` flags), Chrome unless stated:

- **today**: `85c4d20f` plus P1's testids, which change no pixel.
- **built**: this branch at `4a8ff90d`, Chrome and Firefox.
- **each other option**: one local commit off `4a8ff90d`, never pushed or merged:

| Branch | Commit | Edit |
|---|---|---|
| `capture/layout-polish-o1-b` | `ea3c3bae` | the link reads "View history" |
| `capture/layout-polish-o1-c` | `69aa584c` | today's "RECENT TRANSACTIONS" span and "View Archives" |
| `capture/layout-polish-o2-b` | `bacabbb7` | symbol, "·" and the dollar figure on one line; the figure keeps its title and its press |
| `capture/layout-polish-o2-c` | `4d629b90` | no dollar figure in rows |
| `capture/layout-polish-o3-b` | `1211786b` | `hideHeader` on Settings' route |
| `capture/layout-polish-o4-b` | `4ea98148` | no date rows; the groups 10px apart |
| `capture/layout-polish-o5-a` | `c53ba12e` | `BalanceView.vue` and `usePrices.ts` as at `85c4d20f` |

## Captures

A scratch spec (copied into `tests/e2e` for one run, removed after, never committed) against each
build, at 360×600 and device scale 1, seeding rows as P1 does (`tests/e2e/helpers/activity-seeds.ts`)
and opening each surface only once the previous page's rows have left.

| Run | Build | Result |
|---|---|---|
| B1, B2 today | today | 2 passed, 7 pictures |
| B1, B2 (dark, light), O1 (a), O2 (a) with fiat off, O3 (a), O4 (a), O5 (b) | built, Chrome | 5 passed, 24 pictures |
| B1, B2, O1 (a), O2 (a) | built, Firefox | 3 passed, 11 pictures |
| O1 (b), O1 (c), O2 (b), O2 (c) | their branches | 1 passed each, 2 pictures each |
| O3 (b), O4 (b) | their branches | 1 passed each, 1 picture each |
| O5 (a) | its branch | 1 passed, 2 pictures |

- **O5 is built, not mocked.** The wallet is set up with 5 USDC stored and its USDC row, then the
  background is stopped, so the popup opens on a new worker whose first price fetch is still out:
  the extension's request interception sends the price host to a local server that holds its
  answer. "Just opened" is taken while its price requests are held, "quote landed" after the
  release. (a) shows "$0.00" and "priced assets only" then "$5.00"; (b) the hero's grey
  placeholder then "$5.00".
- 54 pictures and the 4 drawings. The scratch dir's `captures/index.md` lists, for each picture,
  the strings on screen: painted text that is not aria-hidden, inside every clipping ancestor and
  under no opaque box (the nav, the compact bar), with icon ligatures left out.
- Every row of the plan's capture list is on the page.

## Answers

Pending: the page is published and nothing is answered yet.
