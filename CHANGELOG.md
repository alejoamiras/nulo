# Changelog

## [0.25.0](https://github.com/alejoamiras/nulo/compare/v0.24.0...v0.25.0) (2026-07-20)


### Features

* **aztec:** 5.0.1 line — client, standards+fee-payment swap, [#281](https://github.com/alejoamiras/nulo/issues/281) fence, live redeploy ([#282](https://github.com/alejoamiras/nulo/issues/282)) ([f9f28cf](https://github.com/alejoamiras/nulo/commit/f9f28cfd5af009ed312bfa0d09d5fb53628022a0))
* **backup:** migrate imported full-backups forward through the migration engine ([#274](https://github.com/alejoamiras/nulo/issues/274)) ([87f6678](https://github.com/alejoamiras/nulo/commit/87f6678b529cbc32b3987d1dae3066d01632c9ae))
* **backup:** security-harden backup import + profile deletion (A-H, D, audit fixes) ([#276](https://github.com/alejoamiras/nulo/issues/276)) ([fb61a63](https://github.com/alejoamiras/nulo/commit/fb61a6301b3a0147260ab6f4777a9f7211c2d48a))
* **extension:** data-preserving storage-migration framework ([#246](https://github.com/alejoamiras/nulo/issues/246)) ([79333e6](https://github.com/alejoamiras/nulo/commit/79333e6da56344ab46c3efceb8d7cd02b0cf2d67))
* **release:** require verify-live + faucet deploy-hook preflight ([#287](https://github.com/alejoamiras/nulo/issues/287)) ([f576ef6](https://github.com/alejoamiras/nulo/commit/f576ef612abe85e776c2423b14e71882ba324489))


### Bug Fixes

* **backup:** close the 3 backup-restore data-corruption bugs (P1–P3) + P6/P7 ([#275](https://github.com/alejoamiras/nulo/issues/275)) ([a1242ed](https://github.com/alejoamiras/nulo/commit/a1242ed8455e039cb77f68fdfb04739fae673211))
* **backup:** d13-residual safe cleanups (coordinator test, tombstone telemetry, index) ([#277](https://github.com/alejoamiras/nulo/issues/277)) ([ac6c436](https://github.com/alejoamiras/nulo/commit/ac6c4360619e4a4231fa8304404336e6d197a83c))
* **bridge:** L1-timeout deposit recovery + amount-error debounce + fee-juice notice ([#290](https://github.com/alejoamiras/nulo/issues/290)) ([0bda374](https://github.com/alejoamiras/nulo/commit/0bda374c825c49245a8cec3ed8e502a1ae4a0776))
* **bridge:** reachable recovery — stranded-card claim + private-fuel limbo escape ([#291](https://github.com/alejoamiras/nulo/issues/291)) ([8aa488e](https://github.com/alejoamiras/nulo/commit/8aa488ec021548d340fe114c42824ae3eca77a88))
* **bridge:** resilient receipt wait on approve, mint and consume legs ([#292](https://github.com/alejoamiras/nulo/issues/292)) ([c815551](https://github.com/alejoamiras/nulo/commit/c8155513912596eaab84935ff0595544808cea5f))
* **release:** landing/faucet deploys skip on workflow_dispatch (missing always()) ([#256](https://github.com/alejoamiras/nulo/issues/256)) ([de03935](https://github.com/alejoamiras/nulo/commit/de0393503875b9f653036a75569022ac95f12508))
* **security:** harden 14 audit findings (11 units) + gpt-5.6-sol post-merge audits ([#272](https://github.com/alejoamiras/nulo/issues/272)) ([cc0e7b2](https://github.com/alejoamiras/nulo/commit/cc0e7b22d5b4790b0a7c6b01e5e15fd998e6d706))
* **wallet:** registerContract void conformance + authwit consent card ([#288](https://github.com/alejoamiras/nulo/issues/288)) ([3f4785f](https://github.com/alejoamiras/nulo/commit/3f4785f3f829ea3b8b8da17709e1c48d9eda3fcf))


### Refactoring

* harden-quality arc — 21/22 audit findings (Q-01..Q-22), behavior-preserving ([#220](https://github.com/alejoamiras/nulo/issues/220)) ([578861b](https://github.com/alejoamiras/nulo/commit/578861be629770f76dffc9a2129a7762ac586104))


### Misc

* re-baseline prerelease manifest to 0.24.0 (post-stable-release sync) ([e16c15b](https://github.com/alejoamiras/nulo/commit/e16c15b74f1aaca11f7d671ce68973ab8c21039e))
* sync main → dev — v0.24.0 release + re-baseline prerelease manifest to 0.24.0 ([#254](https://github.com/alejoamiras/nulo/issues/254)) ([e511899](https://github.com/alejoamiras/nulo/commit/e511899edc1f7f40ea5b35a6c47d8252dc76e561))


### Docs

* aztec-update skill — the version-bump + network-reset runbook ([#257](https://github.com/alejoamiras/nulo/issues/257)) ([a439b63](https://github.com/alejoamiras/nulo/commit/a439b63aea0385d2da2edc7e9fcdb4256538e25d))
* **aztec-update:** fpc version gate, fueled candidate smoke, rollback invariant ([#273](https://github.com/alejoamiras/nulo/issues/273)) ([32fd6e0](https://github.com/alejoamiras/nulo/commit/32fd6e0ad1553fe79c23e9a83ab510b06f6df03b))
* **harden:** mark PROMOTE done — [#272](https://github.com/alejoamiras/nulo/issues/272) merged into dev ([#278](https://github.com/alejoamiras/nulo/issues/278)) ([3c45dc2](https://github.com/alejoamiras/nulo/commit/3c45dc23c849f59e1f66d6fd33fe1430bc120194))
* **plan:** close p7 — aztec-5.0.1-line delivery merged ([#286](https://github.com/alejoamiras/nulo/issues/286)) ([cfc40b6](https://github.com/alejoamiras/nulo/commit/cfc40b65c07cde4aabb699625e06b8093ef4e973))
* **plan:** log pre-release smoke findings ([#288](https://github.com/alejoamiras/nulo/issues/288) context) ([#289](https://github.com/alejoamiras/nulo/issues/289)) ([2a9c70f](https://github.com/alejoamiras/nulo/commit/2a9c70fa9dab4703d905fedb047e9aa141b584f7))
* **release:** stable-release-0.24.0 plan + lessons (first stable on new pipeline) ([#255](https://github.com/alejoamiras/nulo/issues/255)) ([4692738](https://github.com/alejoamiras/nulo/commit/469273804a93389280b3992c763432a233235b15))
* skill-lesson routing table in CLAUDE.md (update the owning skill, not this file) ([#258](https://github.com/alejoamiras/nulo/issues/258)) ([0f4c95c](https://github.com/alejoamiras/nulo/commit/0f4c95c9229c4b84e2278c9692c16f4fa896c175))


### Reverts

* **release:** drop faucet-hook-preflight + verify-live-required folds ([#295](https://github.com/alejoamiras/nulo/issues/295)) ([f6c0acd](https://github.com/alejoamiras/nulo/commit/f6c0acd0db2824e8ce9bb30740adc76c20f3d6a5))

## [0.24.0](https://github.com/alejoamiras/nulo/compare/v0.23.0...v0.24.0) (2026-07-02)


### Features

* **ci:** derive smoke/network/build gates from the dependency graph + guard test ([#181](https://github.com/alejoamiras/nulo/issues/181)) ([ee885cb](https://github.com/alejoamiras/nulo/commit/ee885cbdb0da552b3f0558d80499e8f4793cc21f))
* **design:** light theme — repair the broken extension theme + add faucet toggle ([#179](https://github.com/alejoamiras/nulo/issues/179)) ([c3db255](https://github.com/alejoamiras/nulo/commit/c3db255cd2e8e512b195b7241f30d0afa832d2bb))
* **faucet:** adopt @nulo/design primitives app-wide (resolver + Flex swaps) ([#147](https://github.com/alejoamiras/nulo/issues/147)) ([1741356](https://github.com/alejoamiras/nulo/commit/17413567524b4a2201fd79ecb202a1cdb7f5c1e3))
* **release:** near-one-click dev→main releases (auto-unstick, verify-live, sync, runbook) ([#149](https://github.com/alejoamiras/nulo/issues/149)) ([5aa8f8a](https://github.com/alejoamiras/nulo/commit/5aa8f8a1ca4e03c4d00732baac9c924c24d4e77e))


### Bug Fixes

* **ci:** rename required-check aggregators to unique names (main) ([0f8ae25](https://github.com/alejoamiras/nulo/commit/0f8ae25086f431c3c0706d397fe486cf1165d5dd))
* **ci:** rename required-check aggregators to unique names (main) ([#173](https://github.com/alejoamiras/nulo/issues/173)) ([17408da](https://github.com/alejoamiras/nulo/commit/17408da69cfcef824a4b292104a7644c9110fb83))
* **ci:** rename required-check aggregators to unique names so the merge gate can pass ([#170](https://github.com/alejoamiras/nulo/issues/170)) ([92df350](https://github.com/alejoamiras/nulo/commit/92df350074a2fda177f28c6ebd1d7b67619d4f2b))
* **ci:** repoint.sh finalize drops only the phantoms, preserving other checks ([#177](https://github.com/alejoamiras/nulo/issues/177)) ([5e3ea4e](https://github.com/alejoamiras/nulo/commit/5e3ea4e4e22260b64a067b88952b985398d03cc4))
* **ci:** skip commitlint on the main→dev sync PR (dev side) ([#223](https://github.com/alejoamiras/nulo/issues/223)) ([5d34da6](https://github.com/alejoamiras/nulo/commit/5d34da68901947f5afcca2361eaf1eb120d2b1cd))
* **design:** raise dark muted-text to WCAG-AA + drop dead --btn-* tokens ([#180](https://github.com/alejoamiras/nulo/issues/180)) ([a1351c6](https://github.com/alejoamiras/nulo/commit/a1351c6ad02246b4bd3737bcbb40508ef05a30c9))
* **faucet:** add completion receipt + New Fuel button to the Fuel flow ([#150](https://github.com/alejoamiras/nulo/issues/150)) ([64fa7ab](https://github.com/alejoamiras/nulo/commit/64fa7ab5f06d1bda735b291f322d74c227be9262))
* **faucet:** hero the bridged tokens on the receipt, demote Fee Juice ([#192](https://github.com/alejoamiras/nulo/issues/192)) ([cb9f1ff](https://github.com/alejoamiras/nulo/commit/cb9f1ffed22dd212773ae70dc19628451cde5721))
* **faucet:** route L1 reads through the connected wallet provider ([#187](https://github.com/alejoamiras/nulo/issues/187)) ([db0d745](https://github.com/alejoamiras/nulo/commit/db0d745070fb144c31fd8ce1039c2eaf6ef81948))
* **faucet:** surface a reverted fee-asset approve as an error ([#141](https://github.com/alejoamiras/nulo/issues/141)) ([e737869](https://github.com/alejoamiras/nulo/commit/e737869b9fb45ee6c6a57ec725bf323ecf1017f2))
* **release:** correct prerelease rc versioning (rc.0) + merge-based main→dev sync ([#221](https://github.com/alejoamiras/nulo/issues/221)) ([1d1c01e](https://github.com/alejoamiras/nulo/commit/1d1c01e10f54d29cf8dfedb25cfdf437b1ed84f5))
* **release:** sign the sync manifest re-baseline via the Contents API (App token) ([#228](https://github.com/alejoamiras/nulo/issues/228)) ([5a0d8b5](https://github.com/alejoamiras/nulo/commit/5a0d8b5ef9049d80d063c9e727ea2d953ce57f7e))
* **release:** single-source verify-live chain-guard from the faucet constant ([#249](https://github.com/alejoamiras/nulo/issues/249)) ([2a27a9c](https://github.com/alejoamiras/nulo/commit/2a27a9c4f442ff8f6d1f19b325b8045dfd88cdeb))


### Refactoring

* complete harden-quality arc (8 contained dedups + Q8 fix + purge test) ([#148](https://github.com/alejoamiras/nulo/issues/148)) ([b068393](https://github.com/alejoamiras/nulo/commit/b0683931e362c399404146a17f0c32912fc30683))
* **extension:** quality-arc batch 2 ([#160](https://github.com/alejoamiras/nulo/issues/160)) ([ea2d5a4](https://github.com/alejoamiras/nulo/commit/ea2d5a4391d9dfdc1c399678d276994d97a996fc))
* **repo:** restructure to apps/ + packages/ + contracts/ layout ([#186](https://github.com/alejoamiras/nulo/issues/186)) ([8e919f6](https://github.com/alejoamiras/nulo/commit/8e919f6af66834df7b3dd26f62fc7ae8ea3b3036))


### CI

* **merge:** add ready_for_review trigger so draft→ready PRs re-run CI ([#168](https://github.com/alejoamiras/nulo/issues/168)) ([5acd6df](https://github.com/alejoamiras/nulo/commit/5acd6dfe569121622648f9d5957c4d1839b517d5))


### Misc

* **deps:** bump bun 1.3.14 + node-polyfills 0.28.0, restore min-age gate ([#166](https://github.com/alejoamiras/nulo/issues/166)) ([e8c4191](https://github.com/alejoamiras/nulo/commit/e8c4191bddd4b40b4b580a464c3c31365317c8eb))
* **deps:** bump GitHub Actions majors + concurrently 10 ([#174](https://github.com/alejoamiras/nulo/issues/174)) ([f7bfcb7](https://github.com/alejoamiras/nulo/commit/f7bfcb74529ef1c27ed28ff74c5545cef86db8f9))
* **deps:** dedupe vitest onto vite 8 + drop dead vue-devtools chain ([#169](https://github.com/alejoamiras/nulo/issues/169)) ([3e392be](https://github.com/alejoamiras/nulo/commit/3e392be4b9f4400b20f530f6d24522e047a2dbe7))
* **deps:** refresh all in-range dependencies + biome 2.5 fallout ([#178](https://github.com/alejoamiras/nulo/issues/178)) ([5e1362f](https://github.com/alejoamiras/nulo/commit/5e1362f01337fe3bb460bef5265e86ded642b0f2))
* **dev:** release 0.24.0-rc.0 ([#189](https://github.com/alejoamiras/nulo/issues/189)) ([103b8e3](https://github.com/alejoamiras/nulo/commit/103b8e3bd1f0784ea3dabe4e69beb6252a6ebbbc))
* re-baseline dev to 0.23.0 after the stable cut ([#146](https://github.com/alejoamiras/nulo/issues/146)) ([c1a2712](https://github.com/alejoamiras/nulo/commit/c1a2712cac03b31cfcef56af4fb8230f21859b07))
* sync main → dev — bring [#173](https://github.com/alejoamiras/nulo/issues/173) (required-check rename) to satisfy promote strict:true ([d14ab14](https://github.com/alejoamiras/nulo/commit/d14ab149e2a75f92f1ff8918fbf48acab32cd932))
* sync main → dev — bring [#173](https://github.com/alejoamiras/nulo/issues/173) to satisfy the promote's strict:true ([#251](https://github.com/alejoamiras/nulo/issues/251)) ([f4f8061](https://github.com/alejoamiras/nulo/commit/f4f8061568c531581d50809c87eb5521c4fc5ed7))
* sync main → dev — restore v0.23.0 release-commit ancestry (prerelease anchor) ([1623ec2](https://github.com/alejoamiras/nulo/commit/1623ec24a250c362a38ea07c8518527de485ecd1))
* sync main → dev — restore v0.23.0 release-commit ancestry (prerelease anchor) ([#224](https://github.com/alejoamiras/nulo/issues/224)) ([32b490b](https://github.com/alejoamiras/nulo/commit/32b490b8ccb383886301afe69e8a6721f99dd966))


### Docs

* **ci:** correct required-check matrix (dev vs main) + the --admin/signing reason ([#165](https://github.com/alejoamiras/nulo/issues/165)) ([3a70ff8](https://github.com/alejoamiras/nulo/commit/3a70ff8d9a7c411f58f82ca4ffd745d5aaaa1396))
* **ci:** correct required-check matrix to the new bare names + two-gates --admin truth ([#176](https://github.com/alejoamiras/nulo/issues/176)) ([4199245](https://github.com/alejoamiras/nulo/commit/4199245a9d039e48584a58acd51d59a98753f198))
* **ci:** mark paths-filter-negation-fix complete + index it ([#185](https://github.com/alejoamiras/nulo/issues/185)) ([8968b40](https://github.com/alejoamiras/nulo/commit/8968b40f0fa9e7b1fade256e6f704dfed72f7d23))
* **ci:** required-check rollout lessons + repoint helper ([#171](https://github.com/alejoamiras/nulo/issues/171)) ([d23fca7](https://github.com/alejoamiras/nulo/commit/d23fca7328aa6ae149d98481b9ddf57ac63c44c8))
* **release:** prerelease-fix complete + fix prerelease publish --ref (dev not main) ([#226](https://github.com/alejoamiras/nulo/issues/226)) ([9d04629](https://github.com/alejoamiras/nulo/commit/9d04629e2243d2acfd6ab6b8c097afe007f20774))
* **release:** record prerelease-fix Phase 2 (zero-admin) + Phase 3 progress ([#225](https://github.com/alejoamiras/nulo/issues/225)) ([d3b0f24](https://github.com/alejoamiras/nulo/commit/d3b0f24d9327def875a675e855ed97fe90ca7b1b))


### Dependencies

* **aztec:** bump to 5.0.0-rc.2 + coupled testnet redeploy (portals, fpc, chainid, v9) ([#248](https://github.com/alejoamiras/nulo/issues/248)) ([bffb757](https://github.com/alejoamiras/nulo/commit/bffb7572bdba8b3dd5996d112dd88e4c0f4cb00b))

## [0.24.0-rc.0](https://github.com/alejoamiras/nulo/compare/v0.23.0...v0.24.0-rc.0) (2026-07-01)


### Features

* **ci:** derive smoke/network/build gates from the dependency graph + guard test ([#181](https://github.com/alejoamiras/nulo/issues/181)) ([ee885cb](https://github.com/alejoamiras/nulo/commit/ee885cbdb0da552b3f0558d80499e8f4793cc21f))
* **design:** light theme — repair the broken extension theme + add faucet toggle ([#179](https://github.com/alejoamiras/nulo/issues/179)) ([c3db255](https://github.com/alejoamiras/nulo/commit/c3db255cd2e8e512b195b7241f30d0afa832d2bb))
* **faucet:** adopt @nulo/design primitives app-wide (resolver + Flex swaps) ([#147](https://github.com/alejoamiras/nulo/issues/147)) ([1741356](https://github.com/alejoamiras/nulo/commit/17413567524b4a2201fd79ecb202a1cdb7f5c1e3))
* **release:** near-one-click dev→main releases (auto-unstick, verify-live, sync, runbook) ([#149](https://github.com/alejoamiras/nulo/issues/149)) ([5aa8f8a](https://github.com/alejoamiras/nulo/commit/5aa8f8a1ca4e03c4d00732baac9c924c24d4e77e))


### Bug Fixes

* **ci:** rename required-check aggregators to unique names so the merge gate can pass ([#170](https://github.com/alejoamiras/nulo/issues/170)) ([92df350](https://github.com/alejoamiras/nulo/commit/92df350074a2fda177f28c6ebd1d7b67619d4f2b))
* **ci:** repoint.sh finalize drops only the phantoms, preserving other checks ([#177](https://github.com/alejoamiras/nulo/issues/177)) ([5e3ea4e](https://github.com/alejoamiras/nulo/commit/5e3ea4e4e22260b64a067b88952b985398d03cc4))
* **ci:** skip commitlint on the main→dev sync PR (dev side) ([#223](https://github.com/alejoamiras/nulo/issues/223)) ([5d34da6](https://github.com/alejoamiras/nulo/commit/5d34da68901947f5afcca2361eaf1eb120d2b1cd))
* **design:** raise dark muted-text to WCAG-AA + drop dead --btn-* tokens ([#180](https://github.com/alejoamiras/nulo/issues/180)) ([a1351c6](https://github.com/alejoamiras/nulo/commit/a1351c6ad02246b4bd3737bcbb40508ef05a30c9))
* **faucet:** add completion receipt + New Fuel button to the Fuel flow ([#150](https://github.com/alejoamiras/nulo/issues/150)) ([64fa7ab](https://github.com/alejoamiras/nulo/commit/64fa7ab5f06d1bda735b291f322d74c227be9262))
* **faucet:** hero the bridged tokens on the receipt, demote Fee Juice ([#192](https://github.com/alejoamiras/nulo/issues/192)) ([cb9f1ff](https://github.com/alejoamiras/nulo/commit/cb9f1ffed22dd212773ae70dc19628451cde5721))
* **faucet:** route L1 reads through the connected wallet provider ([#187](https://github.com/alejoamiras/nulo/issues/187)) ([db0d745](https://github.com/alejoamiras/nulo/commit/db0d745070fb144c31fd8ce1039c2eaf6ef81948))
* **faucet:** surface a reverted fee-asset approve as an error ([#141](https://github.com/alejoamiras/nulo/issues/141)) ([e737869](https://github.com/alejoamiras/nulo/commit/e737869b9fb45ee6c6a57ec725bf323ecf1017f2))
* **release:** correct prerelease rc versioning (rc.0) + merge-based main→dev sync ([#221](https://github.com/alejoamiras/nulo/issues/221)) ([1d1c01e](https://github.com/alejoamiras/nulo/commit/1d1c01e10f54d29cf8dfedb25cfdf437b1ed84f5))


### Refactoring

* complete harden-quality arc (8 contained dedups + Q8 fix + purge test) ([#148](https://github.com/alejoamiras/nulo/issues/148)) ([b068393](https://github.com/alejoamiras/nulo/commit/b0683931e362c399404146a17f0c32912fc30683))
* **extension:** quality-arc batch 2 ([#160](https://github.com/alejoamiras/nulo/issues/160)) ([ea2d5a4](https://github.com/alejoamiras/nulo/commit/ea2d5a4391d9dfdc1c399678d276994d97a996fc))
* **repo:** restructure to apps/ + packages/ + contracts/ layout ([#186](https://github.com/alejoamiras/nulo/issues/186)) ([8e919f6](https://github.com/alejoamiras/nulo/commit/8e919f6af66834df7b3dd26f62fc7ae8ea3b3036))


### CI

* **merge:** add ready_for_review trigger so draft→ready PRs re-run CI ([#168](https://github.com/alejoamiras/nulo/issues/168)) ([5acd6df](https://github.com/alejoamiras/nulo/commit/5acd6dfe569121622648f9d5957c4d1839b517d5))


### Misc

* **deps:** bump bun 1.3.14 + node-polyfills 0.28.0, restore min-age gate ([#166](https://github.com/alejoamiras/nulo/issues/166)) ([e8c4191](https://github.com/alejoamiras/nulo/commit/e8c4191bddd4b40b4b580a464c3c31365317c8eb))
* **deps:** bump GitHub Actions majors + concurrently 10 ([#174](https://github.com/alejoamiras/nulo/issues/174)) ([f7bfcb7](https://github.com/alejoamiras/nulo/commit/f7bfcb74529ef1c27ed28ff74c5545cef86db8f9))
* **deps:** dedupe vitest onto vite 8 + drop dead vue-devtools chain ([#169](https://github.com/alejoamiras/nulo/issues/169)) ([3e392be](https://github.com/alejoamiras/nulo/commit/3e392be4b9f4400b20f530f6d24522e047a2dbe7))
* **deps:** refresh all in-range dependencies + biome 2.5 fallout ([#178](https://github.com/alejoamiras/nulo/issues/178)) ([5e1362f](https://github.com/alejoamiras/nulo/commit/5e1362f01337fe3bb460bef5265e86ded642b0f2))
* re-baseline dev to 0.23.0 after the stable cut ([#146](https://github.com/alejoamiras/nulo/issues/146)) ([c1a2712](https://github.com/alejoamiras/nulo/commit/c1a2712cac03b31cfcef56af4fb8230f21859b07))
* sync main → dev — restore v0.23.0 release-commit ancestry (prerelease anchor) ([1623ec2](https://github.com/alejoamiras/nulo/commit/1623ec24a250c362a38ea07c8518527de485ecd1))
* sync main → dev — restore v0.23.0 release-commit ancestry (prerelease anchor) ([#224](https://github.com/alejoamiras/nulo/issues/224)) ([32b490b](https://github.com/alejoamiras/nulo/commit/32b490b8ccb383886301afe69e8a6721f99dd966))


### Docs

* **ci:** correct required-check matrix (dev vs main) + the --admin/signing reason ([#165](https://github.com/alejoamiras/nulo/issues/165)) ([3a70ff8](https://github.com/alejoamiras/nulo/commit/3a70ff8d9a7c411f58f82ca4ffd745d5aaaa1396))
* **ci:** correct required-check matrix to the new bare names + two-gates --admin truth ([#176](https://github.com/alejoamiras/nulo/issues/176)) ([4199245](https://github.com/alejoamiras/nulo/commit/4199245a9d039e48584a58acd51d59a98753f198))
* **ci:** mark paths-filter-negation-fix complete + index it ([#185](https://github.com/alejoamiras/nulo/issues/185)) ([8968b40](https://github.com/alejoamiras/nulo/commit/8968b40f0fa9e7b1fade256e6f704dfed72f7d23))
* **ci:** required-check rollout lessons + repoint helper ([#171](https://github.com/alejoamiras/nulo/issues/171)) ([d23fca7](https://github.com/alejoamiras/nulo/commit/d23fca7328aa6ae149d98481b9ddf57ac63c44c8))

## [0.23.0](https://github.com/alejoamiras/nulo/compare/v0.22.0...v0.23.0) (2026-06-22)


### ⚠ BREAKING CHANGES

* **deps:** upgrade aztec to 5.0.0-rc.1 (protocol hard fork) ([#122](https://github.com/alejoamiras/nulo/issues/122))

### Features

* **activity,onboarding,journal:** incoming receives + fee-juice step + brutalist journal-detail polish ([#74](https://github.com/alejoamiras/nulo/issues/74)) ([1dcd21f](https://github.com/alejoamiras/nulo/commit/1dcd21fad239bc2a31ff2eaa7d1d5c54ac716255))
* **auth-registry:** build-pure trust-point cutover + network-e2e de-flake ([#115](https://github.com/alejoamiras/nulo/issues/115)) ([e344435](https://github.com/alejoamiras/nulo/commit/e344435d71ccfb68f4b4753ce5516023deb8f077))
* **authwit:** public-authwit lifecycle testability + execution follow-ups ([#85](https://github.com/alejoamiras/nulo/issues/85)) ([d06cd1b](https://github.com/alejoamiras/nulo/commit/d06cd1b665cb5a58d695471af0ae92eba698b40c))
* bridge-and-fuel foundation (public fuel live; private gas deferred) ([#84](https://github.com/alejoamiras/nulo/issues/84)) ([c67e04e](https://github.com/alejoamiras/nulo/commit/c67e04e450f888f96e3070927ce3557dcaedb856))
* **bridge:** integrate L1↔L2 token bridge into the faucet — contracts, bridge-core, UI ([5470839](https://github.com/alejoamiras/nulo/commit/547083905990f989ac1f2b76d6b3913e11cbf783))
* **bridge:** security cutover — init-once portal + single-minter proxy + witness-bound fuel ([#92](https://github.com/alejoamiras/nulo/issues/92)) ([5c1d487](https://github.com/alejoamiras/nulo/commit/5c1d4872c013883738347dd3696a1934ae4becc4))
* **ci:** accelerator-server in network-e2e + un-quarantine deferred-slow tests ([#67](https://github.com/alejoamiras/nulo/issues/67)) ([e6ac7fa](https://github.com/alejoamiras/nulo/commit/e6ac7fa52ff9d659c24784f2a2c4b30e5e74086f))
* **deps:** upgrade aztec to 5.0.0-rc.1 (protocol hard fork) ([#122](https://github.com/alejoamiras/nulo/issues/122)) ([0b23cef](https://github.com/alejoamiras/nulo/commit/0b23cef911c9a740bba7331b41fe4ffee8169783))
* **design:** base/theme/font takeover + L1/L2 primitives + round-1 cleanup (phases 2-5) ([#114](https://github.com/alejoamiras/nulo/issues/114)) ([4d245bb](https://github.com/alejoamiras/nulo/commit/4d245bbb2ce6ab801d53c86ac5912e01c1980345))
* **design:** externalize design tokens into @nulo/design (round 1, phase 1) ([#102](https://github.com/alejoamiras/nulo/issues/102)) ([3d5199d](https://github.com/alejoamiras/nulo/commit/3d5199dd938a9d800ff749d6c08b806b157c7b33))
* **design:** externalize the 9 L2 ui holdouts + composables + guardrails (round 2, P1–P6) ([#123](https://github.com/alejoamiras/nulo/issues/123)) ([7ddf219](https://github.com/alejoamiras/nulo/commit/7ddf2196899c95df4c0621554675f74d96eebfec))
* **design:** round-2 P7 — faucet AppButton→Button + Spinner cutover (revertible) ([#124](https://github.com/alejoamiras/nulo/issues/124)) ([472ee2a](https://github.com/alejoamiras/nulo/commit/472ee2a36af15cac6b03d5984985b1e685ea8086))
* **design:** round-3 close-out — drop dark color, retire AppButton, delete round-1 SFC shadows ([#127](https://github.com/alejoamiras/nulo/issues/127)) ([d9395cc](https://github.com/alejoamiras/nulo/commit/d9395cc862a780cf5c16729097605c9017f0b08b))
* **e2e:** proverless network-e2e split with controllable barrier ([#86](https://github.com/alejoamiras/nulo/issues/86)) ([4d1ffde](https://github.com/alejoamiras/nulo/commit/4d1ffde1f6e269e4e6557b68777de5c1620f441a))
* **execution:** per-origin + total-lane execution-mutex backpressure cap ([#73](https://github.com/alejoamiras/nulo/issues/73)) ([387a337](https://github.com/alejoamiras/nulo/commit/387a33708267e36807bb30e1e74d4eee492417e8))
* **execution:** route public-static internal view calls through node fast path ([#57](https://github.com/alejoamiras/nulo/issues/57)) ([f5b640a](https://github.com/alejoamiras/nulo/commit/f5b640a1c53a90fc5907c7af0927c2b46867fd40))
* **extension:** frontend UX fixes batch 1 (avatar, recipient card, address input, tab-order) ([#140](https://github.com/alejoamiras/nulo/issues/140)) ([4ad1b45](https://github.com/alejoamiras/nulo/commit/4ad1b45c48e8c445a5a042d7f9ccdc6c694cd5b3))
* **faucet:** add the Fuel tab (direct $AZTEC bridge + mint) on aztec 5.0 ([#104](https://github.com/alejoamiras/nulo/issues/104)) ([6f97bcf](https://github.com/alejoamiras/nulo/commit/6f97bcfbd241f56b18c291f88f57be6c45b22e45))
* **faucet:** guided bridge stepper, pending journal and seal-trust ux ([#80](https://github.com/alejoamiras/nulo/issues/80)) ([1175f96](https://github.com/alejoamiras/nulo/commit/1175f965cdc50acbb4691227b6de420c98118979))
* **faucet:** per-bridge sealed recovery files with restore ([#81](https://github.com/alejoamiras/nulo/issues/81)) ([f308431](https://github.com/alejoamiras/nulo/commit/f3084317b1f6e31d0f0533bf314671b5d87f68bc))
* **faucet:** private bridge deposit + withdraw with sealed bearer-secret recovery ([#78](https://github.com/alejoamiras/nulo/issues/78)) ([d3b20bf](https://github.com/alejoamiras/nulo/commit/d3b20bf24399f011913c2167d1089bfef83d1f8c))
* **faucet:** private Fee Juice bridge via the Wonderland PrivateFPC ([d0c8067](https://github.com/alejoamiras/nulo/commit/d0c8067d8a82f1cdecf2f18266f498a2d95c1898))
* **passkey:** brand new passkeys as nulo-{name}-{id} for password managers ([#138](https://github.com/alejoamiras/nulo/issues/138)) ([772d608](https://github.com/alejoamiras/nulo/commit/772d6088d22df64b82b5eb70048635a353fd36da))
* **security:** close 11 audit findings (F-001..F-009, F-011, F-012) ([#77](https://github.com/alejoamiras/nulo/issues/77)) ([336ea6f](https://github.com/alejoamiras/nulo/commit/336ea6f6d73a4b74a409a43f5349dd50e80f3380))
* token identity split (nulo/olun, azlo), registered-check rpc, l1 verification ([#82](https://github.com/alejoamiras/nulo/issues/82)) ([7f70f61](https://github.com/alejoamiras/nulo/commit/7f70f61a3039e2d754e52c62ad04f6917a0c7664))


### Bug Fixes

* **auth-registry:** correct swapped storage-slot constants (security) ([#101](https://github.com/alejoamiras/nulo/issues/101)) ([345eb1e](https://github.com/alejoamiras/nulo/commit/345eb1e29442e741527466a892cfe46e5fde5d97))
* **bridge-core:** fail-closed private-fuel in runSwapBridge + bearer-secret integrator docs ([1dccc4c](https://github.com/alejoamiras/nulo/commit/1dccc4c002e4794d2309428f9816f1789812e4d7))
* **e2e:** pre-grant accounts cap in register-token via fixture (phase 2) ([#63](https://github.com/alejoamiras/nulo/issues/63)) ([a5d1610](https://github.com/alejoamiras/nulo/commit/a5d16109f9cc17f7ec25816e4efbac45fc8868fe))
* **e2e:** pre-grant transaction cap in tx-sendTx-default via fixture (phase 3b) ([#64](https://github.com/alejoamiras/nulo/issues/64)) ([2fb7898](https://github.com/alejoamiras/nulo/commit/2fb789868f1b54236a602ec096beeee15c938293))
* **e2e:** quarantine tx-sendTx-default + bump cancel-mid-prove waits (Codex Phase 4) ([#66](https://github.com/alejoamiras/nulo/issues/66)) ([9226324](https://github.com/alejoamiras/nulo/commit/922632432bdb7eee41f96b817a4788507531ccfc))
* **e2e:** restore network suite to 61/61 — race fix + batch payload + retry budget ([#46](https://github.com/alejoamiras/nulo/issues/46)) ([6b2075e](https://github.com/alejoamiras/nulo/commit/6b2075eea5452feb0685a792924f44fa7a173671))
* **e2e:** split fee-methods to dedicated CI job + bump waitForPgResult (codex Phase 4 structural fix) ([#65](https://github.com/alejoamiras/nulo/issues/65)) ([0d02061](https://github.com/alejoamiras/nulo/commit/0d020614255564c56afc27ab4ccd3477cb4d5db3))
* **execute:** gate confirm button on fee selection ([#96](https://github.com/alejoamiras/nulo/issues/96)) ([138cfe2](https://github.com/alejoamiras/nulo/commit/138cfe27dced126e606a0975c131f09dff639795))
* **general:** close out codex p1 — txhash plumbing + journal-first filter ([#68](https://github.com/alejoamiras/nulo/issues/68)) ([bf7d7f7](https://github.com/alejoamiras/nulo/commit/bf7d7f7f37d0e88d3ccdeb9673cfb9ecf93342c7))
* **popups:** discover popup isReady gate (phase 1a e2e stabilization) ([#60](https://github.com/alejoamiras/nulo/issues/60)) ([8fc64a2](https://github.com/alejoamiras/nulo/commit/8fc64a205e1ed43782d9da490fda6aa30b23ea7f))
* **wallet-bridge:** honor session-authorized opts.from in sendTx ([#110](https://github.com/alejoamiras/nulo/issues/110)) ([e609c0e](https://github.com/alejoamiras/nulo/commit/e609c0e3a23526488c2bd88a3c5d868531d7367b))
* **wallet-sdk:** concurrent dApp sendTx via FIFO baton + queued visibility ([#53](https://github.com/alejoamiras/nulo/issues/53)) ([6380bf8](https://github.com/alejoamiras/nulo/commit/6380bf87c4c7fdb6245e908f77328720b10c8431))
* **wallet-sdk:** parallel dApp popups via mutex-ordered baton release (v3) ([#71](https://github.com/alejoamiras/nulo/issues/71)) ([a6b6f0d](https://github.com/alejoamiras/nulo/commit/a6b6f0d654fa78013830773706ebbb73b22ec21a))


### Refactoring

* apply /code-review fixes — spread built in fee strategies, drop dead isAtCap ([#117](https://github.com/alejoamiras/nulo/issues/117)) ([fb8f61d](https://github.com/alejoamiras/nulo/commit/fb8f61d5a3286833109d3a904a3cb01bd373cc27))
* **execution:** decompose execution service into executor + lane modules ([#83](https://github.com/alejoamiras/nulo/issues/83)) ([a03586a](https://github.com/alejoamiras/nulo/commit/a03586ac4b8973f226b20605293d60452723e577))
* **extension-messaging:** unify forked background/offscreen RPC transports (Q3) ([#121](https://github.com/alejoamiras/nulo/issues/121)) ([65961f1](https://github.com/alejoamiras/nulo/commit/65961f131f59e5eed0d2894d4f7ca307be5f1cfc))
* **extension,wallet-bridge:** retire simulate_views op kind via helper extraction ([#56](https://github.com/alejoamiras/nulo/issues/56)) ([8f124f5](https://github.com/alejoamiras/nulo/commit/8f124f56448c7d77e75deb41d5abc05ab8411c19))
* **extension:** de-fork vite/vitest config sprawl + fix e2e:all drift (Q7) ([#113](https://github.com/alejoamiras/nulo/issues/113)) ([9e76a83](https://github.com/alejoamiras/nulo/commit/9e76a83630c34ad894a278e2b33594c9ebd9f24e))
* **extension:** extract toRestoreError across restore sites + normalize contact (Q14) ([#112](https://github.com/alejoamiras/nulo/issues/112)) ([10ae086](https://github.com/alejoamiras/nulo/commit/10ae086316e536b261c6440b22d2bcd88e41c57e))
* **extension:** single-own CAIP runtime helpers in wallet-bridge (Q20) ([#111](https://github.com/alejoamiras/nulo/issues/111)) ([1111263](https://github.com/alejoamiras/nulo/commit/1111263ca9be8e797124de86abee9a5534ef8ecb))
* **incoming-transfer:** global service Lock for race-free trust state machine ([#75](https://github.com/alejoamiras/nulo/issues/75)) ([8438868](https://github.com/alejoamiras/nulo/commit/8438868648028b684b6fdb9e1e60d4e47abe7321))
* **profile:** dedup popup/onboarding profile flows + relocate passkey UI (Q2) ([#100](https://github.com/alejoamiras/nulo/issues/100)) ([7a3b373](https://github.com/alejoamiras/nulo/commit/7a3b3735afde259a208a82c46e7e59a695d4b196))
* **wallet-bridge:** fold six method-metadata tables into one MethodDescriptor registry (Q1) ([#91](https://github.com/alejoamiras/nulo/issues/91)) ([e9c51dd](https://github.com/alejoamiras/nulo/commit/e9c51dd035b123aae186fc200cfe671eaf527b6c))
* **wallet-core:** dedup Error-to-JSON projection across both replacers (Q22) ([#108](https://github.com/alejoamiras/nulo/issues/108)) ([67b613c](https://github.com/alejoamiras/nulo/commit/67b613c2b8e4f53c4a717336d11f58a2e19a4b09))
* **wallet-core:** remove dead symbol-level surface (Q16) ([#105](https://github.com/alejoamiras/nulo/issues/105)) ([5472733](https://github.com/alejoamiras/nulo/commit/5472733ab533f40bc1f88501aaf2ca5876659873))


### Tests

* **e2e:** convert blind sleeps to condition-polls in network tests + fixtures ([#120](https://github.com/alejoamiras/nulo/issues/120)) ([43f8707](https://github.com/alejoamiras/nulo/commit/43f87071b3460ed911631d1c8b0bc1cda4568cd9))
* **e2e:** deep-dump failure diagnostics for network e2e ([#95](https://github.com/alejoamiras/nulo/issues/95)) ([07e223e](https://github.com/alejoamiras/nulo/commit/07e223ec859bfd239ac1235d783d83d8f26e818d))
* **e2e:** deflake authwit-nav + concurrent-sendtx (settle-order, aria-disabled, diag) ([#97](https://github.com/alejoamiras/nulo/issues/97)) ([200dd3f](https://github.com/alejoamiras/nulo/commit/200dd3f8732e8017ec8a37493168e15c51f4850d))
* **e2e:** journal-stage assertions for sendTx (un-quarantine 3 + opportunistic restructure) ([989e4be](https://github.com/alejoamiras/nulo/commit/989e4be477ad017532cba953d4d2091d10f59da1))
* **e2e:** journal-truth oracle stabilizes proverless network suite ([#94](https://github.com/alejoamiras/nulo/issues/94)) ([efadcb8](https://github.com/alejoamiras/nulo/commit/efadcb8a34f44a9b153c0ce5665499ed4e5e30ae))
* **popups:** pin authwits enter-key gates (phase 1b e2e stabilization) ([#62](https://github.com/alejoamiras/nulo/issues/62)) ([90ccfd4](https://github.com/alejoamiras/nulo/commit/90ccfd4f8ccfeaf0c6f724c2ae0dfd5c55337b97))


### CI

* **network-e2e:** strict gate signal — retry:0, boot sentinel, wider filter, de-retry ([#98](https://github.com/alejoamiras/nulo/issues/98)) ([9de7901](https://github.com/alejoamiras/nulo/commit/9de7901b55938dd9335f587889943a5851f17af5))


### Misc

* **docs:** rename dapp-interaction-lock-fix → -v1 for naming consistency ([#70](https://github.com/alejoamiras/nulo/issues/70)) ([eb81950](https://github.com/alejoamiras/nulo/commit/eb81950531c952afce3f5f4ea0119c4123555ea3))
* merge main into dev for the v0.23.0 promote ([d273b54](https://github.com/alejoamiras/nulo/commit/d273b546d1e2b7fd29267d8c5f63bec88800cd2e))
* **quality-dedup:** wrap-up — all 5 arcs ✓ + index + Q16 dead-export cleanup ([#118](https://github.com/alejoamiras/nulo/issues/118)) ([30beeb4](https://github.com/alejoamiras/nulo/commit/30beeb40aa5b6fd4f5c7d8832b5a051c6c4b0a0f))
* **release:** pin 0.23.0 and repoint faucet install link to nulo.sh ([#142](https://github.com/alejoamiras/nulo/issues/142)) ([e4618d0](https://github.com/alejoamiras/nulo/commit/e4618d083fae77fbddc15f447bf50f2039a8002d))
* sync main → dev (0.22.0 release bump) ([#54](https://github.com/alejoamiras/nulo/issues/54)) ([6793c06](https://github.com/alejoamiras/nulo/commit/6793c06923338ec9ab012841888194973194eef8))


### Docs

* **claude:** record strict=false on dev + CLI merge admin caveat ([#79](https://github.com/alejoamiras/nulo/issues/79)) ([e9d698f](https://github.com/alejoamiras/nulo/commit/e9d698fd2e3cdbf925b9d7b345171058cf45628f))
* **index:** mark Q1 method-metadata-registry complete (merged [#91](https://github.com/alejoamiras/nulo/issues/91)) ([#119](https://github.com/alejoamiras/nulo/issues/119)) ([76a0756](https://github.com/alejoamiras/nulo/commit/76a0756234fab2ed0d628267ef1587d316ee222b))
* **network-followups:** archive 2 codex audits from PR [#46](https://github.com/alejoamiras/nulo/issues/46) work ([#61](https://github.com/alejoamiras/nulo/issues/61)) ([93394e6](https://github.com/alejoamiras/nulo/commit/93394e689e79c9390dab3926fd863ff116213e68))
* **plan:** mark network-e2e-required phase 7 done ([#116](https://github.com/alejoamiras/nulo/issues/116)) ([b706131](https://github.com/alejoamiras/nulo/commit/b70613154ffb99ed95bf3a26e8701e9bf2d207c7))

## [0.22.0](https://github.com/alejoamiras/nulo/compare/v0.21.1...v0.22.0) (2026-05-22)


### Features

* **capabilities:** brutalist popup with honest copy + sanitized decode parity ([#47](https://github.com/alejoamiras/nulo/issues/47)) ([f57bba0](https://github.com/alejoamiras/nulo/commit/f57bba0f183030eeef8fe58189f46efb78fa946c))
* **faucet,extension:** one-click "add to wallet" via registerToken RPC ([#50](https://github.com/alejoamiras/nulo/issues/50)) ([f3eb249](https://github.com/alejoamiras/nulo/commit/f3eb249d3344a5a7c2ddb192bd2c62a341a679b1))


### Bug Fixes

* **qa:** friends QA feedback batch [#1](https://github.com/alejoamiras/nulo/issues/1) — faucet + extension polish ([#48](https://github.com/alejoamiras/nulo/issues/48)) ([72df8f2](https://github.com/alejoamiras/nulo/commit/72df8f2cddb2268a0cb3582dcd337b58405ae8c2))

## [0.21.1](https://github.com/alejoamiras/nulo/compare/v0.21.0...v0.21.1) (2026-05-21)


### Bug Fixes

* **faucet:** allow bb.js wasm data URI + workers in CSP ([#43](https://github.com/alejoamiras/nulo/issues/43)) ([9057c95](https://github.com/alejoamiras/nulo/commit/9057c9522b5947e701ff1863d8bd3690536758a3))

## [0.21.0](https://github.com/alejoamiras/nulo/compare/v0.20.2...v0.21.0) (2026-05-21)


### Features

* **ci:** add release-please prerelease flow + fix stable manifest drift ([#36](https://github.com/alejoamiras/nulo/issues/36)) ([5959ea0](https://github.com/alejoamiras/nulo/commit/5959ea00f85e52ee657818afeca88f217797bee8))
* **extension:** profile-name input + onboarding copy parity ([#37](https://github.com/alejoamiras/nulo/issues/37)) ([8b5ecfd](https://github.com/alejoamiras/nulo/commit/8b5ecfd1d58acc30f6650e0903d9625e890a5f32))


### Bug Fixes

* **onboarding:** unify step page widths via shared layout component ([#40](https://github.com/alejoamiras/nulo/issues/40)) ([853b398](https://github.com/alejoamiras/nulo/commit/853b3987356e02dcaa0f87872bf1d206bd91301e))


### Misc

* clear remaining lint debt + drop merged plan STATUS.md ([#39](https://github.com/alejoamiras/nulo/issues/39)) ([849c456](https://github.com/alejoamiras/nulo/commit/849c4560f7ca34e60c2e6bbc15cd6c6d48b88293))


### Docs

* **claude:** add Release runbook + document the release-please-action v4 abort bug ([#34](https://github.com/alejoamiras/nulo/issues/34)) ([1e69f46](https://github.com/alejoamiras/nulo/commit/1e69f4638f228672f76e3c39968e4f0c470c227a))

## [0.20.2](https://github.com/alejoamiras/nulo/compare/v0.20.1...v0.20.2) (2026-05-21)


### Bug Fixes

* **ci:** prepend always() to skip-propagation guards ([#31](https://github.com/alejoamiras/nulo/issues/31)) ([0f78649](https://github.com/alejoamiras/nulo/commit/0f786497c0960aea68d9dce4b95ce8c807125fbd))

## [0.20.1](https://github.com/alejoamiras/nulo/compare/v0.20.0...v0.20.1) (2026-05-21)


### Bug Fixes

* **ci:** add group-pull-request-title-pattern (Merge plugin's actual config key) ([#28](https://github.com/alejoamiras/nulo/issues/28)) ([23d12c4](https://github.com/alejoamiras/nulo/commit/23d12c4eb9cbff9af456234f17d4e92b0efc8629))
* **ci:** set release-please title pattern explicitly (chore${scope}: release${component} ${version}) ([#24](https://github.com/alejoamiras/nulo/issues/24)) ([40899c2](https://github.com/alejoamiras/nulo/commit/40899c262983cb2bb33c997148ac468afa99aff3))
* **ci:** unstick release-please workflow (3 follow-ups from v0.20.0) ([#18](https://github.com/alejoamiras/nulo/issues/18)) ([2db0dd2](https://github.com/alejoamiras/nulo/commit/2db0dd21d31783f077063aaa93a290886c51bca7))
* **ci:** use release-please default title pattern (chore${scope}: release${component} ${version}) ([#21](https://github.com/alejoamiras/nulo/issues/21)) ([5fbf741](https://github.com/alejoamiras/nulo/commit/5fbf74176c1622161d7a70ce217a830337383615))

## [0.20.0](https://github.com/alejoamiras/nulo/compare/v0.17.1...v0.20.0) (2026-05-21)


### Features

* **ci:** replace release-it with release-please (single-workflow, App-authenticated) ([#12](https://github.com/alejoamiras/nulo/issues/12)) ([a5f6baf](https://github.com/alejoamiras/nulo/commit/a5f6bafd34e01697be21be6e362662dc6fd97059))
* **landing:** add demo build banner and preview disclaimer ([#11](https://github.com/alejoamiras/nulo/issues/11)) ([8a7eb84](https://github.com/alejoamiras/nulo/commit/8a7eb840f734e153d3ca65c940c52c1f2d13d653))
* **onboarding:** extract BrutalistTitle + 3 helpers (follow-up to [#7](https://github.com/alejoamiras/nulo/issues/7)) ([#8](https://github.com/alejoamiras/nulo/issues/8)) ([accfce3](https://github.com/alejoamiras/nulo/commit/accfce3c0f5e443d519151453140a9b7620306c0))
* **onboarding:** full-page onboarding tab + brand-aligned 5-step flow ([#7](https://github.com/alejoamiras/nulo/issues/7)) ([ee9727b](https://github.com/alejoamiras/nulo/commit/ee9727b1bbcf0f628ce935b64faf0db19cc40eed))


### Bug Fixes

* bug-fixes batch [#1](https://github.com/alejoamiras/nulo/issues/1) — toast, networks chip, brand, footer, wordmark ([#9](https://github.com/alejoamiras/nulo/issues/9)) ([3779b22](https://github.com/alejoamiras/nulo/commit/3779b224bd4f8a3641b3588db6c29544505a9c90))
* **ci:** pin release-please target-branch to main ([#15](https://github.com/alejoamiras/nulo/issues/15)) ([818d7f1](https://github.com/alejoamiras/nulo/commit/818d7f1ac28dbb6f6aee9a2dab1b9c46bb71e3f9))
* **landing:** point CTAs to release page instead of direct zip download ([46f48a1](https://github.com/alejoamiras/nulo/commit/46f48a1755c835c45f39bee60a37a59eb97f8789))


### Misc

* align biome vcs.defaultBranch with the GitHub default ([#3](https://github.com/alejoamiras/nulo/issues/3)) ([55e58d6](https://github.com/alejoamiras/nulo/commit/55e58d61be54fd945b84b40697d237c9f2b4774f))
* bump biome schema URL to 2.4.15 to match installed CLI ([#2](https://github.com/alejoamiras/nulo/issues/2)) ([7b53e36](https://github.com/alejoamiras/nulo/commit/7b53e3646452778bb9320770e19b692e023915e9))
* **ci:** migrate bun.lockb references to bun.lock across CI + docs ([#4](https://github.com/alejoamiras/nulo/issues/4)) ([1665d97](https://github.com/alejoamiras/nulo/commit/1665d97aa5a10ed3f73f084713717a3517d2dc6d))


### Docs

* **claude:** document dev/main branching + merge policy ([#5](https://github.com/alejoamiras/nulo/issues/5)) ([9ec9715](https://github.com/alejoamiras/nulo/commit/9ec97151b8c08010b42f6a859877dc3453f9a898))

## 0.20.0 (2026-05-21)

### Features

- Full-page onboarding tab + brand-aligned 5-step flow ([#7](https://github.com/alejoamiras/nulo/pull/7))
- Extract BrutalistTitle + 3 helpers; consolidate the onboarding/popup duplication surface ([#8](https://github.com/alejoamiras/nulo/pull/8))

### Bug Fixes

- Toast timer race in `useToast` (rapid second `openToast` no longer cuts the second toast short). Fee-estimation failure now surfaces a toast in send + execute. Header network chip routes directly to Manage Networks (no middle popup); "Set as active network" row inside per-network detail page handles activation. Landing wordmark simplified to plain "NULO". Landing footer cleaned up. Extension icon aligned to the landing's circle identity. ([#9](https://github.com/alejoamiras/nulo/pull/9))
