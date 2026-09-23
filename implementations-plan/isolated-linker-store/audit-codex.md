# Codex audit — isolated-linker-store (round 1)

Session `01a034d9-f58f-79f3-b4e6-cc49afc31adb` · gpt-5.6-sol · xhigh · read-only · fresh context · run in parallel with the independent fable audit ([audit-fable.md](audit-fable.md)). Response verbatim; dispositions in plan.md § Audit log.

## Response (verbatim)

VERDICT: conditional approve — conditions: fix the resolver contract and B1 lockfile slice; probe global-store behavior before repository use; separate linker validation from lockfile re-resolution; harden shared-store/remapping trust; add graph, bundle, and artifact-level regeneration review.

### Findings

- **[High] Resolver design is incomplete.** `resolvePackageRoot()` falls back to resolving `pkg`'s main export (`plan.md:15,19`), but `@aztec/pxe` exports only subpaths and no `"."` (`node_modules/@aztec/pxe/package.json:14-20`); its consumer at `packages/aztec-runtime/src/pxe/opfs-store.test.ts:49` will fail. Accept an exported-subpath anchor—e.g. `entry: "./server"`—and test blocked `package.json` plus absent root export. Prefer directly resolving sqlite3mc's exported assets (`node_modules/@aztec/sqlite3mc-wasm/package.json:10-11`).

- **[High] B1 is not independently installable as sliced.** Phase 1 adds a workspace plus three manifest edges, but `bun.lock` is assigned only to the regeneration phase (`plan.md:18,25,63`). Bun's lock records workspace manifests; B1 would fail frozen CI. B1 must carry the minimal v1 lock update and a clean `bun install --frozen-lockfile` gate, without performing the full re-resolution.

- **[High] Phase ordering confounds two independent risks.** `plan.md:28-30` flips topology and immediately deletes/re-resolves the lockfile, so failures cannot be attributed to linker versus dependency movement. Validate isolated against the existing v1 lock first; regenerate v2 only afterward, preferably as B2's separately gated commit or a B3. Also move syntax/default/toggle discovery before the first real repository install—otherwise Phase 2 may already use the global store before Phase 3 discovers that fact.

- **[High] Shared-store evidence is insufficient for the claimed trust boundary.** Extraction-time integrity does not detect later same-UID mutation of shared extracted files; one compromised worktree can poison every build following its symlinks. A two-process smoke (`plan.md:33`) cannot establish atomicity. Use repeated empty-store stress, overlapping peer/optional variants, two different patches of the same package, interruption/crash injection, and whole-tree hashes. Treat results as empirical risk acceptance, not proof; release builds should use a trusted ephemeral store/cache or independently verify critical emitted inputs.

- **[High] The regeneration gate is version-centric, not wallet-grade.** Compare complete sensitive lock records—not merely `name@version`: integrity, source URL/type, dependency/peer/optional edges, patch bindings, aliases, bins/install scripts, workspace links, additions/removals, and peer variants. Review every changed bundle-reachable package with explicit old/new `bun pm diff`; record publish time/provenance, advisory delta, lifecycle/native/WASM changes, and Chrome/Firefox bundle reachability. Seven-day age is a delay, not provenance. Restore the pre-consult's omitted `bun pm ls --all`, peer-set, and bundle-metadata comparison—especially because `vite.config.ts:76-80` already documents Noir duplicate-copy hazards.

- **[Med] Vite/CRX validation is too indirect.** `preserveSymlinks: false` does not prove CRX asset discovery, module identity, or packaged-output safety. Require `build:full`, Chrome smoke, Firefox build, dev-server smoke, bundle-origin comparison, and checks that dist contains no symlinks, absolute machine/cache paths, or external resources. Compare the sqlite/WASM output hashes across hoisted and isolated builds.

- **[Med] Generated ignored remappings are an unreviewed compiler input.** Fact 8 is substantively true in current Foundry—the provider gives `remappings.txt` priority over TOML duplicates—but pin/record the Forge version and assert the effective `@aztec/` mapping with `forge config`/`forge remappings`. Atomically overwrite before every relevant EVM-root invocation and reject stale/unexpected targets. Prefer a wrapper or environment/CLI remap over leaving a silently consumed ignored file. `portal-artifact.ts` builds inside l1-artifacts and does not need the EVM remap.

- **[Med] The sqlite declaration judgment is narrowly sound.** It does not move package bytes/version—the same exact `5.0.1` lock entry already exists—but it is still a new frozen pin-surface and production-asset ownership decision, not "just" bookkeeping. Require unchanged lock integrity/closure and update `UPDATE.md`'s complete pin inventory. Codex can approve that decision under the delegated gate.

- **[Low] One stated gate cannot pass:** `check-fpc-version.ts` requires `--mode` (`:51-56`), while `plan.md:26` supplies none. Specify mode, cwd, network expectation, and whether failure is environmental.

### Outline B ruling

Outline B is now stronger than initially presented: broad public hoisting really would rescue sqlite3mc, Foundry, and the hardcoded Noir paths, while patched-package locality no longer favors consumers-first. It offers the smallest, fastest experiment.

It still loses. It leaves the already-dead renamed fuel path, `zod` phantom, six-copy drift, wrong-copy risk, and an intentionally broad phantom API; it also blocks the eventual `hoist=false` destination. The corrections reduce its disadvantages but do not make it the sound end-state. Keep it only as an explicitly temporary, time-bounded fallback.

### What looks fine

The consumer inventory, explicit `zod` fix, consumer-first architecture, shared low-level package home, patch-marker identity tests, B1/B2 conceptual split, abort path, and solo network-shard policy are all well chosen once the conditions above are incorporated.
