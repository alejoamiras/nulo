# Decision ledger — legal-terms

Round 1: Codex **reject**, Fable **conditional-approve**. Every HIGH was re-verified against the code
by the driver before adjudication. `C#` = `audit-codex.md`, `F#` = `audit-fable.md`.

| # | Finding | Verified | Decision | Effect on the plan |
|---|---|---|---|---|
| C1 | `AuthRegistryService.revokeAuthwits` / `setRegistryEnabled` call `executeSendTransaction` directly (`auth-registry/service.ts:283, :337`) — both planned guards bypassed | ✔ — and the plan's "two entry points" fact was wrong | **Adopt, and go further** | The authoritative guard moves to the one broadcast site every path converges on: `ExecutionCoordinator.sendTxTask` (`execution-coordinator.ts:281-292`, the only `node.sendTx` in `src/wallet`). It is awaited **before** `assertLive()` — that method's invariant forbids an await between the liveness check and the send. Entry-point guards stay as early refusals (no proving work wasted), not as the wall. Pin: a test asserts `node.sendTx(` occurs exactly once under `src/wallet` and that the guard precedes it. |
| C1b | Fee estimation builds signed requests while declined; `send.vue`'s estimate watcher stays live | ✔ | **Adopt (narrow)** | `send.vue` skips estimation while status ≠ current. Estimators are not guarded service-side: they broadcast nothing, and the wall is at broadcast. |
| C1c | Should a declined user still be able to **revoke** authwits (a protective tx)? | — | **Owner ask; default = blocked** | One rule ("no broadcast without acceptance") is the only version that cannot be got wrong. The user is never trapped: export always works. Recorded as an Ask. |
| C2 / F4 | Sheet shows inside dApp windows; "Not now" navigation abandons an approval; "once per session" undefined | ✔ | **Adopt** | Sheet never renders on `windows-*`, `popup-auth`, `popup-register`, `/popup/legal/*`, or `/popup/settings/security/export/*`. Dismissal persists in `chrome.storage.session`, keyed by Terms version (once per browser session). Loading state until the first read resolves. z-index below `GlobalLoader` (9999). |
| C3 | Export reachability unproved — passkey full backup runs an **in-page** ceremony (`full.vue:147`) | ✔ | **Adopt** | The route exclusions above make the sheet structurally absent on export pages. e2e proves it with **hit-tested pointer clicks** for password seed, password full, account, and passkey full export, under missing / stale / corrupt records. |
| C4 | A module-owner walk cannot establish "exactly what ships" (embedded code in the Buffer shim, the SQLite worker graph, tree-shaken over-inclusion) | ✔ (shim and worker confirmed) | **Adopt; claim downgraded** | Generator reads **rendered** modules from emitted chunks (`chunk.modules`), is registered for worker builds too, and is completed by a reviewed `VENDORED` list (embedded third-party code inside a package, wasm assets) with source URLs. Success criterion 5 no longer says "exactly". |
| C5 | `pako` is `(MIT AND Zlib)`; `@aztec/sqlite3mc-wasm` has no licence field or file | ✔ | **Adopt** | SPDX `AND` handled (every branch must be allowed); `Zlib` added; packages with no metadata need a hand-verified `OVERRIDES` entry with provenance — never a template with an invented copyright line. Arc C is blocked on Presto **and** on resolving sqlite3mc's provenance upstream. |
| C6 | Two writers can lose a history entry; mirroring `createOnboardingFlag()` publishes state before persistence | ✔ | **Adopt — take Shape B's write path** | New `LegalAcceptanceService` in the service worker: `accept(surface)` under the service lock, stamps versions from its own manifest, emits `onAcceptanceChanged`; UI holds a client. Also resolves F6's store-pin problem (nothing added to `app.store`). Enforcement and device scope stay Shape A. |
| C7 | major.minor comparison silently accepts a *material patch*; downgrade / future versions / clock skew undefined; capped history is not "append-only" | ✔ | **Adopt** | Manifest invariant (tested): a material version always bumps minor or major; versions strictly increase. An accepted version newer than the manifest (extension downgrade) is `current` and is never overwritten by an older one. Timestamps are informational only. History is described as "the last 20". |
| F1 | Plan misquotes Terms § 3; treats the Privacy Policy as accepted although § 23 says acceptance is not processing consent; button label differs from § 3 | ✔ | **Adopt** | Status derives from the **Terms only**. The record keeps `privacyVersionShown`. Privacy-only changes never gate; they surface as a non-blocking notice in About. Controls use § 3's literal labels, pinned by test against `legal/terms.md`. Two text edits go to the owner as Asks (a "recorded on your device" sentence in § 3; a storage-table row in privacy § 3). The approved gate checkbox copy changes → U1 re-opened for sign-off. |
| F2 / C10 | e2e scenarios pass for the wrong reason (`isAllowedToSend` false on an empty form; `target.click()` ignores overlays; relaunch re-seeds) | ✔ | **Adopt** | Assert `send-legal-banner` presence/absence, not button state. Lock-out proofs use real pointer events. `launchExtension({ legal: "current" \| "missing" \| "stale" \| "corrupt" })`, honoured across relaunch. |
| F3 / C8 | `preDispatch` port mis-specified (sync ladder, N+1 batch reads, optional = forgettable); discovery is outside the dispatcher | ✔ | **Adopt** | Port dropped; `wallet-bridge` untouched. Guard awaited inside the `try` before `background.ts:1082`. New discovery sessions are refused at the pending-discovery handler; existing sessions keep transport-level discovery (documented, coherent). Refusals log at `debug`, not `Error`. |
| F5 | Onboarding guard hole via `hydrateKnownProfile()` → `/learn` | ✔ | **Adopt** | Allowlist guard (`welcome`, `terms` open; everything else needs a current record); `next` validated as an enum. |
| F6 | Layer placement | ✔ | **Adopt** | `components/composite/LegalConsent.vue` (L3, pure, ≥ 10 tests); `components/LegalAcceptanceSheet.vue`; `popup/pages/legal/declined.vue`; thin `onboarding/pages/terms.vue`. |
| F7 | Landing: front matter mis-renders; no heading ids by default; `.md` links 404; single script slots; Bun types; landing never built in CI | ✔ (rendering reproduced) | **Adopt** | Version parsed from the existing line 3 — **zero edits to the legal text for plumbing**. `{ headings: { ids: true } }`. Link rewrite. Scripts chained. Runtime assert on `Bun.markdown`. Landing build + test added to `quality-status`. |
| F8 | The structural grep pin is theatre | ✔ | **Adopt** | Inverted: the set of files referencing the guard must equal the intended list exactly. |
| C9 | `test:components` excludes onboarding; root `scripts/` tests are not run by `test:all`; CI path filters | ✔ | **Adopt** | Gates use `bun run test`; the notices core becomes a workspace package so `test:all` finds it; path filters gain `packages/legal/**`, `legal/**`. Fixture work moves to the phase where enforcement first lands. |
| F9 | Trimming | — | **Adopt** | Scenarios folded; "no executor reached" assertion; null `effective` handled. |

