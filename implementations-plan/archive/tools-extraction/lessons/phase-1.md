# Stage 1 — nulo wallet-only (A1, F0, A5a, A5b)

## F0 — recorded baseline (2026-09-24)

Both suites dispatched on `dev` at `5ee1d77a5716e58e90a3093abcbedba8b642b6a9`, both **green**:

- `bridge-contracts.yml` — run 36034918254 (`https://github.com/alejoamiras/nulo/actions/runs/36034918254`), success.
- `pr-tools-e2e.yml` — run 36034921684 (`https://github.com/alejoamiras/nulo/actions/runs/36034921684`), success.

Re-dispatch if the extracted paths, a shared package, `bun.lock`, `patches/` or either suite's harness changes on `dev` before A5a merges.

Re-dispatched after #688/#689 edited the tools tests: `pr-tools-e2e.yml` run 36041208852 on `dev` `6e6439a1`, success. Both suites also ran green on #690's head `2f84a813`, whose tree equals `dev` `6611f861` after the squash (runs 36041442526, 36041442478) — the freeze SHA's baseline unless `dev` moves before A5a merges.

Owner steps (2026-09-24):

- **Paused** automatic production + preview deployments on both tools Pages projects. The first push after the pause (`chore/remove-tools`) shows "No deployment available" on both.
- **Production branch is `main` on both** (the plan expected `dev` for testnet). Serving, both from `main` at `chore(main): release 0.28.0 (#676)`:
  - testnet project: `7c7841b4` — its `pages.dev` subdomain is `nulo-faucet.pages.dev` (the project's original name), which C1/C2 must target alongside `testnet.tools.nulo.sh`;
  - mainnet project `nulo-tools-mainnet`: `d5438b0a`, domains `tools.nulo.sh` + `nulo-tools-mainnet.pages.dev`.
  - The last previews, built from `dev` at #690 minutes before the pause: `84337e15` (testnet), `66da3d4f` (mainnet).
- **Hook secrets: none exist.** Only the landing's `CLOUDFLARE_PAGES_DEPLOY_HOOK` is set at repo level; the `production`, `chrome-web-store` and `firefox-add-ons` environments hold no Cloudflare secret. The tools deploys ran from Cloudflare's own Git integration, never a GitHub hook.
- **Dashboard deploy hooks**: none on either project (owner, 2026-09-24) — every tools build came through the GitHub connection, which the pause stops. **F0 complete.**
- **Pause verified**: A5a's push (19:26 UTC, before the pause) drew failed `Cloudflare Pages: nulo-tools-{testnet,mainnet}` checks on #691 within ~1 min (the build has no `apps/tools`; stale, not required). A probe push of the A5b branch after the owner set production and preview to disconnected (19:36) drew only the landing's `nulo` check; neither tools project reported within 3.5 min.

## Recon (ultracode workflow `stage1-recon`)

Seven read-only mappers + a completeness critic re-derived every Stage 1 edit against `dev` 55 commits past the draft base. Findings that changed the plan:

- The wallet's bridged-USDC seeds (`default-tokens.ts`, `price-map.ts`) are the retired single-token bridge's L2 tokens; #539 removed them from both manifests. § 8's "the wallet mirrors `tokens[].l2Token`" was false — the plan now says so, and comments state the fact.
- Bun 1.4.2 `--frozen-lockfile` passes a lock that still lists a workspace missing on disk (pruned checkout), so N5a's gate now checks the lock was actually regenerated.
- `.githooks/pre-commit` runs `scripts/check-no-local-paths.sh` (paths only); `check-no-brand.sh` is gone, so unleashed's brand check is a new guard.
- The Firefox e2e filter twins are pinned by exact equality to their Chrome twins (`behavior-gating.test.ts`), so A1 edits all four in one commit.
- `renovate.json`'s foundry hold and the `apps/extension/src/utils/chain-ids.ts` comment were bridge residue no earlier list named.

## A1

- **Min-age re-gate on a manifest edit.** Dropping `@nulo/bridge-core` from `apps/extension/package.json` made a plain `bun install` re-gate `@alejoamiras/presto{,-core,-banners}` (younger than 7 days, already locked) and fail. Resolved the documented way: an uncommitted local `minimumReleaseAgeExcludes` for the three names, `bun install`, then the exclude removed (bunfig restored from a scratch copy) and `bun install --frozen-lockfile` re-run clean. The lock diff: the extension's bridge-core line, plus its stale `0.27.0` version label synced to `0.28.0`.
- **Trimmed, not verbatim.** The wallet uses only `predictedWorstMinFees` + `MinFeeNode`; the other nine exports are bridge-only and would be dead in aztec-runtime once A5a lands, and the verbatim copy carried workflow-reference comments. bridge-core keeps its full copy until A5a.
- **PrivateFPC pin location.** aztec-runtime can hash but cannot import the wallet's params, and the network e2e fixtures compute their own instance, so the pin is an extension unit test under `// @vitest-environment node` (bb.js poseidon2 throws `std::bad_cast` under jsdom), deriving through the same `protocol-fpcs.ts` helpers the service calls.
- **Mutation proof.** Salt `new Fr(1n)` → `new Fr(2n)` in `protocol-fpcs.ts`: the pin test went red with salt `0x…02` and address `0x2d6d5a03989f02266f21d8c600d8c7c79f35baa9c7f870c82a395eb0c5d2bcef`; reverted.
- **Gates.** `lint`, `typecheck:all`, `test:all` (every workspace), `lint:actions`, `test:ci-gating` (148 pass) green at `e84607dc`.

### A1 review round 1 (2026-09-24)

- **Codex** (`/codex high`, session `01a0d49f-7f22-75b2-a8ea-21184e2a6d79`): **approve**. Confirmed the pin exercises production's derivation (both service sites call `derivePrivateFpc`; production and vitest share `artifactAliases`; debug stripping keeps the class id), `service.ts` is behavior-identical, the fee helper is executable-code identical and the five filters cover the new closure. Two P3 comment nits, both adopted: the fee docstring misdescribed the algorithm and the README's fallback clause; the FPC invariant was repeated at paragraph length.
- **Claude workflow** (5 lenses × 2 refuters, 21 agents): 8 raw findings, 4 survived. Adopted: the README "only" fallback claim (also falls back on an empty prediction); the docstring cited `@aztec/wallets` for `getMinFees` (it lives in `@aztec/wallet-sdk`) and described upstream's single-slot pick, not our per-component max; the PrivateFPC params and artifact were exported only for a control test that exercised Aztec's hash, not the wallet — the control test is gone (the manual mutation covers it) and the module now exports only the two derive helpers and `ProtocolFpc`. Refuted by both skeptics: exported params as a fund-safety hole, `audit:vue` not running the fee test, an unreachable `if (!first)` guard (a type-narrowing guard, kept verbatim).
- Salt mutation re-run after the fix: still red with `0x2d6d…bcef`.

## A5a

- **Recon-driven fan-out.** Five edit agents over disjoint file groups (CI YAML, release scripts, ci-cd tests, root config, wallet code) applied the reference edits in ~2.5 min; a residue sweep found only the complexity manifest, regenerated by the driver.
- **Lockfile.** Plain `bun install` needed no exclude (removals re-resolve nothing). `bun.lock` −94 lines; `lockfile-exception-diff.ts` A1 → A5a: exactly the 11 predicted removals, nothing added or changed. The gate's `playwright` pattern also matched vitest's optional `@vitest/browser-playwright` peer — the plan's pattern now matches package keys only.
- **Complexity** 27 → 24 (22 cognitive + 2 length), plain regen.
- **`audit:vue` flake under load.** Four timeouts (5 s / 2 s budgets) in `content-message-relay`, `presto/client` and `e2e/config` tests while typecheck ∥ test ∥ lint ran beside reviewer agents; all 17 pass alone and passed in `test:all`. Not A5a.
- **Host gap.** `scripts/release/zip-reproducible.test.ts` (#687, landed on `dev` mid-arc) needs a `zip` binary this host lacks; CI runners have it. Not A5a.
- **Rebase onto a moving `dev`.** #688/#689 edited `apps/tools` tests → modify/delete conflicts resolved by deleting; #686/#687 edited `release.yml` → auto-merged, the status aggregator's needs and result loop re-checked by hand. F0's tools baseline re-dispatched for #688/#689.

### A5a review round 1 (2026-09-24)

- **Codex** (`/codex high`, session `01a0d4aa-0528-76c3-a4f3-a7b9ef8b2a72`): **conditional approve**. Adopted: (1) `verify-live` checked out the release tag, so a republished pre-A5a tag would run that tag's tools-probing verifier without the `SHA` it expects → it now checks out the workflow's own revision; (2) the landing match was a substring (`0.28.1` accepted `v0.28.10` and `v0.28.1-rc.2`) → the tag must end at the link's closing quote (the live landing renders `releases/tag/v0.28.0"`), two rejection tests; (3) the verify-live headers A5a rewrote were narration → one sentence each. Declined: `bunfig.toml:11`'s plan reference — pre-existing, not A5a's.
- **Claude workflow** (5 lenses × 2 refuters, 19 agents): 3 survived. Adopted: setup-aztec's `version` override had no caller left (the bridge and tools workflows were its only users) → input and branch deleted; A5a's dropped ignore rules would make leftover deployer wallet stores / forge caches on clones that ran the bridge scripts stageable by `git add -A` → the three removed roots stay ignored. Its skeptics refuted the old-tag `verify-live` issue codex rated P2; adopted anyway on codex's argument, since the fix is three lines.

### A5a review round 2 (2026-09-24)

- **Codex** (session `01a0d4aa-0528-76c3-a4f3-a7b9ef8b2a72`, resumed): **approve**, no findings at `1fc43033` — checkout default resolves the workflow's own commit, the anchored tag regex rejects prefix and prerelease collisions, the aggregator's 13 needs match its result loop.
- **Addendum from the A5b review**: bridge-core's `hub-token.test.ts` was the only check that the installed aztec-standards Token keeps the class the live seeds run (`0x0225da…`), and the wallet depends on it (`artifact-catalog.ts` resolves seeded tokens by class, `public-events.ts` gates indexing on it). Replaced wallet-side by `default-tokens.test.ts` on the A5a branch; mutating one seed's class id turns it red.

### A5a local e2e (2026-09-24)

- The first local run built with plain `bun run build`, so smoke red on `fixture-arming` and `fiat-display`: CI's smoke build sets `VITE_NULO_E2E_MIGRATION_FIXTURE`, `VITE_NULO_E2E_DEFAULT_NET=testnet` and the e2e token-seed pair, and without the seeds a fresh wallet loads the price-mapped production seeds. `e2e:agent` refused to start because the tree carries `@requires-proverless` files and `NULO_E2E_PROVERLESS` was unset. Re-run mirrors `_extension-smoke-e2e.yml`'s source-build env and CI's proverless pool.

## A5b

- **Source comments.** The recon list covered the design package, the schema patch and one dispatcher comment; the review found six more comments naming the tools app or "the bridge" as a live caller (error envelope, `UnsupportedMethodError`, the embedded-FPC cap test, the register-token e2e, two wallet-bridge/extension tests). All restated against the consumer that remains.

### A5b review round 1 (2026-09-24)

- **Codex** (`/codex high`, session `01a0d4be-a542-7071-8dba-7d2367b1ab9f`): **changes needed**, 2 findings, both adopted: the skill lost the `aztec-up install <pin>` prerequisite the wallet canaries need (it lived only in the deleted Noir section); `CI.md` told the reader to squash the back-sync PR.
- **Codex round 2** (same session): **changes needed**, 4 findings, all adopted: `faucet-bridge` is MIXED too (it recorded and performed the `@nulo/design` extraction); the `tools-two-network` evidence was wrong (four renamed test files, not one) and the rule now excludes mechanical edits; CLAUDE.md claimed the tools hosts already redirect (they serve the paused Pages deployment until C1); the register-contract test comment still narrated how the bug was found.
- **Claude workflow** (5 lenses × 2 refuters, 47 agents): 21 raw, 19 survived, deduplicated to 14. Adopted: the Token class-id pin (above); the six comments; eight plans reclassified MIXED and restored (below); `scope.md` and two restored plans' links into deleted plans freeze-pinned; CLAUDE.md's Bun pin sites (four `bun-version:` literals on the store jobs), the bridge routing row (whole skill at the freeze, not only Branch B) and the user-facing `tools.nulo.sh` links as an owner UI decision; CI.md's stale `main` cut-over, republish-hook and auto-unstick wording; `.github/README.md`'s network-e2e caller condition; the skill's PrivateFPC re-pin path (unleashed deploy + `seed-preflight.ts` precondition) and its stale snappy step. **Deferred**: CLAUDE.md / CI.md / ARCHITECTURE.md say every workspace `test` is `bun --bun vitest run` with a shared config, but `@nulo/resolve-asset` runs plain `vitest run` with none — predates the removal, and fixing it means choosing that package's runtime.
- **Reclassification.** Recon sorted plans by topic; the review tested what each plan's own commits changed outside the tools roots. Nine had made substantive decisions about code that stays (any-erc20-bridge #544, bridge-permit2-recipient-commitment #260, bridge-private #78, dedup-bridge-conductors #377, faucet-bridge `54708390` — the `@nulo/design` extraction, found by codex round 2 —, operator-gates #525, private-fuel, swap-fuel, private-fuel-fee-fix) → restored with their index lines; 27 stay deleted. `tools-two-network` stays deleted: #326 touched four wallet test files, all unused-variable renames. Mechanical edits, tools-only CI/config additions and complexity-manifest bookkeeping don't make a plan MIXED.

### Cross-arc review, A1 + A5a (2026-09-24)

- **Codex** (`/codex high`, session `01a0d4d6-3efd-7572-a774-61f1ac507e67`), 3 rounds. Round 1, **conditional approve**: bridge-core's `private-fuel.test.ts` also held the only check that `@alejoamiras/private-fee-juice`'s `dist/target/` copy (what `PrivateFPCContract` — the e2e fixtures, dApps — registers) equals the `target/` copy the wallet derives from → restored as a parity test in `protocol-fpcs.test.ts` (the copies differ in bytes, not content; deleting `name` from one side reds it). Round 2: the class id leaves out function flags such as `isStatic`, which `tx-request-builder.ts` copies into the call, so both copies could change together under a green address pin → a reviewed digest of the key-sorted artifact minus `file_map` (`7dd0ff19…8f1b`); pushing `abi_view` onto `pay_fee` in both copies reds only the digest test. Not restored: the installed-version-vs-descriptor check. Round 3: **approve**.
- **Merged A1** as #690 (`6611f861`) after the cross-arc round 1 cleared it: its own loop had converged and all three required checks were green; plain `gh pr merge --squash`. A5a rebased onto it with an identical tree.

### A5a merged (2026-09-24)

- **#691 → `dev` `14f1edd8`.** Required checks green (`quality-status`, `extension-smoke-e2e-status`, `extension-network-e2e-status`, plus both Firefox lanes). The first two e2e rounds were cancelled by the label-triggered reruns, which is why their red aggregators showed until the third round landed.
- **Decision-22 exception, owner's explicit go:** two red, non-required `Cloudflare Pages: nulo-tools-{testnet,mainnet}` checks remained — preview builds of the PR head from before the pause, failing because `apps/tools` is gone; they can never go green. Asked rather than merged; the owner chose "merge now".
- **Freeze SHA `6611f8611100931fe266f6fd1dfff27e331e2897`** (`14f1edd8^1`): `apps/tools/package.json` exists there and not at the merge. It equals `#690`'s squash, whose tree both tools suites ran green on. Every `<FREEZE_SHA>` link in the docs arc now carries it; each linked path was checked with `git ls-tree` at that commit.
