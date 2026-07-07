# Phase F — CSP hardening (F-05) — DIRECT (escalated to a logged decision)

Branch: `fix/hf-f-csp` off `fix/harden-findings`.

## Why this "DIRECT" unit needed a decision
The plan tagged F mechanical (add `img-src` + a `default-src` floor to `manifest.config.ts`). It is NOT purely mechanical: the current CSP sets only `script-src`, so with **no `default-src`** every other fetch directive is unrestricted. Adding `default-src 'self'` flips `connect-src`, `worker-src`, `style-src`, `font-src` to `'self'` unless re-declared — and:
- **connect-src** must reach **arbitrary user-configured node RPC** (https/http/ws/wss; localhost sandbox + accelerator over http) — `network/client.ts` lets users add any `rpcUrl`.
- **worker-src** must allow **bb.js WASM proving** workers (inside `@aztec/bb.js`; the offscreen document is an extension page → same CSP).
- The unit's stated gate (`build` + smoke-e2e) **does not exercise** the offscreen proving/connect path → a `default-src 'self'` break would ship silently.

So the floor's blast radius lands squarely in paths the F gate can't see. Escalated to a logged decision + a stronger validation gate (add `e2e:agent`).

## Consult
`/codex xhigh` (via `codex exec`, high effort) **timed out at 10m with no output**. Decision made on CSP-3 spec grounds + gathered facts (below), validated **empirically** with the full network suite rather than on codex's word.

## Facts gathered (grounded)
- F-05 sink: `DappIdentityBlock.vue:40` binds `dapp.logoBlobUrl` (a **blob:** URL). Audit: no production `.logo` writer, no legit remote image. → `img-src 'self' data: blob:` allows the real sink and blocks a remote beacon.
- `transaction/service.ts:182 runWorker()` is a misnamed **poll loop**, not a Web Worker. bb.js worker creation lives in node_modules (no `new Worker` in app src) → can't assert self-vs-blob; allow both.
- Local `e2e:agent` uses the **accelerator** (proving offloaded via a localhost *fetch* = connect-src), so it may **not** exercise the bb.js *worker* path → `worker-src` can't be proven by e2e; include it defensively (allowing workers is safe).
- No `@font-face`/webfont in src; prod build extracts CSS-module styles to files; Vue scoped/`:style` set CSSOM. `style-src 'self' 'unsafe-inline'` is the safe Vue/Vite choice; `font-src 'self' data:` covers bundler-inlined fonts.

## Decision — shipped CSP (`extension_pages`)
```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:; connect-src 'self' https: http: ws: wss:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'
```
Per directive: `default-src 'self'` = the floor (restricts media/manifest/prefetch/frame/child to self). `script-src` unchanged (WASM). `img-src` = the F-05 fix. `connect-src` network-schemes-open (nodes are arbitrary — honest DiD limit: it blocks data:/blob: exfil connects, not remote hosts). `style-src`/`font-src`/`worker-src` = preserve app function. `object-src 'none'` (no plugins; tighter than the MV3 'self' default).

**In-scope only:** `base-uri`/`frame-ancestors` are adjacent hardening NOT in F-05's scope (img-src + default-src floor) — deliberately excluded (no scope creep).

## Invariant
- No dApp-supplied remote URL can load as an image (no beacon); the blob:/data:/self logo sink still works.
- No regression to node connectivity or bb.js proving (proven by `e2e:agent` green).

## Validation outcome — the `default-src` floor broke network-e2e → reverted to `img-src`-only
First `e2e:agent` run (floor CSP built into `dist/`, confirmed present in the built manifest) produced a **total cascade**: every network test failed at its ~30s timeout (`fee-methods` 5/5, `transfers`, `sim-methods` 3/3, `authwit-lifecycle`, `connect-deny`, `concurrent-sendtx`, `cancel-mid-prove`, `tx-sendTx-default`, …).

