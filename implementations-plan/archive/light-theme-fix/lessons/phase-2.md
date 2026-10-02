# Phase 2 — Land the Direction-A chromatic palette (GREEN) + design sign-off

## What landed (base.css `[theme="light"]`)
The 8 missing brand tokens + an explicit `--border`/`--border-hovered` (replacing the bug-on-bug dark alias) + `color-scheme: light`; plus additive `color-scheme: dark` on `:root` + `[theme="dark"]`.

| token | light value |
|---|---|
| `--nulo-surface` | `#ffffff` |
| `--nulo-surface-low` | `#f0efec` |
| `--nulo-surface-high` | `#e7e5e1` |
| `--nulo-surface-highest` | `#dcd9d3` |
| `--nulo-accent` | **`#a8480c`** (burnt amber) |
| `--nulo-outline` | `#c9c5bd` |
| `--nulo-border` | `#d8d4cc` |
| `--nulo-secondary` | `#6b655c` |
| `--border` | `rgba(124,116,104,0.3)` |
| `--border-hovered` | `rgba(124,116,104,0.55)` |

Test changes: flipped `LIGHT_ENFORCED=true` (light palette pairs now required), replaced the root-cause RED-proof pins with landed-value sanity checks, recomputed the `base.css.test.ts` SHA-256 (`bd2027d7…` → `b8b30e5b…`).

## Gate result (PASS, code-complete)
- `bun run --cwd packages/design test` → **270 pass** (contrast gate **18/18 GREEN both themes**; parity/drift/SHA green).
- `bun run --cwd packages/faucet test` → **413 pass** (`app.css.parity` green — no element-global rule touched).
- `bun run --cwd packages/extension build-storybook` → green (theme-matrix renders both themes via the real `theme` attr).
- **Dark frozen, verified by diff:** every token edit is inside `[theme="light"]`; the dark blocks (`:root` + `[theme="dark"]`) gained ONLY the additive `color-scheme: dark`.

## Lessons / decisions
- **The accent's binding constraint is white-text-ON-accent, not accent-as-text.** The candidate `#b8530f` (plan §6) passed the link role (accent on white ≈ 4.9) but the contrast gate caught it at **4.29:1** on the *fill* role (`--txt-inverse` white-90% on the accent) — below AA. Darkened to **`#a8480c`** → 5.06 (fill) / 5.84 (link). This is exactly the failure the gate exists to catch; I deliberately let the gate arbitrate rather than trust hand-math (my first by-hand check used a buggy hex parser and gave nonsense — the gate's parser is the source of truth).
- The `LIGHT_ENFORCED` flag flip + pin-replacement is the clean Phase-1→Phase-2 transition the H3 design intended.

## STOP — awaiting visual sign-off
Per the /goal, implementation halts here for the user's visual sign-off of the rendered Direction-A light theme (Storybook theme toolbar + manual smoke) before Phase 3 (faucet toggle).
