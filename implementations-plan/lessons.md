# Lessons

Curated gotchas from closed plans, read at the start of every task so no dead end is walked twice. One line per entry, each linking its evidence: an archived lessons log or a permalink. The budget is 8 KiB: a new entry deduplicates, retires what it supersedes, and dates anything tied to a tool version.

## Tooling

- Bun trusts a warm cache (1.4.2, 2026-09): it never re-checks the lockfile's sha512 against its cache, so a poisoned cached file survives `bun install --frozen-lockfile`; a job that produces release bytes restores no cache ([evidence](tools-extraction/lessons/phase-2.md)).
- Under `bun test`, loading `@aztec/*` in process throws from `expect.addEqualityTesters` on a cold transpiler cache; run such checks in a `bun` subprocess ([evidence](tools-extraction/lessons/phase-2.md)).
- Timed tests (`e2e/config` today) time out under the parallel `test:all` / `audit:vue` load, so rerun the file alone before calling it breakage (2026-09); a cold dynamic import in the timed body is one cause, fixed by importing in `beforeEach` on the hook's default budget, as `content-message-relay` and `presto/client` do. [Evidence](tools-extraction/lessons/phase-1.md), [more](e2e-reliability-fixes/lessons/phase-2.md), [more](hygiene/lessons/phase-1.md)

## Cloudflare

- wrangler reconciles custom domains only when `routes` lists one (4.129.1, 2026-09), and Workers Builds takes only user tokens: with a Workers-only build token, attach the domain outside the config and commit no `routes` ([evidence](tools-extraction/lessons/phase-2.md)).
- An agent session refuses DNS and domain changes and Pages project deletes, even with a token in hand: plan them as owner steps ([evidence](tools-extraction/lessons/phase-2.md)).

## CI & gates

- In a `gh stack` the plans gate runs on every arc head, so an arc cannot link a plan file a later arc adds: name it as text, and let the arc that adds it restore the link. [Evidence](ux-feedback/lessons/final-pass.md)
- Unlike the build, the extension's unit vitest auto-imports only `vue` and `vue-router` and registers no components: an auto-imported composable or store throws "is not defined" and a bare tag stays unresolved, so import them or pass `global.components`. [Evidence](ux-feedback/b5-permissions/lessons/phase-7.md), [more](ux-feedback/b4-snackbar-rows-arrivals/lessons/phase-3.md)
- `apps/extension/src/types/`'s tracked declarations regenerate only when Vite builds or serves (vitest has `dts: false`), so local gates pass on a stale copy and CI's build fails on the diff: build before committing a new auto-imported export or component. [Evidence](ux-feedback/b5-permissions/lessons/phase-4.md), [more](ux-feedback/b3-tooltips-glossary/lessons/phase-3.md)
- Under `vi.useFakeTimers()` a natively dispatched event runs only the first Vue listener it reaches, since runtime-dom skips listeners attached no earlier than the event's `_vts`: dispatch with `wrapper.trigger`, which stamps `_vts` 1 ms ahead, or advance time 1 ms first (Vue 3.5.41, 2026-09). [Evidence](ux-feedback/b3-tooltips-glossary/lessons/phase-1.md), [more](ux-feedback/b3-tooltips-glossary/lessons/phase-4.md)
- A second `@vue/test-utils` `mount` in one test drops the first wrapper's stubs: VTU installs its stub transform through Vue's process-global `transformVNodeArgs` and replaces it on every mount, so the first tree re-renders with real components and its failed unmount leaks document listeners into later tests. Show the second tree in a plain `createApp` (VTU 2.4.11, 2026-09). [Evidence](wallet-safety-fixes/lessons/phase-1.md)
- vitest 4.1.10 never re-runs a fixture setup that threw: every retry gets a test-scoped fixture as `undefined` and a file-scoped one's first error, so one setup failure reads as a second bug (2026-09). [Evidence](e2e-reliability-fixes/lessons/phase-3.md)
- A test that something never happens proves nothing until its fixture can make it happen: pair it with a success-path control in the same fixture. [Evidence](connect-window/lessons/post-impl.md)

## E2E

