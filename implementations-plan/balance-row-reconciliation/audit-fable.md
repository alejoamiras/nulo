# audit-fable — balance-row-reconciliation

Independent top-tier reviewer leg (Opus, the "fable" role while Fable is deactivated), run in parallel
with and blind to the codex audit.

## Round 1 — plan audit

**Verdict:** `conditional approve` — 8 conditions, all adopted into the revision.

### Findings

**C-1 — Critical (design-blocking): `onActiveProfileChanged` co-dispatches a token creator with the reconcile.**
`ProfileService.onActiveProfileChanged` has ≥2 async subscribers: `token-balance/service.ts:120` and
`token/service.ts:127` → `onActiveProfileChangedSeed` (`:133-136`) → `void this.seeder.run()`.
`EventHandler.invoke` (`packages/wallet-core/src/utils/event-handler.ts:47-61`) dispatches both
synchronously and un-awaited. `TokenService` is phase 0, `TokenBalanceService` phase 1
(`base/topology.ts:53-105`), so the seeder subscriber registers and starts first. The seeder is
single-flight with re-run coalescing (`token/seeder.ts:84`, `:91-95`) — a switch arriving during an
in-flight pass **guarantees** another full pass runs after, which calls `persist` (`seeder.ts:268`) →
`TokenService.persistToken` → `emit("onTokenAdded")` (`token/service.ts:316`) → a second
`createTokenBalance` loop.

Two consequences: **(a) duplicate pair → duplicate token card**, because `createTokenBalance`
(`:215-234`) has no existence check and `getTokenBalances` (`:146-159`) does not dedupe, so
`TokensView.vue:309` renders the token twice — a *new* user-visible defect introduced by the fix; and
**(b) silent row loss** via two concurrent `allocateUnfencedId` calls computing the same id.

**C-2 — High: events can interleave inside `init()`, and the init hydration is itself unfenced.**
`init()` attaches every subscription at `:120-125` **before** awaiting at `:127`/`:129`. The
`:127-132` hydration is the one token-map write in the service with no generation fence (contrast
`:270`, `:293-294`, `:308-309`). A switch landing during `getTokensRaw` lets `init()` repopulate the
map with the departed profile's tokens *after* the handler rebuilt it. The cited `AccountService`
precedent doesn't transfer: it owns the only writer of imported-key rows; `TokenBalanceService`'s
exposure is via peer events.

**C-3 — Medium: shared-namespace safety is sound, for an unstated reason.** Token ids are one global
sequence across profiles (`token/service.ts:298`; restore reallocates at `:721`), which
`TokenBalanceService.backup` already relies on (`:399-400`). If token ids ever became per-profile, the
create-only diff silently starts skipping real gaps. Deserves a Fact, a comment, and a test.

**C-4 — Low: the plan over-worries about codec-hidden rows.** `repo.getAll()` → `getValues()` hides
them (`entity_storage.ts:214-224`), but `nextNumericId` allocates over `getKeys()` (`:206-212`) which
sees all physical keys — so the new row lands at a fresh id and cannot overwrite the hidden bytes. The
next pass sees the pair as present. Exactly one duplicate, once, self-limiting, invisible in the UI.
Do **not** add a raw-entries pass; `purgeMalformedRows`'s key-attribution safety is unavailable here.

**C-5 — Medium: the read budget is mis-modelled and the write budget is silent.** "One batched read"
plus "one `getAccounts` per chain" is `1 + N` full-namespace deserializations by the plan's own Fact 7,
and every created row adds another full `getKeys()`. Also, a pass that creates rows is a signal
something upstream broke — log the repair count at `Warn`, not `Debug` alongside routine timing lines.

**C-6 — Medium: a single bad pair aborts the whole repair.** A bare `for … await` with one throwing
`repo.set` abandons every remaining pair. Adopt `restore-rows.ts:22-35`'s best-effort per-row idiom.

