# Phase 1 · The consent and the grant boundary

Built on `b6aa6e4d` (plan + recon, then P0). No screen changes. No visible string is added, and
the capability window ignores the new params until P2.

Round-5 picks for item 6 signed off by the owner in chat, 2026-09-25: "Regarding 6: Recommended." (the picks store is unreadable from this account, so the chat answer is the record).

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `e343b838` | P1.1 | `IDappSessionRef.authorizationsWithoutAsking?: unknown`; `CapabilityDecision.authorizations?: { broad } \| null`; `CapabilityParams.heldGrants?` and `.authorizationsWithoutAsking?`; `CapabilityResult.authorizationsWithoutAsking?: boolean`. Nothing reads them yet. |
| `8ca85327` | P1.2 | `isAnyContractScope`, `coversAnyContract`, `readConsent`, `authorizationsEffective`, `effectiveGrants`, re-exported by name. The docs of `callWithinTxOrSimulationScope` and `isCreateAuthWitCoveredByTxOrSimulationScope` are rewritten. 39 table tests. |
| `cfa06369` | P1.3 | `dataFieldsCovered` checks each field on its own. `dataRequestCovered` needs both fields covered. The drift pin now expects the window. |
| `cfa7b07c` | P1.3 | The `data` answer is built from the stored grant, not from the request's echo. |
| `7d950f96` | P1.3 | `projectKnownCapability` validates and projects each known type, keeping the wire shape. It runs on the manifest and on the popup's answer. Duplicate known types are refused. The fixtures move to valid shapes. |
| `f7b02642` | P1.3 | A-32: a rejected known type that the stored grants still cover leaves the delta. `contractClasses` and unknown types keep the old rule. `reRequested` is read from the final delta through `reRequestedTypes`. |
| `946c8bd2` | P1.3 | The createAuthWit gate: signing is silent only when the call is covered AND `authorizationsEffective` holds, both read from the dispatch-entry snapshot. The window gets `heldGrants` and the consent from that same snapshot. The decision carries the consent (`true` → `{ broad }`, `false` → `null`, anything else is ignored). `requiresGrant: ["accounts"]` is added when a consent is set outside the delta. The any-contract fixture carries `{ broad: true }`, and its three tests are renamed "(On)". |
| `7fe7531b` | P1.3 | The detached docs of `accountsCapsEqual` and `grantsOfType` are moved onto their own functions (§ Comments). |
| `f3b6a5bf` | P1.4 | Adds the strict schema field. `applyCapabilityDecision`: an object sets the consent, `null` deletes it, absent keeps it, and an unreadable value throws `ValidationError` before any write. Both `applyCapabilityDecision` and `setCapabilityGrants` delete the consent when no accounts grant has `canCreateAuthWit`. Adds the `setAuthorizationsWithoutAsking` setter, which takes the decision lock through `patchSession`, and its client passthrough. The `:283-299` doc is rewritten. |
| `076f2923` | P1.5 | "No silent fallback", driven through the real `WindowManager` on `FakeBrowserApi` with `MockClock`: a window closed first, a timeout, a late approval, and two windows on one row. |
| `b2de766a` | P1.3 fix | Only the popup caps a decision stores are projected. An echo of a held grant is not re-validated. |

## Red first

Each behaviour-change test was run red on the code before its change.

