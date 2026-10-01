---
plan: private-transfer-row
tier: mid
driver: claude-code
claude_model: opus
code_review: off
foreign_reviewer: /codex high (GPT-6 Astra)
eli5_mode: artifact
harden: not scheduled
budget: "recon: 1 agent; code-review: off; codex at high"
branch: fix/private-transfer-row (planned on worktree-private-transfer-row; P0 renames it)
worktree: a harness-created agent worktree (lessons/phase-0.md records it)
base: origin/dev @ 3452ac3b
---

# The standard Token's transfers read as the transfer row

The approval card reads a token transfer as three rows, From, To and Amount in the token's units,
but only when the call's interface spells the wallet's transfer signature. The standard Token
(aztec-standards 6.0.0-rc.1, the token every e2e and the playground use) names its authwit nonce
`_nonce` where the wallet's vocabulary expects `authwit_nonce`, so all four of its transfers fall to
the decoded rows: `from`, `to`, `amount` in base units, and a 32-byte `_nonce`. The wallet's own
transfer matching already accepts `_nonce`; the card's check never learned it. This plan gives both
one list of names, so the four transfers read as the transfer row on a registered token, in the
transaction payload, in an authorization request and in a discovered authorization.

Both plan audits found that the row, once widened, would believe two things a dApp controls: which
function the call runs, taken from an interface the dApp may have registered (Facts 15, 20), and
the row's title, taken from the dApp's own label (Fact 21). So the row first learns to check the
call's selector against the selector its own signature hashes to, and its title comes from the
function that check confirmed. Last, the row the alias would expose: a random authwit nonce, which
today prints as one number of up to 77 digits clipped at the card's edge, reads like the card's
other 32-byte values. The follow-up named only `transfer_private_to_private`; the cause covers all
four transfers.

## Phase 0 (answered from the owner's standing answers; no live questions)

The ask: `implementations-plan/follow-ups.md` § Aztec V6, "The standard Token's private transfer
shows decoded rows … An owner UI call." Planned by an agent with no channel to the owner, so every
answer below comes from a standing rule or a precedent, and what only the owner can decide is an
Ask (Assumptions) or a UI ask (UI impact).

| Question | Answer and its source |
|---|---|
| Success criterion | The four standard transfers read as the transfer row on a registered token in all three card surfaces; the row and its title show only for a call whose selector is the vocabulary's own for that name; every hostile fixture keeps the decoded rows; no value is clipped. (The follow-up; the brief's security bar.) |
| Who it is for | A person approving a dApp's token transfer or authorization in the 400 × 800 approval window. |
| Scope | The four standard transfers, the row's selector check and title, and the nonce's reading. Not burns, not the commitment transfers, not how the wallet resolves an interface (A2). |
| Quality bar | Production: the card is the last thing a person reads before signing. |
| Validation layers | Lint, typecheck, unit and component tests (one in a node environment), `audit:vue`, smoke e2e, network e2e (targeted locally, the full suite in CI). No live-network layer: nothing here talks to a network. (CLAUDE.md § Quality gates; nulo-v6's Phase 0 "All four".) |
| Decisions to the owner | Every UI call (CLAUDE.md § UI changes need explicit owner sign-off); engineering forks go to codex. |
| `/code-review` | Off (the brief). |
| Claude leg | Opus 5.5 (the owner's standing rule for this repo). |
| `/harden` | Not scheduled (the brief). |
| Tier | `mid`, the owner's cap for this repo. |

### Phase 0.5 · Tier

One rubric dimension is HIGH: security sensitivity, since the card is what a person checks before
signing. Novelty is low (the vocabulary, the card and their tests exist; approval-card-decoding is
the precedent), the blast radius is one card, nothing is irreversible, nothing migrates, and the
external coupling is one parameter name and one hash function in pinned packages. One HIGH → `mid`.

## Outcome & Quality Bar

**For whom.** A person in Nulo's approval window deciding whether a dApp may move a standard token
they hold, either in a transaction (`aztec_sendTx`) or in an authorization that lets a contract move
it later (`aztec_createAuthWit`, or one the wallet discovers while estimating). Second, the
maintainer who next touches the transfer vocabulary.

**What excellent looks like.**
- The four standard transfers read From, To and Amount in the token's units ("5 TST"), exactly as
  the sample Token's transfers already do, in all three surfaces.
- The transfer row appears only when the call proves it: a token registered on this chain; a
  selector equal to the one the vocabulary's own signature for that name hashes to, so the call
  dispatches to the function that signature names; and the parameters in the wallet's order, under
  the wallet's names and kinds. Every hostile fixture keeps the contract's own rows.
- The title above a transfer or mint row names the function the call's selector runs, never the
  dApp's label for it.
- No value is clipped and no label breaks: a random authwit nonce reads as the card's other 32-byte
  values do (O2), a small one as a number.
- One list says which names the authwit nonce goes by, and one table says which selector each
  vocabulary shape dispatches on. Tests fail if either drifts from the wallet's descriptors, from
  the real hash, or from the two installed Tokens.

**What good enough looks like.** No new reading: burns and the commitment transfers keep their
decoded rows. The decoded rows themselves, and their titles, do not change. No class pinning, and no
change to how the wallet resolves an interface (A2).

## UI impact

Every row below changes what a person sees, so it needs the owner's recorded sign-off (CLAUDE.md
§ UI changes). The pictures are the real `OperationCard` and `CallArguments` rendered with the real
design CSS at the window's width, in a throwaway harness; they are on the ELI5 Artifact (Seeds).

| Surface | Before | After |
|---|---|---|
| A dApp transaction's payload: one of the four standard transfers on a registered token | `from` / `to` / `amount` in base units (`5000000`) / `_nonce` as 32-byte hex | From / To / Amount (`5 USDC`); an "Authwit nonce" row only when the nonce is not zero |
| An authorization request (`aztec_createAuthWit` call intent) for one of them | `from` / `to` / `amount` / `_nonce: 0x0f3c7a91..c07e2a` | From / To / Amount / Authwit nonce, read per O2 |
| A discovered authorization's "Show details" | the decoded rows above the Inner hash | the transfer rows above the Inner hash; a trimmed nonce (O2 b) sits right above the trimmed hash |
| A random authwit nonce in any transfer row, including the sample Token's `authwit_nonce` today | one number of up to 77 digits (76 in the picture), clipped at the card's edge; the label breaks onto two lines | per O2 |
| The title of a transfer or mint row: the payload row's title, the authorization's "Function" | the dApp's label for the call | the function the call's selector runs. The same words for an honest dApp; different only when the label lies (a request the wallet then refuses, Fact 26) or is missing |
| A registered token's transfer or mint whose selector is not the vocabulary's own for its name (an amount other than u128, a relabeled interface) | the transfer row when the parameter names and kinds fit | the decoded rows. No transfer or mint of either installed Token changes (Fact 19) |
| Burns and the three commitment transfers | decoded rows | unchanged |

### UI asks for the owner (each option shown as it will look)

Answered on 2026-10-01 (Approval): O1 yes, O2 (b), the title from the function. The as-built row
waits for P4's pictures.

- **O1.** The four standard transfers read as the transfer row (recommended, confidence high: it is
  what the sample Token's transfers already show, and the amount in the token's units is the one
  figure a person must check), or they keep the decoded rows.
- **O2.** How a random authwit nonce reads in the transfer row. (a) The whole number, wrapped over
  two lines. (b) Recommended, confidence moderate: a number below 2^64 stays a number, anything
  larger reads as the 32-byte hex trimmed like the Inner hash beside it, whole on hover. (b) keeps
  one line per value and reads a random nonce the way the decoded rows read it today. Trimmed, two
  nonces can look alike: the hover is for checking, the row for reading.

**Title (its own line in the gate).** A transfer or mint row's title names the function the call's
selector runs, not the dApp's label (recommended, confidence high: the label is free text, and a
public transfer labelled `transfer_private_to_private` reads "Transfer (private)" today, Fact 21;
the wallet then refuses to run it, Fact 26, so the lie costs a failed request, but the card should
not show it at all).

**Sign off as built (one row):** the three surfaces read alike; a shape whose selector is not the
standard one keeps its decoded rows; burns and the commitment transfers keep their decoded rows;
From and To show a saved contact as `@name` first, else one of the person's accounts by its name,
else the trimmed address (a tap shows the address); a zero nonce shows no row.

## Architecture & Implementation

### Proposed architecture

A display-only change in four modules, on the path recon mapped (`recon.md`, Reuse map):

1. The descriptors leaf (`descriptors.ts`) already accepts `_nonce` in `transfer4Predicate`. It
   becomes the owner of the list, `AUTHWIT_NONCE_NAMES`, and the predicate reads it.
