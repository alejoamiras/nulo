# Consolidation: feat/storage-migration-backup × dev (#220 harden-quality arc)

While this branch was in flight, dev landed **#220** (21/22 quality findings, ~18.6k+/4.3k−, 100 files) plus two docs PRs (#255, #273). 22 files overlap. This doc is the merge plan + decision record.

## Delta summary (what #220 did that touches us)

| dev change | Where it collides with this branch | Resolution rule |
|---|---|---|
| **Q-01 storage boundary codec**: `EntityStorage` gained an optional third `parse` param; per-service zod row schemas in `spec.ts` (e.g. `ContactSchema`); validation-fail KEEPS the row + reads `undefined` (JSON-syntax fail still drops) | Same constructor lines where we replaced root literals with `*_STORAGE_ROOT` constants (9 services); same `spec.ts` regions where we added the constants | **Combine both**: `new EntityStorage<T>(X_STORAGE_ROOT, area, (raw) => Schema.parse(raw))`; keep our constant + their codec. Spec files keep both the constant and the schema. |
| **Q-06 branded secrets**: `profileService.restore(profile, RestoreSecret, …)` discriminated union (`asBase64MasterSecret`/`asBase64CredentialId`) | Our Phase-4 migrate-insertion + rollback bookkeeping surrounds that exact call in `useFullBackupImport.ts`; our test asserts the old positional args | Keep our trust gates/migrate/rollback verbatim; adopt dev's `RestoreSecret` construction; update test assertions to the union shape. On-disk `master-key` unchanged — only the transient RPC payload is typed. |
| **Q-20 config → zod** (`config/store.ts` +38/−13) | Our `CONFIG_STORAGE_KEY` export lives there | Keep both: the constant + their schema plumbing. |
| Extracted service helpers (`restoreRows`, `nextRandomId`, `requireOwnedRow`) reshaped `service.ts` bodies | Same files as our import-line edits | Take dev's bodies; re-apply our constant in the constructor line only. |
| **Row codecs make invented fixture fields visible**: `Contact.abbr` is the real field | Our test fixtures used a made-up `abbreviation` | Align every backup fixture/e2e-injected row to the REAL current shapes so codec-validated reads stay green (a restored row failing its codec would be silently unreadable in the UI). |
| Long-lived-branch clobber: #220 carried a STALE `implementations-plan/storage-migration-backup/plan.md` (+ index entry) and squashed it over the approved deep plan | Our plan.md/index.md | Keep OURS (the approved plan + post-impl trail). Lesson recorded below. |
| `auto-imports.d.ts` (generated) | both sides | Regenerate via build. |

**Explicitly NOT colliding** (verified): `packages/wallet-core/src/storage/index.ts` (our `MemoryStorageArea` export), the whole `apps/extension/src/wallet/storage/migrations/` dir, `src/wallet/services/backup/**` (new on our side), `full.vue`'s slice-keying fix, the e2e specs, `agent.sh`, `_build-extension.yml`. The engine's `MinimalStorageArea` contract is byte-identical — the scratch-store design is unaffected. #220 deliberately **deferred the backup-import codec seam** (its "Q-01 seams" follow-on) and left Q-13 (backup cross-profile shape) owner-gated, so there is no design-level conflict — this branch IS the backup-import layer it deferred around.

## Strategy
**Merge `origin/dev` into the branch (not rebase).** 12 signed commits stay intact; one conflict pass; the PR squash-merge collapses history anyway (dev allows merge commits inside PR branches). Resolution order: mechanical service/spec conflicts → composable (semantic) → tests/fixtures → docs (keep ours) → regenerate generated files.

## Validation gate (all must pass post-merge)
`bun run typecheck` + `bun run lint` exit 0 · full unit suite · backup module suites + composable tests · smoke `test:e2e backup-migration migration import-paths security-backup` (fixture-armed) · `bun run e2e:agent backup-migration-roundtrip` green · codex xhigh review of the merge diff.

## Post-merge codex review (xhigh, adversarial) — verdict: no merge defects
Codex diffed the merge against both parents and confirmed every resolution rule held (constants + codecs combined, dev helper bodies retained, trust-gate order + rollback bookkeeping intact, docs ours, fixture `abbr`, agent arming + grep marker present). Two findings, BOTH pre-existing classes that survived the merge (its words: "not a lost conflict hunk" / "not introduced by #220") — tracked here as owner follow-ups, deliberately NOT folded into this branch:

- **[medium] The live Q-01 backup seam**: backup root slices are anchor-validated (fail-closed on id/shape basics) but not row-codec validated before restore — a crafted row missing e.g. `abbr` imports "successfully", then the read codec rejects it (present-but-invisible). #220's wrap-up explicitly parked "Q-01 seams … backup import" as an owner-gated follow-on; the natural fix is descriptor-carried row schemas in `BACKUP_SLICE_REGISTRY` validated at normalize time. Owner decision: fold into the Q-01 seams follow-up, don't scope-creep this branch.
- **[low] `remapIdInBackupData` networkId remap is not old-id-scoped** (`full-backup-helpers.ts`): a collision-minted network id rewrites EVERY slice's `networkId`, so a multi-network backup can misattach account-state registrations. Pre-dates this branch (the plan kept remap logic byte-identical by design). Candidate for the same follow-up.

## Lessons
- **Long-lived arc branches clobber sibling docs on squash**: #220 branched before the approved plan landed and its stale `plan.md` copy silently won. When resolving, always diff committed-docs conflicts against BOTH parents before accepting either side. (Flagged upstream: the dev copy of the approved plan was lost between 79333e6 and 32fd6e0.)
- **Row codecs turn "harmless extra fixture fields" into behavioral drift**: post-Q-01, a fixture row that doesn't match the real schema restores fine but reads as `undefined` in the UI. Fixture rows must mirror real shapes exactly — the round-trip e2e (which uses a REAL export) is now the only fixture-free proof, which is exactly why it exists.