| Commit | Red run | Then |
|---|---|---|
| `8ca85327` | 39 failed of 39: the module had no such exports | 39 passed |
| `cfa06369` | 1 failed: "an address-book request after a private-events-only data grant re-prompts" (`expected 0 to be 1`) | 147 passed |
| `cfa7b07c` | 2 failed: "a field the person switched off is left out of the answer", "after a declined widening the answer is the retained grant" | 342 passed (package) |
| `7d950f96` | New tests against the unchanged dispatcher: 29 failed, 9 passed. The WIP `dispatcher.ts` was copied to the scratchpad, `HEAD` checked out, the run made, the WIP restored, and `cmp` confirmed the copy was identical. The 9 that pass pin today's correct behaviour: valid strings unchanged, an unknown type untouched, and so on | 187 passed |
| `f7b02642` | 3 failed: an exact held data record, a `contracts` subset after a declined widening, a covered declined type beside a new one | 385 passed (package) |
| `946c8bd2` | 11 failed: consent absent opens the window, in-flight C-15, rejected confirmation, batch leg, and the true/false/other carriage rows | 405 passed (package) |
| `f3b6a5bf` | 12 failed, 14 passed (`dapp-session/service.test.ts`) | 59 passed (`dapp-session/`) |
| `b2de766a` | 1 failed: "a held grant the popup echoes but the decision does not store is not re-validated" (`ValidationError: Malformed data capability`) | 406 passed (package) |

`076f2923` pins behaviour that already existed, so it has no red run of its own. Its first run
failed 4 of 4, but the cause was the harness (see below), not the service.

## Failed attempts and why

- **The worktree guard refused heredocs and compound git lines.** Edits went into Python
  scripts and message files in the scratchpad. Git ran as plain single
  `git -C <worktree> add|commit -F <file>` commands.
- **Commitlint warned "footer must have leading blank line".** A body line began with
  `wire-shaped:`, which commitlint parsed as a footer token. Fixed by rewording that line and amending.
- **After the validator went in, 18 existing dispatcher tests went red.** They sent bare shapes
  (`{ type: "data" }`, `{ type: "contracts" }`) and non-address strings. They moved to valid wire
  shapes, each keeping its assertion. That set is wider than the plan's list (see below).
- **23 refusal tests failed on `toThrow(new ValidationError(...))`.** Vitest also compares
  `details`, and the expected error had none. Fixed with
  `rejects.toMatchObject({ message, details: { capabilityType } })`.
- **TS2783: `message` specified twice.** The sentinel check spread `{ message, ...err }`.
  Fixed by moving the spread first.