**Ruled out environmental** before acting (no process was touched to diagnose):
- Machine **idle**: load 0.33 on 12 cores (not starved → not a proving-timeout-under-load cascade).
- My run's aztec node **healthy**: `:43229` returned HTTP 200 in ~2ms.
- The only diff from the 70/70-passing baseline (`fix/harden-findings` = A+B) is the CSP → the floor is the cause.

The e2e harness does not pipe the browser console, so the exact violated directive wasn't captured. Rather than bisect a multi-directive floor across ~20-min runs for a **latent-Low** finding, **reverted to the surgical fix** that closes the actual beacon with zero connect/worker/style blast radius:
```
script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:
```
This is the passing baseline (which had no `img-src` at all → img unrestricted) plus the single `img-src` restriction; the app uses only self/data/blob images (audit: no remote image). **The `default-src` floor is deferred** as a separate DiD follow-up (needs per-directive isolation with browser-console capture — likely a `worker-src`/wasm-in-worker or a WASM-fetch nuance in the offscreen proving path; the finding F-05 itself is fully closed by `img-src`).

Teardown of the doomed run used the sanctioned run-isolation path: SIGINT to my own **cwd-verified** process group (`pgid 267561`, agent.sh trap → sandbox cleanup), then reaped only `nulo-2`-cwd chrome orphans. No cross-agent process touched.

## Gate (revised): `bun run build` + `bun run lint` + `bun run test:e2e` (smoke) + **`NULO_E2E_PROVERLESS=1 bun run e2e:agent`** (network, proverless — see below).

## Campaign-wide e2e-strategy decision (autonomous — codex CLI unavailable)
`bun run e2e:agent` with no flags runs **real WASM proving** — there is **no local accelerator-server binary** (`accelerator-server not found`; the accelerator is a CI-only SHA-pinned binary). Real WASM proving is 5-10× slower → a single proof-heavy test file ran >10 min with no output (looked hung; was slow). This blocks per-unit local e2e for every e2e-gated unit (C, D, E, G, L, F).

**Resolution:** run local e2e in **proverless mode** (`NULO_E2E_PROVERLESS=1` → agent.sh builds a BB-SNARK-skipping wallet via the double-opt-in `VITE_NULO_E2E_PROVERLESS[_CONFIRM]`). Proverless still exercises the **full connect / dApp-interaction / tx-submission path** — which is exactly where the CSP floor broke — and only fakes the SNARK. **Real proving stays gated in CI**: the promote PR (`fix/harden-findings → dev`) runs the GitHub `network-e2e` with the accelerator. So: proverless locally (fast, catches connect/logic regressions per-unit) + real-proving in CI (catches proof-path regressions once, at promote). This is repo-supported (the mode exists for this) and does not weaken the final gate.

## Process-management lesson (2nd mistake this campaign — DURABLE, route to `e2e-testing` skill)
Tearing down a slow e2e run, `pgrep -f 'e2e:agent|agent\.sh|vitest.e2e.network'` **matched my own Bash command's `zsh -c` line** (the pattern string is literally in my command), so "first cwd-matching pgid" grabbed a **shell** pgid (a `zsh -c source …`), and `kill -INT -<that pgid>` interrupted my own command (exit 144) + killed the harness-tracked background tasks. Rules going forward:
- **Never `pgrep -f` a pattern that appears in the very command running it.** Match by `comm` (`pgrep -x aztec-anvil|chrome|MainThread`) or `readlink /proc/<pid>/cwd`, and **exclude `$$`/`$PPID`**.
- **Prefer not killing at all:** proverless e2e is fast (~5-10 min) → **launch, let it complete, read the result.** Killing was only ever needed for the slow real-proving runs; proverless removes the need.
- When a teardown IS unavoidable: resolve the pgid from a **known pid** (the tracked launcher), verify `cwd` is *this* worktree, and reap orphans **by exact pid**, not group, not `-f` pattern.
- (Reaffirmed) only ever touch `*/nulo/nulo-2*`-cwd procs — never another agent's worktree.
