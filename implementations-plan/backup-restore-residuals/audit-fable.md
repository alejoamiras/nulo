# Fable/Opus plan audit — backup-restore-residuals

The "fable" role (independent top-tier Claude reviewer) was filled by **Opus 4.8** for this security-concurrency audit.

## v1 (against plan v1) — VERDICT: `reject`
**Primary catch (critical, process-saving): wrong base.** The worktree was cut off `origin/HEAD` = `origin/fix/harden-findings` (harden line), NOT the `dev` tip with #276. Every mechanism fact in plan v1 ("shared ProfileDeletionState", the coordinator, the tombstone repository, "the already-shipped tx fence this plan mirrors") returned ZERO grep hits — the parent arc was absent from the tree. Confirmed independently: `git merge-base --is-ancestor fb61a63 HEAD` = NO; `origin/HEAD` → `fix/harden-findings`. → re-baselined `git reset --hard origin/dev`.

Substantive technical findings (valid against #276, folded into v2):
- `updateToken` IS resurrection-safe via lock + reread + throw-if-gone, serializing with `deleteToken`'s `this.lock`. The real token vector is the ADD path (`addToken`, not `createToken`), which holds the lock across the slow `fetchTokenMetadata` then writes — a purge-then-add resurrects.
- The balance path already has an orphan-detection guard (`onOrphanDetected` when the row is gone before `repo.set`), so the "row deleted mid-sync" case is handled — the residual window is narrower (row not-yet-purged / token-purge-in-flight / successor-id) than v1 stated.
- Reusing a monotonic-epoch fence rather than new crypto is the right instinct — once the mechanism is confirmed present (it is, on `fb61a63`).
- Naming/line corrections: `addToken` not `createToken`; relink is index-paired (v1's "contract-keyed" read was an artifact of the wrong base).

## v2 (against plan v2) — final fresh-context pass: _pending._
