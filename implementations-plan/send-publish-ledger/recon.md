# Recon — send-publish-ledger

Base: `dev @ 06010c9b`. Two read-only explorers (reuse sweep; Send-page test harness), 2026-09-21.

## Reuse map

| Capability | Existing code | Verdict | Why |
|---|---|---|---|
| Fee-payer-names-the-account predicate + approved copy | `apps/extension/src/popup/components/modules/send/fee-privacy.ts:23-29,144-152` (`NOTICE_TITLE`, `NOTICE_BODY`, `feePayerNotice`), pinned by `fee-privacy.test.ts:39-71` | **reuse-as-is** (copy) / **adapt** (expose a shape lookup that does not need a `FeeMethodOption`) | The sheet needs the same two sentences without owning a method row |
| You / To / Amount visibility from `(origin, destination, payer)` | none — `send.vue:127-128` holds raw `"private"\|"public"` refs; `transferType` (`send.vue:256-262`) maps them to an enum only | **build new** (pure helper) | Searched `src/utils/*`, `popup/pages/send-*.ts`, `modules/send/*` for `fact`, `visibility`, `publishes`, `ledger` — nothing derives visibility |
| What the page knows about the payer | `send.vue` receives only `feeSettings` (`v-model`) and `needsFeeJuice`; `settingsForMethod` (`fee-helpers.ts:78-101`) maps `fj → {kind:"fj"}`, `private_fpc`/`fpc → {kind:"fpc", fpcId}` | **reuse-as-is** for the gate (derive it from the object that is submitted) + **adapt**: one display-only model from the card for the payer's type | `effectiveMethod` is internal to `FeeSettingsCard.vue:177-183` |
| Bottom sheet chrome | `components/Popup/Popup.vue` (teleport to `#popup`, `focus-trap`, backdrop close, slide transition; takes the slot's `order` as its z-index while `PopupCard` takes `len − order`), `PopupCard.vue`, `ui/Popup/PopupHeader.vue` (`popup-close-btn`), composed by `components/composite/FormPopup.vue` (`show`, `title`, `submitLabel`, `submitDisabled`, `submitLoading`, `submitTestId`, `submitVariant`, `#aboveSubmit`) | **reuse-as-is**, rendered locally by the Send page | The token picker on the same page is this chrome. Gap: **no Escape handling** in `Popup.vue`; added in the new sheet, not in the shared primitive |
| Other sheet precedent | `components/LegalAcceptanceSheet.vue` + `utils/legal-sheet.ts` (global singleton, `role="dialog" aria-modal`, no focus trap, no Esc) | not reused | One-off, mounted in `app.vue`; its a11y gaps are not a pattern to copy |
| Tag on "Fee Source" | label is in the CHILD `FeeMethodSelector.vue:21` (`.fee_label` from `fee-shared.module.css`); `packages/design/src/ui/Tag.vue` is a bordered 22px chip | **build new** inline marker inside `FeeMethodSelector` | `Tag.vue` would grow the label row; the approved tag is zero-height. A `lockedMethod` mount never renders the selector — irrelevant on Send (`lockedMethod` is dApp-window only) |
| Square-mark vocabulary (hollow / filled / orange) | none | **build new** as a shared CSS module next to `fee-shared.module.css` | Three consumers (strip, sheet, tag); a component would need ≥10 cases for three class names |
| CTA + label swap | `packages/design/src/ui/Button.vue` `variant="cta"`, `loading`, `disabled`; idiom `{{ cond ? "A" : "B" }}` (`send.vue:643,654`) | **reuse-as-is** | — |
| Remedy link | `FeeSettingsCard.vue:782-788` anchor to `FEE_JUICE_BRIDGE_URL`, `target="_blank" rel="noopener noreferrer"`; tested `FeeSettingsCard.test.ts:1994-2003` | **adapt** (moves into the sheet with its testid) | Never clicked in any test today — attribute-only |
| Submit flow | `handleSend` (`send.vue:315-402`): gate → snapshot → `executeTransfer` fire-and-forget → `leaveSend()` | **adapt**: the gate decision moves inside it | The review step decides what triggers it, not how it runs |
| Page-level mount test | `popup/pages/holdings.test.ts:57-86` (relative import, `createTestingPinia`, `STUBS`); `send.vue` has **no** test | **adapt** the template | — |
| Network e2e harness for Send | `tests/e2e/network/fee-methods.test.ts` helpers (`openSend`, `feeView`, `waitForFee`, `shot`, `fillAndSubmit`), fixtures `tokenReadyExtension` (no gas), `feeJuiceReadyExtension` (public FJ only), `feeJuiceImportedExtension` (public + private FJ); all three payers exist in the sandbox | **adapt** | — |
| Shared e2e send helper | `tests/e2e/fixtures/helpers.ts:1083-1180` `sendTransfer` clicks `send-submit` and waits for the toast | **adapt** — must click through the sheet when the gate is up | Used across the network suite |

## Collision / dedup risks

1. **`sendTransfer` and `fillAndSubmit` break in the gated state.** One click on `send-submit` no longer submits when the origin is private and own Fee Juice pays. Every network test that sends private-origin from a public-FJ-only wallet hangs on the toast until the helpers learn the sheet.
2. **The tag re-opens two owner rulings** recorded in `send-fee-privacy-notice/plan.md:33-46,70-73`: "no privacy badge on the fee row" and "no change to `FeeMethodSelector`". The owner reversed both in session on 2026-09-21 after seeing the design artifact; the new plan records the quotes.
3. **`FeeSettingsCard.test.ts:1901-2013`** (the notice block) pins copy, shape and the remedy's `rel` hygiene — it moves with the notice, it is not deleted.
4. **Footer precedence.** `needsFeeJuice` already takes the primary button over; the review branch applies only when it is false. A payer that cannot pay yields `feeSettings === undefined`, so the two never overlap — pinned by a test anyway.
5. **Consumers of the old row**: `ARCHITECTURE.md:225`, `.claude/skills/e2e-testing/SKILL.md:251` (recommends waiting on the notice row as proof of the effective method), `tests/e2e/send-fee-privacy.test.ts:50`, `network/fee-methods.test.ts:230,254,255,388,397,462,495`.
6. `biome.json:409,413` calls pages "L5" and windows "L6"; CLAUDE.md numbers them the other way. The enforced rule (modules import neither) is unambiguous.

## What each test layer can stage

| To prove | Unit | Component / page mount | Smoke e2e | Network e2e |
|---|---|---|---|---|
| Cell content for every `(origin, destination, payer)` incl. payer unresolved | **yes** — exhaustive loop | **yes** — strip swept | no | sampled, on real states |
| "Review send" + mandatory sheet only when origin private ∧ own FJ pays | **yes** | **yes** — `send.vue` mount with the fee card stubbed | no | **yes** |
| Sheet opens from the strip; close / Esc / backdrop return to an intact form | — | **yes** | no | **yes** |
| Both notice wordings + remedy in the sheet | pinned today | **yes** | no | **yes** |
| "Send now" really sends; one tap still sends elsewhere | — | call-count only | no | **yes** — tx confirmed |
| Tag only in the gated state | via predicate | **yes** | absent under a dead RPC | **yes** |
| Payer flips under the user's finger | — | **yes** (deterministic) | no | no (not stageable on demand) |
| Keyboard and focus | — | **yes** (`Dropdown.keys.pins.test.ts` is the template) | no | Esc only; no `Tab` precedent in e2e |
| Both themes | — | no | no | screenshots via `shot()` (`NULO_E2E_SHOT_DIR`, opt-in, no pixel diff) |

**Why smoke stages almost nothing here.** Smoke runs against Testnet with no sandbox. Token seeds are rejected unless `chainId === 0` (`src/e2e/chrome-storage-token-seeds.ts:22,53`), so smoke never has a token; without one `isBlockedTransfer` is true and `SendTypesCard` is not rendered (`send.vue:104,574`). Private balances are PXE-local simulation, never an interceptable request; FPC discovery is bb-bound. `interceptRpc` knows only `refuse` and `redirect`.

## Conventions to match

- Pure helpers colocate with their owner: page-adjacent `popup/pages/send-*.ts` or module-adjacent `modules/send/*.ts`, each with a sibling test.
- Component tests: explicit `STUBS` for auto-imported design components; service clients `vi.mock`ed as `function` constructors (vitest 4); `createTestingPinia` for page mounts.
- e2e: `data-testid` only; gate waits on `data-*` state attributes, never on visibility (a leaving `<Transition>` is visible while logically closed); `waitForFunction` always with a non-empty options object; PR lanes run retry 0; `fee-methods.test.ts` runs proverless on the dedicated `heavy` lane and is excluded from the shard pool (`pr-extension-network-e2e.yml:173,196`); `scripts/ci-cd/behavior-gating.test.ts` pins `selfpay-phase`'s placement there, not the pairing. A new network file must still be placed deliberately.
- Anti-vacuity: `send-fee-privacy-notice/lessons/phase-5.md` § "The confidence pass" — every new e2e is run against a realistic mutant and must go red; an artificial mutant proves only that the test can fail.
- No Storybook stories for L4/L5/L6 pieces; no visual-regression tooling in the repo.
- Local network runs on this machine need `NODE_OPTIONS=--dns-result-order=ipv4first`.

## Absence claims — search trail

- Visibility helper: grepped `fact`, `visibility`, `publishes`, `ledger`, `senderFact` in `apps/extension/src/{utils,popup/pages,popup/components/modules/send,components/composite/send}`.
- `inert`, `aria-activedescendant`, axe: no hits in `apps/extension/src` or any `package.json`. (A roving tablist does exist — `onboarding/pages/create.vue:125` — the explorer missed it; nothing here needs one.)
- Visual regression: `pixelmatch`, `toMatchImageSnapshot`, `chromatic`, storybook test runner — no hits.
- Mutation tooling: `stryker`, `mutation` in `package.json`s — none; the convention is manual (above).
- `Tab` key in e2e: no `keyboard.press("Tab")` anywhere under `apps/extension/tests/e2e`.
