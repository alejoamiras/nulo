---
plan: approval-card-decoding
tier: light (retrofit — the fix was implemented before the plan; the plan records it and drives the post-implementation loop)
driver: claude-code
eli5_mode: artifact
eli5: https://claude.ai/artifact/Jf9qJt4qp4bbjyC2gXHXMS
code_review: off
budget: no recon agents (the regression was bisected by hand); codex at xhigh; no /code-review (owner directive 2026-09-03)
base: dev @ e01e416e
branch: worktree-approval-card-decoding
status: implemented 2026-09-15 (`ec297815` fix, `8c00f9ae` docs, `600c99ba` flat layout, `ec6089dd` / `b0fba3aa` / `baf85f93` codex rounds 1–3); all 5 phases ✓; codex loop CONVERGED at round 4 (reject ×3 with findings 8 → 3 → 2, all folded; round 4 approve, no new material findings); gates green on `baf85f93`, the last code commit (smoke 118, network subset 6, audit:vue 6000); branch pushed; PR #605 into dev open — two owner asks open (§ Assumptions)
---

# approval-card-decoding — read a dApp's call arguments on the approval card again

The execute window's approval card stopped reading dApp transactions after the B4 approval
hardening (`ad130aea`, PR #596): mints stopped matching, three-argument transfers fell through, and
the raw fallback printed every 32-byte wire field untrimmed as an address, clipped by the card. This
plan restores a readable card without loosening what B4 tightened: nothing is guessed, every reading
is either the wallet's own vocabulary, the contract interface the PXE holds, or an explicit
"can't read" with the fields behind a toggle.

## UI impact

- **Surface**: `apps/extension/src/popup/windows/execute/` — the `aztec_sendTx` operation card
  (payload rows, argument block), the discovered-authorizations list, the `aztec_createAuthWit`
  call-intent card. No other window changes.
- **Before / after**: the artifact above (three revisions; the third is the shipped layout). Before:
  untrimmed hex, wrong "address" classification, an indented block hanging off the right-aligned
  Payload column. After: `Payload` as a group label, each call a full-width stack (name left,
  contract right), arguments as key-left / value-right rows, raw fields folded behind
  "Show N raw values".
- **Owner sign-off (recorded)**: 2026-09-15, on the artifact's revision 2 offering "fold" vs "flat":
  > "Ok, let's do flat, nevermind. […] It's good enough!"
  The folded-headline variant was rejected; the flat layout shipped as `600c99ba`.

## Scope

In:

- Recognize `mint_to_private` / `mint_to_public (to, amount)` again, beside the descriptor-derived
  transfer vocabulary.
- Read a wire field (`0x` + 64 hex) as an integer, never as an address; format amounts with the
  registered token's decimals + symbol when the wallet knows the token at that contract on that chain.
- Decode any other call against the contract artifact the PXE registered, through a display-only
  service-worker RPC; show parameters by ABI name; the header shows the function the selector
  resolves to, not the name the app supplied.
- When no reading applies: one orange warning + a one-line reason, trimmed raw fields behind a
  toggle (closed by default), decimals for values below 2⁶⁴, a 32-row cap with "+N more in the JSON
  view".
- The same argument block for discovered authorizations (behind their existing "Show details") and
  for the createAuthWit call intent.
- Component tests fed with wire-shaped arguments so the regression class cannot pass again.
- A CLAUDE.md rule: UI changes need explicit owner sign-off.

Out:

- Any change to what is executed. The decode RPC feeds display only; execution still reads the
  stored request.
- Curating per-contract copy ("Claim private" stays the humanized ABI name).
- Decoding for `send_transaction` (legacy action rows are untouched).

## Success criterion

A dApp `aztec_sendTx` whose calls are (a) a vocabulary transfer, (b) a mint, (c) a call on a
PXE-registered contract, (d) a call on an unknown contract renders, respectively, From/To/Amount with
the token symbol, Mint to/Amount, named parameters, and the warning + closed toggle — with every
argument passed as a 66-char hex string, at 360 px, nothing clipped. Pinned by
`OperationCard.fallback.test.ts`, `call-surface.test.ts`, `call-decoder.test.ts`.

## Delivery — single arc, one PR

One branch (`worktree-approval-card-decoding`), one PR into `dev`, plain `gh pr create`, opened only
in the Post-implementation step after the codex loop converges. `code_review: off`. Title (≤ 93
chars): `fix(popup): read dapp call arguments by vocabulary, abi or raw fields behind a toggle`.

## Phases

Each phase's gate is what "✓" means. Commands are the repo's real scripts.

#### Phase 1: Vocabulary + intent — mints back, fields are integers ✓ (`ec297815`, lessons/phase-1.md)

- `apps/extension/src/utils/token-transfer-vocabulary.ts`: `MINT_SIGNATURES`, `findMintSignature`.
- `apps/extension/src/utils/transfer-intent.ts`: `TransferIntent` gains `mint`; `canonicalAmount`
  → decimal string via `BigInt`; `ProjectedArgument` kinds `field | text | opaque` (a 66-char hex is a
  field); `smallFieldDecimal`.
- Assumptions: the descriptor-derived transfer list is the single transfer source (Fact 3); mint
  names are hand-pinned because no descriptor carries them.
- **Validation gate**: `cd apps/extension && bunx vitest run src/utils/token-transfer-vocabulary.test.ts src/utils/transfer-intent.test.ts && bun run typecheck` — exit 0. Layers: typecheck · unit.

#### Phase 2: Display-only ABI decode in the service worker ✓ (`ec297815`, lessons/phase-2.md)

- `packages/wallet-bridge/src/decoded-call.ts`: `DecodedCall`, `DecodedValue`, `DecodedParam`,
  `UndecodedReason`, `DisplayCallInput` (exported from the bridge index; the extension re-exports
  them from `execution/models`).
- `apps/extension/src/wallet/services/execution/call-decoder.ts`: `decodeCallForDisplay(lookup,
  call)` — artifact lookup (failure → `unknown-contract`), selector-first function resolution
  (name only when no selector), field parsing (`/^0x[0-9a-fA-F]{1,64}$/`, ≤ 256 args), arity check
  via `countArgumentsSize`, `decodeFromAbi`, projection of Aztec/Eth address structs, selectors,
  wrapped fields, options, arrays (≤ 8 items shown), structs.
- `execution/spec.ts` + `client.ts` + `service.ts`: `decodeCallsForDisplay(networkId, calls)` —
  ≤ 64 calls, active-profile + network ownership check, one cached artifact promise per address.
- Assumptions: Facts 1, 2, 4, 6.
- **Validation gate**: `cd apps/extension && bunx vitest run src/wallet/services/execution/call-decoder.test.ts && bun run typecheck && cd ../../packages/wallet-bridge && bun run typecheck` — exit 0. Layers: typecheck · unit (real `encodeArguments` against a fake artifact).

#### Phase 3: The card reads vocabulary → decode → raw ✓ (`ec297815`, lessons/phase-3.md)

- `execute/call-surface.ts`: `CallSurface` (`transfer | mint | decoded | pending | raw`), `callSurface(ctx, call, decoded)`, `callName` (ABI name once decoded), `amountLabel`, `paramText`, `rawRows` (32-row cap, control characters stripped), `RAW_NOTICE`.
- `execute/display-calls.ts`: which calls a window decodes (`aztec_sendTx` exec calls, the createAuthWit intent call, discovered authwits by consumer + selector).
- `execute/CallArguments.vue` (new): the argument block with the raw toggle; testids prefixed per host (`execute-op-*`, `execute-authwit-*`, `execute-discovered-authwit-*`).
- `execute/OperationCard.vue`: uses `CallArguments`; props `decodedCalls`, `decodedAuthwits`, `tokens`; discovered authorizations gain "Show details".
- `execute/index.vue`: fires `decodeOperationArguments` + `loadKnownTokens` at init, decodes discovered authwits as estimates/previews settle.
- `CLAUDE.md`: "UI changes need explicit owner sign-off" (`8c00f9ae`).
- Assumptions: Fact 5 (e2e only counts payload rows, so testids may be added but `execute-op-payload-row` must stay one-per-call).
- **Validation gate**: `cd apps/extension && bunx vitest run src/popup/windows/execute && bun run typecheck` then `bun run audit:vue` at the repo root — exit 0 (ran 2026-09-15: 15 files / 112 tests in the targeted run; audit:vue EXIT=0). Layers: typecheck · unit · component · build.

#### Phase 4: Flat layout (owner-picked) ✓ (`600c99ba`, lessons/phase-4.md)

- `CallArguments.vue` + `OperationCard.vue`: no left border / indent; `Payload` as a group label;
  each call a full-width stack; rows `justify="between"` with right-aligned values; the same for the
  discovered-authorization block and the createAuthWit `Arguments` group.
- Assumptions: sign-off quoted under UI impact.
- **Validation gate**: `cd apps/extension && bunx vitest run src/popup/windows/execute && bun run typecheck && cd ../.. && bun run lint && bun run --cwd apps/extension build` — exit 0 (ran: 12 files / 90 tests; lint + build exit 0). Layers: typecheck · lint · component · build.

#### Phase 5: e2e evidence ✓ (`baf85f93`, lessons/phase-5.md)

- Smoke: `bun run test:e2e` (solo — its global setup kills this worktree's dist Chromes).
- Network subset that opens the execute popup on a dApp `aztec_sendTx` / authwit:
  `bun run e2e:agent tests/e2e/network/tx-sendTx-multicall.test.ts tests/e2e/network/tx-sendTx-default.test.ts tests/e2e/network/tx-sendTx-noFrom.test.ts tests/e2e/network/tx-sendTx-delegated-authwit.test.ts tests/e2e/network/authwit-variants.test.ts`.
- Assumptions: Fact 5; a red network shard on a loaded host is re-run once before triage (memory:
  the suite runs alone).
- **Validation gate**: both commands exit 0 with their retry-0 tallies quoted in lessons/phase-5.md.
  Layers: e2e · e2e-live-network.

## Architecture & Implementation

- **Where it lives**: types in `@nulo/wallet-bridge` (the lowest layer both the SW service and the
  popup import), the decoder + RPC in the execution service (it already owns the PXE handle and the
  profile/network checks), the reading order in a pure `call-surface.ts` next to the window, and one
  new L5 SFC (`CallArguments.vue`) so the three host surfaces share one block.
- **Critical flow**: popup opens → `index.vue` lists display calls per operation → one
  `decodeCallsForDisplay` per operation (and per settled authwit batch) → the card computes a
  `CallSurface` per call from `(vocabulary, decoded, caller context)` → `CallArguments` renders.
  `decoded === undefined` is `pending`; a short batch is `unavailable`.
- **Reading order is a precedence, not a merge**: the vocabulary applies only on a contract the
  wallet registered as a token AND whose decode spells the signature (the same roles, order and
  kinds — `transfer(amount, to)` on a token is read by the ABI, never by position); it then carries
  the wallet's own labels (From/To/Amount, token symbol). Every other decoded call shows the
  contract's parameters as given, integers unscaled. A hidden `msg_sender` or a missing caller
  context never claims a sender: the surface falls through rather than lie.
- **Selector is truth**: `findFunctionBySelector` first; the app's `name` is consulted only when
  the wire carries no selector. The header uses the ABI name once decoded.
- **Simpler alternative considered**: decode in the popup with the artifact fetched over RPC.
  Rejected: artifacts are large, the popup would need the ABI codec bundle, and the SW already holds
  the PXE. The display-only RPC returns a small projected tree instead.
- **Trade-off**: token units apply to the wallet's vocabulary only. A decoded integer, even one a
  registered token names `amount`, stays raw: the wallet cannot know what a non-vocabulary function
  denominates, and a wrong symbol is worse than none.
- **Disclosure is complete per host**: a requested call's overflow lives in the JSON view (32-row
  cap on the card); a discovered authorization is not in the request, so its card list is uncapped
  and a long decoded array is complete in the row's title.

## Security & Adversarial Considerations

- **Threat model**: a malicious dApp controls every byte of the request (`to`, `name`, `selector`,
  `args`, authwit intents). It wants the card to show something the user would approve that differs
  from what executes. The decode path is display-only; execution reads the stored request, so the
  worst outcome is a misleading card, never a different transaction.
- **Name spoofing**: the app's `name` cannot rename a call once the selector resolves in the
  contract's ABI, and decoded names are sanitized like any wire string. Residual: the ABI is the
  contract's own — a malicious contract can name its function `transfer` and its parameters `to` /
  `amount`. The "Transfer (private) · 5 USDC" reading needs both the wallet's token registry (the
  user registered that contract as a token) and an ABI that spells the signature; any other contract
  shows its own parameter names, integers unscaled, no symbol. Registration proves the contract
  answers the token metadata and balance calls, not that its `transfer` is honest — that residual is
  the user's trust in the tokens they registered.
