# Recon — home-refresh (Phase 0.4)

Three read-only explorers mapped the surfaces the refresh touches, against `dev` (the worktree base).
Focus: the test surface, per the owner's requirement that tests are updated correctly.

## 1. Component tests

| File | Verdict | Detail |
|---|---|---|
| `apps/extension/src/popup/components/modules/general/TokenCard.test.ts` | **breaks** | `PRIVATE / PUBLIC` assertion (line 142); `span[class*="split_dot"]` count (145–153); `token-catching-up` presence + "Catching up" text (175–176, 188, 194). Loading-block, shimmer, and fiat (B1) tests are untouched. No `Icon`/`Tooltip` stubs exist yet — add both (stub shape precedent: `TransactionCard.test.ts:43`). |
| `TokensView.test.ts` | safe | Shallow-mounts; asserts only the `backfilling` **prop** value (124–129, 147–188). Stays green if the threshold gate lives in TokensView's computation of that prop; would silently miss a threshold implemented inside TokenCard. |
| `BalanceView.test.ts` | safe | No test touches the breakdown squares/labels. Breakdown row has zero coverage today → the lock/globe swap there is net-new coverage. |
| `GasBalanceCard.test.ts` | safe but gap | All fixtures are whole-FJ; 4→2 decimals is byte-identical for every existing case. Add fractional fixtures to pin the new contract (e.g. `42.1234 → 42.12`). |
| `RecentActivityView.test.ts` | safe | Asserts service wiring only. The activity-card padding actually lives in `components/composite/activity/TransactionCardLayout.vue:144` (shared by ALL activity cards incl. the Activity page + token detail); `TransactionCardLayout.test.ts` never pins the pixel value. |
| Header / Navigation / general.vue | none exist | Consistent with the L4–L6 "not required" convention (CLAUDE.md). E2E is the convention-blessed home for the header split coverage. |

`tests/vitest.setup.ts` stubs only `chrome.*` — no global design-component stubs. `Tooltip` teleports to `#tooltip` on hover; stub it locally (never drive hover in JSDOM).

## 2. E2E surface

| File | Lines | Verdict |
|---|---|---|
| `tests/e2e/fixtures/helpers.ts` | 350 (`switchAccount`), 391 (`switchAccountByAddress`) | Click `account-selector` to open the accounts popup. **Keeping `data-testid="account-selector"` on the new NAME button makes these pass unchanged.** |
| `tests/e2e/network/in-flight-send-guard.test.ts` | 61 | Direct `account-selector` click (deliberately not the helper). Same testid-preservation fix. |
| `tests/e2e/network/connect-dapp.test.ts` | 26 | Presence-wait only. Same fix. |
| `tests/e2e/network/fee-methods.test.ts` 191–214, `price-fixture.test.ts` 43–54, `fixtures/extension.ts` 875–885 | — | Gas assertions are substring/regex-tolerant (`toContain("FJ")`, `/^0(\.0+)?\s*FJ/`) — decimals change is non-breaking. |
| `tests/e2e/endpoints.test.ts` | 31, 34, 96–100 | Counts + edit-popup input only; row TITLE never asserted → dRPC label non-breaking; add a new title assertion. |
| `waitForToast` (`helpers.ts:866–879`) | — | Case-insensitive body-text scan; reuse as-is for "Address is copied". |

No e2e anywhere references `token-catching-up`, the "Catching up…" text, or the shimmer — that's a coverage gap, not breakage. Suite membership: the three breaking-if-not-preserved files are all **network** suite; smoke switches accounts via Settings, not the header.

New e2e coverage to add: header address-copy click + toast (smoke `accounts.test.ts`); avatar/name → accounts-popup open (smoke); seeded endpoint row titled "dRPC" (`endpoints.test.ts`).

## 3. Services + design package

