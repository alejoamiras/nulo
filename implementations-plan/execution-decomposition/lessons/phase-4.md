# Phase 4 — Q4a transfer-estimate-reuse module

## Landed
- `transfer-estimate-reuse.ts`: entry type, byte-stable fingerprint helpers, `stash` (set→sweep order preserved), `tryConsume` (verbatim ladder: missing → TTL → inputs → profile → endpoint → base-fee → fetch-failure → pending), lazy injected deps preserving rejection laziness.
- Facade: wiring in init beside the coordinator; two delegating call sites; 220 lines off the facade (2,259 → 2,082 at commit).
- Pins moved with the subsystem: `transfer-estimate-reuse.test.ts` (16) — every observable exit, fingerprint formats, stash sweep. fingerprints.test.ts retargeted.

## Gates
- Unit 2,296 at commit · typecheck clean · codex parity (P4+P5 review): **confirmed, no findings** — ladder order/laziness verified, both facade call sites verified.
- e2e: covered by the cumulative P3+P4+P5 clean run (67/69, zero failures).

LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-4.md
