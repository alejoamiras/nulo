# Phase 3 — Append-only regime record

## What shipped

- `address-freeze.ts`: append-only `REGIMES` record with the single `"nulo-v5"` entry
  { artifactSha256, classId, descriptorVersion + descriptorDigest, kdf `nulo-account-kdf-v1`,
  ack }. NO runtime regime pointer — `V5_REGIME` is a compile-time binding of this extension
  major to its one regime; re-binding a shipped major is the documented forbidden act; rotation =
  append entry + new extension major.
- The ack string interpolates the entry's own digests (id, artifactSha256, classId, descriptor
  version + digest), so intent language and pinned values cannot drift apart.
- `address-freeze.test.ts` (paired anti-tamper test): `EXPECTED_REGIMES` independently hardcodes
  EVERY entry as literals (deep-equal, so an edit, deletion, or unhardcoded append is red);
  id-uniqueness + id==key; ack-embeds-its-digests per entry; consistency of the v5 entry with the
  live freeze modules; `V5_REGIME` identity check. Runs in BOTH suites (no bb hashing → jsdom-safe,
  so the extension run carries it too).
- CODEOWNERS: intent-marker line for `/packages/aztec-runtime/src/account/` — documented in the
  file itself as adding no enforcement on a solo-owner repo.

## Red demonstrations (required by the gate)

1. **Vendored artifact mutation**: appended one space to `artifacts/SchnorrAccount.json` →
   `artifact-freeze.test.ts` digest pin RED (`1 failed | 1 passed`) → reverted via git checkout;
   digest re-verified `36562cde…a63`.
2. **Regime-entry edit**: replaced the v5 `classId` with a deadbeef literal →
   `address-freeze.test.ts` RED on 3 tests at once (hardcoded deep-equal, ack-binding, and
   live-module consistency) → reverted; suite back to 5/5 green. Note the tamper had to be
   caught by THREE independent assertions — exactly the coherence cost the design wants.

## Lessons

- The paired test's literals must NOT import the source constants (that would make tampering
  invisible). `EXPECTED_REGIMES` is literal-only; the separate consistency test bridges to the
  live modules. Tampering any single layer reds at least one of the two.
- An untracked file can't be `git checkout`-reverted — do tamper demos with sed + manual restore,
  or after the file's first commit.

## Validation gate

`bun run lint && bun run typecheck:all && bun run test:all` — 0 / 0 / 0 (transcript) + the two
red demonstrations above.
