# Phase 3 — Dedupe + advisory CI check

## The four collapses (all range-forced, reviewed pair-by-pair)

| Package | Collapse | Forced by | Risk review |
|---|---|---|---|
| `@opentelemetry/sdk-metrics` | 1.30.1 → 1.28.0 | `exporter-metrics-otlp-http@0.55.0` pins `1.28.0` EXACT | Target is the version OTel's own exporter ships against; consumer `@aztec/telemetry-client` declares `^1.28.0`. Node-side telemetry chain, not extension-bundled. |
| `@opentelemetry/semantic-conventions` | 1.43.0 → 1.28.0 | `core@1.30.1` pins `1.28.0` EXACT | Pure-constants package; 1.28.0 is the floor every consumer declares (`^1.28.0`, `^1.27.0`). Same node-side chain. |
| `mime-db` | 1.54.0 → 1.52.0 | nested `mime-types` copy at 1.52.0 | Data-file package on dev/server chains; two releases of MIME additions dropped, no code. |
| `string_decoder` | 1.3.0 → 1.1.1 | `readable-stream@2`'s `~1.1.1` | **The bundle-reachable one** (`node-stdlib-browser` → `^1.0.0`, via `vite-plugin-node-polyfills`). `bun pm diff string_decoder@1.1.1 1.3.0`: `lib/string_decoder.js` is UNCHANGED — the whole delta is a deleted `.travis.yml` + package.json metadata (`files` field, safe-buffer `~5.1`→`~5.2`). Code-identical downgrade. |

On-disk verification post-dedupe: `node_modules/string_decoder` = 1.1.1 (single copy); `mime-types`' nested `mime-db` copy gone. `bun dedupe --check` → "No duplicates — checked 1101 packages". Lockfile stayed **v1** even through dedupe's substantive rewrite (further confirms the phase-2 finding).

## Audit triage (plan step 4: triage, never silence)

- `bun audit --audit-level=low`: **41 advisories (23 high / 15 moderate / 3 low) — IDENTICAL count under 1.3.14 and 1.4.0.** The bump and the dedupe introduce zero new findings.
- Every high-severity chain is dev/build/test tooling or the exact-pinned `@aztec` line (hard-limit out of scope this arc): vite>postcss, postcss>nanoid, puppeteer>ws, jsdom>undici, commitlint chains, `@aztec/*>telemetry-client>{systeminformation, propagator-jaeger}`, `@aztec/*>fast-xml-parser`, `>brace-expansion`. None are extension-bundle-reachable (build-time or node-only code).
- One advisory chain is ELIMINATED by this arc: `concurrently > shell-quote` (dep removed in Phase 4).
- Disposition: pre-existing surface, unchanged by the bump; stays visible via the advisory CI audit step; `bun audit fix --dry-run` becomes the documented triage tool (Phase 6 SECURITY.md).

## CI step

`bun dedupe check (advisory)` added to `_lint-and-typecheck.yml` before the audit step: `continue-on-error: true`, named, writes the duplicate set to the step summary — codex's advisory ruling implemented (no consumer of the reusable workflow can red on it).

## Gate

`bun install --frozen-lockfile` no changes · `bun run lint` clean (33 warn/11 info pre-existing) · `bun run lint:actions` exit 0 · `bun run test` 4591 pass / 0 fail (369 files) — all under the 1.4.0 binary.