- **Input bounds**: ≤ 64 calls per RPC, ≤ 256 args per call, 66-char hex only (else `opaque`),
  ≤ 1024 decoded leaves per call (bounded on the ABI before decoding), ≤ 32 raw rows on a requested
  call (the JSON view has the rest) and every row on a discovered authorization (nothing else has
  them), `safeWire` caps + strips control characters and bidi overrides from any string that reaches
  the DOM; a row's `title` carries the whole field, list or string when the line trimmed it.
- **Authorization**: `decodeCallsForDisplay` runs `ensureInitialized`, rejects non-arrays, checks the
  network belongs to the active profile. `AztecAddress.fromStringUnsafe` on the app's `to` is inside
  the lookup's try/catch → `unknown-contract`.
- **Failure shape**: every decode failure is a typed `UndecodedReason`; no throw reaches the popup,
  so a hostile call cannot blank the card (the raw notice renders instead).
- **No new privilege / crypto / supply chain**: no dependency added; `@aztec/stdlib` ABI codec at
  the pinned 5.2.0; no storage shape change.
- **DoS**: one decode round per popup open; artifacts cached per RPC call; the raw toggle is closed
  by default, so a 256-arg call costs nothing until opened.

## Assumptions

Facts (verified):

1. `@aztec/stdlib` 5.2.0 `FunctionAbi` requires `isOnlySelf` and has no `isInternal` (typecheck
   error during Phase 2; fixture fixed).
