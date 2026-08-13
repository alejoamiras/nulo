# home-refresh — implement the locked home-screen refresh spec

Tier: **light** (0 rubric highs — cosmetic surface, reversible, no migrations, no external coupling, no security-sensitive surface; bounded).
Spec source: five owner-review rounds, final render published as the "Nulo Home Refresh" Claude Artifact (URL recorded with the owner; ELI5 below is a separate artifact). Owner priority: **the tests must be updated correctly** — that is the plan's center of gravity.
`eli5_mode: artifact` — ELI5 source at `implementations-plan/home-refresh/eli5.html`, published URL recorded in the Seeds section.

## The locked spec (what ships)

1. **Catching-up → threshold-gated dot.** The "Catching up…" text line goes away. A pulsing bone dot (soft glow) sits LEFT of the token symbol with a Tooltip ("Catching up on incoming transfers"), shown only when the incoming-transfer scan is genuinely behind: the sync event gains `blocksBehind`, and the UI gates on a tunable constant sized to **~15 minutes of chain history**. Routine tip-following and RPC blips never show it.
2. **Split vocabulary → lock/globe, bone lock.** Token-row private/public squares become 9px `lock` (bone `--nulo-accent`) / `globe` (`--nulo-secondary`) icons; value text lifts from `--nulo-outline` to `--nulo-secondary`. Same vocabulary on the token-page breakdown row in BalanceView.
3. **Unpriced subtitle → token full name** (never "PRIVATE / PUBLIC").
4. **Density → compact.** Token rows 16→8px padding; activity cards 8→6px (in the SHARED `TransactionCardLayout` — affects all activity surfaces, deliberate); home section gap 24→16px; hero margins trimmed (balance section 32/16→22/10, gas card padding-top 16→12, actions margin-top 16→12).
5. **Fee juice → 2 decimals** on the home gas card (`maxDecimals: 4→2`, still truncate-down).
6. **Endpoint label → "dRPC"** on the two seeded drpc.live endpoints (NOT Local Network).
7. **Header split.** Account chip becomes: `AccountAvatar` button + name button (both open the accounts popup) + address button (copies the address, "Address is copied" toast, hover/focus reveals a copy icon, hover underline). `data-testid="account-selector"` moves to the NAME button so every existing e2e switching flow passes unchanged.
8. **Cursor fix.** `cursor: copy` → `cursor: pointer` at all three sites (design `base.css` `.copyable`, design `AddressDisplay.vue`, senders settings page).

## Architecture & Implementation (compact)

**Reuse/location** (from `recon.md`): `AccountAvatar` (existing L3 composite + 10-case suite) is the avatar; the address button mirrors `ScopeAddress`'s click→copy→toast→Enter-parity pattern; Tooltip usage copies `AccountsPopup.vue:85–96`; endpoint-label plumbing mirrors `addEndpoint`'s `label?.trim() || undefined`; icon test stubs copy `TransactionCard.test.ts:43`.

