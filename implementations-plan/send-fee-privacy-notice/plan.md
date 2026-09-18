---
plan: send-fee-privacy-notice
tier: mid
driver: claude-code
eli5_mode: artifact
code_review: off
harden: not scheduled
status: rev 7 — APPROVED by the owner 2026-09-18 (walk order changed at the gate, D30; codex approve on the change). Implementation not started
base: dev @ b0ebbb40
---

# send-fee-privacy-notice

Make the Send page's fee source follow the transfer's privacy, and say so — once, in one place — on
the only path where that still isn't possible.

**UI impact** (owner sign-off required per CLAUDE.md § UI changes; record below):

| Surface | Before | After |
|---|---|---|
| Send → fee card, private origin, private Fee Juice read as zero, public Fee Juice held | Card sits on the unpayable Private Fee Juice row; CTA reads "Get Fee Juice"; the send cannot proceed | Card selects **Fee Juice**; a new warning row appears under "Available"; Confirm stays enabled |
| Send → fee card, the new warning row (`send-fee-privacy-notice`) | does not exist | Title **"Your address pays this fee"** + a body that depends on the destination (§ Copy) + link **"Get private gas"** → the fee-juice bridge |
| Send → fee card, public origin | Default is the network's (Sponsored, else Private Fee Juice on mainnet) | Default is **Fee Juice**, else Private Fee Juice, else Sponsored. No new element |
| Send → fee card, nothing can pay, private origin | Nudge "You have no fee juice yet / Bridge some to cover the network fee." + link "Get fee juice" | Nudge **"You have no private gas yet"** / **"A private send pays its fee from private gas, so the fee contract is the payer instead of you. Bridge some to cover this send."** + link **"Get private gas"** |
| Send → primary button, nothing can pay, private origin | "Get Fee Juice" | **"Get private gas"** |
| Send → fee card, private origin, private gas could not be established | Card selects the network default regardless | With a Sponsored option available: **Sponsored** is selected, nothing else changes. Without one: nothing is selected. The existing info row (`fee-init-degraded`, same icon) reads **"Couldn't check your private gas. Pick a fee source to continue."** Any *eligible* method can still be picked by hand (an unread method stays disabled in the dropdown, as today; with both balances read as unknown and no sponsor there is nothing to pick until a read lands; if the whole balance fetch failed the rows stay clickable as today, but a pick only takes effect once its balance is read) |
| Send → opening with a private origin | Balances may come from the wallet's 5-minute cache | Balances are read fresh (one uncached read per open), so private gas received a moment ago is seen |
| Send → fee card while loading | The trigger shows the last-used method | unchanged (the saved pick for the current origin) |
| Send ↔ dApp approval window / authwit popups: remembered fee method | One pick per account, shared by all four | Send remembers one pick **per origin**; the other three keep their shared pick as today. The two memories no longer influence each other |
| Send → fee card, every state where the fee source already matches | — | **unchanged: nothing is added** |
| dApp execute window, Revoke-authwits popup, Change-registry popup | — | **code, stored data and rendering unchanged** |

Sign-off record — the owner's words, in session. Proposal review (Claude artifact *The Fee Payer
Leak*, § Seeds): fallback posture *"Warn loudly, allow send"*; coupling *"Yes, match both
directions"*; *"let's just put a notice when it needs to change, not when it's 'right'"*; fee-row
badge *"There is no need of adding the 'privacy badge' … I wouldn't do that"*; footer ledger *"it
grows the scope way too much. Could we just save it as a follow-up? I'd actually like the constant
ledger, whenever we do it"*; scroll-into-view *"No — accept the gap"*. After the first audit round:
remembered pick *"Separate them"*; unread copy *"New honest line"*. After the third: a forced fresh
read on a private-origin open — *"Yes, force it"*. After the fourth: the gas-balance reader fix that makes that read fresh under concurrency ships in this PR — *"Yes, in this PR"*. One item differed from what
the owner had been asked and was put explicitly at the approval gate: § The hold — no automatic
re-read. At the approval gate (2026-09-18): re-read — *"drop it"*; scope, UI copy and the follow-up —
*"yes"* ×3; walk order — *"on private, ALWAYS try first private, not sponsored. Same for public. First
try public, last sponsored"*, then *"Private FJ → Fee Juice → Sponsored"* and *"Fee Juice → Private FJ →
Sponsored"*; Sponsored under a private origin — *"No notice on Sponsored"*. A screenshot of the warning
row goes on the PR.

## Why