2. The display vocabulary (`token-transfer-vocabulary.ts`) keeps its role lists exactly as the
   descriptors' builder emits them (`authwit_nonce`) and gains two things: `vocabularySelector`, a
   static table of the selector each of its 16 shapes dispatches on (the name over the builder's
   own parameter types: AztecAddress, u128, Field), and `abiNameFitsRole`.
3. The card's gate (`call-surface.ts` `corroborates`) requires the call's own selector to equal the
   table's entry for the decoded name and arity, then asks `abiNameFitsRole` instead of comparing
   names, and looks the kind up by the role. The transfer and mint surfaces carry the decoded name
   (`fn`), and `callName` titles them by it. `parseTransferIntent` is untouched: it reads the wire
   arguments by role position, so a `_nonce` in fourth place is read as the nonce already.
4. `CallArguments.vue` renders the nonce through a pure helper, `nonceValue`, and the existing
   `valueText` and `valueTitle` pair the decoded rows use, under O2 (b); under (a) the cell wraps
   the whole number (P2).

Nothing crosses a process or package boundary: no change to `@nulo/wallet-bridge`, the background
decode, interface resolution or any message.

### Key interfaces and contracts

```ts
// apps/extension/src/wallet/services/token/functions/descriptors.ts
/** The names the authwit nonce parameter goes by: aztec-nr's sample Token spells it `authwit_nonce`,
 *  the aztec-standards Token `_nonce`. */
export const AUTHWIT_NONCE_NAMES: readonly string[] = ["authwit_nonce", "_nonce"]

// apps/extension/src/utils/token-transfer-vocabulary.ts
/** The selector a vocabulary shape dispatches on: its name over the descriptors' own parameter
 *  types. Static because hashing needs bb.js, which the popup does not load; a node test
 *  recomputes every entry. */
export const vocabularySelector = (name: string, arity: number): string | undefined
/** Whether an interface's parameter `name` fills the vocabulary's `role`. */
export const abiNameFitsRole = (role: string, name: string): boolean =>
	name === role || (AUTHWIT_NONCE_NAMES.includes(role) && AUTHWIT_NONCE_NAMES.includes(name))

// apps/extension/src/popup/windows/execute/call-surface.ts
export type CallSurface =
	| { kind: "transfer"; fn: string; to: string; amount: string; sender: TransferSender; nonce?: string }
	| { kind: "mint"; fn: string; to: string; amount: string }
	| … // decoded, pending and raw are unchanged
/** The nonce as the raw rows read a field: its decimal below 2^64, else the 32-byte hex. */
export const nonceValue = (nonce: string): DecodedValue // under O2 (b) only
```

`CallSurface` keeps `nonce?: string`, a canonical decimal. The comments shown are the intended
ones; the codex loop judges them.

### Data and control flow

1. Unchanged: the background's `decodeCallsForDisplay` (`service.ts:632-653`) resolves the target's
   class, fetches that class's interface, and `decodeCallForDisplay` finds the function by the
   call's selector, or by name only when the call has none (`call-decoder.ts:58-62`,
   `contract-resolver.ts:64-74`).
2. The popup's `OperationCard` calls `callSurface(ctx, call, decoded, isToken(call.to))` for a
   payload (`OperationCard.vue:113`), `callSurface(undefined, …)` for an authorization request
   (`:132`) and for a discovered authorization (`:162`, with that record's selector and arguments,
   which aztec.js checked against the inner hash the person signs, Fact 22).
3. `callSurface` applies the vocabulary only when `tokenKnown && corroborates(decoded,
   call.selector)`. `corroborates` finds the role list and the table's selector by the decoded name
   and arity; requires the call's selector to be exactly that entry's string; then requires every
   parameter to fit its role by name (`abiNameFitsRole`) and by kind (`ROLE_KIND[role]`).
4. `vocabularySurface` reads the wire arguments by role position through `parseTransferIntent`,
   whose canonical checks refuse anything that is not an address or a number; a refusal falls back
   to the decoded rows. The surface carries `fn: decoded.fn`.
5. `callName` titles a decoded, transfer or mint surface by its `fn`; the dApp's label titles only a
   call still decoding or not decodable, as today. The discovered authorization's title is already
   the decoded name (`OperationCard.vue:156-159`).
6. `CallArguments.vue` renders the rows; the nonce row, when present, renders
   `nonceValue(surface.nonce)` through `valueText` and `valueTitle` under O2 (b), the whole
   number wrapped under (a).

### File-level change map

| File | Change |
|---|---|
| `apps/extension/src/wallet/services/token/functions/descriptors.ts` | M: export `AUTHWIT_NONCE_NAMES`; `transfer4Predicate` reads it; the section comment says why two names, instead of "preserved verbatim"; the header stops naming the deleted `registry-equivalence.test.ts` (Fact 17). |
| `apps/extension/src/utils/token-transfer-vocabulary.ts` | M: the selector table and `vocabularySelector` (P1); `abiNameFitsRole` (P3); a header clause for each. |
| `apps/extension/src/utils/transfer-intent.ts` | M (comment only, P3): its header says the arguments are read "by ABI parameter name"; they are read by the vocabulary's role positions, which the alias makes visibly different. |
| `apps/extension/src/popup/windows/execute/call-surface.ts` | M: `corroborates` takes the call's selector (P1) and fits names through `abiNameFitsRole`, kinds through `ROLE_KIND[role]` (P3); transfer and mint surfaces carry `fn` and `callName` uses it (P1); `nonceValue` (P2, under O2 (b)); the header and gate comments say what the gate now checks. |
| `apps/extension/src/popup/windows/execute/CallArguments.vue` | M: the nonce cell (O2, P2). |
| `apps/extension/src/utils/token-transfer-vocabulary.real.test.ts` | A (P1): node environment, nothing mocked: the table equals the real hash of every shape the descriptors' builder emits (and the mint shape); it covers exactly the vocabulary's shapes; its entries are distinct; every vocabulary function of both installed Tokens sits at its entry; the standard Token's burns and commitment transfers sit at none. P3 adds that each such function's parameter names fit the roles. |
| `apps/extension/src/utils/token-transfer-vocabulary.test.ts` | M (P3): `abiNameFitsRole`, and its parity with the descriptors' predicate. The hand-written `EXPECTED` table does not change. |
| `apps/extension/src/popup/windows/execute/call-surface.test.ts` | M: fixtures carry the table's selectors and the selector and title cases (P1); `nonceValue` (P2, under O2 (b)); the alias and its hostile cases (P3). |
| `apps/extension/src/popup/windows/execute/OperationCard.fallback.test.ts` | M (P1): its structured-row fixtures carry the table's selectors; the payload title follows the selector. No `_nonce` fixture lands here, so its `value()` helper stays. |
| `apps/extension/src/popup/windows/execute/OperationCard.createAuthwit.test.ts` | M: the selector and the Function row (P1); a random nonce's reading (P2); a third-party `from`, a two-argument intent on a registered token (P3). |
| `apps/extension/src/popup/windows/execute/OperationCard.discovered.test.ts` | M (P3): a registered standard-token authorization with a random nonce reads the transfer row; one whose selector contradicts its decoded name keeps the decoded rows. |
| `apps/extension/src/popup/windows/execute/OperationCard.wire.test.ts` | M (P3): the honest call flips to the transfer row; the four standard transfers through the real decoder; the hostile wire fixtures. |
| `apps/extension/tests/e2e/network/tx-transfer-row.test.ts` | A (P4): both dApp surfaces end to end. |
| `apps/extension/src/types/auto-imports.d.ts`, `apps/extension/src/types/.eslintrc-auto-import.json` | M (generated) when the build rewrites them: `src/utils` exports are auto-imported. |

### Algorithms and non-obvious mechanics

- **The selector pins the function, not the interface.** The decoder finds the interface
  entry whose own name and types hash to the call's selector, but an interface a dApp registered
  need not be the class's real one: its parameter names are free, its public entries are not hashed
  at all, and a private entry is bound only through its 4-byte selector (Fact 15). Integer widths
  are free in the selector preimage and unchecked by the decoder, so a 32-bit offline search can
  give one function's selector another function's name and parameters (Fact 20). The table holds
  the selector each vocabulary shape hashes to with the descriptors' own types. When the call's
  selector equals the entry for the decoded name, the selector, which is what runs, is the one the
  vocabulary's own signature produces, whatever the interface claims: a contract compiled from that
  signature runs that function there, and both installed Tokens do (Fact 19). The names and kinds
  then only confirm the role order.
