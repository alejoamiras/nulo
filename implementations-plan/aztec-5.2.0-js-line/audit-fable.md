# Fable audit — round 1 (plan review, top-tier Claude architectural auditor)

Verdict: **conditional approve** (conditions C1–C5). The auditor reviewed the pre-codex-revision
plan; overlapping findings (three-mode boundary, canary ordering, executable gates) were already
adopted via audit-codex.md. Non-overlapping findings + triage:

## Conditions — all five RESOLVED in the current plan revision

**C1 (Critical) — SponsoredFPC funding ungated (existence ≠ sponsorship).** The auditor asked
for a required READ-ONLY balance probe instead of the broadcast-canary framing. **DONE, at
plan time**: `node_getPublicStorageAt(FeeJuice=0x…03, deriveStorageSlotInMap(slot 1, fpc))` on
the live testnet (2026-08-25):
- 5.0.1-derived `0x1441…970c` → 1,400,705,464,271,375,324,386 fee juice
- **5.2.0-derived `0x2ece…315b` → 969,831,347,352,353,250,515 fee juice — funded, in active use**
Recorded as a Fact; Ask 2 (live drip canary) downgraded back to optional/default-skip; the same
probe is re-run in Phase 0 to refresh the number at implementation time.

**C2 (High) — model the private-fee-juice exact-peer mismatch; correct the single-boundary
claim.** ADOPTED (partially via codex C1 already): the Architecture table names three binding
modes; Phase 1.4 now PRE-DECIDES acceptable `bun install` outcomes for the unsatisfiable exact
peer (link-to-5.2.0 + warning = accept & record; auto-nest-5.0.1 = accept & record — changes
the hazard mode to nested-dual, note it; hard error = stop); the reachability check explicitly
covers peer edges. Verified detail adopted: TODAY the peers symlink to the workspace's 5.0.1
store entries; standards' `Token.js` phantom-imports `@aztec/aztec.js/abi` at module load.

**C3 (Medium) — D2 cast budget false-trips.** ADOPTED: verified `chain-runtime.ts:229` passes a
root `WASMSimulator` into the SDK constructor and `:248` passes the prover into `createPXE` —
two typing sites, one seam. D2 rewritten: casts confined to the `chain-runtime.ts` SDK seam;
any SDK-typing error OUTSIDE that file ⇒ stop.

**C4 (Medium) — pin counts wrong in 3 manifests; patch internals misdescribed.** ADOPTED:
verified counts corrected to playground **8**, aztec-runtime **13**, bridge-core **9** (the +1s
were the held `@aztec-foundation` lines — exactly the pin that must NOT move; checklist method
added: count `"@aztec/` keys minus viem; `@aztec-foundation/*` is a different scope). Patch
bodies contain NO version strings or `%2F` sequences (only a bun-generated `.bun-tag-<hash>`
file) — regeneration via `bun patch <pkg>@5.2.0` was already mandated by the codex revision;
recon §3's "%2F paths inside" wording corrected; bun's unused-patch-key behavior added as a
Phase 1 lessons item.

**C5 (Medium) — seed phase count; missing post-loop re-gate.** ADOPTED: the seed already
enumerates all EIGHT headers (A, 0–6) after the codex revision (the audited draft said "six");
the premature "✅" was already removed. NEW: Post-implementation step 4 now requires a final
`bun run audit:vue && bun run test:all` AFTER the fix loops converge, BEFORE `gh pr create`.

## Other findings adopted

- **Provenance audits the wrong resolver's tree** (npm graph ≠ bun.lock): Phase 1.6 re-aimed —
  primary check is per-name `npm view <name>@<ver> dist.signatures` over the ACTUAL bun.lock
  additions (lockfile-exception-diff output); the scratch `npm audit signatures` stays as a
  secondary sweep with the divergence noted.
- **Toolchain channel absent from threat model**: `curl install.aztec.network | bash` +
  `aztec-up` are unpinned vendor channels feeding the sandbox the canary runs against — named
  in Security as an accepted residual; installed-tree recording added to Phase 0 lessons.
- **Sidecar cross-check is same-origin theater**: reworded — the sidecar is a transport check;
  the REAL control is the repo-pinned SHA verified on every CI run; first download is TOFU —
  release URL/date recorded in lessons.
- **`~/.aztec/current` mutation guard**: `readlink ~/.aztec/current` snapshotted before/after
  `aztec-up install 5.2.0` (multi-agent machine); Phase 4's machine-solo occupancy called out
  as an operational note for the owner.
- **Re-diff placement**: the ~16-file copied-logic re-diff moved AFTER the fail-fast canary
  (now Phase 4 step 1) — aligns fable's critique with codex H2; a HOLD verdict no longer wastes
  the manual re-diff.
- **Log-literal stability**: `Received /prove request` line shape + the
  `tx-sendTx-default.test.ts:24` "1.0.1 only covers createChonkProof" note added to Phase A's
  2.0.0 behavior-diff checklist.
- **ALLOWED_ORIGINS least-privilege**: Phase A prefers scoping to the extension origin if
  2.0.0 supports per-origin allow-listing; allow-all only as documented fallback.
- **Misc wording**: Phase 4 layer label corrected to "local-sandbox e2e, prover-ON" (which is
  what makes the no-broadcasts claim true); dist-size delta print added at Phase 3;
  "descriptors-real-artifact immune" triage note corrected in recon (a red may implicate the
  5.2.0 loader path, not the held artifact); `vite.shared.ts:30`; post-merge line added (watch
  the first nightly/soak for the dossier-predicted flake-profile shifts).
- **Branch-A nuance**: "node accepts stable-5.2.0 clients" moved to Inferences (the node runs a
  rotating nightly; rollupVersion equality is the actual invariant).

## Disputed item (resolved with reasons)

- **Single-PR vs two-PR delivery**: fable called single-PR "the correct call" (one logical
  one-revert unit); codex demanded the accelerator-binary bump ship first as its own PR. KEPT
  the two-PR split (D7): the binary bump is provable on the known-good 5.0.1 line, is
  independently revertable, and its 2.0.0 behavior changes (HTTPS/site-auth) are exactly the
  class of variable worth isolating per the 1.0.6 ALLOWED_ORIGINS precedent. The bump PR (PR-1)
  remains the one-logical-unit fable argued for. Recorded as the ledger's one genuinely
  disputed decision (D7/D10).

## Not adopted

- Treating the recon's unverifiable-from-repo externals (publish dates, circuit byte-identity,
  wallet-sdk identity, testnet probes) as needing re-verification: they are recon-sourced live
  probes with commands/sources recorded; the plan's Assumptions already attribute them, and the
  canary/detector gates re-prove the load-bearing ones empirically at implementation time.