- **A fixture edit script's anchor matched 2 lines.** Two `makeSession({ ... accounts:
  ["aztec:0:0xaaa", ...] })` lines were identical. Fixed by indexing past the simulateTx /
  profileTx describe.
- **An `accounts: Capability` literal failed typecheck.** It had no `accounts` field.
  Fixed with `as Capability`.
- **Biome `noDelete` infos in the test's decision mirror.** Applied the unsafe fix (`= undefined`).
  The MAC canonicalizer omits `undefined` properties, so the MAC result is unchanged.
- **The P1.5 harness opened no window (4 failed after about 1 s each).** `validateSession`
  threw "Unauthorized method" because the session had `permissions: []`. The wallet-sdk
  path creates sessions with `[{ methods: [] }]` (`wallet-sdk/background.ts:1034`), and the
  harness now does too.
- **`closeByUser` is not on `WindowPort`, and `noUnsafeOptionalChaining` fired on the
  `await ...?.value` read.** Fixed with a cast helper and a separate `created` variable.
- **Projecting the whole popup echo refused decisions over legacy held grants.** A held
  grant stored before the validator, such as a bare `{ type: "data" }`, comes back in the echo and
  failed projection, although that echo is never stored. `b2de766a` projects only the caps the
  decision stores.

## Decisions

- `heldGrants` is every stored `g.capability` taken from the snapshot, not re-validated. It feeds
  the defaults, the fold and Details. It never becomes a grant.
- Refusals reuse the existing `ValidationError` from `@nulo/extension-messaging/errors`. The
  message is `Malformed <type> capability` or `Duplicate <type> capability`, and the details are
  `{ capabilityType }`. A throw inside a projector becomes the same error.
- `requiresGrant` merges through a `requiredGrants` helper. Accounts are required when a consent
  is set outside the delta, and when an accounts widening is approved.
- `setAuthorizationsWithoutAsking(id, true)` records
  `broad = coversAnyContract(current grants)`, so a later broad widening needs a new On.
- Address checks: `0x` plus 64 hex digits, below `Fr.MODULUS` (`@aztec/foundation/curves/bn254`),
  and the case sent is kept.
- **The P1.5 cases pass on current code.** They cover what already happens. The existing cases
  that already pin the same race are
  `dapp-interaction/service.test.ts:285` ("cancel processed first → later approve throws
  JobCancelledError") and `:314` ("approve claimed first → later cancel finds nothing"), plus
  `service.composition.test.ts:118` (a feed cancel between two windows).

## Plan text that proved wrong or ambiguous

- **`plan.md:1443-1446`: the fixture list is incomplete.** Moving the bare shapes was not
  enough. These also had to move:
  - the non-address strings in the scope-list and `contracts` describes;
  - the transaction manifests and echoes near the base's `dispatcher.test.ts:209-236`;
  - the `contractClasses` values `aa…`/`bb…`, which are at or above the modulus (now `0a…`/`0b…`).
- **`plan.md:938-940`: the MAC round-trip proof sits in the wrong file.** The plan lists it
  among the `dispatcher.test.ts` proofs, but the dispatcher has no MAC. It lives in
  `dapp-session/service.test.ts`: a second `DappSessionService` on the same `browserApi` reads
  the projected grant back.
- **`plan.md:927` and `plan.md:570-572`: the `collectNewGrants` fallback is unreachable.** The
  fallback is `plan.delta.find`, now at `dispatcher.ts:675`. An approved type always has a
  candidate in the popup's answer, so no test can reach it. The delta it would fall back to is
  already projected, so an invented field cannot be stored through it.
- **`plan.md:570-572`: "again in `collectNewGrants`" is too wide.** Read literally, it
  projects the whole popup answer, which refuses decisions over legacy held grants. Refined to
  the caps stored (`b2de766a`).
- **`plan.md:938` against `plan.md:558-560`: the refusal text disagrees.** Line 938 says "the
  same fixed text". Lines 558-560 and 980 say the text names the capability type. Built per
  558-560: one fixed text per type.
- **After a declined widening, only the `data` answer is built from the stored grant.** The
  answer for the other known types still echoes the requested cap. This was outside P1's scope
  and is unchanged.
- **The dApp never sees the refusal text.** A `ValidationError` reaches it as the generic
  unclassified message (`wallet-sdk/error-envelope.ts:183`). The fixed text shows only in the
  background log.
- **`plan.md:856-858` against P1's no-e2e rule.** § Comments says the header of
  `tests/e2e/network/authwit-variants.test.ts:10-19` is rewritten "in the commit that changes
  the behaviour", which is `946c8bd2`. P1 forbids e2e work, so it was left for P4. From
  `946c8bd2` on, that spec's silent `callIntent` case (`:58`) expects silence while the wallet
  asks, so it fails until P4 rewrites it. Other network specs that use a scoped playground
  bundle with `"0x0"` (`apps/playground/src/lib/bundles.ts:45-46`) are refused until P4.1, as
  `plan.md:1532-1535` accepts.
- **P1 alone changes a flow, though no screen.** With no switch until P2 and P3, no session can
  hold a consent, so every covered call intent now opens the existing execute window. The arc
  must not ship P1 without P2 and P3.
- **For P2: the popup must never send a `data` cap with both fields off.** The boundary refuses a
  data cap that asks for neither field, and that refusal takes down the whole decision. When a
  person switches both fields off, P2's popup must leave the cap out.

The plan's `file:line` citations into source (§ Comments, P1) all match `b6aa6e4d`.

## Gate

All three were run from the worktree root on the final P1 code (`b2de766a`).

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing. One sits in a file this phase did not change: `dapp-interaction/service.ts:609`. `complexity-baseline check OK`, and no suppression was added. |
| `bun run typecheck:all` | 0 | 15 workspaces exited 0 |
| `bun run test:all` | 0 | First run, with no load-timeout reruns needed. extension 7568 passed, 4 skipped, 7 todo; wallet-bridge 406 passed; every other workspace green |
