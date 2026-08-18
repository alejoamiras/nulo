# Arc 1 — fix-account-generation-fence (F-B27 residual + the pinned finally)

[mid] tier of the 2026-08-16 remediation follow-ups ([spec](../remediation-followups/plan.md)). Two classified **behavior fixes**, each prove-first (RED before fix). Dual audit (codex + fable) over the complete arc diff; bounded loop.

Recon (2 parallel agents, against `dev@60c299fa`): both items confirmed live; all anchors current.

## Item 1 — F-B27 residual: `setupActiveAccount` stale-activation fence

**Confirmed race (recon-constructed interleaving):** `appStore.setupActiveAccount()` (`apps/extension/src/stores/app.store.ts:54-96`) suspends at `storageLocalGet` (window 1) and inside `commitScopeChange → refreshInFlight` (window 2, the wide one — journal RPC). A profile activation superseded mid-flight resumes after the winner completed and lands `account.value = <loser's account>` — and then **poisons the durable global `nulo:ui:activeAccount` key** (`:92-94`), which survives into the next bootstrap. `commitScopeChange` is a send-in-flight guard only; it has no notion of which activation is committing. Two of the four assignments bypass even that guard (the address-equality early-returns `:70-72`, `:81-84`).

**Both callers need covering; only a store-internal fence covers both:**
- `useProfileBootstrap.ts:101` — the composable's `isCurrent` fence stops at the call boundary (`setupActiveAccount` takes no args; next re-check is after the store write lands). Return value discarded.
- `popup/app.vue:127` — the network watcher; completely unfenced, invisible to `bootstrapGeneration`.

**Fix (store convention, not a new pattern):** capture `profile.value?.id` + `network.value?.id` at the top of `setupActiveAccount`; re-check immediately before **every** `account.value` assignment (all four, including the two guard-bypassing early-returns) AND before the `storageLocalSet`; return `false` on staleness. This is the file's own idiom (`syncNetworkStatus:147/150`, `refreshInFlight:212/250`, `syncTransactions:352-370`). Self-contained — no import of the composable (module-private counter + would create an import cycle), no new abstraction.

**Behavior deltas (intended, and only these):** a stale run no longer assigns `account` and no longer writes `nulo:ui:activeAccount`; it returns `false`. Fresh runs byte-identical. The e2e `switchToNetwork` helper synchronizes on the WINNER's `nulo:ui:activeAccount` write — winner path unchanged, so its contract holds.

**RED tests (before fix):**
1. Store-level: `app.store.test.ts` harness (raw pinia + chrome.storage stubs). Hold `setupActiveAccount` at window 1 via a deferred `chrome.storage.local.get`; flip `appStore.profile` (and `accounts`) to profile B mid-flight; resolve; assert `account.value` is NOT the stale profile's account and `nulo:ui:activeAccount` was NOT written by the loser. RED today (loser lands), GREEN after.
2. End-to-end composable variant: extend `useProfileBootstrap.test.ts`'s superseded-cross-profile test family with a variant that parks run A **inside the store action** (hang the storage read, not `getOrInitNetworks`) and asserts `appStore.account` after the drain.

## Item 2 — remove the pinned `void next.finally(() => {})` (serializePerTuple)

**Confirmed pin** at `apps/extension/src/wallet/services/account/service.ts:184-189` (comment + line). On op-reject the un-awaited derived promise re-raises → the SW's global `onunhandledrejection` (`wallet/index.ts:66-68`) logs a **duplicate Error-level entry** into the persisted session log buffer — a phantom "wallet error" for benign, already-handled failures (e.g. `Profile locked` on a lock/switch race). Realistic reject paths: `getProfileSecret` (`Profile locked` / `Invalid profile id` / `unauthorized`), bb.js init, storage set.

**Fix:** delete the pin (line + comment). `tupleLocks` + `maxHoldMs: null` stay. Caller semantics unchanged (`KeyedLock.withLock` re-throws to the caller and advances the queue).

**RED test (before fix; recon-verified recipe):** in the account service suite — `process.on("unhandledRejection")` listener (vitest 4 defers to user listeners; no config change), reject lever = profile stub's `getProfileSecret: async () => undefined` → `"unauthorized"` before any bb.js; flush one macrotask (`setTimeout 0` — Node emits on tick boundary, not microtask); assert: (a) zero unhandledrejections ← **RED today**, (b) caller still rejects `"unauthorized"`, (c) the tuple's FIFO still advances (a second create on the same tuple runs — load-bearing since `maxHoldMs: null` has no watchdog). Cover both callers (`createAccount`, `ensureDefaultAccount`).

**Correction to the audit record:** the original audit row called this "dead code / vestigial finally" — the actual defect is the *emission*, as the pin comment states. Note for remediation.md.

## Validation
Item-level: the new RED→GREEN pins + `app.store.test.ts` + `useProfileBootstrap.test.ts` + account service suite. Arc-level: `lint`, `typecheck:all`, affected suites, `audit:vue` (apps/extension touched), **armed smoke**. Learning #3 applies: after EACH item's fix, re-run the OTHER item's pins (both touch account-flow state).

## Dual audit (codex + fable) over complete arc diff — bounded (initial + max 2 resumes)
_pending._