2. `decodeFromAbi(types, fields)` returns the single value for one type and an array otherwise
   (`call-decoder.ts` handles both; `call-decoder.test.ts` covers a 5-param function).
3. The transfer vocabulary is descriptor-derived since `ad130aea`; no descriptor carries a mint, so
   the pre-B4 mint reading was lost there (git show of `token-transfer-vocabulary.ts` at
   `ad130aea^` vs `ad130aea`).
4. `Fr.fromString` throws for values ≥ the field modulus (a `0xbbb…` fixture failed; addresses in
   tests now start with `0x00`).
5. The e2e suite touches the *argument presentation* only through `execute-op-payload-row` counts
   (`tests/e2e/network/tx-sendTx-multicall.test.ts:66`). Other execute-card testids the suite reads
   (`execute-op-from-account` in `multi-account-from.test.ts:67`, the fee badges) are untouched here.
6. `ExecutionService` reaches artifacts through `pxeService.getContractInstance(info, address)` →
   `getContractArtifact(info, instance.currentContractClassId)` (both already used by execution).
7. `aztec_sendTx` arguments arrive in the popup as `0x` + 64 hex strings in normal SDK use. The
   dispatcher validates each call's target and string name (`dispatcher.ts:580`) and leaves the
   arguments unparsed, so the popup treats every argument as hostile (a throwing `toString` is
   pinned in `display-calls.test.ts`).

