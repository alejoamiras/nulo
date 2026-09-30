# P13 · Review, gates, captures and close-out

LESSONS_FILE=implementations-plan/send-amount-exact/lessons/phase-13.md

## Codex, round 4

Resumed session `01a0eb09-0547-7610-b15e-ba1f8557c586` (GPT-6 Astra, high) through the program's
lock script on `alejo-gmail`, on `612b52df` and `8b7b68aa`, with both delegated calls verbatim, the
plan's two standing rules and the adversarial ask. Verdict: **conditional approve**, confidence
high, one condition. Each finding was checked against the code before acting.

1. **Accepted, the condition.** Refresh quote: `refreezeQuote` wrote the new guard, then
   `scheduleConvert` read `fiatGuard.value` in the same tick and wrote it back with `converting`
   on. The page owns the guard (`v-model:fiatGuard`), so the read returned the old quote, which
   came back; codex reproduced it with Vue's own `useModel` ($120 at $1.20 derived 120 tokens, not
   100). Red, vitest, once the refresh test bound the guard back through `onUpdate:fiatGuard`: the
   last guard emitted carried 0.999857, not 1.2. Fixed by handing the fresh guard to the
   conversion (`f3de30dc`); 291 tests green in the send composites and the send page. Dev's
   behaviour, in fiat mode, which the plan had left out; realistic by the owner's rule and
   fail-closed (the send gate never opened on the old quote). Its own commit, flagged to the
   driver.
2. **Accepted.** The plain-format comment moved with `plainAmount` said the plain string is what
   the page validates; Max now writes the grouped form. Deleted (`1aaa0958`).

Codex also found the switch's box inside the row and off Max's line in every mode, the fit
included, no read of the amount after Max's one write, and nothing in the two commits beyond their
handlers, layout and tests. The as-built panel then ran round 5 in the same session on the fixes:
approve, no new material finding (plan.md § Code review ledger).

## The captures, and one more fix

The capture spec (throwaway, copied in per run, never staged) needed two changes to shoot what the
owner will see. It left the destination focused after typing it, so its suggestion list could
cover the amount row and a press on Max was lost (F-6): it now leaves the destination through the
amount field, as the network spec does. And a success snack stays up while the pointer rests on it
(`holdToast`, fed by hover), which is the likely reason P11's Firefox full-size frame kept the
Received snack: the pointer now moves to the header before each shot waits for the snack to go.

Chrome's first billion-plus review wrapped inside the symbol, "1,235,803,457.246913578024691356 T"
over "ST": the amount and its `<small>` symbol hold no break between them, so `overflow-wrap:
anywhere` broke at the last character that fitted. Fixed with `display: inline-block` on the
symbol, an atomic inline, so the line breaks before the symbol, never inside it (`4d106e6c`); the
ruler shares the rule, so the fit's measure is unchanged. No test in the tree can see a wrap
(jsdom has no layout, and the network spec's review fits at 60%), so the captures are the
evidence: the symbol in two pieces before, in one after, on its own line.

The switch against A-4 option 2 as pictured on `capture/send-amount-exact-a4-2`, compared pixel for
pixel over the amount row in the full-size, 18-decimal and Max frames: Chrome's are identical but
for 2 px just left of the row's box; Firefox's are identical at a 1 px scroll offset, but for the
row's bottom 4 px in the full-size frame, where the old frame had the Received snack entering. In
every frame the label's baseline offset is 0 and the switch's box is 53 px, where the capture
branch's was 16.

## Gates

On `4d106e6c`, retry 0, beside other agents' suites. Chrome's network set and captures and
Firefox's smoke first ran before the symbol fix, all green, and ran again after it; the rows are
the final tree's. A smoke run and an `e2e:agent` run of the same browser never overlapped.

| Gate | Chrome | Firefox |
|---|---|---|
| `fiat-send`, `send-amount-exact`, `send-amount-clamp` | 3 passed, 241 s | 3 passed, 260 s |
| smoke, two shards side by side | 159 passed, 7 skipped of 166; 385 s and 842 s | 155 passed, 11 skipped of 166; 514 s and 979 s |
| captures | 7 frames, 191 s | 7 frames, 205 s |

Every skip is the suite's own, the same set as P11's (7 on Chrome, 11 on Firefox); the two more
tests are #720's. `bun run e2e:reap` found nothing to reap after either round.

Static, on the same tree with the close-out docs staged, all exit 0: `typecheck:all` (41 s);
`test:all`, 10,014 passed, 6 skipped and 8 todo over 12 workspaces (113 s); `test:ci-gating`, 244
passed and 2 skipped (35 s); `build` (14 s); `build-storybook` (10 s); lint, with P11's 29
warnings and 3 infos and nothing new; the plans gate, no enforced finding. No tracked file changed.

## Close-out

- `lessons.md`: at the driver's note (failed-send-check's branch holds it at 8,182 of 8,192
  bytes) this branch adds one line and retires one, and the file stays at dev's 7,934 bytes. Added
  to § CI & gates: the `defineModel` read-back, which hid two bugs here. Retired: the bad-ports
  entry, which `scripts/e2e/resolve-ports.ts` (its set, comment and test), `FIREFOX.md` and the
  `e2e-testing` skill's flake row 41 already carry. Not promoted: the float-amount lesson, which
  the amount utils' TSDoc carries ("no float math, no precision-loss footgun") with the archived
  recon; this branch's two E2E entries, which the `e2e-testing` skill's hazards and smoke build
  already carry (the one fact it lacked, that `e2e:agent` rebuilds its dist and owns
  `.e2e-state/`, joined its hazard line); and the removed-export clause, rare and recorded in
  `lessons/phase-8.md`.
- `follow-ups.md` § Send amounts gains F-5 (the switch and Max are mouse-only) and F-6 (a press on
  Max while the destination holds the focus is lost).
- The host ran at a load of 170 to 250 on 192 cores throughout, other agents' suites included.