- **What the gate compares.** The call's own selector, exactly the string the table holds. The
  decoder already matches selectors only by their exact lower-case spelling (Fact 23), so any other
  string spelling (upper-case digits, a `0X` prefix, no prefix, a wrong length) is undecoded
  before the gate sees it. The gate reads the wire call's own selector, so a non-string fails it
  whatever the decode request made of it: the request stringifies it (`display-calls.ts:13-26`),
  and a one-element array holding the canonical string decodes, then reads decoded. An absent
  selector fails the gate even when the decoder found the function by name. The wire's
  `FunctionCall` schema always carries a selector (Fact 23).
- **Why a static table.** Hashing needs bb.js: the popup does not load it, and jsdom cannot run it
  (recon §3). Sixteen constants recomputed by a node test from the descriptors' builder cost
  nothing at run time and fail on any drift: a new vocabulary name, a changed type, a hashing
  change in an Aztec bump.
- **The kind is looked up by the role, not the name.** `ROLE_KIND` has no `_nonce` entry; keying it
  by the parameter's name, as today, would refuse the alias with no visible reason.
- **The alias fills one role only.** `_nonce` never fills `from`, `to` or `amount`, and nothing but
  the two listed spellings fills the nonce role (`nonce`, `__nonce`, `authwitNonce` all refuse).
- **`nonceValue` formats; it says nothing about how the nonce was chosen.** `smallFieldDecimal`
  (`transfer-intent.ts:110-113`) gives the decimal below 2^64, as the raw rows read a field;
  anything else becomes `0x` + 64 hex digits. A zero never reaches it (`call-surface.ts:80` drops
  it).
- **Why the vocabulary's role lists stay `authwit_nonce`.** `parseTransferIntent` keys the nonce on
  the role name (`transfer-intent.ts:62-66`), and the hand-written table in
  `token-transfer-vocabulary.test.ts` pins every list. Renaming roles would move both for nothing.

### Trade-offs and alternatives not taken

- **B. The descriptors' predicate as the gate, run in the background** (the competing outline).
  `decodeCallsForDisplay` would run `candidatePredicate` against the decoded `FunctionAbi` and send
  a vocabulary verdict with the `DecodedCall`. Rejected: its predicates accept any integer width
  (`descriptors.ts:277-280`), and a stricter check on an interface the attacker supplied
  authenticates nothing; it would also widen `@nulo/wallet-bridge`'s `DecodedCall`
  (`packages/wallet-bridge/src/decoded-call.ts:25-27`), a cross-package wire change, and tie the
  card to future changes in the wallet's import predicates. D1.
- **C. Pin the transfer row to the standard Token's class.** Narrower than today's rule for
  `authwit_nonce` tokens, and unleashed's V6 token class is not known yet. A per-token class pin is
  amount-honesty's FU-3 (`follow-ups.md`), a feature for its own plan. D2.
- **D. A second role list per name with `_nonce`.** Doubles every four-argument signature, and
  `parseTransferIntent` would need the second name too. D3.
- **E. Rename `_nonce` to `authwit_nonce` in the decoder.** The decoded rows would stop showing the
  contract's own words, for every contract. D4.
- **F. Resolve a compiled-in class's display interface from the wallet's own copy** (the first
  codex round's suggested fix). It authenticates the whole interface, decoded rows included, but
  only for classes the wallet compiles in, and it changes interface resolution in the background
  for every known class. The selector check pins every registered token's call to the selector the
  vocabulary's own signature produces (what the token runs there is the token's: Security, residual
  risks), in the popup, with no resolution change. F would be A2's fix for the decoded rows, which
  the owner declined (D10). D7.

## Security & Adversarial Considerations

**Threat model.** A connected dApp, malicious or compromised, wants the card to read as something
other than what the call does. It chooses the call's name, selector, arguments and
`hideMsgSender`, and, if it may register contracts, the interface the wallet holds for a class
(Fact 16). A token the person registered may itself be malicious. The surface is `callSurface`'s
gate, the rows it renders and the title above them.

**What the transfer row claims, and why it is true when it shows.** From, To and Amount are the
call's first three wire arguments, read by role position and canonicalised (`parseTransferIntent`).
The row shows only if the target is a registered token on this chain, the call's selector equals the
table's entry for the decoded name and arity, and the decoded parameters fit the roles in order, by
name and kind. The selector is what runs: public dispatch and the private kernel both route on it,
so on the standard Token, and on any token whose function under that selector is the one its name
says, the call runs that transfer, whose arguments are in the role order. For an authorization
request the selector is the one the signed inner hash covers; for a discovered authorization,
aztec.js has checked the record's selector and arguments against that inner hash (Fact 22).

**What both audits broke, and what holds now.** The first draft argued that a relabeled interface
could not make the row lie, because the class id binds each function's name and types and nine
names left no room for a selector collision. Both halves were wrong. The class id binds a private
function only through its 4-byte selector, and a public interface entry not at all (Fact 15); and
integer widths are free in the selector preimage and unchecked by the decoder, so a dApp that may
register an interface can search about 2^32 widths offline for an entry that carries a transfer's
name, the transfer's parameter names and kinds, and another function's selector (Fact 20). The
standard Token offers targets: its commitment transfers take `(from, commitment, amount, _nonce)`,
whose second argument is a partial-note commitment, not an address, so relabeled they would read
"To: <commitment>". The selector check closes this for the structured rows of any token compiled
from the vocabulary's signatures: the call's selector must be the canonical one for the decoded
name, and on both installed Tokens only that function sits there (Fact 19). The check closes the
same hole for the sample Token's transfers and mints, which had it before this plan.

**The title.** Today a transfer or mint row's title is the dApp's label, so a public transfer
labelled `transfer_private_to_private` reads "Transfer (private)" over truthful rows (Fact 21). The
alias would have extended that to the standard Token, needing only the transaction capability. The
damage stops at the card: the wallet refuses to run a call whose label differs from the name its
selector resolves to (Fact 26), so the person who approves the lie gets a failed request, not a
public transfer. The card should not show it in the first place: the title now comes from the
decoded name the selector check confirmed. Through a relabeled interface the execution check and
the decoded name agree with the attacker; the selector check then refuses the structured row, and
the decoded rows' title is A2's.

**What `_nonce` is in the standard Token (Facts 4–6).** Every transfer, burn and commitment transfer
carries `#[authorize_once("from", "_nonce")]`. When `from` is the caller, the nonce must be zero or
the call fails. When it is not, a private call asks `from`'s account contract to approve the
authorization hash of (caller, selector, arguments hash), the nonce among the arguments, and pushes
a nullifier for it, so the authorization is spent once; a public call consumes the authorization in
the standard auth registry instead. Either way the nonce never changes who pays, who receives or how
much: it only tells otherwise identical authorizations apart.

**Hostile fixtures and their expected reading** (wire-shaped: `0x` + 64 hex fields):

| Fixture | Where | Expected |
|---|---|---|
| The honest call on a registered token | unit, card, e2e | transfer row, titled by the function |
| The same call on a contract not registered as a token | unit, card | decoded rows |
| A commitment transfer's (or a burn's) selector under a decoded transfer name with fitting parameters: the decoder's output for a width-searched interface | unit, card (discovered) | decoded rows |
| No selector, or a non-string one | unit | decoded rows |
| The honest call's selector spelled otherwise: upper-case digits, `0X`, no prefix, seven digits, a number, a one-element array holding the canonical string | card (real decoder) | never the transfer row: the decoder finds nothing (Fact 23); the array decodes and the gate refuses it |
| The dApp's label contradicts the selector, or is missing | unit, card (payload, authorization request) | the title names the function the selector runs |
| A non-zero `_nonce` with `from` equal to the signing account (the contract will refuse it) | unit, card | the nonce row, so the person sees it |
| `from` naming another address; another of the person's accounts; a saved contact | card (real `AddressDisplay`) | that address; the account's name; `@contact`; never "this account" |
| A four-argument `_nonce` transfer with `hideMsgSender` | unit | the explicit `from`, never the signing account |
| An authorization request whose `from`, delegate and signer are three addresses | card | From shows `from` |
| A two-argument transfer in an authorization request on a registered token | card | decoded rows: there is no caller to name |
| `_nonce` in another position, of integer kind, or spelled `nonce` | unit | decoded rows |
| The real interface with `from` and `to` relabeled (the same class) | card (real decoder) | decoded rows |
| `burn_public`, `burn_private`, the three commitment transfers | unit, card (real decoder) | decoded rows |
| Both mints and the sample Token's two-argument transfers | unit | their structured rows, unchanged |
| Lying `isStatic`, `returnType` and `returnTypes` on the wire | card | the same rows as the honest call |

**Residual risks, pre-existing and out of scope.**
- A malicious registered token: the row trusts registration (FU-3), as it does today.
- A registered token whose function under a canonical selector takes its addresses in another
  order, read through an interface a dApp relabeled to fit the roles. It needs an unconventional
  token the person chose to register and a dApp allowed to register interfaces; neither installed
  Token is shaped so.
