# Phases 4–5 (PR-4 cancel/fee + PR-5 close-out) — lessons

## Retry census (plan PR-2 phase d, run before certification)

Two full ARMED smoke runs with retries enabled + the RetryErrorReporter active:
25 files / 88 tests each, **ZERO retry-passes in both** — no masked flake anywhere in the
smoke suite post-A1. The certification campaign starts from a retry-clean inventory (the
previous campaign discovered the appearance flake only THROUGH certification resets; this
census front-loads that discovery).

## Gate evidence

PR-4: units 4035; pin suites (dapp-interaction 20, windows 126, composable 15, overlay 6);
full armed smoke 25 files (3 chunks); full solo network sweep 65/87 attempt-1 zero retries.
The duplicate-aggregator merge trap hit #364 exactly as documented (empty-commit remedy);
ledgered as the CI follow-up.

## Notable review saves (full table in codex-iteration.md)

The A5 execute-flow exercise was a RACE not coverage (unfunded fixture, fee methods disabled
at zero balance) — dropped for the funded fee-methods path through the shared selector. The
disabled-binding pin was tautological until the enabled→cancelled→disabled recipe; a pin that
passes with its guarded term deleted pins nothing. The window half of refusal parity
(discover/capabilities classification) came from the quality lens after the service half
shipped — parity claims need both ends verified.
