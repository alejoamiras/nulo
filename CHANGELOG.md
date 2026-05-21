# Changelog

## [0.20.1](https://github.com/alejoamiras/nulo/compare/v0.20.0...v0.20.1) (2026-05-21)


### Bug Fixes

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