## Rejected

| Finding | Why |
|---|---|
| C6's suggestion to measure per-call storage latency before committing | The guard runs once per broadcast, after seconds of proving. Not worth a benchmark; no cache means no invalidation bug. |
| Shape B's per-profile record and router-only enforcement | Both auditors agreed device-local + service-side enforcement is right. |

## Net

Shape A's enforcement and scope, Shape B's write path. The guard moved from "the entry points I
found" to "the one line every broadcast crosses", which is the change that answers the reject.

## Round 2 — fresh-context Codex pass on revision 2

**Conditional-approve.** It independently confirmed the wall: no alternate broadcast in the extension,
`aztec-runtime` or `wallet-bridge`; account initialisation and fee-juice claims feed the same
pipeline; awaiting the guard before `assertLive()` preserves the fence invariant; the transaction
record is written *after* send (`execution-coordinator.ts:335`) and the executors' catches settle
journals and release slots, so a refusal at the wall strands nothing. Also confirmed: signing,
private-event reads and simulation all cross the dispatcher; the discovery handler is at
`background.ts:659`; onboarding already uses service-worker clients pre-profile; `windows-*` matches
existing detection; the three export paths are right.

| # | Finding | Decision | Effect |
|---|---|---|---|
| R2-1 | Composable lacks snapshot/event ordering, reconnect refresh, and its ≥ 10 cases | **Adopt** | Subscribe-before-read, sequence-stamped reads, reconnect refresh, `dispose()`; ten named cases in P5 |
| R2-2 | C3 adopted only partially — no stale or passkey-state export coverage | **Adopt** | Export block parametrised over missing / corrupt / stale; passkey scenario pinned to stale + declined |
| R2-3 | A refusing fake stops at the early guards and never exercises the wall; structural pin checked presence, not order | **Adopt** | Admit-then-refuse fake with settlement assertions; held-read liveness case; ordering pin |
| R2-4 | Notices package missing from build path filters | **Adopt** | `pr-quick.yml` filters in P9 |
| R2-5 | Proverless env var missing from the P7 command; "every workspace package.json" reaches `apps/tools` / `bridge-core` | **Adopt** | Command fixed; licence-field edit narrowed |

Nothing rejected. No HIGH remains open.
