# contacts-sender-decouple

Remove the contacts ↔ sender-registration coupling from the wallet UI. Aztec v5's handshake-backed
note delivery makes sender registration unnecessary for the token transfers this wallet bundles
(constrained delivery), so the "Register as sender" affordances woven through the contacts flow are
now misleading: they imply receiving requires an action it no longer requires. Sender registration
remains available as a power-user surface (Settings → Advanced → Account State → Senders) for the
surviving niches: contracts using legacy address-derived tagging, and senders whose wallets
explicitly choose address-derived delivery for unconstrained transfers.

**Tier**: `light` (bounded, extension-app only, 0 high rubric dimensions).
**Baseline**: `dev` @ `cff0ba2` (aztec 5.0.1 line, v0.25.0).
**Status: APPROVED 2026-07-20** — user verdict `approve`. Ask resolutions: A1 confirmed (the
replacement copy as written); A2 confirmed — and simplified by the user's clarification that
there are NO prior users of this extension, so there is nothing to migrate and no compat
consideration attaches to leaving sender rows alone; A3 confirmed (active-network-only import
registration, documented + counted), with **cross-network import fan-out recorded as explicit
FOLLOW-UP work** (a later plan, not this scope). No `/harden` pass scheduled for this plan.
**Governing principle (post-audit)**: the contacts feature is **entirely non-mutating toward
sender state, except import's explicit adds** — add/edit/delete of a contact never registers,
unregisters, or migrates a sender. Import may only ADD senders (rows explicitly carrying
`isSender: true` from a previous deliberate export), never delete or migrate them.

## Scope

In:
- `NewContactPopup.vue` — remove the "Register as sender" toggle, the `registerAsSender` form
  field, the conditional `addSender` call, and the dual-outcome toast.
- `EditContactPopup.vue` — remove the sender toggle, the desired/initial sender-state model, AND
  `applySenderDelta` entirely (no silent migration on address edit — audit-adopted: sender rows
  are independent state, not contact metadata; a stale registration is visible in Advanced and
  harmless, whereas a silent register-without-consent is a privacy regression).
- Contacts list page — remove the "Also unregister as sender…" toggle from the delete-confirm;
  deleting a contact never touches sender registration. The read-only "sender" chip on
  `ContactRow` **stays** (user decision).
- `useContactImportExport.ts` — remove the merge-by-name sender-migration block (today it
  unregisters the old address's sender even when the imported row has `isSender: false` — a
  delete performed by the contacts feature, banned under the governing principle). Keep
  `isSender: true` adds on the active network; make the banner count them explicitly.
- Copy — token empty state (`RecentActivityView.vue:802`) stops claiming contacts are needed to
  receive; fix the "Import competed successfully" typo; sweep residual "register to detect
  incoming" copy; reframe the Advanced senders surface as the niche it now is.
- Component tests — first-ever focused tests for New/Edit/Import contact popups (none exist).
- E2E — rework `contacts-sender.test.ts` + the `addContact` helper; add a
  receive-from-unregistered-sender network test (the behavioral pin — a REQUIRED ship gate).

Out:
- Settings → Advanced → Account State → Senders page + `NewSenderPopup` (kept, minor copy only).
- `aztec_registerSender` dApp RPC, scope checker, dispatcher, execution paths (untouched — dApps
  interacting with address-derived-tagging contracts still need it; its sender-amplification
  surface is pre-existing and unchanged by this plan).
- Contact export format (`isSender` field stays; export still reads PXE state, unioned across
  active networks — asymmetry documented below).
