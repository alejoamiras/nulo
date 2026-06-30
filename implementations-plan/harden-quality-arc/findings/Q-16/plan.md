# Q-16 — AppServices honest optionality (kill the `null as unknown as Client` lie) · tier: **mid**

**Re-verify (STEP 1, vs `dev-quality` @ `4cb91af`):** VALID. `apps/extension/src/utils/core.ts:44-50` `AppServices` declares `network`/`transaction`/`account` as REQUIRED clients; `createAppServices()` inits them `null as unknown as <Client>` (`:75-77`); the jsdoc (`:40-42`) explicitly flags the lie as a DEFERRED tightening — Q-16 IS it.

## Decision ledger (codex `019f...ffv3W9F3` + main-agent investigation)
> The opus Plan leg malfunctioned (returned a dev-workflow skill-redirect, 0 tool uses). Substituted a main-agent core.ts investigation as the 2nd design leg; codex is the independent audit. Both converge.

**Facts (verified):**
- `managers` Proxy `get` (`core.ts:98-101`) returns the raw property — for an unset lazy client it returns `null` (the `null as unknown as`), it does NOT throw. `set` writes through.
- 3 lazy clients assigned at unlock: `useProfileBootstrap.ts:28` (network), `:52`/`app.vue:120`/`auth.vue:103`/`new-profile-helpers.ts:27` (account), `core.ts:138` (transaction). `bootstrapActiveProfile()` creates all 3 before `isLogined=true` (`useProfileBootstrap.ts:70-76`); router redirects auth routes (`popup/index.ts:68-75`) — an OPERATIONAL (not type-enforced) unlock gate.
- Reads: network 22, transaction 4, account 12 (~38).
- **5 null-tolerant sites** (must NOT get a throwing accessor): `app.vue:91`, `app.vue:119` (`managers.account?.disconnect()`), `useProfileBootstrap.ts:27` (`managers.network?.disconnect()`), `:51` (account), `core.ts:133` (`if (managers.transaction) …` — the `if` narrows `|null`→non-null).

**Decisions:**
1. **Type the 3 lazy fields `<Client> | null`** (NOT `| undefined`). codex's strict-preservation correction: runtime is already `null`, so `| null` keeps bare-read + TypeError shape byte-identical; `undefined` would change observable bytes. `createAppServices` sets them `null` (typed, no `as unknown` lie).
2. **Add `requireNetwork()/requireTransaction()/requireAccount()`** (throw a clear "X service not initialized" if null) for the ~33 method-call read sites. Behavior-preserving: in unlock-guarded flows the client IS set → returns it; pre-assignment it throws — REPLACING the current `null.foo()` TypeError (a crash either way; clearer message). Add non-throwing `getNetwork()/getTransaction()/getAccount()` (`| null`) for tolerant sites that want it.
3. **5 tolerant sites unchanged** — `?.`/`if`-guarded reads typecheck + behave identically under `| null`.
4. **Assignment sites unchanged** — `managers.X = client` (Proxy `set`, field typed `| null`).
5. **Keep the lazy clients ON `managers` (typed `| null`), NOT codex's fuller eager-only split.** Rationale: `| null` already makes any unchecked `managers.network.foo()` a COMPILE error (the finding's actual goal = compile-time safety); the full split is more churn for marginal gain. Both behavior-preserving. (codex preferred the split; chose the lower-churn variant.)

## Phased plan
- **Phase 1** — `core.ts`: type the 3 fields `| null`; `createAppServices` → `null` (drop `as unknown`); add `requireNetwork/requireTransaction/requireAccount` (throw if null) + `getNetwork/getTransaction/getAccount` (`| null`). Update the jsdoc (the deferral is now done). Unit tests (new `core.test.ts` or extend): require*() throws when unset with the exact message; get*() returns null when unset; both return the client after assignment. Gate: extension units + typecheck.
- **Phase 2** — migrate the method-call read sites `managers.X.foo()` → `requireX().foo()`. **IMPLEMENTED SCOPE (vue-tsc gap discovered during impl):** only the **6 compiler-forced `.ts` sites (app.store.ts)** were migrated — `vue-tsc` does NOT strict-null `.vue` `<script setup>`, so the ~30 `.vue` reads compile clean under `| null` and are LEFT raw (all unlock-guarded; behavior-identical; **codex post-impl confirmed no pre-unlock-reachable raw deref** — NewNetworkPopup/NewAccountPopup/settings-networks are auth-required, app.vue:121-124 runs post-bootstrap). The ~33 estimate (codex+main blueprint) assumed a typechecker that flags `.vue`; it doesn't, so forcing the ~30 `.vue` edits is churn for no compile-safety + the `require*` throw never fires there. LEAVE the 5 tolerant + 6 assignment sites. `require*/get*` is the convention for new code; closing the `.vue` gap is a separate infra task.
- **Phase 3** — BUG-PIN test: pre-unlock `requireNetwork()` throws (clear msg) where the old code would `null`-deref; a tolerant `getNetwork()?.disconnect()` no-ops when unset. Confirm no read site captured `const n = managers.network; n.foo()` unguarded pre-unlock (codex flagged app.store.ts:79/112/119 check store-state not manager-readiness — verify those reads are post-unlock).

## Security / adversarial
No trust boundary (popup-internal service wiring). The lie HID a real null-deref surface; the refactor turns it into a compile error + a clear runtime throw — strictly an improvement, behavior-preserving (guarded flows never hit the throw). No dApp-facing change.

## Risks
1. A read site reachable pre-unlock that currently tolerates `null` beyond the 5 found → would turn into a throw. Mitigation: per-site guard-check in Phase 2; the grep for `?.`/`&&`/`if` on these clients found only the 5.
2. vue-tsc (template type-checking) may surface `| null` errors in `.vue` templates that read `managers.network.x` directly — those become Phase-2 migration sites too (grep templates).
3. `null`→`null` (kept) means zero runtime-value change; only the static type tightens.

## Gate (every PR): extension units + smoke + FULL network. Per-arc tail: `/code-review max --fix` → codex post-impl.
