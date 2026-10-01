# Phase 6: Outcome blocks and seed retirement (Arc D)

**2026-10-01, green locally on the nulo v6 base (`80663b61`). Not pushed: D opens with J and C in wave 2.**

Branch `plans-scaffolding-archive`, stacked on C (`plans-scaffolding-repoints`). D has two stages. The tools stage is hand-written: the generators, their tests and fixes, the closure-table change for tools-extraction, the `lessons.md` trim and the Phase 7 step 4 enforcement. The generated stage is three commits the tools write on the tools tip: the Outcome blocks, the move, then the split and repairs. A restack replays only the tools stage and regenerates the rest (Mechanics § Concurrency), so the generated commits always derive from the tree they sit on.

## Step 2: untrack and classify

`untrack.ts --dry-run` finds nothing to record: #736 added no transcript. `classify.ts --check implementations-plan/plans-scaffolding/closures.json <tools tip>` reports 270 rows and 0 problems. `nulo-v6`, which #736 added, has no row and reads as active (F7).

## Step 3: `outcome.ts`

On the 267 closed dirs it writes 245 Outcome blocks, completes 8 blocks that lacked a field, writes 4 stub `plan.md` files for dirs that kept no plan of record, closes 50 nested plans with their parent's status, and adds 2 "Seeds retired" lines. A block goes after byte-0 front matter, else at byte 0 (A15). A complete block is never touched, and an incomplete one gains only its missing fields.

Three hosts keep their block under the title, as the exemplar does (A15's default): `send-publish-ledger` and `grant-check-address-case`, both byte-identical after generation, and `tools-extraction`, which gains its `Shipped` field (L44).

**Attempt 1: move tools-extraction's block above its title.** A tools-stage commit rewrote its `plan.md` so the block followed the front matter. `classify.ts --check` then flagged tools-extraction as drifted: a closed dir edited after the closure table's base. `outcome.ts --verify` failed too, since the generator only inserts. Dropped. tools-extraction joins the grandfathered hosts instead.

**Attempt 2: complete the block where it ends.** Missing fields went after the block's last text line, so tools-extraction's `Shipped` would have landed after its introduction's prose. The fields now join the list the block opens with, and fall back to the last text line when the block opens with prose. The fixture's partial plan gained a trailing paragraph, and the refusal test now aims at a block that opens with prose.

## Gate

- `outcome.ts --verify --parent <tools tip>`: 267 closed dirs, 0 problems.
- `outcome.ts` again, then `git status --short`: empty.
- `send-publish-ledger/plan.md` keeps blob `b73de1a4` through generation and the move, so A15's default holds.
- `check.ts`, `test:ci-gating` and `lint` ran on D's final tip; see Phase 7.
