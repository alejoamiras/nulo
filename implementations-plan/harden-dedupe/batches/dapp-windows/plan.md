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

Findings Q-07 and Q-27 (a, c), from `audit/quality/2026-09-30-dedup-high/`. The trust-confirmation window (`verify`) keeps private copies of the anti-phishing hostname check, the window close and the session wait that the approval-window hook owns; the discovery admission ladder is written twice in the service worker; and the execute window carries two identical `switch` arms. This batch states each once. What every window shows, which requests the worker refuses, the log line each refusal writes, and the number of awaits before each effect stay as they are. The one deliberate change is the program's pre-cleared `window.id` guard in the json and logger windows, in its own commit (Phase 3).

## Outcome & Quality Bar

- **For whom:** the next person who hardens the hostname check (confusables, mixed script) or changes how a dApp window closes. Today a hardening edit to `useDappHostname` reaches four windows and silently skips the one screen that asks the user to trust a site.
- **Excellent:**
  - Five windows read one hostname check. A test table of wire-shaped origins (IDN, punycode, uppercase, trailing dot, ports, userinfo, `@`, IPv6, lookalike subdomains, opaque origins) pins its exact output, and the trust window is mounted with the real identity block over the same origins, so a window wired to the wrong value fails.
  - One guarded `closeCurrentWindow()`; one `untilSessionChecked()` wait whose call sites keep their synchronous fast path.
  - The two verify-window admissions in the worker share their request and their refusal, with the same single `await`.
- **Good enough:** each window keeps its own catch branches and error copy; the `getRequestId` lambdas stay (the audit's writer's call: `useDappInteractionPayload` stays router-free).

## Architecture & Implementation

Paths under `apps/extension/src/`, read on `harden-dedupe` at `169bed04`.

### A. The hostname check (Q-07 a)

| site | guard set today | after |
|---|---|---|
| `popup/windows/verify/index.vue:52-67` (trust confirmation) | missing or empty `url` → `""`; else `new URL(url).hostname`; a parse failure → the raw string. Flag: any UTF-16 unit > 127, or any `.`-label starting with `xn--` (case-sensitive) | `useDappHostname(dapp)` with the same aliases, `dappHostname` and `hostnameHasNonAscii`; template untouched |
| `composables/useDappHostname.ts:8-27`, used by `discover/index.vue:53`, `capabilities/index.vue:121`, `execute/index.vue:134`, `network-unavailable/index.vue:51` | identical expressions (`url` read once into a local, `h` for the hostname) | file unchanged |