- The decoded rows of any class, and their title, can be relabeled by an interface a dApp
  registers (A2, declined by the owner: D10).
- The simulation, profiling and utility windows title their calls by the dApp's label
  (`OperationCard.vue:450`, `:465`). Those requests submit nothing, though simulation and profiling
  build the account's payload signature internally (`view-executor.ts:318`, `:406`, through the
  account's entrypoint); their titles stay outside this plan.
- The standard Token's ARC-403 hook (`_call_auth_private`/`_public`, main.nr 525–547) calls an
  admin-set authorizer when one is configured. It is a property of the token, not of the call, and
  neither reading shows it.

**Frontend.** Every name and value still passes through `safeWire` and Vue's text interpolation;
no `v-html`. The new `title` holds only hex built from a `BigInt`, and the nonce reaching it is a
canonical decimal below the field modulus, so `BigInt` cannot throw. No new log line (CLAUDE.md
§ Logging policy).

**Supply chain, cryptography, least privilege.** No new dependency, no cryptography at run time (the
table is constants; the node test hashes with the installed stdlib), no new permission or
credential.

## Assumptions

### Facts (verified at `3452ac3b`, 2026-10-01; sources in `recon.md` or named)

1. `corroborates` compares each decoded parameter's name with the role by string equality and looks
   its kind up by that name; `ROLE_KIND` has no `_nonce` (`call-surface.ts:84-101`).
2. The vocabulary's role lists come from the descriptors' builder
   (`token-transfer-vocabulary.ts:36-50`), whose fourth parameter is always `authwit_nonce`
   (`descriptors.ts:247`, `:255`).
3. `transfer4Predicate` accepts `authwit_nonce` or `_nonce` (`descriptors.ts:279`), and any integer
   width for the amount (`:277-278`).
4. aztec-standards 6.0.0-rc.1's Token (the artifact's embedded sources,
   `target/token_contract-Token.json`, `file_map`, `main.nr`): `transfer_private_to_private`,
   `transfer_public_to_public`, `transfer_private_to_public` and `transfer_public_to_private` take
   `(from: AztecAddress, to: AztecAddress, amount: u128, _nonce: Field)`;
   `transfer_private_to_public_with_commitment` takes the same and returns a commitment;
   `transfer_private_to_commitment` and `transfer_public_to_commitment` take `(from: AztecAddress,
   commitment: Field, amount: u128, _nonce: Field)` (`main.nr` 196-215, 294-314); the burns take
   `(from, amount, _nonce)`. Each carries `#[authorize_once("from", "_nonce")]` (`main.nr` 125-138,
   148-166, 174-187, 196-215, 223-236, 270-284, 294-314, 474-493).
5. The macro (aztec-nr v6.0.0-rc.1, `macros/internals_functions_generation/external/helpers.nr`
   48-124) expands to: if `from` is not `msg_sender`, `assert_current_call_valid_authwit` in a
   private function or `assert_current_call_valid_authwit_public` in a public one; otherwise
   `assert(_nonce == 0, "Invalid authwit nonce. When 'from' and 'msg_sender' are the same, '_nonce'
   must be zero")` (lines 115-123).
6. aztec-nr `authwit/auth.nr`: the authorization is `CallAuthorization {msg_sender, selector,
   args_hash}` (204-208). The private check calls `verify_private_authwit(Field)` on `from`
   statically and pushes `compute_authwit_nullifier(on_behalf_of, inner_hash)` (273-290); the
   public check calls the standard auth registry's `consume((Field),Field)` (299-330). The
   `CallAuthorizationRequest` offchain effect (215-238) is what the wallet's authwit discovery
   reads.