**Critical flow — the threshold gate** *(revised per the codex audit — see Audit log)*:
- `incoming-transfer/spec.ts`: `IncomingSyncStateChanged` gains `blocksBehind: number`; `Methods.getSyncState` returns `{ state: IncomingSyncState; blocksBehind: number }`; export `BACKFILL_INDICATOR_THRESHOLD_BLOCKS` (single source, importable by UI + tests) sized by the Phase-1 cadence measurement (see Phase 1 — no block-time constant exists in the repo, so the number is measured, documented, and tunable).
- **Lag datum = COVERAGE, not the event cursor.** `PublicEventCursor.blockNumber` is the last returned log position — a quiet token scans to the tip while its cursor stays ancient, so `tip − cursor` would explode on the first transient failure (the exact condition the CRITICAL quiet-token test at `service.scenarios.test.ts:3528` pins for `state`). Instead the cursor gains a **persisted, optional `lastCoveredBlock`** field — the highest block CONFIRMED contiguously covered, UNcapped by finality (`lastScanFinalized` won't do: it caps at `finalizedBlockNumber` (`service.ts:1437`), so a restart would seed coverage at finalized and the first dropped pass would show a phantom `checkpointed − finalized` backlog — codex round 2). Written on every coverage-confirming pass (`reachedTip` → `tips.checkpointedBlockNumber`; budget-incomplete → `scannedThrough.blockNumber − 1`), alongside the existing cursor persists (optional field, pre-production: no migration). During **reconciliation**, coverage derives from the repair's safe progress (the reconcile window's `lowerBound − 1`) so a genuine long reorg repair reads as genuinely behind. Restart seed: `cursor.lastCoveredBlock ?? cursor.lastScanFinalized ?? startBlock`. `blocksBehind = max(0, tips.checkpointedBlockNumber − coverage)`. Quiet token + RPC blip → small lag → no dot; cold start → huge lag → dot. The line-1232 non-standard branch emits `blocksBehind: 0`.
- **Snapshot always fresh; emit on state change OR threshold crossing.** The `syncState` map stores `{ state, blocksBehind }` and is updated EVERY pass (so `getSyncState` reseeds — mount, reconnect — always see current lag; state-transition-only storage would freeze it). `emitSyncStateIfChanged` emits when the state changes OR when `blocksBehind` crosses `BACKFILL_INDICATOR_THRESHOLD_BLOCKS` in either direction while backfilling — so a long episode can start/stop showing the dot mid-episode. No emit on mere lag drift within the same bucket (event volume stays tiny). `service.ts:121`'s hand-inlined event type is refactored to `EventHandler<IncomingSyncStateChanged>`.
- `client.ts`: zero changes (spec-typed event + `definePassthroughs`).
- `TokensView.vue`: `syncByContract` stores the object; the `backfilling` prop passed to TokenCard becomes `state === "backfilling" && blocksBehind >= BACKFILL_INDICATOR_THRESHOLD_BLOCKS`. **TokenCard stays presentational** (boolean prop → dot) — this keeps the gate testable in `TokensView.test.ts` (which asserts the prop) and the visuals testable in `TokenCard.test.ts` (recon collision risk #3).

**File-level change map:**
- `apps/extension/src/wallet/services/incoming-transfer/{spec,service}.ts` + `service.scenarios.test.ts`
- `apps/extension/src/wallet/services/network/service.ts` (+`service.test.ts`): `DefaultSeed.endpointLabel?`, threaded through `_buildNetwork`'s new optional param, seed path only
- `packages/design/src/base.css` (+ hash in `base.css.test.ts`), `packages/design/src/composite/AddressDisplay.vue`, `apps/extension/src/popup/pages/settings/advanced/account-state/senders/index.vue`
- `apps/extension/src/popup/components/modules/general/{TokenCard,TokensView,BalanceView,GasBalanceCard}.vue` + colocated tests
- `apps/extension/src/components/composite/activity/TransactionCardLayout.vue`; `apps/extension/src/popup/pages/general.vue`
- `apps/extension/src/components/Header.vue`
- `apps/extension/tests/e2e/`: `accounts.test.ts` (new copy/switcher coverage), `endpoints.test.ts` (dRPC title), no helper changes (testid preserved)

**Testid contract** (e2e selector stability): `account-selector` → the name button (helpers/tests unchanged); `token-catching-up` → the new dot wrapper; new testids `account-avatar-btn`, `account-address-copy`. All other testids preserved verbatim.

**Alternative considered:** putting the threshold inside TokenCard (timer/debounce or blocksBehind prop) — rejected: `TokensView.test.ts` only asserts the prop, so an internal gate would be invisible to it, and a second prop widens the interface for no benefit. Also considered event-payload-only `blocksBehind` (leaving `getSyncState` a bare string) — rejected: TokensView seeds from `getSyncState` snapshots on mount/reconnect, so the gate would be blind until the first live transition.

## Phases

### Phase 1 — Substrate: sync event `blocksBehind`, seed endpoint label, cursor fix
- **Cadence measurement first**: empirically measure L2 block cadence on Alpha V5 and Testnet (two `getTips`-style samples ~120s apart via existing tooling) and size `BACKFILL_INDICATOR_THRESHOLD_BLOCKS` to ≈15 minutes. **Record the raw tips + timestamps and round conservatively (larger threshold)** — it's an estimate, not protocol truth; document measurement + rounding in the constant's comment and `lessons/phase-1.md`. If the two networks diverge materially, a per-`ChainKind` map replaces the single constant (only then — no speculative config surface).
- Spec/service/client changes per the Architecture section (persisted `lastCoveredBlock` coverage watermark, reconciliation-aware derivation, always-fresh snapshot, state-change-OR-threshold-crossing emit).
- Tests (`service.scenarios.test.ts`): fix the exact-shape `toEqual` in the CRITICAL quiet-token test (payload gains `blocksBehind`); unwrap `.state` in the local `getSync` helper (3510–3511); ADD cases — **quiet-token → transient failure emits SMALL `blocksBehind`** (the audit's key regression); **restart regression: persisted `lastCoveredBlock` beyond finalized survives a service restart (no phantom `checkpointed − finalized` backlog on the first dropped pass)**; **mid-reconciliation restart: lag derives from the repair window's safe progress**; cold start emits large lag; budget-incomplete pass reports `scannedThrough − 1` coverage; threshold crossing DOWN mid-episode re-emits (dot can clear); threshold crossing UP mid-episode re-emits; unknown contract `getSyncState` → `{ state: "caught-up", blocksBehind: 0 }`; non-standard branch emits 0.
- Network seeds: `endpointLabel: "dRPC"` on the two drpc.live seeds; `_buildNetwork(profileId, name, rpcUrl, chainId, kind, endpointLabel?)`; ADD a `service.test.ts` case pinning the seeded label (and Local Network's absent label).
- Cursor: edit the three sites (verified exhaustive: `AddressDisplay.vue:56`, `base.css:370`, `senders/index.vue:182`); recompute the SHA-256 in `packages/design/src/base.css.test.ts` (deliberate-edit tripwire, per its own comment).
- **Validation gate** — commands: `bun run typecheck:all && bun run test && bun run --cwd packages/design test && bun run lint`; pass: all exit 0, the named new test cases present and green (root `test` covers ONLY `apps/extension` — the design-package run is mandatory here). Layers: typecheck · lint · unit.

### Phase 2 — Token list: threshold gate + TokenCard visuals + BalanceView breakdown
- `TokensView.vue`: object-valued `syncByContract`, gated `backfilling` prop.
- `TokenCard.vue`: remove text line + `PRIVATE / PUBLIC`; dot (5px, `border-radius:50%`, bone, soft glow `0 0 4px 1px rgba(248,241,231,.35)`, 2s pulse, `prefers-reduced-motion` kill) left of symbol inside a Tooltip (`#content`: "Catching up on incoming transfers"), `data-testid="token-catching-up"`, `cursor: help`, **wrapper focusable (`tabindex="0"`) so the tooltip is keyboard-reachable** (focus shows it — Tooltip supports this or gains a focus trigger); subtitle = fiat OR `token.name`; split = 9px `lock`(accent)/`globe`(secondary) icons + secondary-colored values; row padding 16→8. Keep the loading-block/`description` branch INTACT (recon collision risk #2) — including its "Catching up…" escalated cold-start text, which is loading-state copy, not the removed idle caption.
- `TokensView.vue` gate hardening: sanitize incoming lag before comparing (`Number.isSafeInteger(blocksBehind) && blocksBehind >= 0 && blocksBehind >= threshold` — hostile/broken node values, including large fractionals, degrade to "no dot", never NaN-poison the gate). The indicator is **advisory** — it must never gate any action.
- **Tooltip keyboard trigger**: the shared `Tooltip` (`packages/design/src/ui/Tooltip.vue`) currently has only mouse/touch handlers — add focus/blur triggers in the design package WITH a design-package focus test (its L2 coverage convention applies).
- `BalanceView.vue`: breakdown squares → same lock/globe icons.
- Tests: `TokenCard.test.ts` — add `Icon` + `Tooltip` stubs; rewrite lines 135–194 per recon (subtitle name fallback ×2 new cases, icon `data-name` assertions, dot presence/absence on `backfilling`, tooltip copy pinned to "Catching up on incoming transfers" via the stub's content slot); `TokensView.test.ts` — extend the harness with `blocksBehind` values: above threshold → prop true, below → false, `caught-up` → false, non-safe-integer/negative/fractional → false; `BalanceView.test.ts` — ADD breakdown lock/globe case (net-new coverage); design package — Tooltip focus-trigger test.
- **Validation gate** — commands: `bun run typecheck:all && bun run test && bun run --cwd packages/design test && bun run lint`; pass: all exit 0, new cases green (design run mandatory — Tooltip changed). Layers: typecheck · lint · unit/component.

### Phase 3 — Density + decimals
- `GasBalanceCard.vue` `maxDecimals: 4→2`; `general.vue` gap 24→16; `TransactionCardLayout.vue` `.wrapper` padding 8px→6px 0; `BalanceView.vue` hero margins (32/16→22/10, gas 16→12, actions 16→12).
- Tests: `GasBalanceCard.test.ts` ADD fractional fixtures (`42.1234…` → `"42.12"`, exact-2-decimals boundary stays) — the only signal for this change, per recon gap #4. No padding assertions exist anywhere (convention: never pin pixel values).
- **Validation gate** — commands: `bun run typecheck:all && bun run test && bun run lint`; pass: all exit 0, fractional cases green. Layers: typecheck · lint · unit/component.

### Phase 4 — Header split
- `Header.vue`: `AccountAvatar` in a button (`data-testid="account-avatar-btn"`, opens accounts popup) + name button (**`data-testid="account-selector"`**, opens accounts popup) + address button (`data-testid="account-address-copy"`, hover/focus-reveal copy icon absolutely positioned so nothing shifts, hover underline, Enter/Space parity, all `cursor: pointer`).
- **Copy handler is an extracted, unit-tested helper** (colocated `.ts`, per the pure-helper convention): sanitizes via the `ScopeAddress` pattern (control-char strip), **awaits `clipboard.writeText`**, shows the success toast ONLY after the promise resolves, and on rejection shows a warning toast ("Couldn't copy address"). Its test pins: exact address string written; success toast after resolve; failure path. No new manifest permissions — `navigator.clipboard.writeText` in the popup needs none.
- **One narrow Header integration test** (allowed under the "optional for complex pieces" carve-out; codex round-2 condition — the helper test alone can't prove Header supplies the FULL active address): mount Header with a testing store, click `account-address-copy`, assert the stubbed `clipboard.writeText` received `appStore.account.address` verbatim (full string, not the truncated display text). Nothing else — no Header test-suite ceremony.
- Keyboard rules per CLAUDE.md: three real `<button>`s in DOM order, no positive tabindex.
- **Validation gate** — commands: `bun run typecheck:all && bun run test && bun run lint`; pass: all exit 0 AND the copy-helper + narrow Header tests run green within `bun run test`. Layers: typecheck · lint · unit/component.

### Phase 5 — E2E updates + full gates
- `tests/e2e/accounts.test.ts` (smoke): ADD as **separate tests** (each closes any open overlay before the next — the audit's popup-state caution): (1) click `account-address-copy` → `waitForToast(page, "Address is copied")`; (2) click `account-avatar-btn` → `accounts-popup` visible → close; (3) click `account-selector` (name) → `accounts-popup` visible → close.
- `tests/e2e/endpoints.test.ts` (smoke): ADD — seeded endpoint row title reads "dRPC" (not the raw URL).
- No changes to `helpers.ts` / `in-flight-send-guard` / `connect-dapp` (testid preserved — verify by running them, not by assumption).
- **Manual visual pass** (non-automatable criterion, before the PR): drive the built extension via the `chrome-extension-debug` skill across home, Activity page, and token detail — density, dot glow + tooltip (hover AND keyboard focus), hover-reveal copy icon, reduced-motion behavior. Record the pass in `lessons/phase-5.md`.
- **Validation gate** — commands: `bun run audit:vue && bun run test:all && bun run test:e2e` then `bun run e2e:agent` (network suite; **run solo** — concurrent host load mass-fails it); pass: all exit 0 (`test:all` covers the workspace packages root `test` misses, incl. `packages/design`). Layers: typecheck · lint · unit (all workspaces) · build · smoke e2e · network e2e.

## Security & Adversarial Considerations

- **Threat surface delta: small but not zero** (audit correction). No new deps, no storage-shape changes (endpoint `label` is an existing optional field; pre-production = no migration), no new message-bus methods — but `blocksBehind` is a NEW node-derived trust signal surfaced to the user.
- **`blocksBehind` is advisory, both directions.** A malicious/broken RPC can inflate it (dot shows — annoying) or UNDER-report the tip / trigger the non-standard branch to suppress it (false reassurance that history is complete). The indicator therefore never gates any action, and the UI clamps hostile values (non-finite / negative / fractional → no dot). Documented in-code as advisory.
- **Clipboard**: the header copies the ACTIVE account's own public address from `appStore` (trusted internal state, not dApp-controlled). Mirror `ScopeAddress`'s sanitization anyway (control-char strip); `writeText` is AWAITED — the success toast fires only after the write resolves, so the toast can't claim a copy that failed (rejection → warning toast). No new manifest permissions.
- **Tooltip/toast content**: static string literals — no interpolation of external input; no `v-html` anywhere in the diff.
- **Cursor/CSS changes**: pure presentation. The `base.css.test.ts` hash update is the designed procedure for deliberate edits, not a gate bypass — the quality gates themselves are untouched.
- Least-privilege/supply-chain/crypto: N/A (no CI, token, dependency, or crypto surface touched).

## Assumptions

**Facts** (verified in recon, file:line cited):
1. Sync event shape + 5 emit sites + in-scope data: `incoming-transfer/spec.ts:42–46,342`, `service.ts:121,491–497,1232–1285`; cursor block number at `PublicScanCursor.cursor.blockNumber` (`spec.ts:191–222`, `packages/aztec-runtime/src/pxe/public-events.ts:52–56`).
2. Exactly one exact-shape event assertion breaks (`service.scenarios.test.ts:3539`); the other sync-state assertions go through the `getSync` helper (3510–3511).
3. `_buildNetwork` (network `service.ts:797–813`) sets no endpoint label; `NetworkEndpoint.label` already optional (`network/spec.ts:19–26`); no seed-exercising unit test exists.
4. `base.css.test.ts:13–17` SHA-256-pins `base.css`; the only design-package test affected by the cursor edit. Two more `cursor: copy` sites: `AddressDisplay.vue:56`, `senders/index.vue:182`.
5. E2E `account-selector` usage is exactly four occurrences across three files (`helpers.ts:350,391`; `in-flight-send-guard.test.ts:61`; `connect-dapp.test.ts:26`); none reads the chip's text or assumes it wraps the address (audit-verified repo-wide), so the name-button testid move breaks nothing. Gas/endpoint e2e assertions are tolerant of the decimal/label changes.
6. `GasBalanceCard.test.ts` fixtures are all whole-FJ → 4→2 is assertion-invisible today.
7. `AccountAvatar.vue` exists with `getInitials()` + 10-case suite; renders two-char initials.
8. Activity-card padding lives in shared `TransactionCardLayout.vue:144`; no test pins the value.

9. Exactly three `cursor: copy` sites exist repo-wide (`AddressDisplay.vue:56`, `base.css:370`, `senders/index.vue:182` — grep-verified during the audit round; promoted from Inference).
10. Root `bun run test` runs ONLY `apps/extension` (`package.json` "test" script); `audit:vue` likewise. `packages/design` has its own `test` script; `test:all` (`--filter '@nulo/*' --if-present test`) covers the workspaces — hence the Phase 1/5 gate commands.

**Inferences** (attackable):
1. Block cadence is MEASURABLE but currently unknown (no constant in the repo; external docs suggest seconds-scale blocks, contradicting the earlier ~36s slot guess — which is why Phase 1 measures instead of assuming). The threshold constant carries the measured number + method.
2. Emitting on threshold crossings (in addition to state transitions) keeps event volume negligible: crossings are rare per episode; lag drift within a bucket doesn't emit.
3. Smoke suite can exercise the accounts popup from the header (header + popup manager are mounted in smoke; no current smoke test proves it — Phase 5's separate-tests structure is the proof, and if smoke can't, the tests move to the network suite with a lessons note).

**Asks** (owner decisions surfaced at the approval gate):
1. **Avatar initials**: reuse `AccountAvatar` as-is → **two-character** initials ("PA" for Primary Account); the approved mock showed a single "P". Recommendation: reuse as-is (consistent with the rest of the app; zero new surface). Say "single letter" to add a `chars` prop instead.
2. **Density blast radius**: the 8→6px card padding applies to ALL activity surfaces (Activity page, token detail) via the shared layout. Recommendation: yes — one density everywhere.
3. **Threshold authority**: the "~15 minutes" is owner policy; the BLOCK number is derived from the Phase-1 measurement (single constant; per-network map only if Alpha V5 and Testnet measurably diverge). Recommendation: accept measured single constant.

**Decided defaults** (surfaced, not silently assumed — veto at approval if wrong):
- Copy-failure UX: warning toast "Couldn't copy address" on clipboard rejection.
- The seeded "dRPC" label stays user-editable via the existing endpoint-edit popup; editing the URL keeps the label (no special-case clearing).
- The dot tooltip is keyboard-reachable (focusable wrapper); visual/a11y acceptance = the Phase-5 manual pass.

## Post-implementation (self-contained — the implementing session executes THIS section)

1. Run **`/code-review max --fix`** on the implementation diff. Skim the applied fixes for unintended changes, then **commit them separately** from implementation commits (identifiable as code-review-applied).
2. **Codex post-impl audit** (`/codex xhigh`) with: the net diff from the plan baseline; a separate summary of the code-review commits; this plan.md; the adversarial/security ask ("What could go wrong? What would an attacker target? What are we trusting that we shouldn't?"); and this rule verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. **Iterative fix loop**: verify codex's factual claims against the repo before acting; apply accepted fixes; commit; log the consult + verdict in `implementations-plan/home-refresh/lessons/`; RESUME the same codex session with the fix diff for re-review. Repeat until a round yields no new material findings (rejected nitpicks don't count). Still churning after 3 rounds → stop and surface to the owner.
4. **Delivery** per the Delivery section below. Update `implementations-plan/index.md` (completed marker) in the PR.

Failure-retry policy: human-driven — stop and reassess after 3 failures on the same step; `/loop` autonomous — after 5.

## Delivery

**Single arc, single PR** — no stack ceremony. Branch `worktree-home-refresh` → PR into `dev` via `gh pr create` once Phase 5's gate is green and the post-impl loop converged.
PR title (≤93 chars, becomes the squash subject): `feat(home): threshold-gated sync dot, lock/globe split, denser rows, header address copy`
After CI: `gh pr checks --watch`. Merge is the owner's call.
Post-implementation hardening: **not warranted** (cosmetic surface; no trust boundaries touched) — no `/harden` scheduled.

## Audit log

Codex plan audit (light tier), transcript in `audit-codex.md`.

**Round 1 verdict: reject** (blocking: incorrect lag source, stale state-only dedup, invalid block-time conversion, incomplete test gates). All four verified against the repo and **adopted**:
1. Lag datum → coverage watermark (not the event cursor); quiet-token→transient-failure test added to Phase 1.
2. Snapshot updated every pass + emit on state change OR threshold crossing (both directions); crossing tests added.
3. 36s-slot inference dropped → Phase 1 measures cadence empirically; constant carries the measurement.
4. Gates fixed: `bun run --cwd packages/design test` in Phase 1; `test:all` in Phase 5 (root `test` is extension-only — verified `package.json`).

**Material findings adopted**: advisory-indicator framing + hostile-value clamp (dot suppressible by a lying RPC — cosmetic only); awaited clipboard write + failure toast + extracted unit-tested copy helper; Fact 5 corrected (4 occurrences/3 files); cursor:copy 3 sites promoted to Fact (grep-verified); smoke popup tests separated with overlay closes; tooltip-copy pin + unknown-contract snapshot default tests; Phase 4 gate now proves the copy helper; keyboard-reachable tooltip; Phase 5 manual visual pass; three new Asks/defaults surfaced.

**Rejected (with reason)**: a Header COMPONENT test (L4 convention exempts it; the audit's substance — exact-address + failure-path coverage — lands in the extracted helper's unit test + smoke e2e instead). Speculative per-network threshold map (only if measurements diverge; no-over-engineering).

**Round 2 verdict: conditional approve** (conditions: persist + reconciliation-correct the coverage watermark with restart tests; enforce safe-integer lag validation; test keyboard Tooltip focus; prove Header passes the full active address). **All four conditions folded into the plan** (persisted `lastCoveredBlock` + restart/mid-reconciliation regression tests in Phase 1; `Number.isSafeInteger` gate + Tooltip focus trigger + design-package focus test in Phase 2; narrow Header integration test in Phase 4). Cadence-measurement caveat adopted (raw tips + timestamps recorded, conservative rounding). The audit loop is converged: conditions are incorporated, no unaddressed findings remain.

## Seeds

*(DRAFT until the approval gate; finalized post-approval. Implementation session must run inside the `home-refresh` worktree — `agent-worktree resume home-refresh`.)*

ELI5 artifact: https://claude.ai/code/artifact/b3bb2678-b9ed-49e8-a5a0-e44786f7f136 — source `implementations-plan/home-refresh/eli5.html` (republish that path to update the same URL).

**Recommended — `/goal`** (completion is transcript-observable):

```
/goal All five phases marked ✓ in implementations-plan/home-refresh/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/home-refresh/lessons/phase-N.md in the transcript; /code-review max --fix complete with findings applied and committed separately; the codex post-impl fix loop converged (a resumed codex pass reported no new material findings, quoted in the transcript); a PR into dev exists titled "feat(home): threshold-gated sync dot, lock/globe split, denser rows, header address copy" (gh pr view output in the transcript); bun run audit:vue, bun run test:e2e, and bun run e2e:agent all report exit 0 in the transcript.
```

**Fallback — `/loop 15m`**:

```
/loop 15m Drive implementations-plan/home-refresh forward. Never idle waiting for my input. Each firing:
1. Reality check: read implementations-plan/home-refresh/plan.md and lessons/ (authoritative state — not the chat); run git status and git log --oneline -5. If a PR exists, gh pr view --json statusCheckRollup (no --watch). Without a PR but with CI configured, gh run list --branch $(git branch --show-current) --limit 1 --json status,databaseId.
2. Waiting on CI is fine — confirm it's progressing (gh run watch <run-id> up to 10 minutes; stuck past that → inspect logs, log as blocked in lessons). Use the wait productively: review the diff, prep the next phase, strengthen tests. Don't start work that would conflict with the in-flight change.
3. No task in hand? Pick the next pending step from plan.md and start it. After each meaningful edit run bun run lint and the touched packages' tests — catch mistakes in-step. Then commit → push.
4. Stuck, or facing a decision you'd normally bring to me? Don't wait. Call /codex xhigh with full context and go back and forth until a defensible decision, then act. Log every consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge to dev/main, never publish or deploy, never expand scope beyond plan.md; crossing one → surface and hold.
5. Same step failed 5 times? Stop retrying; reassess with codex, then continue down the agreed path.
6. Phase green? "Green" means THE PHASE'S VALIDATION GATE as written in plan.md passes. Run the full gate, paste the result, mark ✓ in plan.md, file the lessons entry, print LESSONS_FILE=implementations-plan/home-refresh/lessons/phase-N.md, advance.
7. All phases ✓? Run plan.md's Post-implementation section: /code-review max --fix → commit fixes separately → codex post-impl audit (/codex xhigh, net diff + code-review summary + adversarial ask + the plan's no-over-engineering rule) → apply accepted fixes, commit, resume codex with the fix diff — loop until no new material findings (3 rounds still churning → surface and stop). Then Delivery: gh pr create into dev per plan.md, gh pr checks --watch. Then write the wrap-up report: what shipped, every contentious decision with ELI5 context, open items. Surface and stop.
Keep the ASCII checklist visible each firing (human readability only; plan.md is the source of truth).
```
