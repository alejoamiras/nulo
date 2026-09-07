# Competing outline — "minimal-diff, reuse TokensView" (for the audit)

Same owner decisions, same scope. A different angle: the fewest new files, the most reuse of what
exists, accepting some coupling.

1. **Nav**: identical to plan.md (relabel + fourth tab).
2. **Holdings page = `TokensView` with a `variant` prop**. `pages/holdings.vue` mounts
   `<TokensView variant="full" />`; Home mounts `<TokensView variant="home" />`. `home` applies the
   comparator + cap + "View all →"; `full` renders the search input, sort toggle, pinned rule and
   fold INSIDE TokensView. No `TokenList`. The section refresh dot, in-flight import rows and
   minting rows appear on both surfaces for free.
3. **Send picker untouched in structure**: `SelectTokenPopup` keeps its `SettingItem` rows but
   sorts them with the shared comparator (pinned first, then value, using a fresh `usePrices`), and
   gains a search `Input` above the list when there are more than three tokens. No `TokenCard`
   select mode.
4. **Pins live on the `Token` entity**: `TokenService.setPinned(id, pinned)` writes a `pinned:
   boolean` on the `Token` row; `TokenInfo` exposes it; consumers read `token.pinned` from the rows
   they already have — no composable, no UI storage key, no deletion cleanup (the row dies with the
   token). The cap is enforced in the service (`setPinned` throws `PIN_LIMIT` when three are set for
   that profile + chain). Pins are then included in backups automatically via the `token` slice.
5. **Popup**: `ConfirmPopup` gains a `single` flag (`cacheStore.confirm.single = true` hides Cancel
   and relabels Confirm) rather than a new popup file.
6. **Dust**: identical to plan.md.
7. **Retire the balance-display popup**: identical to plan.md.

Delivery: two stacked PRs (nav + Home + Holdings variant; pins + popup + Send sort).

Why an auditor might prefer it: fewer files, one list implementation, pins survive backup/restore,
cap enforced server-side. Why plan.md doesn't: `TokensView` becomes a 700-line two-mode component;
a `Token` row-shape change is a future migration; the pin cap "per profile + chain" as a service
invariant is presentation policy leaking into the data layer; `ConfirmPopup` gains yet another
branch; the Send picker stays a third rendering of the same rows.
