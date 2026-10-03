# Arc 14, incoming-arms: lessons log

## Plan

- **The two receipt arms re-check the epoch differently, and the old comments said otherwise.** The note arm checks only at its section's entry and after each timestamp read; the public arm checks after nearly every read and stands down after the trust read. The plan keeps both maps (N0–N11, P0–P10) as they are and pins the difference rather than unifying it.
- **Plan audit:**
  - Codex: REVISE, high confidence: bumped rows needed call logs, the repository's tick count was unproven, and the scope-construction mutant had no observer.
  - Opus: APPROVE.

  Every finding and both legs' Ask calls are recorded in the batch plan's Plan audit block.

## Build

- **Phase 1 passed on the unchanged code** (`service.scenarios.test.ts`, `repository.test.ts`, `public-event-indexer.test.ts`, `public-events.test.ts`): 343 tests in the incoming-transfer folder, 170 in aztec-runtime `src/pxe`.
  - The interleaving matrix parks the first call of a chosen collaborator after it returns, bumps the epoch while parked, and asserts the ordered call log plus the effect flags. Flags alone miss a removed guard whenever a later guard stops execution.
  - `@webext-core/fake-browser` settles on microtasks only: the repository fingerprint's spinner stayed far below its cap, so a real repository clear is measurable through caller resumption.
- **Phase 2 changed no test file.** 2a–2d diffs list only `service.ts`, `repository.ts`, `public-event-indexer.ts` and `public-events.ts`.
- **Fingerprints, recorded on the unchanged code (Bun 1.4.2) and green after every Phase 2 commit**, then removed in a test-only commit. Stamps count microtask-queue passes from the first in-section call.

  | Path | Stamps |
  |---|---|
  | note, unknown trust | tokens@0 outgoing@1 inflight@3 getRecord@5 getTrust@6 setTrust@7 trustChanged@8 visibility@8 pending@10 timestamp@11 setOutbox@13 upsert@15 resumed@22 |
  | note, trusted | tokens@0 outgoing@1 inflight@3 getRecord@5 getTrust@6 timestamp@8 setOutbox@10 upsert@12 visibility@13 added@15 resumed@21 |
  | public, unknown trust | tokens@0 getRecord@1 outgoing@2 inflight@4 getTrust@7 setTrust@8 trustChanged@9 visibility@9 pending@11 setOutbox@12 upsert@14 resumed@20 |
  | public, trusted | tokens@0 getRecord@1 outgoing@2 inflight@4 getTrust@7 setOutbox@9 upsert@11 visibility@12 added@14 resumed@19 |
  | replay emit | listByContract@0 tokens@1 getTrust@2 pending@3 resumed@7 |
  | service clearProfile / clearChain | wipe@0 active@1 resumed@10 |
  | repository clearProfile / clearChain (real, fake browser) | call@0 remove@4 remove@15 remove@36 resumed@44 |

  Green counts: 9 of 9 fingerprint tests after 2a, 2b, 2c and 2d; the folder ran 343 of 343 three times in a row on the final code.
- **Mutation checks**, in scratch with files restored from copies (never with git). All killed.

  | Mutation | Code | Failing tests |
  |---|---|---|
  | P1's post-token-read check removed | before and after Phase 2 | the P1 row |
  | P4's in-flight epoch check removed | before and after | the P3 and P4 rows |
  | public stand-down dropped | before and after | the P5 row |
  | stand-down passed by the note caller | before and after | the five N1–N5 drift pins |
  | P8 check moved before `markBalanceDirty` | before and after | both P8 rows |
  | `pendingEvent` spreading its scope | final | the note arm's prompt key-order row |
  | `return await` at either return of `resolveReceiptTrust` | final | the note and public fingerprints for that trust state |
  | `async` wipe arrow, per method | final | that method's service fingerprint |
  | `async clearX() { return this.clearScope(...) }`, per method | final | that method's repository fingerprint |
  | `return await this.clearScope(...)`, per method | final | that method's repository fingerprint |
  | `scopeFor` called before the bump | final | the clearChain episode-prefix epoch row |
  | cursors and outbox swapped in `clearScope` | final | both removal-order rows |
  | `<` for `<=` at the indexer's comparator call | final | the two hostile non-advancing page rows |
  | `<` for `<=` at the runtime's comparator call | final | the equal-positions row and two hostile-page rows |

- **Shell discipline in an isolated worktree.** Compound commands that mention git are refused; scripts in the scratchpad and one plain `git -C` command per call worked throughout.

## Code review round 1: CONVERGED

- **Codex: CONVERGED, high confidence, no blocker or should-fix.** It ran 525 source-extracted Bun comparisons of base versus implementation and found zero differences in epoch reads, writes, emits, lock release or caller resumption. It also confirmed:
  - removing P1 or P4 now fails through the call logs;
  - the N0 and P0 stale-entry controls are present;
  - the repository fingerprints reproduce, and an async wrapper moves resumption to tick 45;
  - the scope-construction observer works.
- **Nits, all applied:**
  - The plan called the N6/N7 and P6/P7 drift pins post-bump writes, but the fake trust write precedes the bump. They are now described as preserved post-bump continuations, and each row's call log says which writes or emits land late.
  - The plan justified removing the fingerprints with "tick counts are not behaviour". The real rationale replaces it: extra ticks can affect these races and the matrices do not catch every added async wrapper, so the removal rests on this round's complete comparison, with the harness and results recoverable from history.
  - The `TrustScope`, `ScopeClear` and `stopNoteScheduler` comments restated their declarations and were deleted.
- **Restacked onto `harden-dedupe` at `169bed04`**, after arcs 6 (#766) and 8 (#767) landed. `git rebase --onto origin/harden-dedupe 7450928c` applied cleanly, and every commit stayed signed.
