# Phase 1 — two typed errors, through BOTH boundaries

**Status:** ✓ gate green — extension-messaging 217/217 · wallet-bridge 277/277 · extension envelope+execution 570 passed (7 todo) · `typecheck:all` exit 0 · `lint` exit 0.

## What shipped
- `PxeStaleAnchorError` (`PXE_STALE_ANCHOR`) and `ContractNotRegisteredError` (`CONTRACT_NOT_REGISTERED`) in `packages/extension-messaging/src/errors.ts`, wired into `KnownWalletErrorPayload` + the `walletErrorFromPayload` switch. Both are message-only reconstructible, so the `details` loss at the operation-result boundary is lossless for every consumer.
- `classifyOperationCatch` (`execution/rpc-cancel.ts`) carries `code` for the two new classes alongside `DuplicateInitializationError` — an explicit three-class allowlist, no blanket `WalletError` pass-through (the existing guard test for `TooManyPendingError` still pins that).
- Two envelope arms in `toWalletResponseError`: stale anchor → `-32603` with a constant message (node text stays in `details`, never reaches the dApp); unregistered → `-32602`, no `classId`, and the arm's comment states the pre-submission contract that makes a dApp-side retry safe.
- Nine throw sites (`contract-resolver.ts` ×4, `execution/service.ts` ×5) now throw `ContractNotRegisteredError` with byte-identical messages. Acceptance grep: no bare `new Error(` remains for the four strings; the only other "not found" in scope is `"Method not found"`, which is a different contract and out of scope.

## Tests added
- `errors.test.ts`: round-trip for both classes; the subclass-count tests renamed to 13 / 12.
- `dispatcher.test.ts` (wallet-bridge, no extension imports): `unwrapOperationResult` re-materializes both subclasses from `{ status: "failed", error, code }`.
- `rpc-cancel.test.ts`: both classes ride the code channel; the unsound-reconstruction guard is unchanged.
- `error-envelope.test.ts`: one test per arm plus the full chain (`classifyOperationCatch` → `unwrapOperationResult` → `toWalletResponseError`) asserting the node text is absent from the envelope.
- `contract-resolver.test.ts`: `instanceof` assertions on the two existing miss tests.

## Attempts / dead ends
- **Lint looked red on untouched files.** The first `bun run lint` printed 3 errors + 32 warnings and the visible error excerpts were all in files this phase never touched, so the initial read was "pre-existing on dev". Wrong: `biome check` truncates at its diagnostics limit, and the three actual *errors* were format-only diagnostics in `rpc-cancel.ts`, `rpc-cancel.test.ts` and `error-envelope.test.ts` (long import / long argument lists Biome wraps). The 32 warnings are pre-existing and non-blocking. Lesson: when lint reds, run `biome check <changed files>` first — the truncated full-repo output hides which diagnostics are errors.
- **The Firefox smoke run (`e01e416e`) landed on dev between recon and homing**, so the worktree base already included it; no rebase needed.

## Carry-forward
- Phase 2 throws `PxeStaleAnchorError` from the offscreen helper with `details.cause` = the node text and `phase: "sync" | "op"`; Phase 1's envelope arm already drops `details`, so nothing else has to redact.
- Phase 6's `retryOnUnregistered` leans on the `-32602` arm's pre-submission contract; keep that comment when Phase 2 touches `service.ts`.