Inferences:

- A contract the dApp never registered with the PXE may still decode: the instance lookup falls
  through to the node and the known-contract bundle (`packages/aztec-runtime/src/pxe/service.ts:327`).
  `unknown-contract` means the whole cascade missed.
- A discovered authwit decodes on the consumer the discoverer bound from the emitting effect
  (`authwit-discoverer.ts:130`); that binding, not selector uniqueness, is what keeps the decode on
  the right contract (selectors collide across contracts).
- The vocabulary is gated on the wallet's token registry (codex round 1); a transfer on a token the
  wallet has not registered shows the decoded parameters (or raw fields), never the wallet's labels.

Asks (surfaced by codex round 1; current behaviour stays until the owner decides):

- **Discovered-authorization arguments stay behind "Show details".** The flat-layout sign-off was
  about the main call; the owner has not ruled on this fold. Default kept: collapsed.
- **Confirm is not gated on the decode.** `index.vue` lets the user approve while a card still says
  "Reading arguments…" (a slow decode never blocks; the RPC has its 60 s timeout). Default kept:
  not gated.

## Decision log

- 2026-09-15 owner: "open a fix branch off dev and fix all of it" + hide undecodable payloads behind
  a UX-conscious toggle + a CLAUDE.md sign-off rule + an artifact mockup.
- 2026-09-15 owner, on revision 2: flat rows, no folded headline (quoted under UI impact).
- Codex round 1 (reject, 8 findings, all folded): the vocabulary is gated on the token registry;
  the decoder bounds the ABI's decoded leaves before decoding; decoded names are sanitized and
  curated labels stay on their contract; a decoded integer is never scaled; an empty symbol keeps
  the raw integer; a throwing `toString` cannot leave the card pending; the row-cap notice names the
  JSON view only for requested calls. Details in `lessons/post-impl.md`.
- Codex round 2 (reject, 3 findings, all folded): the vocabulary also requires the decode to spell
  the signature (roles, order, kinds), so it now waits for the decode instead of reading by position
  on registration alone; discovered authorizations list every raw row and every decoded array item
  (title) since the JSON view cannot show them; the architecture text no longer describes the
  removed amount scaling.
