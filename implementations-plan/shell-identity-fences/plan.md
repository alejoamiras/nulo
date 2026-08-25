# shell-identity-fences — batch 6 of audit-448-remediation (rev 1)

Fixes **N-05 (Major)** — the popup's network watcher runs 4 unfenced awaits and a superseded run's writes land a cross-chain active account — **N-08 (Major, split verdict)** — auth.vue's unbounded busy-wait bricks the unlock spinner on any bootstrap RPC failure (the real half) and its unguarded continuation can act under a hijacked identity (the rare half) — **N-23 (Low)** — RecentActivityView's reset is keyed on address only, so a same-address profile switch leaves the predecessor's progress card rendering — **N-22 (Minor)** — EditProfilePopup's silent catch is the popup family's only outlier — and executes the **owner-authorized N-09 REMOVAL** of the vestigial aztecReset/sentinel path (decision of record: adjudication-2026-08-24). Spec: runbook batch 6; recon: [recon.md](./recon.md) (removal inventory verified item-by-item + grep-closed, with two beyond-runbook additions and two e2e spec edits the runbook missed). Base: dev `2665af59`. Tier: **mid** (rubric: user-visible feature REMOVAL + two Majors in the shell; blast radius popup-wide).

**Scope:** the four fences + the N-09 removal exactly as inventoried. OUT: any change to the notification store/NotificationManager beyond proving survival (three inline producers stay); TransferContent gaining profile/network fields (TaskService already clears on switch — recon-resolved); a batch-wide shared-fence refactor beyond the one helper below.

## Clarifying questions (self-answered; codex ratifies)

- **Done =** all five findings' fixes in place with discriminating pins; the removal leaves zero sentinel/aztecReset references outside generated types and the unrelated boot-sentinel e2e infra; both edited network specs green; full battery (audit:vue + smoke + network, both REQUIRED — popup/UI touched) green; PR merged.
- **Quality bar**: production. **The removal is squarely owner-authorized** — the goal's prohibition on feature removal explicitly carves out exactly this path.

## Architecture & Implementation

### Shared fence primitive (the one extraction)

`apps/extension/src/composables/runFence.ts` (C0-pure, no chrome.*): the generation-fence idiom `useProfileBootstrap` hand-rolls, extracted because this batch adds its 2nd and 3rd users:

```ts
export function createRunFence() {
	let generation = 0
	return {
		/** Start a run: bumps the generation and returns isCurrent for THIS run. */
		begin(): () => boolean {
			const mine = ++generation
			return () => generation === mine
		},
	}
}
```

- `useProfileBootstrap` is NOT migrated (working, 12-case-pinned code — churn for no behavior); a comment cross-references the shared helper.
- Tests: ≥10 cases per CLAUDE.md composable floor (begin/bump semantics, interleaved runs, closure independence, post-supersede false-forever, etc.).

### N-05 — fence the network watcher (`app.vue:100-131`)

- `const networkFence = createRunFence()` at setup scope. Watcher body: `const isCurrent = networkFence.begin()` first line; after EVERY await: `if (!isCurrent()) return`. Additionally capture `const targetChainId = appStore.network.chainId` at entry and pass THAT to the getAccounts calls (not a live re-read) — writes are both fenced and self-consistent.
- app.vue has no test harness; the fence LOGIC lives in `runFence.ts` (unit-pinned), and the wiring is covered by the smoke suite + an adversarial component test is impractical (L6 orchestration — per CLAUDE.md not required). The pin strategy: unit-pin the primitive hard; wire-verification via the existing network-switch e2e paths.

### N-08 — bound + guard the unlock continuation (`auth.vue`, `app.vue:145`)

