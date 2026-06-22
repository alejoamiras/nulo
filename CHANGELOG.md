# Changelog

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
