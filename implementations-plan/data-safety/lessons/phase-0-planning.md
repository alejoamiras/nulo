# Planning lessons — data-safety (batch 5)

## Codex plan audit round 1 (session `01a0380b-de36-73d2-88e6-e6f361093245`, xhigh, fresh): REJECT — six findings, all adopted

1. `rawStringEntries()` skips non-string-VALUED rows (entity_storage.ts:231-238) — an object-stored account would still false-delete its key. → live-set from `getKeys()`.
2. The sweep's fire-and-forget (`void` at init) races `importAccount`'s KEY-FIRST write order — a mid-import key can be swept. → awaited in `init`. (The recon missed this; the auditor read the import path's write order. Lesson: a sweep's trigger discipline matters as much as its predicate.)
3. `${account}::${hash}` is non-injective over attacker-shaped strings. → `JSON.stringify([account, hash])`.
4. Decoded (`getValues`) seeding lets codec-hidden rows' pairs escape the dedupe AND the sequential id can overwrite a hidden row's numeric key. → raw-payload seeding + raw-occupancy cursor. Also: NO `assertWithinCap` in restore — already-granted authorizations; rejecting unique rows would destroy the only revocation index.
5. `canonicalNumericStorageId` admits canonical-but-UNSAFE numerics (`"1e+21"` round-trips `String(1e21)`; 2^53 round-trips exactly) — both still pin `+1`. → allocator-LOCAL safe-integer bound; the shared helper untouched (purge-classification semantics preserved).
6. c5-3's defect analysis confirmed (two pure reads of an unmutated store can never differ); replacement pins ratified.

**Tier escalation**: codex asked for medium/another round; granted as ONE additional codex round on rev 2 (logged middle path — a full second-model leg for three S-fixes would be over-ceremony). Round-2 verdict pending.

Meta-lesson: "light" tier findings can still be deep — the round-1 audit found a destructive boot race and a float-precision class the plan's own recon rated as settled. The light floor (verified Facts) protects against unknowns, not against second-order interactions; budget the extra round whenever a destructive path or a shared primitive is in scope.