- **Strictness.** The two copies are semantically identical today (only verify reads `dapp.value.url` twice), so the stricter of the two is either one. A probe ran both expressions over 48 inputs on Bun, jsdom (the unit tests' `URL`), and Puppeteer's Chrome and Firefox builds. All four agree except two parse-failure inputs, which Chrome parses and the others refuse (Facts 3). Every disagreement is between engines; none is between the copies.
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
| `popup/windows/json/index.vue:17-23`, `logger/index.vue:13-19` | only when the profile is falsy; `getCurrent(cb)`; `remove(window.id)` unguarded | Phase 3 only (below) |

The callback parameter keeps the name `window`: if Chrome passes no window (a `lastError` path), the `TypeError` names it on JSC and SpiderMonkey exactly as all four copies do today.

### C. Session wait (Q-07 c)

`verify/index.vue:118-133` and `useDappApprovalWindow.ts:102-115` are the same block. The hook module gains:

```ts
/** Resolves on the next `isChecked() === true`. Callers test it first: awaiting an already checked
 *  session would add a tick before their next step. */
export function untilSessionChecked(isChecked: () => boolean): Promise<void> {
	return new Promise<void>((resolve) => {
		const stop = watch(isChecked, (checked) => { if (checked) { stop(); resolve() } }, { immediate: true })
	})
}
```

Both sites keep `if (!appStore.isSessionChecked) await untilSessionChecked(() => appStore.isSessionChecked)`.

- **Await shape.** The helper is not `async` and returns the Promise it builds, so the slow path awaits one native Promise exactly as today, and the fast path still has no await. Today `getDappSession` (verify) and `init` (hook) are invoked inside the mount's synchronous segment when the session is already checked; Phase 1 pins that for verify, and `useDappApprovalWindow.test.ts:129-135` already pins it for the hook.
- The names `stop`, `checked` and `resolve` stay. The immediate callback cannot see `true` (the caller just read `false`), so the `stop` temporal dead zone stays unreachable, as today.
- **Why the hook module:** both callers are dApp windows, and recon names it the home for the shared lifecycle pieces. A new composable file would add a second auto-import module for one function.

### D. Cancellation predicate (Q-07 d)

`popup/utils/cancellable-rejection.ts` gains `isApprovalCancelled(error): error is JobCancelledError`, which is `error instanceof JobCancelledError`. Its TSDoc carries the rule the three sites restate: the refusal is the cancelled state, so the window shows the overlay, never a banner. The rule holds even when the cancel broadcast never reached the popup. `discover/index.vue:110`, `capabilities/index.vue:328` and `execute/index.vue:525` call it; their comments shrink to nothing or to their own facts. Each else-branch is untouched, as are execute's re-arm calls before it and each window's `isLoading` handling.

Not in the hook module: `capabilities/reentrancy.test.ts:57-68` mocks that module without the export, so a capabilities catch path would throw under the frozen test. Module mocks of `cancellable-rejection` exist only in two popup tests that render no window.

### E. Discovery admission (Q-27 a)

`wallet/services/wallet-sdk/background.ts:967-977` (`approveAfterPopup`) and `:1041-1051` (`runDiscoveryPopup`) are the same ladder. Two module-private helpers beside `rejectIfExpired` (`:854`):

- `admitVerifyWindow(discovery, deps)`, **not `async`**, returns `admitAsync(deps.admission, { id: discovery.requestId, origin: discovery.origin, deadline: discoveryDeadline(discovery), needsWindow: true, consumesToken: false })`. Each site keeps exactly one `await`, on the same Promise object.
- `rejectIfNotAdmitted(discovery, deps, admitted): admitted is "rejected" | "expired"`, synchronous: on either outcome it calls `rejectThrottled` with today's ternary text and returns `true`.

| site | guard set today, in order | after |
|---|---|---|
| `approveAfterPopup` | settled-session check (`:948-964`, untouched); admit `{needsWindow: true, consumesToken: false}`; on `rejected` → `rejectDiscovery`, then Warn `Discovery rejected (verify-window queue full): request …`; on `expired` → the same with `expired while queued`; return before `approveAdmitted` | identical; `if (rejectIfNotAdmitted(…)) return` |
| `runDiscoveryPopup` | denial and `rejectIfExpired` before (untouched); the same admission and refusal; the `return` sits inside the `try`, so the `finally` (`:1061-1066`) still clears the handover, closes the waiting window, resolves the dedupe promise and deletes the key; attach and `persistAndApprove` follow only on admission | identical |

The helpers bind the same local names (`discovery`, `deps`, `admitted`), so a malformed SDK object throws the same engine text. `autoApproveExistingSession` (`:903-922`) is a different request (`needsWindow: !trusted`, `consumesToken: true`) and callback form; it stays. The five other reject-and-log scaffolds (`rejectBehindNotice`, the epoch-switch reject, `runNetworkUnavailableNotice`, the attach and profile-change refusals) each carry their own level and text; a helper taking both would only forward them.

### F. Execute's send arms (Q-27 c)

`popup/windows/execute/index.vue:331-348` (`aztec_sendTx`) and `:349-365` (`send_transaction`) have byte-identical bodies. Stack the labels (`case "aztec_sendTx": case "send_transaction": {`) and keep the `aztec_sendTx` comment, which already covers the other's (embedded fee path, self-pay, `requiresFeeSelection`). `isEmbeddedFeePayment` dispatches on `op.kind` at run time. The stacked arm typechecks: a scratch edit of sections A, E and F passed `vue-tsc`, and the execute, verify and worker `background*` suites (27 files, 296 tests) passed with it; it was then reverted.

### What stays, and layering

- `useDappHostname`, `useDappInteractionPayload`, every template, every style, all error copy, the `getRequestId` lambdas, and `wallet/services/dapp-interaction/materialize.ts:68-88`, the background's own identical pair of send arms. That pair is outside the finding and listed as a follow-up.
- `utils/` and `composables/` are auto-import roots (`apps/extension/vite.config.ts:111`, `vueTemplate: true`), so `closeCurrentWindow` and `untilSessionChecked` become globals. No template or script uses either name today. `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` are regenerated by `bun run build` and committed. Call sites import explicitly anyway, as these windows do.
- No new acceptances: none of the touched functions is in the complexity manifest, and every change removes branches. No npm-published entry is touched.

## Security & Adversarial Considerations

- **Who controls the hostname input.** `dappMetadata.url` is written by `discoveryDappMetadata` (`background.ts:1072-1074`) from `discovery.origin`, which the SDK derives as `new URL(sender.tab.url).origin`, or `"unknown"` (`@aztec-labs/wallet-sdk`, `dest/extension/handlers/background_connection_handler.js:54`). A live session's url is therefore a browser-serialized origin: lowercase, punycoded, the default port omitted, IPv6 bracketed, or `"null"` for opaque origins. The non-ASCII loop and the raw fallback are reachable only from a stored row that passes `z.string()`. Both copies treat every such string identically; the table pins the fallback rows too.
- **What a consolidation could widen, and why it does not.** After the change verify's check *is* the composable's, so a future hardening reaches it, which is the finding's point. A future *loosening* reaches it too; the literal table in `useDappHostname.test.ts` plus verify's wiring test turn red on either.
- **Display.** The hostname renders through Vue text interpolation (escaped); the dApp name still passes `sanitizeWireString` in `DappIdentityBlock`. Neither moves.
- **Close guards.** Verify and the hook keep an identical guard, call shape and order (`completeInteraction` first). Phase 3 only adds the guard to json and logger. Chrome and Firefox window ids are positive integers, so the truthiness test equals `id !== undefined` in practice (Inferences). Phase 3 therefore suppresses only today's `remove(undefined)` throw and never leaves a real window open on lock.
- **Throttle path.** Both verify-window admissions keep `needsWindow: true` and `consumesToken: false`: flipping the latter would let a duplicate spend the origin's reconnect budget, and flipping the former would skip the window cap. Phase 1 pins both fields, the refusal texts, the call order, and that nothing is approved or persisted after a refusal.
- **Ordering.** No added await anywhere: `admitVerifyWindow` and `untilSessionChecked` are plain functions returning the Promise the code awaits today, and both sync fast paths stay inline. Phase 1 pins verify's synchronous `getDappSession` call and a microtask-count marker at each worker site.
- **Logging.** No log line, level or payload changes.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `169bed04`):

