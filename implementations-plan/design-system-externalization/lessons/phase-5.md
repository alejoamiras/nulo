# Phase 5 — Cleanup, docs, full e2e, round-2 backlog

Branch: `feat/design-system-p5-cleanup` (stacked on `feat/design-system-p4-l2`). MILESTONE / final.

## Done (machine)
- **Docs**: CLAUDE.md "Extension component model (L0–L6)" now documents the L0–L2 → `@nulo/design`
  split + the resolver + the base.css/tokens relocation. `round-2-backlog.md` written (the deferred
  set with concrete reasons: router/state holdouts, Spinner + dependents, host-coupled
  Tooltip/Popover/Input, faucet dedup, the pre-broken storybook/rolldown alias, orphaned faucet fonts,
  story-relocation, bug-pinned quirks). `@nulo/design/README.md` already current from Phase 1.
- **`bun run audit:vue` green** (typecheck:all → test → lint → build): extension 2368 + design 136
  tests (count shifted vs Phase 1's 2398 because the 9 component tests relocated WITH their components
  — coverage preserved, not lost). lint 0 / 1101 files. build 0.

## Pending (require the user / heavy / CI)
- **Human visual sign-off (Phase 2 + Phase 5)** — the supervised gates. Load
  `packages/extension/dist/{chrome,firefox}` + the faucet; verify light/dark + nav/no-nav + key
  screens render identically. NOT self-certifiable.
- **Network e2e (`bun run e2e:agent`, ~25 min)** — deferred to CI: the `pr-network-e2e` workflow now
  watches `packages/design/**` (patched in Phase 1) and runs on the PRs. The design changes are
  CSS/component-only (no network/transaction-logic impact), and the accelerator-server is a Linux
  x86_64 binary (CI), so local macOS runs aren't the right venue. CI is the gate.
- **`/code-review max --fix` + codex post-impl audit** — the post-implementation review passes; best
  run with the user able to review their output across the 5-PR stack.

## Cleanup deferred to round-2 (low-risk, noted in round-2-backlog.md)
- Faucet `public/fonts/` orphaned (base.css now uses package-bundled fonts) — kept this round to
  avoid any look-same risk; remove in round 2 after the user confirms faucet fonts render.
- Storybook rolldown-alias fix (pre-broken, independent of this work).
