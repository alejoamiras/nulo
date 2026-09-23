# Phase 5 — the smoke suite on Firefox

First full run: 94 passed, 19 failed, 16 skipped. Four causes, none of them in the wallet.

## 1. Extension-page `goto` sites the seam guard could not see (5 tests)

`migration.test.ts` and `onboarding-tab.test.ts` still called `page.goto(extensionUrl(…))`, which over BiDi strands the page (Phase 4, finding 3) and surfaced as a 30 s navigation timeout. They now go through `gotoExtensionPage`, as does `network/session-profileSwitch.test.ts`. The e2e tree is **not typechecked** — a missing import in one of these passed `bun run typecheck` and failed only at run time — so a port here is proven by running the file, not by the compiler.

## 2. A scripted click cannot open a file picker on Firefox (10 tests)

Every import test did `Promise.all([page.waitForFileChooser(), clickByTestId(…)])`. `clickByTestId` clicks from inside an evaluated function; Chrome treats evaluated script as a user gesture and Firefox does not, so Firefox refuses the picker and no chooser event ever comes. The wallet's `pickFile` appends its `<input type="file">` to the body *before* asking for the picker and removes it on `change`, so on Firefox the helper sets the file on that pending input directly. Eight identical copies of the chooser snippet became one `pickFileByTestId`. (This fixture's `waitForSelector` replacement waits but returns no handle — the first version of the helper trusted its return value.)

## 3. WebAuthn needs the *active* tab, and the PXE window takes the foreground (3 tests)

Registration with a passkey passed; every later ceremony (unlock, backup export, discovery import) failed. Measured in-page: `navigator.credentials.get` was called with user activation and rejected `NotAllowedError: CredentialsContainer request is not allowed` after **0 ms**, with the credential still in the authenticator (`signCount` 2). That is Firefox's active-tab precondition, not the authenticator. On Firefox the PXE lives in a real window created minimized and unfocused; headless Firefox honours neither, so after the first unlock the wallet page reports `document.hasFocus() === false`. `page.bringToFront()` before the click and the same ceremony returns PRF results. `clickByTestId` now does that on Firefox: a person can only click a page they are looking at, so the scripted click should not claim less.

**For the owner — a manual check worth one minute:** this is a headless artefact as far as could be measured, but if the minimized PXE window ever takes the foreground in a real Firefox, passkey unlock fails exactly this way, silently (the page maps the rejection to "user cancelled"). Unlock with a passkey once in a headed Firefox build.

## 4. A ceremony that must stay pending (1 test)

"Escape during modal resets agreement gate" removes the virtual authenticator so the request hangs until Escape aborts it. Chrome hangs; Firefox answers an authenticator-less request at once, the dialog never mounts, and WebDriver has no way to hold a ceremony open. `stallNextPasskeyCeremony` keeps Chrome's behaviour and, on Firefox, replaces the page's `credentials.get` with one that settles only on the caller's abort signal — the path the Escape handler takes, which is what the test is about.

## Also

- Both global setups defaulted to `dist/chrome` whatever the browser; a Firefox run without `EXTENSION_PATH` would have loaded Chrome's build. They now default to `dist/<browser>`.
- `journal.swEvaluate` needed no change: with no `service_worker` target it already returns its marker string.
- Killing a run mid-flight left one geckodriver; the next launch logged `reaped 1 orphaned launch(es)` and removed it — the orphan sweep's first unplanned use.
- `firefox-smoke.mjs`, `smoke:firefox` and the three spike scripts are gone; the debug skill points at `NULO_E2E_BROWSER=firefox bun run test:e2e`.

## Review (codex, same arc session) — converged

One Medium and one Low, both taken: the stalled-ceremony stub hung for good if Escape aborted the signal before the stub subscribed (the dialog listens before `runGet` finishes building its options), and the file helper took the first pending input, which after an abandoned pick is a dead request's. The stub now honours an already-aborted signal and the helper tags inputs that predate its click. Follow-up round: "no new material findings".
