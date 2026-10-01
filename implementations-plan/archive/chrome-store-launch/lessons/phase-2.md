# Phase 2 — Captures, art, listing, remote-code note, footer links

## What changed

- `apps/extension/tests/e2e/store-captures.test.ts` (opt-in, `STORE_CAPTURES=1`): three 360×600 captures of Home, Send and Settings → Security into `store/captures/`.
- `apps/extension/scripts/store-art.ts` + `store/templates/{tile,frame}.html`: Puppeteer renders `store/promo-440x280.png` and `store/screenshot-{1,2,3}-1280x800.png` (Space Grotesk from `@nulo/design`'s font file, embedded as a data URI; captures embedded the same way).
- `apps/extension/store/listing.md`: shared part (single purpose, long description, data inventory, one justification heading per manifest entry, data handling), Chrome part (fields + Privacy tab answers), Firefox part (fields, the data-collection declaration block, reviewer notes between `<!-- reviewer-notes:start/end -->`).
- `apps/extension/scripts/store-listing.test.ts`: permission coverage for both built-manifest sources, parity with `legal/privacy.md` § 6, the length caps, the privacy URL, declaration equality with the Firefox manifest, the reviewer-notes block, and every `path:line` citation in `remote-code.md` resolving (including `@aztec/<pkg>/src/…` through the isolated linker's store).
- `apps/extension/store/remote-code.md`: what arrives (contract artifacts as data), what executes it (bundled ACVM WASM under `script-src 'self' 'wasm-unsafe-eval'`), what it can reach directly (nothing) and through the oracle (typed node queries to the configured endpoint), what it cannot, when it runs without a click, and the two privacy-policy sentences it bears on.
- `apps/landing/index.html`: footer gains `privacy` and `terms` links (the generated legal pages already had them).
- `legal/README.md` blocker 5 and `BEFORE-LAUNCH.md` § 2: the non-trader declaration (2026-09-21) recorded, with the re-declare trigger; the listing source and the DRAFT-banner precondition named.
- `apps/extension/README.md`, `tests/e2e/README.md`: the new scripts and the opt-in capture file.

## Findings

- `navigateToSettings(page, "security")` from the Send page times out: it clicks the bottom nav's `nav-settings`, which the Send page does not render. `navigateByHash("#/popup/settings/security")` is the route other security tests use; switched.
- The captures show the wallet as a fresh profile with no node reachable (balance skeletons, "NO AVAILABLE TOKENS" on Send, the `ALPHA V5` badge). They are honest screenshots of the shipped build; re-run the capture file against a funded testnet profile before submission if the owner wants populated screens — the pipeline is the same command.
- Chrome category `Tools` and Firefox categories `Privacy & Security; Other` are proposals in `listing.md`; the dashboards' category lists are the authority at submission time.
- The remote-code note cites `@aztec/pxe` 5.2.0 and `@aztec/simulator` 5.2.0 line numbers; a `@aztec/*` bump can move them, and the citation test will red until they are updated (that is the point).

## Validation gate

| Layer | Command | Result |
|---|---|---|
| smoke e2e (opt-in file) | `cd apps/extension && STORE_CAPTURES=1 NULO_E2E_ARTIFACT_RUN=1 EXTENSION_PATH="$PWD/dist/chrome" bun run test:e2e -- tests/e2e/store-captures.test.ts` | 1 passed; `file` reports three 360×600 PNGs |
| art | `bun scripts/store-art.ts` | one 440×280 tile, three 1280×800 frames (`file` confirmed) |
| unit | `bun run test -- scripts/store-listing` | 8 passed |
| lint | `bun run lint` | exit 0 |
| landing | `bun run --cwd apps/landing test` (40 passed) · `bun run --cwd apps/landing build` (exit 0) · `grep -q 'href="/privacy"'` and `grep -q 'href="/terms"'` on `dist/index.html` | both present |
| a look at the PNGs | tile, captures and frame 1 viewed | ring mark + wordmark on charcoal; frames legible |

Phase 2 gate: **pass**.