1. The sites and line numbers are as tabled above. `JobCancelledError` is imported from `@nulo/extension-messaging/errors` by the three windows (`discover:14`, `capabilities:25`, `execute:4`) and by `popup/utils/cancellable-rejection.ts:22`.
2. `useDappApprovalWindow.test.ts:69` stubs `getCurrent(_o, cb)`, so the hook's call shape is already pinned. `:129-135` pins that `init` runs synchronously within `start()` when the session is checked. The three windows' tests pin the `JobCancelledError` overlay (`discover/index.test.ts:367`, `capabilities/index.test.ts:396`, `execute/index.test.ts:573`); only execute's else-copy is pinned (`execute/scope-follow.test.ts:356`).
3. Probe results (scratch, deleted): `https://DApp.EXAMPLE` → `dapp.example`; a trailing dot is kept (`dapp.example.`); ports, scheme, userinfo, path and fragment drop; `https://dapp.example@evil.example` → `evil.example`, not flagged; `%40` in the host fails to parse and shows the raw string; `https://[::1]:8080` → `[::1]`, and `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`; `0x7f.1` → `127.0.0.1`; `exámple.com` → `xn--exmple-qta.com`, flagged; Cyrillic `аpple.com` → `xn--pple-43d.com`, flagged; `XN--EXMPLE-CUA.com` → lowercased, flagged; full-width `ｄａｐｐ`, U+00AD, U+200B and U+3002 map to plain ASCII `dapp.example…`, not flagged; `null`, `unknown` and `not a url` show raw, not flagged; raw `exámple` flagged (loop); raw `xn--exmple-cua` flagged; raw `XN--EXMPLE-CUA` **not** flagged (the label test is case-sensitive). Engine splits: `https://xn--.example` and `https://exá mple.com` parse on Chrome only; the table omits both.
4. No other built arc (4 to 18, at their current heads) touches these files; `src/types/auto-imports.d.ts` may conflict on a restack and is regenerated.

**Inferences:**

- Chrome window ids come from positive session ids and Firefox's from outer window ids, neither ever 0 (moderate-high confidence). This bears only on Phase 3; verify and the hook already rely on it.
- The json and logger windows close only on lock (profile falsy); nothing else calls their close.

**Asks** (for the plan panel):

1. **Q-07 (d).** Ship `isApprovalCancelled` (this plan: it puts the overlay rule in one TSDoc and lets one place change the classification) or drop it as indirection over a single `instanceof`?
2. **Phase 3 here.** The program pre-cleared the json and logger guard; this plan reads "in its own arc" as the arc that owns the finding, landing as its own commit. Confirm, or defer it to a separate arc.

