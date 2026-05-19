# Opus 4.7 audit — parallel-e2e-isolation plan v1

## Verdict
> Needs-changes. Diagnosis correct; one fundamental misdesign + several under-counted collision surfaces.

## Top 3 concerns
1. **Build-time `VITE_LOCAL_NETWORK_RPC_URL` is the wrong abstraction.** The wallet has a user-facing flow for editing Local Network's rpcUrl (`endpoints.test.ts:158-164`). The chainId-zero check at `network/service.ts:680` already breaks any user who edits that URL away from `localhost:8080` — their `_getChainId` falls through to the XOR formula. Baking via `import.meta.env` papers over this for e2e while leaving real users worse off; also throws away vite cache (Aztec wasm + bb.js + extract-bb-wasm = several minutes per agent).
   **Fix:** match on `network.kind === "local"` (line 77 already has it) — structural, not URL-based. Then runtime override of the seed is trivial: pre-seed `chrome.storage.local` from a Puppeteer `evaluate()` against the SW target before `registerProfile()`. No build-time stamping, one shared `dist/chrome/`.

2. **Agent-id → fixed-offset port allocation is fragile.** `nulo` parent doesn't exist (only `nulo-1`, `nulo-2`, `nulo-3`) — heuristic never resolves to id 0. Anvil :8545 is a default every L1 dev tool uses; aztec :8080 collides with most local Java apps; libp2p :40400 same story. Offset 100 is too tight: aztec spawns multiple internal HTTP servers (admin, p2p, sequencer, prover-broker, blob-client, otel) and could grow.
   **Fix:** drop deterministic-port scheme. Always auto-allocate via `getPort()` / `net.createServer().listen(0)`. Determinism in failure logs is illusory — `:54321` is as readable as `:8180`.

3. **Anvil ownership undersells L1-state-pollution and FPC-mint reproducibility risk.** `aztec-private-fpc-bridge.ts:33` derives `DOM_SEP__FPC_BRIDGE_SECRET` from a hash that depends on `feeAssetHandlerAddress` from `node.getNodeInfo().l1ContractAddresses`. Those addresses are CREATE-determined from anvil nonce + deployer. Two agents on a shared anvil get different addresses on the second deployment. `start_anvil.ts:53` reads `process.env.ANVIL_PORT` as a fallback; passing only `ANVIL_URL` leaves overlap surface.
   **Fix:** keep "always own anvil per agent" as a hard requirement. Add positive assertion in setup that `nodeInfo.l1ContractAddresses` matches what we just deployed. Pass `ANVIL_PORT` env explicitly.

## Other concerns
- **`vi.stubEnv` test is a no-op.** `import.meta.env.VITE_*` is replaced at vite build time; `vi.stubEnv` only affects `process.env`. Need a real `vite build` to verify the wiring.
- **Playground HMR/onUpdated race not in plan.** `vite.config.ts:22` already handles via `VITE_DISABLE_HMR=1`; verify it survives the rewrite.
- **`~/.aztec/data` may be written even in "in-memory" mode for some subsystems.** Two agents writing to the same default data path = LMDB corruption. Always pass `--data-directory /tmp/nulo-aztec-${id}-${ts}` even in v1.
- **`SponsoredFPC` salt=0** gives the same address per agent. Fine per-agent; problematic only if any test code globally caches the FPC address.
- **No mention of the offscreen PXE IndexedDB collision** in the wallet SW (it's inside Puppeteer's user-data-dir → already isolated, but worth a mention).
- **Q4 (smoke unification)** — actually matters under build-time injection (smoke also seeds Local Network preset → wrong host display). Another reason to drop build-time.

## Things that look fine
- Anvil ownership decision (correct for reproducibility).
- Process-group `kill(-pid)` teardown.
- Puppeteer per-launch user-data-dir + path-scoped `pkill`.
- Phase ordering — even if the phase 1 mechanism should change.

## Recommendations on Q1–Q4
- **Q1: Auto-allocate.** "Predictable" is illusory once anything else is listening locally. Worktree-id heuristic is broken anyway.
- **Q2: In-memory + per-agent `--data-directory`.** Both. Pass `--data-directory /tmp/nulo-aztec-<id>-<ts>` to defeat default-path collisions; don't reuse across runs.
- **Q3: One command (`bun run e2e:agent`).** Env-var dance is the kind of footgun an agent will fail on the first time.
- **Q4: Keep separate** — but only if you switch to runtime URL injection (per fix #1), in which case there's no per-config build divergence anyway.
