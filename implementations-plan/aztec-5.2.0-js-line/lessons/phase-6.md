# Phase 6 — docs, delivery, and what CI caught

## CI caught what my local gate reported but I misread

`@nulo/resolve-asset`'s own identity tests hardcode the expected `@aztec` version
(`expectVersion: "5.0.1"`, `toBe("5.0.1")`, and a `/5\.0\.1.*9\.9\.9/` throw matcher) — the same
class of literal as `apps/extension/scripts/layout-identity.test.ts`, in a package the pin sweep
never looked at because that sweep was scoped to `apps/extension`.

It failed on my LOCAL `test:all` too. I missed it because I validated with
`rg -c 'Exited with code 0'` and read "12" as success, without comparing against the package
count — two failing packages hid behind twelve passing ones. **A count of successes is not a
pass signal; check the exit code (`rc=$?`) and grep for failures explicitly.** Re-verified
properly afterwards: `rc=0`, 13/13 packages, zero `FAIL`/non-zero exits.

Sweep lesson for the next bump: version literals live in test fixtures across the WHOLE
workspace, not just the app — `rg -l '<old-version>' --glob '!node_modules' --glob '!bun.lock'`
over the repo root, then classify, rather than scoping the grep to one app.
