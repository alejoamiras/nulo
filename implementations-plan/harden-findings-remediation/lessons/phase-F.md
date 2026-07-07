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

## Gate (escalated): `bun run build` + `bun run lint` + `bun run test:e2e` (smoke) + **`bun run e2e:agent`** (network — the only layer that exercises offscreen proving + node connect under the new floor).
