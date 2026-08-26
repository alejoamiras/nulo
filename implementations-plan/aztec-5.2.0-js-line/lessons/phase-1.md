# Phase 1 — Pins, patches, lockfile, provenance

Baseline for all diffs: `1727a42f` (post-PR-0 dev; handoff re-pin).

## Pins

Scripted regex bump (`"@aztec/(?!viem")…": "5.0.1"` → `5.2.0`) across the 8 manifests:
20/16/8/13/9/4/3/2 = **75 pins, every per-file count matching the plan exactly** (the
fable-corrected 8/13/9 numbers were right). Held pins verified untouched: remaining `"5.0.1"`
strings per manifest are exactly the `@alejoamiras/*` + `@aztec-foundation/*` rows;
`@aztec/viem` stays 2.38.2. `layout-identity.test.ts` `expectVersion` ×2 → 5.2.0.

## Install + patches (install → patch → reinstall, per the corrected D4/High-4 order)

- First `bun install`: clean, 2.08s, 145 resolved/downloaded, **zero peer warnings** (the
  pre-decided outcome list expected a warning for private-fee-juice's exact-5.0.1 peers; bun
  1.4 emitted none — recorded as-is).
- 5.2.0 `noir-acvm_js`/`noir-noirc_abi` still ship `main`+`module` with NO exports map —
  upstream did NOT fix the browser/node dual-resolution → patches REQUIRED (D4 drop-branch not
  taken). Generated via `bun patch <pkg>@5.2.0` → exports-map edit → `bun patch --commit`;
  bun itself added the `@5.2.0` patchedDependencies keys. All FOUR store copies (both
  generations × both packages) verified carrying `exports["."].node`.
- Unused-key note: the `@5.0.1` keys stay LIVE (accelerator nests both packages at 5.0.1), so
  the unused-patch-key question did not arise this bump.

## Lockfile

`lockfile-exception-diff.ts <base> <new>` (parses lockfileVersion 2 fine): **aztecScope 95,
exceptions 0, added 0, removed 0** — targeted re-resolution produced zero collateral churn
(D1 vindicated vs the old rm-lockfile ritual).

**Binding-mode ground truth** (settled by the new gate tool
`scripts/aztec-hold-residue-check.ts`, invoked by name in every later gate):
- Consumers' direct `@aztec/*` → 5.2.0 ✓ (extension, aztec-runtime, bridge-core probed).
- **private-fee-juice's exact-5.0.1 PEERS re-bind to the workspace 5.2.0** (outcome (a);
  runtime-verified via realpath from all three consumers). The lock ALSO records nested
  5.0.1 entries under it (the declared constraint) — records, not wiring.
- Accelerator's nested `dependencies` → 5.0.1 ✓ (stdlib + bb-prover probed from both
  consumers).
- bun.lock v2 KEY-SHORTENING gotcha (cost the first script version 34 false fails): a nested
  resolution with a single dependent keys at the BARE position — the accelerator's
  `@aztec/bb-prover@5.0.1` lives at bare `"@aztec/bb-prover"`, its 5.0.1 grand-transitives
  chained under it, while the workspace's `world-state@5.2.0` holds the bare world-state key.
  Held-closure therefore computes over the DEPENDENCY GRAPH (BFS from the held roots through
  deps/peers/optionals with chained-key preference), never key prefixes. The failing-first run
  doubles as the prove-the-checker-can-red discipline.
- `bun install --frozen-lockfile` clean (min-age gate live, zero exclusions).

## Provenance (executed + transcribed — first bump to actually run it)

The documented `npm i --package-lock-only` + `npm audit signatures` ritual is INERT — audit
signatures verifies INSTALLED packages; a lock-only project yields "found no dependencies to
audit" (this is almost certainly why no prior bump ever transcribed a successful run). Fixed:
scratch package.json built from the exception-diff's canonical LEAF names (chained keys are
not npm names — final-pass High-7 confirmed in practice), 5.2.0 generation only (the 5.0.1
generation was verified at its own bump), REAL `npm install --ignore-scripts` (410 packages),
then `npm audit signatures`:
**"410 packages have verified registry signatures; 73 packages have verified attestations"** —
zero failures. (@aztec itself ships signatures, no SLSA attestations — unchanged posture.)