7. aztec-nr's sample Token (`@aztec-labs/noir-contracts.js` 6.0.0-rc.1) spells the nonce
   `authwit_nonce` in every transfer and burn (its artifact's ABI).
8. Today all four standard transfers read as decoded rows on a registered token, and burns and the
   commitment transfers are not in the vocabulary (a throwaway probe over the installed artifact,
   deleted before the plan commit).
9. `OperationCard.wire.test.ts:83-106` pins the honest standard-Token call, on a registered token,
   as decoded with parameters `["from","to","amount","_nonce"]`; it must flip.
10. `CallArguments.vue:67-70` prints `surface.nonce` whole; at the window's 400 px
    (`dapp-interaction/service.ts:468-469`) a random nonce's 76 digits clip at the card's
    edge and the label breaks (the harness capture).
11. The e2e suite reads card rows only by count (`tx-sendTx-multicall.test.ts:66`), and no network
    spec registers the playground token before a dApp send, so no spec breaks.
12. `importTokenAndWaitForBalance` (`tests/e2e/fixtures/helpers.ts:1008-1023`),
    `mintPublicTokensForAccount` (`fixtures/aztec.ts:680`), `rejectExecute` and
    `waitForExecuteContent` (`fixtures/popups.ts:468-482`), `waitForPgResult` and the opt-in
    two-theme capture `shotSend` under `NULO_E2E_SHOT_DIR` (`fixtures/send-page.ts:209-235`) exist.
    `dappConnectedExtensionWithTransactionCap` grants the `transaction` bundle through
    `grantCapBundle` with no switches (`fixtures/extension.ts:414-433`, `:682`), which leaves the
    authorizations switch off, so a call intent opens the "Authorization" window
    (`network/authwit-variants.test.ts:104-114`).
13. The playground builds its default send as `transfer_public_to_public(from, to, amount,
    BigInt(i))` from the `tokenAddress`, `recipient` and `amount` inputs
    (`apps/playground/src/sections/transactions.ts:43-64`), and its call intent as
    `transfer_public_to_public(from, consumer, authwitAmount, authwitNonce)` on `consumer`, which
    falls back to `tokenAddress` (`apps/playground/src/sections/authwit.ts:80-112`). The e2e token
    is `TST` with 18 decimals (`tests/e2e/fixtures/aztec.ts:149-169`).
14. `src/utils` exports are auto-imported (`src/types/auto-imports.d.ts:110-111`).
15. stdlib 6.0.0-rc.1: the class id hashes the artifact hash, the private functions root and the
    public bytecode commitment; the artifact hash covers each private and utility function by its
    4-byte selector, return-type metadata and bytecode, plus the artifact's name and outputs; the
    private functions root leaves are (selector, verification-key hash); a selector is a 4-byte
    Poseidon2 hash of `name(types)` (`contract/artifact_hash.js:55-117`,
    `contract/contract_class_id.js:19-36`, `contract/contract_class.js:29-33`,
    `abi/function_selector.js:40-49`). No parameter name and no public interface entry is hashed.
16. Both registration paths accept a dApp-supplied interface when it hashes to the instance's class
    (`service.ts:815-851`, `register_contract`; `:956-997`, `aztec_registerContract`), and
    interface resolution tries the PXE's own copy before the compiled-in one
    (`packages/aztec-runtime/src/pxe/artifact-registry.ts:33-35`, `:159-175`).
17. `descriptors.ts`'s header (`:6-11`) says each entry reproduces its original module verbatim,
    pinned by `token-functions.characterization.test.ts`; it also names a
    `registry-equivalence.test.ts` that no longer exists. No unit test reaches the predicate's
    `_nonce` branch except through the real interface (`descriptors-real-artifact.test.ts:48-63`).
18. aztec.js 6.0.0-rc.1's fee payment methods authorize the FPC's token pull with a random nonce:
    the private one `transfer_to_public(from, fpc, maxFee, Fr.random())` (`@aztec-labs/aztec.js`
    `dest/fee/private_fee_payment_method.js:84-100`), the public one `transfer_in_public(…,
    Fr.random())` through the auth registry (`public_fee_payment_method.js:77-93`). On a registered
    sample Token the private one's authorization already reads as the transfer row, so the clipped
    nonce of Fact 10 ships today.
19. The vocabulary's 16 shapes hash to 16 distinct selectors with the descriptors' own types; among
    them `transfer_private_to_private/4` `0xedc09d49`, `transfer_public_to_public/4` `0xc47adea0`,
    `transfer_private_to_public/4` `0xaf28c76f`, `transfer_public_to_private/4` `0x32c5dcf8`,
    `mint_to_private/2` `0xf8f84119`, `mint_to_public/2` `0x451b5fae`. Every vocabulary function of
    both installed Tokens sits at its shape's selector; the standard Token's burns and commitment
    transfers sit at none of them (`0xc282ed79`, `0xc611b0c5`, `0x638d3f00`, `0xd427610c`,
    `0x398c27b4`). (A throwaway node probe over the descriptors' builder and both artifacts; P1
    commits it as `token-transfer-vocabulary.real.test.ts`.)
20. stdlib 6.0.0-rc.1 accepts any integer width in an interface (`abi/abi.js:59-61`), writes the
    width into the selector preimage (`abi/function_signature_decoder.js:22-23`), and decodes an
    unsigned integer without checking it (`abi/decoder.js:20-27`); the card's decode maps every
    integer to the kind `integer` (`call-decoder.ts:98`).
21. `callName` titles a transfer or mint surface by the dApp's label, `call.name ?? call.selector`
    (`call-surface.ts:124-129`); the payload row and the authorization request's "Function" row
    render it (`OperationCard.vue:225`, `:498`); a discovered authorization's title is the decoded
    name (`:156-159`). The wire `name` is free text (stdlib `abi/function_call.js:40-48`).
22. A discovered authorization's selector and arguments come from a `CallAuthorizationRequest` that
    aztec.js validates against its args hash and inner hash before the wallet keeps it (`@aztec-labs/aztec.js`
    `dest/authorization/call_authorization_request.js`, `validate` and `fromFields`;
    `authwit-discoverer.ts:122-133`, `discovered-authwit.ts`).
23. The decoder resolves a function by the call's selector, and by name only when the call carries
    none (`call-decoder.ts:58-62`); it matches a selector only by its exact lower-case spelling, as
    `FunctionSelector.toString()` prints it (`contract-resolver.ts:63-72`); the wire's
    `FunctionCall` schema requires a selector (stdlib `abi/function_call.js:40-48`).
24. `tx-sendTx-default.test.ts` is one of the four prover-ON canary files, whose test inventory
    `scripts/ci-cd/canary-expectations.json` pins exactly.
25. The network e2e config retries twice unless `NULO_E2E_RETRY` is set
    (`apps/extension/vitest.e2e.network.config.ts:46`); `tx-sendTx-delegated-authwit.test.ts` skips
    on the local sandbox (`:38-39`).
26. The wallet binds a dApp's label to the selector before it runs anything: an `aztec_sendTx` call
    becomes an `encoded_call` carrying its `name` (`operation-planner.ts:204-215`; the schema
    requires one), and the builder refuses it with "Scope violation" when that name differs from
    the function its selector resolves to in the interface the PXE holds
    (`tx-request-builder.ts:587-600`; likewise `:340-345` for a no-account call). A call intent is
    refused the same way when it carries a label (`service.ts:1049-1056`).

### Inferences (unverified; each is checked where named)

- **I1.** On the honest path, the production chain (PXE instance, then the class's interface, then
  the decode) hands the popup the standard interface for a standard-Token instance, as the wire test
  assumes. P4's network spec proves that path. It does not prove which interface wins against one a
  dApp registered (A2); the selector check makes that irrelevant to the structured rows.
- **I2 (nonessential).** Real dApps that pull standard tokens send random nonces, so O2's case is
  common. Neither the nonce fix nor the alias depends on it: D5 rests on Fact 18.
- **I3 (nonessential).** unleashed's V6 Test USDC, the wallet's future default token, is an
  aztec-standards Token, so this change is what makes it read cleanly. Confidence moderate; arc C
  is pending.
- **I4 (found on the way, out of scope).** The playground's multicall numbers its nonces 0 to N−1
  with `from` equal to the caller, so by Fact 5 every call after the first fails in public
  execution; `tx-sendTx-multicall.test.ts` stops at `proving` and never sees it. Confidence high
  from the macro; not run.

### Asks

- **A1 (the owner, UI).** O1, O2, the title line and the as-built row (UI impact). Answered:
  O1 yes, O2 (b), the title from the function (Approval); the as-built row is signed off from
  P4's pictures.
- **A2 (the owner, scope).** The decoded rows' relabel vector. With the selector check, an interface
  a dApp registers can no longer put the transfer or mint row on a function its signature does not
  name (Security keeps one contrived residual case); it can still rename the decoded
  rows of any class whose interface it may register, and their title, the standard Token's burns
  and commitment transfers included (Facts 15, 16, 20). The fix is F (Trade-offs): resolve a
  compiled-in class's display interface from the wallet's own copy (the `byClassId` seam exists,
  recon row 10). Declined by the owner (Approval, D10): not in this plan and not filed as a
  follow-up, to revisit only when someone asks. This plan leaves the decoded rows exactly as they
  are today.

### Plan audit ledger

**codex, round 1** (GPT-6 Astra, `high`, read-only): *"reject (with blocking findings: 1 and 2)"*.

| # | Finding (severity) | Disposition |
|---|---|---|
| 1 | High: the collision argument is false; integer widths are free in the selector preimage and unchecked by the decoder, so a 32-bit search can relabel a function | **Accepted**, verified (Fact 20). Fixed by the selector check (D7), not codex's suggested known-first resolution (F): the check pins every registered token's call to the selector the vocabulary's own signature produces, popup-side; F stays A2's fix for the decoded rows. The impossibility claim is gone. |
| 2 | High: a structured row's title is the dApp's label | **Accepted**, verified (Fact 21); pre-existing for the sample Token's rows. Transfer and mint surfaces carry the confirmed name; tests feed contradictory and absent labels; a UI-impact row and a gate line (D8). |
| 3 | Medium: hostile-matrix gaps | **Accepted** but one item: `hideMsgSender` on a four-argument transfer, an owned account and a contact as `from` with the real `AddressDisplay`, mints and two-argument controls, three distinct addresses in an authorization request, a two-argument intent on a registered token, a registered discovered authorization with a random nonce. **Rejected:** "an undecoded authorization of more than 32 fields discloses every field": that path (`OperationCard.vue:161-168`, raw rows with no cap) is untouched here, and the Opus leg found nothing to add there either; Follow-ups records the gap. |
| 4 | Low: `nonceValue`'s contract claims more than its rule | **Accepted:** described as formatting only; tests add the largest field and two nonces that trim alike with distinct titles. |
| 5 | Medium: the authwit facts generalize the private path; the commitment shapes were conflated | **Accepted:** Facts 4-6 separate the private and public checks and the three shapes. |
| 6 | Medium: P4 cannot prove I1 as written | **Accepted:** I1 narrowed to the honest path; the adversarial case is the selector check's unit and card tests; I2 and I3 marked nonessential. |
| 7 | Medium: the sign-off misdescribes address labels, omits the title, frames A2 wrongly | **Accepted:** contacts first in the as-built row; the title line; A2 now covers the decoded rows only, the structured rows being closed here. |
| 8 | Medium: the network test's setup and assertions are underspecified | **Accepted:** P4 names the fixture, the mint, the import wait, the inputs and exact amount, the decode wait, the nonce title, the rejection's result and the timeout. |
| 9 | Medium: retry-0 not wired; `typecheck:all`; `build-storybook`; `lint:actions` | **Accepted:** `NULO_E2E_RETRY=0` (Fact 25), `typecheck:all` in every gate, `build-storybook` in P2, `test:all` and `lint:actions` before the push. |
| R | Recon: "headers do not change" is wrong | **Accepted:** `recon.md` §2 and the reuse map corrected. |

**Opus 5.5, round 1** (the same-family leg, read-only): *"conditional approve (with conditions: (1) S1
… callName uses it, with a lying-name fixture and a UI-impact row plus approval line for the owner;
(2) S2: correct the 'never lie', 'no search space' and 'selector binds every parameter type' claims
and widen A2 to the transfer-row collision vector, selector pin optional; (3) C1: move the wire-test
flip into P1 and widen P1's gate …; (4) C2/C3: respecify P4's e2e as one test on
dappConnectedExtensionWithTransactionCap with the playground inputs, run under NULO_E2E_RETRY=0;
(5) S3: a discovered-authorization component test of a _nonce transfer with a 254-bit nonce; (6) C4:
delete the untracked probe and capture harness before P0)"*.

