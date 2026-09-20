# @nulo/legal

The machine-readable side of [`legal/`](../../legal/README.md): which versions of the Terms and the
Privacy Policy exist, which of them are **material**, what changed in each, and whether a stored
acceptance is still current. No runtime dependencies, no `chrome.*`.

| File | Purpose |
|---|---|
| `src/manifest.ts` | Hand-written version lists, the four risk points, the control labels Terms § 3 names |
| `src/status.ts` | `acceptanceStatus`, `pendingTermsVersions`, `applyAcceptance`, `parseAcceptanceRecord`, `permalink` |
| `src/document.ts` | Reads the `**Version X — effective Y**` line and the version-history table out of the markdown |

## Invariants (all tested)

- Versions strictly increase. **A material version always bumps minor or major**, which is what lets
  status compare `major.minor` without ever swallowing a material patch.
- Status derives from the **Terms only**. The privacy version is recorded as *shown*.
- The manifest head equals the document's version line; the document's history table lists exactly
  the manifest's versions; every superseded version has a copy in `legal/archive/`.
- A stored record is untrusted input: anything malformed is "missing".

## Shipping a new version

1. Copy the current `legal/<doc>.md` to `legal/archive/<doc>-<version>.md`.
2. Edit the document: version line, text, a new history row.
3. Append the version to `LEGAL_MANIFEST` — `material: true` plus hand-written `changes` if users must
   re-accept. The tests fail until all three agree.
