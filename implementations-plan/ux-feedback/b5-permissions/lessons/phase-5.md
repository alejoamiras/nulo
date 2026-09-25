# Phase 5 · Parity and arc 5a gate

Codex round 1 of arc 5a's fix loop read `b6aa6e4d..7f624c6d` and asked for changes: seven
findings, one of them major. The fixes land before P5.1's parity captures, because findings 2 and
4 change window states the captures show. Each finding is one commit. Each test was run red on
the pre-fix code first, except finding 7's, which changes comments only.

## Codex round 1

| # | Severity | Finding | Decision | Commit |
|---|---|---|---|---|
| 1 | major | A Settings On given against listed scopes is stored broad when a window widens the scopes to any contract before the write takes the lock | Accept: the write carries the breadth the row showed, and under the lock an On given against listed scopes stays narrow. The stored state is the existing one where a consent stops signing silently, which Settings draws as A-15's broad row, so no new UI | `ff11260b` |
| 2 | minor | Adding an account while the scopes widen to any contract hides A-5: the held authorizations card says Nulo signs without asking, with no switch, while the consent is lost | Accept: that request draws A-5's state | `ba541aef` |
| 3 | minor | `data` asking for private events from an empty list of contracts, and not for the address book, opens a window with no data card and records a rejection nobody chose | Accept: refused as a request for neither, with the same `ValidationError`, before any window. Recorded in plan.md § The grant boundary and in the visible consequences | `0b8a9501` |
| 4 | minor | A-31's 5a window draws an "Account access" card the signed-off drawing does not have | Accept: in that state the held authorizations card stands for the accounts grant | `9ccdc04d` |
| 5 | minor | Two or more unknown types share one card and one switch in the singular words | Held for the owner (below) | none |
| 6 | minor | data-privateEvents' call assertions cannot show that Off blocks events | Accept, test only | `3b64cd02` |
| 7 | minor | Review and plan provenance left in comments | Accept, comments only | `c595892b` |

## What each red test showed

