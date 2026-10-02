# Arc A lessons — `@nulo/legal` and the landing pages

## What bit

- **`vite.config.ts` cannot import a raw-TypeScript workspace package.** Vite loads its config under
  the ambient Node with workspace imports externalized, and `@nulo/legal`'s extensionless internal
  imports do not resolve there. The page list is written to `src/generated/legal-pages.json` by
  `scripts/build-legal.ts` and read as data.
- **`vite preview` binds IPv6 only on this host**: pass `--host 127.0.0.1`.
- **The fixed landing header covers the first 100px of a plain page**: `legal.css` pads the top.
- **Generated HTML under `apps/landing/` is scanned by `apps/extension/src/manifest.test.ts`**, which
  refuses any deployable that names the passkey RP host. The privacy policy has to name it. The
  exemption is exact: the landing root, `terms.html` / `privacy.html`, and
  `<doc>/v<version>/index.html`. A config file beside them is still scanned.
- **Bun's markdown renderer passes raw HTML through and percent-encodes odd link characters**
  (`\` → `%5C`, tab → `%09`), so those stay same-site paths. Entities it would decode into an
  authority (`&sol;` → `//host`) are what the origin check refuses.

## Codex fix loop (high), three rounds, hard stop reached

| Round | Verdict | Findings | Disposition |
|---|---|---|---|
| 1 | reject | split-line `<script`, inherited-property records, patch downgrade, reference links and `//host`, placeholder inside attributes, effective-date pin, no landing gating pin | all fixed |
| 2 | conditional-approve | href judged by regex not by resolved URL; record fields read through getters; 400-char tag window; `constructor` as an allowed tag | all fixed |
| 3 | conditional-approve | `history` read outside the fail-closed boundary and through an overridable `slice`; RP-host exemption wider than the generated pages | both fixed, tests added; no HTML-validator defect reproduced |

Round 3's two findings were contained fixes with their own tests, so the loop stops at its cap
rather than being escalated.
