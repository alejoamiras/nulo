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

## Final cross-arc pass — codex (GPT-6 Astra, `high`, fresh session) — converged in four rounds

A reviewer that had seen none of the arcs read the whole diff. It found no Chrome or product regression and nothing skipped on Firefox beyond the ten files; what it found was in the Firefox driver's ownership story, which no single arc's review had read end to end.

- **Round 1 → request changes, six findings, all verified and taken.** (1) [Medium] Ports are released just before geckodriver spawns; if another launch wins one, our geckodriver exits and `/status` is answered by *theirs*, so the launch opened a session on a foreign driver. `WebDriverSession.open` now takes the child's liveness and fails by name. (2) [Medium] `bun run e2e:reap` knew nothing about Firefox launches — they waited for the next Firefox launch on the host. It now runs the ownership sweep. (3) [Medium] The driver ran the *newest* Firefox in Puppeteer's cache, which every checkout on the host shares, so another worktree's install changed this one's browser. It now runs the locked Puppeteer's revision. `PUPPETEER_REVISIONS` is exported at runtime but missing from the typings — the unresolved-names scan caught the named import — so it is read through a namespace import that throws by name if an upgrade moves it. (4) [Medium] The `/proc`-based ownership tests run in the ordinary unit suite and would fail a Chrome-only developer on macOS; they skip off Linux, and `FIREFOX.md` says the Firefox driver is Linux-only. (5) [Low] Probe-era leftovers: four unused classic-client methods and a write-only map. (6) [Low] Two stale comments.
- **Round 2 → one [Medium].** The refused session's `close()` error was swallowed, after which teardown deleted the profile — but in the collision case that Firefox carries the *other* launch's marker, invisible to this launch's process scan. `abandonSession` now disowns the profile when the session cannot be ended, and says so in the error.
- **Round 3 → one [Medium].** The disownership was in memory only; a run dying before its own cleanup left a record on disk that still authorised the deletion. `disownProfile` rewrites the record, and a test sweeps a disowned orphan and finds its profile intact.
- **Round 4 → "no new material findings. The persistence fix closes the reported gap. Confidence: high for this fix."** (Two displaced comments moved back.)

Four rounds is one past the usual stop. Rounds 2 and 3 were each a one-function consequence of the round-1 fix rather than new ground, so the loop was narrowing, not wandering; it is recorded here so the owner can judge that call.

Validation after the fixes: `vitest run scripts/e2e` 77 passed; `bun run lint` exit 0; the full Firefox smoke suite on the new launch path exit 0 (113 passed, 16 skipped), no leftover processes.

**A note on SHAs in these logs.** The stack was rebased onto `dev` once more before the PRs opened, so commit hashes quoted in the phase logs name commits that no longer exist under those ids. The CI run links are the durable evidence; the PRs carry the final commits.