**incoming-transfer** (`apps/extension/src/wallet/services/incoming-transfer/`):
- Event shape `IncomingSyncStateChanged = { networkId, contract, state }` at `spec.ts:42–46`; `Methods.getSyncState` returns the bare state string (`spec.ts:342`).
- `service.ts:121` hand-inlines the event type (does NOT import the spec type — must be edited or refactored); `client.ts:53` imports the spec type (inherits new fields free); `getSyncState` is a `definePassthroughs` method (client needs zero changes for a return-shape change).
- `emitSyncStateIfChanged` defined `service.ts:491–497`; 5 call sites in `scanPublicContract` (1232, 1251, 1260, 1282, 1285). `tips.checkpointedBlockNumber` in scope at all 5; `cursor` in scope at all but 1232 (non-standard token → emit `blocksBehind: 0`, semantically right since it isn't scanned).
- Blocks-behind: `tips.checkpointedBlockNumber - (cursor.cursor?.blockNumber ?? cursor.startBlock)` — cursor block NUMBER is `cursor.cursor.blockNumber` (`PublicEventCursor`, `packages/aztec-runtime/src/pxe/public-events.ts:52–56`); `lastSyncedBlockHash` is a separate reorg-anchor field.
- **No block-time constant exists anywhere in the repo** (checked `@aztec/constants`, chain-ids, public-events). A "15 minutes of blocks" threshold must be a documented, tunable constant.
- Breaking tests: `service.scenarios.test.ts:3539` (exact-shape `toEqual` on the event object — breaks on any new key). Lines 3538–3606 assert on `getSyncState` via the local `getSync` helper (3510–3511) — changing the return to `{state, blocksBehind}` needs only the helper unwrapped to `.state`.

**network seeds** (`apps/extension/src/wallet/services/network/service.ts`):
- `_buildNetwork` (797–813) creates the seed endpoint with NO label; called from `getOrInitNetworks` (216, seed path) and `addNetwork` (318, user path) — thread an optional label through the seed path only.
- `NetworkEndpoint.label` already optional in `spec.ts:19–26` + schemas — schema-compatible, no storage-shape concern (pre-production: no migrations).
- `Local Network` seed is NOT dRPC — label only the two drpc.live seeds.
- `network/service.test.ts` never exercises seeds — no breakage; add a seeded-label assertion.

**design package cursor**:
- `.copyable { cursor: copy }` at `packages/design/src/base.css:369–371`. **`base.css.test.ts:13–17` pins the file's SHA-256** — a deliberate edits-must-be-deliberate tripwire; recompute the hash with the edit. `tokens.parity/drift` tests unaffected.
- Second site: `packages/design/src/composite/AddressDisplay.vue:56` (scoped `.address`); its 9-case test asserts no styles. No stories.
- Third site: `apps/extension/src/popup/pages/settings/advanced/account-state/senders/index.vue:182`.
- Extension has no local `.copyable` duplicate (per architecture docs; confirm with a repo-wide grep during implementation — recon tooling couldn't).

## Reuse map

- **`AccountAvatar.vue`** (`apps/extension/src/components/composite/general/AccountAvatar.vue`, L3, `data-testid="account-avatar"`, 10-case test suite) — the header avatar is a REUSE. Caveat: it renders **two-character** initials ("PA"), the approved mock showed "P" — surfaced as an Ask.
- **`ScopeAddress.vue`** — click→copy→toast→Enter-parity pattern (with wire-string sanitization) to mirror for the header address button.
- **Tooltip precedent**: `AccountsPopup.vue:85–96` (`<Tooltip position delay><template #content>`), auto-resolved, no import.
- **Copy+toast pattern**: `AccountsPopup.vue:43–53`, `BalanceView.vue:146–154`.
- **Icon test stub**: `TransactionCard.test.ts:43`.
- **Label plumbing template**: `addEndpoint`'s `label?.trim() || undefined` (network `service.ts:412–445`).

## Collision risks

1. `TransactionCardLayout` padding affects the Activity page + token-detail feeds, not just home — deliberate (consistent density), but wider than the naive file list.
2. TokenCard's `description` computed serves the LOADING block; the new idle subtitle is a different branch — don't conflate (loading tests would mask a subtitle regression).
3. Threshold must live in TokensView's `backfilling` prop computation, not inside TokenCard — otherwise `TokensView.test.ts` keeps passing while the gate goes untested.
4. GasBalanceCard 4→2 is invisible to the current suite — the new fractional fixtures ARE the signal.
5. Any new tooltip test that drives hover hits the JSDOM teleport-target failure — stub instead.
