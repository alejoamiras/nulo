# third-party-notices — follow-ups

Decisions, not omissions: each was a true finding of the plan audit that revision 3 declined. The
reasoning is in [`plan.md`](plan.md) § Deliberately not done. Reopen one when its trigger happens.

| Item | Trigger to reopen |
|---|---|
| Itemise what `barretenberg.wasm` and the noir wasm compile in | Upstream publishes an inventory (see `lessons/upstream-issue.md`), or counsel asks for it |
| Reconcile every file of the final zip against a claim | A third-party image, data or asset pack is added to the extension (today `public/` holds a logo and a theme script) |
| Licence files in package subdirectories; prebundled dependencies without a nested manifest | A dependency known to prebundle others is added, or a bump grows the bundle without growing the notices |
| MPL-2.0 handling | The build refuses on an MPL-2.0 package; decide then between a source-location line and replacing the package |
| Notices for `apps/landing` and `apps/tools` | Either app gets a release checklist of its own |
| Dev-server only: a test file created under a dot-directory checkout while `vite dev` runs is routed until restart (`vite-plugin-pages` matches `exclude` without `dot: true`) | It bites someone |
