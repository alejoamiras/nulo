# Upstream status — vitest `interopDefault` collapses ESM namespaces under Bun

**Already fixed upstream — do NOT file.** Verified 2026-08-24 (codex round-1 finding, checked against GitHub):

- vitest issue [#10359](https://github.com/vitest-dev/vitest/issues/10359) "Bun runner makes `import { z } from zod` undefined" — opened 2026-05-15, closed. Same symptom as ours (`TypeError: undefined is not an object (evaluating 'z.object')` through a symlinked workspace package under `bun --bun vitest`).
- Fixed by PR [#10363](https://github.com/vitest-dev/vitest/pull/10363) "fix: apply cjs interop for truthy `__esModule`" (merged 2026-05-18): `interopModule` now tests `m?.__esModule` truthiness instead of `"__esModule" in m` — exactly the mechanism our probes isolated (Bun's namespace objects answer `in` with `true` while the value is `undefined`; the transpiler convention is an own property `=== true`).
- Shipped in **vitest 5.0.0-beta.3**; NOT in the 4.x line we lock (`vitest@4.1.10`, `bun.lock:2243`).

## What this means for Arc C

- `test.deps.interopDefault: false` (the plan's countermeasure) is a **stopgap**, not the fix. It removes vitest's CJS-default interop entirely; native ESM/CJS semantics on both runtimes; verified test-set-identical on 4,635 tests under Node. It stays until the repo is on a vitest that contains #10363.
- **Retirement trigger** (recorded next to the setting in `vitest.base.ts`): when `vitest` resolves to ≥ 5.0.0 (or a 4.x release that backports #10363), delete the setting and re-run the Bun soak matrix.
- **Owner choice (A4, replaces "file the issue")**: (a) comment on #10359 requesting a 4.x backport, or (b) wait for vitest 5 stable and retire the stopgap then. A vitest 5 beta bump is NOT this arc (prerelease across 11 workspaces; 7-day gate; its own review).

## Our reproducer (kept for the retirement check — 5 files, no dependencies)

`package.json` `{ "name": "repro", "private": true, "type": "module" }` · `node_modules/ns-default-lib/package.json` `{ "name": "ns-default-lib", "version": "1.0.0", "type": "module", "main": "./index.js" }` · `impl.js` `export const object = () => "object"; export const string = () => "string"` · `index.js`:

```js
import * as impl from "./impl.js"
export * from "./impl.js"
export { impl as z }
export default impl
```

`interop.repro.test.ts`:

```ts
import { expect, test } from "vitest"
import { z } from "ns-default-lib"
test("named export that is a module namespace survives externalized import", () => {
	expect(typeof z).toBe("object")
})
```

vitest 4.1.10: Node passes; Bun 1.4.0 fails with `typeof z = undefined` (namespace keys `object,string`; `"__esModule" in ns.default === true`). Expected to pass on both once #10363 is in the installed vitest — that is the retirement check.
