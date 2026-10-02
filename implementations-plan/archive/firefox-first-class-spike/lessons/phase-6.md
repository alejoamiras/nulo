# Phase 6 — the network suite on Firefox

Lanes were run exactly as CI composes them (`NULO_E2E_RETRY=0`, `VITE_NULO_FEE_MULTIPLIER=10`, the six pool excludes; the canary with an owned `PRESTO_ALLOW_ALL=1 presto-server` and `VITE_NULO_PRESTO_REQUIRED=1`). The first pool shard failed almost everywhere; five causes accounted for all of it, one of them in the product.

## 1. A new tab lands in the wallet's minimized PXE window (most failures)

Puppeteer's `newPage()` creates a *tab*, and Firefox puts a tab in the most recently focused window. Once the wallet has unlocked, that is the minimized window hosting the PXE. A page there reports `visibilityState: hidden`, gets no animation frames — so every Vue `<Transition>` froze with `slide-enter-from slide-leave-from slide-leave-active` on the element the test was waiting for — and `browsingContext.create` intermittently failed with `browsingContext is null #waitForVisibilityState`.

Two wrong fixes came first and were both reverted: treating `browsingContext is null` as a gone target, and swapping `sendTransfer`'s bare click for `clickByTestId`. Both made a symptom quieter. The cause only showed when the page's own `visibilityState` was read. `newPage` is now a driver method that opens a **window**, every `browser.newPage()` in the suite goes through it, and the seam guard rejects a direct call.

`bringToFront` before a scripted click (Phase 5) turned out to be a separate fact, not a stand-in for this: removing it re-broke the passkey ceremonies, because WebAuthn wants the *focused* window and headless Firefox gives focus to the PXE window whatever `focused: false` says.

## 2. Reloading an extension page strands it, exactly as navigating does

`page.reload()` over BiDi crosses the same process swap as `goto`. `reloadExtensionPage` goes over the classic channel (`POST /refresh`); three call sites moved.

## 3. Background-window timer throttling starves fee estimation (3 tests)

`waitForExecuteApprovable: not approvable after 10000ms … feeMethod:null`. Firefox clamps a background window's timers to 1 Hz and then budgets them; the PXE runs in one. Three `dom.*timeout*` prefs at launch, the counterpart of the Chrome driver's backgrounding flags. **For the owner:** this throttling is real for users too — a wallet whose PXE lives in a minimized window estimates fees slowly on Firefox. Not a test artefact, not fixed here.

## 4. Firefox delivers tab URLs Chrome withholds (1 test)

`session-tabNavigate`'s visibility pin asserts that `tabs.onUpdated` withholds `changeInfo.url` for an origin with no `host_permissions` grant. Firefox counts a content script's match patterns as host permissions, and the wallet's matches every site, so the URL is delivered. The test now pins both browsers' behaviour. **For the owner:** on Firefox the background sees the URL of every tab navigation; the origin guard's cross-origin branch is live for ordinary sites there, dead on Chrome.

## 5. Product bug: the amount input re-read a model it had just written (1 test)

`send-amount-clamp` typed `1.1234567890123456789` and found `0.` in the field. Logged per event: after `1.` the value fell back to `1` before the next key. `handleAmountInput` wrote `model.value` and read it back within the same handler, and — with a parent-owned `v-model` — a write is only visible after the parent re-renders. It worked because a real keystroke gives a microtask checkpoint between v-model's `input` listener and the component's, and Vue flushes there. Keys typed over BiDi dispatch both listeners with no checkpoint (measured: a microtask queued in the first had not run in the second; `isTrusted` was true). The handler now computes from the input's own value and writes once, reproducing the old handler's real-keystroke results exactly (the first rewrite did not — see the review below); unit tests pin the stale-prop case and the zero-decimal one. Own commits: `2e02a8f1`, `b66f32ce`.

## Results

| Lane | Result |
|---|---|
| pool 1/5 | exit 0 — 20 passed, 3 skipped |
| pool 2/5 | exit 0 — 19 passed, 2 skipped |
| pool 3/5 | exit 0 — 19 passed, 5 skipped |
| pool 4/5 | exit 0 — 24 passed |
| pool 5/5 | exit 0 — 22 passed, 1 skipped |
| heavy | exit 0 — 6 passed |
| heavy-concurrent | exit 0 — 1 passed |
| canary (real proving) | exit 0 — 2 passed; 5 `Proving succeeded` in the presto-server log |