- `AccountStateService` API surface (unchanged — UI callers shrink, service doesn't).

## Why now (the enabling facts — narrowed post-audit)

At the 5.0.x line the PXE discovers notes from three tag-source families; the on-chain
HandshakeRegistry (auto-registered by every PXE) lets a first send bootstrap discoverability under
a tag derived from the recipient's own address — no sender pre-registration. Precisely:
- `onchain_constrained` delivery is handshake-backed **by construction** — discovery is
  registration-free regardless of the sender's wallet. The bundled token
  (`@aztec-foundation/aztec-standards@5.0.1`) uses `onchain_constrained` exclusively for private
  balance delivery — the artifact's embedded source confirms it.
- Default `onchain_unconstrained` resolves the tag strategy in the **sender's** wallet; the PXE
  default (no hook) is a non-interactive handshake for external recipients — but a sender wallet
  with a custom hook COULD choose address-derived tagging, in which case the recipient would need
  the sender registered. This is the honest residual: registration-free receive is guaranteed for
  constrained delivery, and is the ecosystem default (not a guarantee) for unconstrained.
- `offchain` delivery requires explicit `offchain_receive` ingestion — registration neither helps
  nor is needed.

## Import/export semantics (documented, audit-adopted)

Export unions senders across active networks into per-row `isSender`; import registers
`isSender: true` rows on the **active network only** (single snapshot, no cross-network fan-out).
This asymmetry is accepted and now stated in the UI (banner carries the count + network name);
full backup remains the faithful per-network restoration path. The import boundary treats files
as hostile: the phase verifies (and adds if missing) a row cap + per-address dedup before any
PXE call, so a crafted file can't amplify scan state unboundedly.

## Phases

### Phase 1 ✓ — Decouple the contacts UI (New/Edit/Delete/Import)
- `NewContactPopup.vue`: remove toggle row (`:245-261`, testid `new-contact-register-sender`),
  `registerAsSender` field (`:72,78`), the `addSender` branch + dual toast (`:101-147`) → single
  "Contact is added" toast. Drop the popup's `AccountStateServiceClient` usage.
- `EditContactPopup.vue`: remove toggle (testid `edit-contact-sender-toggle`),
  `initialIsSender`/`desiredIsSender`/`loadSenderState`, and `applySenderDelta` (no migration).
- Contacts page `handleDeleteContact`: remove the `confirm.toggle` block, `unregisterSender` ref,
  and `deleteSender` branch. Keep `syncSenders`/`isContactSender` + the `ContactRow` chip.
- `useContactImportExport.ts`: remove the `activeSenderSet` snapshot + `oldSenderAddressToUnregister`
  migration block; keep `isSender: true` adds (active network, counted); verify/add row cap +
  address dedup at the parse boundary.

**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test`.
Pass: exit 0; no source or test references the removed testids outside e2e (reworked in Phase 4).
Layers: lint/typecheck + full unit/component suite.

### Phase 2 ✓ — Copy corrections (frontend addendum: copy is design surface)
- `RecentActivityView.vue:802`: `Add contacts to send and receive {{ token.symbol }}.` →
  **`Send or receive {{ token.symbol }} to see activity here.`** (headline stays).
- `useContactImportExport.ts` toast: `Import competed successfully` → `Import completed successfully`.
- Import banner: add the explicit count — `N sender(s) will be registered on <network>`.
- Sweep `grep -rn "detect incoming\|Register as sender\|detecting incoming" apps/extension/src` —
  every remaining hit must live in the Advanced senders surface or the import banner, reworded to
  the niche framing (senders are needed only for contracts/wallets using legacy address-derived
  delivery).
- `tokens/[id].vue` "Manage contacts" dropdown item: kept (send-side address book; no receive claim).

**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test` + the grep
sweep pasted with only allowlisted hits. Layers: lint/typecheck + unit + manual copy review.

### Phase 3 — Focused component tests (new coverage)
Add colocated component tests: `NewContactPopup.test.ts` (submit path calls addContact only —
assert NO account-state client interaction; toast copy), `EditContactPopup.test.ts` (address edit
does not touch sender plumbing), `ImportContactsPopup.test.ts` + a unit test for
`useContactImportExport` (isSender adds counted on active network; merge-by-name never deletes;
row cap + dedup enforced; no-network → per-row skip). Respect the L-layer coverage minimums.

**Validation gate** — commands: `bun run lint && bun run typecheck && bun run test`.
Pass: new tests green and included in the run. Layers: lint/typecheck + unit/component.

### Phase 4 — E2E rework (existing suite)
- `tests/e2e/fixtures/helpers.ts` `addContact`: drop the `registerAsSender` option + toggle click.
- `tests/e2e/network/contacts-sender.test.ts`: remove the delete-confirm-toggle and edit-toggle
  scenarios (including the migration scenario — behavior deleted); re-point PXE sender CRUD
  coverage at the Advanced surface (senders page: add via `NewSenderPopup`, list, delete); rename
  to `senders-advanced.test.ts` if clearer.
- `data-registerSender.test.ts` (dApp RPC): untouched, must still pass.

**Validation gate** — commands: `bun run lint && bun run typecheck`, then the reworked network
file(s) via `bun run e2e:agent` (targeted). Pass: green against a live local node.
Layers: lint/typecheck + network e2e.

### Phase 5 — Behavioral pin: receive from an UNREGISTERED sender (REQUIRED ship gate)
New network e2e, audit-hardened design:
- Reuse the suite's already-deployed token (the bundled `@aztec-foundation/aztec-standards` token
  — constrained delivery) — no second deployment.