- One Puppeteer `waitForFunction` is one protocol call, so `protocolTimeout` caps it whatever its own `timeout` (300 s in `apps/extension/tests/e2e/fixtures/browser/`): a longer wait fails as `Runtime.callFunctionOn timed out`. Poll in short reads (Puppeteer 25.8, 2026-09). [Evidence](wallet-safety-fixes/lessons/phase-6.md)
- A held key is a second `keyboard.down`: Chrome (CDP) and Firefox (BiDi) both deliver it with `repeat: true`, and both browsers' native buttons activate on it. Firefox's repeat lands 40 to 50 ms after the press, so an action that ends sooner has already swapped the page. Record `repeat` and the target in the page, so a driver that stops sending it, or a repeat that misses the control, fails the step (Puppeteer 25.8, 2026-09). [Evidence](wallet-safety-fixes/lessons/phase-6.md), [Firefox](keyboard-guards/lessons/phase-3.md)
- Enter in a form field clicks the form's default button; when that click's handler disables the button, Vue re-renders before the activation, so no `submit` fires on Chrome or Firefox: count clicks on the default button, not submits (Vue 3.5, 2026-09). [Evidence](keyboard-guards/lessons/phase-3.md)
- Browsers and Node's fetch and WebSocket refuse the Fetch standard's bad ports before connecting, and 10080 lies inside the e2e port draw's window: a randomly drawn port skips the whole table (Node 24.21, 2026-09). [Evidence](e2e-reliability-fixes/lessons/phase-8.md)

## Extension runtime

- A wire-shaped field fixture must stay below the BN254 modulus (`0x3064…`): `0x` + `aa` × 32 is above it, so the capability validator refuses it as malformed, while `0x` + `0a` × 32 passes. [Evidence](ux-feedback/b5-permissions/lessons/phase-6.md)
- A lock section the watchdog force-released keeps running (`packages/wallet-core/src/utils/lock.ts`), and `nextNumericId` (max + 1) reuses a purged top id on the next restore, so a late compensating delete by id can hit a successor's row. Gate it on `withLock`'s `isCurrent` where the row predates the deletion, whose purge removes it; skipping it orphans a row that may postdate the purge's snapshot. [Evidence](wallet-safety-fixes/lessons/phase-6.md)
- The local network's chain id is 0 (`CHAIN_IDS.SANDBOX`), so a truthiness guard on `chainId` skips the chain every network e2e runs on: History never named a received row's token there. Test for the network, or for `chainId === undefined`. [Evidence](ux-owner-picks/lessons/phase-2.md)
- The node client retries a failed POST, not a node's refusal: a poller that must go quiet on lock needs a one-attempt client, and a refused retry can hide a send that landed (Aztec 5.2.0, 2026-09). [Evidence](failed-send-check/lessons/phase-7.md)
- `@aztec/protocol-contracts/fee-juice` loads a 570 KB artifact at import, with no `sideEffects: false`: imported by a module the `@/wallet/utils` barrel re-exports, it ships a second copy to every popup. Keep it out of the barrel (5.2.0, 2026-09). [Evidence](send-states/lessons/phase-1.md)

## Authorization checks

- Validate both sides before comparing normalised keys: `key(a) === key(b)`, where `key` returns `undefined` for bad input, matches two bad inputs, and plain string equality let a malformed listed contract match an identical call target ([red run](grant-check-address-case/lessons/phase-1.md)).

## Popup UI

- Space Grotesk's default digits are proportional (weight 700: "1" 452 units, "0" 648), so a figure re-fitted to its line on every frame of a count pulses: while it counts, let the fit only shrink, then fit the next figure afresh. The font has `tnum`, but tabular digits change every figure's look, an owner call. [Evidence](ux-owner-picks/lessons/phase-1.md)
- A bare `<button>` shows no focus ring, since `@nulo/design`'s base.css sets `button { outline: none; }`, and onboarding's active method tab draws its accent outline on an accent fill. Look at a capture before it claims a ring. Picture a refused key with its action enabled, or validation passes for the guard. [Evidence](keyboard-guards/lessons/phase-4.md)