- **Finding 1.** `service.test.ts`, "a Settings On given against listed scopes, landing after a
  widening to any contract, stores narrow and asks", failed with `expected { broad: true } to
  deeply equal { broad: false }`: the setter read the widened grants and stored broad. The type
  guard's new case, `(id, true, "yes")`, threw `CapabilityNotGrantedError` where a
  `ValidationError` was due. Three `[id].test.ts` assertions failed on the missing breadth
  argument. Five failures in all. After the fix the two files passed, 33 tests.
- **Finding 2.** `build-items.test.ts`, "adding an account while the scopes widen to any contract
  brings the narrow consent back first, Off", failed: `items[0]` was the Transactions card, and the
  authorizations card was the held one, with no switch. After the fix the window's 135 passed.
- **Finding 3.** The new row of the dispatcher's malformed table, `{ type: "data", privateEvents:
  { contracts: [] } }`, failed with `promise resolved "{ version: '1.0', …(2) }" instead of
  rejecting`. After the fix wallet-bridge's 407 passed and `tsc` was clean.
- **Finding 4.** `index.test.ts`'s membership-only case, changed to the drawing's cards, failed
  with `expected [ 'authorizations', …(2) ] to deeply equal [ 'authorizations', 'transaction' ]`.
  After the fix the window's 135 passed.
- **Finding 6.** No product change, so the red run is a mutation. With `checkGetPrivateEvents`
  permitting a grant that has no `privateEvents` (`method-scope-checkers.ts:207`, `return false`
  made `return true`), the new address-book-only case failed and the other 84 scope-enforcement
  cases passed. The existing `getPrivateEvents` case passed too: it approves no account, so the
  account check refuses first, which is the gap codex named. The file was restored from a copy,
  and all 85 passed.
- **Finding 7.** Comments and five test titles, no behaviour: wallet-bridge's 409 and the window's
  135 passed. Swept: `dispatcher.ts`, `method-scope-checkers.ts`, `CapabilityCard.vue`, the e2e
  `fixtures/popups.ts`, the window's `index.test.ts`, `dispatcher.test.ts` and
  `scope-enforcement.test.ts`. Kept: finding ids (F-003, F-006, Q11 and the like) and AUDIT
  markers, which pair with tests; the "Phase 1/2/3" steps in `handleRequestCapabilities`, which
  describe live behaviour; the `makePhase15Dispatcher` identifier, since the finding covers
  comments only. `connected-app-helpers.ts:9` still says "codex post-impl §5"; the file is not in
  this arc.

## Held: finding 5

Two or more unknown types share one card and one switch, which grants every one of them or none.
The card keeps the singular words, "Unknown permission" and "This wallet doesn't recognize this
permission. Reject if you don't know what it does." No drawing gives plural words for 5a
(phase-2.md), and U4's plural arrives in 5b. The words are the owner's call, so the card stays as
built and plan.md lists it as sign-off pending. Codex's own fix was to ask the owner, not to write
plural copy.

## phase-2's A-31 discrepancy, resolved

phase-2.md recorded that A-31's 5a drawing has no "Account access" card and that 5a drew one,
following the plan text ("every other type's 'Already granted' card still comes from
`existingGrants`, as today"). Finding 4 follows the drawing. The held authorizations card is drawn
only on a membership-only accounts widening that does not cost the app its consent, and there the
plain "Account access" card is now left out. Every other state keeps it, A-1H's held list among
them. phase-2.md stays as the record of the earlier call.

## Codex on the builder's calls

In the review prompt's order:

1. Projecting only the caps a decision stores: agree. Every new known-capability record passes
   projection, and unknown types pass untouched by design.
2. The unreachable `plan.delta.find` fallback in `collectNewGrants`: agree it is unreachable; keep
   it.
3. The fixed-text refusals: agree, no new leak. Codex notes that `projectKnownCapability`'s "every
   failure" wording is broader than its `try`, since the discriminator is read before it, although
   a throwing accessor cannot arrive through the JSON wire.
4. The echoed answer for the other known types after a declined widening: agree this arc does not
   make it worse.
5. The stored flag going stale: disagree for the Settings race, which is finding 1. Otherwise the
   predicate handles a later widening, revoking `canCreateAuthWit` removes the consent, a fresh
   session starts without it, and backups carry no sessions.
6. `buildGrant`'s `data` rebuild and when it sends the consent: agree for A-30's combinations.
   Findings 2 and 3 are the uncovered states around them.
7. `switchTestid` and the two hard-coded hairline values: agree.
8. The call-intent selector and arguments: agree, checked against the installed Token ABI (the
   hexadecimal selector was not recomputed).
9. The grant as data-privateEvents' only proof: disagree, which is finding 6.
10. `data-app-host`: agree.

## Gate after the round

Run from the worktree root on `c595892b`. "The 8 files" are phase-4.md's.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing; `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 15 workspaces |
| `bun run test:all` | 0 | extension 7,647 passed, 4 skipped, 7 todo; wallet-bridge 409 passed |
| `bun run test:ci-gating` | 0 | 138 pass, 2 skip |
| The 8 files, Chrome, prover on, retry 0 | 0 | 11 passed; 240 s |
| The 8 files, Firefox, proverless, retry 0 | 0 | 11 passed; 245 s |
| `bun run e2e:reap` | 0 | nothing to reap |

Each run's Aztec node printed `Error: Address already in use (os error 98)` once while starting,
then reported ready, as in phase-4.md. P5's own gate (steps 2 to 6) runs later.

## Codex round 2

Codex read the fixes (`7f624c6d..970bb186`) and the whole arc again (`b6aa6e4d..970bb186`), and
ran `dapp-session/service.test.ts` (27 passed). Its verdict:

> **No new material findings.** Findings 1–4, 6 and 7 are closed. Finding 5 remains held for the
> owner; its UI wording is not approved by this review.
>
> Across the full arc, I found no additional authorization bypass, unprojected new known grant,
> dApp-controlled consent write, or substitution of a re-read session for the dispatch snapshot.
>
> VERDICT: approve — confidence: high

It checked each closure against the ways it could fail:
- the breadth argument is required and checked at run time, and only the trusted extension RPC
  reaches it;
- A-5's state wins only when a widening costs the narrow consent its effect;
- the address book with an empty contracts list is still valid;
- finding 6's test would fail if an address-book-only grant permitted events.

The loop converged in two rounds.

**The declined-widening observation.** Storage and enforcement keep the older grants. A declined
widening records a rejection and replaces nothing, and later covered requests still succeed. Only
the window's "Already granted" list leaves out the refused types, and it did so before this arc
(`dispatcher.ts:379` at `b6aa6e4d`). Transaction and simulation answers echo the requested
capability rather than the stored grant, as before. What the window shows is the owner's call, and
the parity page asks it.

**On the stack.** The arc moved onto batch 4's tip as `30730df3..46c81325`:
- 39 cherry-picks, with no conflict;
- all signed;
- the tree is identical to the merge-tree dry run.

Round 1's fixes became `db309c4b`, `d05a29ef`, `8f49c6ad`, `97633f6a`, `a2976bea` and `5412cac3`.

## P5.1 · Parity

