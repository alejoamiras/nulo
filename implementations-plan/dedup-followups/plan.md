---
plan: dedup-followups
tier: light (owner-scoped follow-up; no plan audit, codex post-implementation loop)
driver: claude-code
code_review: off
worktree: .claude/worktrees/dedup-followups (branch worktree-dedup-followups, on dev @ 49a58417)
ledger: implementations-plan/dedup-ledger (X5, N5) + the three bugs the stack pinned
status: phases 1–3 ✓ 2026-09-07; full gate + codex loop running
---

# Dedup follow-ups — three pinned bugs, X5 + N5

The dedup stack (#561 → #570) preserved three pre-existing bugs behind test pins and left two ledger ids for a
deliberate migration. This arc fixes the bugs and lands X5 + N5 together, then runs the codex fix loop and ships
one PR on dev. Every `data-testid` stays verbatim; the only user-visible changes are the three fixes below.

## The three fixes

1. **`simulate_transaction` under-rendered `add_public_authwit`** (`popup/windows/execute/OperationCard.vue:331-355`
   vs the `send_transaction` rows at `:109-167`). Both operations carry the same `Action[]`
   (`packages/wallet-bridge/src/operation.ts:87,95`), but only the send branch rendered the authwit's spender,
   method, contract and args; the simulate branch printed the generic kind. Fix: one `OperationActionRow.vue`
   (`windows/execute/`, the window's own dir) renders a single action exactly as the send branch does today —
   call / encoded_call, the four authwit content kinds with their testids (`execute-authwit-spender`,
   `execute-authwit-args`), the generic fallback — and both branches `v-for` it with the same
   `execute-op-payload-row` testid and keys. `safe()` moves to `./humanize.ts` as `safeWire` for both files.
2. **`TokenMetadataPopup` read `token.contract` on the render before its first fetch** (`:98`). Vue swallowed the
   TypeError and nothing rendered until the token arrived. Fix: the `Popup` shows only once the token is loaded
   (`:show="show && !!token"`), which is the state the swallowed error produced, minus the error.
3. **The console hooks lived on `self.on<method>`**, so `console.error` forwarding sat on `window.onerror`
   (`utils/console-sniffer.ts:9` reads them; `wallet/logger/console-forwarding.ts:15`, `offscreen/index.ts:44`
   and `wallet/index.ts:69` write them; `types/console.d.ts` typed them). Fix: the hooks move to
   `self.nuloOn<method>` at all five sites; `window.onerror` is no longer touched, and the `Window` typing drops
   its `onerror` override.

## X5 — the three popups still hand-rolling the show/keydown dance

`usePopupEntity` gains one option, `submitKey?: (e: KeyboardEvent) => boolean` (default `isPopupSubmitKey`),
because the two authwits popups submit on a *global* Enter (they have no input) — their hand-rolled guards are
`e.key === "Enter" && …` (`ChangeAuthwitsRegistryPopup.vue:121`, `RevokeAuthwitsPopup.vue:177`), not the
input-focused predicate the composable hard-codes.

- **`NewTokenPopup`** (`:266-300`): `onShow` resets transient state, fetches the token list, applies the
  preselected address; `onHide` aborts the balance wait, resets the form, disconnects the three clients;
  `submit: handleAddToken`; `submitWaitsForShow: true` (the listener was installed after the fetch).
- **`ChangeAuthwitsRegistryPopup`** (`:98-122`): `onShow: fetchRegistryStatus`, `onHide` resets + disconnects,
  `submit: handleChangeRegistry` (the handler self-checks `isLoading` and `isAllowedToExecute`),
  `submitKey: (e) => e.key === "Enter"`, `submitWaitsForShow: true`.
- **`RevokeAuthwitsPopup`** (`:149-178`): same shape; `onShow` also loads and chunks the preselected authwits;
  `submit` keeps the `!isErrorOccurred` gate the handler does not self-check.

Listener add/remove order versus the resets and `disconnect()` calls sits inside one synchronous block at every
site, so the composable's remove-before-`onHide` is unobservable; `submitWaitsForShow` reproduces the
install-after-fetch inertness.

## N5 — `useAuthRegistryStatus(service, account)`

The registry scaffold both authwits popups copy (`ChangeAuthwitsRegistryPopup.vue:28-58`,
`RevokeAuthwitsPopup.vue:28-62`): the `onRegistryEnabled`/`onRegistryDisabled` handlers that flip
`isRegistryEnabled` when the event names the active account, the `isLoading`/`error` refs, `fetchRegistryStatus`,
and the reset on hide. The composable (C1: receives the client, never connects) returns the same refs — the
submit handlers keep writing `isLoading`/`error` through them — plus `fetch`, `reset`, `dispose`.

## Phases

1. ✓ **Bugfixes** — `OperationActionRow` + `safeWire`, the token popup guard, the hook rename at five sites.
   Tests: `OperationCard.test.ts` gains the simulate-authwit case and the send parity case; the token popup's
   `(BUG PIN)` becomes "hidden until the token resolves, no render error"; `console-forwarding.test.ts` asserts
   the `nuloOn` hooks and an untouched `window.onerror`. Gate: lint, extension typecheck, the four suites.
2. ✓ **X5 + N5** — the option, the composable (+ a 7-case suite: fetch ok / fetch throws / loading flag / own vs
   foreign account events / reset / dispose), the three popups. Their existing suites (Enter gates, latch pins,
   the token popup's flow) stay green; `usePopupEntity.test.ts` gains a `submitKey` case. Gate: lint, typecheck,
   the suites, `build:chrome` + `git diff --exit-code --stat -- apps/extension/src/types/` (a new composable and
   a new component regenerate the declarations).
3. ✓ **Docs** — ledger rows X5 / N5 marked done, this plan's phases ✓, lessons.
4. **Full local gate** — `bun run lint && bun run typecheck:all && bun run test`, build + types diff.

## Post-implementation

Codex fix loop (`/codex high`): the net diff `git diff dev...HEAD -- . ':!implementations-plan' ':!apps/extension/src/types'`,
this plan, an adversarial ask (the execute window and the trust of what it renders; the console pipe; the
Enter gates), the two verbatim rules on over-engineering and comment quality, "do not run the vitest e2e
configs"; resume the same session per round until "no new material findings". Then one PR on dev,
`gh pr checks` watched, merged when green (the owner's standing "merge when the runs work" ruling).

## Audit log

(post-implementation only)
