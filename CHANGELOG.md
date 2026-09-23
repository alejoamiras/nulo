# Changelog

## [0.28.0](https://github.com/alejoamiras/nulo/compare/v0.27.0...v0.28.0) (2026-09-23)


### ⚠ BREAKING CHANGES

* **tools:** any-ERC-20 send wizard with per-token grants; retire the single-token bridge ([#539](https://github.com/alejoamiras/nulo/issues/539))
* **bridge:** retire the vendored canonical portal and its verify path ([#483](https://github.com/alejoamiras/nulo/issues/483))
* **popup:** the vestigial aztecReset/sentinel reset path is removed (owner-authorized; no production users).

### Features

* **account:** kdf v2 export/import + post-review hardening ([#419](https://github.com/alejoamiras/nulo/issues/419)) ([10ebc18](https://github.com/alejoamiras/nulo/commit/10ebc18f207dca79e1ab5c01c1160f21fa1bddc4))
* **accounts:** account export/import become page flows with real file downloads ([#433](https://github.com/alejoamiras/nulo/issues/433)) ([024ddaa](https://github.com/alejoamiras/nulo/commit/024ddaace59cc71a0939a431bd9a6e671ec35eb6))
* **bridge-core:** generation manifest v2, send flow, hub claims, journalled conductor ([#538](https://github.com/alejoamiras/nulo/issues/538)) ([c192c55](https://github.com/alejoamiras/nulo/commit/c192c557fa19f12491c381e0c3951de9e7432385))
* **bridge:** measure and size the private exit's gas limits from the sandbox smoke ([#557](https://github.com/alejoamiras/nulo/issues/557)) ([bde7fc7](https://github.com/alejoamiras/nulo/commit/bde7fc7c7ede20f7f89dd837873d48bcafd9c1c0))
* **bridge:** portal factory + immutable-args clones + witness-bound router ([#536](https://github.com/alejoamiras/nulo/issues/536)) ([1d40d56](https://github.com/alejoamiras/nulo/commit/1d40d56e7a730dad7392feaab1785455e547c59f))
* **bridge:** private first claim spends fuel on its registration; no sponsor on any path ([#543](https://github.com/alejoamiras/nulo/issues/543)) ([72fcfbf](https://github.com/alejoamiras/nulo/commit/72fcfbf71e2a58891022fff858d913527cb45597))
* **bridge:** token hub on L2 — register from attested words, hub-derived tokens, TXE suite ([#537](https://github.com/alejoamiras/nulo/issues/537)) ([0f03e55](https://github.com/alejoamiras/nulo/commit/0f03e554645facdccae9bc73546f2cba2d54906b))
* **build:** ship third-party notices in the extension ([#642](https://github.com/alejoamiras/nulo/issues/642)) ([507ad05](https://github.com/alejoamiras/nulo/commit/507ad0569a208e087373d02dafcadcc48ad207c2))
* **execute:** show the transaction's scope and follow it after confirming ([#615](https://github.com/alejoamiras/nulo/issues/615)) ([c9350e2](https://github.com/alejoamiras/nulo/commit/c9350e229fb2bc1cb34c31914700e6905c22ac36))
* **execution:** cancellable fee estimates, capped admission + sync-debug rpc removal ([#347](https://github.com/alejoamiras/nulo/issues/347)) ([5f11528](https://github.com/alejoamiras/nulo/commit/5f11528631108a72e8d4be5eb11e939694241df7))
* **execution:** dapp estimate-to-confirm reuse for standard aztec_sendTx ([#349](https://github.com/alejoamiras/nulo/issues/349)) ([204f2bf](https://github.com/alejoamiras/nulo/commit/204f2bf45a5817f304e309c484126f1860d30938))
* **execution:** fold discovery into estimation sims + admission clamp ([#353](https://github.com/alejoamiras/nulo/issues/353)) ([9ca9308](https://github.com/alejoamiras/nulo/commit/9ca9308e98d8cabab584b7f2ac208d56893f41e8))
* **faucet:** confirm quiet flip — mint dot on proposed receipt + honest 1-2 min eta ([#345](https://github.com/alejoamiras/nulo/issues/345)) ([432ade9](https://github.com/alejoamiras/nulo/commit/432ade9f54c8f888ac950fb6c19902b90365184c))
* **faucet:** multi-account — choose main account on connect + switcher ([#341](https://github.com/alejoamiras/nulo/issues/341)) ([0176357](https://github.com/alejoamiras/nulo/commit/01763579eda3cc4e761877d998460a71ee2e65ab))
* **firefox:** declare data collection permissions and a minimum version ([#633](https://github.com/alejoamiras/nulo/issues/633)) ([7511614](https://github.com/alejoamiras/nulo/commit/75116145ab84c877bb024759a7ea1c2381e8682b))
* **gas:** stale-while-revalidate balance card — peek, concurrent legs, dimmed last-known ([#343](https://github.com/alejoamiras/nulo/issues/343)) ([ba82c49](https://github.com/alejoamiras/nulo/commit/ba82c494a9cfe7459d09b14593f7243f46de0ec8))
* **holdings:** holdings page, token list and send picker order ([#563](https://github.com/alejoamiras/nulo/issues/563)) ([e318cc5](https://github.com/alejoamiras/nulo/commit/e318cc5598c577908380c54cc8c2afada6c91885))
* **home:** silent per-row refreshes with one section-level activity dot ([#366](https://github.com/alejoamiras/nulo/issues/366)) ([6973379](https://github.com/alejoamiras/nulo/commit/697337910838d46a3c054d5a8623316ad74085c4))
* **home:** threshold-gated sync dot, lock/globe split, denser rows, header address copy ([#363](https://github.com/alejoamiras/nulo/issues/363)) ([3bbe0b2](https://github.com/alejoamiras/nulo/commit/3bbe0b2aad48f3a8dc7391ca5009008e0354cd02))
* **infra:** serve passkey.nulo.sh from a content-less worker ([#598](https://github.com/alejoamiras/nulo/issues/598)) ([e7f8cb0](https://github.com/alejoamiras/nulo/commit/e7f8cb03288965ffe9810c00318ae82b193dea3a))
* **landing:** publish the terms and privacy pages from legal/ ([#627](https://github.com/alejoamiras/nulo/issues/627)) ([4e65748](https://github.com/alejoamiras/nulo/commit/4e65748b35a8b40548faf3eb54aae46d2d6af123))
* **landing:** rebuild nulo.sh as the "on camera" feed page ([#558](https://github.com/alejoamiras/nulo/issues/558)) ([b47b9bf](https://github.com/alejoamiras/nulo/commit/b47b9bf4606291759a87323ae40c219fe89e5495))
* **legal:** record terms acceptance and gate sending on it ([#628](https://github.com/alejoamiras/nulo/issues/628)) ([c97edc6](https://github.com/alejoamiras/nulo/commit/c97edc641c74cbd0e3083674d9e15c003d93eb97))
* **notices:** add the third-party notices policy library ([#641](https://github.com/alejoamiras/nulo/issues/641)) ([0dcf506](https://github.com/alejoamiras/nulo/commit/0dcf506ff43f3f49b3165d32d3bfed7ec7ed9823))
* **onboarding:** check for presto only on a click, with the install pitch at rest ([#623](https://github.com/alejoamiras/nulo/issues/623)) ([648ed4c](https://github.com/alejoamiras/nulo/commit/648ed4c09f3502b0bff4a5c75579172b846e98af))
* **onboarding:** presto states, settings proving page ([#601](https://github.com/alejoamiras/nulo/issues/601)) ([976e189](https://github.com/alejoamiras/nulo/commit/976e189ef3f3de99f9cdff98b36c8bd98ca09ff5))
* **passkey:** 512-bit master reduce + kdf-spec passkey clause + execution canary ([#426](https://github.com/alejoamiras/nulo/issues/426)) ([9018c5c](https://github.com/alejoamiras/nulo/commit/9018c5c853b7739bbea228ed0bede6b8195ba6a7))
* **popup:** approval window opens on the active display and refocuses from the Queued card ([#551](https://github.com/alejoamiras/nulo/issues/551)) ([57c4158](https://github.com/alejoamiras/nulo/commit/57c4158a668f84406ffa449d665168f6069b6ba2))
* **popup:** confirm before a lock cancels running transactions ([#611](https://github.com/alejoamiras/nulo/issues/611)) ([0e9d9ce](https://github.com/alejoamiras/nulo/commit/0e9d9ce28e0f641dc1c48cef9b186615d9a3b99f))
* **popup:** home shows three holdings and a holdings tab ([#562](https://github.com/alejoamiras/nulo/issues/562)) ([e961d3d](https://github.com/alejoamiras/nulo/commit/e961d3dd4f3102f3c82ac849dd4e7dc411a6849c))
* **popup:** honest holdings loading states and default-token seed status ([#619](https://github.com/alejoamiras/nulo/issues/619)) ([44fd019](https://github.com/alejoamiras/nulo/commit/44fd019005c5b18b8218894960f56766861b598a))
* **popup:** pin to home ([#564](https://github.com/alejoamiras/nulo/issues/564)) ([765309d](https://github.com/alejoamiras/nulo/commit/765309dc4bc036c2562e418d7fbb0438879d007e))
* **profile:** credential-rooted imported-keys dek + duplicate-phrase guard + account e2e ([#427](https://github.com/alejoamiras/nulo/issues/427)) ([152b108](https://github.com/alejoamiras/nulo/commit/152b1083b95cbf253756e2733cac8daf5049dc54))
* **profile:** kdf v2 entropy model + recovery-phrase product cuts ([#418](https://github.com/alejoamiras/nulo/issues/418)) ([01f5da3](https://github.com/alejoamiras/nulo/commit/01f5da3ba9ec1c9715089c256ea05b89d51475dd))
* **proving:** migrate to presto, report the proving backend ([#600](https://github.com/alejoamiras/nulo/issues/600)) ([f354882](https://github.com/alejoamiras/nulo/commit/f354882667e6ab1dc949dd86752700fd8ae70acf))
* **release:** store launch arc 1 — name, icons, listing and keyless chrome publish ([#662](https://github.com/alejoamiras/nulo/issues/662)) ([0af7d9b](https://github.com/alejoamiras/nulo/commit/0af7d9bc5b3c5280658ea1e2e733c59a0e50a625))
* **release:** store launch arc 2 — firefox declaration, source package, amo publish ([#663](https://github.com/alejoamiras/nulo/issues/663)) ([a5374be](https://github.com/alejoamiras/nulo/commit/a5374be23e06cee718952cd482aecdeb09a55bfc))
* **send:** match the fee source to the transfer's privacy and warn on a public payer ([#631](https://github.com/alejoamiras/nulo/issues/631)) ([a7714f5](https://github.com/alejoamiras/nulo/commit/a7714f5e2ee4154246a17a3b10ace7b6f662dbf0))
* **send:** say what a send publishes; review the one that names you ([#660](https://github.com/alejoamiras/nulo/issues/660)) ([83b914b](https://github.com/alejoamiras/nulo/commit/83b914be750037cfcaed0a85f9eb5fcd2cb184cf))
* **settings:** probe presto unasked only after a check has reached it ([#626](https://github.com/alejoamiras/nulo/issues/626)) ([b0ebbb4](https://github.com/alejoamiras/nulo/commit/b0ebbb4082ede522c7f4884d65b473e126b785de))
* **test:** run every vitest suite on the bun runtime (interop stopgap, soak baselines) ([#459](https://github.com/alejoamiras/nulo/issues/459)) ([3e571b8](https://github.com/alejoamiras/nulo/commit/3e571b8c4cf76983f688b21f04fcb7aafa0cc5cf))
* **tooling:** @nulo/resolve-asset — layout-agnostic package assets, 2 phantom deps fixed ([#454](https://github.com/alejoamiras/nulo/issues/454)) ([efca16d](https://github.com/alejoamiras/nulo/commit/efca16d54ae1c9e1d2106127ec7f9e2b08bb1ede))
* **tools:** add accounts… and a visibility re-read; the multi-account cells ([#583](https://github.com/alejoamiras/nulo/issues/583)) ([48f7f78](https://github.com/alejoamiras/nulo/commit/48f7f783d9d72c778853f6266955bb9a68a9112e))
* **tools:** any-ERC-20 send wizard with per-token grants; retire the single-token bridge ([#539](https://github.com/alejoamiras/nulo/issues/539)) ([7bdbd8a](https://github.com/alejoamiras/nulo/commit/7bdbd8a20a43db363d4bd515776b0dc974553338))
* **tools:** attach a hash-less exit by its recomputed l2→l1 message and finish it ([#588](https://github.com/alejoamiras/nulo/issues/588)) ([c8ce70b](https://github.com/alejoamiras/nulo/commit/c8ce70b0582547f8e5d210efba04c26f418161e1))
* **tools:** claimed-by-another completion on the token message's nullifier + cross-tab locks ([#586](https://github.com/alejoamiras/nulo/issues/586)) ([2b5edb9](https://github.com/alejoamiras/nulo/commit/2b5edb9ecebe000d11ac12e6f5c21a677602f862))
* **tools:** console shell — rail, header chips, step rail, activity dock ([#546](https://github.com/alejoamiras/nulo/issues/546)) ([dd93d14](https://github.com/alejoamiras/nulo/commit/dd93d141a22d5a7900b1094adeeea288aacaa876))
* **tools:** reconcile a hash-less deposit from ethereum on claim ([#587](https://github.com/alejoamiras/nulo/issues/587)) ([b4b2653](https://github.com/alejoamiras/nulo/commit/b4b26536ccd78b21c4cb85f12233d94aa3c3b43a))
* **tools:** rename the faucet tab to drip ([#517](https://github.com/alejoamiras/nulo/issues/517)) ([bd19e26](https://github.com/alejoamiras/nulo/commit/bd19e265fa86d242e5e71f29843e8658266af846))
* **tools:** send wizard re-cut — stepper, address lookup, gas gate, background strip ([#542](https://github.com/alejoamiras/nulo/issues/542)) ([e0b05bb](https://github.com/alejoamiras/nulo/commit/e0b05bbbc78670d4e7c8a30dd3b07df211184335))
* **wallet-bridge:** widen an accounts grant on a repeat request; live-session switch e2e ([#582](https://github.com/alejoamiras/nulo/issues/582)) ([860deda](https://github.com/alejoamiras/nulo/commit/860deda12d81edb2abd11d9b934c3d7a4a064f09))
* **wallet:** route a dapp-named self-pay to the account's own fee juice; the bridge uses it ([#544](https://github.com/alejoamiras/nulo/issues/544)) ([91074a7](https://github.com/alejoamiras/nulo/commit/91074a74dc025f1f9b6a4dbaf67871b5982a848b))


### Bug Fixes

* **balances:** profile-scoped rows and an awaited account purge close orphan reattachment ([#488](https://github.com/alejoamiras/nulo/issues/488)) ([3e46e1e](https://github.com/alejoamiras/nulo/commit/3e46e1efaf19cbaf58cec77949109f4037fe6106))
* **balances:** serialize row creation and repair stranded token balances on boot ([#486](https://github.com/alejoamiras/nulo/issues/486)) ([9103dea](https://github.com/alejoamiras/nulo/commit/9103dea01ac637b56cc8b52eba98a5989192c8ae))
* **bridge:** delta-driven v4 settlement in uniswapfuelswap ([#437](https://github.com/alejoamiras/nulo/issues/437)) ([9491824](https://github.com/alejoamiras/nulo/commit/9491824874ab948934b3b4f7c346434fea2b9a37))
* **bridge:** guard portal initialize to the deploying eoa (front-run) ([#436](https://github.com/alejoamiras/nulo/issues/436)) ([44158c3](https://github.com/alejoamiras/nulo/commit/44158c3878be58683f5cc9a6e5120a0b02005dba))
* **bridge:** partial fills, unwrap direction, immutable verify ([#444](https://github.com/alejoamiras/nulo/issues/444)) ([2b1500f](https://github.com/alejoamiras/nulo/commit/2b1500fb2864e0d4d7a9ab88b575d7739fefdba3))
* **bridge:** restore the portal pins to the source they name ([#481](https://github.com/alejoamiras/nulo/issues/481)) ([68edd43](https://github.com/alejoamiras/nulo/commit/68edd43bc4b29fad320843e36008665b1ab41cc4))
* **build:** keep test modules out of the production routes ([#640](https://github.com/alejoamiras/nulo/issues/640)) ([c3893e9](https://github.com/alejoamiras/nulo/commit/c3893e97d657b8d57b5e33e198617e89506bb139))
* **ci:** let the complexity ratchet pass a base that predates the baseline ([#674](https://github.com/alejoamiras/nulo/issues/674)) ([2760e13](https://github.com/alejoamiras/nulo/commit/2760e13ccce93f588b5167c160616c774fdf3df1))
* **ci:** run the e2e gates by paths on any base, and fail an unexpected skip ([#480](https://github.com/alejoamiras/nulo/issues/480)) ([086d652](https://github.com/alejoamiras/nulo/commit/086d6526917a8bcdffdb1cfd333a81aa7d7ea0a1))
* **core:** lock ownership tickets + session artifact fence + note-cs epoch re-checks ([#461](https://github.com/alejoamiras/nulo/issues/461)) ([f8faf6b](https://github.com/alejoamiras/nulo/commit/f8faf6b8ea85fb1e00f09c481d1ebfb92cacfff2))
* **dapp:** durable cancellation + typed fee-method selector (deflake-round-2 4/5) ([#364](https://github.com/alejoamiras/nulo/issues/364)) ([d728a85](https://github.com/alejoamiras/nulo/commit/d728a85df7c00f00b7d05fd456a54c5e15f4dbed))
* **dapp:** feed cancel closes the approval popup; reject reaches the dApp as 4001 ([#550](https://github.com/alejoamiras/nulo/issues/550)) ([ca9c517](https://github.com/alejoamiras/nulo/commit/ca9c51737475ae9ea3f6044df0f966bc1b676a81))
* **dapp:** profile-bound sessions — stamp, guard, switch teardown, anchored lookups ([#458](https://github.com/alejoamiras/nulo/issues/458)) ([8710518](https://github.com/alejoamiras/nulo/commit/8710518d0054f8f1ea9b4c715d8c0501d2623df7))
* **data:** raw-key orphan sweep, authwit restore dedupe, hardened numeric id allocation ([#462](https://github.com/alejoamiras/nulo/issues/462)) ([2665af5](https://github.com/alejoamiras/nulo/commit/2665af59c0a444dc1a3c9944f9898bdf97819197))
* **e2e:** appearance flake at cause — dropdown state signal (deflake-round-2 2/5) ([#361](https://github.com/alejoamiras/nulo/issues/361)) ([88afd10](https://github.com/alejoamiras/nulo/commit/88afd104ddb8114d1f3cef3fdb578453dfa7f406))
* **e2e:** hold new cdp targets until the dead-rpc interception is armed ([#624](https://github.com/alejoamiras/nulo/issues/624)) ([51e8bcb](https://github.com/alejoamiras/nulo/commit/51e8bcba38c65aeb8e27b85106fe24c2bcc14fe6))
* **e2e:** origin-guard truth — two-sided visibility pin + gettokeninterface removal ([#422](https://github.com/alejoamiras/nulo/issues/422)) ([a6b7439](https://github.com/alejoamiras/nulo/commit/a6b7439d1784e728e3f3d52a34590223d486de5e))
* **e2e:** resolve aztec toolchain from the repo pin, not the mutable ~/.aztec/current symlink ([#344](https://github.com/alejoamiras/nulo/issues/344)) ([85529c7](https://github.com/alejoamiras/nulo/commit/85529c70ccbb474d37048166817690ab0cfa4316))
* **e2e:** root-cause deflake — settle-stable nav, purge/freshness signals, approvable gate ([#356](https://github.com/alejoamiras/nulo/issues/356)) ([d5eda02](https://github.com/alejoamiras/nulo/commit/d5eda022c28985d2f6b079b32d1c00ccb33af9ee))
* **execution:** bind every send to the session that authorized it ([#610](https://github.com/alejoamiras/nulo/issues/610)) ([7f08d80](https://github.com/alejoamiras/nulo/commit/7f08d8027b452753222bc9431af77204c1eae80e))
* **execution:** fence authwits and refuse sends without a journal record ([#617](https://github.com/alejoamiras/nulo/issues/617)) ([30010f6](https://github.com/alejoamiras/nulo/commit/30010f602cb9e775aff88d0b69a9995de1896fd9))
* **execution:** mutex slot for dApp sends, boot-reaper cutoff, fee match (B-02/03/19) ([#385](https://github.com/alejoamiras/nulo/issues/385)) ([02197a5](https://github.com/alejoamiras/nulo/commit/02197a55748454945e4f77db72d6fe54b86e374d))
* **execution:** pre-claim heartbeat lease, cas reap, bounded waitfortx, both-key cleanup ([#467](https://github.com/alejoamiras/nulo/issues/467)) ([14bfcc6](https://github.com/alejoamiras/nulo/commit/14bfcc679a7bc0c16281cdfe89291029853a1f1f))
* **export:** full-backup re-entry latch + error boundary + file-size caps ([#453](https://github.com/alejoamiras/nulo/issues/453)) ([85460d8](https://github.com/alejoamiras/nulo/commit/85460d83a0c51164b934a800a373cfb7558906e5))
* **extension:** cold-start resilience — offscreen single-flight, balance retry, cusd pin ([#355](https://github.com/alejoamiras/nulo/issues/355)) ([13b57a6](https://github.com/alejoamiras/nulo/commit/13b57a630767bfdc6cbe9731e59073a93b22206b))
* **extension:** fence six async state-transition races (arc 3 of 2026-08-16 audit) ([#386](https://github.com/alejoamiras/nulo/issues/386)) ([cf6726c](https://github.com/alejoamiras/nulo/commit/cf6726c725e9d01055e92e3c1df9930ee5c35815))
* **extension:** liveness-gated crash rollback — scenario A regression gate restored ([#403](https://github.com/alejoamiras/nulo/issues/403)) ([b178557](https://github.com/alejoamiras/nulo/commit/b17855702b8e291479d9983142ecd250f3e1beba))
* **extension:** nine UI/storage/composable audit fixes (arc 6 of 2026-08-16) ([#393](https://github.com/alejoamiras/nulo/issues/393)) ([144cbc6](https://github.com/alejoamiras/nulo/commit/144cbc6591247f25722086172d7d5af71b375725))
* **extension:** resync-and-retry on stale pxe anchor, typed dapp errors, console noise ([#606](https://github.com/alejoamiras/nulo/issues/606)) ([cb5e8bd](https://github.com/alejoamiras/nulo/commit/cb5e8bda24c745a8f615ef8ffcb8dcb0f3e7207f))
* **extension:** stop leaking messaging ports from loggers and account clients ([#613](https://github.com/alejoamiras/nulo/issues/613)) ([771c2a1](https://github.com/alejoamiras/nulo/commit/771c2a16f16cbef90112a39e3af61324689b8a1b))
* **extension:** transport + dApp-session correctness fences (arc 4) ([#387](https://github.com/alejoamiras/nulo/issues/387)) ([f306724](https://github.com/alejoamiras/nulo/commit/f306724e8d494533bdc0880122fe32926032766b))
* **faucet:** pin fuel-target mapping and record frontend econ review ([#441](https://github.com/alejoamiras/nulo/issues/441)) ([569264f](https://github.com/alejoamiras/nulo/commit/569264ff6f82d61094ef94cb52f027366a63f4f4))
* **firefox:** host the pxe page in a background-page frame, not a throttled window ([#659](https://github.com/alejoamiras/nulo/issues/659)) ([2540271](https://github.com/alejoamiras/nulo/commit/2540271ad8f9a213cacaecf3c221aeb4cd78f81c))
* **firefox:** installable gecko id, side-panel guards, and a headless firefox smoke ([#603](https://github.com/alejoamiras/nulo/issues/603)) ([e01e416](https://github.com/alejoamiras/nulo/commit/e01e416e8cc96de9379df29e44b392c4ffec3ca6))
* **import:** bounded chain-sync tail, honest balance states, torn-import unlock refusal ([#357](https://github.com/alejoamiras/nulo/issues/357)) ([081056e](https://github.com/alejoamiras/nulo/commit/081056e04aa0c154ce8aa95ddce85beb9ee57e0e))
* **incoming:** outcome-based scan health and one-shot token metadata ([#620](https://github.com/alejoamiras/nulo/issues/620)) ([92922b6](https://github.com/alejoamiras/nulo/commit/92922b6a0d1e0692bc9b701c6105821e8be14428))
* **lint:** baseline generator refuses to re-pin a changed biome version without --adopt ([#531](https://github.com/alejoamiras/nulo/issues/531)) ([22176f2](https://github.com/alejoamiras/nulo/commit/22176f2671f6b00dd372fef87159ca49bfa63b8e))
* **logging:** stop private data reaching the log pipeline, and enforce it ([#473](https://github.com/alejoamiras/nulo/issues/473)) ([005fd30](https://github.com/alejoamiras/nulo/commit/005fd30e0bf313363921d742e0039221fa8b4f29))
* **messaging:** fail a request at once when the port cannot open, and share one port fake ([#618](https://github.com/alejoamiras/nulo/issues/618)) ([141d4b6](https://github.com/alejoamiras/nulo/commit/141d4b647fc1f8c08c4feeb6bceacfb779a5d295))
* **migration:** gesture-gated retry budget + kill-loop bound + probe area ([#457](https://github.com/alejoamiras/nulo/issues/457)) ([6fe41b4](https://github.com/alejoamiras/nulo/commit/6fe41b46958fd1927e3eac66b47a0e480ca1d9b7))
* **passkey:** fall back to a get ceremony when create returns no prf output ([#632](https://github.com/alejoamiras/nulo/issues/632)) ([a7eaba7](https://github.com/alejoamiras/nulo/commit/a7eaba7398458085b05109eb77885997fe5292cf))
* **popup,profile:** a lock after a worker restart locks the popup; post-stop liveness gates ([#556](https://github.com/alejoamiras/nulo/issues/556)) ([2a3d2d8](https://github.com/alejoamiras/nulo/commit/2a3d2d87f6b89435a74ed924b0b62717015c265e))
* **popup,tools:** fold the whole-batch codex review of the 2026-09-02 follow-ups ([#534](https://github.com/alejoamiras/nulo/issues/534)) ([ccbdfac](https://github.com/alejoamiras/nulo/commit/ccbdfac179c59f72be5f36ae7a161a6c42932d5c))
* **popup:** a boot-time session lookup that stays unreachable settles on the lock screen ([#532](https://github.com/alejoamiras/nulo/issues/532)) ([293a998](https://github.com/alejoamiras/nulo/commit/293a9984f7b7f5c8148e9a066a6b8df0534f16e0))
* **popup:** balance warm-up no longer cancels its own refresh rpcs ([#449](https://github.com/alejoamiras/nulo/issues/449)) ([e765643](https://github.com/alejoamiras/nulo/commit/e765643be59550776705fd19ac94d2adacbd8a04))
* **popup:** connect on another chain provisions its account and offers the switch ([#545](https://github.com/alejoamiras/nulo/issues/545)) ([a4c5c78](https://github.com/alejoamiras/nulo/commit/a4c5c7837a208ce7b4e3767da9bfa760b42b4358))
* **popup:** keep the bottom nav on the popup's bottom edge in a firefox panel ([#650](https://github.com/alejoamiras/nulo/issues/650)) ([9527fd8](https://github.com/alejoamiras/nulo/commit/9527fd88e99762391000d573368316e13150c8fa))
* **popup:** latch the boot-retry presentation across superseding runs ([#535](https://github.com/alejoamiras/nulo/issues/535)) ([4df5eae](https://github.com/alejoamiras/nulo/commit/4df5eae55c23e1561383104d92c5e623613aa2d1))
* **popup:** read dapp call arguments by vocabulary, abi or raw fields behind a toggle ([#605](https://github.com/alejoamiras/nulo/issues/605)) ([9fc2f27](https://github.com/alejoamiras/nulo/commit/9fc2f27d991631cb5a41e03a8b87f56ce27ea2e5))
* **popup:** release the scope freeze for dapp sends and clear it on lock ([#614](https://github.com/alejoamiras/nulo/issues/614)) ([9da7b9f](https://github.com/alejoamiras/nulo/commit/9da7b9f188a7f307d85fed49be924fad66f2660a))
* **popup:** shell identity fences + owner-authorized aztecreset removal ([#463](https://github.com/alejoamiras/nulo/issues/463)) ([16e721b](https://github.com/alejoamiras/nulo/commit/16e721bab01c31e4fa9c50834ca6f93d21433543))
* **popup:** simulate rows show authwits, token popup waits, console off onerror; X5 + N5 ([#573](https://github.com/alejoamiras/nulo/issues/573)) ([339b48a](https://github.com/alejoamiras/nulo/commit/339b48af5c0ac12ce3182aefd1e5543fa0cfb4d2))
* **popup:** submit re-entrancy — full-lifetime latches folded into the validity source ([#430](https://github.com/alejoamiras/nulo/issues/430)) ([16e951b](https://github.com/alejoamiras/nulo/commit/16e951b78ee0ffc7c70280ec335a1fdbe066bf9e))
* **popup:** unified submit gate + ping passthrough — pre-edit enter blocked, pongs flow ([#424](https://github.com/alejoamiras/nulo/issues/424)) ([09098fb](https://github.com/alejoamiras/nulo/commit/09098fb5085c048f8f21d9bd6d0e150b4e9ca247))
* **profile:** identity-bound envelope mac + fingerprint coverage (f-1/f-2) ([#446](https://github.com/alejoamiras/nulo/issues/446)) ([d56d6a8](https://github.com/alejoamiras/nulo/commit/d56d6a85231218ae28c354d7d99086fc17992fe2))
* **profile:** session false-success, secret lifetime, tombstone wedge (B-01/10/11/12) ([#384](https://github.com/alejoamiras/nulo/issues/384)) ([44d6b31](https://github.com/alejoamiras/nulo/commit/44d6b31d7e98f0fb8e363a8450f7ba34c25f95ca))
* **profile:** torn-import sweep resumes the compensating delete at boot (F-B24) ([#405](https://github.com/alejoamiras/nulo/issues/405)) ([52c065a](https://github.com/alejoamiras/nulo/commit/52c065a74e9cb7a325f44437bd4dcfb5cf2be062))
* **pxe/offscreen:** fence chain-purge, OPFS-worker wedge + offscreen races (arc 5) ([#391](https://github.com/alejoamiras/nulo/issues/391)) ([c13b740](https://github.com/alejoamiras/nulo/commit/c13b740de8d1b361c01a9c7379fe641fdc7be319))
* **pxe:** provision-authority hardening — equality guard, already-ready sends, zeroize ([#401](https://github.com/alejoamiras/nulo/issues/401)) ([c2b4c88](https://github.com/alejoamiras/nulo/commit/c2b4c886ceee48dbce7f031d33c74bb3010037d8))
* **pxe:** re-imported profile boots past its predecessor's tombstone + delete-import e2e matrix ([#372](https://github.com/alejoamiras/nulo/issues/372)) ([095c525](https://github.com/alejoamiras/nulo/commit/095c525ef402a03d962f3177e01c187cf9c666a1))
* **runtime:** single-flight start — shared boot, observed failures, vetoed retries ([#425](https://github.com/alejoamiras/nulo/issues/425)) ([8771ce5](https://github.com/alejoamiras/nulo/commit/8771ce50aec51253f9d7082f893c4655185194f8))
* **runtime:** typed duplicate-init classification, passkey budget, allsettled phases ([#469](https://github.com/alejoamiras/nulo/issues/469)) ([4f2833a](https://github.com/alejoamiras/nulo/commit/4f2833ab3b6b5bb641ddf8e7c00331f6dcc9542c))
* **security:** bind dapp approval to the stored request; budget reconnect verify windows ([#596](https://github.com/alejoamiras/nulo/issues/596)) ([ad130ae](https://github.com/alejoamiras/nulo/commit/ad130aea1872d061dea2531998004afb664348ac))
* **security:** harden b1 — mechanical fixes for the 2026-09 pre-release audit ([#592](https://github.com/alejoamiras/nulo/issues/592)) ([f9ee51d](https://github.com/alejoamiras/nulo/commit/f9ee51d6ce732149a275f9cea69c22e6a78fefcb))
* **security:** harden b2 — backup slices, developer-mode networks, passkey rp id ([#594](https://github.com/alejoamiras/nulo/issues/594)) ([bb479bc](https://github.com/alejoamiras/nulo/commit/bb479bc8ef6e26dc07de164116aeb5f8c02a50f8))
* **security:** harden b3 — dek-keyed pxe/session keys, authwit scope, sender guards ([#595](https://github.com/alejoamiras/nulo/issues/595)) ([26e313e](https://github.com/alejoamiras/nulo/commit/26e313eb9dca16fb723397c2f8ebf8dd9ae033ec))
* **send:** degraded fee-card init + auto retry so a failed balance read can't freeze confirm ([#342](https://github.com/alejoamiras/nulo/issues/342)) ([a5e2e50](https://github.com/alejoamiras/nulo/commit/a5e2e50844269316cac53cb84d004640e0372e07))
* **services:** deletion+generation fences on account create, slice restores, balance sync ([#466](https://github.com/alejoamiras/nulo/issues/466)) ([90896ce](https://github.com/alejoamiras/nulo/commit/90896ce415828e341d5678786b52b8c1e043f209))
* **storage:** purge codec-hidden malformed rows via key-attributed raw pass (F-B23) ([#406](https://github.com/alejoamiras/nulo/issues/406)) ([96d2a82](https://github.com/alejoamiras/nulo/commit/96d2a823ad2901f770045aebe976905d2de036d4))
* **store:** stale-activation fence + unpinned account unhandledrejection (F-B27) ([#399](https://github.com/alejoamiras/nulo/issues/399)) ([a114aa1](https://github.com/alejoamiras/nulo/commit/a114aa1b3e28e05401ea51af1f67102fc1ed2b22))
* **token:** seed default tokens when a chain's first account is created ([#485](https://github.com/alejoamiras/nulo/issues/485)) ([23228d1](https://github.com/alejoamiras/nulo/commit/23228d1d080d4e20e1e236e9d0a0198dfefc9311))
* **tools:** a malformed persisted claim hash is a terminal record fault, not a slow receipt ([#533](https://github.com/alejoamiras/nulo/issues/533)) ([34a74f7](https://github.com/alejoamiras/nulo/commit/34a74f78e8fe0c6e1dae99268dd2913ee787a94b))
* **tools:** a private exit never names a public fee payer ([#554](https://github.com/alejoamiras/nulo/issues/554)) ([1046e07](https://github.com/alejoamiras/nulo/commit/1046e0767e64440e8a45691715625d3ac4de0fc8))
* **tools:** fuel writes merge the persisted block; a terminal revert clears the claim hash ([#527](https://github.com/alejoamiras/nulo/issues/527)) ([386868a](https://github.com/alejoamiras/nulo/commit/386868aae78502f7dc357b75abead3ce5f9e372e))
* **tools:** gate sends on contract registration and re-register on unregistered errors ([#607](https://github.com/alejoamiras/nulo/issues/607)) ([34ddff8](https://github.com/alejoamiras/nulo/commit/34ddff8939d6afc9de0a1c594defcfff9436c8a7))
* **tools:** guard the dropped-streak clear, surface malformed fuel hashes, multi-tab docs ([#530](https://github.com/alejoamiras/nulo/issues/530)) ([af49ab2](https://github.com/alejoamiras/nulo/commit/af49ab24d8495a889c84f30fac3031418808444a))
* **tools:** settle a standalone gas claim on its checkpointed nullifier; guard fuel patches ([#590](https://github.com/alejoamiras/nulo/issues/590)) ([323380f](https://github.com/alejoamiras/nulo/commit/323380f60e79ed1f7946a3526fa41570633968f5))
* **wallet-bridge:** reconcile badge at boot — sw kill left a ghost discovery count (F-B16) ([#407](https://github.com/alejoamiras/nulo/issues/407)) ([7d62280](https://github.com/alejoamiras/nulo/commit/7d622803d049778aae1e90636c26d4a4e1d03c7e))
* **wallet-sdk:** cold-wake relay — module-scope listener saves the waking dapp message ([#421](https://github.com/alejoamiras/nulo/issues/421)) ([92ff9a9](https://github.com/alejoamiras/nulo/commit/92ff9a912f117a29618af2342da8fee639a517d8))
* **wallet-sdk:** expire stale dApp discoveries at the SDK's 60s window (B-16) ([#390](https://github.com/alejoamiras/nulo/issues/390)) ([da957fb](https://github.com/alejoamiras/nulo/commit/da957fba7c875da6f58998e2e001c259458a54c1))
* **wallet-sdk:** reject a dApp's in-flight call in seconds when the background dies ([#665](https://github.com/alejoamiras/nulo/issues/665)) ([44cfe61](https://github.com/alejoamiras/nulo/commit/44cfe61ec72699a9f9d251a3f06fb1cdcd5556a8))
* **wallet:** capture-await-write concurrency sweep — 13 fenced units, dual-reviewed ([#489](https://github.com/alejoamiras/nulo/issues/489)) ([94237eb](https://github.com/alejoamiras/nulo/commit/94237eb76d1c26ba80614f2a75c1b287017e2ba9))
* **wallet:** dapp simulate/profile run as the account they name; self-pay phase e2e gate ([#549](https://github.com/alejoamiras/nulo/issues/549)) ([e0ac80c](https://github.com/alejoamiras/nulo/commit/e0ac80cff6eb0a4449090daabc905ce3469c9767))


### Performance

* **execution:** single-pass fee estimation for the canonical sponsored fpc ([#348](https://github.com/alejoamiras/nulo/issues/348)) ([6ea7639](https://github.com/alejoamiras/nulo/commit/6ea763915d8ee4162b63c850bedfe104c623d29c))


### Refactoring

* adopt the shared helpers that call sites re-typed inline ([#566](https://github.com/alejoamiras/nulo/issues/566)) ([e76be96](https://github.com/alejoamiras/nulo/commit/e76be966b9e0d8100f899f1741789a3595c1025d))
* **backup:** stage the migration core's validators under budget (126→122) ([#503](https://github.com/alejoamiras/nulo/issues/503)) ([3e50361](https://github.com/alejoamiras/nulo/commit/3e503613160777d7013b34611d7ff82ad9467fbe))
* **backup:** stage the restore surface under budget (122→117) ([#504](https://github.com/alejoamiras/nulo/issues/504)) ([c37bc4f](https://github.com/alejoamiras/nulo/commit/c37bc4f0f26a00a7583f4ccf6191b211c0a3be8b))
* **balances:** fuzz runner as a world, an op grammar, an oracle and named probes (43→41) ([#523](https://github.com/alejoamiras/nulo/issues/523)) ([e7167a7](https://github.com/alejoamiras/nulo/commit/e7167a7a578a1e52b9b2238238111d1d4107a43c))
* **balances:** stage the balance pipeline under budget (100→93) ([#508](https://github.com/alejoamiras/nulo/issues/508)) ([537b3fc](https://github.com/alejoamiras/nulo/commit/537b3fcc4501a21baedafa9ba51e6017f9483bab))
* **bridge-core:** argv-only process primitive for the deploy scripts ([#460](https://github.com/alejoamiras/nulo/issues/460)) ([bfaedb1](https://github.com/alejoamiras/nulo/commit/bfaedb130297d409d5bf954314254e9f73f38fb1))
* **bridge-core:** live-intent verify and promote as ordered gate coordinators (41→37) ([#524](https://github.com/alejoamiras/nulo/issues/524)) ([597635e](https://github.com/alejoamiras/nulo/commit/597635eb5e4d1d3ac0d86844f02a072d24ce1887))
* **bridge-core:** stage-decompose operator scripts over shared helpers, 16 directives fall ([#493](https://github.com/alejoamiras/nulo/issues/493)) ([ee084e2](https://github.com/alejoamiras/nulo/commit/ee084e2da60f440ad18639229d45848eed727d3c))
* **bridge:** retire the vendored canonical portal and its verify path ([#483](https://github.com/alejoamiras/nulo/issues/483)) ([ea2235d](https://github.com/alejoamiras/nulo/commit/ea2235d9d85060efb660c4bc9fb77b191159d95c))
* **bridge:** shared conductor bootstrap, private-fpc skeleton, dispatcher auth reuse ([#377](https://github.com/alejoamiras/nulo/issues/377)) ([5a157c4](https://github.com/alejoamiras/nulo/commit/5a157c41bb27f3f32638c64229b9279beb6091c6))
* **composables:** one fee-estimation engine behind both composables ([#381](https://github.com/alejoamiras/nulo/issues/381)) ([cc7bfe5](https://github.com/alejoamiras/nulo/commit/cc7bfe548fea5b42d73d994d41f461210028144a))
* **design:** shared cta typography rule + tooltip cross-axis extraction ([#378](https://github.com/alejoamiras/nulo/issues/378)) ([b5a03d0](https://github.com/alejoamiras/nulo/commit/b5a03d05acb5d7955c166b665d5e7a97e516d093))
* **durable-jobs:** stage the incoming/seeder/journal jobs under budget (93→87) ([#509](https://github.com/alejoamiras/nulo/issues/509)) ([9c3e496](https://github.com/alejoamiras/nulo/commit/9c3e496fb32da339a53e73fdc66b600f557a145b))
* **e2e:** dedup the harness storage joins and expose three scenarios (49→44) ([#521](https://github.com/alejoamiras/nulo/issues/521)) ([75884c3](https://github.com/alejoamiras/nulo/commit/75884c36946ba5fca473efedd70523efd54cd0fd))
* **e2e:** global-setup as a stage coordinator with a verbatim boot order (44→43) ([#522](https://github.com/alejoamiras/nulo/issues/522)) ([33e65cc](https://github.com/alejoamiras/nulo/commit/33e65cc48a5d73b3e0b38f2dff3d95c906fe1728))
* **e2e:** put browser launch, urls and disposal behind a seam ([#634](https://github.com/alejoamiras/nulo/issues/634)) ([0e46345](https://github.com/alejoamiras/nulo/commit/0e46345a424a5f9c97f11ddac80baac825251f3c))
* **execution:** discovery-aware estimator extraction + b1 testnet measurement ([#352](https://github.com/alejoamiras/nulo/issues/352)) ([7837e80](https://github.com/alejoamiras/nulo/commit/7837e809cc4db713c1716dbfc81e86d56fb7bc6a))
* **execution:** stage the length splits and fee tail under budget (106→100) ([#507](https://github.com/alejoamiras/nulo/issues/507)) ([3b689a0](https://github.com/alejoamiras/nulo/commit/3b689a0d8d4fedffd32c74327a40ef0005b542b4))
* **execution:** stage the money-path monoliths under budget (111→106) ([#506](https://github.com/alejoamiras/nulo/issues/506)) ([5d0cf60](https://github.com/alejoamiras/nulo/commit/5d0cf608e601414a2b6af43aacb62043cf435c48))
* **extension:** decompose the full-backup restore under budget (152→147) ([#498](https://github.com/alejoamiras/nulo/issues/498)) ([770af69](https://github.com/alejoamiras/nulo/commit/770af694e1da6b0d4874ac5f36c6b5bae9c80d11))
* **extension:** delete dead code and make the access-level map exhaustive ([#561](https://github.com/alejoamiras/nulo/issues/561)) ([2ad8a3b](https://github.com/alejoamiras/nulo/commit/2ad8a3b11be9df8ba574f4a99182e3c0fdca4afa))
* **extension:** honest clipboard copies via one helper + secret-scrub composable ([#380](https://github.com/alejoamiras/nulo/issues/380)) ([ff461a7](https://github.com/alejoamiras/nulo/commit/ff461a75c4676346dce3a32fac3c47bdb90ebdda))
* **extension:** vue-shell dedup — hero layout, list status, contact fields (arc 5) ([#500](https://github.com/alejoamiras/nulo/issues/500)) ([6af2430](https://github.com/alejoamiras/nulo/commit/6af243048c49af60393878ec7cae3bd2a862025a))
* **faucet:** cognitive shallow-tail batch c — band closed (175→158) ([#496](https://github.com/alejoamiras/nulo/issues/496)) ([8b12743](https://github.com/alejoamiras/nulo/commit/8b1274322b2daa548057f518cb9b61dbf5dc9ce8))
* **faucet:** decompose usedeposit — deposit legs + claim ladder under budget (158→152) ([#497](https://github.com/alejoamiras/nulo/issues/497)) ([f993ba2](https://github.com/alejoamiras/nulo/commit/f993ba234545e48d4febc3f9e8bc46b59c1c5e28))
* **faucet:** stage the fuel, withdraw, claim and backup cluster under budget (70→62) ([#513](https://github.com/alejoamiras/nulo/issues/513)) ([24d206a](https://github.com/alejoamiras/nulo/commit/24d206aed6348443d460052c82a502e637517722))
* **faucet:** stage the journal claim engine under budget (147→142) ([#499](https://github.com/alejoamiras/nulo/issues/499)) ([89bc4b9](https://github.com/alejoamiras/nulo/commit/89bc4b9fd5d86d9c5310acfba0a8c8515e31b814))
* **faucet:** stage the wallet-session factory into controllers under budget (74→70) ([#512](https://github.com/alejoamiras/nulo/issues/512)) ([8d6cca3](https://github.com/alejoamiras/nulo/commit/8d6cca3d30e2459dc2aaf489ba0ca5f54bcfee42))
* **fees:** shared balances store for fee cards + honest-unknown wire shape ([#346](https://github.com/alejoamiras/nulo/issues/346)) ([0700d7f](https://github.com/alejoamiras/nulo/commit/0700d7f27501c9c45e140a6bce7a0dbcceea72b5))
* **import:** extract restore stage 2 — provenance filter + relink, allow-set threaded ([#413](https://github.com/alejoamiras/nulo/issues/413)) ([b6c1318](https://github.com/alejoamiras/nulo/commit/b6c1318f230c645bf0f677ff69e2898bccf6b0bc))
* **messaging:** dedup error identity ritual, transport error shaping, client guards ([#374](https://github.com/alejoamiras/nulo/issues/374)) ([7f9a92c](https://github.com/alejoamiras/nulo/commit/7f9a92c87c12b586d504f6633fe3ce6c4c67d64f))
* **popup:** enter-submit unification — endpoint, profile, sender onto usepopupentity ([#423](https://github.com/alejoamiras/nulo/issues/423)) ([d29dfff](https://github.com/alejoamiras/nulo/commit/d29dffffd8e6d78aa18499e919d8a3e54282ad80))
* **popup:** identitystrip frame, proven-dead css removal, trimaddress adoption ([#379](https://github.com/alejoamiras/nulo/issues/379)) ([069a9e2](https://github.com/alejoamiras/nulo/commit/069a9e2782115052669a0d35a026615db3554792))
* **popup:** mechanical rider — dropdown, design input, file picking (53→49) ([#515](https://github.com/alejoamiras/nulo/issues/515)) ([e5f36cf](https://github.com/alejoamiras/nulo/commit/e5f36cfd3fe128dce3eb5646a1fced5d155b6acd))
* **popup:** one self-cleaning enter lifecycle — usepopupentity consolidation ([#432](https://github.com/alejoamiras/nulo/issues/432)) ([df0aa5a](https://github.com/alejoamiras/nulo/commit/df0aa5ac63e2012734dc6a93c9c2af94563c32f8))
* **popup:** share the page shells and style partials across pages and windows ([#569](https://github.com/alejoamiras/nulo/issues/569)) ([d744fc2](https://github.com/alejoamiras/nulo/commit/d744fc2d8a0ef35382984bda331ed01f7e3368a5))
* **popup:** shared field, list-sync and card pieces for popups and windows ([#570](https://github.com/alejoamiras/nulo/issues/570)) ([6bc0d23](https://github.com/alejoamiras/nulo/commit/6bc0d23ba42a8271d6dc5340e8d1948e3c52e14b))
* **popup:** stage the shell/state cluster under budget (62→53) ([#514](https://github.com/alejoamiras/nulo/issues/514)) ([ac9bd85](https://github.com/alejoamiras/nulo/commit/ac9bd85f13470222c82f30567cc4c7b1a7bc2681))
* **profile:** collapse service clone families, burn 11 complexity directives ([#492](https://github.com/alejoamiras/nulo/issues/492)) ([fbe6a86](https://github.com/alejoamiras/nulo/commit/fbe6a863776a10560f8816ac4293676ca05ab4d4))
* **pxe:** shared async-memo for the six hand-rolled promise caches ([#376](https://github.com/alejoamiras/nulo/issues/376)) ([ebca219](https://github.com/alejoamiras/nulo/commit/ebca2199d9946d5db3f61e159f653c9b274e9d05))
* **pxe:** stage the network-boundary functions under budget (117→111) ([#505](https://github.com/alejoamiras/nulo/issues/505)) ([09c9b37](https://github.com/alejoamiras/nulo/commit/09c9b376f3d81c8f4f531a98bde3cf499e00b3eb))
* **quality:** dedup-adoption — Q-07, Q-08, Q-09, Q-10, Q-11 ([#395](https://github.com/alejoamiras/nulo/issues/395)) ([09b7ae1](https://github.com/alejoamiras/nulo/commit/09b7ae1f02d8ced31f6cdbaf2fa3e67d12021f56))
* **quality:** first extractions (Q-01 epoch fence, Q-02 restore stage 1) ([#396](https://github.com/alejoamiras/nulo/issues/396)) ([ce2704b](https://github.com/alejoamiras/nulo/commit/ce2704b8f3716331d604d3a4e8cf3f11a1ca68fb))
* **quality:** quick-win maintainability fixes (Q-03, Q-05, Q-06, Q-12) ([#394](https://github.com/alejoamiras/nulo/issues/394)) ([f6318ca](https://github.com/alejoamiras/nulo/commit/f6318cad2ccd0be6d6ea0076a0bc575c706820a7))
* **runtime:** stage the service-worker boot under budget (87→83) ([#510](https://github.com/alejoamiras/nulo/issues/510)) ([eca082c](https://github.com/alejoamiras/nulo/commit/eca082ca5e94ed9fef8fd6dc0e3bd2eb8ffefdc8))
* **services:** collapse the repeated wrappers in the service and utility layer ([#568](https://github.com/alejoamiras/nulo/issues/568)) ([9e99eb4](https://github.com/alejoamiras/nulo/commit/9e99eb499ca0473d4ec43136bfd57b913877ff9a))
* **services:** lock.withlock everywhere — 69 hand-rolled lock frames centralized ([#375](https://github.com/alejoamiras/nulo/issues/375)) ([56a1639](https://github.com/alejoamiras/nulo/commit/56a1639ef9db7ad3d17205e779f935b56b0b0157))
* **services:** primitive-adoption closure — alarmdispatcher, restorerows, id-allocators ([#408](https://github.com/alejoamiras/nulo/issues/408)) ([adf07a5](https://github.com/alejoamiras/nulo/commit/adf07a55d1b1f696207de5d8c6f2a7ffdc973c34))
* **services:** q-04 pilot — buildfeestrategies + wiretablifecycle, pins first ([#415](https://github.com/alejoamiras/nulo/issues/415)) ([3c4ba0a](https://github.com/alejoamiras/nulo/commit/3c4ba0ad71e22eec996c786cb54725e8025054d3))
* **test-soak:** compare summaries through named validators with ordered findings (37→35) ([#525](https://github.com/alejoamiras/nulo/issues/525)) ([372558e](https://github.com/alejoamiras/nulo/commit/372558e6a96ba1cc18d82099ed31d6cd6c1adf36))
* **token:** extract persisttoken; pin updateendpoint + gettokeninterface (F-Q09) ([#412](https://github.com/alejoamiras/nulo/issues/412)) ([fe1fc58](https://github.com/alejoamiras/nulo/commit/fe1fc582aa5b9a21c76e15b61c02f0ee5945b1f3))
* **tools:** rename apps/faucet → apps/tools ([#516](https://github.com/alejoamiras/nulo/issues/516)) ([543c238](https://github.com/alejoamiras/nulo/commit/543c238c53e58c35ad0775268d786bbee547a9c5))
* **ui:** cognitive shallow-tail batch b — ui band under budget (190→175) ([#495](https://github.com/alejoamiras/nulo/issues/495)) ([690f720](https://github.com/alejoamiras/nulo/commit/690f7204d904ca28ef196d73ece21abea680f8fd))
* **wallet-sdk:** stage dispatch, capabilities and sdk boot under budget (83→74) ([#511](https://github.com/alejoamiras/nulo/issues/511)) ([9954184](https://github.com/alejoamiras/nulo/commit/995418402c6383ecc730f2a5a490338ff2abf474))
* **wallet:** cognitive shallow-tail batch a — services under budget (219→190) ([#494](https://github.com/alejoamiras/nulo/issues/494)) ([50c9654](https://github.com/alejoamiras/nulo/commit/50c96541966eb5c7b58b4caee73191d39c9644b7))


### Tests

* **bridge-core:** sandbox harness as a package surface, integration suite in ci ([#576](https://github.com/alejoamiras/nulo/issues/576)) ([db9b191](https://github.com/alejoamiras/nulo/commit/db9b191d5ec9560789f1fc28107335b6093a32aa))
* **bridge:** assert the withdraw payout as what the recipient gained ([#647](https://github.com/alejoamiras/nulo/issues/647)) ([bacf371](https://github.com/alejoamiras/nulo/commit/bacf371fb73a37bb75753c42bf9e2a86fa5f8d4c))
* **bridge:** blackhat adversarial poc suite for router, swap and portal ([#435](https://github.com/alejoamiras/nulo/issues/435)) ([3b2e1c7](https://github.com/alejoamiras/nulo/commit/3b2e1c705994017ff0ed36906dc47d660a3689f0))
* **bridge:** econ parameter matrix and permit deadline tightening ([#440](https://github.com/alejoamiras/nulo/issues/440)) ([0123cf3](https://github.com/alejoamiras/nulo/commit/0123cf31e67063bdf30e37ebb6d1f5fe5d6020a1))
* **bridge:** fuzz and property suites for router, swap routes, portal ([#438](https://github.com/alejoamiras/nulo/issues/438)) ([ace8a78](https://github.com/alejoamiras/nulo/commit/ace8a786f8de30fb507851bc11b434984b8ecd65))
* **bridge:** halmos symbolic proofs for router accounting ([#439](https://github.com/alejoamiras/nulo/issues/439)) ([958f8d9](https://github.com/alejoamiras/nulo/commit/958f8d92e8682e98ad9ff90696f722fef5f9cdec))
* **bridge:** prove the init-once guard the shim made untestable ([#484](https://github.com/alejoamiras/nulo/issues/484)) ([2c29cf4](https://github.com/alejoamiras/nulo/commit/2c29cf48d77f2225f3c1c99624cb728a2142689c))
* **bridge:** route conformance oracle and txe-ts behavior map ([#443](https://github.com/alejoamiras/nulo/issues/443)) ([8049e81](https://github.com/alejoamiras/nulo/commit/8049e81da598caf0ed5001d9bd38d2e879982762))
* **bridge:** txe suite for token bridge claims, exits and proxy guards ([#442](https://github.com/alejoamiras/nulo/issues/442)) ([2cbca34](https://github.com/alejoamiras/nulo/commit/2cbca348e86d790b797d62ee3e9a0ba340a59a06))
* **bridge:** withdraw through the real outbox; refuse over-debit and re-entry ([#651](https://github.com/alejoamiras/nulo/issues/651)) ([8adb204](https://github.com/alejoamiras/nulo/commit/8adb204f13407d34c4b7a68b88275bc524a3ec99))
* **crypto:** official bip-39 kats, computed entropy accounting, nonce pins, attack surface ([#429](https://github.com/alejoamiras/nulo/issues/429)) ([0c767a5](https://github.com/alejoamiras/nulo/commit/0c767a554682331d7aac8230e87946452bb1ed84))
* **design:** wait for the fade to end instead of a fixed frame ([#572](https://github.com/alejoamiras/nulo/issues/572)) ([4bfc65e](https://github.com/alejoamiras/nulo/commit/4bfc65e0075343748aa5587306100484e576b50d))
* **e2e:** accept the torn-import refusal as a third designed sw-restart outcome ([#359](https://github.com/alejoamiras/nulo/issues/359)) ([41bc7d4](https://github.com/alejoamiras/nulo/commit/41bc7d466a645ad43b048381bd5950cfe09eb51b))
* **e2e:** causal liveness gates + audit-fold pins (deflake-round-2 5/5) ([#365](https://github.com/alejoamiras/nulo/issues/365)) ([92c1bbf](https://github.com/alejoamiras/nulo/commit/92c1bbf572237ded64b7b880818dfedc068dbb09))
* **e2e:** console-capture truth — probe-verified, documented permanent ([#410](https://github.com/alejoamiras/nulo/issues/410)) ([ebe2992](https://github.com/alejoamiras/nulo/commit/ebe2992192c13c0950917239b5a236e631fd6898))
* **e2e:** crash-truth suite — rendezvous sw kills, two product bugs ledger-skipped ([#400](https://github.com/alejoamiras/nulo/issues/400)) ([0aa047e](https://github.com/alejoamiras/nulo/commit/0aa047e0a6ad9f145162d1ad94e475595ba7c30a))
* **e2e:** fail-fast arming guard for proverless-gated files ([#351](https://github.com/alejoamiras/nulo/issues/351)) ([dfabf79](https://github.com/alejoamiras/nulo/commit/dfabf7945849182de44e13e8c5da00d47423f6ef))
* **e2e:** imported-account lifecycle, backup rewrap round-trip, on-network execution ([#431](https://github.com/alejoamiras/nulo/issues/431)) ([4743124](https://github.com/alejoamiras/nulo/commit/4743124fec2d50e5643080ad919fa4dac13be6ea))
* **e2e:** one service-worker kill everywhere; rewrite the e2e-testing skill ([#553](https://github.com/alejoamiras/nulo/issues/553)) ([e7e9400](https://github.com/alejoamiras/nulo/commit/e7e940054be798c28bcff3384a56c218edc2c76b))
* **e2e:** pg-result mismatch dumps + retry-error surfacing (deflake-round-2 1/5) ([#360](https://github.com/alejoamiras/nulo/issues/360)) ([d72036d](https://github.com/alejoamiras/nulo/commit/d72036dd128f9589b981670a2a7a21261f7959f2))
* **e2e:** put the background kill behind the browser seam and run it on firefox ([#661](https://github.com/alejoamiras/nulo/issues/661)) ([60da5d6](https://github.com/alejoamiras/nulo/commit/60da5d66c1d1d5e9f7d8e7d20b666be238e967b4))
* **e2e:** raise waitforhash default to 15s (cold-boot opener flake) ([#468](https://github.com/alejoamiras/nulo/issues/468)) ([21244d4](https://github.com/alejoamiras/nulo/commit/21244d4a1f8273da4c379a7a5389c4ed9e04401f))
* **e2e:** replace sampled waits with state signals in the shared fixtures (deflake-round-3 2/5) ([#368](https://github.com/alejoamiras/nulo/issues/368)) ([b65b05b](https://github.com/alejoamiras/nulo/commit/b65b05b1bdef03dbefb2f37cc538d1ecd188e5ec))
* **e2e:** retire body-text balance scans + fail-hard fixtures (deflake-round-2 3/5) ([#362](https://github.com/alejoamiras/nulo/issues/362)) ([060f1dd](https://github.com/alejoamiras/nulo/commit/060f1ddd144294fb02493e8a608c2b297071c504))
* **e2e:** root-cause the sw-stop and locked-session flakes instead of rerunning them ([#548](https://github.com/alejoamiras/nulo/issues/548)) ([122149a](https://github.com/alejoamiras/nulo/commit/122149adf959efc0a2018cf45a436d68392ffac6))
* **e2e:** run both execution canaries on firefox and assert every canary lane ran them ([#666](https://github.com/alejoamiras/nulo/issues/666)) ([34111b6](https://github.com/alejoamiras/nulo/commit/34111b651500d7a69669f6809dd051fec651ac5b))
* **e2e:** run the network suite on firefox ([#636](https://github.com/alejoamiras/nulo/issues/636)) ([5c876e3](https://github.com/alejoamiras/nulo/commit/5c876e32843c1c06b5b69535bc88b24d4f9c75a0))
* **e2e:** run the smoke suite on firefox ([#635](https://github.com/alejoamiras/nulo/issues/635)) ([21ebf60](https://github.com/alejoamiras/nulo/commit/21ebf605683eb9ed50d8319f15d415e92a8dd7a7))
* **e2e:** run the terms gate and the dead-rpc send spec on firefox ([#652](https://github.com/alejoamiras/nulo/issues/652)) ([eec649f](https://github.com/alejoamiras/nulo/commit/eec649f0d11f4a083837a7a62644f399f5f3b3ae))
* **e2e:** stage-aware import wait + envelope campaign ([#409](https://github.com/alejoamiras/nulo/issues/409)) ([5b20276](https://github.com/alejoamiras/nulo/commit/5b20276e780f1a325e2f46e522b067df1a856d56))
* **e2e:** sw-resilience skip root-caused — the SW kill never kills (deflake-round-3 3/5) ([#369](https://github.com/alejoamiras/nulo/issues/369)) ([4becdee](https://github.com/alejoamiras/nulo/commit/4becdeecb241a998cf354c8e5bd1455590411531))
* **tools:** browser suite against an embedded wallet-sdk wallet, sharded tools ci ([#577](https://github.com/alejoamiras/nulo/issues/577)) ([c4bdf9a](https://github.com/alejoamiras/nulo/commit/c4bdf9ab37871423c6c3b06f27b1380aae5cfe4d))
* **tools:** recovery, permit2, hostile-list, wallet-loss, two-tab and viewport cells ([#584](https://github.com/alejoamiras/nulo/issues/584)) ([62f3456](https://github.com/alejoamiras/nulo/commit/62f3456af552b40fed7aa8bfe5e0b838ffe3d720))


### Build

* **extension:** keep every shipped file under the firefox linter's parse limit ([#646](https://github.com/alejoamiras/nulo/issues/646)) ([0196c7e](https://github.com/alejoamiras/nulo/commit/0196c7e75eefaf4c932d4219d5b79ca6a3530b77))


### CI

* **build:** fail when the extension build regenerates src/types ([#529](https://github.com/alejoamiras/nulo/issues/529)) ([6fdee18](https://github.com/alejoamiras/nulo/commit/6fdee18cffc2e03c92c34bd71c73775f3279397e))
* **firefox:** advisory firefox lanes in pr, nightly and release workflows ([#637](https://github.com/alejoamiras/nulo/issues/637)) ([8e51ad6](https://github.com/alejoamiras/nulo/commit/8e51ad6adc1591c8e5df27914175a568046f3db9))
* gate every pr, not only those based on main or dev ([#428](https://github.com/alejoamiras/nulo/issues/428)) ([2fb8a4d](https://github.com/alejoamiras/nulo/commit/2fb8a4d36bd08fb932d340bee9915c2f93eaeacf))
* name every aggregator for the product it gates; ship the protection runbook ([#575](https://github.com/alejoamiras/nulo/issues/575)) ([96f01c1](https://github.com/alejoamiras/nulo/commit/96f01c1e9cdc4ef28f78820594f67c862e60de7a))
* **network-e2e:** give presto the workflow token for its release-metadata lookup ([#609](https://github.com/alejoamiras/nulo/issues/609)) ([c543c18](https://github.com/alejoamiras/nulo/commit/c543c18d1014abb994206905fb4a234b7e1e2845))
* **network-e2e:** pin presto-server 1.1.2 and print its errors when proofs go missing ([#644](https://github.com/alejoamiras/nulo/issues/644)) ([2165301](https://github.com/alejoamiras/nulo/commit/21653016c820d305197710fd2e3d59e8165bea00))
* **pr-quick:** link the extension preview builds from a sticky pr comment ([#625](https://github.com/alejoamiras/nulo/issues/625)) ([9b2c747](https://github.com/alejoamiras/nulo/commit/9b2c747b05dd60fa09b1968739840e83ef65e8c5))
* **quality:** drop label triggers so cancelled duplicates stop blocking merges (deflake-round-3 1/5) ([#367](https://github.com/alejoamiras/nulo/issues/367)) ([5a6bec6](https://github.com/alejoamiras/nulo/commit/5a6bec666834485705e979c609fa9328957083a6))


### Misc

* **ci:** accelerator-server 2.0.0 — sha-pinned, seedless bb, enforced canary proofs ([#470](https://github.com/alejoamiras/nulo/issues/470)) ([1727a42](https://github.com/alejoamiras/nulo/commit/1727a42fbecd3b07ac934e8e0c3f42a1da5ba4cb))
* **ci:** nightly extension prereleases from dev ([#434](https://github.com/alejoamiras/nulo/issues/434)) ([f3b1242](https://github.com/alejoamiras/nulo/commit/f3b1242f3de259f92b440aa06df377eb3c1c3bf4))
* **ci:** nightly jscpd duplication trend report (advisory, audit:dup) ([#491](https://github.com/alejoamiras/nulo/issues/491)) ([7f2a4df](https://github.com/alejoamiras/nulo/commit/7f2a4dfd08fc30e02d9f1b43429e46f5c7635484))
* **ci:** pin every action to a commit sha; bump actions and bun to 1.4.2 ([#655](https://github.com/alejoamiras/nulo/issues/655)) ([06010c9](https://github.com/alejoamiras/nulo/commit/06010c9ba007dc9d3ca062a3b6a3d5754635f7de))
* **deps:** biome 2.5.9 + actionlint v1.73.2 (supersedes renovate [#388](https://github.com/alejoamiras/nulo/issues/388)/[#389](https://github.com/alejoamiras/nulo/issues/389)) ([#464](https://github.com/alejoamiras/nulo/issues/464)) ([0cbf7da](https://github.com/alejoamiras/nulo/commit/0cbf7da4482a607c4614ef2a53f3d42ddf29e9ed))
* **deps:** bump [@aztec](https://github.com/aztec) js line to 5.2.0 (noir + standards + fee-juice held) ([#471](https://github.com/alejoamiras/nulo/issues/471)) ([7f3d541](https://github.com/alejoamiras/nulo/commit/7f3d541f6ece857f18bd38caab25b458b084d54f))
* **deps:** bump biome 2.5.13, playwright 1.63.0 and fake-browser 2.0.1 ([#657](https://github.com/alejoamiras/nulo/issues/657)) ([25062c0](https://github.com/alejoamiras/nulo/commit/25062c06bfcee2d10b00395e0e20234fcd332186))
* **deps:** bump bun to 1.4.0 (pin+lockfile dedupe, parallel scripts, pm workflow) ([#452](https://github.com/alejoamiras/nulo/issues/452)) ([2793501](https://github.com/alejoamiras/nulo/commit/279350133bff5dff5210b48a3f7f302adac9c64b))
* **deps:** bump presto to the mit-licensed versions ([#639](https://github.com/alejoamiras/nulo/issues/639)) ([da7eca3](https://github.com/alejoamiras/nulo/commit/da7eca3afdcba02348c284a92c3d9ecf3ddd4dda))
* **deps:** isolated linker + exemption-free lockfile regeneration (v2, 40→23 advisories) ([#455](https://github.com/alejoamiras/nulo/issues/455)) ([d209a95](https://github.com/alejoamiras/nulo/commit/d209a9552c1355595afb2e2ad36ed72bc2db788f))
* **deps:** pinia 4 + @pinia/testing 2 (esm-only, devtools-api v8 peer) ([#465](https://github.com/alejoamiras/nulo/issues/465)) ([77e2684](https://github.com/alejoamiras/nulo/commit/77e2684b3d01aa64ee8a0428217656d14e11cc75))
* **e2e:** promote certification scripts + record round-3 findings (deflake-round-3 4/4) ([#370](https://github.com/alejoamiras/nulo/issues/370)) ([160a8a9](https://github.com/alejoamiras/nulo/commit/160a8a97f7caeaefebf44963750534885ee615d0))
* **home:** delete dead components, emit chain, and stale post-refresh comments ([#371](https://github.com/alejoamiras/nulo/issues/371)) ([1ad3ce8](https://github.com/alejoamiras/nulo/commit/1ad3ce84ae922db8568291be64c4e47f86f2d83b))
* **lint:** complexity budgets — cognitive 15 + 80-line cap with shrink-only baseline ([#490](https://github.com/alejoamiras/nulo/issues/490)) ([3f6a052](https://github.com/alejoamiras/nulo/commit/3f6a0528b3590db7fe81d81613ab9b0abae7034a))
* **lint:** justified complexity baseline — accepted form, anchored manifest, CI ratchet ([#526](https://github.com/alejoamiras/nulo/issues/526)) ([6b8405b](https://github.com/alejoamiras/nulo/commit/6b8405b0d0a97cee8bd63599fed01e70b674820e))
* re-baseline prerelease manifest to 0.27.0 ([c5db11d](https://github.com/alejoamiras/nulo/commit/c5db11d5aaedf8e695f86f2c707b27097005ca7e))
* **renovate:** drop the expired puppeteer carve-out ([#654](https://github.com/alejoamiras/nulo/issues/654)) ([83d7b31](https://github.com/alejoamiras/nulo/commit/83d7b310f572b7c39276f301a9b63259f285563c))
* sync main → dev ([#339](https://github.com/alejoamiras/nulo/issues/339)) ([184f390](https://github.com/alejoamiras/nulo/commit/184f390bb7f7dba5313d285ce1b8c8dec6fa9c99))


### Docs

* **audit:** 2026-08-16 remediation records + arc index rows ([#397](https://github.com/alejoamiras/nulo/issues/397)) ([ea03fca](https://github.com/alejoamiras/nulo/commit/ea03fca9300747f43a335bc631220f276ce126a6))
* **audit:** 2026-08-22 bug audit + 2026-08-24 adjudication (supersedes [#448](https://github.com/alejoamiras/nulo/issues/448)) ([#451](https://github.com/alejoamiras/nulo/issues/451)) ([ea9be87](https://github.com/alejoamiras/nulo/commit/ea9be8767da351c9f870070ce08804128193c420))
* **audit:** add dedup quality audit run 2026-08-14 ([#373](https://github.com/alejoamiras/nulo/issues/373)) ([5b3720e](https://github.com/alejoamiras/nulo/commit/5b3720e40a6f3fedfe357cf40b6cbd2fa6ae5cb0))
* **audit:** add dual bugs+quality audit run 2026-08-16-extension-mid ([#383](https://github.com/alejoamiras/nulo/issues/383)) ([162c454](https://github.com/alejoamiras/nulo/commit/162c454d556ca0a0f79b351d24b2e3d81100ecac))
* **audit:** dedup-mid remediation record + arc index rows ([#382](https://github.com/alejoamiras/nulo/issues/382)) ([e3fdf9d](https://github.com/alejoamiras/nulo/commit/e3fdf9df48751e79368c2bdf8abad7782d71bc2a))
* **audit:** remediation follow-up closure — 8 arcs merged, arc-9 recommendation ([#416](https://github.com/alejoamiras/nulo/issues/416)) ([a3a25ca](https://github.com/alejoamiras/nulo/commit/a3a25caad62f89e54af4f032fc1abc82342a3e00))
* **audit:** security harden pre-release audit + the 2026-09 remediation seed ([#591](https://github.com/alejoamiras/nulo/issues/591)) ([2bd32bb](https://github.com/alejoamiras/nulo/commit/2bd32bb731d8db1347cfa617a8f29c626c8b8093))
* **bridge:** generation runbook, readmes, update couplings, live-list canary fix ([#540](https://github.com/alejoamiras/nulo/issues/540)) ([6b07138](https://github.com/alejoamiras/nulo/commit/6b07138b29a26d7774d00d122979c30b86483282))
* **ci:** main's aggregator cut-over is pending, and the promote step says so ([#580](https://github.com/alejoamiras/nulo/issues/580)) ([51a500c](https://github.com/alejoamiras/nulo/commit/51a500c7dd6a9cba6ea83eae2872d7d86ea7e7b6))
* **claude:** two-products rule — extension and tools each work and test themselves ([#574](https://github.com/alejoamiras/nulo/issues/574)) ([036709d](https://github.com/alejoamiras/nulo/commit/036709d8ada1dc67ffe9874af0533dc9948b9237))
* **e2e:** record the SW-kill load flake and its retry trap ([#482](https://github.com/alejoamiras/nulo/issues/482)) ([6de6358](https://github.com/alejoamiras/nulo/commit/6de63585cb16f9bbb00914757c7e61d6d57f5de9))
* **e2e:** round-4 close-out — ledger dispositions, skill lessons, phase-2 log ([#404](https://github.com/alejoamiras/nulo/issues/404)) ([3e3bd12](https://github.com/alejoamiras/nulo/commit/3e3bd12977735594920f3e67fe48e9913ed30123))
* **infra:** record the rp host's zone state and probe it live nightly ([#599](https://github.com/alejoamiras/nulo/issues/599)) ([285f5b6](https://github.com/alejoamiras/nulo/commit/285f5b6f5caa582ce2f6830604b2b0e0241ca82a))
* **legal:** fill every privacy-policy placeholder for the store submission ([#672](https://github.com/alejoamiras/nulo/issues/672)) ([e062f4d](https://github.com/alejoamiras/nulo/commit/e062f4d24b29d350f877d6fdc26b7cf0acc59945))
* **plan:** arc 2 delivered — burn-down closed at 126 ([#501](https://github.com/alejoamiras/nulo/issues/501)) ([4e66243](https://github.com/alejoamiras/nulo/commit/4e66243132df734aa640815138bd331b7dc6a257))
* **plan:** bootstrap-route-decouple close-out + smoke-roundtrip certification ([#358](https://github.com/alejoamiras/nulo/issues/358)) ([3eb6e83](https://github.com/alejoamiras/nulo/commit/3eb6e8365f6559caf3f36d9a6cfb28efa3627305))
* **plan:** chrome-store-launch merged to dev; index and plan status completed ([#671](https://github.com/alejoamiras/nulo/issues/671)) ([509f4dd](https://github.com/alejoamiras/nulo/commit/509f4ddc713fd27b8729804c8e9c075a4cdcc113))
* **plan:** ci-note — ready_for_review cancellation-aggregator data point ([#414](https://github.com/alejoamiras/nulo/issues/414)) ([fe0577b](https://github.com/alejoamiras/nulo/commit/fe0577b9bab61e47d27b03a22b7115cf5180d284))
* **plan:** dedup ledger phases merged; index entry closed ([#571](https://github.com/alejoamiras/nulo/issues/571)) ([49a5841](https://github.com/alejoamiras/nulo/commit/49a58417501350aadd36cde430bca5e647e64554))
* **plan:** firefox-arc-closeout completed — the merge, the CI canary durations ([#668](https://github.com/alejoamiras/nulo/issues/668)) ([d4fd5e0](https://github.com/alejoamiras/nulo/commit/d4fd5e0f741851890eb23de310d0482dc5dd4027))
* **plan:** keep the arc c review log before its branch goes ([#649](https://github.com/alejoamiras/nulo/issues/649)) ([409dad7](https://github.com/alejoamiras/nulo/commit/409dad7f1397837903974eae3bd24895ad5a9211))
* **plan:** mark connect-chain-mismatch completed ([#547](https://github.com/alejoamiras/nulo/issues/547)) ([898a3b9](https://github.com/alejoamiras/nulo/commit/898a3b997111cb6a383d674e699398e1f093f5ae))
* **plan:** mark dapp-popup-cancel-focus completed in the index ([#555](https://github.com/alejoamiras/nulo/issues/555)) ([223d77c](https://github.com/alejoamiras/nulo/commit/223d77c6df6ae6ba8dee95b647fb204853fd90cf))
* **plan:** mark mac-identity-binding + refresh-balances-disconnect completed ([#450](https://github.com/alejoamiras/nulo/issues/450)) ([30fa480](https://github.com/alejoamiras/nulo/commit/30fa4806ef8a72e310a383c9774007b5e1556822))
* **plan:** mark port-client-connect, approval-scope-follow and holdings-loading-sync merged ([#622](https://github.com/alejoamiras/nulo/issues/622)) ([d066fde](https://github.com/alejoamiras/nulo/commit/d066fdec5368206a5deb349dc5a82fd871c9a9c5))
* **plan:** mark presto-migration complete (stack [#602](https://github.com/alejoamiras/nulo/issues/602) merged) ([#604](https://github.com/alejoamiras/nulo/issues/604)) ([43b9b76](https://github.com/alejoamiras/nulo/commit/43b9b766c8772088f2581b3bda0902ab1e57c232))
* **plan:** mark send-fee-privacy-notice completed ([#643](https://github.com/alejoamiras/nulo/issues/643)) ([2f91aa4](https://github.com/alejoamiras/nulo/commit/2f91aa4de2e10ae6b803857e583555a699194ede))
* **plan:** mark the firefox stack merged and record the headed passkey check ([#653](https://github.com/alejoamiras/nulo/issues/653)) ([67d13b2](https://github.com/alejoamiras/nulo/commit/67d13b23e8ee3879cb4d1a92bc19c3135317eded))
* **plan:** mark the harden 2026-09 remediation arc merged (stack [#593](https://github.com/alejoamiras/nulo/issues/593)) ([#597](https://github.com/alejoamiras/nulo/issues/597)) ([c1c0723](https://github.com/alejoamiras/nulo/commit/c1c07237a1a3710ad1d2e6442eb64d4857fea7ff))
* **plan:** mark third-party-notices completed ([#645](https://github.com/alejoamiras/nulo/issues/645)) ([423cabe](https://github.com/alejoamiras/nulo/commit/423cabe273880bd0660de0d8c7e8726604922806))
* **plan:** readiness — the multi-account path in both suites ([#581](https://github.com/alejoamiras/nulo/issues/581)) ([94e412a](https://github.com/alejoamiras/nulo/commit/94e412a67dda5ace0d946e8dab314a583301daa9))
* **plan:** remediation follow-ups execution spec (8 arcs + gated + rejected) ([#398](https://github.com/alejoamiras/nulo/issues/398)) ([60c299f](https://github.com/alejoamiras/nulo/commit/60c299fae834a0a69ecef873a1d2ce064eee382f))
* **plan:** round 3 completed — index, scope status, ci record; regen auto-imports ([#528](https://github.com/alejoamiras/nulo/issues/528)) ([71c3178](https://github.com/alejoamiras/nulo/commit/71c3178d77a919360dd440167170ebd945b84efb))
* **plan:** round-2 residue scope — 7 plans, target 49 ([#502](https://github.com/alejoamiras/nulo/issues/502)) ([092dda2](https://github.com/alejoamiras/nulo/commit/092dda24b690238b10c359210a9fe72c9306b468))
* **plan:** round-3 residue scope — justify in place, refactor on merit ([#519](https://github.com/alejoamiras/nulo/issues/519)) ([921338a](https://github.com/alejoamiras/nulo/commit/921338a83716650f5c2832a69364c51670f9f779))
* **plan:** send-publish-ledger merged — outcome and the two follow-ups ([#670](https://github.com/alejoamiras/nulo/issues/670)) ([379dd99](https://github.com/alejoamiras/nulo/commit/379dd9980d21d97671b6cbfc5f8206dddf16be9f))
* **plan:** stable-release-0.27.0 blueprint + execution record ([#340](https://github.com/alejoamiras/nulo/issues/340)) ([e6bf96b](https://github.com/alejoamiras/nulo/commit/e6bf96bfff18d1349443745c246e9e7ee9b49f5f))
* **plan:** tools-self-testing is merged ([#579](https://github.com/alejoamiras/nulo/issues/579)) ([09654bd](https://github.com/alejoamiras/nulo/commit/09654bd30d385cc175a5f8d235d5fc646da0839d))
* prompt audit, drop dated rule text and the unused code-review skill ([#560](https://github.com/alejoamiras/nulo/issues/560)) ([32f130f](https://github.com/alejoamiras/nulo/commit/32f130f7073f01de44b5512e26b6a0beb937f394))
* **security:** a manifest edit re-gates a locked version; say what that costs ([#656](https://github.com/alejoamiras/nulo/issues/656)) ([1860074](https://github.com/alejoamiras/nulo/commit/1860074b3b44090bfe69547f7fa96e5a28e8c43b))
* **security:** remove a min-age exclude in the pr that used it ([#648](https://github.com/alejoamiras/nulo/issues/648)) ([8136344](https://github.com/alejoamiras/nulo/commit/8136344c65a617f2a1e0a913270bdb6dfb5fc43a))
* **tools:** phase 5 note for the tools rename ([#520](https://github.com/alejoamiras/nulo/issues/520)) ([920ee23](https://github.com/alejoamiras/nulo/commit/920ee2394c4629ef7249932f08e24779fe67c1bb))

## [0.27.0](https://github.com/alejoamiras/nulo/compare/v0.26.0...v0.27.0) (2026-07-29)


### Features

* **activity:** silo wallet activity by profile, network, chain and account ([#325](https://github.com/alejoamiras/nulo/issues/325)) ([12bc0fb](https://github.com/alejoamiras/nulo/commit/12bc0fbe1a1e13d80974c16e01a8902818387926))
* **bridge:** mainnet swap-fuel — canonical-pool discovery + UniswapFuelSwap swapTarget ([#326](https://github.com/alejoamiras/nulo/issues/326)) ([a444e36](https://github.com/alejoamiras/nulo/commit/a444e3618d5d34a78f7187899225955f2ef08dec))
* **prices:** price + seed nulo's bridged usdc on alpha ([#330](https://github.com/alejoamiras/nulo/issues/330)) ([b7b7ebc](https://github.com/alejoamiras/nulo/commit/b7b7ebc0b999bd53cbe6291f8bc37e47686d8285))
* **tools:** network-aware l1 copy + token faucet live on alpha mainnet ([#329](https://github.com/alejoamiras/nulo/issues/329)) ([9335547](https://github.com/alejoamiras/nulo/commit/9335547cd42bbb238afb97cfb44b0afdf5c46a9d))
* **tools:** two-network foundations — dual build, schema split, mainnet deploy tooling ([#324](https://github.com/alejoamiras/nulo/issues/324)) ([5552392](https://github.com/alejoamiras/nulo/commit/55523924fc30199875323fc60bf1415c620fca44))


### Bug Fixes

* **activity:** post-merge hardening of the siloing arc (codex rounds 1-4) ([#328](https://github.com/alejoamiras/nulo/issues/328)) ([42a640a](https://github.com/alejoamiras/nulo/commit/42a640a64cae3471b7ff12dc90daa2544a2a72db))
* **faucet:** pad sponsored-drip maxFeesPerGas so pool fee ticks can't drop it ([#332](https://github.com/alejoamiras/nulo/issues/332)) ([7063bfe](https://github.com/alejoamiras/nulo/commit/7063bfec1030367b8b86c54f56d1061ccd414c80))
* pre-release bug sweep (fiat $0, testnet usdc, aztecscan links, fee caps, l1 chip) ([#335](https://github.com/alejoamiras/nulo/issues/335)) ([c00598a](https://github.com/alejoamiras/nulo/commit/c00598aee7a69a4e75382a9c83a9d4cb6188f0ed))
* **tools:** network-aware faucet footer + discard warning on alpha ([#331](https://github.com/alejoamiras/nulo/issues/331)) ([f0eedcf](https://github.com/alejoamiras/nulo/commit/f0eedcffd17724e54ef3f5af7404fb324d85518e))
* **transactions:** debounce transient DROPPED receipts + resurrect late-mined txs ([#327](https://github.com/alejoamiras/nulo/issues/327)) ([5c92048](https://github.com/alejoamiras/nulo/commit/5c92048ad17c342628c81c9715b9d97ffa4f22ab))


### Misc

* re-baseline prerelease manifest to 0.26.0 ([361589d](https://github.com/alejoamiras/nulo/commit/361589d54a807dafa798514efbf5092c13d33d35))
* sync main → dev ([#322](https://github.com/alejoamiras/nulo/issues/322)) ([1da3377](https://github.com/alejoamiras/nulo/commit/1da3377d45705b8e6f792e5a6a4be66ff26071e8))


### Docs

* **plan:** dp8 receipts — tools-two-network arc closed ([#333](https://github.com/alejoamiras/nulo/issues/333)) ([03e069a](https://github.com/alejoamiras/nulo/commit/03e069a7dd2405e02d18a8c028bfda570616ddfe))
* **plan:** stable-release-0.26.0 blueprint + execution record ([#323](https://github.com/alejoamiras/nulo/issues/323)) ([60e74b5](https://github.com/alejoamiras/nulo/commit/60e74b52705eb3fe7f360d1acf65f5d80732fe4f))

## [0.26.0](https://github.com/alejoamiras/nulo/compare/v0.25.0...v0.26.0) (2026-07-24)


### Features

* **bridge:** Permit2 everywhere + recipient-committed private claims + testnet cutover ([#260](https://github.com/alejoamiras/nulo/issues/260)) ([d5ecead](https://github.com/alejoamiras/nulo/commit/d5ecead6ab1674b9a0f27c8b8a6e3cd9cbc45bb3))
* **contacts:** decouple contacts from sender registration (handshake-era delivery) ([#302](https://github.com/alejoamiras/nulo/issues/302)) ([f5ee3be](https://github.com/alejoamiras/nulo/commit/f5ee3bed0a96d5252af30f096435a7f62abfd144))
* **extension:** alpha mainnet 5.0.1 identity, default network + drop devnet ([#305](https://github.com/alejoamiras/nulo/issues/305)) ([68a856a](https://github.com/alejoamiras/nulo/commit/68a856a0cd010f583ac3df783e8ef77b204132a5))
* **faucet:** wallet picker — explicit choice over first-wins discovery ([#306](https://github.com/alejoamiras/nulo/issues/306)) ([4cd229f](https://github.com/alejoamiras/nulo/commit/4cd229f88f2aef57bd6db938231f8e724715353b))
* **prices:** live usd prices, fiat send input, default token seeding ([#309](https://github.com/alejoamiras/nulo/issues/309)) ([c3fa7fc](https://github.com/alejoamiras/nulo/commit/c3fa7fc5c667bbff70b4e3eb73562591d611648c))
* **send:** per-network fee defaults + get-fee-juice nudge ([#319](https://github.com/alejoamiras/nulo/issues/319)) ([ffda434](https://github.com/alejoamiras/nulo/commit/ffda434e2d064bb13241bc1f64b0d5c154fe1a97))
* **wallet:** "Catching up…" token sync indicator ([#316](https://github.com/alejoamiras/nulo/issues/316)) ([0d44c39](https://github.com/alejoamiras/nulo/commit/0d44c394255094f1e37396a75ec902be76d433cf))
* **wallet:** freeze account identity per extension major (artifact, descriptor, regimes) ([#303](https://github.com/alejoamiras/nulo/issues/303)) ([10259cb](https://github.com/alejoamiras/nulo/commit/10259cb6b9b2e8b765985eb00b1f7189220db760))
* **wallet:** incoming public transfers — receipts, detail page, USD dust filter ([#315](https://github.com/alejoamiras/nulo/issues/315)) ([64d8529](https://github.com/alejoamiras/nulo/commit/64d85291d99adb350b7b92d58419babd67d08ded))


### Bug Fixes

* **activity:** contain account-switch cross-account leak (Phase 1, PR-D) ([#314](https://github.com/alejoamiras/nulo/issues/314)) ([780cdec](https://github.com/alejoamiras/nulo/commit/780cdec1403b8692f366d7786107099c10f16213))
* **faucet:** connect-error UX — status strip, red retry, drop capability subline ([#307](https://github.com/alejoamiras/nulo/issues/307)) ([af9c8ba](https://github.com/alejoamiras/nulo/commit/af9c8ba07bedae1215e8215a37ce09c878c3cd6b))
* **messaging:** rpc params carry explicit arity — undefined mid-args no longer truncate ([#311](https://github.com/alejoamiras/nulo/issues/311)) ([68f091f](https://github.com/alejoamiras/nulo/commit/68f091fb980d4575ad663289e1df6bda9ca2d509))
* **received:** align non-address "From" values with the "To" account styling ([#317](https://github.com/alejoamiras/nulo/issues/317)) ([1b5211c](https://github.com/alejoamiras/nulo/commit/1b5211c658625078c18f92bab005ba90621c63de))
* **wallet:** backup permission, import default network, active-network restore, network-list UX ([#313](https://github.com/alejoamiras/nulo/issues/313)) ([afecc82](https://github.com/alejoamiras/nulo/commit/afecc820b9a06fb4fc1b3fd9aa05b41a3a6b5fc8))


### Tests

* **e2e:** move aztec sandbox datadir off tmpfs + add e2e:reap ([#310](https://github.com/alejoamiras/nulo/issues/310)) ([d0c610f](https://github.com/alejoamiras/nulo/commit/d0c610f76d5c25d360e4ef8a73270791f1d8b7d8))
* **extension:** wire the e2e teardown for real + release-gate artifact skip ([#308](https://github.com/alejoamiras/nulo/issues/308)) ([6ca87a5](https://github.com/alejoamiras/nulo/commit/6ca87a56719b802e7d40c2d8fd7af705fa957aac))
* **incoming-public-transfers:** case 4 SW-restart resume — unit cursor-resume proof ([#318](https://github.com/alejoamiras/nulo/issues/318)) ([4e5435b](https://github.com/alejoamiras/nulo/commit/4e5435b3b9971f3fd6a8ee1303f174d584290c99))


### Misc

* allow the release type in commitlint (used by promote dev → main) ([85a518d](https://github.com/alejoamiras/nulo/commit/85a518d0825260772ec7ac3201d2ed09f6d872ce))
* **deps:** rename aztec-fee-payment to private-fee-juice (5.0.1) ([#304](https://github.com/alejoamiras/nulo/issues/304)) ([c97e9cd](https://github.com/alejoamiras/nulo/commit/c97e9cd74202601988419f48ae9f1d4afca5dce0))
* re-baseline prerelease manifest to 0.25.0 (post-stable-release sync) ([36b6f12](https://github.com/alejoamiras/nulo/commit/36b6f1209d302b274a17398acdf403ed3638f6dd))
* **release:** drop the redundant network-e2e re-run from the push:main publish ([#300](https://github.com/alejoamiras/nulo/issues/300)) ([cff0ba2](https://github.com/alejoamiras/nulo/commit/cff0ba26593a8c86224843477aa49c96d0b6abe3))
* sync main → dev (v0.25.0 release + prerelease manifest re-baseline) ([#298](https://github.com/alejoamiras/nulo/issues/298)) ([04e5728](https://github.com/alejoamiras/nulo/commit/04e57285b8f0a8bb3cb54b6455e4bc78d9416bbf))


### Docs

* **plan:** log R execution — v0.25.0 shipped + recovery lessons ([#299](https://github.com/alejoamiras/nulo/issues/299)) ([568bc16](https://github.com/alejoamiras/nulo/commit/568bc1620d4c872d18e3bb62401d670aa6b30d83))

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
