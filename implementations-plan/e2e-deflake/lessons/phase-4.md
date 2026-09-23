# Phase 4 lessons — CI foundry hardening (Fix 6) — GATE GREEN

## What flaked, what now guards it

`foundry-rs/foundry-toolchain@v1` (bare, unpinned, per-SHA cache key) ran in all 8
network-e2e job instances per PR and its output was never consumed —
`resolveFoundryBinary` hits the aztec pin's `internal-bin` (provisioned by the aztec CLI
installer's own version-pinned, retry-wrapped foundry install, cached per aztec version)
before `~/.foundry/bin`. One GitHub 502 on its `foundryup` bootstrap killed job
92728645596 in 42s. Worse than useless: an unpinned system forge silently taking over
(if `internal-bin` ever regressed) would break the L1 deploy with the version-forked
`forge script --batch` signature — a silent-wrong-version hazard.

Fix (audit-shaped, delete-after-preflight):
- New "Assert bundled Foundry toolchain" step: `test -x internal-bin/{forge,anvil}` on
  BOTH cache-hit and fresh-install paths — an installer regression now fails loudly at
  setup with a named cause.
- The foundry-toolchain step + the dead `FOUNDRY_DIR` export deleted.
- Aztec-CLI cache key bumped (`-v2`, non-optional per audit) so the first CI run does one
  cold install certifying the fresh path under the preflight.
- `.github/README.md` label-trigger claim corrected (`labeled` fires immediately, not
  "on the next sync").

## Gate evidence

- `bun run lint:actions` (actionlint) exit 0.
- Grep sweep: no other `~/.foundry`/`FOUNDRY_DIR` consumer in `.github/`;
  `apps/extension/scripts/e2e/docker-ci-like.sh` installs its own foundry inside its
  container (self-contained local repro harness, not a consumer of this action).
- Empirical certification happens in Phase 6: the labeled runs force canary + heavy
  jobs, which exercise the L1 deploy against the preflight-guarded toolchain, with the
  bumped cache key forcing the cold-install path once.
