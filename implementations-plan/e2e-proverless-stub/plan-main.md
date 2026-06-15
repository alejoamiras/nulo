# e2e-proverless-stub — main agent draft

Make network e2e fast by skipping real proof GENERATION (keep simulation + on-chain execution), with a controllable stub prover so sequencing/cancel tests stay deterministic. Tier: **deep** (novelty: controllable prover seam; security: a proverless/controllable prover is a prod-catastrophe if it leaks).

## The seam (verified)

- `chain-runtime.ts:166` → `createPXE(node, config, { proverOrOptions: prover, simulator })`. `proverOrOptions: PrivateKernelProver | BBPrivateKernelProverOptions` (`@aztec/pxe/.../pxe_creation_options.d.ts:14`). So an arbitrary `PrivateKernelProver` is injectable.
- `PrivateKernelProver` (`@aztec/stdlib/.../private_kernel_prover.d.ts`) splits into: `simulate*` (witness-gen → produces nullifiers/public inputs; MUST stay real for correctness) and `generate*Output` / `createChonkProof` (the expensive ZK proof; what we fake + gate).
- `proverEnabled: false` (already used by `fixtures/aztec.ts:77` to mint/deploy, and those mine) makes the PXE skip proof gen via a built-in no-proof prover — so unproven txs are accepted by the local node. This is the plain-proverless primitive.

## Design

Two extension build modes + one source path:

- **`VITE_NULO_E2E_PROVERLESS=1`** (read in `chain-runtime.ts`): instead of `AcceleratorProver`, inject a **`StubKernelProver`** and keep `proverEnabled: true` so the PXE still calls the prove step (giving us the barrier hook). The stub:
  - delegates `simulate*` + `generate*Output` witness-gen to the SAME WASMSimulator path the real prover uses (correctness preserved — real nullifiers/effects), OR reuses the built-in no-proof prover's witness path;
  - returns a structurally-valid **fake** `createChonkProof` result instantly **by default** (no barrier key → instant: covers the bulk);
  - if a barrier key is present in `chrome.storage.local`, **awaits release** before returning (covers the sequencing/cancel tests) — with a hard safety timeout (e.g. 120s) so a missing release fails loud, never hangs the suite.
  - One build serves BOTH the instant bulk AND the barrier tests (barrier is per-test opt-in).
- **Prover-ON build** (no flag): unchanged real proving, for the canary jobs.

Barrier protocol: key `nulo:e2e:proof-gate` (object: `{ mode: "hold" | "release", seq }`). Default absent = instant. Test sets `hold` before triggering the tx, polls the journal to confirm the wallet is mid-"prove", asserts what it needs (e.g. T2 queued), then sets `release`. Stub polls the key at a short interval while holding, releases on `release` or the safety timeout. (Offscreen has `chrome.storage`; the e2e test already uses `chrome.storage.local` via extension pages.)