| # | Finding (severity) | Disposition |
|---|---|---|
| S1 | High: the title follows the dApp's label | **Accepted**; the same as codex 2. |
| S2 | Medium: no collision bound; the selector pin optional | **Accepted, and the pin adopted** rather than left optional: codex rated the same finding blocking, and the pin is 16 constants and one node test (D7, D9). With the pin, A2 narrows to the decoded rows, instead of widening. |
| S3 | Medium: no discovered-surface fixture | **Accepted:** P3 adds it, with a 254-bit nonce, and a contradicting-selector twin. |
| S4 | Low: fixture gaps (`hideMsgSender`, owned account, contacts) | **Accepted.** Its view that a signer other than `from` needs no fixture is overruled by codex 3: one assertion, cheap. |
| C1 | Medium: the wire test's flip lands after a gate that runs it | **Accepted:** the same as self-found S1, fixed after its brief went out. The flip now lands with the alias (P3), whose gate runs it, and P1 changes no reading of that call. |
| C2 | Medium: P4's second test could not open the window (`dappConnectedExtensionPerTest` grants nothing; the inputs) | **Accepted:** one test on `dappConnectedExtensionWithTransactionCap`, both surfaces in turn, the playground inputs set (Fact 13). |
| C3 | Low: retry-0; trim the local network list | **Accepted:** `NULO_E2E_RETRY=0`; the list drops `tx-sendTx-delegated-authwit` (skips locally) and `tx-sendTx-default` (the canary; CI runs it). |
| C4 | Low: delete the probe and the harness before the plan commit | **Accepted.** |
| C5 | Low: derive the nonce role from the list; stale comments | **Accepted:** `abiNameFitsRole` reads the list for both sides; `transfer-intent.ts`'s header and `call-surface.ts`'s gate comments are corrected in the phases that change their meaning. |
| C6 | Low: the node decode test is optional | **Accepted:** the planned `call-surface.real.test.ts` is dropped. The node file that stays pins the table against the real hash and both Tokens; the jsdom wire test runs all four standard transfers and the burns and commitment transfers through the real decoder. |
| R1, R2 | Recon misses `callName`; the fallback helper | **Accepted** (recon corrected); no `_nonce` fixture lands in the fallback file. |

**Self-found.** S1: as first drafted, P1 would have broken the wire test's pin while its gate ran a
later phase's files. S2: D6's file choice is forced: `tx-sendTx-default.test.ts`'s inventory is
pinned by the canary job (Fact 24). S3, found after the final pass was launched: the wallet already
refuses to run a call whose label differs from its selector's function (Fact 26), so codex 2 and
Opus S1 cost the person a failed request, not a public transfer. D8 stands: the card must not show
the lie, and the fix is one field.

**codex, final pass** (GPT-6 Astra, `high`, a fresh read-only session over this ledger and the
whole packet): *"conditional approve (with conditions: correct findings 1–4 in the plan and tests,
and make both O2 choices executable as specified in finding 5)"*. It found no High-severity bypass
of the revised gate against either installed Token, and judged the static table a reasonable
minimal design and every earlier disposition sound.

| # | Finding (severity) | Disposition |
|---|---|---|
| 1 | Medium: "simulation and profiling sign nothing" is false; their standard path builds the account's payload signature (`view-executor.ts:318`, `:406`) | **Accepted**, verified: the residual line now says they submit nothing but sign internally, and keeps their titles out of scope on that ground. |
| 2 | Low: selector spelling. The decoder matches exact lower-case strings (`contract-resolver.ts:63-72`), so a case-blind gate claims an end-to-end tolerance that does not exist | **Accepted**, verified: the gate compares the exact string; the unit case for upper case is gone; P3's wire test gains one parameterized case over the other spellings through the real display path. |
| 3 | Low: Fact 18 named one fee method's function for both; "anyone can complete" a commitment | **Accepted:** Fact 18 separates `transfer_to_public` (private) and `transfer_in_public` (public); the commitment wording had already been corrected while the pass ran. |
| 4 | Low: universal claims ("authenticates the function for every registered token", "no honest call reads differently") exceed the qualified argument | **Accepted:** the check is described as pinning the call to the vocabulary signature's selector, with what a token runs there left to the token; P1's claim is limited to the installed Tokens. |
| 5 | Medium: O2 (a) could not be built as the phases read | **Accepted:** P2 and P3's discovered test branch on the recorded O2 answer, each branch with its own code and tests. |

All five conditions are met in this revision.

**codex, confirming round** (the same session, resumed on the diff of those edits): *"approve"*.
It found every condition met, citing the plan's lines, and no new bypass on either installed
Token. Its three Low wording notes were taken: a non-string selector fails the gate whatever
its decode request made of it (a one-element array holding the canonical string decodes; the
card case now includes it); Architecture and Data flow say `nonceValue` is O2 (b)'s; P1's
unchanged-reading claim is about honest calls, since a lying label's title changes by design.

### Decision ledger

| # | Decision | Alternatives rejected and why |
|---|---|---|
| D1 | One list (`AUTHWIT_NONCE_NAMES`) in the descriptors leaf, read by `transfer4Predicate` and, through `abiNameFitsRole`, by the card's gate. | B: the background runs the descriptors' predicate and sends a verdict. Its predicates accept any integer width, and checking an interface the attacker supplied authenticates nothing; it would also widen `DecodedCall` across packages and tie the card to the import predicates. |
| D2 | No class pin. | C: narrower than today's rule, and the V6 token's class is unknown; FU-3 owns per-token pins. |
| D3 | Role lists stay `authwit_nonce`; names fit roles through one predicate. | D: a second role list per name doubles the signatures and `parseTransferIntent`'s nonce key. |
| D4 | The decoded rows keep the contract's own names. | E: renaming in the decoder makes every decoded row speak the wallet's words, not the contract's. |
| D5 | The nonce fix ships with the alias. | Shipping the alias alone turns every standard-Token authorization's readable `_nonce` row into a clipped number of up to 77 digits (Fact 10). |
| D6 | One new network spec, one test, two rejections before proving. | No e2e: nothing would prove the honest production chain (I1). A test in `tx-sendTx-default.test.ts`: its inventory is pinned by the canary job (Fact 24). Two tests: two fresh browsers, grants and imports for one more assertion block. |
| D7 | The structured rows require the call's selector to equal the vocabulary's own for the decoded name. | F, known-first resolution: compiled-in classes only, and a background resolution change (A2). Stricter type checks on the decoded parameters: the popup receives no widths, and a check on a supplied interface authenticates nothing. Leaving the hole: both audits rated it a blocker or a condition. |
| D8 | A transfer or mint row's title comes from the confirmed decoded name. | Keep the dApp's label: it lies on request, and the alias would extend that to the standard Token (Fact 21). |
| D9 | The selector table is static in the popup bundle, recomputed by a node test. | Hash in the popup: bb.js in the popup bundle, and jsdom cannot run it. The background sends the canonical selector: the wire change D1 rejects. |
| D10 | A2, the decoded rows' relabel vector, is neither fixed nor filed (the owner, 2026-10-01: "Very niche case. let's get to it when somebody asks for it."). | F in this plan, or a follow-up entry: both declined by the owner. |

### Follow-ups (opened at close-out, not before)

- I4, the playground's multicall nonces, if the owner wants it tracked.
- A test that an undecoded discovered authorization of more than 32 fields lists every field (the
  untouched raw path), if the owner wants it tracked.

## Approval

Approved by the owner on 2026-10-01, relayed by the coordinating session. The owner's message,
verbatim:

> "01 yes, 02 b, T from the function the call runs. A2: Don't add as follow-up, but do not
> implement either. Very niche case. let's get to it when somebody asks for it."

Read as: O1 yes; O2 (b), the trimmed hex with the whole value on hover; T yes, a transfer or mint
row's title names the function the selector runs; A2 declined outright, neither in this plan nor
in `follow-ups.md`, to revisit only when someone asks (D10). The as-built row and the verdict
line were not answered separately: the as-built sign-off comes from P4's pictures, before any PR.

The gate as it was put to the owner:

```
private-transfer-row (mid), as planned in implementations-plan/private-transfer-row/plan.md
O1  standard Token transfers read as the transfer row:        yes | no
O2  a random authwit nonce:                                   (b) trimmed hex, whole on hover | (a) whole number, wrapped
T   a transfer or mint row's title names the function the selector runs:   yes | no
As built: surfaces alike, non-standard shapes and burns/commitments decoded, contacts first:   sign off | object (what)
A2  decoded-row relabel vector:                               follow-up | in this plan
Verdict: approve | conditional approve (conditions: …) | reject (blocking: …)
```

The approval covers the scope and exclusions in "Good enough", the `mid` tier, the gates below, and
the single-PR delivery. `/harden` is not scheduled.

## Phases

Phase gates go green strictly in order, and no gate carries a permitted failure. On a shared host,
run each e2e suite under the host's e2e lock, one suite at a time; local runs claim ports through
`~/.agents/ports.md` and reap only what they own (AGENTS.md § Run isolation). Unit and component
runs use the workspace scripts, never `bunx`.

### P0 · The plan in the tree ✓

1. `git branch -m fix/private-transfer-row`; confirm `git status` is clean and `HEAD` is the
   approved plan commit.
2. `bun install --frozen-lockfile` at the root.
3. `git fetch origin dev`; if `dev` moved past `3452ac3b`, merge it (signed, no fast-forward) and
   re-check Facts 1, 2, 9, 10, 19 and 21 against the merged tree. Record the result.
4. Write the approval's answers into this plan (Approval, the UI asks) and `lessons/phase-0.md`.
- **Validation gate.** `bun scripts/ci-cd/plans/check.ts` and `bun run lint`, both exit 0. Layers:
  lint.

### P1 · The vocabulary row answers to the selector ✓

