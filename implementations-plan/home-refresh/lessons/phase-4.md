# Phase 4 lessons — header split (avatar/name switch, address copies)

## Shape

- `Header.vue`: chip → avatar button (`account-avatar-btn`, reuses `AccountAvatar` as-is, 32px,
  bordered) + name button (**keeps `data-testid="account-selector"`** — the e2e-preservation
  contract) + address button (`account-address-copy`, hover/focus underline + absolutely-positioned
  copy-icon reveal so nothing shifts). Three native `<button>`s, no tabindex games.
- Copy handler extracted to `src/components/header-copy-address.ts`: awaits `clipboard.writeText`
  (success toast only after resolve), `stripWireControl` (strip, never truncate), rejection →
  "Couldn't copy address" warning, no-address → silent no-op. 4-case colocated unit test — the
  bidi-strip fixture needed explicit `‮`/`​` escapes (literal invisible chars got mangled
  in file round-trips; don't put raw format characters in source).
- Narrow `Header.test.ts` (2 cases, per the codex round-2 condition — deliberately not a full
  suite): full-address-to-clipboard (display truncated, copy verbatim; copy never opens the
  switcher) + both switcher affordances open the accounts popup. Harness notes: auto-imported
  composables are NOT transformed in vitest — `vi.stubGlobal("useToast", …)` is the hook; mock
  `@/utils/core` to a bare `managers` stub or the import chain drags service infra in.

## Gate result (2026-08-13)

- `bun run typecheck:all` → exit 0
- `bun run test` → 4046 passed (+ header-copy-address ×4, Header ×2)
- lint → 0 errors
