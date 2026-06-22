# Phase 1 — Pure label formatter + unit tests

## What shipped
- `packages/extension/src/wallet/utils/passkey-label.ts` — `formatPasskeyUserName(name, userHandle)`, WebAuthn-free pure function.
- `packages/extension/src/wallet/utils/passkey-label.test.ts` — 13 cases.

## Sanitization pipeline (final)
`NFKD → strip \p{M} → lowercase → [^a-z0-9]+ → "-" → trim edge "-" → slice(0,24) → re-trim trailing "-"`; empty slug → `nulo-profile-{id}` fallback.

The `\p{M}` strip (codex condition) is the load-bearing line: NFKD splits `É`→`E`+U+0301; without removing the combining mark the allow-list emits `e-lodie`. With it, `Élodie → elodie`. Pinned by the regression test.

The `[^a-z0-9]+ → "-"` run-collapse subsumes bidi/zero-width/control stripping for free (U+202E, U+200B never survive) — verified by an explicit spoofing test rather than left implicit.

## Gate result — GREEN
- `bunx vitest run src/wallet/utils/passkey-label.test.ts` → 13/13 passed.
- `bun run --cwd packages/extension lint` → exit 0 (the 42 warnings reported are pre-existing in unrelated test files; my two files are biome-clean, verified by scoping `biome check` to them).
- `bun run --cwd packages/extension typecheck` (vue-tsc --noEmit) → exit 0.

## Notes
- vitest `globals: true` in the package, but the established convention is explicit `import { describe, it, expect } from "vitest"` — matched it.
- The formatter is intentionally not yet imported anywhere; Phase 2 wires it. Unused export is typecheck-clean.
