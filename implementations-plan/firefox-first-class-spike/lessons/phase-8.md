# Phase 8 — docs and skills

## What changed

- **New: `apps/extension/tests/e2e/FIREFOX.md`** — the owner asked for the Firefox-specific lessons in one place. It states the one rule (a browser difference lives on `BrowserDriver`), how the geckodriver + BiDi hybrid works and what a Puppeteer bump can break, a table of every Firefox behaviour that differs with its symptom and where it is absorbed, how launches are owned and torn down, a debugging order, and the CI lanes. The lessons files stay the chronological record; this is the reference a future change reads first.
- `CLAUDE.md`: pointer to `FIREFOX.md`; a local-gates row for Firefox; the two advisory aggregators in the CI list; three staged-rollout rows (release smoke → `attach-assets.needs` after one clean release; PR smoke → required after 14 green nightlies; PR network → required after 30) and the owner's post-merge checklist.
- `CI.md`: a section for the two Firefox PR workflows and the nightly/release jobs; the labels table says they drive both browsers; the stale "`gecko.id` placeholder" note is gone (the id is final and pinned by `manifest.test.ts`).
- `.github/README.md`: the two workflows in the status matrix, the reusable workflows' callers (including the soak, which the old table omitted), `setup-geckodriver`.
- `SECURITY.md` "Binary dependencies": the geckodriver pins and why they live in the action, Firefox's provenance (the revision the locked Puppeteer pins, over HTTPS, not hash-pinned — the same trust as the Chrome the required lanes download), and the **trusted-co-tenant statement** for `--allow-system-access`.
- `tests/e2e/README.md`: both suites run on either browser; one run drives one browser.
- `e2e-testing` skill: a "Two browsers" section — the rule, the helpers that hide a Firefox failure mode, what a Chrome-only file means, the 3-second name scan, the first thing to read on a Firefox-only red.
- `chrome-extension-debug` skill: the claim that only the onboarding tab is reachable ("no such frame") is replaced by the hybrid that reaches every window, and by the two placement facts (new tabs land in the minimized PXE window; WebAuthn wants the focused one).

## Gate

`bun run lint` exit 0; `bash scripts/check-no-brand.sh` exit 0. Spot check of paths named in new text, all present: `apps/extension/tests/e2e/FIREFOX.md`, `apps/extension/tests/e2e/fixtures/browser/{index,firefox,bidi-attach,ownership}.ts`, `apps/extension/scripts/e2e/{browser-seam,unresolved-names}.test.ts`, `apps/extension/tests/e2e/network/session-tabNavigate.test.ts`, `.github/actions/setup-geckodriver/action.yml`, `scripts/ci-cd/{behavior-gating,decide-gate}.test.ts`, `scripts/ci-cd/required-checks.sh`. Commands named: `NULO_E2E_BROWSER=firefox bun run test:e2e` and `… bun run e2e:agent` (both run in Phases 5–6), `bun x puppeteer browsers install firefox` (run; resolves `firefox@stable_153.0.4`).
