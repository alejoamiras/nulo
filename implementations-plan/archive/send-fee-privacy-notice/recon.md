# Recon — send-fee-privacy-notice

Read against `dev` @ `b0ebbb40` (the worktree base). One batched reuse sweep; every load-bearing
claim below was re-checked by hand against the tree before it went into the plan.

## Reuse map

| # | Capability needed | Existing code | Verdict | Note |
|---|---|---|---|---|
| 1 | Default fee-method resolution | `settledSelection` inside `modules/send/FeeSettingsCard.vue` (un-exported, SFC-private); `resolveSavedSelection`, `buildFeeMethods`, `settingsForMethod` in `modules/send/fee-helpers.ts` | **adapt** | The default policy is the only piece with no direct unit test, and it ignores `disabled`. Extract to a pure helper; keep the legacy branch verbatim for a `null` origin. |
| 2 | Saved selection storage | `UI_STORAGE_KEYS.FEE_PAYMENT_METHODS` (`popup/constants/storage-keys.ts`); writer `persistSelection` in the card; **second reader/writer** `popup/pages/settings/fpcs/index.vue` (delete-prune loop); whole-key remove in `settings/security/reset.vue` | **adapt** | Three sites move in lockstep. Not in any backup slice, migration, or e2e seed. |
| 3 | Notice presentation | `send-fee-nudge` and `fee-init-degraded` rows in the card + `fee-shared.module.css` `.detail_row`; `Banner` in `@nulo/design/ui` | **reuse-as-is** (the inline row idiom) | `Banner`'s action is a callback button, the card's idiom is an `<a target="_blank">`; two rows above the new one already use the inline shape. |
| 4 | Opening the bridge | `FEE_JUICE_BRIDGE_URL` (`fee-helpers.ts`); `<a target="_blank" rel="noopener noreferrer">` in the card; `window.open` in `send.vue` | **reuse-as-is** | No `useExternalLink` composable exists (searched `useExternalLink`, `handleExternalLink`, `externalLinks` across `apps/extension/src` — zero hits). |
| 5 | "Needs fee juice" takeover | `feeJuiceMissing` computed + `needsFeeJuice` `defineModel` in the card; sole consumer `send.vue` | **adapt** | Today: fires when the *selected* method is confirmed zero. Needed: fires when *no* method can pay. |
| 6 | Other mounts of the card | `send.vue`, `windows/execute/OperationCard.vue`, `popups/RevokeAuthwitsPopup.vue`, `popups/ChangeAuthwitsRegistryPopup.vue` | **reuse-as-is** ×3, **adapt** ×1 | Four mounts, not two. Only `send.vue` has an origin/destination concept; the other three never set the new props. |
| 7 | Card test harness | `FeeSettingsCard.test.ts` — real `balances.store` on a fresh pinia, hand-stubbed `chrome.storage.local`, functional `FeeMethodSelector` fake (`pick-{type}` buttons), `baseProps()`, `deferred()`, `lastEmittedSettings()`; `fee-cards.comount.test.ts` | **reuse-as-is** | New `describe` blocks in the same file. |
| 8 | E2E helpers + fixtures | `selectFeeMethod`, `setActiveSendType`, `sendTransfer`, `waitForTxConfirmation`, `clickByTestId`; fixtures `tokenReadyExtension`, `feeJuiceImportedExtension` (public **and** private Fee Juice, exercised by `network/fee-methods.test.ts`), `feeJuiceReadyExtension` (public only, **referenced by no test**) | **reuse-as-is** | See "E2E constraints". |
| 9 | Pure-helper convention | `popup/pages/send-fiat-gate.ts` (+ test): pure function, discriminated-union verdict, fail-closed | **build new** at `modules/send/` | Must live at L4: `biome.json` bans `@/popup/pages/**` imports from `modules/**`, and the consumer is the card. No `fee-privacy*` file or `transferPrivacy`/`originPrivacy` symbol exists (searched both names across `apps/extension/src`). |
| 10 | Quality guards | L4 `noRestrictedImports`, complexity ≤ 15 / ≤ 80 lines, `storage-facade-ban.test.ts`, `log-payload-ban.test.ts`, testid rules | constraints | Neither `FeeSettingsCard.vue` nor `fee-helpers.ts` carries a complexity suppression today — inlining the chain into the SFC risks the first one. |

