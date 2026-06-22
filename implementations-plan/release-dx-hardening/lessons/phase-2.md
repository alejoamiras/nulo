# Phase 2 — Cheap config wins

## What shipped
- **`bump-minor-pre-major: true`** on BOTH release-please configs (stable + prerelease). Breaking changes now bump `0.x+1` (0.23→0.24), never 1.0.0. A real 1.0.0 needs an explicit `Release-As` (documented, intended). Commit `9518b524`.
- **Commitlint scoped** (`pr-quick.yml`): on `base==main`, **skipped**; on dev, the full `base..head` range lint stays. Commits `9518b524` (initial) → `7cfa1fe3` (corrected, below).
- **CSP**: dropped the redundant inline `process/global/Buffer` polyfill from `faucet/index.html` + `playground/index.html`. Commit `0f8fc8c9`.
- **CI.md doc-drift**: commitlint description + prerelease ("deferred" → built) corrected. Commit `7cfa1fe3`.

## The smoke caught a self-introduced regression (key lesson)
Codex (Medium) prescribed "lint the merge subject `<title> (#n)` on `base==main`". I shipped that — then a local smoke (`printf '<promote title>' | bunx commitlint`) showed it would **BLOCK every promote PR**: the subject `release: promote dev → main (…) (#n)` fails commitlint TWICE — `release` isn't in the type-enum, and promote titles exceed the 100-char header cap **by design** (they're release-note lines mandated by CLAUDE.md). Codex's premise (the promote subject should be conventional) is wrong for THIS repo's convention.

Corrected to **skip commitlint on `base==main`**: the only main PRs are (a) the freeform promote PR (intentionally non-conventional) and (b) the bot Release PR (`chore(main): release X.Y.Z`, reliably conventional) — so commitlint adds no value there, while the dev squash subjects in the range are already-merged + immutable (re-linting them was the original spurious-failure bug). This is the "skip on main" codex argued against, but it's correct given the convention. Logged here per the override-codex-with-evidence rule.

## Deferred to Phase 4 (test repo) — NOT a block
The **empirical** `bump-minor-pre-major` proof (a `release-please --dry-run` on a synthetic `feat!` history → `0.24.0` not `1.0.0`, plus the two stateful rc fixtures) needs a synthetic breaking-commit history that release-please reads from the *remote* — can't be faked locally (post-0.23.0 there's no breaking commit on the real remote). So it moves to Phase 4's test repo, where seeding synthetic history is cheap. The config change itself is correct per documented semantics (0.x + breaking → minor).

## Gate result — GREEN (locally-validatable parts)
- both configs valid JSON + flag present (`jq`).
- commitlint smoke: a normal subject passes; an over-100 / `release:`-typed subject fails (which is exactly why we skip on main).
- `bun run --cwd packages/faucet build` → exit 0, `dist/index.html` has no inline `<script>` (CSP-clean); removal proven safe by prod (the inline was already CSP-blocked in prod yet the app boots → nodePolyfills covers the globals).
- `bun run lint:actions` → exit 0 (the edited `pr-quick.yml` + embedded shell clean).
- Deferred: the bump-minor empirical dry-run + stateful rc fixtures → Phase 4.
