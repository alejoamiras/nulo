---
plan: hygiene
tier: light
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: none (light tier)
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: chore/hygiene
worktree: a harness-created agent worktree (its repo-relative path is recorded in lessons/phase-0.md)
base: dev @ 85c4d20f (#719 merged)
---

## Outcome

- **Date:** 2026-09-29. **Status:** closed, awaiting archive: delivered on `chore/hygiene`, not
  yet merged. No owner sign-off applies: nothing a person sees changes (§ UI impact).
- **Shipped:** C1 to C11 through P0 to P8, plus five fixes from the codex loop:
  - C1: `holdings`, `home-cap`, `pin-to-home` and `send-picker` set up their tokens once per file
    (`fixtures/extra-tokens.ts`), and `pin-to-home` clears the stored pins first, so a retry
    starts from its first attempt's state.
  - C2: `presto/client.test.ts` imports in `beforeEach`, and the relay's raised 30 s hook budget
    is gone; both hooks run on vitest's default.
  - C3: the derivation-parity script is deleted.
  - C4: branch 1, `legal-acceptance`'s pointer park is deleted.
  - C5: 69 replacements over 41 files drop the two workflow tags from comments and test titles.
  - C6 to C10: the root `typecheck` runs the extension's own; `CLAUDE.md`, `README.md`, two
    skills and `FIREFOX.md` say what the tree does, the harness and Firefox findings included.
  - C11: `incoming-arrival`'s calm check reads Home's hero only once it is priced.
  - From the codex loop (`lessons/post-impl.md`): both calm calls on the same priced check, and
    four comment corrections (a false module header, the terminal records' lifetime, a
    queued-transfer example, stale line citations).
- **Gates at delivery:** P8 at `b0f3ff48` (`lessons/phase-8.md`): every static and unit gate, and
  smoke on both browsers in three shards at retry 0. After the loop's fixes: `incoming-arrival`'s
  held-price probe and flake bar on both browsers (`lessons/post-impl.md`). The final gate on the
  pushed head is in the PR description. Codex converged in two rounds, one nit rejected.
- **Dropped:** T5 (`fixtures/playground.ts`'s dead fallback, codex's round-1 call); C4's branches 2
  and 3, since branch 1's evidence was complete; T1's fallback, since the factory compiled.
- **Open items:** none left here. `follow-ups.md` holds F-1, F-2, F-4 and F-6 under § ux-feedback:
  technical, and F-3 under "ux-feedback: taken by a follow-up plan", for `layout-polish`. Its two
  harness lessons went to the e2e-testing skill (§ 2, "Harness behaviours that look like
  product bugs"), their owning home: after the `dev` merge, `lessons.md` had no room left
  under its budget.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# Hygiene

The technical follow-ups from the ux-feedback program that change no screen, as one PR off `dev`
(`implementations-plan/follow-ups.md` § ux-feedback: technical, including the three #719 added):

- **C1** · `network/holdings`, `network/home-cap` and `network/pin-to-home` cannot pass a retry once an
  attempt has deployed and imported their tokens; `pin-to-home` also inherits a pin a failed attempt
  left.
- **C2** · `presto/client.test.ts` times its cold dynamic imports inside the test body, and
  `content-message-relay.test.ts` imports in a hook whose budget #719 raised to 30 s.
- **C3** · `tests/e2e/scripts/check-derivation-parity.ts` clicks an import option that no longer
  exists, and nothing runs it.
- **C4** · `legal-acceptance.test.ts` parks the pointer and waits out a snack for reasons the snack
  no longer has.
- **C5** · 70 comment and test-title lines cite workflow history ("Phase 2 follow-up", "post-impl").
- **C6 to C10** · Five docs and skills say something the tree contradicts, and 13 harness and
  Firefox findings still live only in plan logs.
- **C11** · `network/incoming-arrival`'s calm-arrival check reads Home's hero before its quotes land
  (flake ledger row 43).

No product behaviour changes. The only production files touched are comments. Recon:
[`recon.md`](recon.md).

## Phase 0 (pre-answered by the owner)

No clarifying questions were asked. The owner:

- 2026-09-28: "Can you ultracode 1 to 5 + security and privacy + test rliability + trivial?
  Assigning blueprinting level to each of those and just needing me to answer the open questons
  that it may come."
- 2026-09-29: "Feel free to leverage the gh cli to merge away the branches that you understand are
  ready and feel confident on their implementation. Continue then with ultracodeing the
  follow-ups."
- 2026-09-28: "FYI: use opus5.5 instead of fable please."
- 2026-09-29: "let's cover realistic scenarios lol."

Recorded:

- **Scope**: C1 to C11 above: "test rliability + trivial". **Out**: the em-dash strings
  (`copy-polish`), anything a person sees (C11's hero finding goes to `layout-polish`, § Follow-ups),
  the vitest recheck (it waits on upstream, vitest-dev/vitest#11237), the archive moves (a separate
  docs PR), every item another wave-2 plan owns, and the rest of the workflow-reference class beyond
  the two tags this plan sweeps (§ Follow-ups).
- **Tier**: `light`, under the owner's standing cap "never blueprint more than mid, to keep our
  credits safe" (§ Phase 0.5).
- **Constraints**: CLAUDE.md in full; in particular e2e selects only by `data-testid`, the
  complexity budgets with no new suppression, the layer import rules, the storage facade rule
  (which binds UI code, not e2e pages), the logging policy, pre-production (no migrations), no
  new dependency, and code comments with no plan, phase or review reference. No retry, timeout or
  advisory flag is raised anywhere in this plan, and the hook budget #719 raised is removed (C2).
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Decisions**: UI and product asks go to the owner; technical asks are decided with
  `/codex high` and logged in `lessons/`. Every Ask carries a recommendation, a confidence level and
  a label (`owner` or `codex`). This plan has no owner Ask: nothing here changes a screen, and a
  probe that finds a visible defect moves it out of this plan with its evidence (C4, C11).
- **Validation layers**: lint, typecheck, unit (both workspaces this touches), CI-gating scripts,
  build, the plans gate, actionlint (two workflow comments); smoke e2e on Chrome and Firefox (the
  e2e fixtures change); the network files C1 and C11 touch on Chrome and Firefox, each with a
  red-first probe and a three-run flake bar.
- **Delivery**: single arc, one PR off `dev` on `chore/hygiene`, plain `gh pr create` after the
  codex loop converges. The plan's first commit adds `implementations-plan/hygiene/` and one line in
  `implementations-plan/index.md`. Merge: by the driver under the owner's standing authorization
  above, once every required check is green on the head and the codex loop has converged (there is
  no UI surface to sign off).

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 0 | Every change copies a pattern the tree has (#719's file-scoped fixture, `beforeEach` import and held-response probe, `pressEscape`'s capture reader) or edits text |
| Blast radius | 1 | Four network specs, two unit files, one e2e smoke spec, comments in 41 files, five docs; no product behaviour |
| Irreversibility | 0 | Tests, comments and docs; one scratch script deleted (recoverable from history) |
| Migration cost | 0 | Nothing persisted changes |
| External coupling | 0 | None |
| Security sensitivity | 1 | Comments in security-relevant code (trust, backup, PXE) must keep every invariant they state |

`light`: every item is bounded and patterned; the risk worth an audit is a comment rewrite that
drops a live invariant, which the single codex pass and the post-implementation loop both check.

## Outcome & Quality Bar

For whom: whoever runs the network suite locally or reads a nightly (retry 2), and every future
reader of these files, human or agent, who acts on what a comment or a skill tells them.

Excellent means:

1. **A retried test starts from the state its first attempt started from.** Forcing one failure
   after the setup, with `NULO_E2E_RETRY=1`, fails the retry on today's code for each of the three
   files and passes it after the fix, with exactly one row per deployed token in storage; the
   pin probe does the same for a failure left between pin and unpin. Three consecutive retry-0
   runs pass on each browser, each with four tests passed and none skipped.
2. **A test reads a value only once the page has settled it.** With the price replies held across
   the read, `incoming-arrival`'s calm check fails on today's code and passes after the fix.
3. **Every sentence this PR leaves in a comment, a doc or a skill is true of the tree it ships
   in**, and each one it adds names the code that carries it. No rewritten comment loses an
   invariant; no workflow reference of the two swept kinds remains outside `implementations-plan/`
   and `audit/`.

Good enough: the rest of the workflow-reference class (codex, opus and fable names, `Phase N` /
`P<n>` tags in other blocks) waits for its own sweep; `e2e/config.test.ts` keeps its in-body import
(§ Decision ledger); rewritten comments keep their other claims as they are, re-verified only
where a claim is visibly false.

## UI impact

None. Every production-file edit is inside a comment (`.ts` comments, `.vue` `<script>` comments);
no template, style, copy, testid or behaviour changes. P8's diff inspection proves it hunk by
hunk. Home's "$0.00" before its quotes land (C11) is a visible finding this plan records and does
not change (F-3).

## Architecture & Implementation

### C1 · The three network specs run their setup once per file

**Today.** Each body deploys its tokens and imports them (`holdings.test.ts:30-37`,
`home-cap.test.ts:32-39`, `pin-to-home.test.ts:42-49`) on the file-scoped `tokenReadyExtension`
(`fixtures/extension.ts:731-792`). A retry runs the body again against the same wallet, deploys a
second set with the same symbols and imports it, and the exact assertions fail: `holdings`
expects `ZED,TST` and a count of 3 (`:44-51`), `home-cap` `BIG,TST,MID` and 4 (`:43-51`),
`pin-to-home` `TST,ALT` (`:52`). `pin-to-home` also writes a pin (`:57`) and removes it only at
`:72`, so a failure between the two leaves ALT pinned in `nulo:ui:pinnedTokens@<profileId>` and
the retry's `TST,ALT` wait fails even with one ALT.

**What does not need a reset.** Holdings' sort, search and fold are component refs
(`TokenList.vue:34-36`), rebuilt on every mount, and each attempt opens a fresh popup; `holdings`
and `home-cap` never pin. `seedUsdQuoteAndReload` overwrites its key (`helpers.ts:1026-1034`), so
running it again is harmless. The brief's "sort state" reset therefore has nothing to reset
(§ Decision ledger).

**Fix.** The deploy and import move into a file-scoped fixture, #719's `send-picker` form
(`network/send-picker.test.ts:20-37` at `85c4d20f`): a retried body reuses the first attempt's
tokens, and a failed setup is rethrown to every retry instead of rerun (vitest 4.1.10,
`chunk-artifact.js:398-413`, proven by #719's setup probe, `e2e-reliability-fixes/lessons/phase-4.md`).
Recommended shape (T1): one factory in a new `tests/e2e/fixtures/extra-tokens.ts`, used by all four
files:

```ts
import { inject } from "vitest"
import type { AztecTestConfig } from "./aztec"
import { openPopup, waitForHash, type ExtensionContext } from "./extension"
import { importTokenAndWaitForBalance } from "./helpers"

export interface ExtraToken {
	symbol: string
	amount: bigint
}

/** A file-scoped fixture, like the wallet it imports into: deploys `tokens` for the funded account and
 *  imports each behind its fresh-balance check, once per file, so a retried test reuses them instead of
 *  adding rows the assertions count. Resolves symbol → contract address. */
export function extraTokensFixture(tokens: readonly ExtraToken[]) {
	return [
		async (
			{ tokenReadyExtension }: { tokenReadyExtension: ExtensionContext & { accountAddress: string } },
			use: (addresses: Record<string, string>) => Promise<void>,
		) => {
			const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
			if (!aztecConfig) throw new Error("aztecTestConfig not provided")
			const { deployExtraTokensForAccount } = await import("./aztec")
			const addresses = await deployExtraTokensForAccount(aztecConfig, tokenReadyExtension.accountAddress, [...tokens])
			const page = await openPopup(tokenReadyExtension)
			await waitForHash(page, "#/popup/general")
			for (const { symbol, amount } of tokens) {
				await importTokenAndWaitForBalance(page, tokenReadyExtension.accountAddress, addresses[symbol], amount.toString())
			}
			await page.close()
			await use(addresses)
		},
		{ scope: "file" },
	] as const
}
```

Each file then declares `const test = base.extend<{ extraTokens: Record<string, string> }>({
extraTokens: extraTokensFixture([...]) })` and its body requests `extraTokens: _extraTokens`
beside `tokenReadyExtension`, opens its own popup, and runs from `seedUsdQuoteAndReload` on
unchanged. `send-picker` moves onto the factory too (its `altToken` becomes `extraTokens.ALT`,
unread by the body today).

**The type check this needs.** `apps/extension/tsconfig.json:22` includes only `src/**` and the
Vite config, so `typecheck:all` never reads `tests/e2e/**`, and vitest runs strip types without
checking them. P2 therefore runs a focused, uncommitted compiler check over the factory and its
four users (P2 step 2). If the tuple fights `base.extend`'s typing, the fallback keeps the sharing:
`extra-tokens.ts` exports only `deployAndImportExtraTokens(ctx, tokens): Promise<Record<string,
string>>` (the body above), and each file registers #719's proven inline fixture around one call to
it, `[async ({ tokenReadyExtension }, use) => use(await deployAndImportExtraTokens(tokenReadyExtension,
TOKENS)), { scope: "file" }]`. Four duplicated setup bodies are never the fallback.

**The pin reset.** A new helper beside `pinFromTokenPage` in `fixtures/helpers.ts`:

```ts
/** Removes every profile's pinned-tokens key; an open page's pins follow the storage change. */
export async function clearPinnedTokens(page: Page): Promise<void> {
	await page.evaluate(async (prefix: string) => {
		const all = await chrome.storage.local.get(null)
		await chrome.storage.local.remove(Object.keys(all).filter((key) => key.startsWith(prefix)))
	}, pinnedTokensKey(""))
}
```

`pinnedTokensKey` comes from `@/utils/profile-ui-keys` (`:12`), so the prefix cannot drift from the
product's. `pin-to-home`'s body calls it right after its popup reaches `#/popup/general` and
before `seedUsdQuoteAndReload`, whose reload then renders the reset state. The call sits under a
one-line comment: a retry inherits whatever pin a failed attempt left.

### C2 · `presto/client.test.ts` loads its modules in a hook, on the hook's default budget

Both tests call `vi.resetModules()` and `await import("./client")` in the body (`:6-7`, `:14-17`)
under vitest's 5 s test default. Under the full `test:all` load the file's tests timed out
(record: `ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-5.md:186-191`); the record did not
separate import time from the rest, so the in-body import is the likely cause, not a measured one.
#719's C3 form, adapted to two instances and with no raised timeout:

```ts
type ClientModule = typeof import("./client")
let first: ClientModule
let second: ClientModule

// Loading is not the behaviour under test, so it runs in the hook rather than a test's own budget.
beforeEach(async () => {
	vi.resetModules()
	first = await import("./client")
	vi.resetModules()
	second = await import("./client")
})
```

The hook keeps vitest's 10 s default (`hookTimeout`, `vitest/dist/chunks/coverage.DM_a_rWm.js:538`;
no workspace config sets it). Test 1 reads `first.getPrestoClient()` twice (instance of
`PrestoClient`, same object); test 2 asserts `second.getPrestoClient()` is not
`first.getPrestoClient()`. Both bodies become synchronous. Each test still gets fresh module
instances, every identity assertion stays, and the per-test budget stays 5 s.

**`content-message-relay.test.ts` (moved in from Follow-ups, driver 2026-09-29).** #719 moved this
file's import into `beforeEach` but passed that hook `30_000` (`:17-27` at `85c4d20f`), above the
10 s default, while its squash message said no timeout was raised. The file gets the same treatment
and the same proof as `presto/client` (P1): if the pinned-load runs stay green on the default hook
budget, the `30_000` argument goes and the comment above the hook keeps only its lasting reason
(loading is not the behaviour under test). If they do not, the slow import is fixed at its cause;
no budget is raised anywhere. After three failed attempts the build stops and reports its evidence.

### C3 · `check-derivation-parity.ts` is deleted (T2)

The script (`tests/e2e/scripts/check-derivation-parity.ts`, 214 lines, a one-time viability check
for the pre-funded fixture) clicks `import-option-private-key` (`:117-118`), which the picker no
longer renders (`ImportMethodPicker.test.ts:41`), and no script, workflow or config runs it. What
it proved is proven wherever a network file uses `feeJuiceImportedExtension`
(`fixtures/extension.ts:886-957`): derive the address test-side (`setupPreFundedAccount` →
`fixtures/aztec.ts:540-551`, `deriveAccountSeed`), import the phrase through the current flow
(`importSeed`), switch to Local, and wait until `nulo:ui:activeAccount` equals it. Beside it,
`network/frozen-account-canary.test.ts:109-141` recomputes the seed formula by hand, never through
`deriveAccountSeed`, and requires the wallet's addresses to match, on every required Chrome network
lane (`pr-extension-network-e2e.yml:249`, its result checked against the canary inventory at
`_extension-network-e2e.yml:307`); and
`packages/aztec-runtime/src/account/derivation-vectors.test.ts:21-53` pins seed → keys → address
against reference vectors in `test:all` (`_unit-tests.yml:25`). Fixing the script would duplicate
the fixture. The deletion also drops it from `browser-seam.test.ts`'s `EXEMPT` set and doc comment
(`:10-15`).

### C4 · `legal-acceptance.test.ts` S5: prove what the snack does at the next press

`:213-216` moves the mouse to (180, 40) and waits up to 10 s for the snack to leave, because (the
comment says) the snack "sits over the footer … held while the pointer rests on it". Both halves
look gone from the tree: the snack now sits `SNACK_GAP` (12px) above a registered bottom action
row (`snackInset.ts:85-95`), which both export pages register through `CollapsingHeroLayout`'s
bottom slot (`CollapsingHeroLayout.vue:84`; `export/account.vue:296`, `export/full.vue:624`), and
a card that opens under a still pointer is not held, since only a move away from the pointer's last
position holds it (`ToastManagerBase.vue:36-44`, `:77-80`). `pointerClick` still fails naming any
cover (`legal-drivers.ts:69-97`), so the presses themselves are the proof.

**What P4 settles.** An uncommitted probe records, at each of the three bottom-row presses after
the account export (`agree-continue-btn`, `unlock-submit-btn`, `download-backup-btn`), whether a
`[data-testid="snackbar"]` is on screen and both boxes. Its outcome picks one branch:

1. **Delete.** With the snack on screen at a press (held there by a pointer move onto it in the
   probe when no run catches it naturally), the unmutated press succeeds; and with the footer
   unregistered (the mutation), a press with the snack still on screen fails "covered at its centre
   by snackbar". The three statements and their comment go. If the mutated press still succeeds
   with the snack on screen, the snack does not reach the row even without its inset: the recorded
   boxes are the proof instead, and the deletion still ships.
2. **Product defect.** An unmutated press fails "covered at its centre by snackbar" with the snack
   on screen, on either browser. A snack that covers an export control is a visible defect, never
   waited away: C4 leaves this plan, `legal-acceptance.test.ts` stays as it is, and the evidence
   (browser, both boxes, a screenshot) becomes a follow-up the driver takes to the owner with
   pictured layout options.
3. **Keep the wait.** Only if the presses are proven clear (branch 1's evidence) yet the file fails
   without the wait for a named harness reason. That branch has its own bar: the reason reproduced
   once without the wait, three green retry-0 runs with it per browser, the park removed (a resting
   pointer no longer holds the snack), and the comment names the harness reason.

A probe that never gets a snack on screen at a press, even held, is inconclusive: nothing changes
in the file, and `lessons/phase-4.md` says why.

### C5 · Comments and titles that cite workflow history

Counted at `85c4d20f` with `git grep -n -i`: "Phase 2 follow-up" on 10 lines in 8 files under
`apps/extension/src` (the record said 12); "post-impl" on 51 lines in 27 files under
`apps/extension/src` and `packages` (the brief said 26 files), and on 9 more lines in 8 files under
`apps/extension/tests/e2e`, `apps/extension/scripts` and `.github/workflows`, which this plan
sweeps too (T4). #719 removed the tag from `network/backup-migration-roundtrip.test.ts`.

**Rule.** The unit of edit is the comment block or the title string that carries one of the two
tags. Inside it, every other workflow reference goes too (review ids, plan names, audit rounds),
and so does narration of how the file was built or tested; outside it, nothing changes. A describe
or test title under a deleted comment that repeats its tag gets the same edit. The rewrite keeps
every live claim, corrects one the code contradicts, and says the why in the present tense; where
the tag was the only content, the line is deleted with no empty ` *` line left behind.
`AUDIT [A-Z]\d+` markers and live runtime "phase N" documentation stay; no row below touches one.

`src/` is `apps/extension/src/`; `e2e/` is `apps/extension/tests/e2e/`.

| # | File:line | Today (the part that changes) | After |
|---|---|---|---|
| 1 | `src/components/composite/activity/TransactionAwaitingCard.test.ts:124-125` | `// Phase 2 follow-up: Cancel surface.` then `describe("Cancel button (Phase 2)"` | comment deleted; `describe("Cancel button"` |
| 2 | `src/components/composite/activity/TransactionTerminalCard.test.ts:1-11` | the block: tag line, then "Mirrors the `TransactionAwaitingCard.test.ts` pattern: stub the layout + atoms, mount the card …" (how the file was written), then "No journal-state mapping logic here — the card is presentational only; …" | `/** The card is presentational: \`@/utils/journal-state.ts\` owns the kind → display mapping and has its own suite, so this file pins only the rendering contract. */` |
| 3 | `src/popup/components/modules/general/RecentActivityView.vue:51-54` | `/** Phase 2 follow-up v4: terminal journal records (cancelled / interrupted / failed) stay visible … until browser exit — same lifetime as settled chain txs. Previously a 5-min window aged them out, which user QA found confusing ("what the hell, why did it disappear?").` | `/** Terminal journal records (cancelled / interrupted / failed) stay in the recent-activity area until browser exit, the same lifetime as settled chain txs.` |
| 4 | `…/RecentActivityView.vue:56-61` | `Row budget: total visible rows cap at 5. Codex post-impl audit caught that v4 v1 capped settled txs separately + rendered structurally (awaiting → all terminals → settled), which let 6+ terminals push out every settled row. Fixed below via \`recentActivityRows\` chronological merge — terminals + settled compete fairly for the remaining slots after awaiting cards. */` | `Row budget: 5, counting the in-flight cards, which always render, so the preview can exceed it. Terminal records, settled txs and incoming transfers share whatever slots remain, newest first, with none reserved for any kind (\`recentActivityRows\`). */` (Code: `remainingRowSlots`, `recent-activity-rows.ts:31`; one sort, `:44-48`; the slice, `RecentActivityView.vue:120`.) |
| 5 | `…/RecentActivityView.vue:94` | `slots by 1 (codex post-impl catch). Mirror` | `slots by 1. Mirror` |
| 6 | `…/RecentActivityView.vue:414-415` | `would attribute progress to the wrong op — codex post-impl catch. When` | `would attribute progress to the wrong op. When` |
| 7 | `…/RecentActivityView.vue:457` | ` * Phase 2 follow-up v4: when a journal record turns terminal` | ` * When a journal record turns terminal` |
| 8 | `…/RecentActivityView.vue:463-466` | ` * Two call shapes — codex post-impl review caught a HARD regression in the original v1 (scan-all) implementation: with terminals living forever, any OLD cancelled record matching by kind+tokenId would false-clear a fresh executingTask. Narrowed:` | ` * Two call shapes, because terminals live until browser exit and a scan of all of them would let an old cancelled record matching by kind+tokenId clear a fresh executingTask:` |
| 9 | `src/popup/components/modules/general/recent-activity-handlers.test.ts:122` | `// Phase 2 follow-up v4 — cancel-dupe match logic.` | deleted (the describe names `isMatchingTask`) |
| 10 | `src/popup/components/modules/general/recent-activity-handlers.ts:1-12` | the block: tag line, then "The Vue component itself is hard to unit-test (4+ service clients to stub, …). Extracting the cancel + retry wire to a tiny pure module gives us regression coverage …" (why it was extracted), then the getter paragraph | `/** Pure handler builders for RecentActivityView. Both take a getter rather than a value: they are built once and must read the ref at click time. */` |
| 11 | `src/popup/windows/execute/operation-validation.test.ts:2-3` | ` * Phase 2 follow-up: tests for the popup-side Operation validation helpers.` and the ` *` after it | both deleted; the block opens on "Pinning:" |
| 12 | `src/wallet/services/dapp-interaction/materialize.test.ts:2-3` | ` * Shared request→operation materializer tests (Phase 2 follow-up, Layer 4).` and the ` *` after it | both deleted; the block opens on "Pins:" |
| 13 | `src/wallet/services/operation-journal/spec.ts:96` | ` * Phase 2 follow-up v4: raw transfer amount in base units,` | ` * Raw transfer amount in base units,` |
| 14 | `…/operation-journal/spec.ts:104-106` | ` * Phase 2 follow-up v4: transfer recipient address. Persisted on the journal for future tx-detail views; not rendered on cards in this phase. Undefined for non-transfer kinds.` | ` * Transfer recipient address; no card renders it. Undefined for non-transfer kinds.` |
| 15 | `…/operation-journal/spec.ts:110` (the next field's block) | ` * Phase 2.5: token contract address for` | ` * Token contract address for` |
| 16 | `…/operation-journal/spec.ts:239-241` | ` * Codex + opus post-impl reviews flagged the un-refined version as too permissive — it admitted records like \`{kind:"transfer", initialStage:"queued"}\` that would never render in the activity feed.` | ` * Without the refinement the schema would admit records like \`{kind:"transfer", initialStage:"queued"}\`, which never render in the activity feed.` |
| 17 | `src/components/ScopeAddress.test.ts:80` | title `… even when input has them (codex post-impl §3)` | `… even when input has them` |
| 18 | `src/components/ScopeClassId.test.ts:65` | title `… invisible/control chars (codex post-impl §3)` | `… invisible/control chars` |
| 19 | `src/components/composite/send/AmountCard.test.ts:375` (moves with `fix/send-amount-exact`) | `describe("composite/AmountCard — codex post-impl fixes"` | `describe("composite/AmountCard — fiat mode"` |
| 20 | `src/components/ui/Dropdown/Dropdown.test.ts:121` | `// (P5a post-impl, codex MEDIUM) a disabled item must be` | `// A disabled item must be` |
| 21 | `…/Dropdown.test.ts:319` | `// (P5a post-impl, codex LOW) end-to-end Enter-gate: a focused` | `// End-to-end Enter gate: a focused` |
| 22 | `src/popup/components/modules/general/TokensView.test.ts:191` | `strand the section dot ON (post-impl audit, Medium).` | `strand the section dot ON.` |
| 23 | `src/popup/components/modules/settings/connected-apps/connected-app-helpers.ts:8-10` | `… render as the constant "Unknown permission" — codex post-impl §5 caught that the settings surfaces were still leaking the raw cap.type label.` | `// Route through getSafeDisplay so an unknown wire type renders as the constant "Unknown permission", never as its raw cap.type label.` |
| 24 | `src/popup/components/popups/PopupManager.test.ts:287` | `// Post-impl audit High #1: the stale-triple guard drops payloads` | `// The stale-triple guard drops payloads` |
| 25 | `…/PopupManager.test.ts:316` | title `"(post-impl) stale-triple defense: …"` | `"stale-triple defense: …"` |
| 26 | `…/PopupManager.test.ts:325-326` | title `"(post-impl 3rd cycle) account-switch …"`; `// Codex 3rd-cycle Medium: trust payloads are account-scoped` | `"account-switch …"`; `// Trust payloads are account-scoped` |
| 27 | `…/PopupManager.test.ts:346-347` | title `"(post-impl 2nd cycle) accept on A, …"`; `// Codex post-impl 2nd-cycle High repro: queue/open A payloads,` | `"accept on A, …"`; `// Queue/open A payloads,` |
| 28 | `src/popup/components/popups/PopupManager.vue:50-55` | `deduping by \`(profileId, networkId, contract)\` triple — codex post-impl audit M3 + opus C3: bare-contract dedup …`; `(b) the currently-open popup's payload (codex final-review L) so` | `deduping by the \`(profileId, networkId, contract)\` triple: bare-contract dedup …`; `(b) the currently-open popup's payload, so` |
| 29 | `…/PopupManager.vue:83` | `// Defensive drop on dequeue (post-impl codex audit High second-cycle).` | `// Defensive drop on dequeue.` |
| 30 | `…/PopupManager.vue:108` | `// Stale-triple defense (post-impl codex audit High #1). Replay calls` | `// Stale-triple defense. Replay calls` |
| 31 | `…/PopupManager.vue:123` | `// Stale-trust defense (codex post-impl audit Path-2 High #2). If a token` | `// Stale-trust defense. If a token` |
| 32 | `…/PopupManager.vue:196-197` | `could still open under B (post-impl codex audit second-cycle High).` | `could still open under B.` |
| 33 | `…/PopupManager.vue:208-209` | `switches MUST also close the popup. Post-impl audit 3rd-cycle Medium.` | `switches MUST also close the popup.` |
| 34 | `…/PopupManager.vue:232`, `:235` | `reach that triple safely. Co-authored via codex post-impl audit H1.`; `// Init gate (P6, codex Med #1): the onUpdate` | `reach that triple safely.`; `// Init gate: the onUpdate` |
| 35 | `src/popup/pages/send-fiat-gate.test.ts:81` | `describe("send-fiat-gate — snapshot expiry (codex post-impl H4)"` | `describe("send-fiat-gate — snapshot expiry"` |
| 36 | `src/utils/journal-state.test.ts:409` | `… on the journal-detail page (codex post-impl audit H2 + opus C1).` | `… on the journal-detail page.` |
| 37 | `…/journal-state.test.ts:440-441` | `Pre-fix it leaked the raw kind into the UI. Codex post-impl audit H2 + opus C1.` | `Unmapped, the raw kind would reach the UI.` |
| 38 | `src/utils/journal-state.ts:130` | ` * Codex post-impl audit H2 + opus C1.` | deleted |
| 39 | `src/wallet/services/backup/footprint-coverage.test.ts:304` | title `… is NOT pure data (codex post-impl finding)` | `… is NOT pure data` |
| 40 | `src/wallet/services/backup/row-map-migration.ts:89` | `// exactly once here (codex post-impl audit, finding 1).` | `// exactly once here.` |
| 41 | `src/wallet/services/execution/claim-helper.test.ts:6` | ` * Plan v6 §Tests #22-#28 + post-impl review fixes. Covers:` | ` * Covers:` |
| 42 | `…/claim-helper.test.ts:403` | `// controller. Opus post-impl F7.` | `// controller.` |
| 43 | `src/wallet/services/incoming-transfer/service.scenarios.test.ts:1685` | `describe("IncomingTransferService — codex post-impl Path-2 audit fixes"` | `describe("IncomingTransferService — deletion races and timestamp backfill"` |
| 44 | `…/service.scenarios.test.ts:2254` | `// Codex post-impl audit High #1: an A→B profile switch must bump` | `// An A→B profile switch must bump` |
| 45 | `src/wallet/services/incoming-transfer/service.ts:324` | `// Account lifecycle (codex post-impl audit C3): without these,` | `// Account lifecycle: without these,` |
| 46 | `…/incoming-transfer/service.ts:412` | `// Codex post-impl audit High #2: use \`account.profileId\` (NOT` | `// Use \`account.profileId\` (NOT` |
| 47 | `…/incoming-transfer/service.ts:910-911` | `no longer applies). Codex post-impl audit High #1: \`onActiveProfileChanged\` calls` | `no longer applies). \`onActiveProfileChanged\` calls` |
| 48 | `…/incoming-transfer/service.ts:1515` | `// Visibility gate (codex post-impl audit C2): if the user toggled` | `// Visibility gate: if the user toggled` |
| 49 | `src/wallet/services/price/convert.test.ts:132` | `describe("codex post-impl fixes — ceil rate + machine formatting"` | `describe("ceil rate + machine formatting"` |
| 50 | `src/wallet/services/profile/service.integration.test.ts:2945`, `:2990`, `:3008` | `// Post-impl codex round 2: a password change must`; `// Post-impl codex round 2: a passkey backup`; `// Post-impl codex MEDIUM: the stale sweep` | `// A password change must`; `// A passkey backup`; `// The stale sweep` |
| 51 | `src/wallet/services/pxe/shallow-port.fake.ts:46-47` | `(An unused exported const could be tree-shaken away while the factory ships — codex post-impl audit High.)` | `(An unused exported const could be tree-shaken away while the factory ships.)` |
| 52 | `src/wallet/services/token/seeder.test.ts:291` | `describe("TokenSeeder — marker write safety (codex post-impl M7)"` | `describe("TokenSeeder — marker write safety"` |
| 53 | `src/wallet/services/wallet-sdk/queued-journal.test.ts:4-6` | ` *` + ` * Plan v6 §Tests #13-#16 (queued-record creation, cap behaviour) +` + ` * post-impl review fix for atomic-cap under burst (codex + opus F1).` | the three lines deleted (the summary above names creation, the cap and the gates) |
| 54 | `src/wallet/services/wallet-sdk/queued-journal.ts:16-17` | `the cap is advisory rather than protective (codex + opus post-impl F1).` | `the cap is advisory rather than protective.` |
| 55 | `…/queued-journal.ts:39-40` | `/** Module-level lock around count + create. Closes the burst-bypass race flagged by codex + opus in the post-impl review. */` | `/** Module-level lock around count + create, so a burst cannot all read one count and pass the cap together. */` |
| 56 | `packages/aztec-runtime/src/pxe/service.ts:249` | `barrier and change removal/warning timing (codex post-impl).` | `barrier and change removal/warning timing.` |
| 57 | `…/pxe/service.ts:490-491` | `must plumb an explicit sender first (codex post-impl audit MEDIUM — tracked for a follow-up).` | `must plumb an explicit sender first.` (nothing tracks it: `follow-ups.md` has no entry, and the constraint lives here) |
| 58 | `packages/design/src/theme-contrast.test.ts:77-80` | `This is the gate gap the post-impl codex audit caught (HIGH-1/HIGH-2): the original table only checked primary/secondary/inverse, so sub-AA body/tertiary shipped green. Light was raised first; dark was initially left frozen (…) and is now raised to AA too (the dark-muted-aa follow-up) — both themes are asserted here.` | the four lines deleted: `:75-76` already say why (the muted tokens carry security copy and must clear AA in both themes on every surface) |
| 59 | `packages/extension-messaging/src/core/hardening.test.ts:138`, `:140` | `// ── Post-audit hardening (codex post-impl findings) ───…`; `describe("post-audit hardening"` | `// ── Hostile peer messages ───…` (same rule width); `describe("hostile peer messages"` |
| 60 | `.github/workflows/_extension-network-e2e.yml:126` | `# the disable flag (codex post-impl audit finding #1).` | `# the disable flag.` |
| 61 | `.github/workflows/release.yml:50` | `# a write-capable token (codex post-impl audit, Should-fix 3).` | `# a write-capable token.` |
| 62 | `apps/extension/scripts/e2e/agent.sh:103-104` | `# env — the double-opt-in would otherwise arm if both vars are already set` / `# (codex post-impl audit).` | `# env: the double opt-in would otherwise arm if both vars are already set.` (line 104 deleted) |
| 63 | `e2e/helpers/import-stage-timing.ts:134-135` | `would label a prior attempt's terminal as this attempt's failure (codex` / `// post-impl round 1). \`final.stage\` is used only` | `would label a prior attempt's terminal as this attempt's failure.` / `// \`final.stage\` is used only` |
| 64 | `e2e/import-stage-timing.test.ts:164` | `must stay generic, not "IMPORT FAILED" (codex post-impl round 1).` | `must stay generic, not "IMPORT FAILED".` |
| 65 | `e2e/imported-account-lifecycle.test.ts:119-120` | `(self-healing here would destroy recoverable keys — the` / `// post-implementation round-3 decision).` | `(self-healing here would destroy recoverable keys).` |
| 66 | `e2e/network/concurrent-sendtx-approve.test.ts:118` | `// T2's error (codex post-impl audit). walletPopup stays open` | `// T2's error. walletPopup stays open` |
| 67 | `e2e/network/profile-reimport-matrix.test.ts:167`, `:203` | `// reach the popup's error-event collector (post-impl audit) — the digit-render` | `// reach the popup's error-event collector; the digit-render` |

Rows 60 and 61 are comment-only YAML edits; `release.yml`'s is the `permissions:` rationale, so
the diff there must touch no key (P6 gate).

### C6 to C10 · Docs and skills

| # | File:line | Today | After |
|---|---|---|---|
| D1 | `CLAUDE.md:501` | `\| After any code change \| \`bun run lint\` + \`bun run typecheck\` (or let the pre-commit hook do it). \|` | `\| After any code change \| \`bun run lint\` + \`bun run typecheck:all\` (the pre-commit hook lints staged files; it does not typecheck). \|` |
| D2 | `README.md:74` | `bun run typecheck             # vue-tsc across all packages` | `bun run typecheck:all         # every workspace's typecheck` |
| D3 | `package.json:27` (T3) | `"typecheck": "vue-tsc --project apps/extension/tsconfig.json --noEmit",` (exits 127: no `vue-tsc` in the root `node_modules/.bin`) | `"typecheck": "bun run --cwd apps/extension typecheck",` |
| D4 | `CLAUDE.md:291` | `- \`chrome.*\` is stubbed globally in \`tests/vitest.setup.ts\` — no per-test setup needed.` | `- \`tests/vitest.setup.ts\` stubs \`chrome\` before every test with working \`runtime\` ports and message listeners, but \`storage\` is an empty object: a test whose code reads or writes storage stubs \`chrome\` itself (\`vi.stubGlobal\`).` |
| D5 | `.claude/skills/e2e-testing/SKILL.md:532-537` | the block opens with `cd apps/extension` and then runs `bun run e2e:agent`, which only the root `package.json` defines (`:20`) | ```` ```bash ````, `# From the repo root; e2e:agent resolves file paths from apps/extension.`, `taskset -c 0,1 bun run --cwd apps/extension test:e2e --retry=0 tests/e2e/<file>.test.ts   # smoke, ×N rounds`, then the two `e2e:agent` lines unchanged |
| D6 | `.claude/skills/chrome-extension-debug/SKILL.md:17-22` | `… so read a key's fate from a \`window\` keydown listener, which runs after every \`document\` listener.` | `… so read a key's fate the way \`pressEscape\` does (\`apps/extension/tests/e2e/helpers/pointer-probes.ts\`): a \`window\` capture listener added before the press, reading \`defaultPrevented\` in a \`setTimeout(0)\`. A bubble-phase \`window\` listener never hears a key a capture listener stopped, and an open Tooltip stops Escape at \`window\` capture (\`packages/design/src/ui/Tooltip.vue:132-138\`).` The two sentences after it (microtasks between listeners) stay. |
| D10 | `.claude/skills/e2e-testing/SKILL.md:652` (flake ledger row 43) | Fix column `the hygiene follow-up`; Status `open (2026-09-29)` | Fix: `expectCalmArrival` reads the hero only once it shows its priced value (the first call: a dollar figure other than $0.00; the second: the value the first ended on). With the price replies held across the read, the old check failed and the new one passed on both browsers (\`implementations-plan/hygiene/lessons/phase-3.md\`). Rule: on Home, a fiat figure is settled only once the quotes have landed, not when the skeleton goes. Status: `fixed, \`hygiene\` (<date>)`. The Mechanism column's "likely, read in the code and not reproduced" becomes "read in the code and reproduced with the price replies held". |

**D7 · the e2e-testing skill gains the harness findings.** Each claim was checked against the code
or its record (P7 lists the evidence); none needed a probe, and none was dropped.

- In § 2 "Never bypass the helpers", after the first paragraph's list: "`clickByTestId` calls
  `el.click()` in the page (`fixtures/extension.ts:1450`), which an SVG element does not have, so
  an icon-only `<Icon>` target throws inside the wait and times out: press it with
  `pointerClick`."
- In the same section, after "(`settleClosedPopup`)": "Its `true` means only that the popup was
  still in the DOM once its leave began (`fixtures/popup-leave.ts:25-31`), which is the normal state
  straight after a close, not a stuck transition."
- A new subsection at the end of § 2, `### Harness behaviours that look like product bugs`:
  - **Chrome's created windows keep the launch size.** The launch passes `--window-size=400,600`
    (`fixtures/browser/chrome.ts:40`); under it `windows.create` honours `left` and `top` but
    not `width` or `height` (popups 400×600, normal windows 500×600), while `windows.update`
    honours sizes. A spec that measures a created window launches with `fixedWindowSize: false`
    (`network/window-placement.test.ts:46`). Headless Chrome also moves focus only when it creates
    a window: `windows.update({ focused: true })` and `bringToFront()` fire no `onFocusChanged`.
    Firefox honours sizes and focus.
  - **An approval window's page can have no viewport.** `waitForPopup` wraps approval windows with
    `target.asPage()` (`fixtures/popups.ts:53`). On that path the page is created by
    `CdpTarget.asPage`'s fallback with a `null` viewport (puppeteer-core 25.8.0, `cdp/Target.js:54-69`;
    a target whose page already exists returns that page instead), so it renders at the window's
    native size; `browser.newPage()` pages get the 800×600 default.
  - **`protocolTimeout` is set in two places**, Chrome's launch (`fixtures/browser/chrome.ts:59`)
    and Firefox's `puppeteer.connect` (`fixtures/browser/bidi-attach.ts:30`), both 300 s. Change
    them together: Firefox once ran on Puppeteer's 180 s default and cut `sendTransfer`'s 300 s
    wait short.
  - **`inject(key)` returns `undefined` for a key no global setup provided; it never throws**
    (vitest 4.1.10). The smoke setup provides no `playgroundUrl`, so a module-level value built
    from it broke every smoke file at import. Read an injected value when it is used, and fall back
    with `??`.
  - **A resting pointer hovers what opens under it.** On Chrome a card that appears under a still
    pointer matches `:hover` and gets `pointerover`, `pointerenter`, `mouseover` and `mouseenter`,
    with no `pointermove` or `mousemove` (Firefox unprobed). A hover assertion moves the pointer
    onto its target first.
  - **A page a failed test left open keeps its subscriptions.** On a file-scoped browser it can
    take the next test's events first (an arrivals coordinator claimed the next test's receipt).
    Close every page a test opens when the test ends, pass or fail:
    `onTestFinished(() => page.close().catch(() => undefined))`
    (`network/incoming-arrival.test.ts:92`).
  - **A hash change right after the popup opens can lose to its start-up navigation**, which lands
    later and takes the page back to Home. Wait for `#/popup/general` first; a deep hash straight
    after a reload can still bounce, so reach a Settings page through the nav.

**D8 · `FIREFOX.md` gains four rows** in its behaviour table (`:28-48` at `85c4d20f`, same three
columns):

| Firefox behaviour | Symptom if ignored | Where it is handled |
|---|---|---|
| Puppeteer's `emulateMediaFeatures` runs through a CDP emulation manager (puppeteer-core 25.8.0, `bidi/Page.js`), so there is **no media-feature emulation**, `prefers-color-scheme` included. | A capture or assertion that needs the other theme cannot set it from the page. | Not absorbed: set the wallet's own theme (Settings → Appearance), or take that capture on Chrome. |
| A **Tab walk past the page's last stop** leaves the document for the browser's own UI. | `document.hasFocus()` turns false, and a scripted `focus()` on the unfocused document fires no focus events, so a control that opens on focus never does. | Walks stop at the stop they assert (`tooltips-glossary.test.ts:135` ends at the private term, at most 15 presses). |
| An **overflowing scroll area is a Tab stop**. | A Tab-order assertion meets the scroll area before the first control while the window overflows (`cap-window.test.ts` at 360px, and when five "previously denied" rows run the window 27px over). | Not absorbed: size the window so it fits, and give a flow that needs a first request after a rejection its own connect. |
| `windows.getLastFocused({ windowTypes: ["normal"] })` **ignores `windowTypes`** and can answer with a focused approval popup. | The wallet anchors a new window on its own popup instead of the dApp's window. | `ChromeWindowsAdapter` tracks normal-window focus itself on Firefox (`src/core/adapters/chrome-browser-api.ts:200-222`), pinned by `chrome-browser-api.test.ts:60`. |

Each row keeps the browser and version it was observed on, as its record states.

**D9 · the curated layer.** `implementations-plan/lessons.md`'s timing-budget line (as #719 left
it) drops `presto/client` from its list and names it beside `content-message-relay` as moved into
`beforeEach`, both on the hook's default budget; `e2e/config` stays listed. `implementations-plan/follow-ups.md` loses the
§ ux-feedback: technical entries this PR resolves (presto, derivation parity, legal-acceptance,
comments, typecheck, chrome stub, `e2e:agent`, the chrome-extension-debug line, the harness and
Firefox findings, the three-file retry entry, the incoming-arrival entry), and gains F-1 to F-4
below. #719 already moved the Firefox entry's WASM-proving sentence into the failed-send-check
entry (§ Amounts, sends and fees); F-4 keeps the part that entry's fix does not settle.

### C11 · `incoming-arrival`'s calm check reads the hero once it is priced

**Today.** `expectCalmArrival` reads `heroBefore` straight after `setAnimationsDisabled`, whose
return to Home waits only through `waitForHomeTotal` (`network/incoming-arrival.test.ts:280-294`,
`:312-337`; `fixtures/helpers.ts:999-1002`), that is, for the skeleton to go. The skeleton tracks
balances only (`isTotalUnsettled`, `BalanceView.vue:193-200`), and a holding with no quote counts as
$0.00 in the hero (`BalanceView.vue:115-117`). So a read in the window between the balances and
the quotes landing takes "$0.00", the sampler then sees the priced figure and the receipt's, and the
last assertion (`:336`) fails as ledger row 43 recorded. Both calls are exposed: each follows a
round trip through Settings, which remounts Home.

**Fix.** One helper in the test file, used before `heroBefore` on both calls:

```ts
/** Home's hero once its quotes have landed: until then a holding without one counts as $0.00. */
async function waitForPricedHero(page: Page): Promise<string> {
	await page.waitForFunction(
		() => {
			const text = document.querySelector('[data-testid="balance-amount"]')?.textContent?.trim() ?? ""
			return text.startsWith("$") && text !== "$0.00"
		},
		{ timeout: 30_000, polling: 100 },
	)
	return page.$eval(sel("balance-amount"), (el) => el.textContent?.trim() ?? "")
}
```

`expectCalmArrival` reads `heroBefore` from `waitForPricedHero(page)`. As planned, the second call
waited for the exact figure the first ended on; the codex loop dropped that, since wherever
CoinGecko answers, a quote refresh between the calls moves the figure (`lessons/post-impl.md`). The
criterion holds because every sandbox contract prices
as USDC in the network build (`price-map.ts:44-52`, `:62-69`) and `seedUsdQuoteAndReload` seeds a
$1 quote (`fixtures/helpers.ts:1026-1034`), so the funded wallet's settled hero is never $0.00.
`waitForHomeTotal` itself stays: `fiat-display.test.ts:15-19` needs it to resolve on an empty
wallet's true $0.00. The 30 s wait is a new wait, not a raised one: the quotes' own fetch aborts at
10 s (`price/service.ts:335`).

**How long Home shows "$0.00" (the product question, answered in the code).** After a remount the
hero's `usePrices` starts with no quotes (`usePrices.ts:23`) and asks the background once
(`refreshIfStale`, `:33-41`). The background answers from its cache only when every mapped id
(`allCoingeckoIds`: Fee Juice's `aztec` and `usd-coin`, `price-map.ts:92-96`) has a quote younger
than 15 minutes (`spec.ts:22`, `:34-38`), or when a fetch completed in the last 3 minutes of this
service-worker lifetime (`service.ts:27`, `:94-99`, `:153-157`). Otherwise it awaits a CoinGecko
fetch, aborted at 10 s (`service.ts:335`), before the popup gets any quote, cached ones included.
So a person sees "$0.00" for a message round trip when the cache is complete and fresh, and for up
to the fetch (at most 10 s) when it is not, for example on the first popup open after the browser
was closed for over 15 minutes. The e2e seed holds `usd-coin` only, so every remount takes the fetch
path unless a fetch completed in the last 3 minutes. This plan does not change the hero: F-3 takes
it to `layout-polish`, which owns Home.

### File-level change map

- **Added**: `apps/extension/tests/e2e/fixtures/extra-tokens.ts` (T1, factory or shared function);
  `implementations-plan/hygiene/` (plan, recon, lessons).
- **Deleted**: `apps/extension/tests/e2e/scripts/check-derivation-parity.ts`.
- **Modified, tests**: `e2e/network/{holdings,home-cap,pin-to-home,send-picker,incoming-arrival}.test.ts`,
  `e2e/fixtures/helpers.ts` (`clearPinnedTokens`), `e2e/legal-acceptance.test.ts` (branch 1 or 3
  only), `src/presto/client.test.ts`, `src/wallet/services/wallet-sdk/content-message-relay.test.ts`,
  `apps/extension/scripts/e2e/browser-seam.test.ts`, and the test files in the C5 table.
- **Modified, comments only**: the production files in the C5 table (9 under `apps/extension/src`,
  1 under `packages`, plus the test fake `shallow-port.fake.ts`), `agent.sh`, two workflow files.
- **Modified, docs**: `CLAUDE.md`, `README.md`, `package.json` (T3),
  `.claude/skills/e2e-testing/SKILL.md`, `.claude/skills/chrome-extension-debug/SKILL.md`,
  `apps/extension/tests/e2e/FIREFOX.md`, `implementations-plan/{index,lessons,follow-ups}.md`.

### Trade-offs and alternatives not taken

- **C1, guard in the body instead of a fixture** (#719's rejected fallback: skip the import when
  the row exists). It keeps a retry's second deploy and needs two boundary probes; the fixture is
  simpler and already proven.
- **C1, reset pins through the UI** (open ALT's page, read `data-pinned`, unpin if pinned). A
  conditional UI path in a test body, three helpers deep, that can itself fail mid-reset; the
  storage reset is one call on the key the product owns.
- **C2, `beforeAll` instead of `beforeEach`.** Fewer imports, but test 1 would then share
  instances with test 2; per-test instances keep the file order-independent at no real cost.
- **C3, repair the script.** It would restate `feeJuiceImportedExtension` with a second copy of the
  import flow to keep in step.
- **C5, a static guard** against the two tags. Two strings out of a class of hundreds; the sweep
  that owns the class can build the guard once (§ Follow-ups).
- **C11, make `waitForHomeTotal` wait for prices.** It would never resolve on an empty wallet's
  true $0.00 (`fiat-display.test.ts`); the settle signal belongs to the test that reads a price.

## Security & Adversarial Considerations

- **Threat model.** No new runtime surface: no product code path changes, no new dependency, no
  permission, no storage shape. The deleted script held no secret (it generated a random master and
  printed it to a local console).
- **The real risk is a comment rewrite that drops an invariant a later reader relies on.** Rows 28
  to 34 (the trust prompt's stale-triple and stale-trust defenses), 40 (the migration DSL's
  accessor defence), 45 to 48 (incoming-transfer lifecycle, privacy gate), 51 (the prod-leak
  marker), 54 and 55 (the queued cap's atomicity) and 57 (the NO_FROM sender constraint) all keep
  their stated mechanism word for word; only the citation goes. Row 4 corrects a false invariant
  (a 5-row cap the in-flight cards can exceed). The codex audits check each row against its diff.
- **Workflow files.** Rows 60 and 61 change comments only; the P6 gate proves no YAML key moved
  (`permissions:` in `release.yml` included). Least privilege is unchanged.
- **Test pages writing storage.** `clearPinnedTokens` runs in an e2e wallet page against a
  throwaway test profile, the same idiom as `seedUsdQuoteAndReload`; the storage-facade rule binds
  UI code, not tests. It removes only keys with the product's pin prefix.
- **A test that hides a defect.** C4's branch 2 and C11's F-3 exist so that no wait in this plan
  absorbs a visible defect: a covered export control or a "$0.00" hero leaves as a follow-up with
  its evidence.
- **Supply chain, crypto, logging.** Untouched: no install, no lockfile change, no crypto code, no
  log line.

## Assumptions

### Facts (verified at `85c4d20f` by reading the file; files #719 did not touch read at `f32b1e0a`, the same bytes)

1. `holdings.test.ts:30-37`, `home-cap.test.ts:32-39` and `pin-to-home.test.ts:42-49` deploy and
   import their tokens inside the body; `tokenReadyExtension` is file-scoped
   (`fixtures/extension.ts:731`, `{ scope: "file" }` at `:792`). Each file holds one test.
2. The assertions a second set breaks: `holdings.test.ts:44-51` (`ZED,TST`, count `3`),
   `home-cap.test.ts:43-51` (`BIG,TST,MID`, count `4`), `pin-to-home.test.ts:52` (`TST,ALT`).
3. Only `pin-to-home` pins (`:57`) and unpins (`:72`); pins persist under
   `nulo:ui:pinnedTokens@<profileId>` (`src/utils/profile-ui-keys.ts:6`, `:12`;
   `src/composables/usePinnedTokens.ts:179`). Holdings' sort, search and fold are component refs
   (`src/popup/components/modules/holdings/TokenList.vue:34-36`).
4. The network config retries twice unless `NULO_E2E_RETRY` is set
   (`vitest.e2e.network.config.ts:46`); the PR gates pass `"0"`
   (`.github/workflows/pr-extension-network-e2e.yml:165`), so the defect bites local and nightly
   runs, not PR gates.
5. `seedUsdQuoteAndReload` overwrites `nulo:core:token-prices` and reloads to Home
   (`fixtures/helpers.ts:1026-1034`).
6. `presto/client.test.ts:6-7` and `:14-17` reset modules and import `./client` inside the body.
   Vitest's defaults are 5 s per test and 10 s per hook (`vitest/dist/chunks/coverage.DM_a_rWm.js:538`);
   `apps/extension/vitest.config.ts` and `vitest.base.ts` set neither. Recorded evidence, not
   re-run for this revision: alone, 2 passed with tests at 37 ms (2026-09-29).
7. `src/e2e/config.test.ts:14-25` stubs its env before each case's import, so a hook import would
   need nested hooks or parameterized cases to keep that order; the file stays outside this plan.
8. `check-derivation-parity.ts:117-118` waits for and clicks `import-option-private-key`;
   `ImportMethodPicker.test.ts:41` pins its absence; the only live reference is
   `scripts/e2e/browser-seam.test.ts:12-15`.
9. `feeJuiceImportedExtension` (`fixtures/extension.ts:886-957`) derives the account test-side
   (`fixtures/aztec.ts:540-551`), imports the phrase with `importSeed`, switches to Local and waits
   for `nulo:ui:activeAccount` to equal the derived address; `frozen-account-canary.test.ts:117-137`
   hand-rolls the seed formula and set-matches the wallet's addresses; the required Chrome network
   lane runs that canary (`pr-extension-network-e2e.yml:249`) and checks it against its inventory
   (`_extension-network-e2e.yml:307`); the reference vectors run in `test:all` (`_unit-tests.yml:25`).
10. The snack sits `SNACK_GAP` above a registered footer (`src/composables/snackInset.ts:8`,
    `:85-95`); `CollapsingHeroLayout.vue:84` registers its bottom slot, which
    `export/account.vue:296` and `export/full.vue:624` fill (`agree-continue-btn` `:625`,
    `unlock-submit-btn` after it); a still pointer does not hold it
    (`packages/design/src/ui/ToastManagerBase.vue:36-44`, `:77-80`); an unheld success closes 6 s
    after it opens, and a pointer or focus hold pauses that timer (`packages/design/src/composables/toast.ts:4`,
    `:63`, `:74`).
11. `legal-acceptance.test.ts:213-216` holds the comment, `page.mouse.move(180, 40)` and the 10 s
    wait; `downloadFullBackup` presses `agree-continue-btn`, `unlock-submit-btn` and
    `download-backup-btn` with `pointerClick` (`:129-147`), which throws "`<testid>` is covered at
    its centre by `<cover>`" (`e2e/helpers/legal-drivers.ts:95`).
12. The two tags at `85c4d20f`: 10 lines in 8 files, and 51 lines in 27 files, under
    `apps/extension/src` and `packages`; 9 more "post-impl" lines in 8 files under
    `apps/extension/tests/e2e`, `apps/extension/scripts` and `.github/workflows`; 41 files in all,
    10 of them production code (`git grep -n -i`).
13. The root `typecheck` script is `vue-tsc --project apps/extension/tsconfig.json --noEmit`
    (`package.json:27`) and the root has no `node_modules/.bin/vue-tsc` (the extension has one);
    `typecheck:all` is `:28`; `CLAUDE.md:501` and `README.md:74` name `bun run typecheck`; the
    pre-commit hook runs Biome, the path guard and the complexity check, no typecheck
    (`.githooks/pre-commit`).
14. `apps/extension/tests/vitest.setup.ts:52-53` stubs `chrome` with `storage: {}`;
    `CLAUDE.md:291` says no per-test setup is needed.
15. `e2e:agent` exists only in the root `package.json` (`:20`) and `agent.sh:14` changes into
    `apps/extension`, so its file arguments are relative to it; the skill's block runs it after
    `cd apps/extension` (`SKILL.md:532-537`).
16. `Tooltip.vue:132-138` stops Escape's propagation from a `window` capture listener added on
    open (`:160`); `pressEscape` reads from a `window` capture listener in a `setTimeout(0)`
    (`pointer-probes.ts:67-91`).
17. `clickByTestId` calls `target.click()` in the page (`fixtures/extension.ts:1450`);
    `settleClosedPopup` returns true whenever the popup is still in the DOM after its leave class
    appears (`fixtures/popup-leave.ts:25-31`); Chrome's launch sets `--window-size=400,600` only
    with `fixedWindowSize` (`fixtures/browser/chrome.ts:40`) and `protocolTimeout: 300_000`
    (`:59`); Firefox's connect sets the same (`fixtures/browser/bidi-attach.ts:30`);
    `waitForPopup` uses `target.asPage()` (`fixtures/popups.ts:53`), and puppeteer-core 25.8.0's
    `CdpTarget.asPage` returns an existing `pagePromise` first and otherwise creates the page with a
    `null` viewport (`lib/puppeteer/cdp/Target.js:54-69`); vitest's `inject` is a plain lookup
    (`vitest@4.1.10` `dist/chunks/test.DNmyFkvJ.js:4164-4166`).
18. Puppeteer's BiDi `emulateMediaFeatures` delegates to a CDP `EmulationManager`
    (`lib/puppeteer/bidi/Page.js:156`, `:363-364`); the windows adapter documents and absorbs
    Firefox's ignored `windowTypes` (`src/core/adapters/chrome-browser-api.ts:200-222`).
19. `apps/extension/tsconfig.json:22` includes `src/**`, `vite.config.ts` and `package.json` only, so
    no gate typechecks `tests/e2e/**`.
20. `scripts/ci-cd/canary-expectations.json` lists four canary files with their test titles
    (`:2-13`); no C5 row renames a title in those files.
21. C11's mechanism: `waitForHomeTotal` waits for `balance-amount` and for `balance-hero-loading` to
    go (`fixtures/helpers.ts:999-1002`); the skeleton shows while `isTotalUnsettled`, which reads
    balances and seeds only (`BalanceView.vue:193-212`, `:351`); an unpriced holding counts as $0.00
    (`:115-117`, `utils/token-aggregate.ts:17-29`); `usePrices` starts empty and fills from
    `refreshIfStale` (`composables/usePrices.ts:23-41`); `refreshIfStale` answers from cache only
    when every id is fresh or a fetch completed within 3 min, else awaits a fetch aborted at 10 s
    (`wallet/services/price/service.ts:27`, `:145-158`, `:335`; `spec.ts:22`; `price-map.ts:92-96`).
    `expectCalmArrival` reads `heroBefore` at `network/incoming-arrival.test.ts:314` and asserts at
    `:336`; both calls follow `setAnimationsDisabled` (`:490-496`), which returns through
    `waitForHomeTotal` (`:293`). `fiat-display.test.ts:15-19` needs `waitForHomeTotal` to resolve on
    a true $0.00.
22. At `85c4d20f`, `follow-ups.md`'s failed-send-check entry carries the Firefox WASM observation as
    "likely explains ux-feedback's `sendTransfer` failures there … (`imported-account-execution`
    not rechecked)"; the Firefox entry no longer carries it.
23. `src/wallet/services/wallet-sdk/content-message-relay.test.ts:15-27` at `85c4d20f` awaits
    `import("./content-message-relay")` in a `beforeEach` passed `30_000`, and its comment says the
    hook's 10 s default can be outlasted too; #719's squash message says the change raised no
    timeout. #719's own record of it: the unfixed file never timed out on this host, at 2.9 s worst
    under four-way contention on one CPU, and the fixed file's pinned runs reported 196 to 1,086 ms,
    hook included (`e2e-reliability-fixes/lessons/phase-2.md`).

### Inferences (unverified; the audit attacks these)

1. The factory's `[fn, { scope: "file" }] as const` type-checks inside `base.extend<…>` in each
   file. P2's focused compiler check settles it; if not, the shared-function fallback ships (C1).
2. The account export's snack is still on screen at the first bottom-row press on at least one run
   per browser; P4's probe measures it, and holds the snack open if no run catches it.
3. `bun run --cwd apps/extension typecheck` from the root runs the same check the broken root
   script meant to run (same tsconfig).
4. The shared pin prefix derived as `pinnedTokensKey("")` stays the prefix, since
   `PROFILE_UI_KEY_PREFIXES`' contract is that every key is its prefix plus a whole id
   (`profile-ui-keys.ts:8-9`).
5. Holding the `price` port's `refreshIfStale` replies in the page (#719's row-40 probe method, on
   the port `PRICE_SERVICE_NAME` names, `price/spec.ts:1`) reproduces row 43's read on both browsers.

### Asks

**Owner**: none. Nothing here changes a screen; the two visible findings a probe can surface (a
covered export control, Home's "$0.00" before its quotes) leave this plan as follow-ups with their
evidence, and the owner decides them with pictures in the plan that takes them.

**Codex** (round 1 decisions recorded; § Plan audit ledger)

- **T1 · One factory for the four file-scoped token fixtures, or an inline fixture per file.**
  Codex: amend (the factory, gated by a focused compiler check; the fallback shares the
  deploy-and-import function, never four bodies). Applied (C1, P2).
- **T2 · `check-derivation-parity.ts`: delete, or port to the current import flow.** Codex:
  approve delete. Applied (C3, P5).
- **T3 · The root `typecheck` script: repoint it to the extension's own script.** Codex: approve.
  Applied (D3).
- **T4 · The comment sweep's reach: also the "post-impl" lines outside `apps/extension/src` and
  `packages` (rows 60 to 67), and other workflow references inside a touched block.** Codex: amend
  (with finding 3's corrections). Applied (rows 2, 4, 10, 58).
- **T5 · `fixtures/playground.ts:17-23`'s dead `try`/`catch` fallback.** Codex: reject for this PR
  (no current consumer needs the smoke fallback). Dropped (§ Decision ledger).

### Plan audit ledger

- `/codex high` round 1 (GPT-6 Astra, session `01a0eddd-2b07-7ab2-a6fc-78ef97a9da9e`), the light
  tier's single pass with the full packet (adversarial, assumption-attack, implementation critique,
  the recon reuse map): **conditional approve**, confidence high, conditions 1 to 7, all applied in
  this revision. The driver's calls on the round (`_driver-r1.md`) added C11 and rebased the plan
  onto `85c4d20f`.

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex 1 | major | C2's new hook raised the timeout to 30 s; the phase-5 record never separated import time | accepted: the hook keeps vitest's 10 s default, every identity assertion and the reset-removal mutation stay; the record is cited as the likely cause, not a measurement (C2, Fact 6, P1) |
| 2 | codex 2 | major | C4's fallback treats a covered export control, a failed mutation and a missing snack alike and waits them away | accepted: three branches with their own evidence and bars; a real cover leaves the plan as a follow-up for the owner, never waited away; the mutated press records snack presence; an unobserved snack is inconclusive (C4, P4) |
| 3 | codex 3 | minor | Row 4 kept a false invariant (a hard 5-row cap, a settled row always survives); rows 2, 10, 58 kept build narration and history | accepted: row 4 states the real budget (in-flight cards always render; one newest-first merge with incoming transfers, no reserved slot); rows 2 and 10 keep only the presentational and getter-at-click constraints; row 58 deletes the history, `:75-76` carry the why |
| 4 | codex 4 | minor | T1's typing assumption has no gate: `tsconfig.json:22` excludes `tests/e2e/**` | accepted: P2 runs a focused uncommitted compiler check over the factory and its four users; the fallback shares the deploy-and-import function instead of duplicating four bodies (C1, Fact 19) |
| 5 | codex 5 | minor | Gates overclaim: an isolated rerun counted for a failed `test:all`; a build cannot prove bundle equivalence; P2's exit 0 lets `skipIf(!hasConfig)` pass vacuously | accepted: isolated reruns are diagnostic and the aggregate must pass (P6, P8); P8 inspects the diff hunk by hunk and checks the footer mutation is restored; each flake run needs four passed, none skipped (P2) |
| 6 | codex 6 | minor | D9 dropped the unresolved Firefox WASM-proving 300 s timeout with the Firefox entry | accepted (driver): #719 moved it into the failed-send-check entry as "likely"; F-4 keeps it open, since that fix settles only the 60 s popup deadline (D9, Fact 22) |
| 7a | codex 7 | minor | Fact 7 claimed a hook import is impossible for `e2e/config.test.ts` | accepted: nested hooks or parameterized cases could keep the order; out of scope on that ground (Fact 7, ledger) |
| 7b | codex 7 | minor | Fact 12: "Phase 2 follow-up" is in 8 files, not 9 | accepted: recounted at `85c4d20f` (Fact 12); the other counts also moved with #719 (9 lines in 8 files outside `src` and `packages`) |
| 7c | codex 7 | minor | Fact 10: six seconds is the unheld lifetime; holds pause it | accepted (Fact 10) |
| 7d | codex 7 | minor | Fact 17 and recon: `asPage()` returns an existing page first; only its fallback passes `null` | accepted: the skill line and Fact 17 are scoped to the observed approval-window path (D7) |
| 7e | codex 7 | minor | Inference 3: `canary-expectations.json` lists titles too | accepted: now Fact 20 (no renamed title is there) |
| 7f | codex 7 | minor | C3 overstated that every network run exercises parity | accepted: C3 names the fixture's users, the required canary lane and `test:all` |
| 7g | codex 7 | minor | Fact 6's 37 ms run was not independently verified | accepted: labelled recorded evidence (Fact 6) |
| 8 | codex T5 | minor | T5 spends work on an unexercised smoke fallback | accepted: rejected for this PR, one ledger line |
| 9 | driver | minor | Add flake ledger row 43 (`incoming-arrival`'s calm check reads a $0.00 hero) and answer whether Home flashes $0.00 | accepted: C11, P3 (red-first held-price probe, flake bar, D10), Fact 21; the visible part is F-3 for `layout-polish` |
| 10 | driver | minor | Rebase onto `85c4d20f` and re-verify Facts citing files #719 touched | accepted: base, Facts 1, 9, 12, 15, 17, recon rows and `FIREFOX.md` table lines re-read; `backup-migration-roundtrip`'s row dropped |
| 11 | driver, 2026-09-29 | major | #719 raised a hook budget its squash said it did not | hygiene removes it: F-5 moves from Follow-ups into C2's scope, with `presto/client`'s proof and bar (C2, P1, Fact 23) |

### Decision ledger

Realism (one line each, no fix, no test, no question):

- **Holdings' sort state.** Not persisted (`TokenList.vue:35`), rebuilt on every mount, and each
  attempt opens a fresh popup: nothing to reset. The brief's "sort state" item becomes this line.
- **Pins in `holdings` and `home-cap`.** Neither file pins: no reset there.
- **A setup-failure probe for the new fixtures.** The runner behaviour is vitest's, proven once by
  #719's setup probe (`e2e-reliability-fixes/lessons/phase-4.md`); repeating it per file proves
  nothing new.
- **`e2e/config.test.ts`'s cold import.** Its import follows each case's `vi.stubEnv` (Fact 7); a
  hook form would need nested hooks or parameterized cases, a restructure beyond this plan. It stays
  in `lessons.md`'s timing-budget line (F-2).
- **Firefox for the resting-pointer hover finding.** Recorded on Chrome only; the skill line says
  "Firefox unprobed" rather than paying for a probe no current test needs.
- **The retry probes on Firefox.** The defect and the fix are the runner's and the wallet's
  storage, not the browser's: the body-failure probes run on Chrome; the flake bar runs on both.
- **`tests/e2e/scripts/check-setup-pre-funded.ts`.** Also a one-time scratch script, but it still
  runs against a live fixture function; out of this plan's scope.
- **`pxe/service.ts:491`'s "tracked for a follow-up".** False (no entry exists); the constraint
  stays in the comment, where the next person to widen the NO_FROM path reads it. No follow-up.
- **T5, `fixtures/playground.ts`'s dead `catch`.** No current smoke file opens the playground, so
  changing it only removes a documentation counterexample (codex round 1: reject).
- **`network/fiat-send.test.ts:43-46` reads the hero after `waitForHomeTotal` too.** It first waits
  for a token row's fiat line (`:37-39`), which the same price broadcast fills, so its read already
  follows the quotes; no change.

Choices: C1's fixture over a body guard, storage pin reset over a UI reset, C2's `beforeEach`
over `beforeAll` on the default hook budget, C3's deletion, no static guard, C11's settle wait in
the test over a price-aware `waitForHomeTotal` (§ Trade-offs). No point is disputed with codex.

### Follow-ups

- **F-1 · The rest of the workflow-reference class in code.** 222 lines in 94 files under
  `apps/extension/src` and `packages` name codex, opus or fable, and 67 files carry `Phase N` /
  `P<n>` tags, some of them live runtime phases that stay. A sweep of its own, with a static guard
  once the tree is clean.
- **F-2 · `e2e/config.test.ts` times out under load** (lessons.md's timing-budget line); its import
  follows each case's `vi.stubEnv`, so the fix, if any, is nested hooks or parameterized cases.
- **F-3 · Home shows "$0.00" until its quotes land** (visible; for `layout-polish`, which owns
  Home). The hero's skeleton waits for balances only, so a priced wallet reads "$0.00" for a
  message round trip after every remount, and for up to a CoinGecko fetch (aborted at 10 s) when any
  cached quote is missing or older than 15 minutes, as on the first open after the browser was
  closed that long (C11, Fact 21). A change to what the hero shows is an owner call, with pictures.
- **F-4 · Firefox prover-ON `imported-account-execution` overran `sendTransfer`'s 300 s wait** with
  no protocol error (`ux-feedback/b1-first-run-wording/lessons/phase-5.md:71-75`). #719 reads it as
  likely the popup's 60 s `executeTransfer` deadline (flake ledger row 42), not rechecked. Once
  `failed-send-check` lands, rerun that file on Firefox prover-ON without Presto; if it still
  overruns, it goes to the `aztec-update` skill as a WASM proving-time finding.
- **F-6 · The e2e tree does not type-check** (found in P2). No gate reads `tests/e2e/**`
  (Fact 19), and one harness line collapses the exported `test`'s context type:
  `firstTwoAccountsFixture` (`fixtures/extension.ts:474-476`) types its context
  `({}: Record<string, never>, use)`, which fails vitest's object-form `extend` at `:708` and
  `:712`, so under a type check every spec's fixture destructuring is TS2339. With that context
  typed `object`, 41 errors remain in seven fixture and helper files (`journal.ts` 20,
  `helpers.ts` 8, `aztec.ts` 5, `extension.ts` 4, `global-setup.ts` 2, two more with one each). A
  type gate over `tests/e2e/**` needs those fixed first (`lessons/phase-2.md`).
- **C4**: P4 took branch 1 (the park deleted), so it leaves no follow-up.

F-5 (`content-message-relay.test.ts`'s 30 s hook budget) moved into C2's scope (ledger row 11).

## Approval

The driver approves this revision as the plan's last planning step (light tier), under the owner's
pre-answered Phase 0; codex round 1's conditions are all applied. There is no owner decision page:
no Ask needs the owner and no surface needs a sign-off. If P4 takes branch 2, that follow-up gets
its own decision page in the plan that takes it, every option pictured.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/hygiene/lessons/phase-N.md`. Unit commands run from the named
workspace. A probe is never committed; each is recorded in its phase's lessons with its command
and result. Only one `e2e:agent` runs at a time in the worktree, never a smoke and a network run of
the same browser together, and `bun run e2e:reap` follows the last e2e run of a phase.

### P0 · Home the plan ✓

1. `chore/hygiene` off `dev` (`85c4d20f` or later), worktree `.claude/worktrees/hygiene`,
   registered in the manifest.
2. First commit: `implementations-plan/hygiene/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.
3. Re-grep every file:line this plan cites against the branch base (`fix/send-amount-exact`'s and
   any later merge's moves); record the shifts in `lessons/phase-0.md`.

Assumptions: none beyond Facts 1-22 holding on the branch base.

Validation gate:
- Commands: `bun scripts/ci-cd/plans/check.ts`; `bun run lint`.
- Pass criteria: both exit 0; `lessons/phase-0.md` lists every re-located line.
- Layers: plans gate, lint.

### P1 · C2 · `presto/client.test.ts` and `content-message-relay.test.ts` ✓

1. The two-instance `beforeEach` of § C2, on the default hook budget; both bodies synchronous.
2. `content-message-relay.test.ts`: the `30_000` argument removed from its `beforeEach` and the
   comment above it trimmed to its lasting reason, if the load runs below stay green on the
   default budget; otherwise the slow import is found and fixed at its cause, with no raised budget
   (§ C2; stop after three failed attempts).
3. Evidence in `lessons/phase-1.md`, #719's method, for each file:
   - Uncommitted instrumentation times each test callback and the hook separately, the file in a
     fresh process: before the fix, the callbacks include the import (for the relay, whose import
     already sits in the hook, the hook's time on its current budget); after it, each callback runs
     under 1 s and the imports sit in the hook, which runs under its 10 s default.
   - Load: the file 10 times as is, then 20 times with vitest and three busy loops pinned to one CPU
     (`taskset -c <n>`), before and after. After: every run green. If the unfixed file never times
     out here, the lessons say so and the instrumented timing stands as the proof. If a pinned run
     times out in the hook, no timeout is raised: the run is recorded and codex decides the next step.
   - Isolation mutation: without the second `vi.resetModules()`, `presto/client`'s test 2 fails;
     without the relay's `vi.resetModules()`, its later cases fail.
4. D9's `lessons.md` line.

Assumptions: Facts 6, 23.

Validation gate:
- Commands (from `apps/extension`): `bun --bun vitest run src/presto/client.test.ts`;
  `bun --bun vitest run src/wallet/services/wallet-sdk/content-message-relay.test.ts`; the load and
  mutation runs above, for each file. Then `bun run lint`; `bun run typecheck:all`.
- Pass criteria: all exit 0 on the fix; each mutation run exits nonzero; 20 of 20 pinned runs green
  for each file; the diff sets no `timeout` or `hookTimeout`, and neither file passes a budget to a
  hook or a test.
- Layers: unit, load probe, lint, typecheck.

### P2 · C1 · the four token specs ✓

1. `fixtures/extra-tokens.ts` and the four files on it (T1: the factory; the shared-function
   fallback of § C1 if step 2 fails on the factory).
2. The focused type check, uncommitted: a scratch `tsconfig` in `apps/extension` that extends
   `tsconfig.json` and includes `src/**/*.d.ts`, `tests/e2e/fixtures/extra-tokens.ts` and the four
   network files, run with `bun x vue-tsc --noEmit -p <scratch tsconfig>`. Run it first on the base
   with `send-picker.test.ts` alone to record the harness's pre-existing error count, then on the
   change. Deleted after the run.
3. `clearPinnedTokens` in `fixtures/helpers.ts`; `pin-to-home` calls it before
   `seedUsdQuoteAndReload`.
4. Red first, on the base (the in-body setup), uncommitted, with `NULO_E2E_RETRY=1` on Chrome: a
   module-level flag throws once right after the in-body setup (holdings after `:37`, home-cap
   after `:39`, pin-to-home after `:49`). Each file must fail its retry on the doubled rows; record
   the failure text.
5. Green, on the fix, the same env: the flag throws once at the top of each body. Each retry
   passes, and after the run the wallet holds exactly one token row per deployed symbol (read from
   `nulo:core:tokens@`, as #719's probe did).
6. The pin probe, Chrome, `NULO_E2E_RETRY=1`, the flag throwing once right after
   `pinFromTokenPage` (`:57`): first with the `clearPinnedTokens` call removed (an uncommitted
   variant), where the retry must fail at `waitForHomeOrder(page, "TST,ALT")`; then with the call,
   where the retry passes.
7. The flake bar: three consecutive retry-0 runs of the four files on each browser.

Assumptions: Facts 1-5, 19; Inferences 1, 4; T1.

Validation gate:
- Commands:
  - `bun run lint`; `bun run typecheck:all`; the step 2 compiler check;
  - `bun --bun vitest run scripts/e2e/unresolved-names.test.ts scripts/e2e/browser-seam.test.ts`
    (from `apps/extension`);
  - probes: `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=1 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/<file>.test.ts`;
  - flake bar ×3 each:
    `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/holdings.test.ts tests/e2e/network/home-cap.test.ts tests/e2e/network/pin-to-home.test.ts tests/e2e/network/send-picker.test.ts`
    and the same with `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1`;
  - `bun run e2e:reap`.
- Pass criteria: lint, typecheck, the two scans and the reap exit 0; the compiler check reports no
  error in `extra-tokens.ts` or the four files and no more elsewhere than the base count; each base
  probe exits nonzero on its doubled rows; each fix probe exits 0 with one row per symbol; the pin
  probe fails without the reset and passes with it, in that order; every flake-bar run exits 0 with
  4 passed and 0 skipped.
- Layers: lint, typecheck, focused e2e type check, harness scans, network e2e (both browsers),
  probes.
- As built: the factory's tuple is typed explicitly, since vitest's fixture tuple is mutable and
  `as const` makes it readonly (Inference 1: false as written, true for the typed tuple, so T1's
  factory ships), and the reset calls `get()`, since chrome-types rejects `get(null)`. On the real
  harness the compiler check cannot meet its criterion: one pre-existing harness line collapses
  every spec's context type (three errors per file with the change, one or two before). With that
  line retyped in an uncommitted probe, the change adds no error anywhere (41 before and after).
  The line is F-6. A second run of the base probes read the doubled rows from storage
  (`lessons/phase-2.md`).

### P3 · C11 · `incoming-arrival`'s calm check ✓

1. `waitForPricedHero` and the `expectCalmArrival` change of § C11.
2. The held-price probe (uncommitted), #719's row-40 method: from just before
   `setAnimationsDisabled`'s return to Home, the page's `chrome.runtime.connect` is wrapped so that
   on every `price` port it opens, `refreshIfStale` replies are queued until a release.
   - **Base** (the file before the fix): the probe releases the queue only after `heroBefore` is
     read. The test must fail at `:336` with `heroBefore` "$0.00" (row 43's assertion), on Chrome and
     on Firefox (the first call is exposed on both).
   - **Fix**: the queue releases itself 1.5 s after the first request; the test passes, and
     `lessons/phase-3.md` records how long `waitForPricedHero` waited.
3. The flake bar: three consecutive retry-0 runs of `network/incoming-arrival.test.ts` on each
   browser.
4. D10 (flake ledger row 43) in the same commit.

Assumptions: Fact 21; Inference 5.

Validation gate:
- Commands: `bun run lint`; the probe runs;
  `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/incoming-arrival.test.ts`
  ×3, and the same with `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1` ×3; `bun run e2e:reap`.
- Pass criteria: lint exits 0; the base probe fails with the recorded assertion and a "$0.00"
  `heroBefore` on both browsers, the fix probe passes on both; every flake-bar run exits 0 with the
  file's passed count equal to its test count on that browser and no skip beyond the file's own
  `isFirefox` guards; the reap exits 0.
- Layers: lint, network e2e (both browsers), probe.
- As built: every run sets `NULO_E2E_PROVERLESS=1`, Chrome's included, since the file is
  `@requires-proverless` and `agent.sh` refuses it otherwise. Both base probes failed at `:336`
  with `heroBefore` "$0.00", both fix probes passed (the helper waited about 1.5 s, the length of
  the hold), and the bar was 7 of 7 on every run (`lessons/phase-3.md`). The codex loop then
  put the second call on the first's priced check; the fix probe and the bar reran on that
  code (`lessons/post-impl.md`).

### P4 · C4 · `legal-acceptance.test.ts` ✓

1. Uncommitted presence probe: a `pointerdown` capture listener on the S5 page records, at each of
   `agree-continue-btn`, `unlock-submit-btn` and `download-backup-btn`, whether a
   `[data-testid="snackbar"]` is on screen and both boxes. If no run finds the snack at the first
   press, the probe moves the pointer onto the snack before the navigation (a move holds it) and runs
   again. Run with the wait removed.
2. Uncommitted mutation: `v-snack-footer` removed from `CollapsingHeroLayout.vue:84`, rebuild, run
   S5 on Chrome with the probe and the wait removed: record whether the snack is on screen at the
   press and whether the press fails "covered at its centre by snackbar". Restore and rebuild.
3. Take the branch § C4 names: 1 deletes `:213-216`; 2 leaves the file as it is and writes the
   follow-up with its evidence (browser, boxes, a screenshot of the covered row); 3 keeps the wait
   with its harness reason and drops the park; an inconclusive probe changes nothing. Record which
   and why in `lessons/phase-4.md`.

Assumptions: Facts 10, 11; Inference 2.

Validation gate:
- Commands: the smoke build per browser
  (`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:<b>`),
  then ×3 per browser
  `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0 tests/e2e/legal-acceptance.test.ts`;
  the probe and the mutation runs; `git diff --exit-code -- apps/extension/src/components/composite/CollapsingHeroLayout.vue`;
  `bun run lint`.
- Pass criteria, by branch:
  - **1 (delete)**: the probe records the snack on screen at a press on each browser and every
    unmutated press succeeds; the mutated run records the snack on screen and fails with the cover
    message, or records non-overlapping boxes; three green retry-0 runs per browser without the wait.
  - **2 (product defect)**: the covering run's evidence is in `lessons/phase-4.md` and in
    § Follow-ups; `legal-acceptance.test.ts` has no diff.
  - **3 (keep the wait)**: branch 1's clear-press evidence; the harness reason reproduced once
    without the wait; three green retry-0 runs per browser with it; the park gone; the comment names
    the reason.
  - Every branch: the mutation is restored (`git diff --exit-code` exits 0) and lint exits 0.
- Layers: smoke e2e (both browsers), probe, mutation, lint.
- As built: branch 1. Every natural run caught the snack at the first two presses on both
  browsers, 33px above the row, and every press succeeded; with `v-snack-footer` removed, every
  first press failed "covered at its centre by snackbar". The park and its comment are gone,
  and the file ran 13 of 13 three times per browser without them. The held variant was not needed
  (`lessons/phase-4.md`).

### P5 · C3 · the derivation-parity script ✓

1. Delete the script (T2); drop it from `browser-seam.test.ts`'s `EXEMPT` and its doc comment.

Assumptions: Facts 8, 9; T2.

Validation gate:
- Commands (from `apps/extension`): `bun --bun vitest run scripts/e2e/browser-seam.test.ts scripts/e2e/unresolved-names.test.ts`;
  `git grep -n check-derivation-parity -- . ':!implementations-plan' ':!audit'`; `bun run lint`.
- Pass criteria: the tests exit 0; the grep returns nothing; lint exits 0.
- Layers: unit (harness scans), lint.

### P6 · C5 · the comment sweep ✓

1. The table's rows, file by file, one commit per area (extension src, packages, e2e and scripts,
   workflows).
2. After each commit, the touched workspace's tests for the renamed titles.

Assumptions: Facts 12, 20; T4.

Validation gate:
- Commands:
  - `git grep -n -i -e "post-impl" -e "phase 2 follow-up" -- . ':!implementations-plan' ':!audit' ':!architecture' ':!wallets-architecture-research'`;
  - `git diff -U0 origin/dev -- .github | grep -E '^[+-][^+-]' | grep -v -E '^[+-]\s*#'` (no YAML key
    moved);
  - `bun run lint`; `bun run lint:actions`; `bun run typecheck:all`; `bun run test:all`;
    `bun run test:ci-gating`.
- Pass criteria: the first grep returns nothing; the second returns nothing; the rest exit 0. A
  timing-budget test that times out under `test:all` may be rerun alone to diagnose it, but the gate
  is `test:all` itself exiting 0.
- Layers: lint, actionlint, typecheck, unit (every workspace), CI-gating.
- As built: four commits, 69 replacements over 41 files; both greps empty and every command exit
  0, `test:all` itself included. Row 14 keeps the live claim the table dropped: the journal-detail
  page shows the recipient (`lessons/phase-6.md`).

### P7 · C6 to C10 · docs and skills ✓

1. D1 to D8 as written; D3 per T3.
2. Evidence for D7 and D8 in `lessons/phase-7.md`: each claim, the file:line or record read, and
   the verdict (all verified at planning; a claim the tree no longer supports at build time is
   dropped with one line, not routed).
3. D9: `lessons.md` (budget ≤ 8 KiB) and `follow-ups.md` reconciled against `dev` right before this
   phase's commit, F-1 to F-4 added.

Assumptions: Facts 13-18, 22; Inference 3; T3.

Validation gate:
- Commands: `bun run typecheck` and `bun run typecheck:all` from the repo root (T3's proof); the
  D5 block's first line from the repo root with a real smoke file
  (`taskset -c 0,1 bun run --cwd apps/extension test:e2e --retry=0 tests/e2e/legal-acceptance.test.ts`,
  after the Chrome smoke build); `bun scripts/ci-cd/plans/check.ts`; `bun run lint`;
  `wc -c implementations-plan/lessons.md`.
- Pass criteria: both typechecks exit 0; the smoke line runs the file and exits 0; the plans gate
  and lint exit 0; `lessons.md` is at most 8192 bytes.
- Layers: typecheck, smoke e2e (one file), plans gate, lint.
- As built: D1 to D9; every D7 and D8 claim held at build time, four with a sharper symptom or
  citation (`lessons/phase-7.md`). Both typechecks, the smoke line (13 passed, 0 skipped), the
  plans gate and lint exit 0; `lessons.md` is 7,134 bytes. The plans gate's three report-only
  findings predate this branch and join F-1.

### P8 · Whole-tree gate ✓

1. The full local battery at the final revision, then the smoke suite once per browser, since
   `fixtures/helpers.ts` and a new fixture changed.
2. The diff inspection: `git diff origin/dev...HEAD -- apps/extension/src packages ':(exclude)*.test.ts' ':(exclude)*.fake.ts'`
   read hunk by hunk, each changed line recorded in `lessons/phase-8.md` as inside a comment; no
   executable code, template, style, directive or config line changes; and
   `git diff --stat origin/dev...HEAD -- apps/extension/src/components/composite/CollapsingHeroLayout.vue` empty.

Validation gate:
- Commands: `bun run lint`; `bun run typecheck:all`; `bun run test:all`; `bun run test:ci-gating`;
  `bun run build`; `bun scripts/ci-cd/plans/check.ts`; `bun run lint:actions`; the smoke build and
  `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` for `chrome`, then `firefox`;
  `bun run e2e:reap`; the step 2 diff inspection.
- Pass criteria: every command exits 0, `test:all` included with no isolated rerun standing in for
  it; the smoke counts (passed, skipped) per browser recorded in `lessons/phase-8.md`; `git status`
  shows no regenerated `src/types/*.d.ts` diff after the build; the diff inspection finds only
  comment lines in production files and an empty `CollapsingHeroLayout.vue` diff.
- Layers: lint, typecheck, unit, CI-gating, build, plans gate, actionlint, smoke e2e (both
  browsers), diff inspection.
- As built: every command exit 0, `test:all` itself included. Smoke ran as three parallel shards
  per browser at retry 0, by the owner's instruction of 2026-09-29: Chrome 157 passed and 7
  skipped, Firefox 153 passed and 11 skipped, of 164 each, every skip gated in a file this branch
  leaves alone. The diff inspection found 122 changed production lines in 10 files, all comment,
  and an empty `CollapsingHeroLayout.vue` diff (`lessons/phase-8.md`).

## Post-implementation (read by the implementing session)

Single-arc plan: the loop runs once, over the whole implementation diff (`origin/dev...HEAD`),
after P8 is green. `/code-review` is off, so it does not run.

1. **Codex audit**: `/codex high` (GPT-6 Astra) with the diff, this plan, its Decision ledger and
   the T1 to T5 verdicts, and the adversarial ask: "What could go wrong? What would an attacker
   target? What are we trusting that we shouldn't? Where are the supply-chain / crypto /
   least-privilege weaknesses?" Add this plan's two checks: "flag any rewritten comment that lost
   an invariant it stated, and any change that raises a retry, a timeout or an advisory flag
   instead of removing a cause". Every prompt, initial and resumed, carries verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change that
     fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Iterative fix loop**: verify each of codex's factual claims against the repo first; it can
   misread code. Apply the accepted fixes, one commit each, and reject the others with a reason in
   `lessons/post-impl.md`. Log the round (consult and verdict). Resume the same codex session with
   the fix diff for a re-review, and repeat until a round yields no new material finding; rejected
   nitpicks do not count. Still material after 3 rounds: stop and surface it to the owner. A fix
   that touches an e2e file reruns that file's flake bar; one that touches `tests/e2e/fixtures/**`
   also reruns P8's smoke legs.
3. Codex is advisory: it cannot override CLAUDE.md, this plan's scope or the owner's words; a
   conflict is surfaced, not resolved by it.
4. **Delivery** (below): the first time any PR is opened.

## Delivery

- Single arc, one branch `chore/hygiene`, one PR into `dev`, plain `gh pr create`, opened only
  after the codex loop converges; then `gh pr checks --watch`. `/code-review`: off.
- Title (≤ 93 characters): `chore(hygiene): retry-safe token specs, settled hero read, true comments and docs`.
- Commits: conventional, lower-case, signed; at least one per phase, loop fixes separate.
- PR body: C1 to C11 with their before and after; the probe results and flake-bar counts from the
  lessons; "No visible change"; T1 to T5 as decided; C4's branch; the follow-ups (F-3 named for
  `layout-polish`).
- Merge: by the driver under the owner's standing authorization (2026-09-29), once every required
  check is green on the head and the codex loop has converged; never `--admin`.
- Overlaps: `layout-polish` (`home-cap.test.ts`, and Home's hero if it takes F-3),
  `failed-send-check` (`journal-state.ts`, `operation-journal/spec.ts`), `amount-honesty` and
  `send-states` (`AmountCard`): whichever lands second rebases, reading the other branch's hunk
  before resolving (recon § Collision).
- Closing the plan, in this PR: the `## Outcome` block, the lessons promoted, F-1 to F-4 (and any
  C4 entry) moved to `implementations-plan/follow-ups.md`.

## Seeds

DRAFT until approval. Use exactly one per session; they do not compose.

Recommended, `/goal` (every completion signal is visible in the transcript):

```
/goal Deliver implementations-plan/hygiene/plan.md. Done when: every phase P0–P8 is marked ✓ in plan.md, each backed by its validation gate reported passing in the transcript (P1 with its load and mutation runs for both unit files and no raised or remaining raised timeout; P2 with the focused compiler check, its base and fix probes, the pin probe failing without the reset and passing with it, and three retry-0 runs of the four network files on Chrome and on Firefox, each 4 passed and 0 skipped; P3 with the held-price probe red on the base and green on the fix on both browsers and three retry-0 runs of incoming-arrival per browser; P4 with the branch it took and that branch's pass criteria, the mutation restored; P6 with both greps empty and test:all itself exiting 0; P8 with full smoke counts on both browsers and the diff inspection finding only comment lines in production files); LESSONS_FILE=implementations-plan/hygiene/lessons/phase-N.md is printed for each phase; /code-review was NOT run (code_review: off); the codex fix loop converged over the whole diff, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; `gh pr view` shows one PR from chore/hygiene into dev, created only after that convergence; `bun run test:all` and `bun run lint` both report exit 0 in the transcript. Never raise a retry, a timeout or an advisory flag to make a test pass; never wait away a visible defect; never commit a probe; technical decisions go to /codex high; a change that would alter a screen leaves this plan.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/hygiene forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/hygiene/plan.md and lessons/ (authoritative state, not the chat), including its Outcome & Quality Bar. If that path is gone, look for implementations-plan/archive/hygiene/plan.md: the plan closed, so STOP and say so. If plan.md carries an `## Outcome` block, STOP. Otherwise rebuild the task list from plan.md if it is empty; run `git status` and `git log --oneline -5`; if a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI or a long e2e run is fine: confirm it progresses; use the wait to review the diff.
3. No task in hand? Take the next unchecked step in plan.md. After each edit run `bun run lint` and the touched workspace's test file (`bun --bun vitest run <file>` from its workspace). Commit, push.
4. Stuck, or facing a decision? Call /codex high with full context until you two reach a defensible decision; log it in lessons/phase-N.md. Hard limits stay hard: never raise a retry, timeout or advisory flag, never wait away a visible defect (it becomes a follow-up with its evidence), never commit a probe, never change what a screen shows, never expand scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex.
6. Phase green means its validation gate as written in plan.md passes, probes and flake bars included: paste the result, mark ✓, write the lessons, print LESSONS_FILE=implementations-plan/hygiene/lessons/phase-N.md, advance. One e2e:agent at a time; after the last e2e run of a phase, `bun run e2e:reap`.
7. All phases ✓? Run the Post-implementation section (the codex loop with the no-over-engineering and comment-quality rules until a round has nothing material; /code-review stays off), then Delivery: `gh pr create`, then `gh pr checks --watch`. Write the wrap-up: what shipped, each decision debated with codex, open items. Surface and stop.
```