## Phases

### Phase 1: pin each site (test only)

All new tests pass on the unchanged code, in one commit; the test files are then frozen.

1. **Hostname table** (`composables/useDappHostname.test.ts`): one literal table of the Facts 3 rows (both engine-split inputs excluded), each pinning `hostname` and `isSuspicious`. Inputs are origins as the SDK serializes them, plus the raw-fallback rows.
2. **Trust window wiring and display** (new `popup/windows/verify/index.window.test.ts`): mounted with the **real** `DappIdentityBlock` and a wire-shaped session row: a 64-hex verification hash, chain `"0"`, CAIP accounts `aztec:0:0x…` of 64 hex, and `dappMetadata` as the worker writes it, meaning a sanitized hostile name plus an origin. For the origins `https://dapp.example:8443`, `http://[::1]:5173`, `https://xn--exmple-cua.com`, `https://dapp.example.evil.example`, `null`, `unknown` and an imported row's `https://dapp.example@evil.example`, assert the block's `hostname` prop, its rendered text, and whether `dapp-hostname-warning` exists. Then the lifecycle:
   - missing `sessionId`, a missing row, and a throwing `getDappSession` each call `getCurrent(undefined, fn)` and then `remove(id)` once;
   - a window without an id is never removed;
   - OK with "Always trust" calls `setTrustedVerification(id, true)` before `getCurrent`, as an ordered log;
   - with the session already checked, `getDappSession` was called once when `mount()` returns, before any flush;
   - with it unchecked, it is not called until the store flips to checked, and then exactly once.
3. **Cancellation look-alike**, one test per window in its existing file: `approve` rejected by a plain `Error` carrying `name: "JobCancelledError"` and `code: "JOB_CANCELLED"` shows the banner with the window's exact title (`Something went wrong`, or `Processing error.` plus the message) and no overlay.
4. **json and logger** (new `popup/windows/json/index.test.ts`, `logger/index.test.ts`): a lock (`undefined` profile) closes the window by id once; a live profile does nothing. The `getCurrent` stub takes its callback as the last argument, so the pin survives Phase 3's call-shape change.
5. **Worker admission** (new `wallet/services/wallet-sdk/background.verify-reservation.pins.test.ts`). It drives both sites through the SDK callbacks as `background.admission.test.ts` does, with `admitAsync` mocked over the real module and a recording logger. For each site and each of `rejected`, `expired` and admitted, it asserts:
   - the request object (`needsWindow: true`, `consumesToken: false`, `deadline`, `origin`, `id`);
   - the ordered handler calls;
   - the exact Warn line;
   - after a refusal, no approve and no session write, and on `runDiscoveryPopup` the waiting window closed and a parked duplicate released.

   **Microtask marker:** the mock starts a 20-step `queueMicrotask` ladder when it returns a resolved promise, and the test pins, as a literal, the ladder count at the first collaborator call after admission (`approveDiscovery` in `approveAfterPopup`, the first collaborator call `persistAndApprove` makes in `runDiscoveryPopup`).
6. **Send arms** (`popup/windows/execute/index.test.ts`, new describe): wire-shaped payloads (`aztec:1:0x` plus 64 hex, calls with 32-byte fields) for `aztec_sendTx` (default entrypoint, which pre-fills embedded; an FPC payer; a self-pay) and `send_transaction` (with and without `fee.embeddedFeePayment`). Each built operation is pinned with `toEqual` (`network`, `networkId`, `account`, `accountAddress`, `feeSettings`), and so is the signer list when two ops share an account.

