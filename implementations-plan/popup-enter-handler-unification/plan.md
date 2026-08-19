# popup-enter-handler-unification [light]

Arc C of the post-remediation follow-on (parent: `implementations-plan/remediation-followups/plan.md`). Behavior change **owner-authorized by the arc goal**: the last three popups with hand-rolled any-Enter submit handlers move onto the shared `isPopupSubmitKey` guard (Enter submits ONLY while an `<input>`/`<textarea>` is focused) via `usePopupEntity` — the Q-07/Q-14 unification the five already-migrated popups use.

## Scope

- `NewEndpointPopup.vue` — hand-rolled `watch(show)` + any-Enter → `usePopupEntity` (submit + onShow field reset). No service client (uses global `managers`).
- `EditProfilePopup.vue` — any-Enter + client lifecycle inside the watch → `usePopupEntity` (submit; onShow: connect + populate the F4 collision list; onHide: disconnect + reset).
- `NewSenderPopup.vue` — same shape (AccountStateServiceClient; onShow: connect + getSenders; onHide: disconnect + reset).
- **Excluded (per the goal):** the two authwits popups stay as they are.

## The one behavioral divergence beyond the sanctioned Enter change

The hand-rolled EditProfile/NewSender watches added their keydown listener AFTER their async on-show population; `usePopupEntity` installs it before running `onShow`. An Enter during the population await is now live — and safe: `handleUpdateProfile` re-validates collisions against a fresh `getProfiles()` inside its in-progress latch (the F4 defense), and `handleAddSender` is gated on hex validity; the submit *button* was already clickable during that window anyway, so this opens no new hazard class.

## Pins (component tests, colocated per CLAUDE.md)

22 tests across three files pin the NEW behavior per popup: input-focused Enter submits (service/managers call observed); a global body-Enter does NOT; Enter is inert after hide (listener removed); guard rejections hold on the Enter path (short URL / collision / unchanged name / invalid hex); onShow effects (connect + fetch, field reset on re-show, editing-state reset with the button re-disabled); onHide effects (disconnect + reset); and — per the codex conditions — the **async window** (Enter while the initial `getProfiles`/`getSenders` is still unresolved: EditProfile's fresh re-check blocks a collision the stale list missed AND submits a clean name without deadlock; NewSender's hex gate holds). Test-harness note pinned in each file: the composable removes its document listener only on show→false (production popups never unmount — `PopupManager` renders them unconditionally), so tests hide before unmount or the listener leaks cross-test.

**New discovery (BUG PIN, pre-existing, preserved verbatim):** EditProfile's Enter path submits the UNCHANGED name right after opening — the submit button is gated on `isStartedEditing`, but `handleUpdateProfile` checks only `isAvailableToUpdateProfile`, whose `isUnchanged`/`isCollision` guards BOTH require `isStartedEditing`. Existed identically pre-migration (worse: on any-Enter). Pinned as `(BUG PIN)`; tracked for a separate fix, surfaced in the owner report.

## Validation

- `bun run audit:vue` green (typecheck:all → unit+component tests → lint → build), 22/22 new pins.
- Armed smoke: local run GREEN armed (fixture-stamped build via `VITE_NULO_E2E_MIGRATION_FIXTURE=1` + `NULO_E2E_MIGRATION_FIXTURE=1`, mirroring `_smoke-e2e.yml`): 112 passed / 6 skipped. A first unarmed attempt was correctly REJECTED by the fixture-arming contract test — the suite polices its own arming. The PR carries the `e2e:smoke` label so the CI smoke gate runs armed too.
- Single codex xhigh end-diff pass (light tier) — see ledger.

## Audit ledger

- **Codex xhigh end-diff (light tier): `conditional approve`** — no production regression found; confirmed lifecycle ordering preserved, no double-submit route (`FormPopup` has no `<form>`; button-focused Enter still submits via native click), authwits untouched, testids unchanged. Conditions: (1) track the arc plan (it was untracked at review time) — DONE; (2) pin Enter during the unresolved async onShow for both popups (EditProfile fresh-re-check both directions, NewSender validity gate) — DONE (+3 tests); (3) pin EditProfile reset-on-reshow — DONE (input restored + submit button re-disabled); (4) fix the NewEndpoint reset test's label overclaim — DONE (label asserted too). 22/22 green.
- **Codex hygiene note (non-condition):** hide-before-unmount masks the composable's missing unmount disposal and is fragile after an assertion failure — a wrapper-tracking afterEach or a shared disposer is deferred to a future shared-helper arc (out of this arc's scope).
- **Codex resume 1: `conditional approve`** — functional conditions all confirmed satisfied ("production code remains unchanged; the three async-window paths are correctly pinned"); remaining conditions were plan-only (trailing whitespace on the EditProfile scope line, stale 17/17 count vs the 22-test reality) — both fixed in this commit → **converged**.
