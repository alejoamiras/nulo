# Contributing to Nulo

Thanks for thinking about contributing. This document covers what you need to know to make a useful pull request.

## Before you start

- **Read [`ARCHITECTURE.md`](./ARCHITECTURE.md)** for the layer model, process boundaries, and storage versioning.
- **Read [`CLAUDE.md`](./CLAUDE.md)** for the operating rules — layer hierarchy, SFC ordering, cleanup order, comment style. These are enforced via lint rules and CI; following them keeps your PR moving.
- **Check open issues + PRs.** Coordination beats parallel work.

For larger changes, open an issue first describing what and why. Small fixes can go straight to a PR.

## Development

```bash
bun install                   # install + auto-install git hooks
bun run dev                   # chrome extension dev server (port 8088)
bun run build                 # production chrome build
bun run test                  # unit + component tests (vitest)
bun run test:e2e              # smoke e2e (no aztec sandbox)
bun run e2e:agent             # network e2e (owns anvil + aztec + playground per worktree)
bun run audit:vue             # one-shot pre-pr gate: typecheck → test → lint → build
```

Bun is the package manager. Don't use yarn / npm / pnpm.

## Pull request flow

1. Branch off `dev` (not `main`).
2. Make focused commits — one logical change per commit.
3. Subject line: lowercase, [Conventional Commits](https://www.conventionalcommits.org/) format (enforced by commitlint). Examples:
   - `feat(send): show fee breakdown before submit`
   - `fix(passkey): handle missing PRF in Firefox`
   - `refactor(execution): collapse cancel paths into single FSM`
4. Run `bun run audit:vue` locally. CI runs the same gate and won't merge a red PR.
5. For UI changes, run `bun run test:e2e` (smoke) before opening the PR.
6. For dApp / network / PXE changes, run `bun run e2e:agent` (network e2e).
7. Open the PR against `dev`. Fill out the template.

## Code style

- **No emojis** in code or comments unless explicitly requested.
- **Comments explain WHY**, not WHAT. Default to no comment. See `CLAUDE.md` § "Code-comment style".
- **Don't reference milestones / phases / PRs / tasks** in code. That belongs in the PR description.
- **`data-testid` is the only stable e2e selector.** Add a testid before writing a test that needs one.
- **Layer imports**: each package can only import the layers below it (enforced by biome `noRestrictedImports`).
- **No `chrome.*` in `wallet-core`** (banned via biome `noRestrictedGlobals`).
- **No `any`** (`noExplicitAny` is enforced as an error). Use `unknown` and cast at usage sites.

## Reporting security issues

**Do not open a public issue.** See [`SECURITY.md`](./SECURITY.md) for the disclosure process.

## License

By contributing, you agree that your contributions will be licensed under [Apache License 2.0](./LICENSE).
