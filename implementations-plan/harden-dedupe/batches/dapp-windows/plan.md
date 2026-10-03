---
plan: harden-dedupe / dapp-windows (arc 19 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/19-dapp-windows, stacked on harden-dedupe
---

# dapp-windows: the trust window reads the shared hostname check, one window close, one session wait

Findings Q-07 (a, b, c) and Q-27 (a, c), from `audit/quality/2026-09-30-dedup-high/`. The trust-confirmation window (`verify`) keeps private copies of the anti-phishing hostname check, the window close and the session wait that the approval-window hook owns; the discovery admission ladder is written twice in the service worker; and the execute window carries two identical `switch` arms. This batch states each once. What every window shows, which requests the worker refuses, the log line each refusal writes, and the number of awaits before each effect stay as they are.

**Split out:** the program's pre-cleared `window.id` guard for the json and logger windows (`popup/windows/json/index.vue:17-23`, `logger/index.vue:13-19`) becomes arc 19b, planned after this arc lands. The Behaviour rule puts an invisible, strictly safer fix "in its own arc", and pre-clearance does not waive that. Q-07 (d) is declined (Decisions).

## Outcome & Quality Bar

- **For whom:** the next person who hardens the hostname check (confusables, mixed script) or changes how a dApp window closes. Today a hardening edit to `useDappHostname` reaches four windows and silently skips the one screen that asks the user to trust a site.
- **Excellent:**
  - Five windows read one hostname check. A test table of wire-shaped origins (IDN, punycode, uppercase, trailing dot, ports, userinfo, `@`, IPv6, lookalike subdomains, opaque origins) pins its exact output, and the trust window is mounted with the real identity block over the same origins, so a window wired to the wrong value fails.
  - One guarded `closeCurrentWindow()`; one `untilSessionChecked()` wait whose call sites keep their synchronous fast path and whose slow path keeps its tick count.
  - The two verify-window admissions in the worker share their request and their refusal, with the same single `await` and the same ticks to every effect.
- **Good enough:** each window keeps its own catch branches and error copy; the `getRequestId` lambdas stay (the audit's writer's call: `useDappInteractionPayload` stays router-free).

## Architecture & Implementation

Paths under `apps/extension/src/`, read on `harden-dedupe` at `0a9e48f9` (no cited line moved since `169bed04`).

### A. The hostname check (Q-07 a)

| site | guard set today | after |
|---|---|---|
| `popup/windows/verify/index.vue:52-67` (trust confirmation) | missing or empty `url` → `""`; else `new URL(url).hostname`; a parse failure → the raw string. Flag: any UTF-16 unit > 127, or any `.`-label starting with `xn--` (case-sensitive) | `useDappHostname(dapp)` with the same aliases, `dappHostname` and `hostnameHasNonAscii`; template untouched |
| `composables/useDappHostname.ts:8-27`, used by `discover/index.vue:53`, `capabilities/index.vue:121`, `execute/index.vue:134`, `network-unavailable/index.vue:51` | identical expressions (`url` read once into a local, `h` for the hostname) | file unchanged |

- **Strictness.** The two copies are semantically identical today (only verify reads `dapp.value.url` twice), so the stricter of the two is either one. A probe ran both expressions over 48 inputs on Bun, jsdom (the unit tests' `URL`), Chrome 152 and Firefox 153. All four agree except two parse-failure inputs, which Chrome parses and the others refuse (Facts 3). Every disagreement is between engines; none is between the copies. Codex's plan audit repeated the probe with zero diffs.
- **What the window renders.** The block shows the hostname, not the origin (scheme and port drop) and the warning line when the flag is set (`components/composite/DappIdentityBlock.vue:38-45`). Both are unchanged.
- **Engine text.** No expression in the check can throw outside its `try`: `url` is `z.string().optional()` (`wallet/services/dapp-session/spec.ts:79-84`), and `h` is a string. The composable's names (`url`, `h`) already match verify's `h`.

### B. Window close (Q-07 b)

New `utils/close-current-window.ts`, verify's and the hook's body verbatim:

```ts
export function closeCurrentWindow(): void {
	chrome.windows.getCurrent(undefined, (window) => {
		if (window.id) chrome.windows.remove(window.id)
	})
}
```

| site | today | after |
|---|---|---|
| `verify/index.vue:78-84` (`closeWindow`, four callers) | `getCurrent(undefined, cb)`, `remove` only when `window.id` is truthy | `closeCurrentWindow()` |
| `composables/useDappApprovalWindow.ts:88-93` | `completeInteraction()` when asked, then the same | `completeInteraction()` when asked, then `closeCurrentWindow()`; the order holds |
| json and logger windows | unguarded `remove(window.id)` | untouched here; arc 19b |

The callback parameter keeps the name `window`: if Chrome passes no window (a `lastError` path), the `TypeError` names it on JSC and SpiderMonkey exactly as both copies do today.

### C. Session wait (Q-07 c)

`verify/index.vue:118-133` and `useDappApprovalWindow.ts:102-115` are the same block. The hook module gains `untilSessionChecked(isChecked: () => boolean): Promise<void>`, whose body is today's block verbatim: `return new Promise<void>((resolve) => { const stop = watch(isChecked, (checked) => { if (checked) { stop(); resolve() } }, { immediate: true }) })`. Its TSDoc states the precondition in one sentence: call it only while `isChecked()` is false, because on `true` the immediate callback reaches `stop` before it is bound (dev rejects; prod logs and the promise never settles). No new guard is added.

Both sites keep `if (!appStore.isSessionChecked) await untilSessionChecked(() => appStore.isSessionChecked)`.

- **Await shape.** The helper is not `async` and returns the Promise it builds, so the slow path awaits one native Promise exactly as today, and the fast path still has no await. Phase 1 pins both:
  - **The fast path:** `getDappSession` (verify) and `init` (hook) run inside the synchronous segment when the session is already checked. `useDappApprovalWindow.test.ts:129-135` already pins the hook's.
  - **The slow path:** the microtask tick at which each runs after the store flips. An `async` wrapper adds one tick, which both audit legs measured.
- The names `stop`, `checked` and `resolve` stay, and so does the `stop()` call: without it the watcher evaluates its source again on every later flip, and Phase 1 counts those evaluations.
- **Why the hook module:** both callers are dApp windows, and recon names it the home for the shared lifecycle pieces. A new composable file would add a second auto-import module for one function.

### D. Discovery admission (Q-27 a)

`wallet/services/wallet-sdk/background.ts:967-977` (`approveAfterPopup`) and `:1041-1051` (`runDiscoveryPopup`) are the same ladder. Two module-private helpers beside `rejectIfExpired` (`:854`):

- `admitVerifyWindow(discovery, deps)` returns `admitAsync(deps.admission, { id: discovery.requestId, origin: discovery.origin, deadline: discoveryDeadline(discovery), needsWindow: true, consumesToken: false })`. It carries one invariant comment: it returns `admitAsync`'s Promise unchanged (no `async`, no `await`), so each caller's single `await` keeps its tick count.
- `rejectIfNotAdmitted(discovery, deps, admitted): admitted is "rejected" | "expired"`, synchronous: on either outcome it calls `rejectThrottled` with today's ternary text and returns `true`.

| site | guard set today, in order | after |
|---|---|---|
| `approveAfterPopup` | settled-session check (`:948-964`, untouched); admit `{needsWindow: true, consumesToken: false}`; on `rejected` → `rejectDiscovery`, then Warn `Discovery rejected (verify-window queue full): request …`; on `expired` → the same with `expired while queued`; return before `approveAdmitted` | identical; `if (rejectIfNotAdmitted(…)) return` |
| `runDiscoveryPopup` | denial and `rejectIfExpired` before (untouched); the same admission and refusal; the `return` sits inside the `try`, so the `finally` (`:1061-1066`) still clears the handover, closes the waiting window, resolves the dedupe promise and deletes the key; attach and `persistAndApprove` follow only on admission | identical |

The helpers bind the same local names (`discovery`, `deps`, `admitted`), so a malformed SDK object throws the same engine text. `autoApproveExistingSession` (`:903-922`) is a different request (`needsWindow: !trusted`, `consumesToken: true`) and callback form; it stays. The five other reject-and-log scaffolds (`rejectBehindNotice`, the epoch-switch reject, `runNetworkUnavailableNotice`, the attach and profile-change refusals) each carry their own level and text; a helper taking both would only forward them.

### E. Execute's send arms (Q-27 c)

`popup/windows/execute/index.vue:331-348` (`aztec_sendTx`) and `:349-365` (`send_transaction`) have byte-identical bodies. Stack the labels (`case "aztec_sendTx": case "send_transaction": {`), keep the existing `aztec_sendTx` comment as it is, and delete the `send_transaction` one; no merged comment is written. `isEmbeddedFeePayment` dispatches on `op.kind` at run time. The stacked arm typechecks: a scratch edit of sections A, D and E passed `vue-tsc`, and the execute, verify and worker `background*` suites (27 files, 296 tests) passed with it; it was then reverted.

### What stays, and layering

- `useDappHostname`, `useDappInteractionPayload`, every template, every style, all error copy, each window's `JobCancelledError` catch, the `getRequestId` lambdas, and `wallet/services/dapp-interaction/materialize.ts:68-88`, the background's own identical pair of send arms. That pair is outside the finding and listed as a follow-up.
- `utils/` and `composables/` are auto-import roots (`apps/extension/vite.config.ts:111`, `vueTemplate: true`), so `closeCurrentWindow` and `untilSessionChecked` become globals. No template or script uses either name today. `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` are regenerated by `bun run build` and committed. Call sites import explicitly anyway, as these windows do.
- No new acceptances: none of the touched functions is in the complexity manifest, and every change removes branches. No npm-published entry is touched.

## Security & Adversarial Considerations

- **Who controls the hostname input.** `dappMetadata.url` is written by `discoveryDappMetadata` (`background.ts:1072-1074`) from `discovery.origin`, which the SDK derives as `new URL(sender.tab.url).origin`, or `"unknown"` (`@aztec-labs/wallet-sdk`, `dest/extension/handlers/background_connection_handler.js:54`). A live session's url is therefore a browser-serialized origin: lowercase, punycoded, the default port omitted, IPv6 bracketed, or `"null"` for opaque origins. The non-ASCII loop and the raw fallback are reachable only from a stored row that passes `z.string()`. Both copies treat every such string identically; the table pins the fallback rows too.
- **What a consolidation could widen, and why it does not.** After the change verify's check *is* the composable's, so a future hardening reaches it, which is the finding's point. A future *loosening* reaches it too; the literal table in `useDappHostname.test.ts` plus verify's wiring test turn red on either.
- **Display.** The hostname renders through Vue text interpolation (escaped); the dApp name still passes `sanitizeWireString` in `DappIdentityBlock`. Neither moves.
- **Close guards.** Verify and the hook keep an identical guard, call shape and order (`completeInteraction` first).
- **Throttle path.** Both verify-window admissions keep `needsWindow: true` and `consumesToken: false`: flipping the latter would let a duplicate spend the origin's reconnect budget, and flipping the former would skip the window cap. Phase 1 pins both fields, the refusal texts, the call order, and that nothing is approved or persisted after a refusal.
- **Ordering.** No added await anywhere: `admitVerifyWindow` and `untilSessionChecked` are plain functions returning the Promise the code awaits today, and both sync fast paths stay inline. Phase 1 pins the tick of every effect after each await, on both the admitted and the refused path.
- **Logging.** No log line, level or payload changes.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `0a9e48f9`):

1. The sites and line numbers are as tabled above.
2. `useDappApprovalWindow.test.ts:69` stubs `getCurrent(_o, cb)`, so the hook's call shape is already pinned. `:129-135` pins that `init` runs synchronously within `start()` when the session is checked. `composables/useDappHostname.test.ts` exists with 8 tests; Phase 1 appends to it.
3. Probe results (scratch, deleted):
   - **Normalized:** `https://DApp.EXAMPLE` → `dapp.example`. A trailing dot is kept (`dapp.example.`). Ports, scheme, userinfo, path and fragment drop.
   - **Userinfo and `@`:** `https://dapp.example@evil.example` → `evil.example`, not flagged. `%40` in the host fails to parse and shows the raw string.
   - **IP hosts:** `https://[::1]:8080` → `[::1]`; `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`; `0x7f.1` → `127.0.0.1`.
   - **IDN, flagged:** `exámple.com` → `xn--exmple-qta.com`; Cyrillic `аpple.com` → `xn--pple-43d.com`; `XN--EXMPLE-CUA.com` is lowercased and flagged.
   - **Mapped to ASCII, not flagged:** full-width `ｄａｐｐ`, U+00AD, U+200B and U+3002 all become plain `dapp.example…`.
   - **Shown raw:** `null`, `unknown` and `not a url`, not flagged.
   - **Raw fallback:** raw `exámple` is flagged (the >127 loop); raw `xn--exmple-cua` is flagged; raw `XN--EXMPLE-CUA` is **not** flagged, because the label test is case-sensitive.
   - **Engine splits:** `https://xn--.example` and `https://exá mple.com` parse on Chrome only. The table omits both.
4. No other built arc (4 to 18, at their current heads) touches these files; `src/types/auto-imports.d.ts` may conflict on a restack and is regenerated.

**Inferences:** none that the design relies on.

**Asks:** none. The panel resolved both earlier asks (Decisions).

## Phases

### Phase 1: pin each site (test only)

All new tests pass on the unchanged code, in one commit. Before writing any colocated test file, `ls` and `git status` its path; existing files are appended to, never overwritten.

1. **Hostname table** (append to `composables/useDappHostname.test.ts`): one literal table of the Facts 3 rows (both engine-split inputs excluded), each pinning `hostname` and `isSuspicious`. Inputs are origins as the SDK serializes them, plus the raw-fallback rows.
2. **Trust window wiring and display** (new `popup/windows/verify/index.window.test.ts`): mounted with the **real** `DappIdentityBlock` and a wire-shaped session row: a 64-hex verification hash, chain `"0"`, CAIP accounts `aztec:0:0x…` of 64 hex, and `dappMetadata` as the worker writes it, meaning a sanitized hostile name plus an origin. For the origins `https://dapp.example:8443`, `http://[::1]:5173`, `https://xn--exmple-cua.com`, `https://dapp.example.evil.example`, `null`, `unknown` and an imported row's `https://dapp.example@evil.example`, assert the block's `hostname` prop, its rendered text, and whether `dapp-hostname-warning` exists. Then the lifecycle:
   - missing `sessionId`, a missing row, and a throwing `getDappSession` each call `getCurrent(undefined, fn)` and then `remove(id)` once;
   - a window without an id is never removed;
   - OK with "Always trust" calls `setTrustedVerification(id, true)` before `getCurrent`, as an ordered log;
   - with the session already checked, `getDappSession` was called once when `mount()` returns, before any flush;
   - with it unchecked, it is not called until the store flips. The flip starts a `queueMicrotask` ladder, and the test pins, as a literal, the rung at which `getDappSession` runs. A later false→true flip triggers no further evaluation of the watched source (counted through a getter), so the watcher has stopped.
3. **Hook slow path** (append to `composables/useDappApprovalWindow.test.ts`): the same ladder pin for `init` after the flip, and the same stopped-watcher count.
4. **Worker admission** (new `wallet/services/wallet-sdk/background.verify-reservation.pins.test.ts`). It drives both sites through the SDK callbacks as `background.admission.test.ts` does, with `admitAsync` mocked over the real module and a recording logger. For each site and each of `rejected`, `expired` and admitted, it asserts:
   - the request object (`needsWindow: true`, `consumesToken: false`, `deadline`, `origin`, `id`);
   - the ordered handler calls;
   - the exact Warn line;
   - after a refusal, no approve and no session write, and on `runDiscoveryPopup` the waiting window closed and a parked duplicate released.

   **Microtask markers:** the mock starts a `queueMicrotask` ladder when it returns a resolved promise. The test pins, as literals, the rung of each effect after admission:
   - admitted: `approveDiscovery` in `approveAfterPopup`, and the first collaborator call `persistAndApprove` makes in `runDiscoveryPopup`;
   - refused: `rejectDiscovery`, the Warn line, and in `runDiscoveryPopup`'s `finally` the waiting window's `closeWindow`, the popup resolution and the parked duplicate's release.
5. **Send arms** (`popup/windows/execute/index.test.ts`, new describe): wire-shaped payloads (`aztec:1:0x` plus 64 hex, calls with 32-byte fields) for `aztec_sendTx` (default entrypoint, which pre-fills embedded; an FPC payer; a self-pay) and `send_transaction` (with and without `fee.embeddedFeePayment`). Each built operation is pinned with `toEqual` (`network`, `networkId`, `account`, `accountAddress`, `feeSettings`), and so is the signer list when two ops share an account.

**Mutants each must catch** (applied one at a time to a scratch copy, the named tests run red, the file restored by copy; logged in this arc's lessons file):

| mutant | caught by |
|---|---|
| verify shows the raw `url`; its flag is fixed `false` or swapped | 2 |
| the composable drops the `xn--` test, drops the >127 loop, or makes the label test case-insensitive | 1 |
| `closeCurrentWindow` drops the guard, or calls `getCurrent(cb)` | 2, and the hook test |
| `untilSessionChecked` awaited without the caller's test (fast path) | 2, and the hook test at `:129` |
| `untilSessionChecked` made `async` (slow path) | 2 and 3 (the ladder) |
| `stop()` removed | 2 and 3 (the evaluation count) |
| the worker drops the refusal check or its `return`, swaps the texts, skips the log, or flips `needsWindow` or `consumesToken` | 4 |
| `admitVerifyWindow` made `async` | 4 (the admitted markers) |
| `await Promise.resolve()` before the refusal `return` | 4 (the refused markers) |
| one send label removed (falls to `default: throw`); `feeSettings` or `pushUniqueAccount` dropped from the arm | 5 |

One mutant is equivalent and stated as such: dropping `immediate: true`, since the caller guarantees `false` when the watcher is created, and the watcher fires on the next change either way.

### Phase 2: the dedup (test files frozen)

Sections A to E above, in one commit, plus the regenerated auto-import declarations. `git diff --stat` must show no test file. The freeze binds this phase only: fix rounds may add tests.

**Validation gate (after each phase):**

- **Commands:** the touched test files, then `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`, and `bun run build` (inspect the regenerated declarations).
- **Pass criteria:** all exit 0; Phase 1 green on unchanged source with every mutant above red; Phase 2 touches no test file.
- **Screenshots** (the Phase 2 head against its parent): see UI impact.
- **Layers:** unit and component here; both e2e lanes on both browsers run in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Point it at this plan's guard tables and ask it to diff each site's guard set, call shape and await count before and after, and to attack the hostname table with further hostile origins. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."). An Opus pass on the same diff, per the program's MID rule.
2. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/arc-19-dapp-windows.md`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the stack, then add both e2e labels. When the program gates are green, with the shards that actually ran recorded, squash-merge.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/19-dapp-windows`. It shares no file with any built arc (Facts 4), so it stacks on whatever arc is the stack's top when it is ready; a restack replays only its commits and regenerates `auto-imports.d.ts` if that conflicts. Code review: off.

## UI impact

None intended: no template, style or copy changes. Scripts change in verify and execute, and through the hook in discover, capabilities and network-unavailable, so each is captured at its parent and at its head. The program's local zero-diff harness runs batch `dapp-windows`, with the dApp windows opened through stubbed ports (`installPortStub`). It covers Chrome and Firefox, dark and light, at 360×600@2x, on the real build, plus a `--stability` pass. Any non-zero pixel diff is a refactor bug.

| window | states |
|---|---|
| verify (trust confirmation) | new connection, origin `https://dapp.example:8443`, emoji grid, step bar; reconnect with a shared account, untrusted (`trustedVerification: false`), no step bar; punycode origin with the warning line |
| discover (connect) | ready; after a successful Allow, the loading state while it waits for verify capacity; queue full: the waiting host is captured, then the test asserts the window closes and no verify window opens (a generic error banner does not stand in for this path) |
| capabilities | ready (cancelled and error states optional: it changes only through the hook's close) |
| execute | `aztec_sendTx` with embedded fee; `aztec_sendTx` self-pay (locked fee card); `send_transaction` with embedded fee; `send_transaction` without one (the selectable fee card) |
| network-unavailable | ready (touched through the hook) |

Every state is reached on the real build; none is replaced by a component-test proxy.

## Deliberate differences retained

Kept as today, with no owner call (the program's "Q-07 error copy per window"):

- Execute's approve failure shows `Processing error.` with details where discover and capabilities show `Something went wrong`.
- `network-unavailable`'s init catch only logs and shows no banner, where the other three set `Something went wrong`.

**Follow-ups for the program's final report, unchanged here** (both copies of the hostname check share these today, so none is drift between copies):

- **The trust window names the host, not the origin.** `http://dapp.example` and `https://dapp.example:8443` render exactly like `https://dapp.example` in all five windows. Showing a non-default scheme or port is an anti-phishing UI change and needs owner sign-off. The coordinator logs this lead, and the ellipsis that can hide the eTLD+1, for the final report.
- **The raw fallback is weaker than the parsed path.** An unparseable stored url shows verbatim; its `xn--` test is case-sensitive and sees `https://xn--…` as one label. Parse failures also differ by engine. It is unreachable for live sessions (browser-serialized origins), and reachable only through a stored row.
- **`null` and `unknown` render with no warning.**
- **`wallet/services/dapp-interaction/materialize.ts:68-88` has the same identical send arms** on the worker side.

## Decisions (delegated)

### Plan audit, Codex leg (GPT-6 Astra, xhigh): REVISE

No blocker on the extractions. Findings:

1. **Phase 3 leaves the arc.** Accepted. The Behaviour rule (program `plan.md:84`) says "in its own arc", and pre-clearance does not waive it. The guard becomes arc 19b, planned after this arc lands.
2. **Q-07 (d): ship `isApprovalCancelled` narrowly.** Rejected; see the Opus leg's finding 2 and the call below.
3. **Pin the slow-path tick of `untilSessionChecked`.** Accepted: the marker reads 2 for the original and for the plain helper, and 3 with an `async` wrapper. It is added to Phase 1 items 2 and 3, with its mutant.
4. **Assert the watcher stops.** Accepted: removing `stop()` gives two more evaluations of the watched source. It is added with its mutant, replacing this plan's earlier claim that the mutant was equivalent.
5. **Refused-path markers in the worker.** Accepted: `await Promise.resolve()` before the refusal `return` moves the close from rung 1 to 2 and the duplicate release from 2 to 3. Markers now cover `rejectDiscovery`, the Warn line, the close and popup resolution, and the duplicate release, with that mutant.
6. **Screenshots.** Accepted:
   - `send_transaction` without an embedded fee;
   - discover's waiting state after a successful Allow;
   - the queue-full host, with its close and no verify window asserted;
   - `:8443` in a verify fixture.
7. **Confirmed unchanged:**
   - the hostname switch (re-probed on Bun, jsdom, Chrome 152 and Firefox 153, zero diffs);
   - the close helper's order;
   - the two plain worker helpers.

### Plan audit, Opus leg: REVISE

No blocker on the extractions. Findings:

1. **Keep Phase 3 here.** Rejected: the program text wins (Codex finding 1).
2. **Decline Q-07 (d).** Accepted. `classifyCancellableRejection` (`popup/utils/cancellable-rejection.ts:26-29`) already wraps the same `instanceof` in the same module, so a second predicate would be a new copy inside a dedup arc. Its Phase 1 item and mutant row are dropped.
3. **Pin the slow-path tick.** Accepted: Opus measured 1 against 2 with an `async` wrapper. The literal is whatever the unchanged code produces.
4. **Screenshots.** Accepted: the reconnect fixture is explicitly untrusted. With (d) gone, discover's and capabilities' cancelled and error states are optional, and their ready state stays.
5. **Text and nits.** All accepted:
   - the `untilSessionChecked` precondition, in one TSDoc sentence and with no new guard;
   - one invariant comment on `admitVerifyWindow`;
   - "Drift left for the alignment arc" renamed "Deliberate differences retained", since the Q-07 error copy is kept with no call;
   - append to the existing `useDappHostname.test.ts`;
   - the freeze binds Phase 2 only;
   - no merged comment on the stacked execute arm.

### The call on Q-07 (d)

Declined, by the driver. Codex leaned toward shipping it, Opus against, and neither probed it. A second wrapper over the `instanceof` that `classifyCancellableRejection` already wraps would add a copy, not remove one.