Every Aztec transaction names a fee payer in public. Paying from the account's own Fee Juice names
the account; paying through the PrivateFPC or a sponsor names that contract instead. For a
private-origin send (private → private, private → public) the sender is the one fact the transfer
hides, so a public payer undoes it. For a public-origin send the sender is already in the public
balance change, so the payer costs nothing. Severity splits on the origin alone — which is why this
can be a default rather than a setting. The tools app already enforces the hard version for private
exits (`fix(tools): a private exit never names a public fee payer`, #554); the wallet has no rule.

## Scope

In:

1. Origin-aware default fee source on the Send page, both directions (§ Resolution rule).
2. One conditional warning row: private origin + the payer is the account's own Fee Juice — whether
   the wallet defaulted to it or the user picked it.
3. Send's saved fee selection, one per account × origin, under its own storage key.
4. The "get fee juice" takeover driven by confirmed exhaustion, reworded on a private send.
5. The wallet never *defaults* to the public payer on anything short of a positive read.
6. Component tests, a smoke e2e and a network e2e.

Out (owner-cut, do not re-add): the "This send publishes" footer ledger (follow-up; when built it is
the **constant** ledger); any confirmation line for a matched fee source; any privacy badge on the fee
row; any change to `FeeMethodSelector`; scrolling the fee card into view; any behaviour change in the
dApp execute window or the two authwit popups.

## Architecture & Implementation

### Proposed architecture

Two rounds of review rejected designs that bolted imperative selection state — a watcher, a
"last pick" tracker, a prefill, a retry timer — onto a card whose existing run-supersession machinery
(`runSeq`, `committedKey`, baseline reference checks) was built for one selection ref. Every blocking
finding was a race between that new state and the old. Rev 3 removes the state:

**For a non-null origin the selected method is a `computed`, not a ref anyone writes.** It is a pure
function of four live inputs — the origin prop, the account, the committed knowledge, that account's
picks. An origin flip cannot be lost because nothing has to notice it. A pick cannot cross accounts
because picks are keyed by address. Nothing can bypass reconciliation because there is no assignment
to bypass.

- **`fee-privacy.ts`** (new, pure) — the rule, the notice, its copy.
- **`fee-send-selection.ts`** (new) — pure hostile-input parsing of Send's slot map, plus the one
  place that mutates the new storage key.
- **`FeeSettingsCard.vue`** — two props defaulting to `null`. A `null` origin runs **today's code,
  line for line, against today's storage key**. A non-null origin reads `sendSelection`. The warning
  row is a third inline `.detail_row` block beside `send-fee-nudge` and `fee-init-degraded`.
- **`send.vue`** — passes the two props; relabels the takeover button.
- **`settings/fpcs/index.vue`**, **`settings/security/reset.vue`** — prune / remove the new key too.

Reused as-is (recon § Reuse map): `buildFeeMethods`, `settingsForMethod`, `FEE_JUICE_BRIDGE_URL`, the
`.detail_row` idiom and `<a target="_blank">` of `send-fee-nudge`, the `FeeSettingsCard.test.ts`
harness, the e2e helpers and `helpers/rpc-intercept.ts`.

### Key interfaces

```ts
// fee-privacy.ts
export type TransferSide = "private" | "public"
export type SavedRecord = { type: "fj" | "private_fpc" | "fpc"; fpc?: { id: string } | null }

/** The committed snapshot the card already holds. `undefined` balances = the gas read failed. */
export type FeeKnowledge = { fpcs: RegisteredFpc[]; balances: GasBalances | undefined; allowSponsored: boolean }

export type SendSelection =
	/** No committed snapshot for the live identity yet. `preview` is display-only — the saved pick's
	 *  row, shown on the trigger while loading — and never yields settings. */
	| { kind: "pending"; preview: FeeMethodOption | undefined }
	| { kind: "selected"; method: FeeMethodOption }
	/** The default could not be established on confirmed data. Select nothing. */
	| { kind: "hold" }
	/** Confirmed: every payer was read and none can pay. The only state that may say "you have none". */
	| { kind: "none" }

/** Can this method pay right now, on a positive read? Unread is never eligible. */
export function isEligible(method: FeeMethodOption, know: FeeKnowledge): boolean

/** A saved pick wins when its row still exists and is eligible; otherwise the default walk. */
export function resolveSendSelection(origin: TransferSide, know: FeeKnowledge, pick: SavedRecord | undefined): SendSelection

/** The store's FPC snapshot with this card's own FPC events applied on top: deleted ids dropped,
 *  updated rows replaced, never a row added. Idempotent, so it survives every snapshot commit. */
export function applyFpcEdits(fpcs: FpcInfo[], edits: ReadonlyMap<string, FpcInfo | null>): FpcInfo[]

/** Non-null exactly when the origin is private and the method is the account's own Fee Juice.
 *  A null destination takes the private → private wording. */
export function feePayerNotice(
	origin: TransferSide | null,
	destination: TransferSide | null,
	method: FeeMethodOption | undefined,
): { shape: "private-private" | "private-public"; title: string; body: string } | null
```

```ts
// fee-send-selection.ts — the blob is attacker-writable storage: every reader takes `unknown`.
export function readSendSlots(raw: unknown, address: string): { private?: SavedRecord; public?: SavedRecord }
export function withSendSlot(raw: unknown, address: string, slot: TransferSide, rec: SavedRecord): Record<string, unknown>
export function withoutFpc(raw: unknown, fpcId: string): Record<string, unknown>
/** The ONLY writer of SEND_FEE_PAYMENT_METHODS. Read-modify-write on one module-scoped chain that
 *  survives a rejected link, so two writers in one document cannot interleave. */
export function mutateSendSelections(update: (raw: unknown) => Record<string, unknown>): Promise<void>
/** Removal rides the same chain: a queued pick must not land after a reset and resurrect the key. */
export function clearSendSelections(): Promise<void>
```

Card props, both `{ type: String, default: null }`: `originPrivacy`, `destinationPrivacy` — two
primitives, because `send.vue` would mint a fresh `{from, to}` object every render.

New key `UI_STORAGE_KEYS.SEND_FEE_PAYMENT_METHODS = "nulo:ui:sendFeePaymentMethods"`, shape
`{ [address]: { private?: SavedRecord; public?: SavedRecord } }` — the compact semantic key only,
never a presentation row. `FEE_PAYMENT_METHODS` and its flat shape are not touched.

### Resolution rule

`isEligible` — the single definition of "can pay", on positive reads only
(`typeof x === "string" && x !== "0"`, so a missing property is unread too):

| Method | Eligible when |
|---|---|
| Sponsored FPC | a default sponsored FPC is in `fpcs`, and `allowSponsored` |
| Private Fee Juice | a protocol PrivateFPC is in `fpcs`, and `privateFeeJuice` is a positive read |
| Fee Juice | `publicFeeJuice` is a positive read |

Default walk, first eligible wins — private origin: **Private Fee Juice → Fee Juice → Sponsored**;
public origin: **Fee Juice → Private Fee Juice → Sponsored**. The owner's order, set at the approval
gate: the payer that matches the origin is always tried first, Sponsored always last. (Rev 1–6 put
Sponsored first on both. The driver recommended keeping Sponsored ahead of Fee Juice under a private
origin, since Sponsored names the sponsor and Fee Juice names the account; the owner chose
Sponsored-last knowingly — D30. No notice on Sponsored: `sponsor_unconditionally` takes no arguments
and the fee payer is the sponsor contract — owner: *"No notice on Sponsored"*.)

**The one rule that carries the privacy guarantee.** Under a private origin the walk may step from
Private Fee Juice to Fee Juice **only if private Fee Juice was positively read as `"0"`** — a protocol
PrivateFPC is in `fpcs` *and* `privateFeeJuice === "0"`. Anything else — no PrivateFPC row, a `null`
or missing balance, no balances at all — **never reaches Fee Juice**: the walk skips straight to
Sponsored when one is eligible (that step costs no privacy, so it needs no positive read), and is
`hold` otherwise. After a positive `"0"`: Fee Juice if eligible; if Fee Juice is `"0"` or unread,
Sponsored if eligible; with no sponsor, a `"0"` Fee Juice is `none` and an unread one is `hold`.

This is deliberately blunter than tracking *why* something is missing. It has to be: `FpcService.getFpcs`
catches a failed protocol-FPC discovery and returns the partial list as a success, and the store
serves a last-good list after a failure, so "the PrivateFPC is not in the list" can never prove it does
not exist. A positive `"0"` cannot be produced by any failure path. The cost: on a network whose
protocol PrivateFPC genuinely cannot be registered, a private send with only public Fee Juice and no eligible
sponsor gets a hold instead of the fallback; the user picks Fee Juice by hand once, sees the row, and the pick is
remembered for that origin.

**A positive `"0"` is a fact about a moment, so the moment has to be now.** The SW reader serves
balances from a 5-minute cache and can return a result computed before an invalidation landed. A user
who just received private gas would otherwise be defaulted to the public payer on a true-but-old zero
— warned, but needlessly. So a Send mount with a private origin reads fresh: the card's existing
`forceRefresh` argument to `balancesStore.ensure` (today `Boolean(props.lockedMethod)`) also turns on
for `originPrivacy === "private"`. That is one uncached balance read per Send open, on the default
origin.

For that to mean anything the reader must honour it under concurrency, and today it does not: a
forced call that finds another document's flight (the home gas card's, say) waits it out and then
re-enters **unforced** (`gas-balance-reader.ts:94`), so it is handed that older flight's freshly
cached result — a zero from before the gas arrived, and before Send opened. The fix is in scope: the
re-entry keeps the caller's `forceRefresh`. A forced caller then always gets a computation that
started after it asked. (Overlapping forced requests compute in sequence rather than sharing — one computation per forced
request, so the queue follows the number of outstanding requests, not of documents. A Send open
issues one; not worth a sequence-number scheme.) A later-epoch
unforced caller re-enters unforced exactly as now.

Residual, accepted: gas received *while Send is already open* — including a result invalidated during
its own computation (`:204-212`) — is not seen until Send is reopened; the card deliberately ignores
tx-settle commits, and the row still renders.

Ends of the walk: a public origin may step past an unread Fee Juice to an eligible Private Fee Juice,
and past both to Sponsored (that costs gas or nothing, never privacy). Reaching the end with any *applicable* payer unread is `hold`; `none`
means every applicable payer was positively read and cannot pay. (Applicable: a Private Fee Juice
balance is only a question when a PrivateFPC is listed; a sponsor needs no balance.)

**Explicit picks.** A saved pick for the current account × origin wins when its row exists in
`buildFeeMethods(know.fpcs, know.balances, …)` and `isEligible`. The "positive read" bar applies to
the pick's *own* balance; it does not require the alternatives to be read — a user who chose Fee Juice
for private sends gets Fee Juice, with the row. The unread prohibition is about what the wallet does
unasked.

### Data & control flow