- Fresh sender: a node-side dev account (`@aztec/aztec.js`) never seen by the wallet.
- Pre-assert: immediately before the transfer, the wallet's sender list for the network does NOT
  contain the sender (via the Advanced senders surface / `getSenders`).
- Act: private transfer dev-account → extension account; await confirmed inclusion.
- Assert: exact private-balance delta in the wallet UI, discovered with zero registrations.
- Stretch (same phase, non-blocking): fresh-device catch-up — after discovery, restart/resync the
  PXE (or re-import the profile) and assert the note is re-discovered cold.
This phase is a REQUIRED gate: if the harness blocks it, the plan STOPS and surfaces to the user —
there is no `.todo` fallback (audit-adopted: a hook-absence composition test proves neither the
external sender's strategy nor registry discovery; it is not an acceptable substitute).

**Validation gate** — commands: targeted `bun run e2e:agent` run of the new file. Pass: the
no-registration receive assertion green against a live node. Layers: network e2e.

### Phase 6 — Full gates + docs + wrap-up
- `bun run audit:vue` (typecheck:all → test → lint → build) and `bun run test:e2e` (smoke).
- Docs: service README notes describing the old contact→sender flow; the import/export asymmetry
  note; `implementations-plan/index.md`; lessons.
- No CLAUDE.md change (behavior, not rules).

**Validation gate** — commands: `bun run audit:vue && bun run test:e2e`. Pass: both exit 0.
Layers: typecheck/lint/unit/build + smoke e2e.

## Security & Adversarial Considerations

- **Privacy (positive)**: default-ON sender registration broadened the dApp-observable graph
  (registered senders leak into `aztec_getPrivateEvents`). Removing default-on registration AND
  the silent edit/import migrations shrinks consent-free writes to the PXE. Audit-adopted: the
  old migration itself was a privacy regression (registered a new address without explicit
  consent and deleted a discovery source).
- **Handshake privacy trade (upstream)**: non-interactive handshakes reveal on-chain that
  *someone* handshaked with a recipient address. Property of the delivery mode our bundled token
  already uses; unchanged by this plan.
- **Hostile import data**: files remain attacker-controlled. The import phase enforces row cap +
  per-address dedup before any PXE call (bounded scan-state growth), and every `isSender` add
  still funnels through PXE curve validation. Sender adds are surfaced with an explicit count.
- **Retained surfaces**: `aztec_registerSender` (dApp, `addressBook=true`-scoped) can register
  many senders — pre-existing, out of scope, documented.
- **Attack surface**: net reduction — toggles, a confirm branch, and a delete path removed; no
  new inputs, RPCs, or storage. No dependency/workflow/permission changes.

## Assumptions

**Facts** (verified in-tree @ `cff0ba2`):
1. `NewContactPopup.vue:72,78,121-131,245-261` — default-on toggle, conditional `addSender`,
   testid `new-contact-register-sender`.
2. `EditContactPopup.vue:109-120,152-158` + `applySenderDelta` — two-state model + add-then-delete
   migration.
3. Contacts page `handleDeleteContact` — delete-confirm sender toggle calling `deleteSender`.
4. `ContactRow.vue:12,38-41` — read-only `isSender` chip; covered by `ContactRow.test.ts`.
5. `RecentActivityView.vue:802` — the receive-requires-contacts copy.
6. `useContactImportExport.ts:144-207` — active-network snapshot; merge-by-name unregisters the
   old sender even when the imported row has `isSender: false` (audit finding, verified in-tree);
   toast typo `Import competed successfully`.
7. `helpers.ts:349-361` — e2e `addContact` drives the toggle by testid.
8. Sender plumbing: `AccountStateService` → `pxe registerSender` →
   `registerTaggingSecretSource({kind:"address-derived"})`; contacts and senders independent at
   the service layer.
9. Delivery semantics (verified at the upstream v5 tag + migration notes; NARROWED post-audit):
   constrained = handshake-backed by construction (registration-free guaranteed); default
   unconstrained = sender-wallet-resolved with handshake as the PXE default (registration-free in
   practice, not guaranteed against custom sender hooks); offchain = explicit ingestion.
10. Bundled token package is `@aztec-foundation/aztec-standards@5.0.1` (`apps/extension/
    package.json:55`, `vite.shared.ts:47`); its artifact's private-balance writes use
    `onchain_constrained` (audit-verified against the installed artifact).
11. `bun run test:components` covers only `src/components` — popup tests must run via the full
    `bun run test` (audit-adopted gate fix).
12. `data-registerSender.test.ts` covers the dApp RPC path independently of the contacts UI.

**Inferences** (attackable):
- I1: The receive-discovery claim holds end-to-end in OUR stack — Phase 5 converts this to a
  tested fact and is a required ship gate.
- I2 (revised): leaving a stale sender registration behind on contact edit/delete is acceptable —
  it's visible in Advanced, deletable there, harmless to discovery, and strictly better than
  consent-free writes. (Original silent-migration inference REJECTED by audit; adopted.)
- I3 (revised): import-time adds remain acceptable because rows carry explicit per-record
  `isSender: true` from a deliberate export AND the UI now states the count + target network.
  The default-on-era provenance of old exports is acknowledged — the counted banner is the
  consent surface.

**Asks** (surfaced at the approval gate, none silent):
- A1: Approve the Phase 2 replacement copy (`Send or receive {{ token.symbol }} to see activity
  here.`) or supply preferred wording.
- A2: RESOLVED per audit + plan: no silent migration; contacts never mutate sender state (import
  adds excepted). Confirm.
- A3: Confirm the documented import semantics: `isSender` rows register on the ACTIVE network
  only (export unions across networks); full backup is the faithful path. This is current
  behavior, now documented + counted, not a new design.

## Codex audit (light tier — single audit)

**Verdict: conditional approve** (transcript: `audit-codex.md`). Conditions → disposition:
1. Real receive e2e required, no `.todo` fallback → **adopted** (Phase 5 is a required gate).
2. Correct package/delivery claims → **adopted** (Facts 9–10 corrected/narrowed).
3. Remove hidden sender migration (edit + import merge) → **adopted** (governing principle).
4. Harden import semantics (count, cap, dedup, cross-network policy) → **adopted** (Phase 1/2 +
   documented semantics + A3).
5. Fix test gates (`test:components` scope) + focused popup tests → **adopted** (gates use
   `bun run test`; new Phase 3).
6. Collapse phases 1–4 → **adopted in spirit** (UI decoupling collapsed into Phase 1; copy kept
   separate for reviewability).
7. Cover default-unconstrained delivery in e2e → **partially adopted**: primary coverage is the
   bundled constrained token (what users hold); the unconstrained-default claim is narrowed in
   Fact 9 instead of tested (a custom-hook sender simulation is out of proportion for this tier).
8. Cold-PXE fresh-device catch-up test → **adopted as in-phase stretch** (non-blocking).
9. Multi-device/dApp-amplification remarks → **acknowledged, out of scope** (pre-existing).

## Post-implementation hardening

Not warranted for this plan alone (surface-reducing UI change); the release-track `/harden
security` cadence covers the area.

## Seeds

_FINAL (post-approval, 2026-07-20; approved scope unchanged from the gate draft)._

```
/goal All phases marked ✓ in plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed `LESSONS_FILE=implementations-plan/contacts-sender-decouple/lessons/phase-N.md` in the transcript; the Phase 5 no-registration receive e2e reported green (required gate, no .todo substitute); `/code-review max --fix` complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; `bun run audit:vue` and `bun run test:e2e` both report exit 0 in the transcript.
```

```
/loop 15m Drive implementations-plan/contacts-sender-decouple forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/contacts-sender-decouple/plan.md and lessons/ (authoritative state — not the chat); run `git status` and `git log --oneline -5`. If a PR exists, `gh pr view --json statusCheckRollup` (no --watch).
2. Waiting on CI is fine — confirm it's progressing (`gh run watch <run-id>` up to 10 minutes). Use the wait productively; don't start conflicting work.
3. No task in hand? Pick the next pending step from plan.md and start it. After each meaningful edit run `bun run lint && bun run typecheck && bun run test`. Then commit → push.
4. Stuck, or facing a decision you'd normally bring to me? Call /codex xhigh with full context, reach a defensible decision, act on it, log the consult in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish, never expand scope beyond plan.md. Phase 5 blocked ≠ skippable: surface and stop.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue down the agreed path.
6. Phase green? "Green" = the phase's validation gate as written in plan.md. Run it, paste the result, mark ✓ in plan.md, file lessons, print LESSONS_FILE=..., advance.
7. All phases ✓? Post-impl sequence: /code-review max --fix → commit separately → codex post-impl audit (net diff + code-review summary + adversarial ask) → address high/critical → wrap-up report. Surface and stop.
```
