# Arc 2, design-tokens: lessons log

## Build

- Proof: the old `base.css` under the old resolution against the new one under the new resolution. For an unthemed, dark and light root that is 40, 50 and 50 tokens with 0 mismatches. It was rerun after each parser change.
- Local gates green: `audit:vue`, `test:all`, `test:ci-gating`.

## Codex loop

- **Plan audit:** REVISE, four findings, all adopted (see the batch plan's Decisions).
- **Code round 1:** NOT CONVERGED, three should-fix findings, all adopted.
  1. **The drift test missed a token one root lacks, and two roots that resolve one token through different variables.** It now resolves every contract token on both roots, requires presence, and has both divergences as regression cases.
  2. **The parser read a `:root` nested in an at-rule as unconditional, and split at commas inside an attribute selector.** A nested token rule now throws, and splitting happens only at bracket depth 0. A first cut tracked quotes too and scored 18 cognitive complexity; selectors keep their quoted values inside brackets, so bracket depth alone is enough.
  3. **The hash comment claimed screenshots that had not run for this diff, and named the workflow.** The slug is gone. The claim stands only once the base-against-head comparison, which includes onboarding Presto, comes back identical; it is logged below.
- **Code round 2:** NOT CONVERGED, two should-fix findings.
  1. **Rejected: quoted brackets, commas or semicolons inside a selector misparse.** The helper reads only the hand-written `base.css`, which has no such selector, so hardening it is churn the no-over-engineering rule excludes. The comment now states that limit instead.
  2. **Adopted: a non-color token aliasing a theme-only variable compared equal as raw strings.** Non-color tokens now resolve their `var()` chain, and the width case is a regression test.
- **Code round 3:** NOT CONVERGED, one should-fix finding, adopted. **A nested `var()` fallback came back as an unresolved string, so a dark-only variable inside it went unseen.** The resolver now follows fallbacks too and returns undefined once it is past the depth limit. The nested case is a regression test.
- **Code round 4:** CONVERGED, no findings.

## Screenshots

- Base 382f822b against head 1e94a9ea, Chrome and Firefox, dark and light: 40 of 40 identical. The surfaces are Home, Settings, Change password, Reset, the Receive popup over its scrim, onboarding Presto (whose banner carries its own `theme` attribute) and the landing. The two builds' CSS hashes differ, so the run compared changed CSS. A same-SHA stability run on 179777e5 was also 40 of 40. The later commits change tests and docs only.
- Harness fix: Firefox first showed a 333 px diff from an icon animating inside the banner's shadow root. The freeze CSS now reaches every open shadow root, and running animations are stopped before each shot.
- Round 2 broke `typecheck:all`: `drifted` was inferred from the value-token union, so pushing a colour name failed. Rounds 2 and 3 were gated on the package tests and lint only, so the full `audit:vue` caught it after the restack. Each round now runs `typecheck:all` too.

## Merge gate

- At head 585dda2a, every job in the five required workflows passed, none skipped: Quality, plus smoke, the five network shards, both heavy jobs and the real-proving canary on Chrome and on Firefox. Squash-merged as #762; its tree equals the arc head.
