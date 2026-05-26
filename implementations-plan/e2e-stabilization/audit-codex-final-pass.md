approve with changes

The consolidated shape is broadly right: keep the order `1 -> 2 -> 3`, keep wallet-service code out of scope, and keep the Phase 3A probe before any warm-up implementation. I would approve after the changes below.

## Required Changes Before Approval

### 1. Fix Phase 2’s capability assumption; it is currently wrong

The plan currently treats `register-token` as if it were reusing the already-covered `basic` bundle path:

- [plan.md](./plan.md:22) says Phase 2 is “one spec per flow, sharing a pre-grant fixture”.
- [plan.md](./plan.md:76) through [plan.md](./plan.md:87) cites `cap-request-basic` logic as the comparison point.
- [plan.md](./plan.md:295) through [plan.md](./plan.md:297) says the pre-grant fixture must scope to the `accounts` cap, but that conflicts with the “basic bundle” framing above.

The repo says otherwise:

- `registerToken` requires the `accounts` capability, not `basic`: [capability-map.ts](../../packages/wallet-bridge/src/capability-map.ts:20), [dispatcher.test.ts](../../packages/wallet-bridge/src/dispatcher.test.ts:683), [wallet-bridge README](../../packages/wallet-bridge/README.md:221).
- The playground’s `basic` bundle does **not** include `accounts`; the `accounts` bundle does: [bundles.ts](../../packages/playground/src/lib/bundles.ts:51), [bundles.ts](../../packages/playground/src/lib/bundles.ts:63).
- The current `register-token.test.ts` comment is simply wrong on this point: [register-token.test.ts](../../packages/extension/tests/e2e/network/register-token.test.ts:42).
- We already have direct `accounts`-grant coverage in [cap-request-accounts.test.ts](../../packages/extension/tests/e2e/network/cap-request-accounts.test.ts:10).

Implication: the new `register-token-cap-grant.test.ts` proposed at [plan.md](./plan.md:87) and [plan.md](./plan.md:374) is probably redundant and may be counterproductive, because it adds another cap-popup-driven file to the shard set while `cap-request-accounts.test.ts` already covers the account-selector path.

My recommendation:

- Change Phase 2 to pre-grant the `accounts` bundle, not `basic`.
- Drop the claim that `cap-request-basic` is the relevant existing coverage; if you want a coverage reference, it is `cap-request-accounts.test.ts`.
- Prefer the smaller codex shape here: keep `register-token.test.ts` as the only spec, move the cap-grant into a file-scoped fixture/helper, and do **not** add `register-token-cap-grant.test.ts` unless you can name a registerToken-specific account-grant behavior that `cap-request-accounts.test.ts` does not already cover.

### 2. Fix the provenance on discover; codex and opus were not identical here

[plan.md](./plan.md:108) says the discover `isReady` pattern “matches both” audits. That overstates alignment.

My actual position was:

- gate **Allow** on real readiness,
- keep **Deny** fast on `!requestId` because early reject is harmless.

Opus wanted both buttons gated on readiness. The current chosen implementation at [plan.md](./plan.md:59) through [plan.md](./plan.md:63) is closer to my view, so the plan should say that explicitly:

- mechanism agreed by both,
- button-level choice was a decision, not identical source guidance.

This is a wording fix, but provenance tables are the first place people misread intent later.

### 3. Fix the local commands; several are currently wrong

The plan repeatedly does `cd packages/extension` and then runs root-level scripts:

- [plan.md](./plan.md:133) through [plan.md](./plan.md:146)
- [plan.md](./plan.md:202) through [plan.md](./plan.md:208)
- [plan.md](./plan.md:226) through [plan.md](./plan.md:231)

But `e2e:agent` and `audit:vue` are defined in the repo-root [package.json](../../package.json:18), [package.json](../../package.json:21), [package.json](../../package.json:30), not in [packages/extension/package.json](../../packages/extension/package.json:8).

So:

- `bun run e2e:agent` from `packages/extension` will fail.
- `bun run audit:vue` from `packages/extension` will fail.

Fix the commands in §5 so they are consistent:

- either run them from repo root,
- or, if you want to stay in `packages/extension`, call the direct equivalents (`bash scripts/e2e/agent.sh`, package-local `vitest`, package-local `typecheck/lint/build`).

The hot-rerun command in [plan.md](./plan.md:153) through [plan.md](./plan.md:166) is fine from `packages/extension`; the root-script commands are the broken ones.

### 4. Tighten Phase 3A and the Phase 3 touch list

I agree with keeping the probe. I do **not** agree with its current definition at [plan.md](./plan.md:212) through [plan.md](./plan.md:223).

The real decision is not “does the SW survive close?” in the abstract. The real decision is:

- does a throwaway-browser warm-up in `global-setup.ts`
- materially reduce first real `capabilities` popup latency
- in a **second fresh browser**
- on the same shard host?

So the probe should measure the actual path we care about: first-cap-popup and first-`cap-account-item` latency in browser B, with and without a warm-up in browser A. A pure “open SW / close / reopen / measure bb.js init” probe is too indirect and can give a false positive.

Related missing implementation risk: if Phase 3 chooses the `global-setup.ts` path, the plan must acknowledge that current `launchExtension()` is not callable there because it depends on `inject("extensionPath")` at [extension.ts](../../packages/extension/tests/e2e/fixtures/extension.ts:16). That likely forces one of:

- extracting a non-Vitest `launchExtensionWithPath(extensionPath)` helper, or
- duplicating the launch/bootstrap logic in `global-setup.ts`.

That extraction/duplication is currently missing from [plan.md](./plan.md:376) through [plan.md](./plan.md:380) and from the estimate. Also, if you duplicate the launch path, preserve the existing onboarding bypass and test-mode behavior from [extension.ts](../../packages/extension/tests/e2e/fixtures/extension.ts:82) and [playground.ts](../../packages/extension/tests/e2e/fixtures/playground.ts:23).

### 5. Rework the CI acceptance wording so it is operational

[plan.md](./plan.md:323) says to run `gh workflow run pr-network-e2e.yml --ref dev` 5 times in a row “without code re-pushes” and with the “same HEAD SHA every time”.

That is not operational on a busy repo:

- `--ref dev` points at a moving branch,
- “same HEAD SHA every time” conflicts with that if `dev` advances between runs.

Change this to one of:

- dispatch 5 times on a temporary branch pinned to the target commit, or
- dispatch on the PR branch / stabilization branch that will not move during the measurement window.

The intent is right; the current wording is not enforceable.

## What I Would Keep

- Keep the overall ordering `1 -> 2 -> 3`. That was my recommendation and I still think it is the right call. Phase 1 is the only production-facing trust bug; there is no good reason to defer it behind test restructuring.
- Keep Phase 3A as a gate before implementation. That is not padding. It is the right place to spend 1 hour instead of 1-2 wasted days on the wrong warm-up location.
- Keep wallet-service changes out of scope. None of the three target problems require touching `src/wallet/services/**`.

## Estimate

The current `~20h` / `2-3 days` estimate is reasonable **if** Phase 2 stays small and Phase 3 does not require much helper extraction.

If you keep the current global-setup preference and have to extract a non-Vitest launcher, add roughly half a day. I would phrase the estimate as:

- `~20h realistic`,
- `~24h if Phase 3 chooses global-setup and needs helper extraction`.

## Bottom line

The plan is close. The main thing I would not approve as written is Phase 2’s current account/bundle model and the redundant new spec. Fix that, fix the broken local commands, sharpen the Phase 3A probe, and pin the acceptance runs to a non-moving ref.
