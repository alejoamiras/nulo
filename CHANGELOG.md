# Changelog

## 0.20.0 (2026-05-21)

### Features

- Full-page onboarding tab + brand-aligned 5-step flow ([#7](https://github.com/alejoamiras/nulo/pull/7))
- Extract BrutalistTitle + 3 helpers; consolidate the onboarding/popup duplication surface ([#8](https://github.com/alejoamiras/nulo/pull/8))

### Bug Fixes

- Toast timer race in `useToast` (rapid second `openToast` no longer cuts the second toast short). Fee-estimation failure now surfaces a toast in send + execute. Header network chip routes directly to Manage Networks (no middle popup); "Set as active network" row inside per-network detail page handles activation. Landing wordmark simplified to plain "NULO". Landing footer cleaned up. Extension icon aligned to the landing's circle identity. ([#9](https://github.com/alejoamiras/nulo/pull/9))