The table is the final battery, run after the review loop's last fix: every lane on one SHA, the two proverless runners side by side and the canary alone. Skips are the six Chrome-only network files in `recon.md`, whole-file. Zero leftover geckodriver/Firefox processes after each lane.

## Quality round (owner request: fewer monkey-patches, fewer footguns)

- **Every browser difference is on `BrowserDriver`.** `prepareClick`, `pickFile`, `virtualAuthenticator` and `holdNextCredentialGet` joined the interface; `extension.ts`, `passkey.ts` and `helpers.ts` no longer ask which browser they are on, and Chrome's CDP authenticator moved to `fixtures/browser/chrome-webauthn.ts` verbatim. The seam guard now rejects an `isFirefox`/`BROWSER` branch anywhere under `fixtures/**` or `helpers/**` — a helper that forks on the browser is a second, unlisted driver.
- **The e2e tree's unresolved names fail a 3-second unit test.** Phase 5 lost time to a missing import `bun run typecheck` cannot see (the tree is outside it, and carries too much type debt for a full check). `scripts/e2e/unresolved-names.test.ts` type-checks the tree and keeps only "this name resolves to nothing". Its first run found a bug already on `dev`: `global-setup.ts`'s sandbox-reuse branch assigned an undeclared `weStartedTools` — a `ReferenceError` on every reuse. Fixed in the same commit.
- **Probes retired**: `tests/e2e/probes/`, `vitest.e2e.probes.config.ts`, `e2e:agent:probes` and the `NULO_E2E_VITEST_CONFIG` hook in `agent.sh` are gone; the real suites cover what they measured.
- What stays a patch, on purpose: the `session.new` shim (Firefox allows one session; there is no supported way to attach Puppeteer to an existing one), `Frame._id` (no public accessor for the BiDi context id; throws by name if it moves), and the `credentials.get` stub (WebDriver cannot hold a ceremony open). Each is one function with its reason on it, and `tests/e2e/FIREFOX.md` lists them.

## Host notes

Two **proverless** sandboxes run side by side on this host without starving each other; the old "network e2e runs alone" rule came from a prover-ON run. Concurrent runs need separate checkouts, because each `e2e:agent` builds into `apps/extension/dist/<browser>`.

## One more closed-window wording

A later full run failed once in `connectPlayground:approveDiscover — Browsing context already closed`: the approval window closed on the click while `clickByTestId`'s `waitForFunction` was still polling, and Puppeteer's BiDi realm, disposed first, reports that in its own words rather than Firefox's. It joins the driver's `targetGone` pattern. As with the CDP phrases the fixtures already accept, it proves the window went away, not that the click landed — every caller asserts the outcome next.

## Arc 5 boundary — codex fix loop (GPT-6 Astra, `high`) — converged in three rounds

- **Round 1 → changes requested.** Five findings, each checked against the repo and all taken. (1) The new `AmountCard` pin passed on the old code: a `defineModel` with no `onUpdate:modelValue` listener is local state, so the read was never stale — both pins now mount a parent-owned model. (2) The handler rewrite was **not** behaviour-preserving: it clamped the normalised value where the old handler, on a real keystroke, clamped what was typed, so a first `0` on a zero-decimal token became `0` plus a hint instead of `0.`. That is a UI change nobody signed off, so the change was removed rather than defended: the handler now reproduces the old results from the input's own value (derivation in `b66f32ce`'s message). (3) The name scan missed `TS18004` and its blanket `browser` exemption hid a real miss. (4) Three easy bypasses of the browser-branch rule — an import alias, `driver.kind`, the env var — and a false positive on a member named `BROWSER`. (5) The moved WebAuthn comments carried dated experiments and a misleading note about the anchor page.
- **Round 2 → one [Low].** Exempting member names had also exempted `seam.isFirefox` on a namespace import. Codex ran **900 in-memory cases** of the amount handler against the original — paste-shaped input, extra dots, commas, letters, over-cap values, zero-decimal tokens — and every final value and clamp flag matched. Its note that a cross-reference to `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md` breaks the comment rule was declined: the repo's own style section names that file as a permitted live reference; codex withdrew it.
- **Round 3 → "no new material findings. Confidence: high for this fix delta."**

Two things codex said that are not defects and are the owner's to weigh: `prepareClick` **can conceal** a wallet window that fails to take focus for a passkey ceremony, and the timer prefs **do conceal** fee-estimation delay in a stock Firefox. Both are on the hand-off list.