Prod guard: the flag is compile-time `import.meta.env.VITE_NULO_E2E_PROVERLESS`; the StubKernelProver module is only imported inside the `if (proverless)` branch (tree-shaken out of prod builds). A build-stamp assertion (mirror `agent.sh:53`'s accelerator stamp) asserts the proverless stamp is **ABSENT** from any production build and PRESENT only in e2e builds.

## Phases

### Phase 0 — Feasibility spike (MANDATORY, no CI changes) (0.5-1d)
- (a) Build a proverless extension (`proverEnabled: false`, no stub yet); run ONE network test (`transfers` or `authwit-consume-smoke`) via `e2e:agent`; confirm it MINES on the local node + passes its behavioral assertions.
- (b) Prove the barrier: a throwaway `StubKernelProver` that `console.log`s + awaits a `chrome.storage` key; a throwaway test sets hold→release; confirm the offscreen stub observes both and the tx completes after release.
- **Gate**: both sub-spikes green (tx mines+asserts; barrier hold/release observed in the offscreen log). If either fails → STOP, surface (the whole plan rests on these).

### Phase 1 — `StubKernelProver` + build flag (1d)
- `packages/aztec-runtime/src/pxe/stub-kernel-prover.ts`: implements `PrivateKernelProver`; real witness-gen (delegate/reuse), fake proof, barrier-gated `createChonkProof` with safety timeout.
- `chain-runtime.ts`: when `VITE_NULO_E2E_PROVERLESS`, inject the stub (+ build stamp). Vite define for the flag.
- `agent.sh`: build-stamp assertion (present in e2e build, ABSENT in prod — add the inverse assert to the prod build path/CI).
- **Gate**: `bun run lint` + `bun run test` (unit for the stub: instant-by-default, holds-on-barrier, releases, times-out) + a prod-build grep proving the stamp/stub are absent. (lint · unit · build-grep)

### Phase 2 — Reclassify the bulk to proverless + drop authwit gate (0.5d)
- Build the shard-pool extension with `VITE_NULO_E2E_PROVERLESS=1`. Remove `RUN_AUTHWIT_E2E` gate from `authwit-*.test.ts` (they rejoin the pool). No per-test code change needed for plain-proverless tests (instant by default).
- **Gate**: `e2e:agent` over a representative proverless subset (authwit-lifecycle + a few cap/contract/data tests) green + FAST (target: lifecycle minutes, not 15+); no CDP timeouts. (e2e-network)

### Phase 3 — Barrier-controlled sequencing/cancel tests (1d)
- Add a barrier helper to `fixtures` (`holdProof()/releaseProof()`); rewrite `cancel-mid-prove` (hold → cancel → assert 4001 → the held prove is moot), `concurrent-sendtx-approve` (hold T1 → assert T1 active + T2 queued → release), `concurrent-sendtx-confirm` (hold T1 → assert T2 queued while T1 active [the new deterministic ordering assert] → release → both confirm).
- **Gate**: those three green ×2 on the proverless build, deterministic (no timing flake), each well under prior wall-time. (e2e-network)

### Phase 4 — CI two-build split (0.5-1d)
- `pr-network-e2e.yml` / `_network-e2e.yml`: proverless build → shard pool (incl. the barrier tests); prover-ON build → dedicated canary jobs (transfers + tx-sendTx-*). Thread the flag as a workflow input; status aggregation covers both.
- **Gate**: `bun run lint:actions`; a full PR CI run green (shard pool fast + clean; canary jobs green). (actionlint · e2e-network-CI)

### Phase 5 — Arc close (0.5d)
- `/code-review max --fix` → codex post-impl audit (+ adversarial on the prod-guard) → fix loop → docs (e2e README: the proverless model + barrier protocol) → PR to dev.

## Security & Adversarial
- **Prod-catastrophe if leaked**: a proverless/controllable prover in production = wallet broadcasts unproven (or attacker-timed) txs. Guard: compile-time flag, stub module tree-shaken from prod, build-stamp ABSENCE assertion on prod builds (CI-enforced), and the stub throws if ever constructed without the flag.
- **Barrier hang**: a missing `release` must fail loud (safety timeout), never hang CI.
- **Least privilege**: no new creds; flag is build-only.
- **Supply chain**: no new deps (reuse @aztec/* + the existing accelerator dep; stub is local code).

## Assumptions
### Facts
- `createPXE` accepts `proverOrOptions: PrivateKernelProver` (pxe_creation_options.d.ts:14).
- `PrivateKernelProver` splits simulate (witness) vs generate/chonk (proof) (private_kernel_prover.d.ts).
- `proverEnabled:false` txs mine on the e2e node (fixtures/aztec.ts:77 mints/deploys this way).
- Offscreen has chrome.storage; tests already use chrome.storage.local.
- CI already isolates heavy jobs (pr-network-e2e.yml fee-methods/concurrent-confirm).
### Inferences (attack targets)
- A stub that fakes `createChonkProof` but keeps real `simulate*` produces a node-acceptable tx with correct public effects (needs the Phase-0 spike to confirm the exact method to gate — `createChonkProof` vs the `generate*Output` set).
- `proverEnabled:false` internally does witness-gen (so on-chain effects are correct), not just a total no-op. (Spike confirms via a real transfer mining + balance change.)
- The barrier poll interval doesn't materially slow the bulk (instant path doesn't poll).
### Asks
- None open (scope settled via clarifying answers).

## Riskiest unknown
Exactly which `PrivateKernelProver` method(s) to fake/gate to get a CORRECT-but-proofless, barrier-controllable tx — and whether the built-in `proverEnabled:false` path already gives correct witness-gen (so plain-proverless needs no custom prover at all, and the stub is only for the 3 barrier tests). Phase 0 resolves this before any CI work.