**C-7 — Medium (pre-existing): the balance root doesn't opt into key-identity matching.**
`BalanceRepository` constructs `EntityStorage` with no options (`balance-repository.ts:24-26`) while
`entity_storage.ts:43-50` names sequence-id roots as the `"numeric"` mode's intended users. File it.

### Assumptions audit

Facts 2-12 verified. **Fact 1 incomplete** — `restore()` (`:406-427`) is a third row creator writing
via `repo.set` at `:424`; it breaks Outline B's "every creator calls `ensureRow`" framing because it
must preserve backup balances. Four missing Facts supplied: the global token-id sequence (F-13); init
subscribing before awaiting (F-14); **`getAccountsRaw(profileId)` at `account/service.ts:564-567`**
(F-15, missed by the reuse sweep); and that #485 wired `onAccountAdded` at `token/service.ts:129`,
giving that event ≥2 async subscribers (F-16).

Inferences: I-1 safe but under-justified; I-2 unsafe (`1+N` reads); **I-3 unsafe — the blocking
finding**, refuted independently by C-1 and C-2; I-4 correct but insufficient — the diff is the easy
half, every real hazard lives in the commit.

### Architecture ruling

Outline A rejected as drafted (its safety argument is I-3). Outline B has the right invariant but the
wrong cost model, wrong home for the lock (the repo is a storage seam and cannot see the service-level
allocate → fence → write → emit → enqueue sequence), and omits `restore()`.

**Outline C recommended:** A's batched planner + B's committed invariant + one service-level `Lock`
taken by the reconcile and both live creating loops, with the existence set read once **inside** the
hold; `getAccountsRaw` replacing N per-chain reads; the pure diff module retained with explicit
ordering; per-pair try/catch. Deadlock checked: no in-SW service subscribes to `onTokenBalance*`, so
no re-entrancy into the held lock.

### Execution defects in the plan

**E-1 — High: the change map omits both test harnesses that will break.**
`cross-profile-isolation.test.ts:199-224` (bare `AccountService` stub at `:206`, and `this.tokens` is
non-empty after init) and `service.test.ts:279`. `svc()` is a plain spread — a missing method is
`undefined`, not a proxy. **This is a verbatim repeat of the mistake #485 recorded** in its
`lessons/phase-4.md`.

**E-2 — Medium:** `dependencies` (`:42`) must gain `AccountService.name`; the declaration exists so
topological start guarantees init-time peers rather than relying on `ensureInitialized` polling.

**E-3 — Low:** the gate commands use `bun run --cwd apps/extension vitest run`, which launches vitest
under **Node**. `CLAUDE.md:33` requires `bun --bun vitest run` (the `test` script) so launcher and
workers execute on Bun 1.4.

**E-4 — Medium:** the composition-test layer (`COMPOSITION-TESTS.md`, normative) is never considered,
and this change is its textbook target — storage + lifecycle, no PXE/bb/simulate.

### Ask rulings

1a **include** (it's the same defect, not adjacent) · 1b **separate PR** · 2 **awaited in `init()`** ·
3 **service-level lock in all three creating loops** · 4 **composition test + one storage-seeded e2e,
no 4th gate** (the gate would be the ninth `stopServiceWorker` copy — the tree has 8, not 5) ·
5 **create-only, confirmed** · 6 **`mid` confirmed**.

### Conditions

1. Adopt Outline C; delete Inference 3; record C-1/C-2 as Facts.
2. `getAccountsRaw` replacing per-chain reads; state the 2-read / 0-write steady state.
3. Record F-13 as a Fact, comment it at the diff, pin it with a test.
4. Add `AccountService.name` to `dependencies`.
5. Change map names `cross-profile-isolation.test.ts:206` and `service.test.ts:279`; per-pair
   try/catch; `Warn` repair count, `Debug` no-op.
6. Composition test + one storage-seeded e2e; no 4th gate; consolidate rather than add a 9th copy.
7. Fix the gate commands to run under Bun.
8. Correct Fact 1 and recon's `stopServiceWorker` count; file C-7 and Ask-1b separately.