## Findings that shape the design

**F1 — the mainnet default ignores `disabled`.** `settledSelection` picks `private_fpc` on mainnet with
`methods.value.find((m) => m.type === "private_fpc")` and no `disabled` check. With zero private Fee
Juice the card lands on an unpayable method, `settingsForMethod` returns `undefined`, and the CTA
becomes "Get Fee Juice" — even when the account holds public Fee Juice. Pinned by
`FeeSettingsCard.test.ts` "mainnet with zero private fee juice: no usable settings, emits
needsFeeJuice + shows the nudge". That test must keep passing unchanged for a `null` origin.

**F2 — `privateFeeJuice: null` is two states on the wire.** `gas-balance-reader.ts` returns `null` both
when no protocol PrivateFPC is registered and when the private read threw or returned no slot.
`buildFeeMethods` renders both as `disabled` / "no balance". A resolver that only skips `disabled`
rows would fall back to a public payer off a balance nobody read. The card can tell the two apart:
it holds the registered-FPC list, so *registered + `null`* is unread and *not registered* is absent.

**F3 — a per-leg unread does not start the store's retry loop.** `balances.store` goes `degraded` (and
retries) only when the whole gas fetch fails; a `null` private leg inside a successful object is
`ready`. The SW reader stale-marks its own cache on a failed leg, so the *next* read recomputes, but
nothing in the popup asks for one.

**F4 — the saved pick is one record per account.** `persistSelection` writes
`fpms[address] = method`; `resolveSavedSelection` outranks the default. A public Fee Juice pick made
on a public send governs every later private send.

**F5 — possible double notice.** A selected `fj` with a confirmed-zero balance already renders
`send-fee-nudge`. Under a private origin the new notice's condition would hold too. Precedence must
be explicit.

**F6 — a pick made during init can be unpayable.** `methods` carries no balances until
`isInitComplete`, so every row is enabled while loading; `commitFromEntry` then keeps a mid-init pick
without re-checking it.

## E2E constraints

- The sandbox network is not mainnet, so a Sponsored FPC is discovered and outranks everything by
  default. No fixture or build flag hides it (searched `allowSponsored`, `DefaultSponsoredFpc`,
  `hideSponsor` under `tests/e2e/fixtures`). The *defaulted* private→public fallback is therefore
  unreachable in e2e and is pinned at the component layer; e2e reaches the notice by hand-picking
  public Fee Juice on a private-origin send, which is the "a chosen leak still warns" invariant.
- A private-origin send needs a private token balance. Fixtures mint public tokens only;
  `network/transfers.test.ts` gets a private balance by shielding first (public → private, paid by the
  sponsor).
- `network/fee-methods.test.ts` runs in a dedicated heavy CI lane, outside the shard pool; adding
  tests to it changes no pinned file list.
- The `// SKIP: clusters A+B` comments in `fee-methods.test.ts` / `transfers.test.ts` are stale: both
  files gate only on `test.skipIf(!hasConfig)`, and
  `implementations-plan/network-test-triage/full-suite-findings.md` records both clusters fixed.
- No smoke test opens the Send page today (`registration.test.ts` only asserts `actions-send` is
  visible). Smoke has no node, so balances are unread there — which makes it the one e2e layer that
  can observe the fail-closed rule.
- Selection is `data-testid`-only. The `send-fee-method-{subtitle}` namespace belongs to
  `selectFeeMethod`; new testids must stay out of it.
