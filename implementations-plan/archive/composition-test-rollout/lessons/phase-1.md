# Phase 1 — shared PXE seam (port + fake under src/) + Token/Fpc wiring + CI guard

## What landed
- `pxe/shallow-port.ts`: `ShallowPxeClient { getPXE(network): IPXE }` (the seam Token/Fpc inject) + `ShallowPxe = Pick<IPXE, "getContractInstance"|"getContractArtifact"|"getContracts"|"registerContract">` (the fake's surface, DERIVED from IPXE) + `DEFAULT_SHALLOW_PXE_CLIENT_FACTORY` (the real client).
- `pxe/shallow-port.fake.ts` (under `src/`, marker `SHALLOW_PXE_FAKE_BUNDLE_MARKER`): a dumb `makeShallowPxeFake({instances, artifacts, registered})` — canned registry returns + a registered-address set; records `registerCalls`. ONE cast (`pxe as unknown as IPXE`) at `getPXE`, nowhere else.
- Token + Fpc: ctor gains `pxeClientFactory = DEFAULT_SHALLOW_PXE_CLIENT_FACTORY` + `browserApi?` (storage moved field-init → ctor body, mirroring `OperationJournalService`); field type narrowed to `ShallowPxeClient`; `init()` uses the factory. Production passes nothing → behavior-identical.
- `pxe/shallow-port.test.ts`: conformance both ways (default factory builds the real client; the fake satisfies the port).
- CI guard: EXTENDED the existing proverless-marker guard in `_build-extension.yml` ("Assert test-only markers absent") to also grep `dist/chrome|firefox` for `SHALLOW_PXE_FAKE_BUNDLE_MARKER` + `FAKE_IPXE_BUNDLE_MARKER` (folds in the spike marker, per audit H1). Runs on every PR build, not just the network lane — better coverage than a new step.

## KEY FINDING — codex's narrow-return port doesn't survive Token's deep path
Ledger #1 had `getPXE(): ShallowPxe` (4-method return) so the compiler would forbid `simulateTx` through the port. But `TokenService.fetchTokenMetadata` (the DEEP metadata path) calls `simulate(node, pxe, …)` on the SAME `this.pxeService` field (`pxe = getPXE(...)`). A 4-method return is not assignable to `simulate`'s `IPXE` param → 3 production typecheck errors (`token/service.ts:506,511,515`).

Resolution: `getPXE` returns the full `IPXE` (the port stays narrow only at the CLIENT level — `getPXE` is the one client method Token/Fpc use). The fake's surface stays capped at `ShallowPxe = Pick<IPXE,4>` (drift-checked) and widens with ONE cast at `getPXE`. The "no simulate in composition" rule is now enforced by the FAKE's surface (it physically lacks `simulateTx` → a test reaching a deep path throws loudly) + the doc (D2), NOT by the port's return type. This is Opus's original design; codex's narrow-return refinement was elegant but incompatible with Token's shared field. (Lesson: the audits reasoned about the shallow paths in isolation; only compiling it surfaced that Token's deep path shares the field. Compile early.)

## Gate — MET
`bun run --cwd packages/extension typecheck` (0) · `vitest run src/wallet/services/pxe/shallow-port.test.ts` (2/2) · `biome check` (5 touched files clean) · `build:chrome` (✓ built) + `grep -RnE 'SHALLOW_PXE_FAKE_BUNDLE_MARKER|FAKE_IPXE_BUNDLE_MARKER' dist/chrome` → **0** · actionlint clean.

LESSONS_FILE=implementations-plan/composition-test-rollout/lessons/phase-1.md
