# Phase 3 — docs and plan records (2026-09-23)

## What changed

- `CLAUDE.md` § Keyboard & focus order: one bullet — Escape closes the top popup, the keyboard twin of the outside tap; a menu inside closes first; focus returns to the opener; nothing is approved by Escape; a must-answer prompt passes `:closeOnEscape="false"` (the trap then holds) and must block the outside tap too.
- `.claude/skills/e2e-testing/SKILL.md`: appended to the focus-landing paragraph — Escape is a real close; prove a popup survived a menu's Escape by containment, not visibility; open with `pointerClick` when asserting where focus returns, because `clickByTestId`'s `el.click()` never focuses the opener.
- `implementations-plan/index.md`: the send-publish-ledger line's follow-ups reworded (focus ring dropped, escape taken); this plan's line updated to implementing.
- `send-publish-ledger/plan.md` Outcome: the two follow-up bullets rewritten (dropped / taken, with a link). `send-publish-ledger/lessons/phase-6.md`: one dated owner line appended.
- `recon.md`: the dropdown row was corrected in plan rev 2 (before implementation).

## Gate

| Command | Result |
|---|---|
| `git grep -n "send-review-focus-ring" -- implementations-plan CLAUDE.md` | 4 hits, all records of the drop: the index line, this plan's change map and gate text, the ledger plan's Outcome |
| `bun run lint` (root: Biome over every workspace + complexity-baseline check) | exit 0; `complexity-baseline check OK` |

## Lesson (recon)

The first reuse sweep grepped `src/popup/components/popups/*.vue` for `<Dropdown` and concluded no registry popup hosts a menu. Two do, through `FeeSettingsCard` → `FeeMethodSelector` → `<Dropdown>`: a one-level grep cannot see a component nested two levels down. Codex caught it in the plan audit. For "does X ever render inside Y", walk the import graph from Y (or grep for the component's consumers transitively), not Y's own templates.