No honest call of either installed Token reads differently after this phase (Fact 19); a call
whose label lies is titled by its function instead, and a token whose transfer takes another
amount type loses the row, as UI impact says. It closes the relabel and title holes for the rows
that exist today (the sample Token's transfers and both mints).

1. `token-transfer-vocabulary.ts`: the table of 16 selectors (Fact 19) and `vocabularySelector`.
2. `call-surface.ts`: `corroborates(decoded, selector)` requires `vocabularySelector`'s entry and a
   selector that is exactly that string; the transfer and mint surfaces carry `fn`; `callName`
   titles them by it; the module header and the gate's comment say what the gate checks.
3. Tests, inline:
   - `token-transfer-vocabulary.real.test.ts` (new, `// @vitest-environment node` on line 1, after
     `authwit-discoverer.real.test.ts`; nothing mocked): every entry equals
     `FunctionSelector.fromNameAndParameters` over the descriptors' builder's parameters (the mint
     shape built from the same address and u128 parameters); the table's keys are exactly the
     vocabulary's `(name, arity)` pairs; the 16 entries are distinct; every function of the
     standard and sample Tokens whose name and arity are in the vocabulary has its entry as its
     selector; the standard Token's burns and commitment transfers have none.
   - `call-surface.test.ts`: existing structured fixtures carry their table selector; then a
     commitment transfer's selector under a decoded `transfer_public_to_public`, a burn's under a
     decoded `transfer_in_public`, no selector and a non-string one all read decoded; `callName`
     on a transfer surface whose label is `transfer_in_private` or absent names
     `transfer_in_public`'s function; both mints and the two-argument transfers stay structured.
   - `OperationCard.fallback.test.ts`: its structured fixtures carry their selectors; one payload
     whose label lies is titled by the function.
   - `OperationCard.createAuthwit.test.ts`: its structured fixture carries `0xd73354bc`; the
     Function row names the function when the label lies or is absent.
- **Validation gate.** `bun run --cwd apps/extension test src/utils src/popup/windows/execute
  src/wallet/services/token/functions`, `bun run typecheck:all`, `bun run lint`: all exit 0.
  Layers: typecheck · lint · unit · component.

### P2 · The nonce reads like the card's other fields ✓

Build the O2 answer the approval records, and only that one.

- **Under (b), trimmed hex:**
  1. `call-surface.ts`: `nonceValue`.
  2. `CallArguments.vue`: the nonce cell renders `valueText(nonceValue(n))` with `:mono` on a field
     and `:title="valueTitle(…)"`, through a computed in the script block.
  3. Tests: `call-surface.test.ts` reads `9`, `2^64 − 1` and `2^64` (the first field) correctly,
     the largest field (the modulus − 1) with its whole hex as the title, and two nonces that share
     their first ten and last six characters as identical text with distinct whole-hex titles;
     `OperationCard.createAuthwit.test.ts` gains one wire-shaped authorization with a 254-bit nonce
     that reads `0x0f3c7a91..c07e2a` with the whole hex as its title.
- **Under (a), the whole number, wrapped:**
  1. No helper.
  2. `CallArguments.vue`: the nonce cell gets `word-break: break-all` and its label
     `white-space: nowrap`, through the component's CSS module.
  3. Tests: `OperationCard.createAuthwit.test.ts` gains one wire-shaped authorization with a
     254-bit nonce whose row holds the whole decimal, with the cell's and the label's classes.
- Either way, `OperationCard.createAuthwit.test.ts`'s existing small-nonce assertion stays.
- **Validation gate.** `bun run --cwd apps/extension test src/popup/windows/execute`,
  `bun run typecheck:all`, `bun run lint`, `bun run --cwd apps/extension build-storybook`: all exit
  0. Layers: typecheck · lint · unit · component · build.

### P3 · The standard Token's transfers read as the transfer row

Every value that goes through the real decoder is field-valid (`0x00` + 62 hex digits): `Fr`
refuses a value at or above the modulus, and the decode would fall to the raw fields for the wrong
reason.

1. `descriptors.ts`: `AUTHWIT_NONCE_NAMES`; `transfer4Predicate` reads it, accepting exactly the
   same two names as today, so `token-functions.characterization.test.ts` and its snapshot stay
   unchanged; the section comment says why two names; the header stops naming the deleted
   `registry-equivalence.test.ts` (Fact 17).
2. `token-transfer-vocabulary.ts`: `abiNameFitsRole`. `call-surface.ts`: `corroborates` asks
   `abiNameFitsRole(roles[i], p.name)` and `ROLE_KIND[roles[i]]`. `transfer-intent.ts`: its header
   says the arguments are read by the vocabulary's role positions.
3. Tests, inline:
   - `token-transfer-vocabulary.test.ts`: both spellings fill the nonce role and no other; `nonce`,
     `__nonce` and `authwitNonce` fill none; for each name in a probe list (`authwit_nonce`,
     `_nonce`, `nonce`, `authwitNonce`), the transfer descriptors' four-argument
     `candidatePredicate` and `abiNameFitsRole` agree (the first unit test of the predicate's
     `_nonce` branch).
   - `token-transfer-vocabulary.real.test.ts`: each vocabulary function of both installed Tokens
     has parameter names that fit its roles.
   - `call-surface.test.ts` (decoded fixtures, wire-shaped arguments, table selectors; its
     `value()` helper maps `_nonce` to the field kind too): each of the four standard names with
     `_nonce` reads as the transfer row, the sender explicit, a zero nonce absent and a non-zero one
     present; with `hideMsgSender` the sender stays the explicit `from`; then decoded rows for: an
     unregistered contract, `_nonce` in third place, `_nonce` of integer kind, `nonce`, a
     two-argument call with `_nonce`, `burn_public` and
     `transfer_private_to_public_with_commitment`.
   - `OperationCard.wire.test.ts` (jsdom, the real standard interface; its selector stand-in maps
     each of the four transfers to its table entry and each burn and commitment transfer to its
     Fact 19 selector): the pin of Fact 9 flips; each honest transfer reads
     `data-intent-kind="transfer"`, titled by its function, sender `explicit`, the amount in the
     token's units, no nonce row; the burns and commitment transfers keep decoded rows; the same
     call with `tokens: []` keeps decoded `["from","to","amount","_nonce"]`; a non-zero `_nonce`
     with `from` equal to the account shows the nonce row; with the store's accounts and the
     contact lookup mocked per case, `from` naming another address, another account and a saved
     contact shows the address, the account's name and `@name`; the real interface with `from` and
     `to` relabeled keeps decoded rows; the lying-metadata copy renders the same rows; and one
     parameterized case: the honest call with its selector spelled with upper-case digits, a `0X`
     prefix, no prefix, seven digits, as a number, or as a one-element array holding the
     canonical string never reads the transfer row (the array reads decoded).
   - `OperationCard.discovered.test.ts`: on a registered token, a `transfer_private_to_public`
     authorization (`0xaf28c76f`, decoded with `_nonce`, a 254-bit nonce) opens to the transfer row
     with an explicit sender, the nonce read per O2 ((b): trimmed, titled by its whole hex; (a): the
     whole decimal), and the Inner hash below; a twin whose selector is
     `transfer_private_to_commitment`'s (`0x638d3f00`) under the same decode keeps decoded rows.
   - `OperationCard.createAuthwit.test.ts`: a standard `transfer_public_to_public` intent whose
     `from`, delegate and signer are three addresses shows `from` as the sender; a two-argument
     `transfer(to, amount)` intent on a registered token, fully decoded with its table selector,
     keeps decoded rows and no sender row.
- **Validation gate.** `bun run --cwd apps/extension test src/utils src/popup/windows/execute
  src/wallet/services/token/functions`, `bun run typecheck:all`, `bun run lint`, then
  `bun run audit:vue` at the root (alone, never beside an e2e run): all exit 0. If the build rewrote
  `src/types/auto-imports.d.ts`, commit it. Layers: typecheck · lint · unit · component · build.

### P4 · End to end, the as-built pictures, and the owner's sign-off

1. `tests/e2e/network/tx-transfer-row.test.ts`: one test on
   `dappConnectedExtensionWithTransactionCap`, by testid only, timeout 360 s:
   - `mintPublicTokensForAccount` for the fixture's account; open the wallet popup and
     `importTokenAndWaitForBalance` the playground token (`100000000000000000000` public), so the
     window's token list holds it.
   - Transaction: set `pg-input-tokenAddress`, `pg-input-recipient` (the sandbox minter) and
     `pg-input-amount` = `5000000000000000000`; press `pg-btn-sendTx-default`; `waitForExecuteContent`;
     wait for `execute-op-payload-row` with `data-intent-kind="transfer"` (the decode lands after the
     window opens); assert the row's title "Transfer (public)", `execute-op-transfer-sender`
     `data-sender-kind="explicit"`, `execute-op-amount` reading `5 TST`, no
     `execute-op-transfer-nonce`; `shotSend(execPopup, "transfer-row-send",
     "execute-op-structured-args")`; `rejectExecute`; the playground's `sendTx` result has status
     `error`.
   - Authorization: set `pg-input-authwitAmount` = `5000000000000000000` and `pg-input-authwitNonce`
     = a fixed 254-bit field; press `pg-btn-createAuthWit-callIntent`; the window's title is
     "Authorization"; wait for `execute-authwit-structured-args`; assert `execute-authwit-function`
     "Transfer (public)", the explicit sender, `5 TST`, and `execute-authwit-transfer-nonce` reading
     the trimmed hex with the whole hex as its title (under O2 (a), the whole number);
     `shotSend`; `rejectExecute`; the `createAuthWit` result has status `error`.
2. Smoke, Chrome: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_TOKEN_SEEDS=1
   VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome`, then
   `NULO_E2E_MIGRATION_FIXTURE=1 NULO_E2E_BROWSER=chrome bun run --cwd apps/extension test:e2e
   --retry=0`.
3. Network, targeted: `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_RETRY=0
   NULO_E2E_SHOT_DIR=<a scratch dir> bun run e2e:agent tests/e2e/network/tx-transfer-row.test.ts
   tests/e2e/network/authwit-variants.test.ts tests/e2e/network/tx-sendTx-multicall.test.ts` (the
   `NODE_OPTIONS` setting is needed on hosts whose localhost resolves to IPv6 first). CI runs the
   rest, the canary included.
4. Publish the pictures (both themes) on an Artifact and ask the owner to sign off the as-built
   row. Quote the sign-off in this plan (UI impact) and in the PR body.
- **Validation gate.** Steps 2 and 3 exit 0 with their retry-0 tallies and the SHA they ran on
  quoted in `lessons/phase-4.md`; the owner's sign-off quoted here. Layers: e2e ·
  e2e-live-network (local sandbox).

### P5 · Close-out (the PR's final commits, after `gh pr create`)

1. An `## Outcome` block directly after the front matter: the date, the status, what shipped with
   the PR number, what was dropped and why, the owner's quoted sign-off, and a line retiring the
   seeds below.
2. `implementations-plan/lessons.md`: promote only a gotcha that would bite a different task, one
   line linking `lessons/`, within its 8 KiB budget (prune what it supersedes). One candidate: an
   interface a dApp registers binds a function only through a 32-bit selector, so a display rule
   keyed on decoded names needs the selector checked too.
3. `implementations-plan/follow-ups.md`: delete the "standard Token's private transfer" entry under
   § Aztec V6; add the entries in Follow-ups above that the owner kept, each one line with its
   evidence. Reconcile the file against `origin/dev` first: another branch may be editing § Aztec V6.
4. `implementations-plan/index.md`: this plan's line reads `closed, awaiting archive` (the archive
   move waits for the archive split, CLAUDE.md § Implementation plans).
