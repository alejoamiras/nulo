<!-- Use one of: feat:, fix:, refactor:, perf:, docs:, test:, build:, ci:, chore: in the PR title. Subject in lower-case. -->

## What

<!-- One-paragraph summary of what changes and the user-visible effect. -->

## Why

<!-- Link to the motivating issue, plan doc, or incident. Why now? -->

## Test plan

<!-- Checklist of what was verified. -->

- [ ] Unit / component tests added or updated where behavior changed.
- [ ] `bun run audit:vue` (typecheck + tests + lint + build) green locally.
- [ ] For UI changes: smoke e2e (`bun run test:e2e`) green locally — or rely on the `smoke-surface` filter / `e2e:smoke` label to trigger it in CI.
- [ ] For network / dApp / PXE changes: network e2e (`bun run e2e:agent`) green locally — or rely on the `extension-network` filter / `e2e:network` label.
- [ ] Screenshots / screen recordings attached for visible UI changes.
- [ ] No new milestone tags in code comments (see CLAUDE.md).

## Risk + rollback

<!-- What breaks if this goes wrong? How do we revert? -->
