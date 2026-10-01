---
plan: dapp-grants
tier: mid
driver: claude-code
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
same_family_leg: Opus 5.5 subagent
eli5_mode: artifact
eli5: https://claude.ai/artifact/WY5w8GEggYX9zZTEuqBktk (one page for the wave's ten plans)
branch: fix/dapp-grants
worktree: .claude/worktrees/dapp-grants
base: dev after #719 @ 85c4d20f
---

## Outcome

- **Date:** 2026-09-29. **Status:** closed, awaiting archive: delivered as #722 on
  `fix/dapp-grants`, not yet merged. O1, O2 and the blanket were decided on 2026-09-29 under the
  owner's delegation (§ P6) and applied in P7; the owner confirmed each on 2026-09-30 (§ P6).
- **Shipped** in #722, G1 to G3 as planned, P0 to P7:
  - G1: every scope refusal the grant check throws is a `ScopeViolationError` whose fixed text
    `ScopeViolationMessage` types, so no refusal's message, log line, journal row or dApp response
    carries a request value. The raw-hash `createAuthWit` refusal stays a plain `Error`. Scope
    refusals log at `Debug`.
  - The journal: a refused `sendTx`'s queued row fails as `scope_refused`. Its page reads "Not
    allowed" / "The app asked for more than you allowed. Nothing was sent.", and its card in
    History and on Home a red "Not allowed".
  - G3, as O2 (b): every scope refusal answers the dApp with one frozen envelope, 4100
    `SCOPE_VIOLATION` with a constant message, documented in the wallet-bridge README.
  - G2: every `requestCapabilities` answer for a known type is the stored grant.
  - Tests: a red-first case per phase, on `85c4d20f`'s behaviour for P1 to P5 and on `98c15ce9`'s
    for P7, regression controls named; the new network e2e `scope-refusal.test.ts` on both
    browsers.
  - From the codex loop: one comment, `checkGetAccounts`' invariant.
- **Gates at delivery:** P7's gate (`lessons/phase-7.md`). On `2f7b1a91`: lint, `typecheck:all`,
  `test:all`, `test:ci-gating`, the plans gate and the build exit 0, and smoke in three shards per
  browser, 166 tests each: Chrome 159 passed, Firefox 155 passed, the rest skipped by design. On
  `c7a05b39`, which fixes the spec's History read: the four network files once per browser, 8 of 8
  each, none skipped. P5's flake bar passed three of three per browser and was not rerun (§ P7).
  Codex approved all three rounds; its one finding was accepted. The last commit touches only docs;
  the plans gate, lint and `test:ci-gating` ran again on it.
- **Dropped:** O1 (a), O1 (c)'s arrival check and O2 (a), built on local capture branches for the
  pictures and never pushed.
- **Answers, 2026-09-29, under the owner's delegation** (quoted in § P6): O1 (b), unanimous; O2
  (b), two to one, codex dissenting for (a); the blanket signed two to one, codex blocking on R2.
- **Record corrected:** the follow-up "After a declined widening, the wallet answers transaction
  and simulation capabilities with the requested capability" named a state today's window cannot
  produce, since it cannot decline part of a transaction, simulation, contracts or contract-classes
  request (Fact 10). The defect fixed is the echo of a covered request, and of a wider
  contract-classes request that opens no window (Fact 11).
- **Overlap:** #721 (`failed-send-check`) rewrites `journal-state.ts`'s outcome step. A scope
  refusal fails from `queued`, which #721 reads as nothing sent, so the record keeps its red card,
  its kind's subtitle and its kind's label; codex round 3 found the two compatible in either
  landing order. Whichever lands second merges `dev` and reconciles.
- **Open items:** none left here; `follow-ups.md` § Grants and scopes holds F-1 to F-5, F-2's
  Terms case next in line. Deleted there as resolved: the other scope refusals, the declined
  widening, whether a dApp learns of a scope refusal, and the three exact-string and wildcard
  entries that § Decision ledger's realism lines close. `lessons.md` gains nothing: the one flake
  hit here (`presto/client.test.ts` under load) is its Tooling entry, and the smoke-shard path
  rule is the e2e-testing skill's. That skill gains one trap: the fixtures' `waitForSelector`
  resolves `null`.
- **Seeds retired:** the `/goal` and `/loop` seeds below are spent; nothing to resume.

# dApp grants: what a refusal tells the log, the journal and the dApp

Three follow-ups from `implementations-plan/follow-ups.md`, as one PR off `dev`:

- **G1** · Every scope refusal other than #717's three still writes the request's addresses, ids or
  calls into its message, and a refused `sendTx` stores that message in its journal row.
- **G2** · The `requestCapabilities` answer for transaction, simulation, contracts and contract
  classes echoes the request instead of the grant the wallet stored and enforces. The follow-up
  names a declined widening; today's window cannot produce one for these types (Fact 10). The real
  defect: a covered request is answered with the request, and a wider contract-classes request opens
  no window and is answered as granted while enforcement refuses the extra classes (Fact 11).
- **G3** · Whether a dApp learns that a call was refused for scope, rather than a generic failure.

Recon: [`recon.md`](recon.md). Competing outline: `outline-alt.md` (local, not committed).

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
- 2026-09-29: "for next documents please put how it's going to look on each choice you are giving
  me".

Recorded from those and the program's standing rules:

- **Scope**: G1 to G3. G1 covers the seven refusals the follow-up names
  (`method-scope-checkers.ts:81`, `:108`, `:127`, `:144`, `:178`, `:199`, `:216`) and the two
  grant-check refusals recon found with the same defect: `validateAccountScopes`
  (`scope-enforcement.ts:42`) and the unauthorized sender (`dispatcher.ts:1774`). Scope refusals
  also move from `Error` to `Debug` in the log (§ G1, Logging).
- **Out**: the execution layer's selector refusals, which also start `Scope violation:` (F-1); the
  other pre-claim failures filed as "Popup closed early" (F-2); the account-membership oracle that
  exists today through success versus refusal (F-3); contract classes' type-only coverage (F-4);
  the account, fee-payer and wildcard comparisons (§ Decision ledger, realism); any change to what
  the grant check admits.
- **Constraints**: pre-production, no migrations; complexity budgets with no new acceptance; no
  new dependency; the logging policy and `log-payload-ban.test.ts`; existing testids verbatim;
  e2e selects only by `data-testid`; new copy joins no clauses with an em dash.
- **Tier**: `mid`, under the owner's standing cap "never blueprint more than mid, to keep our
  credits safe" (§ Phase 0.5).
- **Quality bar**: production. **`/harden`**: not scheduled. **`/code-review`**: off.
- **Decisions**: UI and product asks go to the owner (O1, O2, the blanket), each with a
  recommendation, a confidence and a picture per option; technical asks were decided with
  `/codex high` in round 1 (§ Asks → codex) and later ones are logged in `lessons/`.
- **Delivery**: single arc, one PR off `dev` on `fix/dapp-grants`, plain `gh pr create` after the
  codex loop converges. The first commit adds `implementations-plan/dapp-grants/` and one line in
  `implementations-plan/index.md`. The driver merges under the owner's standing authorization once
  every required check is green on the head, every UI surface carries the owner's quoted sign-off,
  and the codex loop has converged.

### Phase 0.5 · Tier

| Dimension | Score (0-3) | Why |
|---|---|---|
| Novelty | 1 | #717's fixed-text pattern and sentinel test, the `WalletError` family, the envelope's classified arms, the journal's kind table; nothing new in kind |
| Blast radius | 2 | Every scope checker; the background catch; the journal's failure labels; the capability answer every dApp reads |
| Irreversibility | 2 | A `walletErrorCode` is a public contract once dApps branch on it (O2); pre-launch, so still retractable |
| Migration cost | 0 | Pre-production; the journal's `error.kind` is an open string (`spec.ts:203`), no shape change |
| External coupling | 2 | The dApp wire (envelope, capability answer), through `@aztec/wallet-sdk`'s wrapper |
| Security sensitivity | 3 | Log and journal redaction, what a refusal discloses, the dApp's view of its own grant |

`mid`: bounded and pattern-following, but security-sensitive with a dApp-facing decision, which is
what the dual audit is for. `deep` would buy nothing the two legs do not.

## Outcome & Quality Bar

For whom: a person who connected a dApp and gave it a narrow grant; that dApp's developer, whose
request the wallet refuses; whoever reads a Nulo bug report or an exported log.

Excellent means:

1. **No refusal message carries a request value, at any sink.** With a sentinel in every request
   field, no scope refusal's message or stack, no logger call at any level, no journal row's error
   field and no dApp response contains it, for every refusal the grant check can throw. What stays,
   by design: the journal row's title is the requested function name (`queued-journal.ts:193`,
   `:215`), the same field every dApp send's row carries and the person's own record of what the
   app asked for; the row keeps the wallet-owned account and the session and correlation ids. A
   test red on `85c4d20f` proves the promise for each refusal; the tests that are green there by
   design are labelled regression controls.
2. **The journal tells the truth about a refused send.** A `sendTx` the grant check refused never
   opened a window; its record says so in the words the owner picks (O1), and in developer mode it
   shows which method and which scope refused, never which contract or account.
3. **The dApp's view of its grant is the grant.** Every `requestCapabilities` answer for a known
   type is the grant the wallet stored and enforces; tests red on `85c4d20f` cover a covered
   narrower request per type, a wider contract-classes request, and a real rejection followed by a
   later request.
