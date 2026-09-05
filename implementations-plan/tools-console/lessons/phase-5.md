# Phase 5 — preview walk + docs

2026-09-05.

## Gate

`bun run audit:vue` exit 0 (typecheck ∥ 432 unit files / 5390 tests ∥ lint, then the extension build) · `bun run --cwd apps/tools build:testnet` exit 0 · branch pushed; the Cloudflare Pages preview built on every push.

**Preview:** `https://worktree-tools-console.nulo-faucet.pages.dev` (the `nulo-tools-testnet` project's branch alias; `/build.json` names the commit it serves).

## Docs

`apps/tools/README.md` — the intro names the three sections and the dock, "The Send section" replaces "The Send tab", the journal paragraph states the one-surface rule and the shared policy, the tests paragraph covers the shell smoke and the shared fixture, the file map lists the shell components and composables. `implementations-plan/index.md` — status updated.

## The agent's own walk (before the owner's)

Screenshots at 1280, 1000 and 700px with a seeded journal (a claimable deposit, a done one), on the round-1 build. Rail, header chips, wizard card with the vertical step rail, Activity's first-visit tiles, the dock auto-opening on the needs-you record with one CLAIM and `Bridged ✓` on the done row, the rail count, the 1000px overlay beside its strip, the 700px top-row rail with the header wrapped and the step rail stacked — all as the mock. Two defects found and fixed on the spot (`a688e1f9`): the shell's scoped `.rail` rule leaking onto `RailNav`'s root, and the dock row's meta line truncating at 300px.

## Owner's walk

What to check on the preview (from plan.md): one send to the first claim, one faucet drip, dock hide / show / auto-open, the 1100 and 760 boundaries, keyboard-only rail + dock, both themes.

Two things to look at on purpose:
- The Activity page's first-visit statement sits inside the journal's dashed empty box, centred. The mock had it left-aligned with no box. One rule change either way.
- Needs-you rows in the dock drop the age (the mock's rule; the button takes that room). Running and done rows carry it.

**Sign-off:** _pending — recorded here by the owner._