`methods` — the list the dropdown renders — deliberately carries no balances until `isInitComplete`,
and the legacy reconcile runs before that gate opens (pinned by the test "a saved fj selection stays
put on unknown balance"). The Send path never reads `methods.value` for eligibility.

1. `send.vue` binds `:originPrivacy="selectedSendType"`, `:destinationPrivacy="selectedReceiverType"`.
2. `commitFromEntry` copies the entry into the local refs exactly as today. Its selection block
   (`settledSelection`, the reference-inequality pick check) runs only for a `null` origin.
3. `sendPicks` — a reactive `{ [address]: { private?, public? } }`. Each `runInit` reads the new key
   and sets `sendPicks[address] = readSendSlots(raw, address)` for the address it read for, **merging
   under** any pick already made in this mount. Keyed by address, so nothing crosses accounts.
4. `sendSelection = computed(…)`:
   - `null` origin → not evaluated;
   - the committed scope is not the live identity (`committedScope` vs the identity props), or init is
     not complete → `pending`: no settings; the trigger shows the saved pick's row for the live
     account × origin if one resolves, as the prefill does today;
   - otherwise `resolveSendSelection(originPrivacy, committedKnowledge, sendPicks[address]?.[originPrivacy])`.
5. Two derived values, kept apart so a preview can never become a payment:
   - `effectiveMethod` — `selectedMethod` for a `null` origin; else the method **only when
     `sendSelection.kind === "selected"`**. `derivedSettings`, the "Available" row, the cost/priority
     rows and the warning row read this.
   - `displayMethod` — `effectiveMethod`, or `pending`'s `preview`. Only the dropdown's `:modelValue`
     (today bound to `selectedMethod`, `:609`) reads this.
   For a non-null origin `selectedMethod` is never written and the legacy prefill (`:425`) is skipped.
   `lockedMethod`, the embedded path (`handleUseEmbedded`, `useEmbeddedFee`) and the
   `cacheStore.feePaymentMethods` mirror stay in the `null` branch untouched — Send uses none of them,
   and the mirror is write-only from the card's side (nothing reads it back reactively).
5b. **FPC events.** `onFpcUpdated` / `onFpcDeleted` (`:219-232`) patch `selectedMethod` only, which
   the Send path no longer reads — and patching `registeredFpcs` would not survive, because every
   commit replaces it from the store (`:328`) and the store's FPC leg never hears FPC events. So for a
   non-null origin the handlers record into a card-local **overlay**, `fpcEdits: Map<id, FpcInfo | null>`
   (`null` = deleted; a later update for the same id overwrites it), and the computed reads
   `knownFpcs = applyFpcEdits(registeredFpcs, fpcEdits)` — pure, in `fee-privacy.ts`: drop deleted
   ids, replace rows whose id has an update, **never add** a row (`onFpcAdded` stays unsubscribed, as
   today). The overlay is idempotent, so it holds across any number of snapshot commits — a delete
   between the FPC leg and the gas leg, or before a recovery recommit, stays deleted. It is
   **never cleared while the card is mounted**, and it exists before the first fetch so an event
   during initialization is kept. Clearing it on an identity change would be wrong: the store keeps
   an account's entry across same-profile switches (`balances.store.ts:378`) and keeps the last FPC
   list when a refresh fails (`fpcFailureEntry`, `:216`), so A → delete S → B → back to A with a
   failed refresh serves a list that still has S. Keeping every tombstone is safe because FPC ids
   are unique and re-registering allocates a new id (`fpc/service.ts:308`) — an edit can only ever
   touch the row it names, on whatever identity that row shows up. The "Selected FPC was deleted" toast fires
   when the deleted id is the effective method's, checked before the edit is recorded. `null` origin:
   the handlers are unchanged.
6. `handleMethodPicked`, non-null origin: capture `address` and `origin` **synchronously**, set
   `sendPicks[address][origin]`, then `mutateSendSelections(raw => withSendSlot(raw, address, origin, rec))`.
   The legacy writer's pattern of reading a live prop after an await is not copied.
7. Warning row: rendered when `feePayerNotice(originPrivacy, destinationPrivacy, effectiveMethod)` is
   non-null. No suppression rule — an ineligible method is never `selected`.
8. Nudge and takeover, non-null origin: `sendSelection.kind === "none"`, independent of any selection.
   `hold` and `pending` raise neither. A `null` origin keeps `feeJuiceMissing`.

### The hold — no automatic re-read

On `hold` nothing is selected, `derivedSettings` is `undefined`, Confirm is disabled, and the
`fee-init-degraded` row shows:

- the store **is** degraded (`error` set, as today) → the existing string, which is true: the store's
  backoff loop is running and the card's `retryVersion` watcher recommits;
- otherwise → **"Couldn't check your private gas. Pick a fee source to continue."**

Rev 2 scheduled one delayed re-read here. Dropped. The honest trade, as the third audit put it: a
later attempt is **not** inherently futile — a transient failure can recover — so dropping it leaves
some recoverable holds standing until the next read (reopening Send, which now reads fresh). What it
buys: no timer, no lifecycle state machine with identity ownership, no way for the card to degrade
other subscribers on a failed extra fetch. The SW reader has already retried a thrown leg once before
answering, and a structural `null` (the read returned no slot) would be served from cache anyway.
**This is a change from what the owner approved** (the line was agreed for "after the re-read fails";
it now shows as soon as the read comes back unread); put to the owner at the approval gate and
approved — *"drop it"*.

### File-level change map

| File | Change |
|---|---|
| `modules/send/fee-privacy.ts` (+ `.test.ts`) | new |
| `modules/send/fee-send-selection.ts` (+ `.test.ts`) | new |
| `popup/constants/storage-keys.ts` | `SEND_FEE_PAYMENT_METHODS` |
| `modules/send/FeeSettingsCard.vue` | two props; `sendPicks`; `sendSelection`, `effectiveMethod`, `displayMethod`; the legacy selection block and prefill gated on a `null` origin; pick handler branch; FPC event handlers branch; `forceRefresh` on a private-origin mount; nudge/takeover on `none`; origin-aware nudge copy; hold copy; the inline warning row |
| `modules/send/FeeSettingsCard.test.ts` | new `describe` blocks only |
| `wallet/services/execution/gas-balance-reader.ts` (+ `.test.ts`) | a forced call that waits out another flight re-enters **forced** (`:94` passes `false` today); one regression test. Owner: *"Yes, in this PR"* |
| `popup/pages/send.vue` | two props; takeover button label |
| `popup/pages/settings/fpcs/index.vue` | second prune: `mutateSendSelections(raw => withoutFpc(raw, fpc.id))` |
| `popup/pages/settings/security/reset.vue` | `await clearSendSelections()` beside the existing remove — through the writer's chain, not a bare remove |
| `tests/e2e/send-fee-privacy.test.ts` | new (smoke) |
| `tests/e2e/network/fee-methods.test.ts` | one new test; delete this file's stale `// SKIP:` comments |
| `.claude/skills/e2e-testing/SKILL.md` | only if the e2e phase learns something durable |
| `implementations-plan/index.md` | plan line + the ledger follow-up as a `proposed` line |

### Copy

| Condition | Title | Body | Link |
|---|---|---|---|
| private → private, own Fee Juice | Your address pays this fee | This send hides the amount and the recipient, but the fee names your account publicly. Anyone watching the chain learns this account sent something, and when. | Get private gas |
| private → public, own Fee Juice | Your address pays this fee | The recipient and amount on this send are already public. Paying from public Fee Juice adds your address to them, and the whole transfer becomes readable as yours. | Get private gas |
| private origin, nothing can pay (nudge) | You have no private gas yet | A private send pays its fee from private gas, so the fee contract is the payer instead of you. Bridge some to cover this send. | Get private gas |
| hold, store not degraded | — | Couldn't check your private gas. Pick a fee source to continue. | — |

Notice strings live in `fee-privacy.ts` so the matrix test pins them.

### Trade-offs & alternatives not taken

Audited record in § Decision ledger. The ones a future reader will ask about: a discovery-completeness
signal from `FpcService` (a service change for information the positive-`"0"` rule makes unnecessary);
imperative selection state with a watcher (two rejected rounds); an automatic hold re-read (above);
outline B's "ignore a saved `fj`" (discards a deliberate, warned pick); a nested shape under the old
key (contradicts `FeeSettingsCard.test.ts:377`); a standalone notice component (one consumer).

## Security & Adversarial Considerations

**Threat model.** A passive chain observer linking an account address to activity the user meant to
keep private. No new remote input: everything the new code reads comes from the wallet's own services
or `chrome.storage.local`. The risk is the wallet itself choosing a revealing payer, or not saying so.

- **Defaulting to the public payer on less than a positive read (the primary risk).** Closed by one
  rule with one input — `privateFeeJuice === "0"` beside a listed PrivateFPC — that no failure path
  can synthesize: not a swallowed discovery failure, not a stale last-good list, not a `null` leg, not
  an undefined balances object, not a balance-less `methods` list. The matrix test enumerates them.
- **A true zero that is no longer true.** Identity is not freshness: the reader and the store bind a
  balance to its network, account, profile and chain (the third audit looked for an A→B or X→Y
  substitution and found none), but a real `"0"` can outlive a private-gas receipt in the reader's
  5-minute cache, or reach a forced caller through another document's overlapping flight. Closed for
  everything that happened before Send opened: a forced mount read, plus the reader fix that keeps a
  forced call forced after it waits out a flight.
- **A deleted sponsor coming back.** The store's FPC list never hears FPC events and overwrites the
  card's copy on every commit; a sponsor the user just deleted must not be re-selected to pay. The
  card-local edit overlay is applied on top of every snapshot, so it cannot.
- **Invariant:** *every selected private-origin Fee Juice renders `send-fee-privacy-notice`.* The
  notice is a pure function of `(origin, method)`. Both audits searched for a path that selects without
  warning and found none; the unsafe paths they did find would all have warned.
- **Races.** No mutable Send selection exists to race. The computed reads the live origin and refuses
  to resolve unless the committed scope is the live identity, so account A's balances never combine
  with account B's picks.
- **Stored-record tampering.** The slot blob is attacker-writable. Every reader takes `unknown`;
  non-objects, arrays, unknown slots, unknown `type`s, and non-string FPC ids read as absent; nothing
  throws; the stored record is a compact key resolved against fresh rows, never rendered. A forged
  `private: fj` reproduces a hand-pick at worst, and the row fires regardless.
- **Writers.** One function mutates the new key, on one chain, from both call sites. Two *documents*
  (a second Send window) can still interleave: last writer wins on a UI preference — accepted.
- **Layer bleed.** A `null` origin runs today's code against today's key; the existing
  `lockedMethod`, embedded and storage-shape tests pass unmodified.
- **Link target.** `FEE_JUICE_BRIDGE_URL`, a build-time constant, `rel="noopener noreferrer"`. The
  bridge has a private-gas route (`packages/bridge-core/src/private-fuel.ts`).
- **Logging.** None planned; any added line passes named object properties. **XSS.** No `v-html`.
- **Least privilege, crypto, supply chain, CI.** Untouched.
- **Accepted, low.** `none` trusts the FPC list for "no sponsor"; a silently failed sponsor discovery
  could show the bridge takeover to a user a sponsor would have covered. Messaging only, and today's
  nudge has the same blind spot.
- **Residual, accepted by the owner.** Confirm is `position: sticky`; the row can be off screen at the
  moment of commitment. The ledger follow-up closes it.

## Assumptions

### Facts (verified against the tree at `b0ebbb40`; re-checked across four audit rounds)

1. The default policy is `settledSelection`, SFC-private, `FeeSettingsCard.vue:308`; sole caller
   `commitFromEntry` (`:319`). On mainnet it picks `private_fpc` with no `disabled` check — pinned by
   `FeeSettingsCard.test.ts:631`.
2. `methods` (`:81-85`) has no balances until `isInitComplete`; the reconcile (`:332`) runs before the
   gate opens (`:337`). Pinned by the test "a saved fj selection stays put on unknown balance".
3. `runInit` closes the gate only when `committedKey !== reqKey` (`:412`) but prefills
   `selectedMethod` from storage unconditionally (`:425`) — so on a same-identity refresh the prefill
   lands with the gate open.
4. `commitFromEntry` sets `registeredFpcs = entry.fpc.data ?? []` (`:328`); `fpcFailureEntry` keeps the
   last-good list (`balances.store.ts:216`); `FpcService.getFpcs` catches a failed protocol-FPC
   discovery and returns the partial list (`fpc/service.ts:183-194`). A missing row proves nothing.
5. Four mounts: `send.vue:594`, `windows/execute/OperationCard.vue`,
   `popups/RevokeAuthwitsPopup.vue`, `popups/ChangeAuthwitsRegistryPopup.vue`. Only `send.vue` binds
   `v-model:needsFeeJuice`. `send.vue` survives account switches (it refetches on identity change).
6. `FEE_PAYMENT_METHODS` has three non-test users: the card (writer `:191`, which reads
   `props.account.address` after an await; prefill `:425`; reconcile `:332`),
   `settings/fpcs/index.vue` (its own read-modify-write prune), `settings/security/reset.vue:84`. It is
   in no backup slice or migration. `FeeSettingsCard.test.ts:377` asserts a top-level `type`.
7. `gas-balance-reader.ts` returns `privateFeeJuice: null` when no protocol PrivateFPC is registered,
   when the read returns no slot (cached fresh for the TTL), and when it throws twice (it retries a
   thrown leg once, then stale-marks its cache). A plain read serves the cache.
8. Any failed gas fetch — forced or plain — clears `verified` and sets `degraded` for every subscriber
   (`balances.store.ts:185-191`).
9. `settingsForMethod` (`fee-helpers.ts:78`) fails closed on an undefined balances object and on
   `null` / `"0"`, but accepts an object whose `publicFeeJuice` is `undefined`.
10. `selectedSendType` / `selectedReceiverType` are `ref("private")` (`send.vue:124-125`), also set by
    `initSendType` / `initReceiverType`. With no active token `SendTypesCard` does not render (`:547`)
    and Confirm is disabled regardless of the fee card (`:234`).
11. The fee trigger renders before init settles (`FeeSettingsCard.vue:607`).
12. `biome.json` bans `@/popup/pages/**` and `@/popup/windows/**` imports from `modules/**`; budgets
    are per function; neither touched file carries a suppression.
13. `feeJuiceImportedExtension` is file-scoped, funds public and private Fee Juice, and is used by
    `network/fee-methods.test.ts` and `network/price-fixture.test.ts`. The existing tests in
    `fee-methods.test.ts` pick methods on public-origin sends only.
14. Smoke: `tests/e2e/*.test.ts`; CI arms the token-seed pair with no key (empty list) and pins the
    active network to Testnet (`_extension-smoke-e2e.yml`); `global-setup-smoke.ts` only checks a build
    exists. `helpers/rpc-intercept.ts` (`interceptRpc`, `{ kind: "refuse" }`) is already used by the
    smoke test `import-dead-rpc.test.ts`. The heavy lane runs `fee-methods.test.ts` proverless,
    retry 0 (`pr-extension-network-e2e.yml`).
15. Vitest treats tokens after `--` as positionals; the documented form is
    `bun run test:e2e --retry=0 <file>`.
16. The FeeSettingsCard test harness's storage fake returns shared object references
    (`FeeSettingsCard.test.ts:146`).
17. The SW reader caches balances for `GAS_BALANCE_TTL_MS` = 5 minutes (`gas-balance-reader.ts:27`,
    `:75`) and returns a result to its caller even when an invalidation landed mid-compute, only
    stale-marking the cache (`:204-212`); the store commits that result as `verified`. No path in the
    reader fabricates a `"0"` — a failed or empty read is `null`.
18. The card already passes `forceRefresh: Boolean(props.lockedMethod)` to `balancesStore.ensure`
    (`FeeSettingsCard.vue:373`); the store runs it as `cause: "forced"`, which never joins a store
    flight (`balances.store.ts:434`, `:564`). In the reader, `forceRefresh` skips a settled cache entry
    (`:73`) **but not an overlapping flight**: a forced call that finds another document's flight waits
    it out and re-enters with `false` (`:94`), and with no invalidation in between that flight's result
    is a fresh cache entry and is returned. The reader's existing forced-concurrency test invalidates
    first, which masks this. Phase 2 fixes it. The card's recovery watcher observes `retryVersion`
    only, so tx-settle (forced) commits do not re-enter it.
19. `onFpcUpdated` / `onFpcDeleted` (`FeeSettingsCard.vue:219-232`) patch `selectedMethod` only and
    never touch `registeredFpcs`; the dropdown's `:modelValue` is `selectedMethod` (`:609`).
20. `SelectFpcPopup.vue` writes `cacheStore.feePaymentMethods`; the card never reads that mirror back
    reactively. `FeeMethodSelector.vue` refuses a click on a `disabled` row, and `buildFeeMethods`
    disables a self-paid row whose balance is an explicit `null` (`fee-helpers.ts:181`, `:195`) — so a
    hold with both legs `null` and no sponsor offers nothing to pick. When the **whole** balances
    object is undefined (a whole-fetch failure) the rows stay enabled, as today: a click records the
    pick, the resolver still refuses it as ineligible, and the card stays on hold with its honest line
    until the store's retry lands. The dropdown is unchanged by owner decision; payment safety rests
    on the resolver's own eligibility check, not on the row's disabled state.

### Inferences (unverified — attack these)

- **I1.** Refusing the active network's RPC origin with `interceptRpc` makes the Send page's gas read
  fail fast and deterministically in a smoke build, landing the card in its degraded state with the
  `fee-init-degraded` row visible — a settled state to wait for. First step of Phase 4.
- **I2.** With no token, the fee card still mounts on Send with the default `"private"` origin.
- **I3.** The defaulted fallback needs private gas at a positive `"0"` with public gas held. No currently
  exercised Send fixture has that shape (unfunded accounts hold neither, `feeJuiceImported` holds
  both; `feeJuiceReadyExtension` funds public gas alone but has no test consumers), so it lives
  in component tests and the network test reaches the row by picking Fee Juice by hand.
- **I4.** A new smoke file needs no CI list change.
- **I5.** One shield plus one private-origin send fits the heavy lane proverless within 300 s.
- **I6.** No existing e2e relies on a Send pick carrying into the dApp execute window or back. Phase 4
  greps `selectFeeMethod` callers and runs `tx-sendTx-selfPay` and `tx-sendTx-sponsoredFpc` to check.
- **I7.** On Alpha, a fresh profile registers the protocol PrivateFPC and reads a positive `"0"`, so
  the fallback — not a hold — is what a new user with only public Fee Juice actually meets. Nothing in
  the source establishes how often a hold happens instead (`fpc/service.ts:238` attempts the
  registration with no Alpha exclusion; `:183-194` swallows a failure). Phase 5 records one manual
  fresh-profile Alpha observation; this plan makes no claim about hold frequency.
- **I8.** A forced read on every private-origin Send open is acceptable load: normally one public +
  one private view call per successful open, excluding the reader's one retry per thrown leg
  (`gas-balance-reader.ts:218`) and any store recovery. A baseline, not a bound; not measured. Latency:
  a forced store run first waits out an earlier raw flight (up to the 20 s init timeout,
  `balances.store.ts:487`) and then runs its own — so the reader fix buys freshness on the dApp
  window's `lockedMethod` path too, at a possible latency cost there, not for free.
- **I9.** With Sponsored last, the six network files that call `sendTransfer` without picking a fee
  method (`transfers`, `auto-lock-defers-while-proving`, `profile-switch-sweeps-transfer`,
  `in-flight-send-guard`, `imported-account-execution`, `account-switch-isolation`) still resolve to
  Sponsored: their accounts hold no gas, so both balances read a positive `"0"` (or the private one is
  unread and the walk skips to the sponsor). Among tests that open Send, only `fee-methods.test.ts` runs on the
  gas-funded fixture, and it picks explicitly. Phase 4 runs `transfers.test.ts` as the canary; the PR's required
  network suite runs the rest. If the canary shows a default-reliant test now self-paying, that test
  gets an explicit `selectFeeMethod(page, "sponsored")` — a test change, not a rule change.

### Asks

One, put at the approval gate and answered — **drop the automatic re-read** (§ The hold): owner, *"drop it"*. Everything else was decided
by the owner. Two engineering calls stand and are reversible: taking an eligible sponsor instead of holding
when private gas is unread (D30), and silence for a public → private send.

## Phases

Fast layers, from the repo root unless stated: `bun run lint`, `bun run typecheck`, and the touched
test files via `bun --bun vitest run <files>` from `apps/extension`. Run them after each meaningful
step, not only at the gate.

### Phase 1 — the rule, pure ✓

`fee-privacy.ts`, the pure half of `fee-send-selection.ts`, the storage-key constant, their tests.

- Notice matrix: origin × destination × method → a notice in exactly the two private-origin Fee Juice
  cells; a `null` destination takes the private → private wording; a `null` origin never yields one.
- Walk: both orders; Sponsored last — an eligible origin-matching payer beats an eligible sponsor on
  both origins, and under a private origin an eligible Fee Juice beats an eligible sponsor once
  private gas is a positive `"0"`. **Private origin reaches Fee Juice in exactly one knowledge
  state** — PrivateFPC listed, `privateFeeJuice === "0"`, public positive — and the test enumerates the
  rest: no PrivateFPC row (empty list, sponsor-only list), `privateFeeJuice` `null` / `undefined`,
  balances `undefined` — each is **Sponsored when a sponsor is eligible, `hold` when not, never Fee
  Juice**. Positive `"0"` private + `"0"` or unread public → Sponsored when eligible. Public origin may pass an unread Fee Juice to an eligible Private
  Fee Juice. `none`: PrivateFPC listed with `"0"` + public `"0"` + no sponsor; and, for a public origin,
  no PrivateFPC listed + public `"0"` + no sponsor. A known sponsor is selected with every balance unread.
- Picks: an eligible pick wins; a pick whose row is gone, or whose own balance is unread or zero, falls
  to the walk; a private-origin `fj` pick is honored with the alternatives unread.
- Slots: round trip; slots independent; `withoutFpc` across both; hostile input — non-object, array,
  number, unknown slot, missing or unknown `type`, non-string FPC id — reads as absent, never throws.

**Validation gate** — layers: lint · typecheck · unit
- `bun run lint && bun run --cwd apps/extension typecheck`
- `cd apps/extension && bun --bun vitest run src/popup/components/modules/send/fee-privacy.test.ts src/popup/components/modules/send/fee-send-selection.test.ts`
- Pass: exit 0; `git diff --quiet -- scripts/complexity-baseline/manifest.json` exits 0.

### Phase 2 — the card's selection ✓

Everything in the change map for the card except the warning row; `mutateSendSelections`;
`fpcs/index.vue`; `reset.vue`. The storage fake in the new blocks returns **cloned** snapshots after a
controllable delay (Fact 16), so ordering bugs are observable. New `describe` blocks:

- mainnet, private origin, PrivateFPC listed with `"0"`, public held → `{ kind: "fj" }` emitted;
- the same with `privateFeeJuice: null` and no sponsor → nothing selected, no settings, `needsFeeJuice` false, the
  honest copy, **no** extra `getGasBalances` call;
- FPC list empty with public held → nothing selected (not `fj`); sponsor-only with public held →
  Sponsored (not `fj`), no notice; PrivateFPC `"0"` + public held + a sponsor → `fj` (the notice on that state is Phase 3's assertion);
- gas fetch rejected, no eligible sponsor → nothing selected, the existing "retrying" copy; with an
  eligible sponsor → Sponsored;
- a saved private-slot `fj` with an unread public balance → not selected;
- public origin → Fee Juice ahead of Private Fee Juice;
- origin flip after commit re-resolves with **no** fetch; a flip during `runInit`'s ensure, during
  `recommit`'s storage await, and during a run that is then **superseded or discarded by the drift
  guard** — each ends resolved for the live origin;
- a same-identity refresh with a saved pick in storage does not install it past the rule (Fact 3);
- **account A's pick never governs account B** across an in-place account switch, and A→B→A restores A's;
- two picks in quick succession in different slots → both persisted; a pick racing an FPC prune → both
  effects persisted; a rejected storage write does not wedge the chain;
- the pick survives a remount; a legacy-key pick does not govern Send; a Send pick does not write the
  legacy key;
- both positively zero, no eligible sponsor → nudge (private wording) + `needsFeeJuice` true with **no** method selected;
  one zero and one held → neither;
- a private-origin mount calls `getGasBalances` with the forced path; a public-origin and a `null`
  -origin mount do not (the `lockedMethod` case excepted, as today);
- given a positive private balance from the (mocked) client on that forced read, Private Fee Juice is
  selected, never Fee Juice. This file replaces `ExecutionServiceClient.getGasBalances`, so it proves
  flag forwarding and selection only — reader freshness is proved in the reader's own test:
- **`gas-balance-reader.test.ts`, new case — stale zero, no invalidation**: an unforced read is in
  flight and will resolve private `"0"` (the test configures a protocol PrivateFPC — the file's default fixture lists none, `:26`, and would leave the private leg out); the underlying balance becomes positive; a forced read
  arrives; **no `invalidate*` call**. The forced caller gets the positive balance and the view deps
  were called for a second computation. Red on today's reader (the existing forced-concurrency case
  at `:428` invalidates first, which is why it passes). Plus: an unforced later-epoch caller still
  re-enters unforced;
- `pending` yields no settings even when a preview row is shown; the dropdown shows the preview, the
  "Available" / warning rows do not;
- FPC events under a non-null origin, during init and after: deleting the selected sponsor re-resolves
  down the walk (and toasts); updating an FPC's name reaches the trigger; neither leaves a deleted row
  selected. The two orderings that defeat a plain patch are pinned by name: a sponsor deleted **after
  the FPC leg resolved but before the gas leg settles** stays gone once the commit lands, and one
  deleted after init stays gone across a **recovery recommit** (`retryVersion` bump) whose store
  snapshot still lists it. The switch-back case: on account A delete sponsor S, switch to B, switch
  back to A with the FPC refresh **failing** (the store serves A's retained list, S included) — S is
  neither selected nor offered, with or without a saved pick for it; and an event received before the
  first fetch resolves is kept. `applyFpcEdits` gets its own unit
  cases in Phase 1 (delete, update, update-after-delete, never adds). The same events under a `null`
  origin behave as the existing tests pin;
- a pick queued just before `clearSendSelections()` does not resurrect the key;
- co-mount (`fee-cards.comount.test.ts`): a Send card on hold issues no fetch beyond its mount read.

**Every pre-existing test passes unmodified** — `:631`, `:377`, the saved-`fj` reconcile pin, the
`lockedMethod` and embedded suites.

**Validation gate** — layers: lint · typecheck · unit/component
- `bun run lint && bun run --cwd apps/extension typecheck`
- `cd apps/extension && bun --bun vitest run src/popup/components/modules src/popup/windows/execute src/popup/components/popups src/utils/storage-facade-ban.test.ts src/utils/log-payload-ban.test.ts src/wallet/services/execution/gas-balance-reader.test.ts`
- `git diff -U0 b0ebbb40 -- apps/extension/src/popup/components/modules/send/FeeSettingsCard.test.ts apps/extension/src/popup/components/modules/fee-cards.comount.test.ts | grep '^-[^-]'`
- Pass: the first two exit 0; the third prints nothing (no pre-existing test line removed or changed).

### Phase 3 — the row and the page

The inline row (testids `send-fee-privacy-notice`, `send-fee-privacy-remedy`; the root carries
`data-notice-shape` so e2e tells the wordings apart without reading text), origin-aware nudge copy,
`send.vue` props and button label. Card tests: the row for a defaulted and a hand-picked Fee Juice
under a private origin; both shapes as the destination flips, with the selection untouched; absent
for a public origin, a `null` origin, Sponsored and Private Fee Juice; the link's `href`, `target`, `rel`.

**Validation gate** — layers: lint · typecheck · unit/component · smoke e2e
- `bun run lint && bun run --cwd apps/extension typecheck`
- `cd apps/extension && bun --bun vitest run src/popup/components/modules`
- Rebuild, armed as CI's smoke build: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome`
- `cd apps/extension && NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e`
- Pass: all exit 0. Capture a screenshot of the row for the PR.

### Phase 4 — e2e

**Smoke** — `tests/e2e/send-fee-privacy.test.ts`, "a private send with unreadable balances never
falls back to the public payer". Arm `interceptRpc(browser, extensionId, <active network RPC origin>,
{ kind: "refuse" })` before opening the popup; open Send; **wait for the settled state** —
`fee-init-degraded` visible — so no assertion can pass against a card that has not resolved yet
(Fact 11); then assert the trigger's `data-fee-method` is not `"public"` and
`send-fee-privacy-notice` is absent; finally `failures()` is empty and `hits()` is positive, proving
the read was actually intercepted. Confirm's disabled state is not asserted: with no token it is
disabled for an unrelated reason (Fact 10). If I1 or I2 is false, record it in `lessons/phase-4.md`
and assert at the deepest settled surface smoke reaches rather than dropping the file.

**Network** — one test in `tests/e2e/network/fee-methods.test.ts` on `feeJuiceImportedExtension`,
`{ timeout: 300_000 }`. The fixture is file-scoped and earlier tests leave picks behind, so the test
asserts no default: shield 100 with `selectFeeMethod(page, "sponsored")` explicit → await confirmation
and the refreshed private balance row → open Send, private → private →
`selectFeeMethod(page, "sponsored")` → the row is absent → `selectFeeMethod(page, "public")` → the row
is present, `data-notice-shape="private-private"`, the remedy's `href` is the bridge URL → destination
to public → `private-public` → origin to public → the row is gone → origin back to private → the
private slot's pick returns with the row → submit → confirmed → reopen Send, private origin → the pick
and the row persisted. Testid selectors only. Then I6: grep `selectFeeMethod` callers, and run the two
`tx-sendTx-*` files.

**Validation gate** — layers: smoke e2e · network e2e
- the Phase 3 rebuild command, then `cd apps/extension && NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e --retry=0 tests/e2e/send-fee-privacy.test.ts`
- `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0 NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/fee-methods.test.ts tests/e2e/network/tx-sendTx-selfPay.test.ts tests/e2e/network/tx-sendTx-sponsoredFpc.test.ts tests/e2e/network/transfers.test.ts` — CI's shape (`transfers` is the I9 canary: a default-reliant Send on an unfunded account still gets a payer). Nothing else heavy on the host; `bun run e2e:reap` afterwards.
- Pass: both exit 0 at retry 0. Record the new network test's wall time in `lessons/phase-4.md`
  (I5); one prover-ON run of `fee-methods.test.ts` is recorded too — informational, not gating.

### Phase 5 — docs and the full gate

`implementations-plan/index.md`: this plan's line, and a `proposed` line for `send-publish-ledger`
(the constant three-row "This send publishes" ledger in the Send footer; closes the off-screen-notice
gap). Any durable e2e lesson goes to the `e2e-testing` skill. One manual observation for I7, recorded in
`lessons/phase-5.md`: a fresh profile on Alpha — is the protocol PrivateFPC listed, and does private
Fee Juice read `"0"` or unread? Informational; it does not gate.

**Validation gate** — layers: all fast layers + build
- `bun run audit:vue`
- Pass: exit 0.

## Decision ledger

| # | Decision | Source | Outcome |
|---|---|---|---|
| D1 | Structure: outline A, B, or the hybrid | round 1, both | **Hybrid.** Pure `fee-privacy.ts` + per-origin slots; the row inline (B). `FeePrivacyNotice.vue` dropped — one consumer, two inline siblings. Rev 1's complexity argument against inlining was wrong: budgets are per function. |
| D2 | B's "don't honor a saved `fj` under a private origin" | round 1, both | **Rejected.** Discards a deliberate, warned pick every time Send opens; public-origin preferences still bleed. |
| D3 | Storage: nested under the old key vs a second key | round 1, both | **Second key.** Removes the union type, legacy detection and an `any` slot; makes "`null` origin unchanged" literally true (`FeeSettingsCard.test.ts:377`). Owner accepted the visible consequence. Round 2 confirmed it also isolates Send from the legacy key's unserialized writer. |
| D4 | What lets the wallet default to the public payer | round 1 (both), round 2 (codex High) | **A positive `"0"` beside a listed PrivateFPC — nothing else.** Rev 1 keyed on `method.fpc`; rev 2 on "the FPC list is defined". Round 2 showed a defined list proves nothing: discovery failures are swallowed into a successful partial list, and last-good lists are served after failures. Rejected alternative: a completeness signal out of `FpcService` — a service change for information this rule makes unnecessary. |
| D5 | Which list the Send path resolves against | round 1, both | **A balance-aware list built from the committed knowledge**, never `methods.value`. Opening the gate earlier was rejected: it breaks the pinned reconcile-timing test and changes the `null` path. |
| D6 | Takeover / nudge trigger | round 1 codex; round 2 "sound" | **`sendSelection.kind === "none"`**, independent of selection. |
| D7 | Suppress the row when the method cannot pay | round 1 split; round 2 "sound" | **No rule.** An ineligible method is never `selected`. |
| D8 | How Send tracks a selection | round 1 (both: races), round 2 (codex High ×3: `lastPick` crosses accounts; a stood-down watcher loses a flip; the prefill bypasses the rule with the gate open) | **It doesn't — the selection is a `computed`.** Rev 2's `lastPick` + watcher + slot-aware prefill all removed. Picks are keyed by address; the computed resolves only when the committed scope is the live identity. |
| D9 | Writers of the new key | round 1 (both), round 2 (codex Medium) | **One module-scoped function, one chain that survives rejection, used by the card and the FPC prune**; address and origin captured at enqueue. Cross-document interleaving accepted (last writer wins on a UI preference). |
| D10 | Recovering from a hold | round 1: codex forced, fable plain; round 2: codex — a plain read serves the cache, can still degrade subscribers, and the lifecycle was unspecified | **No automatic re-read.** A trade, not a proof of futility: a later attempt can recover a transient failure, but it costs a timer + a lifecycle state machine in the card — the source of two audit findings — on top of the reader's per-leg retry and the store's whole-fetch recovery. Accepted cost: a response that carries an unread leg stays a hold until Send is reopened or a source is picked by hand. Honest copy immediately. Owner, at the gate: *"drop it"*. |
| D11 | Hold copy | fable A2 → owner | New string in the existing row. |
| D12 | Smoke scope | round 1 (both), round 2 (codex High: assertions could pass before the card resolves) | Dead-RPC test: interception armed first, wait for the settled degraded row, then assert; `hits()` / `failures()` checked. No origin toggles (no token); Confirm not asserted. |
| D13 | Gate mechanics | round 1, both | `--retry=0` before the file; armed rebuild before smoke; `git diff -U0 … \| grep '^-[^-]'`; the heavy lane is proverless. |
| D14 | Hostile parsing reach | round 1 | Readers take `unknown`; stored records are compact keys resolved against fresh rows. |
| D15 | Null destination | fable S6 | Private → private wording. |
| D16 | Does the bridge offer private gas | fable A3, checked | Yes — `packages/bridge-core/src/private-fuel.ts`. |
| D17 | Explicit `fj` pick with alternatives unread | round 2 codex (Asks) | **Honored, documented.** The positive-read bar applies to the pick's own balance; the prohibition is on what the wallet does unasked. |
| D18 | Network test state | round 2 codex | Asserts no default (file-scoped fixture, earlier picks); Sponsored picked explicitly for the shield; waits for the refreshed private balance. |
| D19 | "Every unread state holds" | round 2 codex | Narrowed to *applicable* payers; the matrix lists `none` cases with a genuinely empty list. |

| D20 | Freshness of the `"0"` that authorizes the fallback | round 3 codex (High) → owner | **Forced read on a private-origin Send mount**, through the card's existing `forceRefresh` argument. Owner: *"Yes, force it"*. Rejected: reconciling Send on every balance invalidation — the card ignores tx-settle commits by design, and changing that reopens the races D8 closed. Residual (gas received while Send is open) accepted. |
| D21 | FPC update/delete under the computed selection | round 3 codex (High) | For a non-null origin the handlers patch the committed `registeredFpcs`; the computed re-resolves. `null` origin unchanged. Rev 3 had silently left them patching a ref the Send path no longer reads. |
| D22 | Loading preview | round 3 codex (Medium) | `pending` is in the union with a display-only `preview`; settings derive from `selected` only; the dropdown binds `displayMethod`. |
| D23 | Reset vs the write chain | round 3 codex (Medium) | `clearSendSelections()` on the same chain. |
| D24 | "Any method can be picked by hand" | round 3 codex (Low) | Reworded to *eligible*; the everything-unread-and-no-sponsor dead end is recorded (Fact 20), not engineered around — the store's own retry covers a whole-fetch failure, and reopening Send reads fresh. |
| D25 | How often a hold replaces the fallback on Alpha | round 3 codex (Low) | Unmeasured; one manual observation in Phase 5 (I7). No claim made. |
| D26 | The forced read under reader concurrency | round 4 codex (High, reproduced) → owner | Fix the reader in this PR: a forced call re-enters **forced** after waiting out a flight; regression test without an invalidation. Owner: *"Yes, in this PR"*. D20 amended — it was hollow without this. Rejected: a flight sequence number so overlapping forced callers share one computation — one computation per outstanding forced request; a Send open issues one; not worth the machinery. |
| D27 | FPC events vs snapshot commits | round 4 codex (High) | D21 superseded: a card-local idempotent overlay (`fpcEdits` + pure `applyFpcEdits`) applied over every snapshot and, after round 5, **never cleared while mounted** (D29). Rejected: refetching the FPC leg on each event — a second async path into the commit machinery, the race class D8 removed; and teaching the store about FPC events — touches the home gas card and the dApp window. |
| D28 | Fact 20 / Fact 18 / I8 wording | round 4 codex (Low) | Qualified. A whole-fetch failure leaves rows clickable that the resolver refuses; the dropdown stays unchanged by owner decision, safety rests on the resolver. |
| D29 | Overlay lifetime | round 5 codex (High, reproduced) | Never cleared while the card is mounted; present before the first fetch. Rejected: codex's partition-by-profile-and-chain — ids are unique among stored rows and re-registration draws a new one, so partitioning buys nothing a flat id map lacks (residual: a random 32-bit id collision with a tombstone hides the new row until Send is reopened — negligible, and partitioning would not remove it). Out of scope, noted: a card mounted *after* a deletion can still be handed a stale retained list by the store on a failed refresh — pre-existing, shared with the dApp window, and the execution layer rejects a payer that no longer exists. |
| D30 | Walk order | owner, at the approval gate (after codex's approve) | **Origin-matching payer first, Sponsored last**: private Private FJ → FJ → Sponsored; public FJ → Private FJ → Sponsored. Driver's counter-recommendation (Sponsored before FJ under a private origin — it does not name the account) put to the owner and declined. Derived by the driver, not the owner: with private gas *not* positively read the walk skips Fee Juice and takes an eligible sponsor rather than holding — the positive-`"0"` rule guards only the step that leaks. No notice on Sponsored (owner). |

Still disputed: nothing open. D4's cost (a hold where a fallback would have been correct, on a network
without a registrable PrivateFPC) and D10 are the two calls a fresh reviewer should re-attack.

## Audit verdicts

**Round 1 — codex (`gpt-6-astra`, `high`): reject.** Blocking: incomplete unread-state protection,
broken empty-state takeover, unresolved selection races. **All adopted** (D3–D9, D12–D14).
Transcript: `audit-codex.md`.

**Round 1 — fable: conditional approve** (S1, S2, S3, F1, V1, V2 before coding; A1 to the owner).
**All adopted**; A1 and A2 answered by the owner; A3 checked (D16). Transcript: `audit-fable.md`.

**Round 2 — codex, fresh context, on rev 2: reject.** Blocking: a defined FPC list is not confirmed
knowledge (D4); `lastPick` crosses accounts (D8); standing down loses an origin flip (D8). Also: plain
re-reads can degrade other subscribers — rev 2's claim otherwise was false (Fact 8, D10); the prefill
is not always behind a closed gate (Fact 3, D8); "every unread state holds" too broad (D19); the
re-read can make no fresh attempt, decide explicitly (D10 → owner); lifecycle guarantees claimed but
unspecified (D10, moot); the queue did not cover the prune (D9); smoke could pass vacuously (D12);
network setup incomplete (D18). It correctly called out that rev 2's "all findings adopted" overstated
D4. Every factual claim re-checked and held. **All adopted — most by deleting the mechanism they
attacked rather than patching it.** Transcript: `audit-codex-final-r1.md`.

**Round 3 — codex, fresh context, on rev 3: reject.** Blocking: a stale zero can authorize the public
fallback (D20); the computed selection omitted the existing FPC event paths (D21). Also: `pending`
missing from the union and the dropdown still bound to the old ref (D22); reset outside the write
chain (D23); manual recovery overstated (D24); D4's Alpha cost unmeasured (D25); D10's rationale
overstated futility — corrected in § The hold, still an owner item. It found **no** path that selects
without warning, **no** cross-account or cross-network balance substitution, **no** fabricated `"0"`,
and listed the architecture — separate storage, per-origin picks, pure resolver, inline row,
`null`-origin compatibility — under "looks fine"; gates and both e2e tests judged real and achievable.
Every factual claim re-checked and held. **All adopted.** Transcript: `audit-codex-final-r2.md`.

**Round 4 — codex, fresh context, on rev 4: reject. All adopted in rev 5 (D26–D28); the owner chose a fifth pass.**
Both blockers re-checked against the tree and hold:
1. **D20 is not delivered by the reader as it stands.** `gas-balance-reader.ts:94` re-enters a forced
   call with `forceRefresh = false` after waiting out another document's flight; with no invalidation
   in between, that older flight's result is now a fresh cache entry and is returned (`:75`). Codex
   reproduced it in memory (older read `"0"`, balance becomes 55, forced read still `"0"`). A
   pre-existing reader defect (the `lockedMethod` path has it too); fix = keep the forced intent on
   re-entry + a direct `gas-balance-reader.test.ts` regression without an invalidation. My own
   pre-check of this path missed it.
2. **D21 patches a list the next commit overwrites.** `FeeSettingsCard.vue:328` replaces
   `registeredFpcs` from the store on every commit, and the store's FPC leg never hears FPC events —
   so a sponsor deleted after the FPC fetch but before gas settles (or before a recovery recommit)
   comes back and is re-selected. Fix = keep scope-bound event deltas across commits, or refetch the
   FPC leg on the event; pin the delete-between-legs and recovery-recommit cases.
Non-blocking: Fact 20 (an undefined whole-balances object leaves rows clickable that the resolver
refuses), Fact 18 and I8 need qualifying; the component stale-zero test proves flag forwarding only.
Judged sound: dropping the hold re-read, `pending.preview`, the `null`-origin branch, all five gates
runnable; no selection-without-warning path found. Transcript: `audit-codex-final-r3.md`.

**Round 5 — codex, fresh context, on rev 5: reject — one blocker. Adopted in rev 6 (D29); the owner chose a closure check on the resumed session.**
D27's overlay is cleared on identity change, but the store keeps an account's entry across
same-profile switches (`balances.store.ts:378`) and keeps the last FPC list when a refresh fails
(`fpcFailureEntry`, `:216` — re-checked, holds). A → delete sponsor S → B → back to A with a failed
FPC refresh serves A's old list with S in it, and the cleared overlay no longer hides it. Smallest
fix: never clear the overlay while the card is mounted (FPC ids are unique and re-registration
allocates a new id, `fpc/service.ts:308`, so a tombstone can only ever hide the row it names), seed it
before the first fetch, and pin A→B→A-with-failed-refresh. Non-blocking: the forced-queue bound is per
outstanding request, not per document; I8 / "strictly an improvement" ignore the store's up-to-20 s
wait on an earlier raw flight; D10's ledger row still says "futile"; the reader regression must
configure a protocol PrivateFPC (the default fixture lists none). Confirmed sound: D26 (codex ran it —
four stale zeros on today's reader, four fresh reads with the fix; no loop, fences intact), the
positive-zero rule, the warning derived from the effective method, `pending.preview`, separate memory,
the `null`-origin branch, all five gates. Transcript: `audit-codex-final-r4.md`.

**Closure check — same codex session, rev 6: `approve`.** Blocker closed; no new defect or
contradiction from the edits. One Low, adopted: FPC ids are unique among *currently stored* rows only
(`id-allocators.ts:48` draws eight hex characters and checks live membership), so a deleted id could
recur by random collision and a retained tombstone would hide the new row until Send is reopened —
negligible, no deterministic path, and partitioning would not remove it. D29 qualified. Transcript:
`audit-codex-closure.md`.

**Closure check on rev 7 (the owner's walk-order change) — same session: `approve`, high confidence.**
The derived skip-to-sponsor rule keeps the forced-read positive-`"0"` requirement for defaulting to
Fee Juice; every selected private-origin Fee Juice still renders the notice; no default-reliant Send
test newly self-pays or holds (the six files' accounts hold tokens, not gas — `fixtures/extension.ts:758`);
no smoke test opens Send. Four Low wording corrections, all applied. Transcript:
`audit-codex-closure-r7.md`.

## Post-implementation

Run by the implementing session after Phase 5 is green. This plan is **single-arc**: the loop runs
once, over the whole diff from `b0ebbb40`.

1. `/code-review` is **not run** — `code_review: off`. Do not add it.
2. **Codex audit** — `/codex high` (run with `CODEX_ACCOUNT=best`), given: the net diff from the plan
   baseline, this `plan.md` with its decision ledger, and these three asks verbatim:
   - *"What could go wrong? What would an attacker target? What are we trusting that we shouldn't? In
     particular: is there any path that selects the account's own Fee Juice under a private origin
     without `send-fee-privacy-notice` rendering; any path where the wallet DEFAULTS to it on anything
     other than a positive `"0"` private balance beside a listed PrivateFPC; any way a pick or a
     balance from one account reaches another; and is a `null` origin still exactly the old behaviour?"*
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each real
     problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code visibly
     does, restates its line, references implementation plans / phases / reviews, or spends a paragraph
     where a sentence works — and flag places where a non-obvious invariant or constraint deserves a
     comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to
     re-read: they must be few, dense, and exact."*
3. **Fix loop** — verify each of codex's factual claims against the tree first; apply the accepted
   fixes; commit; log the round (what was asked, what it found, the call) in `lessons/post-impl.md`;
   then **resume the same codex session** with the fix diff for a re-review under the same three asks.
   Repeat until a round yields no new material finding. Rejected nitpicks are not churn. Still
   producing material findings after three rounds → stop and bring it to the owner.
4. **Delivery** — only now is a PR opened (§ Delivery).

Rewrite any path codex returns to repo-relative before committing a transcript.

## Delivery

Single arc, one branch, one PR into `dev`, plain `gh pr create` — no stack.

| Arc | Phases | Stacks on | `/code-review` |
|---|---|---|---|
| 1 | 1–5 | `dev` | off |

- Title (≤ 93 chars, becomes the squash subject): `feat(send): match the fee source to the transfer's privacy and warn on a public payer`
- Body: the UI-impact table, the owner's sign-off quotes, the screenshot, the gate results.
- Open the PR first; add the `e2e:extension-network` label **afterwards** (labelling at creation
  cancels a sibling e2e run and leaves red checks).
- Then `gh pr checks --watch`. Merging is the owner's call.
- After the PR merges: add an `## Outcome` block under this file's front matter (date, status, PR
  number, what was dropped, and one line retiring the seeds below), and mark the `index.md` line.

## Post-implementation hardening

Not scheduled — contained UI and selection logic with no trust boundary, secret, CI or publishing
surface. Owner's decision at Phase 0.

## Seeds

Proposal artifact (the owner's design record): `https://claude.ai/artifact/UZ2NkWvAmSuTtWxHuYNNdj`
ELI5 artifact: `https://claude.ai/artifact/J6Q2EpF93m41w9tR1v1TTV` — source `implementations-plan/send-fee-privacy-notice/eli5.html` (republish the same file to keep the URL). It carries the same final seeds as below.

Final seeds (approved scope, rev 7). Use exactly one per session — they don't compose. Run from inside
this plan's worktree (`agent-worktree resume send-fee-privacy-notice`).

**Recommended — `/goal`** (every completion signal is transcript-observable):

```
/goal All five phases marked ✓ in implementations-plan/send-fee-privacy-notice/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript — including, for Phase 2, the `git diff -U0 b0ebbb40` check on the existing card tests printing nothing, and for Phase 4 both the smoke and network e2e at retry 0; for each phase the agent has printed `LESSONS_FILE=implementations-plan/send-fee-privacy-notice/lessons/phase-N.md` in the transcript; `/code-review` was NOT run (plan.md `code_review: off`); the codex fix loop (`/codex high`) converged on the whole diff from b0ebbb40, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript; one PR to `dev` exists, opened only AFTER the loop converged, with a screenshot of the notice row in its body (`gh pr view` output in the transcript); `bun run test` and `bun run lint` both report exit 0 in the transcript. Constraints: never touch apps/tools/** or packages/bridge-core/**; no UI beyond plan.md's UI-impact table; never merge.
```

**Fallback — `/loop`:**

```
/loop 15m Drive implementations-plan/send-fee-privacy-notice forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/send-fee-privacy-notice/plan.md and lessons/ (authoritative — not the chat). If plan.md is gone, archived, or carries an `## Outcome` block: STOP and say so. Task list empty? Rebuild it from plan.md's phase headers. Run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI is fine — confirm it is progressing; use the wait to review the diff or strengthen tests. Don't start conflicting work.
3. No task in hand? Take the next pending step from plan.md. After each meaningful edit run `bun run lint` + the touched vitest files. Commit small, conventional, signed. Do not push until the phase gate passes; do not open a PR until step 7.
4. Stuck, or facing a decision you'd bring to me? Call `/codex high` with full context, settle it, log the consult + verdict in lessons/phase-N.md. Hard limits: never merge, never publish, never expand scope beyond plan.md, never change user-visible UI beyond plan.md's UI-impact table, never touch apps/tools/** or packages/bridge-core/**. Crossing one → surface and hold.
5. Same step failed 5 times? Stop retrying; reassess with codex.
6. Phase green = THAT PHASE'S GATE in plan.md passes (exact commands + criteria). Run it, paste the result, mark ✓ in plan.md, write lessons, print `LESSONS_FILE=implementations-plan/send-fee-privacy-notice/lessons/phase-N.md`, advance.
7. All phases ✓? Follow plan.md § Post-implementation: no `/code-review` (it is off). Codex audit (`/codex high`: net diff from b0ebbb40, adversarial/privacy ask, the plan's no-over-engineering + comment-quality rules) → apply accepted fixes, commit, RESUME the same session with the fix diff → repeat until nothing material (3 rounds still churning → surface and stop). Then `bun run audit:vue`, then Delivery: `gh pr create` to dev with the plan's title and a screenshot of the row, add the e2e labels AFTER opening, `gh pr checks --watch`. Write the wrap-up: what shipped, each debated decision with plain-language context, open items. Surface and stop.
Keep the task list current; plan.md stays the source of truth.
```
