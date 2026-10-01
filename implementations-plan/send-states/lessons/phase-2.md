# Phase 2 · The fee card acts on the verdict

## Step 1 · Red on `85c4d20f`

The step-1 tests, run against the fee card, its helpers, `send.vue` and the execute window as they
are on `85c4d20f` (P1 touched none of them; `git diff --stat 85c4d20f -- apps/extension/src/popup`
lists only the six test files):

`apps/extension`: `bun --bun vitest run src/popup/components/modules/send/ src/popup/windows/execute/ src/popup/pages/send.integration.test.ts`
→ exit 1; 5 files and 23 tests failed, 474 passed.

- `fee-helpers.test.ts` (3): the options are ignored, so a short row is built enabled with no
  reason and no `setAside` (`expected { type: 'fpc', …(4) } to deeply equal { type: 'fpc', …(7) }`),
  and `defaultSponsor` and `resolveSavedSelection` still return it.
- `fee-privacy.test.ts` (4): every walk still reaches the sponsor (`expected 'fpc:spon' to be
  'none'`, `… 'hold'`, `[ 'fpc:spon', 'fpc:spon' ]` for `[ 'fj', 'fj' ]`).
- `FeeSettingsCard.test.ts`, Send (11) and non-Send (2): the verdict is ignored. The sponsor stays
  selected (`expected 'fpc' to be 'fj'`, `… 'private_fpc'`, `… undefined`), its row stays enabled,
  no `fee-sponsor-short` is drawn, no `data-sponsor-funding` is set (`expected undefined to be
  'funded'`), and outside Send the settings stay the sponsor's (`expected { Object (paymentMethod) }
  to be undefined`).
- `OperationCard.fee.test.ts` (2): the card keeps emitting the sponsor
  (`expected [ +0, { paymentMethod: { …(2) } } ] to deeply equal [ +0, undefined ]`) and sets no
  `data-sponsor-funding`.
- `send.integration.test.ts` (1): the held estimate's short verdict lands and nothing shows it
  (`Cannot call text on an empty DOMWrapper` on `fee-sponsor-short`), after the harness proved the
  estimate went out with the sponsor as payer.

Controls, green on `85c4d20f` (8 of 8, `-t` over their names, exit 0): an estimate with no verdict,
a verdict on an id the card does not list, a verdict on an address the row does not have, and a
hand-added sponsor's old-address verdict after its edit; the execute window disabling Confirm when
the card withdraws its settings and approving the pick that replaces them
(`windows/execute/index.test.ts`, the real window: `OperationCard.fee.test.ts` mounts the card
alone, so the window's half of that red case lives beside the window's other approval tests); and
the profile, account and network switches while the sponsor's estimate is out. The base ignores
the field, so each passes there; after the change they pass only because the switch supersedes the
estimate, which the no-switch twin (red above) shows would otherwise reach the card.

## Step 2 · Implementation notes

- A sponsor row is built by one `sponsorOption` helper: two more branches inside
  `buildFeeMethods`' loop would have taken it past the cognitive budget.
- The integration harness leaves `DropdownItem` unresolved, so a menu row's `disabled` prop lands
  as an attribute there rather than as the real item's `aria-disabled`; its `offered` helper reads
  both, so the controls cannot pass on an attribute that is never written.
- The first lint run counted 32 warnings: the identity-switch rows assigned inside arrow
  expressions (`noAssignInExpressions`, three). They became store patches applied with
  `Object.assign`; lint is back to the base's 29.
- Outside Send, a recovery recommit after a drop re-resolves as the card always does: the saved
  pick (set aside, so nothing) and then the network default. With a hand-added sponsor dropped and
  Nulo's own sponsor listed and unjudged, that default is Nulo's sponsor, and the notice then names
  it as the payer. Only a degraded gas read that recovers reaches it; the plan's case (one sponsor
  row) is pinned, this one is not.

## Gate ✓

| Command | Exit | Counts |
|---|---|---|
| `apps/extension`: `bun --bun vitest run src/popup/components/modules/send/ src/popup/windows/execute/ src/popup/pages/send.integration.test.ts` | 0 | 29 files, 497 tests passed |
| `bun run lint` | 0 | 29 warnings and 3 infos, as on the base; complexity baseline OK |
| `bun run typecheck:all` | 0 | 15 workspaces |
| `bun run test:all` | 0 | extension 608 files passed, 3 skipped; 8080 tests passed, 4 skipped, 8 todo (31 more than P1: the 23 red cases and 8 controls). aztec-runtime 255 passed, 2 skipped; passkey-rp 5 passed, 6 skipped; every other workspace passed with no skip |