4. **What the dApp learns on a refusal is a decision, stated with its real privacy cost** (O2),
   pinned in the envelope's tests and the dispatcher's reachability tests, and shown in the
   playground.

Good enough: the execution layer's selector refusals keep their text (F-1); other pre-claim
failures keep "Popup closed early" (F-2); the membership oracle stays as it is today (F-3); a dApp
holding a transaction grant can still leave one failed row per refused send, which the GC never
evicts (R2, signed; capping or merging them is F-5).

## UI impact

| # | Surface | Before → after | Sign-off |
|---|---|---|---|
| 1 | Journal detail page (`popup/pages/journal/[id].vue`) for a `sendTx` the grant check refused | "What happened: The popup closed before this transaction could finish."; Outcome "Popup closed early"; State "Failed" → O1 (b): "What happened: The app asked for more than you allowed. Nothing was sent."; Outcome "Not allowed"; State "Failed". The title stays the requested function name | **O1 (b), signed** (delegated, § P6) |
| 2 | The same page in developer or debug mode, "Error (developer mode)" block | `Scope violation: sendTx calls [transfer_public_to_public@<the full contract address>], not permitted by granted transaction scope` → `Scope violation: sendTx call not permitted by granted transaction scope` (every refusal's text in § G1) | **blanket B1, signed** (delegated, § P6) |
| 3 | What a dApp shows for a scope refusal (the playground's `pg-error-text` and result row) | `"The wallet could not process the request."` for every refusal → O2 (b): `{"code":4100,"message":"This request is outside the permissions you gave this app.","data":{"walletErrorCode":"SCOPE_VIOLATION"}}` for every refusal but the raw-hash one | **O2 (b), signed** (delegated, § P6) |
| 4 | The log viewer (`popup/windows/logger/`) after a scope refusal | An `Error` line carrying the constant, visible with every toggle off → a `Debug` line, visible only with debug mode on, carrying the envelope O2 picks (`background.ts:1178-1183` logs `response.error`) | **blanket B2, signed** (delegated, § P6) |
| 5 | The same refused send's card in History and on Home (`TransactionTerminalCard`, listed by `TransactionsList.vue` and `RecentActivityView.vue`) | The red failed card's subtitle "Transaction failed" → "Not allowed", with the same red icon and colour | **O1 (b), signed** (delegated, § P6: the panel's finding) |

Nothing else a person sees changes: every other failed card keeps "Transaction failed"
(`failedSubtitleFor`'s default, `journal-state.ts:234-257`); G2 changes a dApp-facing answer no
wallet screen renders.

### UI asks for the owner (built as recommended; alternatives built for capture only)

- **O1 · What the journal says about a send the grant check refused.**
  (a) as today: "Popup closed early / The popup closed before this transaction could finish.";
  (b) "Not allowed / The app asked for a call outside what you allowed it. Nothing was sent.";
  (c) no row: the arrival check runs the grant check on the session it already read
  (`queued-journal.ts:129-135`) and creates no queued row for a request it refuses, so the refused
  send never appears in Activity; the dispatch check stays the one that refuses.
  The fact behind (c): the GC never evicts a failed row (`operation-journal/gc.ts:17-24`,
  `:127-130`), and the per-session cap of 8 counts only `queued` rows (`queued-journal.ts:35`,
  `:175-185`), so a dApp that keeps retrying a refused send adds one permanent row per try.
  Recommended and built: (b). No window opened (Fact 4), so (a) states something false; (c) hides a
  useful signal (an app asking for more than it was given) and runs the grant check a second time.
  Confidence: moderate.
  **Decided** (delegated, § P6): (b), unanimous, with the panel's sentence "The app asked for more
  than you allowed. Nothing was sent." and the card's subtitle (UI impact row 5).
- **O2 · What the dApp learns when the grant check refuses a call.**
  (a) as today: the unclassified constant for every refusal;
  (b) one classified refusal for every one: 4100, `walletErrorCode: "SCOPE_VIOLATION"`, the constant
  message "This request is outside the permissions you gave this app." The raw-hash `createAuthWit`
  refusal (`method-scope-checkers.ts:329`) is not a scope refusal (no grant admits a raw hash), so it
  keeps the unclassified constant under both options.
  Recommended and built: (b). Confidence: moderate. The privacy argument, stated on the facts:
  - A dApp can already tell "refused" from "served" without any envelope, and without an approval:
    with a contracts grant, `isTokenRegistered(token, { scopes: [candidate] })` answers a boolean for
    a session member and a refusal for anyone else (`argsOneRequired`, `method-descriptors.ts:157`;
    `enforceScopeWithSession` validates `args[1].scopes` for every scoped method,
    `scope-enforcement.ts:82-98`, called at `dispatcher.ts:896`; the lookup needs no window,
    `background.ts:203-208`). The same holds for `simulateTx` with `opts.from` or `scopes`. So the
    account-membership oracle exists today, whatever the envelope says (F-3).
  - For (b): success against failure is already observable, so the membership oracle (F-3) works
    the same under (a) and (b). What (b) adds is that a dApp can tell a permission refusal from a
    downstream failure, which is what an honest dApp needs to re-request permissions: the envelope's
    own rule for an actionable refusal (`error-envelope.ts:182-190`). For a contract, call or class
    it can read what it holds from its own `requestCapabilities` answer (exactly, after G2). Not for
    an account: the answer lists the session's accounts only when the grant sets `canGet`
    (`dispatcher.ts:1518-1523`), so for an account refusal the case rests on F-3, since success
    against refusal already tells a member from anyone else.
  - Against (b), codex's view (round 1 and the final pass): the classification is also a probing
    signal. The grant check runs before execution (`dispatcher.ts:896`, execution at `:841-844`), so
    today a scope refusal and a downstream failure both reach the same constant
    (`error-envelope.ts:191`), and (b) lets a dApp tell which of its own checks the wallet failed.
    (a) discloses nothing new and should stand until the owner decides.
  - The decision page shows both of these sentences beside the pictures (§ Decision ledger,
    disputed).
  - **Decided** (delegated, § P6): (b), two to one; codex dissented for (a).
- **The blanket sign-off** covers, one line each:
  - B1 · UI impact row 2, the developer-mode "Error" block's new text.
  - B2 · UI impact row 4, the log viewer: a scope refusal logs at `Debug`, so it no longer shows
    with debug mode off, and with it on the line carries O2's envelope.
  - R1 · Other failures before a send is claimed (a Terms refusal, a malformed request, a missing
    capability) still read "Popup closed early" (F-2).
  - R2 · Under O1 (b), every refused send leaves one failed row in Activity that the GC never
    evicts, as today.
  - **Decided** (delegated, § P6): signed, two to one; codex would block R2.

## Architecture & Implementation

### G1 · Fixed-text refusals, one typed class

- **Where a refusal goes today.** A checker refusal is a plain `Error` thrown inside `dispatch`
  before any handler runs; the unauthorized-sender refusal is thrown inside the handler, still
  before any window (Fact 4). `handleWalletMessage` answers the dApp with the envelope, logs the
  envelope at `Error`, and, for a `sendTx` whose queued row exists, writes
  `getErrorMessage(error)` into that row (Facts 5, 6). So the log and the dApp get a constant and
  the journal row gets the request's values; the developer-mode block renders them (Fact 7).
- **The class.** `ScopeViolationError extends WalletError` in
  `packages/extension-messaging/src/errors.ts`, beside `CapabilityNotGrantedError`:
  `CODE = "SCOPE_VIOLATION"`, `constructor(message: string)`, no details. Its member joins
  `KnownWalletErrorPayload` and its case joins `walletErrorFromPayload`, so it survives the popup
  boundary as its class; it joins `errors.test.ts`' identity sweep (`:170-215`).
- **The message is typed, not only tested.** `packages/wallet-bridge/src/scope-violation.ts` (a
  leaf) exports `scopeViolation(message: ScopeViolationMessage): ScopeViolationError`, where
  `ScopeViolationMessage` is a template-literal union of `MethodName` (`method-descriptors.ts:371`,
  imported type-only, so the runtime import graph is unchanged) and the fixed suffixes below. A
  string carrying a request value does not type-check at any present or future throw site; the
  sentinel tests stay as the runtime proof. The class takes a plain string because
  `extension-messaging` sits below `wallet-bridge` and cannot see `MethodName`. The checkers' and
  `validateAccountScopes`' `method` parameters become `MethodName`; the dispatcher calls
  `enforceScopeWithSession` after `assertKnownMethod` has narrowed the name (`dispatcher.ts:870`).
- **The texts** (`Scope violation: ` prefix kept; each names the method and the scope field, never
  a value; every site throws `scopeViolation(…)` unless the table says otherwise):

  | Site | Message |
  |---|---|
  | `method-scope-checkers.ts:81` | `` `Scope violation: ${method} contract not permitted by granted contracts scope` `` |
  | `:108` | `Scope violation: getContractClassMetadata class not permitted by granted contractClasses scope` |
  | `:127` | `` `Scope violation: ${methodName} call not permitted by granted transaction scope` `` |
  | `:144` | `Scope violation: grantPublicAuthwit call not permitted by granted transaction scope` |
  | `:178` | `` `Scope violation: ${methodName} call not permitted by granted simulation.transactions scope` `` |
  | `:199` | `Scope violation: executeUtility call not permitted by granted simulation.utilities scope` |
  | `:216` | `Scope violation: getPrivateEvents contract not permitted by granted data.privateEvents scope` |
  | `:292`, `:307`, `:320` (#717) | unchanged text |
  | `:329` (#717, raw hash) | unchanged text, **stays a plain `Error`**: no grant can admit a raw hash, so a scope classification would tell a dApp that asking again helps |
  | `:348`, `:376` (flags) | unchanged text |
  | `scope-enforcement.ts:42` | `` `Scope violation: ${method}.${field} entry not in session's approved accounts` ``, `field` one of `exec.scopes`, `opts.scopes`, `opts.additionalScopes`. `getPrivateEvents`' filter is `args[1]`, so its `scopes` refuse as `getPrivateEvents.opts.scopes` (`:97`); the `eventFilter.scopes` call (`:102-105`) re-checks the same array after `:97` and can never refuse. It stays as it is and its label stays in the parameter type, but it is no promised diagnostic |
  | `dispatcher.ts:1774` | `Scope violation: requested account not authorized for this dApp session` |

  The phrases existing tests match survive (`not in session's approved accounts`,
  `not permitted by granted data.privateEvents scope`, `not authorized for this dApp session`,
  every `Scope violation: <method>` prefix). The `Scope enforcement:` shape refusals (`:116`,
  `:152`, `:168`, `:185`) carry no value and stay plain `Error`s: they are malformed requests, not
  refusals of a grant.
- **Logging.** `handleWalletMessage` logs a scope refusal at `Debug`, as it does a Terms refusal:
  a connected dApp polls, and a refusal at `Error` lands in every user's buffer
  (`background.ts:1175-1183`). The level choice moves into a one-line predicate beside the catch,
  so `handleWalletMessage` gains no branch.
- **Comments in touched code.** The headers keep the module-cycle invariant and the queued lock
  keeps the atomic count-and-create invariant, one sentence each; the workflow history goes:
  `method-scope-checkers.ts:4-10` (which also gains the new leaf import) and `:380-383`,
  `scope-enforcement.ts:23-35`, `queued-journal.ts:16-17` and `:39-40`. Three more keep only their
  live invariant: `method-scope-checkers.ts:160-165` (validate each unknown call element before
  dereferencing it), `:332-342` (`getAccounts` requires `canGet` on an accounts grant) and
  `scope-enforcement.ts:68-80` (account scopes are validated even when `calls` is empty). No broader
  cleanup. The envelope arm carries one sentence on what the classification may disclose (§ The
  envelope).

### The journal sink (O1)

- `queued-journal.ts` gains `failQueuedForError(journal, id, error, logger)`: kind `scope_refused`
  when `error instanceof ScopeViolationError`, else `popup_bound`; message `getErrorMessage(error)`
  (fixed text for a refusal); it calls `failQueuedIfUnclaimed`, which takes the kind as a parameter
  instead of hard-coding it (`:261`). `background.ts:1186` calls it in place of the current line,
  so `handleWalletMessage` gains no line and no branch. The title and the account the row was filed
  under are untouched.
- `packages/wallet-core/src/jobs/types.ts`: `"scope_refused"` joins `KnownJobErrorKind`, the table
  and the producer list in the doc comment (`:78-85`); `types.test.ts`'s produced list gains it.
- `apps/extension/src/utils/journal-state.ts`: `categoricalLabel` gains
  `case "scope_refused": return { label: "Not allowed", context: "The app asked for more than you allowed. Nothing was sent." }`,
  and `failedSubtitleFor` gains `case "scope_refused": return "Not allowed"`, so the red failed card
  says what the journal page says (UI impact row 5; the sentence and the case are § P6's
  decision). `humanizeErrorKind` is left alone: it has no production caller.
- O1 (c), capture only: `tryCreateQueuedJournal` runs `enforceScopeWithSession` on the session it
  read and returns `undefined` when it throws; if the owner picks (c), that phase exports the
  dispatcher's session-accounts helper (`sessionAccountsOf`, `dispatcher.ts:438-449`) so both sides
  build one set.

### The envelope (O2)

- `error-envelope.ts` gains one arm, `if (error instanceof ScopeViolationError) return SCOPE_VIOLATION_ENVELOPE`,
  with `{ code: 4100, message: SCOPE_VIOLATION_MESSAGE, data: { walletErrorCode: "SCOPE_VIOLATION" } }`
  a frozen constant beside it and one sentence: the classification tells a dApp that a grant
  refused the call before execution, not a downstream failure. `SCOPE_VIOLATION_MESSAGE` is a
  constant ("This request is outside the permissions you gave this app."), never `error.message`:
  the wallet-internal text is for bug reports, the dApp text is a public contract
  (`errors.ts:174-177`). No `capabilityType` detail: more disclosure is an O2 question. One `if`
  keeps `toWalletResponseError` under the budget; `bun run lint` is the check (Inference 3).
- O2 (a), capture only: no arm; a test pins that the class falls through to the constant.
- `packages/wallet-bridge/README.md`: § "What other error shapes look like" gains the
  `SCOPE_VIOLATION` shape and which refusals carry it, and the stale paragraph at `:168-173`
  ("reject with the existing scope-enforcement error format") is rewritten to match.

### G2 · The capability answer is the stored grant

- `enrichGrantedCapabilities` (`dispatcher.ts:1482-1532`) answers accounts and data from the stored
  grant and echoes every other type (`:1526`). Its `else` arm becomes: the stored grant of that
  type, or the request itself when none is stored (the `grantsNothing` contracts case, which grants
  nothing and so is truthfully echoed). The accounts projection and `dataAnswer` are unchanged. Both
  call sites already pass the stored capabilities (`:1334-1339`, `:1356-1361`). One grant per type
  is guaranteed: a request naming a type twice is refused (`dispatcher.ts:426-427`) and the writer
  replaces by type (`replaceTypes`, `:559`).
- The comment at `:1489-1490` ("accounts and data values come from the stored grant") widens to
  every type.
- A covered request is now answered with the held grant, possibly wider than asked, and in the
  spelling the wallet holds. `dispatcher.test.ts:2083`'s pin ("The answer echoes the request,
  except data's") changes its expected answers to the stored ones.
- What G2 does not change: a wider contract-classes request still opens no window, since coverage is
  type-only (`dispatcher.ts:718-719`); after G2 the answer says so instead of claiming the wider
  grant (F-4).

### File-level change map

| File | Change |
|---|---|
| `packages/extension-messaging/src/errors.ts` (+ `errors.test.ts`) | `ScopeViolationError`, its payload member and decode case; a round trip; the identity sweep |
| `packages/wallet-bridge/src/scope-violation.ts` (new) | `ScopeViolationMessage`, `scopeViolation` |
| `packages/wallet-bridge/src/method-scope-checkers.ts` (+ test) | `scopeViolation` at every scope refusal but `:329`; seven texts; `MethodName` parameters; header, `:160-165`, `:332-342` and `:380-383` comments |
| `packages/wallet-bridge/src/scope-enforcement.ts` (+ test) | the class and text at `:42`; the method and field split; `:23-35` and `:68-80` comments |
| `packages/wallet-bridge/src/dispatcher.ts` (+ `dispatcher.test.ts`) | `:1774`'s class and text; `enrichGrantedCapabilities`' `else` arm and comment; tests |
| `packages/wallet-bridge/README.md` | the `SCOPE_VIOLATION` shape; the stale paragraph; what the answer lists for accounts |
| `packages/wallet-core/src/jobs/types.ts` (+ `types.test.ts`) | `scope_refused`; the producer list |
| `apps/extension/src/wallet/services/wallet-sdk/queued-journal.ts` (+ test) | `failQueuedForError`; the kind parameter; two comments |
| `apps/extension/src/wallet/services/wallet-sdk/queued-journal.fixtures.ts` (new, test-only) | the journal and service stubs `queued-journal.test.ts` builds today, shared with the background test |
| `apps/extension/src/wallet/services/wallet-sdk/background.ts` | the journal call; the log-level predicate |
| `apps/extension/src/wallet/services/wallet-sdk/background.refusal-log.test.ts` | arrival, real dispatch, persisted row, every refusal |
| `apps/extension/src/wallet/services/wallet-sdk/error-envelope.ts` (+ test) | one arm, the constants |
| `apps/extension/src/utils/journal-state.ts` (+ test) | one `categoricalLabel` case; one `failedSubtitleFor` case |
| `apps/extension/src/components/composite/activity/TransactionTerminalCard.vue` (+ test) | `data-testid="tx-terminal-subtitle"` on the subtitle |
| `apps/extension/tests/e2e/network/scope-refusal.test.ts` (new) | the refused send end to end, its History card included |
| `apps/extension/tests/e2e/network/data-privateEvents.test.ts` | expected envelopes per O2 |
| `.claude/skills/e2e-testing/SKILL.md` | the fixtures' `waitForSelector` resolves `null` |
| `implementations-plan/dapp-grants/`, `implementations-plan/index.md`, `implementations-plan/follow-ups.md` | plan, recon, lessons; index line; follow-ups moved and resolved |

### Trade-offs and alternatives not taken

- **Fixed text with plain `Error`s, as #717 did** (codex C1: approved the class): enough for the log
  and the journal message, but the journal kind and the envelope would then recognise a refusal by
  its text.
- **A constant at the sink for every pre-claim failure** (`outline-alt.md`): one change covers every
  future interpolating throw, but it keeps the values in the error wherever else it travels, drops
  the developer-mode diagnosis and keys the journal kind on a text prefix. Both audits preferred the
  throw-side fix; with the typed message, a future interpolating throw fails typecheck instead.
- **Deriving the dApp text from the internal message**: rejected; a constant cannot drift into a
  value.
- **Withholding the classification for account-membership refusals** (round 1's O2 (c)): withdrawn.
  It adds a branch, a batch's order still reveals membership (codex round 1), and it protects
  nothing the plain call does not already expose (O2).
- **A `capabilityType` detail on the dApp envelope**: omitted (codex C4); more disclosure would be an
  O2 question.
- **Deleting the queued row on a refusal** (round 1's O1 (c)): replaced by the arrival check, which
  avoids a "Queued" card that vanishes.

## Security & Adversarial Considerations

- **Threat model.**
  - G1: whoever reads the journal row (anyone with the extension's local storage, or a person who
    screenshots developer mode into a bug report) learns which contracts and accounts a dApp asked
    the wallet to use. The refusal's values also sit one `logger.log(…, error)` away from the
    CSV-exportable log (`wallet/logger/utils.ts:169-175` keeps a message). The change removes the
    values at the throw and types the message, so no sink can carry them. The title keeps the
    requested function name by design (§ Outcome 1).
  - G2: a dApp that believes it holds a wider grant than it does fails later with an error it
    cannot explain, and may re-request in a loop. No authorization changes: enforcement already
    reads the stored grant (`dispatcher.ts:887-899`).
  - G3: the dApp is the adversary. Membership of a candidate account in the session is already
    readable through success versus refusal, without an approval (O2, F-3); neither option changes
    that. What (b) adds is telling a scope refusal from a downstream failure, since the grant check
    runs before execution (`dispatcher.ts:896`, `:841-844`); that signal is O2's cost. A dApp controls the refused values but not the message (a typed literal) nor the envelope
    (a constant), so it cannot inject into the log line or the page.
- **Input validation.** Unchanged: `argSchema` and `assertAuthRelevantArgShape` run before the
  checkers (`dispatcher.ts:878-884`). The class adds no parsing.
- **Least privilege, cryptography, supply chain.** No permission, credential, crypto or dependency
  changes.
- **Logging.** One level changes: a scope refusal logs at `Debug` (§ G1). No line gains content; the
  background test asserts every logger call at every level for every refusal.
- **Storage.** No shape change: `error.kind` is an open string in the journal schema
  (`operation-journal/spec.ts:203`); pre-production, no migration.
- **Frontend.** The new copy is static text rendered by interpolation (`{{ }}`), no HTML.

## Assumptions

### Facts (verified at `85c4d20f` by reading the file; #719 changed no file cited here)

1. Seven refusals interpolate request values: `method-scope-checkers.ts:81` (the contract address,
   for `registerContract`, `getContractMetadata`, `isTokenRegistered`), `:108` (the class id),
   `:127` (every call's `name@to` for `sendTx`), `:144` (`method@contract`), `:178` (every call for
   `simulateTx` and `profileTx`), `:199` (`fn@contract`), `:216` (the event contract).
2. `validateAccountScopes` interpolates each refused entry (`scope-enforcement.ts:37-45`), for
   `exec.scopes`, `opts.scopes` and `opts.additionalScopes` of every scoped method (`:96-98`).
   `getPrivateEvents`' filter is `args[1]`, so its `scopes` are refused at `:97` under the label
   `getPrivateEvents.opts.scopes`; the `eventFilter.scopes` call (`:102-105`) validates the same
   array after it and cannot refuse. `scope-enforcement.test.ts:136` asserts the refusal, not the
   label.
3. The unauthorized sender refusal interpolates the dApp's `from` (`dispatcher.ts:1773-1775`).
4. The checkers run inside `dispatch` after the arg guards and before any handler
   (`dispatcher.ts:878-899`; `routeHandlerMethod` from `:903`); the sender refusal runs inside the
   handlers' `resolveNetworkAndAccount` (`:1110`, `:1158`, `:1609`), before their window or
   execution. A refused `sendTx` opens no window and sends nothing.
5. `handleWalletMessage`'s catch sets `response.error = toWalletResponseError(error)` (`:1172`),
   logs `response.error` at `Error` unless the error is a Terms refusal (`:1173-1183`), and passes
   `getErrorMessage(error)` to `failQueuedIfUnclaimed` when a queued row exists (`:1185-1187`).
6. A queued row is created at arrival for `sendTx` only (`background.ts:481-490`), when the session
   holds a `transaction` grant (`queued-journal.ts:134-135`) and the sender resolves (`:157`), at
   stage `queued`, titled with the requested function name (`:193`, `:215`). An unauthorized
   explicit `from` resolves `not-authorized`, so arrival returns `undefined` and creates no row
   (`:149-157`); dispatch then refuses it (`dispatcher.ts:1769-1774`).
   `failQueuedIfUnclaimed` fails it with `{ kind: "popup_bound", message }` (`:257-262`) and the
   transition keeps every other field (`operation-journal/service.ts:357-361`).
7. The journal page shows `categoricalLabel`'s context under "What happened"
   (`journal/[id].vue:280-281`) and its label as Outcome (`:299-302`); `popup_bound` maps to "Popup
   closed early" / "The popup closed before this transaction could finish."
   (`journal-state.ts:196-197`); the raw message renders only with `debugMode` or `developerMode`
   (`journal/[id].vue:230-233`, `:322-334`). The GC evicts only `succeeded` rows
   (`operation-journal/gc.ts:17-24`, `:127-130`).
8. A plain `Error` reaches the dApp as `UNCLASSIFIED_ERROR_MESSAGE` (`error-envelope.ts:191`,
   `:199`); `CapabilityNotGrantedError` as 4100 with `walletErrorCode` and `capabilityType`
   (`:78-87`). The dApp-side SDK wraps the envelope as `new Error(jsonStringify(error))`
   (`@aztec/wallet-sdk` 5.2.0, `dest/extension/provider/extension_wallet.js:165`).
9. `enrichGrantedCapabilities` answers accounts from the stored grant (`dispatcher.ts:1496-1522`),
   data through `dataAnswer` (`:725-732`, `:1524`), and echoes the request for every other type
   (`:1526`), for any type the stored grants contain (`:1491-1494`).
10. The capability window cannot decline part of a transaction, simulation, contracts or contract
    classes request: on approval `decideDeltaCap` returns every such delta entry
    (`popup/windows/capabilities/build-items.ts:262-266`), and a reject or close records the delta
    as rejected and rethrows (`dispatcher.ts:1398-1400`), so no answer follows it.
11. A request inside the held grant opens no window and is answered by echo (`computeCapabilityDelta`,
    `dispatcher.ts:499-515`; the early return `:1333-1344`). Contract-classes coverage is type-only
    (`:718-719`): a wider request opens no window unless the type was rejected before (`:512-514`),
    and the echo then claims classes that `checkGetContractClassMetadata` refuses
    (`method-scope-checkers.ts:106-108`).
12. `dispatcher.test.ts:2083-2100` pins today's echo for transaction, simulation and contracts ("The
    answer echoes the request, except data's"); `:1938-1944` pins the data answer.
13. The job-error kind is an open union with a drift-guarded runtime table
    (`packages/wallet-core/src/jobs/types.ts:87-136`), and the journal stores `error.kind` as any
    non-empty string (`operation-journal/spec.ts:203`). `humanizeErrorKind` has no production caller
    (`journal-state.ts:132`; only `types/auto-imports.d.ts` names it).
14. The SDK forwards a method's arguments unchanged and parses only the result
    (`extension_wallet.js:121-127`) and serializes the message with `jsonStringify` (`:204`); an
    `AztecAddress` instance serializes as `0x` plus 64 lower-case hex digits (`@aztec/stdlib` 5.2.0
    `dest/aztec-address/index.js:146-151`). So an honest dApp's addresses arrive canonical, and a
    dApp's JavaScript can pass any other spelling through the same SDK.
15. `handleSendTx` replaces an explicit `from` with the resolved wallet account before the operation
    is built (`dispatcher.ts:1109-1115`), after `resolveAuthorizedSessionAccount` required an exact
    match (`:1769-1775`); the fee route is read from the raw `exec.feePayer` and `exec.calls`
    against that `from`, by the same `classifyFeePayer` at the build (`operation-planner.ts:221`),
    the approval card (`OperationCard.vue:100`), the fee-path check (`operation-validation.ts:53`)
    and the popup's fee delta (`approval-delta.ts:23`). Recon § Realism evidence has the per-route
    table.
16. Under a wildcard the checker returns before reading a target, and each method's next boundary
    is the table in `implementations-plan/grant-check-address-case/plan.md` § Non-obvious mechanics;
    `isTokenRegistered` parses nothing and compares against the profile's own tokens.
17. `data-privateEvents.test.ts:34` and `:52-57` expect the unclassified constant for both of its
    refusals; with private events On the refusal is `validateAccountScopes`, with them Off it is
    `:216` (`implementations-plan/ux-feedback/b5-permissions/lessons/phase-4.md`, the four-case
    table). No other e2e asserts a scope refusal's envelope.
18. The playground's `transaction-listed` bundle lists the `tokenAddress` input's contract
    (`apps/playground/src/lib/bundles.ts:50`, `:100-108`), `requestPgBundle` sets that input
    (`tests/e2e/fixtures/playground.ts:64-68`), and `pg-btn-sendTx-default` builds
    `transfer_public_to_public` from the `tokenAddress`, `recipient` and `amount` inputs, throwing
    before any wallet call without a recipient (`apps/playground/src/sections/transactions.ts:43-67`,
    `:94-101`); `sendDefaultTx` sets all three (`tests/e2e/fixtures/send.ts:40-42`).

No test was run to write this plan.

### Inferences (unverified; audits attack these)

1. No production code matches a refusal's text beyond the `Scope violation:` prefix and the phrases
   § G1 keeps (`rg` over `packages` and `apps` found only tests).
2. On `85c4d20f` the new background test is red on every journaled `sendTx` row (an authorized
   sender, the refused fields sentinel-marked: the persisted row's error carries the sentinel and
   kind `popup_bound`) and on every row's `Debug` level assertion. Green there, as regression
   controls: the unauthorized-sender row's "no row" (Fact 6) and every row's log and response
   sentinel assertions (the log and the dApp already get a constant). In P3, the envelope
   assertion is red on every row but `:329`'s, whose unclassified envelope already passes
   (`method-scope-checkers.ts:329`, `error-envelope.ts:191`; a regression control). If another
   assertion is red, that sink needs the fix too, and the phase says so before continuing.
3. `toWalletResponseError`'s cognitive score is 13 today (thirteen flat `if`s), so one more arm is
   14; `handleWalletMessage` gains no branch. `bun run lint` is the check.
4. The template-literal union stays small enough for the compiler (about 20 methods times 15
   suffixes); `bun run typecheck:all` is the check.

### Asks

**Owner** (each pictured per option, P6; decided under the owner's delegation, § P6)

- **O1 · The journal's words for a scope-refused send.** (a) today's "Popup closed early"; (b) "Not
  allowed" with "The app asked for a call outside what you allowed it. Nothing was sent."; (c) no
  row, by the arrival check. Recommendation: (b). Confidence: moderate. (§ UI asks.)
- **O2 · What the dApp learns on a scope refusal.** (a) the unclassified constant, as today; (b) one
  classified refusal, 4100 `SCOPE_VIOLATION`, a constant message. Recommendation: (b). Confidence:
  moderate. Codex's counter, shown beside it: the classification is also a probing signal. (§ UI
  asks.)
- **Blanket sign-off**: B1, B2, R1, R2 (§ UI asks).

**Codex** (decided in round 1, session `01a0edd5-28c5-7870-8788-51091292bb2a`; all six reaffirmed by
the final pass, session `01a0ee00-437d-7e21-91be-8da895e2137e`)

- **C1 · A typed `ScopeViolationError`, or plain `Error`s with fixed text.** Approve: the class.
- **C2 · Fold `scope-enforcement.ts:42` and `dispatcher.ts:1774` into G1.** Approve.
- **C3 · G2's rule.** Amend, applied: every known type answers from its stored grant, keeping the
  `grantsNothing` exception and the accounts projection; the tests use covered requests and a real
  rejection followed by a later request, assert the window where they claim it, and take contract
  classes through their type-only path. The legacy two-grants-of-one-type branch is dropped (§
  Decision ledger).
- **C4 · The dApp envelope's detail.** Amend, applied: no detail; more disclosure needs O2.
- **C5 · A new network e2e file for the refused send.** Approve.
- **C6 · The journal row's message.** Amend, applied: the wallet-internal fixed text technically; how
  it reads in developer mode is the owner's (blanket B1).

### Plan audit ledger

Round 1 ran in parallel; both legs saw the plan, `recon.md` and `outline-alt.md`. The final fresh
pass read the revised plan, `recon.md`, the decision ledger and the brief.

- `/codex high` round 1 (GPT-6 Astra, session `01a0edd5-28c5-7870-8788-51091292bb2a`): **conditional
  approve**, confidence high (conditions: 1 to 6).
- Opus 5.5 (same-family leg): **conditional approve**, confidence high on the facts, moderate on the
  O1/O2 framing (conditions: A1, A2, A3).
- `/codex high` final fresh pass (GPT-6 Astra, session `01a0ee00-437d-7e21-91be-8da895e2137e`):
  **conditional approve**, confidence high (conditions: 1 to 4, all applied below); it reaffirmed
  C1 to C6 and found round 1's resolutions hold, rows 1 and 6 only in part (rows 19 and 22).

| # | Leg | Severity | Finding (one line) | Resolution |
|---|---|---|---|---|
| 1 | codex 1, Opus A6 | major | "No journal row contains the sentinel" is false: the row's title is the requested function name; the sink test mocks dispatch | accepted: Outcome 1 narrowed to refusal messages at every sink, title and wallet-owned ids stated as kept; P2's test runs arrival, the real dispatcher and the persisted row |
| 2 | codex 2, Opus A1 | major | O2 (c) still leaks membership through a batch; the oracle already exists through success versus refusal | amended: (c) withdrawn instead of adding the paired batch test, since (a) and (b) give every refusal one envelope; O2 reframed on the facts; the oracle is F-3 |
| 3 | codex 3 | major | The realism lines treat serialization as validation; Inference 2 unproven; `fee-payer.ts:54` omitted | accepted: Fact 14 corrected, the account line's rationale rewritten; both fee routes re-triaged against what is built and shown (recon § Realism evidence), each a ledger line |
| 4 | codex 4, Opus A8 | major | P4's declined widening is not produced by today's window; its covered case passes on the base; contract classes open no window | accepted: G2 restated (Facts 10, 11), P4 rewritten per C3's amendment, follow-up wording corrected at close, F-4 added |
| 5 | codex 5, Opus A7 | minor | P5's send throws in the playground without a recipient; green-on-base checks are presented as proofs | accepted: P5 sets recipient and amount and asserts the stored grant first; regression controls labelled in P2 and § Phases |
| 6 | codex 6, Opus A12 | minor | The log viewer shows the changed envelope; C6 is a visible choice; workflow-history comments in touched code; C3's legacy clause | accepted: UI impact row 4 and blanket B2; C6 under B1; the comments listed in § G1 trimmed; the legacy clause is a ledger line |
| 7 | codex facts | minor | Fact 4 is overbroad: the sender refusal runs inside handlers | accepted: Fact 4 revised |
| 8 | codex recon | minor | Recon's e2e search expression finds only `stale-anchor-recovery` | accepted: recon corrected (`data-privateEvents` imports the constant) |
| 9 | codex recon | minor | F-1's "after approval" is overbroad: simulation and utility calls can reach them with no window | accepted: F-1 reworded |
| 10 | codex recon | minor | The #719 collision predictions were unverified | accepted: #719 merged at `85c4d20f`; it touched no file this plan cites or edits (its code changes are e2e fixtures and tests, `FeeMethodSelector`, `resolve-ports`); of the shared plan files, `follow-ups.md` and `index.md` are reconciled at delivery |
| 11 | Opus A2 | medium | Failed rows are never evicted; O1 misses a "no row at arrival" option | accepted: stated in O1 and R2; O1 (c) is now the arrival check |
| 12 | Opus A3 | medium | Classifying the raw-hash refusal tells a dApp that a wider grant helps | accepted: `:329` stays a plain `Error` |
| 13 | Opus A4 | low | `:292` mixes a flag refusal with a membership refusal under (c) | accepted: moot with (c) withdrawn; `:292` gets one treatment under either option |
| 14 | Opus A5 | low | A free-string message leaves value-freedom to the tests | amended: a typed `ScopeViolationMessage` helper in `wallet-bridge`, since the class's package cannot see `MethodName`; the class keeps a string constructor |
| 15 | Opus A9 | low | No test takes a real refusal to the classified envelope through the background handler; the class is missing from the identity sweep | accepted: P2 asserts `response.error` per row; P1 adds the sweep entry |
| 16 | Opus A10 | low | `humanizeErrorKind` has no production caller; the producer comment goes stale | accepted: its case and test dropped; `types.ts:78-85` updated |
| 17 | Opus A11 | low | Scope refusals log at `Error`, so a polling dApp floods every user's buffer | accepted: `Debug`, as for Terms; a visible change under B2 |
| 18 | Opus A13 | low | The README's scope-refusal paragraph is stale | accepted: rewritten in the same edit |
| 19 | codex final 1 | major | P2 requires a journal row for every `sendTx` refusal, but an unauthorized `from` is never journaled (`queued-journal.ts:149-157`) and is refused at dispatch (`dispatcher.ts:1769-1774`); Inference 2 false | accepted: P2's matrix split into journaled rows (authorized sender, sentinel-marked refused fields) and not-journaled rows (the unauthorized sender asserts no row, still checks its logs and response); Fact 6 states the no-row path; Inference 2 rewritten |
| 20 | codex final 2 | minor | P2 asserts O2's envelope, implemented only in P3; the raw-hash row's envelope is green on the base | accepted: the envelope assertion moves to P3 (step 2, whose gate already runs the background test); the `:329` row is labelled a regression control |
| 21 | codex final 3 | minor | The `eventFilter.scopes` diagnostic is unreachable: `:97` validates `args[1].scopes` as `opts.scopes` before `:104` | accepted: the inventory drops it; § G1's table and Fact 2 name `getPrivateEvents.opts.scopes`, which P1's `:42` row asserts; `:102-105` stays untouched |
| 22 | codex final 4 | minor | Touched checkers keep workflow history at `method-scope-checkers.ts:160-165`, `:332-342` and `scope-enforcement.ts:68-80` | accepted: the three trims in § G1 Comments, each down to its live invariant; no broader cleanup |
| 23 | codex final, O2 | counter-view | "(b) adds only the word scope" understates it: classification also tells a scope refusal from a downstream failure, a probing signal; codex favours (a) pending the owner | amended per the driver: O2 stays the owner's, recommendation (b) moderate kept; the bullet rewritten, codex's counter stated beside it and on the decision page; the envelope comment and threat model say what (b) adds |

### Decision ledger

- **Outline**: fixed text at each throw, one typed class and a typed message, over `outline-alt.md`
  (a constant at the journal sink, checkers untouched): both legs agreed the values must leave the
  error itself, not one sink, and the typed message now covers a future throw.
- Rejected alternatives: § Trade-offs.
- **Realism** (owner rule, 2026-09-29: "let's cover realistic scenarios"). Each line is no fix, no
  test, no question:
  - *Account addresses compared by exact string* (`account-resolution.ts:54`, `:58`;
    `method-scope-checkers.ts:289`; `scope-enforcement.ts:37-45`; `dispatcher.ts:438-449`, `:1046`).
    A non-canonical spelling can arrive from a dApp's JavaScript, since the SDK forwards arguments
    unchanged (Fact 14). Every one of these comparisons fails closed: the dApp's own call is
    refused, and nothing is disclosed, signed or spent.
  - *`feePayer` compared with `from` by exact string* (`fee-payer.ts:63`). A feePayer naming the
    sender in another spelling routes `fpc`: the card shows "Embedded payload / The app includes fee
    payment in the transaction", the same card and the same transaction (`EXTERNAL`, where the
    account never sets itself as fee payer) as a payload naming any other payer. So the account's
    Fee Juice is not charged, and the dApp gains nothing it could not ask for honestly (recon §
    Realism evidence).
  - *The claim's recipient compared by exact string* (`fee-payer.ts:54`). A claim crediting the
    payer in another spelling routes `self-pay`: the card locks to "Public Fee Juice · set by the
    app", the wallet builds `PREEXISTING_FEE_JUICE`, and the fee estimate comes from that built
    transaction, so the account pays from Fee Juice it holds, which is what the card says. A dApp can
    ask for the same charge honestly (self-pay with any call). The card, the build and the estimate
    share one classifier over one stored request (Fact 15), so they cannot disagree.
  - *A wildcard admits a target before validating it* (`method-scope-checkers.ts:42`, `:55`, `:60`).
    The person already granted every contract for that method; a malformed target then meets its
    method's parser, or, for `isTokenRegistered`, a lookup in the person's own tokens that answers
    `false` (Fact 16). The dApp learns nothing its grant did not give it.
  - *A refusal inside a batch leg.* Batch legs get no queued row (`background.ts:481-490`); the
    envelope and the log are the only sinks. Under either O2 option every refusal gets one envelope,
    so a batch's order discloses nothing a single call does not. Covered by the same change; no
    extra test.
  - *Two stored grants of one type.* No producer: `requestCapabilities` refuses a request naming a
    type twice (`dispatcher.ts:426-427`) and the writer replaces grants by type (`:559`).
- **Disputed, settled by the final pass** (the owner decides O2):
  - *O2's recommendation.* Ours (the driver's call, kept): (b), moderate; membership is already
    observable through success versus refusal, and what (b) adds, telling a permission refusal from
    a downstream failure, is what an honest dApp needs to re-request. Codex (round 1 and final): (a)
    pending the owner, since that distinction is itself a probing signal (the grant check runs
    before execution). Final ruling: the owner's call, both sentences on the decision page.
    Decided under the owner's delegation (§ P6): (b), two to one, with codex's dissent recorded.

### Follow-ups

Moved to `implementations-plan/follow-ups.md` § Grants and scopes at close.

- **F-1 · The execution layer's selector refusals** start `Scope violation:` and interpolate the
  call's name, the ABI function and the target (`execution/tx-request-builder.ts:346`, `:595`;
  `fast-path.ts:139`; `view-executor.ts:372`; `execution/service.ts:1044`;
  `authwit-discoverer.ts:203`). They run after the grant check while the wallet builds, simulates or
  signs, some with no window (a simulation or a utility call), so they reach the executors' failed
  records and whatever logs the error there; they need their own sink inventory.
- **F-2 · Every other pre-claim failure is filed as "Popup closed early"** (`queued-journal.ts:261`
  through `background.ts:1139`, `:1186`): a Terms refusal, a missing capability, a malformed
  request. Their honest labels are a copy decision; the Terms case is next in line (§ P6, R1).
- **F-3 · A dApp that cannot read the accounts can test whether a candidate address is in the
  session**, through any scoped call's success versus refusal: with a contracts grant,
  `isTokenRegistered(token, { scopes: [candidate] })` answers a member and refuses anyone else, with
  no window (`method-descriptors.ts:157`, `scope-enforcement.ts:82-98`, `dispatcher.ts:896`,
  `background.ts:203-208`); `simulateTx` with `opts.from` or `scopes` does the same. Closing it is a
  design choice (for example: without `canGet`, a named account is refused whether or not it is a
  member), for its own plan.
- **F-4 · A dApp cannot widen a contract-classes grant.** Coverage is type-only
  (`dispatcher.ts:718-719`), so a wider request opens no window unless the type was rejected before
  (`:512-514`); after G2 the answer shows the held classes, truthfully, but the dApp has no way to
  ask for more. A field-aware coverage rule is a product change for its own plan.
- **F-5 · Repeated refusals pile up.** Every scope-refused send leaves one failed row, which the GC
  never evicts (`operation-journal/gc.ts:17-24`, `:127-130`), and the per-session cap of 8 counts
  only `queued` rows (`queued-journal.ts:37`, `:176-187`), so a connected app that retries a
  refused send adds one card per try, with no limit. Cap or merge repeated refusals per session.
  Codex would have blocked the blanket on it (§ P6, R2).

## Approval

The final fresh pass (`/codex high`, session `01a0ee00-437d-7e21-91be-8da895e2137e`) approved on
conditions 1 to 4, all applied (§ Plan audit ledger, rows 19-23). O1, O2 and the blanket were
decided on 2026-09-29 under the owner's delegation (§ P6) and applied in P7.

**Delivery boundary** (the same rule in P6 and Delivery): the PR opens and CI runs while the
owner's answers are pending; it merges only once O1, O2 and the blanket sign-off are quoted in P6.

## Phases

Each phase ends with its validation gate; its log is `lessons/phase-N.md`, printed as
`LESSONS_FILE=implementations-plan/dapp-grants/lessons/phase-N.md`. Unit and component commands
run from the workspace named. Every phase writes its failing test first and records the red run on
`85c4d20f`'s behaviour in its lessons file before the fix; an assertion that is green there by
design is labelled a regression control in the test name, never counted as proof of the fix.

### P0 · Plan in the tree ✓

1. First commit: `implementations-plan/dapp-grants/` (`plan.md`, `recon.md`) and one line in
   `implementations-plan/index.md`.

Gate: `bun run lint`, `bun scripts/ci-cd/plans/check.ts` exit 0. Layers: lint, CI-gating.

### P1 · No refusal carries the request (G1) ✓

Assumptions: Facts 1-4, 14; Inferences 1, 4.

1. Red, `packages/wallet-bridge/src/method-scope-checkers.test.ts`: "no request value reaches a
   scope refusal", a `test.each` through `enforceScopeWithSession` with a `SENTINEL-…` in every
   request field, one row per refusal in § G1's table except the dispatcher's (the three #717 rows
   fold in), each asserting the branch by its message pattern, that the error is a
   `ScopeViolationError` (a plain `Error` for `:329`), and that
   `JSON.stringify({ ...err, message: err.message, stack: err.stack })` has no sentinel. Red on
   `85c4d20f` for the seven and `:42` by text, and on the class for every row but `:329`. The `:42`
   rows cover `exec.scopes`, `opts.scopes`, `opts.additionalScopes` and `getPrivateEvents`' filter,
   whose message is asserted to name `getPrivateEvents.opts.scopes` (Fact 2).
2. Red, `packages/wallet-bridge/src/dispatcher.test.ts`, beside "dispatcher.handleSendTx — logs none
   of the request's values" (`:1017`): a `sendTx` whose explicit `from` is a sentinel rejects with a
   `ScopeViolationError` and no sentinel; and a `sendTx` outside a listed transaction scope, through
   the real `dispatch`, rejects with a `ScopeViolationError` whose message is § G1's `:127` text
   (the reachability pin).
3. `packages/wallet-bridge/src/scope-violation.test.ts` (new): a `// @ts-expect-error` line passing
   a template string with a `string` value to `scopeViolation`, so `typecheck:all` fails if the type
   ever admits one.
4. `packages/extension-messaging/src/errors.ts`: the class, the payload member, the decode case;
   `errors.test.ts`: a round trip keeps the class and the message; the identity-sweep entry.
5. `scope-violation.ts`, the texts and the helper at every site in § G1, the `MethodName`
   parameters, the comment trims.

Gate:
- `bun --bun vitest run src/errors.test.ts` from `packages/extension-messaging`: exit 0.
- `bun --bun vitest run src/method-scope-checkers.test.ts src/scope-enforcement.test.ts src/scope-violation.test.ts src/dispatcher.test.ts`
  from `packages/wallet-bridge`: exit 0.
- `bun run lint`, `bun run typecheck:all` exit 0.
- Layers: typecheck, lint, unit.

### P2 · The journal and the log say what happened (G1 sinks, O1) ✓

Assumptions: Facts 5-7, 13; Inference 2.

1. `apps/extension/src/wallet/services/wallet-sdk/queued-journal.fixtures.ts`: move the journal and
   stub builders `queued-journal.test.ts` uses (`makeDeps` and its stubs) here, unchanged, and
   import them back.
2. Red, `apps/extension/src/wallet/services/wallet-sdk/background.refusal-log.test.ts`, rewritten
   over every refusal in § G1's table, in two groups:
   - journaled: the `sendTx` refusals the arrival check journals (`:127`, and `:42` for
     `exec.scopes`, `opts.scopes`, `opts.additionalScopes`), each with an authorized sender and a
     sentinel in every refused field; `tryCreateQueuedJournal` against a real
     `OperationJournalService` (the fixtures) creates the queued row;
   - not journaled: the unauthorized-sender refusal (`dispatcher.ts:1774`, a sentinel `from`),
     where arrival creates no row (Fact 6; a regression control), and every non-`sendTx` refusal;
   - dispatch: `handleWalletMessage` with a real `WalletSdkDispatcher` built on stubs that resolve
     one network and one account, over a session holding the row's grants, and
     `hooks: { queuedJournalId }` for the journaled rows; nothing in dispatch is mocked;
   - assertions, journaled rows: the persisted row is `failed` with `error.kind` `scope_refused` and
     the fixed text, and its serialized `error` has no sentinel; its `title` is the requested
     function name (pinned, § Outcome 1). Not journaled rows: the journal holds no row for the
     session. Every row: every call on every logger (the handler's, the dispatcher's, the journal's)
     at every level has no sentinel; the response has no sentinel; the log level is `Debug` for
     every scope refusal. The envelope assertion joins in P3.
   Run on `85c4d20f` and record which assertions are red (Inference 2).
3. Red, `apps/extension/src/wallet/services/wallet-sdk/queued-journal.test.ts`: `failQueuedForError`
   with a `ScopeViolationError` fails a queued row with kind `scope_refused`; with a plain `Error`,
   `popup_bound`; a claimed row is left alone (the existing CAS case, `:406-434`, through the new
   entry; a regression control).
4. Red, `apps/extension/src/utils/journal-state.test.ts`: `categoricalLabel` for `scope_refused`;
   `packages/wallet-core/src/jobs/types.test.ts`: `scope_refused` in the produced list.
5. The kind and its producer comment, `failQueuedForError`, the call at `background.ts:1186`, the
   log-level predicate, the `categoricalLabel` case (§ The journal sink, § G1 Logging).

Gate:
- `bun --bun vitest run src/jobs/types.test.ts` from `packages/wallet-core`: exit 0.
- `bun --bun vitest run src/wallet/services/wallet-sdk/ src/utils/journal-state.test.ts src/utils/log-payload-ban.test.ts`
  from `apps/extension`: exit 0.
- `bun run lint`, `bun run typecheck:all`, `bun run test:all` exit 0.
- Layers: typecheck, lint, unit.

### P3 · The dApp's answer on a refusal (O2) ✓

Assumptions: Facts 8, 17; Inferences 2, 3.

1. Red, `apps/extension/src/wallet/services/wallet-sdk/error-envelope.test.ts`: a
   `ScopeViolationError` maps to
   `{ code: 4100, message: SCOPE_VIOLATION_MESSAGE, data: { walletErrorCode: "SCOPE_VIOLATION" } }`
   and round-trips through `new Error(JSON.stringify(env))`; the envelope never carries the error's
   own message; a plain `Error` still maps to the constant.
2. Red, `background.refusal-log.test.ts`: every row of P2's matrix gains the assertion that
   `response.error` is O2's envelope, the constant for `:329` (a regression control, green on
   `85c4d20f`).
3. The arm and the constants; the README shape and paragraph.
4. `data-privateEvents.test.ts`: both states expect the classified envelope (Fact 17).

Gate:
- `bun --bun vitest run src/wallet/services/wallet-sdk/error-envelope.test.ts src/wallet/services/wallet-sdk/background.refusal-log.test.ts`
  from `apps/extension`: exit 0.
- `bun run lint`, `bun run typecheck:all` exit 0.
- Layers: typecheck, lint, unit.

### P4 · The capability answer is the stored grant (G2) ✓

Assumptions: Facts 9-12.

1. Red, `packages/wallet-bridge/src/dispatcher.test.ts`, "dispatcher — the answer is the stored
   grant" (wire fields `0x` + `0a` × 32 and `0x` + `0b` × 32, below the modulus):
   - a `test.each` over transaction, simulation and contracts: a held grant and a request strictly
     inside it; the window is not opened (`requestCapabilities` spy uncalled) and the answer equals
     the held grant. Red on `85c4d20f` (it echoes the narrower request).
   - contract classes: a held grant listing one class and a request listing two; the window is not
     opened (Fact 11) and the answer lists the held class only, while the stored grants are
     unchanged. Red on `85c4d20f`.
   - a real rejection, then a later request: a held narrow transaction grant; a wider request opens
     the window (spy called once), which rejects, and the call rejects with the rejection recorded;
     a later request strictly inside the held grant opens no window and is answered with the held
     grant (red on `85c4d20f`); a later wider request opens the window again.
   - regression controls, green on `85c4d20f`: the `grantsNothing` contracts request is echoed with
     no stored contracts grant; the accounts answer keeps its projection.
2. The `else` arm and the comment (§ G2); `:2083`'s expected answers become the stored spellings.

Gate:
- `bun --bun vitest run src/dispatcher.test.ts` from `packages/wallet-bridge`: exit 0.
- `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`,
  `bun run build` exit 0.
- Layers: typecheck, lint, unit, CI-gating, build.

### P5 · Browser proof and the arc gate ✓

1. New `apps/extension/tests/e2e/network/scope-refusal.test.ts`: connect the playground with
   `requestPgBundle(page, "transaction-listed", { tokenAddress: OTHER })` (`OTHER` = `0x` + `0a` × 32)
   and approve; assert the answer's transaction grant lists `OTHER` and the stored grant does too
   (`readStoredCapability`). Set `tokenAddress` to the network's token, `recipient` to
   `config.minterAddress` and `amount` to `1`, as `sendDefaultTx` does; send with
   `callExpectingNoPopup(…, "sendTx", …)` on `pg-btn-sendTx-default`. Assert the dApp's error JSON
   is O2's envelope. Open the refused send's journal detail (the row titled
   `transfer_public_to_public`, filed under the connected account) and assert
   `journal-detail-category` reads "Not allowed", `journal-detail-context` the O1 (b) sentence and
   `journal-detail-state` "Failed"; with developer mode on, `journal-detail-error-message` equals §
   G1's `sendTx` text and contains no `0x`. Red on `85c4d20f` on the envelope and the category,
   recorded.
2. Every row of the local gates: `bun run lint`, `bun run typecheck:all`, `bun run test:all`,
   `bun run test:ci-gating`, `bun run build`.
3. Smoke e2e on Chrome and Firefox (the journal page's copy source changes): the migration-fixture
   build per browser, then `NULO_E2E_BROWSER=<b> NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`.
4. Network e2e, retry 0, `NODE_OPTIONS=--dns-result-order=ipv4first`:
   `tests/e2e/network/scope-refusal.test.ts`, `tests/e2e/network/data-privateEvents.test.ts`,
   `tests/e2e/network/authwit-variants.test.ts`, `tests/e2e/network/cap-request-rerequest.test.ts`
   on Chrome (prover on) and Firefox (`NULO_E2E_PROVERLESS=1`).
5. Flake bar: `scope-refusal.test.ts` and `data-privateEvents.test.ts`, three consecutive retry-0 runs
   per browser.
6. `bun run e2e:reap`.

Gate: all of the above exit 0; each run's summary in `lessons/phase-5.md` with its executed, passed
and skipped counts. A skipped network spec is not a pass.
Layers: typecheck, lint, unit, component, CI-gating, build, e2e, e2e-live-network.

### P6 · The owner's sign-off

1. The builder builds each alternative it can for capture only, on a capture-only branch (O1 (a),
   O1 (c) with the arrival check, O2 (a)), captures it, and restores the recommended build; nothing
   but the recommended build is committed. Where a build is not worth it, a faithful mock at the
   real popup width, font and theme stands in, labelled a mock.
2. One page for the owner with O1, O2 and one blanket sign-off, every option pictured, from the
   refused send in P5's flow (popup at its real width and font):

   | Ask | Option | State | Browser | Theme |
   |---|---|---|---|---|
   | O1 | (a) today | journal detail, developer mode off | Chrome | light, dark |
   | O1 | (b) recommended | journal detail, developer mode off | Chrome, Firefox | light, dark |
   | O1 | (a), (b) | Activity list with the refused send's failed card | Chrome | light |
   | O1 | (c) | Activity list after the refused send, no card (the arrival check built on the capture branch) | Chrome | light |
   | O2 | (a) today | playground result row and `pg-error-text` for the refused send and for the private-events-On `getPrivateEvents` refusal | Chrome | light |
   | O2 | (b) recommended | the same two requests | Chrome | light |
   | B1 | before, after | journal detail, developer mode on, the "Error" block | Chrome | light |
   | B2 | before, after | log viewer after a scope refusal: debug mode off (before: the `Error` line; after: none) and debug mode on (after: the `Debug` line with the (b) envelope) | Chrome | light |

   Each O2 capture sits beside the envelope JSON as the dApp receives it, in a monospace block, and
   O2 carries both views' sentences from § UI asks (for (b), against (b)). R1
   and R2 are text lines; R2's visible state is O1's Activity capture.
3. Record the answers here, quoted. An answer other than the recommendation is a new phase: that
   option's code, its tests (P2's or P3's red-first cases for it), P5's gates again.

Captures: every row of the list, 2026-09-29 (`lessons/phase-6.md`); O1 (b)'s journal page and
History card again after P7 (`lessons/phase-7.md`).

Answers, 2026-09-29, decided under the owner's delegation. The owner, verbatim: "Hey - I'll be
out, any chance your resolve auditing with Codex and Opus5.5 subagents the open artifacts? Ask
those subagents to be evaluators on the ux/ui/copies. Use your knowledge about my previous
decisions too." The driver put this plan's decision page to a panel of two Opus 5.5 evaluators
(an interaction lens, a copy and visual lens) and codex (session
`01a0ef40-08db-79d0-896d-223a8ed46964`), then decided:

- **O1 → (b)**, unanimous, confidence high: no window opened, so (a) says something false, and (c)
  hides an app asking for more than it was given. Two changes, built in P7:
  - the sentence becomes the copy evaluator's "The app asked for more than you allowed. Nothing
    was sent.", which also fits an account or sender refusal and removes the lone "it." that
    opened its second line at 360 px; the Outcome stays "Not allowed";
  - all three evaluators flagged that History's card for the same record read a red "Transaction
    failed" beside a journal page saying "Not allowed", so a scope-refused send's card subtitle
    becomes "Not allowed" on the same red failed card (UI impact row 5). Every other failed card
    keeps "Transaction failed".
- **O2 → (b)**, two to one. Both Opus evaluators: an honest app can then ask for what it is
  missing. **Codex dissented for (a)**, the conservative privacy choice: the classified answer tells
  a probing app one more thing, that its grant refused the call before execution. The claim that
  a dApp reads what it holds from its answer is corrected in § UI asks: true for contracts, calls
  and classes; for an account the case rests on F-3.
- **Blanket (B1, B2, R1, R2) → signed**, two to one. Codex would block R2: a connected app can
  leave one failed card per refused request, with no limit. The Opus evaluators read it as today's
  behaviour and a follow-up. Logged in `follow-ups.md`: cap or merge repeated refusals per session
  (R2, F-5), and F-2 with its Terms case next in line (R1).

CLAUDE.md's UI rule asks for the owner's own message naming each surface. These answers are the
driver's under the delegation quoted above, recorded as such.

**The owner's sign-off, 2026-09-30.** On the decision page
(https://claude.ai/artifact/C178svBFzSC81cYwdYruX8) the owner answered O1 (b), O2 (b) and the
blanket "signed", then wrote: "Okei, ive answered everything on the artifacts." Each surface in
§ UI impact now carries the owner's own answer.

Gate: the delivery boundary (§ Approval): the PR may open before this gate; it merges only once
O1, O2 and the blanket sign-off are quoted here. They are: the delegated answers, and the owner's.

### P7 · The delegated answers applied ✓

1. Merge `origin/dev` at `4387b112` (#720) with a signed merge commit, `98c15ce9`. Its one
   conflict, `implementations-plan/index.md`, keeps both appended lines, dev's first.
2. Red, `apps/extension/src/utils/journal-state.test.ts`: `scope_refused` gives the red failed card
   the subtitle "Not allowed", and `categoricalLabel`'s pin takes the new sentence;
   `TransactionTerminalCard.test.ts` pins the subtitle's `tx-terminal-subtitle` testid. Red at
   `98c15ce9`: 3 failed, 87 passed. The `popup_bound` "Transaction failed" case is the regression
   control.
3. `journal-state.ts`'s two cases, the testid, and `scope-refusal.test.ts` reading History's card.
4. P5's gates again at `2f7b1a91`, e2e sharded as the owner asked; the re-captures; one codex round
   on the diff.
5. The first network runs failed on the spec's own History read on both browsers: the fixtures'
   `waitForSelector` resolves `null`. `c7a05b39` reads the text after the wait, and the network
   files ran again on it.

Gate: the local gates and smoke (three shards per browser) exit 0 on `2f7b1a91`, and the four
network files, once per browser, on `c7a05b39`, with nothing skipped but by design; counts in
`lessons/phase-7.md`. P5's flake bar was not rerun: of its two specs only `scope-refusal.test.ts`
changed, by one read of History's card, which ran once per browser here. Codex round 3 approved
with no finding (`lessons/post-impl.md`).
Layers: typecheck, lint, unit, component, CI-gating, build, e2e (smoke on both browsers),
e2e-live-network (both browsers).

## Post-implementation (read by the implementing session)

`/code-review` is off. The review loop is `/codex high` (GPT-6 Astra) over the whole diff
(`dev...HEAD`), after P5 is green and before any PR:

1. **Codex audit**: the diff, this plan and its decision ledger, the adversarial ask ("What could
   go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and these
   two rules, verbatim in the first prompt and in every resumed one:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative
     abstractions, extra configuration surface, new layers, or rewrites — the smallest change
     that fixes each real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
2. **Fix loop**: verify each finding against the code before acting; apply the accepted ones,
   commit each fix separately, log the round (consult and verdict) in `lessons/post-impl.md`, then
   resume the same codex session with the fix diff. Repeat until a round has no new material
   finding. Still material after three rounds: stop and surface it to the owner.
3. Codex is advisory: it cannot override the owner's answers, CLAUDE.md or this scope.
4. **Delivery** (below), the first time a PR is opened.

## Delivery

- Single arc, one branch `fix/dapp-grants`, one PR off `dev`, plain `gh pr create` after the loop
  converges; then `gh pr checks --watch`.
- Title: `fix(permissions): refusals carry no request value; answer grants as stored` (≤ 93
  characters).
- Commits: conventional, lower-case, signed; at least one per phase, fixes separate.
- PR body: summary, the UI impact table, O1, O2 and the blanket sign-off as **pending** (or the
  owner's answers, quoted), the red-before-green evidence per phase with the regression controls
  named, e2e counts, and the `SCOPE_VIOLATION` contract.
- **Overlap.** `failed-send-check` edits `journal-state.ts`'s `transfer` arm; `copy-polish` edits
  strings under `apps/extension/src`. Rebase on `dev` before P5 and reconcile `follow-ups.md` and
  `index.md` against it before the PR.
- **Merge**: by the driver under the owner's standing authorization, once every required check is
  green on the head, O1, O2 and the blanket sign-off are quoted in P6, and the codex loop has
  converged. Never `--admin`.
- Closing the plan: the `## Outcome` block, lessons promoted, F-1 to F-5 moved to
  `implementations-plan/follow-ups.md`, and the three entries this plan resolves deleted from it
  (the other refusals, the declined-widening answer, whether a dApp learns of a scope refusal). The
  declined-widening entry's record is corrected where it lands in the Outcome: today's window cannot
  decline part of those types, and the defect fixed is the echo of covered requests and of a wider
  contract-classes request (Facts 10, 11). The § Decision ledger realism lines replace the three
  grants-and-scopes entries they close, in the same PR.

## Seeds

DRAFT until approval.

Recommended, `/goal`:

```
/goal Deliver implementations-plan/dapp-grants/plan.md. Done when the transcript shows every phase P0-P5 ✓ in plan.md with its validation gate reported passing, the red run on 85c4d20f's behaviour recorded before each fix with regression controls named, LESSONS_FILE=implementations-plan/dapp-grants/lessons/phase-N.md printed per phase, P5's e2e counts recorded with no skipped network spec and the flake bar met, P6's captures made for every option in its capture list, a resumed /codex high pass quoted with no new material findings, and gh pr view showing the one PR off dev created after that pass; bun run test:all and bun run lint both exit 0 in the transcript. /code-review is off and was not run. Merge only when O1, O2 and the blanket sign-off are quoted in P6 and every required check is green; never --admin. UI questions go to the owner, technical ones to /codex high.
```

Fallback, `/loop 15m`:

```
/loop 15m Drive implementations-plan/dapp-grants/plan.md forward. Never idle. Each firing: read plan.md and lessons/ (stop if the plan has an Outcome block or moved to archive/); git status, git log --oneline -5; take the next unchecked step; write its failing test first and record the red run, naming any regression control; after each edit run bun run lint and the phase's vitest command; commit and push the branch. A technical decision: /codex high, logged in lessons/. A UI question: hold it for the owner. Phase gate green: paste it, mark ✓, print LESSONS_FILE. One e2e:agent at a time; a skipped network spec is not a pass. All phases ✓: the Post-implementation loop, then gh pr create and gh pr checks --watch, then report and stop. Merge only with O1, O2 and the blanket sign-off quoted in P6; hard limits stay hard.
```

Use exactly one per session.