- The busy-wait becomes bounded and identity-aware:
```ts
const UNLOCK_WAIT_MS = 15_000
const deadline = Date.now() + UNLOCK_WAIT_MS
while (!appStore.isLogined) {
	if (Date.now() > deadline) throw new Error("Unlock timed out — please try again")
	await sleep(100)
}
```
  The throw lands in the existing catch → the family-standard error toast (N-22's pattern) + the `finally` releases `isAwaitingResponse` — the spinner can no longer brick.
- Post-wait identity guard (the hijack half): `if (appStore.profile?.id !== activeProfile.id) return` before the continuation writes (activeProfile is THIS unlock's response, already in scope).
- `app.vue` `onActiveProfileChanged`: wrap `await bootstrapActiveProfile(profile)` in try/catch + log — an emitter callback must not convert an RPC failure into an unhandled rejection that starves every waiter.
- Tests (auth.test.ts, harness exists): bricked-spinner pin (isLogined never flips → latch released + toast, fake timers); identity-guard pin (flip isLogined under a DIFFERENT profile id → continuation writes skipped); happy path unchanged.

### N-23 — widen the reset key to the scope triple (`RecentActivityView.vue`)

- Watch source becomes the `scopeKey`-style string `` `${appStore.profile?.id} ${appStore.network?.id} ${appStore.account?.address}` `` (exact shape of `useIncomingTransfers.ts:64` — reuse by local helper, not export churn); the two captured post-await guards inside `resnapshotJournal`/`loadExecutingTaskSnapshot` widen to the same triple.
- Test (RecentActivityView.test.ts, harness separates the fields): same-address profile-only switch → executingTask reset + snapshot reloaded (the missing Layer-A case).

### N-22 — the family-standard catch (`EditProfilePopup.vue`)

- Copy `EditAccountPopup.vue:60-68`'s catch verbatim (comment included); add `TOAST_DURATION` to the `:6` import. Test: rejection path → toast + latch released (mock already wired).

### N-09 — the removal (exactly the recon inventory)

Delete: `composables/notification.js` (whole file); auth.vue import+call; auth.test.ts mock line; `utils/core.ts:186-194` + its now-orphaned storage-facade import; the four setSentinel call sites + import lines; new-profile-helpers.test.ts's four sentinel assertions; `package.json#sentinel`; `vite.shared.ts` `__SENTINEL__` define; `vite-env.d.ts:5` ambient declaration; the `nulo:ui:sentinel` key + truthy expect in `tests/e2e/import-paths.test.ts:116,119` and `tests/e2e/passkey-backup.test.ts:493,497`. Generated types regenerate. KEEP: notification store + NotificationManager (+ their three inline producers), `tests/e2e/sentinel.ts` (unrelated boot infra).

Verification: `grep -rn "checkSentinel|setSentinel|__SENTINEL__|nulo:ui:sentinel|aztecReset|checkNotificationsForShow"` post-removal must hit ONLY generated types (until regenerated) — a scripted assertion in the batch notes, not a committed test.

### File-level change map

- NEW `src/composables/runFence.ts` + `runFence.test.ts`.
- `popup/app.vue` (N-05 fence hunks + N-08 bootstrap wrap), `popup/pages/auth.vue` (N-08 + N-09 hunks) + `auth.test.ts` (new pins + mock-line drop).
- `popup/components/modules/general/RecentActivityView.vue` + test (N-23).
- `popup/components/popups/EditProfilePopup.vue` + test (N-22).
- N-09 deletions per inventory (11 source/test files + 2 e2e specs + package.json + vite.shared.ts).

### Alternatives considered (competing outline)

- **A. Inline per-site fences (no shared helper)** — smaller diff; rejected: this is the family's 3rd hand-rolling (audit's own cross-cutting note), and an unpinnable inline fence in test-less app.vue is exactly the silently-revertible shape earlier batches taught us to avoid — the shared primitive concentrates the pins.
- **B. Migrate useProfileBootstrap onto the helper too** — rejected: churn on 12-case-pinned working code; a cross-reference comment suffices.
- **C. Event-driven unlock (replace the busy-wait with an onActiveProfileChanged listener)** — architecturally nicer; rejected for this batch: reshapes auth.vue's whole flow (M-sized, new failure modes) where the bound+guard is S and closes both adjudicated halves.
- **D. N-09 as its own PR** — rejected: the runbook batches it here; auth.vue is already open in this diff; separate PRs would double the network-suite runs.

## Security & Adversarial Considerations

- The N-05/N-08 fences are read-only compares before writes; failure mode is a skipped stale write (fail-safe). The N-08 timeout converts an infinite spin into a user-visible retryable error — no secret handling changes.
- The removal deletes a DESTRUCTIVE vestigial path (the modal's delete-CTA was the audit's harm) — strictly risk-reducing; the adjudication records its remedy as "affirmatively wrong under the address freeze".
- The e2e spec edits REMOVE assertions (never weaken product checks — they asserted the vestigial stamp itself; the specs' real assertions stand).

## Phases

1. runFence primitive + tests; N-05 + N-08 + N-22 + N-23 fixes + pins. Gate: touched suites + audit:vue green.
2. N-09 removal (source + tests + e2e specs + build config) + regenerated types. Gate: audit:vue green + post-removal grep clean.
3. Battery: audit:vue + armed-build SMOKE (required — popup/UI) + full solo network (the two edited specs are members). Battery shares the host with NOTHING.
4. Post-impl: max review (separate commit) → codex final-diff loop → PR (≤93) → checks → squash-merge.

## Decision ledger (running)

- Shared fence primitive over inline (pinnability in test-less app.vue); useProfileBootstrap unmigrated; bounded-wait over event-rearchitecture (S vs M, both halves closed); N-09 in-batch per runbook; two beyond-runbook removal items + two e2e spec edits folded from recon; TaskService-clears-on-switch resolved N-23's scope question at recon time.