- **Validation gate.** `bun scripts/ci-cd/plans/check.ts` and `bun run lint` exit 0, and
  `git show --stat` of the close-out commit is quoted in the transcript. Layers: lint.

## Post-implementation (read by the implementing session)

1. **No `/code-review`.** `code_review` is `off`; do not add a review pass.
2. **Codex audit**, after P4's gate and before any PR: `/codex high` on the net diff from the plan
   commit, with this plan, the decision ledger, an explicit adversarial and security ask ("What
   could go wrong? What would an attacker target? What are we trusting that we shouldn't?"), and
   both rules below, verbatim:
   - *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions,
     extra configuration surface, new layers, or rewrites — the smallest change that fixes each
     real problem. If code works and is clear, leave it alone."*
   - *"Audit the comments for value per character. Flag any comment that narrates what the code
     visibly does, restates its line, references implementation plans / phases / reviews, or
     spends a paragraph where a sentence works — and flag places where a non-obvious invariant or
     constraint deserves a comment it doesn't have. Comments are permanent context every future
     reader, human or LLM, pays to re-read: they must be few, dense, and exact."*
3. **Fix loop.** Check each finding against the tree before acting; apply the accepted ones,
   commit, log the round (consult and verdict) in `lessons/post-impl.md`, then resume the same
   codex session with the fix diff and both rules again. Stop when a round yields no new material
   finding. Still finding material problems after three rounds: stop and surface it.
4. **Gates after the loop.** `bun run audit:vue` and `bun run test:all` at the root (one at a
   time), `bun run lint:actions`, and re-run P4's e2e commands if any popup, service or test file
   changed after their last run. Push the branch.
5. **Delivery** (below), the first time any PR is opened.
6. **Close-out** (P5) as the PR's final commits, pushed; then `gh pr checks --watch`, the report,
   and stop. Merging is the owner's call; the merge completes the plan. Afterwards suggest
   `agent-worktree done` only if this worktree is registered (P0 records whether it is).

## Delivery

- **One arc, one PR into `dev`**, from `fix/private-transfer-row`, opened with `gh pr create` only
  after the codex loop converged and the step 4 gates passed. Title (at most 93 characters):
  `fix(execute): read the standard token's transfers as transfer rows`. The body carries the
  owner's sign-off, the as-built pictures' Artifact link, and the codex verdict.
- `/code-review`: off.
- The close-out (P5) lands as the PR's final commits, so the merge that lands the change closes
  the plan.
- Never `--admin`; the PR merges with the repo's squash default when the owner merges it.

## Seeds

ELI5: Artifact `https://claude.ai/artifact/Tmx577S9ouagStPoKx4R89` · source
`implementations-plan/private-transfer-row/eli5.html`, gitignored (redeploy the same path to
update).

Recommended: `/goal` (every completion signal is visible in the transcript). Use exactly one per
session; they do not compose.

```
/goal All phases P0–P5 marked ✓ in implementations-plan/private-transfer-row/plan.md (the per-phase headers in the file, not the chat or the task list), each ✓ backed by that phase's validation gate as written in plan.md reported passing in the transcript, e2e runs quoted with their retry-0 tallies and the SHA they ran on; `LESSONS_FILE=implementations-plan/private-transfer-row/lessons/phase-N.md` printed for each phase; `/code-review` was NOT run (plan.md says code_review: off); the codex fix loop converged on the whole diff, evidenced by a resumed codex pass reporting no new material findings, quoted in the transcript and logged in lessons/post-impl.md; the owner's sign-off on the as-built pictures is quoted in plan.md; the PR into dev exists only after the loop converged (`gh pr view` in the transcript), its final commits are the P5 close-out (`git show --stat` in the transcript) and `gh pr checks --watch` settled passing; `bun run audit:vue`, `bun run test:all` and `bun run lint` report exit 0 in the transcript on the final SHA; no UI change beyond the signed-off rows landed. Merging is the owner's and is not part of this goal.
```

```
/loop 15m Drive implementations-plan/private-transfer-row forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/private-transfer-row/plan.md and lessons/ (authoritative state, not the chat), including the Outcome & Quality Bar: every step is judged against it, not only against "it runs". A plan.md with an `## Outcome` block means delivery happened: babysit the PR only (CI per step 2, fixes on the branch, keep the Outcome true); once checks are green, report and STOP. Otherwise rebuild the task list from plan.md if empty, and run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup`.
2. Waiting on CI is fine: confirm it progresses (`gh run watch <run-id>` up to 10 minutes); stuck past that, read the logs and log it in lessons.
3. No task in hand? Take the next step from plan.md. After each edit run `bun run --cwd apps/extension test <touched tests>`, `bun run typecheck:all` and `bun run lint`; commit (signed; if it hangs in ssh-keygen, `SSH_AUTH_SOCK= git commit …`).
4. Stuck, or facing a decision you would bring to me? Call `/codex high` with full context and settle it, then act. Log the consult and verdict in lessons/phase-N.md. A UI question is never codex's: it goes to me, and the work holds. Never merge, publish or deploy, never widen scope beyond plan.md.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue on the agreed path.
6. Phase green means its validation gate as written in plan.md passes: run it, paste the result, mark ✓ in plan.md, file lessons/phase-N.md, print `LESSONS_FILE=implementations-plan/private-transfer-row/lessons/phase-N.md`, advance. e2e suites run one at a time, under the host's e2e lock where there is one.
7. All of P0–P4 ✓? Run plan.md's Post-implementation: the codex audit and fix loop until a round has no material finding (no /code-review), the gates after the loop, push, `gh pr create`, the P5 close-out as the PR's final commits, `gh pr checks --watch`, then the wrap-up report (what shipped, each debated decision with its context, open items). Stop: merging is mine.
```