- Codex round 3 (reject, 2 findings, folded): a wire `method` alias could outrank the decoded name
  (the corroborated reading is now built from the decoded name, args and msg_sender flag only);
  hover text prints addresses, fields and strings whole. Three-round stop reached and surfaced.
- Owner `/goal` (2026-09-16) required a converged loop → codex round 4: approve, no new material
  findings. Loop closed on `baf85f93`.

## Post-implementation

Executed by the implementing session from this file. `code_review` is `off`: `/code-review` is not
run at any point.

1. **Codex audit** (`/codex` at xhigh, launched through tmux on the homelab — the harness kills
   background codex runs under memory pressure): the branch diff from `e01e416e`, this plan.md, the
   adversarial/security ask ("What could go wrong? What would an attacker target? What are we
   trusting that we shouldn't? Where are the supply-chain / least-privilege weaknesses?"), the
   assumption-attack ask ("Attack the Assumptions section. Which Facts are misstated? Which Inferences
   are unsafe? Which Asks need surfacing instead of being silently assumed? Return findings under
   Facts / Inferences / Asks buckets."), the implementation critique ("Critique the Architecture &
   Implementation. Is this the right structure, or is there a simpler / more idiomatic pattern? Wrong
   abstraction or boundary? Do the interfaces leak? What would you build differently, and why?"), and
   both rules below verbatim. Never concurrent with `audit:vue` or an e2e run (OOM).
2. **Iterative fix loop**: verify codex's factual claims against the repo; apply the accepted fixes;
   commit; log the round (consult + verdict) in `lessons/post-impl.md`; RESUME the same codex session
   with the fix diff. Repeat until a round yields no new material findings (rejected nitpicks don't
   count). Still material after 3 rounds → stop and surface to the owner: a scope smell.
3. **Gates after the loop**: `bun run audit:vue` at the root; re-run Phase 5's e2e commands if any
   popup or service file changed after the last e2e run. Push the branch.
4. **Delivery**: the FIRST time the PR is opened — `gh pr create` into `dev` with the title above,
   the body naming the artifact URL and quoting the sign-off; watch `gh pr checks --watch`. Update
   `implementations-plan/index.md`. Never merge.

**The no-over-engineering rule** (verbatim in every codex prompt): *"Report bugs and small, targeted
improvements only. Do not propose speculative abstractions, extra configuration surface, new layers,
or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it
alone."*

**The comment-quality rule** (verbatim in every codex prompt): *"Audit the comments for value per
character. Flag any comment that narrates what the code visibly does, restates its line, references
implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag
places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are
permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and
exact."*

**Autonomy**: decisions the plan leaves open are settled by a logged codex consult; a loop still
material after three rounds, or a decision outside this plan's scope, is surfaced to the owner and
the session holds there. Hard limits: no merge, no history rewrite, no scope beyond this plan, no
change to what executes, no UI change beyond the signed-off layout without a new sign-off. Pushing
the branch after `audit:vue` passes is authorized.

## Seeds

Recommended: `/goal` (completion is transcript-observable). Use exactly one per session.

```
/goal All 5 phases marked ✓ in implementations-plan/approval-card-decoding/plan.md (the per-phase headers in the file — not the chat, not the task list), each ✓ backed by its validation gate as written in plan.md reported passing in the transcript (each suite run quoted with its retry-0 tally and the SHA it ran on); `LESSONS_FILE=implementations-plan/approval-card-decoding/lessons/phase-N.md` printed for each phase; `/code-review` was NOT run (plan.md says code_review: off); the codex fix loop converged, evidenced by a resumed codex pass reporting no new material findings quoted in the transcript, each round logged in lessons/post-impl.md; `bun run audit:vue` reports EXIT=0 on the final SHA and the Phase 5 e2e commands exit 0 on a SHA no popup/service file changed after; the branch is pushed; the PR into dev exists only after the loop converged (`gh pr view` in the transcript) with `gh pr checks --watch` settled PASSING; implementations-plan/index.md lists this plan with its final status; no UI change beyond the signed-off flat layout landed without a new owner sign-off quoted in plan.md. Merging is the owner's and is not part of this goal.
```

```
/loop Work implementations-plan/approval-card-decoding/plan.md top to bottom: for the first phase without ✓, run its validation gate exactly as written, fix what is red, write lessons/phase-N.md, mark ✓ with the SHA; when all five are ✓, run the Post-implementation section in order (codex through tmux, loop ≤ 3 rounds, audit:vue, push, then the PR); stop and report when the PR checks settle or when a decision needs the owner.
```