**Mutants each must catch** (applied one at a time to a scratch copy, the named tests run red, the file restored by copy; logged in this arc's lessons file):

| mutant | caught by |
|---|---|
| verify shows the raw `url`; its flag is fixed `false` or swapped | 2 |
| the composable drops the `xn--` test, drops the >127 loop, or makes the label test case-insensitive | 1 |
| `closeCurrentWindow` drops the guard, or calls `getCurrent(cb)` | 2, and the hook test |
| `untilSessionChecked` awaited without the caller's test, or made `async` on the fast path | 2, and the hook test at `:129` |
| `isApprovalCancelled` tests `name` or `code` instead of the class | 3 |
| the worker drops the refusal check or its `return`, swaps the texts, skips the log, or flips `needsWindow` or `consumesToken` | 5 |
| `admitVerifyWindow` made `async` | 5 (the marker) |
| one send label removed (falls to `default: throw`); `feeSettings` or `pushUniqueAccount` dropped from the arm | 6 |

Two mutants are equivalent and stated as such: dropping `immediate: true`, since the caller guarantees `false` at creation, and dropping `stop()`, which only leaks a watcher whose later `resolve` is a no-op.

### Phase 2: the dedup (test files frozen)

Sections A to F above, in one commit, plus the regenerated auto-import declarations. `git diff --stat` must show no test file.

### Phase 3: the pre-cleared json and logger guard

`json/index.vue` and `logger/index.vue` call `closeCurrentWindow()` in their lock handler. That adds the `window.id` guard and changes the call shape to `getCurrent(undefined, cb)`, which the approval windows already use on both browsers. The commit also adds one red-then-green test per window: a lock while the current window has no id calls no `remove`. The red run on the Phase 2 head is logged.

- **Invisible:** no pixel, copy, wire or storage change, since a real window always has an id.
- **Strictly safer:** it removes a thrown `remove(undefined)` and relaxes nothing.

It gets an entry under Decisions and a line in the PR body.

**Validation gate (after each phase):**

- **Commands:** the touched test files, then `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`, and `bun run build` (inspect the regenerated declarations).
- **Pass criteria:** all exit 0; Phase 1 green on unchanged source with every mutant above red; Phase 2 touches no test file; Phase 3's new test red on the Phase 2 head and green after.
- **Screenshots** (Phase 2 and Phase 3 heads, each against its parent): see UI impact.
- **Layers:** unit and component here; both e2e lanes on both browsers run in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Point it at this plan's guard tables and ask it to diff each site's guard set, call shape and await count before and after, and to attack the hostname table with further hostile origins. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."). An Opus pass on the same diff, per the program's MID rule.
2. **Fix loop:** triage each finding, fix, commit, log the round in `implementations-plan/harden-dedupe/lessons/arc-19-dapp-windows.md`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the stack, then add both e2e labels. When the program gates are green, with the shards that actually ran recorded, squash-merge.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/19-dapp-windows`. It shares no file with any built arc (Facts 4), so it stacks on whatever arc is the stack's top when it is ready; a restack replays only its commits and regenerates `auto-imports.d.ts` if that conflicts. Code review: off.

## UI impact

None intended: no template, style or copy changes. Because scripts change in seven windows, every touched window is captured at its parent and at its head. The program's local zero-diff harness runs batch `dapp-windows`, with the dApp windows opened through stubbed ports (`installPortStub`). It covers Chrome and Firefox, dark and light, at 360×600@2x, on the real build, plus a `--stability` pass. Any non-zero pixel diff is a refactor bug.

| window | states |
|---|---|
| verify (trust confirmation) | new connection, ASCII origin, emoji grid, step bar; reconnect with a shared account, no step bar; punycode origin with the warning line |
| discover (connect) | ready; punycode origin with the warning; cancelled overlay (approve refused with `JOB_CANCELLED`); error banner (approve refused generically) |
| capabilities | ready; cancelled overlay; error banner |
| execute | `aztec_sendTx` with embedded fee; `aztec_sendTx` self-pay (locked fee card); `send_transaction` with embedded fee; cancelled overlay; `Processing error.` banner |
| network-unavailable | ready (touched through the hook) |
| json | operations rendered (Phase 3 head) |
| logger | log rows rendered (Phase 3 head) |

Every state is reached on the real build through port stubs; none is replaced by a component-test proxy.

## Drift left for the alignment arc

Kept as today, per the program's "Q-07 error copy per window":

- Execute's approve failure shows `Processing error.` with details where discover and capabilities show `Something went wrong`.
- `network-unavailable`'s init catch only logs and shows no banner, where the other three set `Something went wrong`.

**Follow-ups for the program's final report, unchanged here** (both copies of the hostname check share these today, so none is drift between copies):

- **The trust window names the host, not the origin.** `http://dapp.example` and `https://dapp.example:8443` render exactly like `https://dapp.example` in all five windows. Showing a non-default scheme or port is an anti-phishing UI change and needs owner sign-off.
- **The raw fallback is weaker than the parsed path.** An unparseable stored url shows verbatim; its `xn--` test is case-sensitive and sees `https://xn--…` as one label. Parse failures also differ by engine. It is unreachable for live sessions (browser-serialized origins), and reachable only through a stored row.
- **`null` and `unknown` render with no warning.**
- **`wallet/services/dapp-interaction/materialize.ts:68-88` has the same identical send arms** on the worker side.

## Decisions (delegated)
