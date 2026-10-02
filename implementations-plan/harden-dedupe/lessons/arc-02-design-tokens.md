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
