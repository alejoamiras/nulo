# Recon — firefox-first-class-spike

Base: `origin/dev` at `9b2c747b` (2026-09-18). Two read-only Sonnet explorers (reuse sweep + Chrome-only API inventory), plus a hands-on spike run in this worktree (Firefox 153.0.4, geckodriver 0.37.1, headless). Where the spike contradicts older notes, the spike wins and the contradiction is called out.

## Reuse map

| Capability needed | Existing code | Verdict |
|---|---|---|
| Browser launch + extension load | `apps/extension/tests/e2e/fixtures/extension.ts` `launchExtension()` (L50-111): implicit CDP launch, `--load-extension`, id from the `service_worker` target (L120-124), `chrome-extension://` navigation (L138, 218, 267, 1235) | **adapt** — split into a browser seam; Chrome body moves unchanged |
| Browser selection switch | none. Search: `grep -rn BROWSER` over `.ts/.mts/.mjs/.json`, vitest `projects` in both e2e configs | **build new** — one env var, matching the fail-loud `E2E_REQUIRE_SETUP` style in `global-setup.ts` |
| Extension-origin URLs | 9 `chrome-extension://` literals: `extension.ts:138,218,267,1235`, `journal.ts:117,148`, `playground.ts:238`, `popups.ts:4`, `helpers/rpc-intercept.ts:66` | **adapt** — one `extensionUrl()` helper |
| Find pages/windows the extension opens | `fixtures/popups.ts` (targets diff by `#/windows/{kind}`, L22-51, 423-425), `fixtures/playground.ts` `callExpectingNoPopup` (L238-249), `journal.ts` `extCtxEvaluate` (L147-148) — all `browser.targets()` | **adapt** — `browser.pages()` works on CDP and BiDi; one shared finder |
| WebAuthn virtual authenticator | `fixtures/passkey.ts` — CDP `WebAuthn.*` per frame tree (L113-179), surface `PasskeyAuthSetup` | **build new** Firefox impl behind the SAME `PasskeyAuthSetup` shape (classic WebDriver); Chrome impl untouched |
| Kill/restart the background | `fixtures/helpers.ts` `stopServiceWorker` (L1989-2040), `findServiceWorkerTarget` (L1979-1987) — CDP `Target.*` | **Chrome-only** (owner decision). 8 test files depend on it |
| Dead-RPC interception | `helpers/rpc-intercept.ts` (whole file CDP `Target.setAutoAttach` + `Fetch.*`, reworked in #624) | **Chrome-only** — BiDi has no hold-new-target-until-armed primitive. 1 test file |
| Journal reads | `fixtures/journal.ts` — `chrome.storage.*` reads are browser-agnostic; `swEvaluate` (L116-121) is diagnostics-only and already tolerant of a missing worker | **adapt** — `swEvaluate` no-ops on Firefox |
| Skip tagging | 128 `skipIf` sites, all config/prover-driven, none browser-driven | **build new** convention: `describe.skipIf(isFirefox)` with a reason constant |
| Build under test | smoke: `global-setup-smoke.ts:11` honours `EXTENSION_PATH`, falls back to `dist/chrome`. network: `global-setup.ts:21` HARDCODES `dist/chrome` | **adapt** — give network the same seam; default per browser |
| Run isolation | `scripts/e2e/agent.sh`, `scripts/e2e/resolve-ports.ts` (`PortPack`), `tests/e2e/lockfile.ts` (`OwnedState`, `newAztecDataDir()` under `NULO_E2E_DATA_ROOT`), `killProcessGroup()` (`global-setup.ts:827-855`), `e2e:reap` | **reuse-as-is** — geckodriver is one more owned process + port + data dir |
| Stale-browser cleanup | `pkill -f "chrome.*--load-extension=…"` in `global-setup.ts:198`, `global-setup-smoke.ts:21` | **do not copy** for Firefox — owned-pgid teardown + `e2e:reap` only (a name-based Firefox pkill would kill other agents' browsers) |
| Pinned binary download in CI | `.github/actions/setup-presto-server/action.yml` — cache keyed on version+sha, tarball SHA-256, single-member tar check, binary SHA-256 re-verified on cache hits | **reuse as template** for `setup-geckodriver` |
| Browser install in CI | `.github/actions/setup-puppeteer` (caches `~/.cache/puppeteer`) | **adapt** — add a `browser` input |
| Smoke reusable workflow | `_extension-smoke-e2e.yml` (inputs `extension_path` / `artifact_name`) — already the "smoke against a release artifact" seam | **adapt** — add a `browser` input |
| Network reusable workflow | `_extension-network-e2e.yml` — `--shard=N/5` + dedicated heavy lanes, `setup-presto-server`, all on `dist/chrome` | **adapt** — `browser` input; Firefox legs skip the Chrome-only heavy lanes |
| Advisory job pattern | `nightly.yml` `rp-host-live` (L254-266): `continue-on-error: true`, outside `status` | **reuse-as-is** |
| Release chain gap | `release.yml` L226-252: `build-firefox` exists; `smoke-against-artifact` needs only `build-chrome` | **build new** job `smoke-firefox-against-artifact` |
| Firefox build pieces | `manifest/manifest.firefox.config.ts` (gecko id `wallet@nulo.sh`), `src/manifest.test.ts:95-105` pin, `vite.firefox.config.mts`, `src/wallet/utils/offscreen.ts` stand-in window, `chrome.sidePanel` guards | **reuse-as-is**; manifest gets two additions |
| Standalone Firefox smoke | `apps/extension/scripts/firefox-smoke.mjs` (`smoke:firefox`), Puppeteer-launched BiDi, not in vitest or CI | **retire** once the vitest Firefox lane covers its walk (superset) |
| PRF ceremony tests | `passkey-ceremony.test.ts` covers only `buildCreateOptions`; `runCreate`/`runGet` are unexported and untested; `PasskeyCeremonyDialog.test.ts` mocks the module. No test pins "Passkey PRF has no results" (grep over `apps/extension/{src,tests}`) | **build new** — tests through the exported `runPasskeyCeremony` with a stubbed `navigator.credentials` |

## Portability census (from the inventory explorer)

- Smoke: 33 files → 27 portable once the shared fixtures port, 6 Chrome-only (`passkey-backup`, `passkey-paths` become portable with the classic authenticator; `sw-resilience`, `sw-restart-network`, `imported-account-lifecycle`, `import-dead-rpc` stay Chrome-only).
- Network: 93 files → 86 portable-with-fixture-change, 7 flagged: 2 passkey (portable with the classic authenticator) and 5 `stopServiceWorker` users (Chrome-only): `cold-wake-discovery`, `balance-row-reconciliation`, `frozen-account-canary`, `connect-locked-queue-sw-restart`, `backup-restore-sw-restart`. `passkey-execution-canary` also calls `stopServiceWorker` → Chrome-only.
- `migration.test.ts` relaunches on the same `userDataDir`; must be re-validated against Firefox temporary-add-on semantics (a temporary add-on does not survive a restart).
- Choke points: `extension.ts` (launcher, id, URL prefix) and the `targets()`-based finders in `popups.ts` / `journal.ts` / `playground.ts`. Porting those unblocks everything else at once.

## Spike findings (run here, not read)

1. Extension-opened `type: "popup"` windows are reachable on Firefox by classic window handles AND by Puppeteer over BiDi (`browser.pages()` + `evaluate`). **This contradicts** `.claude/skills/chrome-extension-debug/SKILL.md` L54-57 ("no such frame") and the recon explorer that quoted it. The old symptom reproduces only when the window loads Nulo's popup page with no profile: that window is gone from `windows.getAll` within 3 s. Not yet exercised: a real approval window on an existing profile (Phase 2 probe).
2. Hybrid session works: geckodriver owns the session (`webSocketUrl: true`); `puppeteer.connect({ transport, protocol: "webDriverBiDi" })` with a transport that answers `session.new` / `session.end` locally. Without it Firefox replies "Maximum number of active sessions".
3. Classic virtual authenticator + PRF works on `http://localhost` and in a `moz-extension://` tab with RP ID `passkey.nulo.sh`: deterministic 32-byte PRF on `get`. It REQUIRES prefs `security.webauth.webauthn_enable_softtoken=true` and `security.webauth.webauthn_enable_usbtoken=false`; without them `credentials.create` never settles.
4. `POST /window/new` hangs while the current window is a popup; switch to a normal tab first.
5. Firefox returns `prf.enabled: true` with no `results` at create. `runCreate` throws on exactly that → "Profile creation failed". With the fallback-to-`get` fix the real UI reaches home.

## Corrections to standing docs

- `CLAUDE.md` and `CI.md` still describe `accelerator-server` / `VITE_NULO_ACCELERATOR_REQUIRED`. The code uses Presto (`VITE_NULO_PRESTO_REQUIRED`, `setup-presto-server`); zero code hits for `ACCELERATOR`. Out of scope to fix wholesale; the docs phase touches only the lines it edits.
- `.claude/skills/e2e-testing/SKILL.md` has no Firefox content.
