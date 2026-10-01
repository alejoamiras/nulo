# Phase 2 — Re-point `dev` (union-first, read-modify-write)

## What
After the rename landed on `dev` (#170, squash `92df3500`), re-pointed `dev`'s `required_status_checks` to the new bare names via `repoint.sh` — a dry-run-by-default read-modify-write helper that **preserves `strict`** and computes the union, so it can't clobber protection or open the gate.

## Steps
1. **Observe (settled in Phase 1):** `quality-status` registered on #170's head with `app.id=15368`, `conclusion=success` → confirms `pull_request` uses the **head** workflow (bare names) and the rename works. The required string is the bare `quality-status` (no `Quality /` prefix). The other two follow by the identical mechanism and are confirmed matched-green on this PR before any phantom is dropped.
2. **`repoint.sh dev add-union --apply`** → `dev` `checks` = `{3 phantoms} ∪ {quality-status, network-e2e-status, smoke-e2e-status}` (new ones pinned `app_id 15368`), `strict:false` preserved. The phantoms stay required → **the gate never opens** (a fresh PR still shows BLOCKED until finalize); the new names now also required.
3. **Verify (this PR):** confirm the three new contexts report **matched-green** on a real `dev` PR while the phantoms still (harmlessly) block.
4. **`repoint.sh dev finalize --apply`** → drop the phantoms; `dev` `checks` = only the 3 new pinned names. Now satisfiable.

## Why union-first + read-modify-write (the two final-codex blockers)
- **Union-first** (opus + final codex): at no instant is the required set weaker than today's fully-blocked state. Today every PR is blocked; during the union window every PR is still blocked (by the phantoms); only after `finalize` does a green PR become mergeable. The gate is never open.
- **Read-modify-write preserving `strict`** (final codex): the update endpoint takes `{strict, checks}`. A blind PATCH that omits `strict` could flip it — harmless on `dev` (`strict:false`) but a real footgun on `main` (`strict:true`). `repoint.sh` GETs `strict` live and echoes it back, so `main`'s up-to-date requirement is preserved in Phase 4.
- **`app_id` pin** = defense-in-depth: only the GitHub Actions app (`15368`, observed live) can satisfy the gate — blocks a same-named spoof from another app. It does NOT disambiguate the old same-app `Status` ×4 (that's what the rename is for).

## Validation gate
- `dev` `required_status_checks.checks` (post-finalize) == `{quality-status, network-e2e-status, smoke-e2e-status}`, `strict:false`.
- A fresh `dev` PR shows the three gates **matched** (not `Expected`), and (Phase 3) merges with a plain `gh pr merge --squash` — no `--admin`.

## This PR's role
This is the verify PR (step 3) AND the Phase-3 positive-acceptance vehicle: while phantoms are present it shows BLOCKED (confirming the gate is still closed); after `finalize` it flips to CLEAN and merges with no `--admin`.
