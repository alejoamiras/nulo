# Phase 4 — Firefox data declaration

## What changed

- `apps/extension/manifest/manifest.firefox.config.ts`: `data_collection_permissions.required` → `["financialAndPaymentInfo"]`; the "not a settled classification" comment replaced by one sentence saying what the declaration covers and why the other categories are out.
- `apps/extension/src/manifest.test.ts`: the pin and its comment updated ("declares financial and payment information, and nothing else").
- `apps/extension/store/listing.md` § Data collection declaration: the value, the assessment of every other category against outbound flows, and the one contestable reading (the passkey label, `wallet/utils/passkey-label.ts:51-53`, `legal/privacy.md` § 5.4).
- `legal/README.md` and `BEFORE-LAUNCH.md`: the Firefox items are settled and point at the listing for the reasoning.

## Findings

- **The install prompt renders the declaration verbatim** (screenshot: `phase-4-install-prompt.png`, Firefox Developer Edition 157.0b4): "Required data collection: The developer says this extension collects: financial and payment information". With `["none"]` the same prompt said "doesn't require data collection" (trial run before the change).
- Procedure that works without a display: Firefox Developer Edition (stable refuses unsigned add-ons whatever `xpinstall.signatures.required` says) on a throwaway profile with `xpinstall.signatures.required=false`, launched under `Xvfb` with the `.xpi` as its argument (opening an xpi from the command line raises the install prompt, exactly like Install Add-on From File), one frame grabbed with `ffmpeg -f x11grab`. Script: session-local `.playwright-mcp/ff-install-shot.sh` (not committed; the recipe is this paragraph).
- The build's `MOZ_DISABLE_CONTENT_SANDBOX=1` banner in the screenshot is the host's user-namespace restriction, unrelated to the add-on.

## Validation gate

| Layer | Command | Result |
|---|---|---|
| unit | `bun run --cwd apps/extension test -- src/manifest scripts/store-listing` | 2 files, 19 tests passed |
| lint | `bun run lint` | exit 0 |
| build | `bun run --cwd apps/extension build:firefox` | exit 0; built manifest `{"required":["financialAndPaymentInfo"]}` |
| add-on linter | `bunx web-ext@10.6.0 lint --source-dir apps/extension/dist/firefox --self-hosted` | errors 0, notices 0, warnings 10 (unchanged set) |
| manual browser check | Dev Edition 157.0b4, throwaway profile, xpi of `dist/firefox` | the data-consent line is shown in the real install prompt (`phase-4-install-prompt.png`) |

Phase 4 gate: **pass**.