The page: https://claude.ai/artifact/6NjcZ54XTdEYtUgzGzQhxC. It places each capture, Chrome and Firefox, beside its drawing, in 24 rows:
- 9 differed and are fixed;
- 7 match, one of them a word-for-word check of every new title and line against U4 and round
  4's B;
- 2 differ only because the drawings are 400px wide and the wallet's column is 360px;
- 4 are undrawn states, built as recommended (plan.md § Delivery, sign-off pending);
- 1 verifies that a request for exactly what the app holds opens no window;
- 1, A-28's failed Settings save, has no real path to capture; its component test covers it.

The two defects, both in `CapabilityCard.vue` and both older than this arc:
1. The lead glyph sat centred on the card's head (`align="center"`), so beside a wrapped title it
   sat level with the second line, 9.4 to 29.3px below the first line's centre. The drawing's
   head is a stretch flex that keeps the glyph by the first line. `3095a2b7` sets
   `align="start"`; the glyph now sits 0.5px above the first line's centre (1px for the mono
   glyph), as drawn.
2. A wrapped title's lines were 14px apart where the drawing's are 17px. The `Text` primitive
   defaults to `height="100"`, a `line-height: 1`, while the drawing's titles take
   `line-height: normal`, 17px for InterVariable 600 at 14px. `51585984` sets it. Each wrapped
   title grows 3px per line, so the window for an app holding the address book and the token's
   events that asks for any contract now scrolls by 15px.

Both were measured in the page from the second captures (`51585984`), with the same numbers in
Chrome and Firefox. The fable leg ran on Opus, Fable's credits being spent. Its first pitch
figures, 17 against 20px, were glyph rows read off the screenshots; the page reports the in-page
line boxes.

Codex round 3, on `a3629ac3..51585984`:

> No new material findings in `a3629ac3..51585984`.
>
> VERDICT: approve — confidence: high

It checked the heads against the mock and found click, Enter, Space, the disabled state, the
switch role and every testid unchanged, with the 25 `CapabilityCard` tests passing. It judged
the inline `lineHeight: 'normal'` right, since the design utilities have no `normal`, and found
no new clipping or footer overlap. An alignment assertion in the stubbed unit test would pin
template attributes, not browser geometry, so none was added. The loop on the fix converged in
one round. Both commits sit on the arc as they were built (a fast-forward).

Finding 5 is answered: owner, 2026-09-25, "for branch 5a: (a)", today's singular words.

## P5 gate at `a3629ac3`

Run before the card fix landed; the fix changes two attributes in one component, so the regate
after the restack (below) covers it.

| Step | Chrome | Firefox |
|---|---|---|
| `bun run lint` | 0 (1 s) | not browser-bound |
| `bun run typecheck:all` | 0 (33 s) | not browser-bound |
| `bun run test:all` | 0 (99 s) | not browser-bound |
| `bun run test:ci-gating` | 0 (25 s) | not browser-bound |
| `bun run build` | 0 (14 s) | not browser-bound |
| `bun run --cwd apps/extension build-storybook` | 0 (9 s) | not browser-bound |
| Network suite, retry 0 | prover on: exit 1; files 89 passed, 1 failed, 3 skipped of 93; tests 123 passed, 1 failed, 5 skipped (3,613 s). Proverless files: 7 of 7, 18 tests (949 s) | proverless: exit 1; files 96 passed, 1 failed, 3 skipped of 100; tests 139 passed, 2 failed, 6 skipped (4,566 s) |
| Smoke (build exit 0) | 0; files 38 passed, 3 skipped; tests 152 passed, 7 skipped | 0; files 39 passed, 2 skipped; tests 148 passed, 11 skipped |
| Flake bar, the three files three times | 0 each; 6 of 6 tests each run | 0 each; 6 of 6 tests each run |
| `bun run e2e:reap` | 0 | 0 |
| Execution canaries, prover on | in the network suite, passed | open until CI (below) |

**The one red file, both browsers: `network/window-placement.test.ts`.** Not this arc. A bisect
found the first bad commit at batch 4's `6fbfdeb5`, the snackbar: the execute window's
persistent error snack, "Couldn't estimate fee — retry.", sat 12px from the bottom and covered
Reject. Batch 4 fixed it on its build branch with the owner's 1c and the end-of-scroll rule
(`55ffcc18`). P5 stays open until this arc, restacked on that batch 4, passes window-placement
and the regate in both browsers.

The Firefox execution canaries stay open until CI's `Firefox / Run / canary / real-proving` job
on the PR's head shows the substantive tests passed, retry 0, with Presto enforced.
