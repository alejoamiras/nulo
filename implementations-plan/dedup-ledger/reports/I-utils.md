## Cluster verdict

This cluster is unusually disciplined for LLM-authored code: almost every file in `utils/`, `core/`, `offscreen/`, `shims/`, `content-script/` carries load-bearing invariant comments (races closed, security boundaries, audit references) rather than restating the code, and the complexity-budget regime has clearly already forced several files into tight, well-tested shapes. There is very little cross-package duplication against `packages/wallet-core/src/utils` and `packages/wallet-crypto/src` — the base64/hex/sleep/json-stringify helpers there are NOT re-implemented here; where the extension has its own float-based amount formatters (`comma`, `purgeNumber`, `normalizeAmount` in `utils/amount.ts`) they solve a genuinely different problem (live-typed-input display) from the bigint formatters in the same file, so that's an inconsistency worth flagging but not cheaply fixable. The single biggest lever is real, mechanical duplication inside `e2e/`: three chrome.storage.session "presence gate" classes (proof/restore/incoming-poll) each hand-roll an identical ~30-line blocking-Promise-with-safety-timeout, which a small shared helper collapses cleanly. A second, smaller lever is three parallel switches over the same `CompressionFormat` discriminant in `utils/files.ts`. Total realistically removable: roughly 90–110 lines, concentrated in two findings.

## Findings

### F1 [duplication] Three e2e chrome.storage.session gates re-implement the same blocking-promise protocol

- **Where:**
  - `apps/extension/src/e2e/chrome-storage-proof-gate.ts:46-88` (`ChromeStorageProofGate.wait`)
  - `apps/extension/src/e2e/chrome-storage-restore-gate.ts:38-79` (`ChromeStorageRestoreGate.waitAt`)
  - `apps/extension/src/e2e/chrome-storage-incoming-poll-gate.ts:83-115` (`ChromeStorageIncomingPollGate.blockUntilReleased`)

- **Evidence:** all three build the identical `settled`/`finish`/`onChange`/`timer` shape around a presence-keyed `chrome.storage.session` value:

  ```ts
  // chrome-storage-proof-gate.ts:49-81
  await new Promise<void>((resolve) => {
      let settled = false
      const finish = (reason: "released" | "timeout"): void => {
          if (settled) return
          settled = true
          chrome.storage.onChanged.removeListener(onChange)
          clearTimeout(timer)
          if (reason === "timeout") { console.warn(...) }
          chrome.storage.session.remove(PROOF_GATE_KEY).catch(() => {})
          resolve()
      }
      const onChange = (changes, area) => {
          if (area === "session" && PROOF_GATE_KEY in changes && changes[PROOF_GATE_KEY].newValue === undefined) finish("released")
      }
      const timer = setTimeout(() => finish("timeout"), SAFETY_TIMEOUT_MS)
      chrome.storage.onChanged.addListener(onChange)
      this.isHeld().then((stillHeld) => { if (!stillHeld) finish("released") })
  })
  ```

  ```ts
  // chrome-storage-restore-gate.ts:47-78 — same shape, different key + no auto-remove
  await new Promise<void>((resolve) => {
      let settled = false
      const finish = (reason: "released" | "timeout"): void => { /* identical structure */ }
      const onChange = (changes, area) => {
          if (area === "session" && RESTORE_GATE_KEY in changes && changes[RESTORE_GATE_KEY].newValue === undefined) finish("released")
      }
      const timer = setTimeout(() => finish("timeout"), SAFETY_TIMEOUT_MS)
      chrome.storage.onChanged.addListener(onChange)
      this.read().then((still) => { if (still?.at !== at) finish("released") })
  })
  ```

  ```ts
  // chrome-storage-incoming-poll-gate.ts:84-114 — same shape again, third key
  await new Promise<void>((resolve) => {
      let settled = false
      const finish = (reason) => { /* identical structure, no auto-remove */ }
      const onChange = (changes, area) => {
          if (area === "session" && INCOMING_POLL_HOLD_KEY in changes && changes[INCOMING_POLL_HOLD_KEY].newValue === undefined) finish("released")
      }
      const timer = setTimeout(() => finish("timeout"), SAFETY_TIMEOUT_MS)
      chrome.storage.onChanged.addListener(onChange)
      chrome.storage.session.get(INCOMING_POLL_HOLD_KEY).then((rec) => { if (rec[INCOMING_POLL_HOLD_KEY] === undefined) finish("released") })
  })
  ```

  The three differ only in: the key name, whether `finish` also removes the key, and how "still held" is probed (`this.isHeld()` / `this.read()` / a raw `get`).

- **Refactor:** extract one shared helper, e.g. `apps/extension/src/e2e/chrome-storage-wait.ts`, exporting `waitForStorageRelease({ key, isReleased, safetyTimeoutMs, onTimeout, onSettle? })` that owns the `settled`/`finish`/`onChange`/`timer`/re-check-after-subscribe logic verbatim (this is genuinely the SAME race-closing protocol, not a coincidental look-alike — same comment "closes the release-between-check-and-subscribe race" appears in all three files). Each gate keeps its own key constant, its own `isHeld`/`read` probe, and passes its own `onTimeout` warn string and (for the proof gate only) an `onSettle` callback that removes the key. This is `e2e/`-scoped only — do **not** fold in `utils/storage.ts`'s structurally similar `migrationIdle` (see "Not worth it": deliberately no timeout, reject-on-error, different area — a different contract that shouldn't be coupled to e2e-only code).
- **LOC delta:** −45 (≈25-line shared helper added; ≈35 lines removed from each of 3 call sites, replaced by ≈10-line calls).
- **Risk / tests:** low for the proof gate (directly covered by `apps/extension/src/e2e/chrome-storage-proof-gate.test.ts`, which asserts both the event-driven release and the timeout warn path). Med for the other two — no dedicated unit test; behavior is exercised indirectly by `apps/extension/tests/e2e/network/backup-restore-sw-restart.test.ts` (restore gate) and `apps/extension/tests/e2e/network/account-switch-isolation.test.ts` (incoming-poll gate), both of which would fail on a broken release/timeout path but run only in the network e2e suite.
- **Confidence:** high.

### F2 [duplication] Three parallel switches over the same `CompressionFormat` discriminant

- **Where:** `apps/extension/src/utils/files.ts:196-210` (`getCompressedFilename`), `:212-222` (`getCompressedMimeType`), `:224-242` (`getCompressionFormat`).
- **Evidence:**
  ```ts
  function getCompressedFilename(originalFilename: string, compressionFormat: CompressionFormat): string {
      ...
      switch (compressionFormat) {
          case "gzip": return `${baseName}.gz`
          case "deflate": return `${baseName}.zz`
          case "deflate-raw": return `${baseName}.df`
          default: return `${originalFilename}.compressed`
      }
  }
  function getCompressedMimeType(compressionFormat: CompressionFormat): string {
      switch (compressionFormat) {
          case "gzip": return "application/gzip"
          case "deflate":
          case "deflate-raw": return "application/octet-stream"
          default: return "application/octet-stream"
      }
  }
  function getCompressionFormat(filename?: string): CompressionFormat | null {
      ...
      switch (extension) {
          case ".gz": case ".gzip": return "gzip"
          case ".zz": case ".deflate": return "deflate"
          case ".df": case ".raw": return "deflate-raw"
          default: return null
      }
  }
  ```
  All three branch on the same 3-way `CompressionFormat` domain (`gzip`/`deflate`/`deflate-raw`).
- **Refactor:** one `Record<CompressionFormat, { ext: string; mime: string; aliases: string[] }>` table in `utils/files.ts` (e.g. `gzip: { ext: ".gz", mime: "application/gzip", aliases: [".gz", ".gzip"] }`); `getCompressedFilename`/`getCompressedMimeType` become direct property lookups, and `getCompressionFormat` becomes one loop/`.find()` over the table's `aliases`. Stays local to `utils/files.ts` (L0 pure helper, no layer change).
- **LOC delta:** −20.
- **Risk / tests:** low — pure lookup-table rewrite, same outputs for the same inputs; `utils/files.test.ts` exercises `compressData`/`pickFile` on the `"gzip"` path (indirect coverage for that branch; `deflate`/`deflate-raw` aren't directly asserted today, so verify those two manually against the table).
- **Confidence:** high.

### F3 [dead-code] Stale, contradictory doc comment above `normalizeAllIds`

- **Where:** `apps/extension/src/utils/full-backup-helpers.ts:380-391` (dead block), immediately followed by the correct block at `:392-397` and the function at `:398`.
- **Evidence:**
  ```ts
  /**
   * Rewrite `*.{idKey}` references inside `backup.data` to `newId`, after
   * profile/network restore returns a different id than the source backup.
   *
   * `oldId` SCOPES the rewrite: only rows whose `idKey` currently equals `oldId`
   * are rewritten (required when a key is multi-valued across the backup — ...
   * Omit `oldId` for a single-valued key (`profileId` ...
   */
  /**
   * Rewrite EVERY row's `idKey` to `newId`, ignoring its current value. For a
   * single-valued key like `profileId`: ...
   */
  export function normalizeAllIds(data: Record<string, unknown>, idKey: string, newId: string): void {
  ```
  The first block describes an `oldId` parameter and a scoped-rewrite mode that `normalizeAllIds` does not have (it takes exactly `data, idKey, newId` and always rewrites every row — that's what the second, correct block says). This looks like a leftover doc from a prior version of the function (or from `remapByMap`, which is the one that actually does scoped/per-id rewriting) that was never deleted when the signature changed.
- **Refactor:** delete lines 380-391; keep the accurate block at 392-397.
- **LOC delta:** −12.
- **Risk / tests:** none (comment-only deletion). No test depends on doc text.
- **Confidence:** high.

### F4 [dead-code] `refreshBalances`'s first parameter is unused and misleading

- **Where:** `apps/extension/src/utils/core.ts:142` (signature), `:152-157` (`checkAge`), `:165` (call site hardcodes `30`); called with `10` from `apps/extension/src/popup/pages/auth.vue:191`.
- **Evidence:**
  ```ts
  export async function refreshBalances(_minutes: number | undefined, accounts: Array<{ address: string }>): Promise<void> {
      ...
      function checkAge(updatedAt: number, minutes?: number): boolean {
          if (!minutes) return true
          const now = Date.now()
          const diff = now - updatedAt
          return diff >= minutes * 60 * 1_000
      }
      ...
      for (const tb of tokenBalances) {
          if (checkAge(tb.updatedAt, 30)) refreshes.push(tokenBalanceService.refreshTokenBalance(tb.id as number))
      }
  ```
  The exported `_minutes` parameter (already prefixed to mark it unused) is never read; the staleness threshold is hardcoded to `30` regardless of what the caller passes. `auth.vue:191` calls `refreshBalances(10, appStore.accounts)`, and `core.test.ts` asserts staleness against a 31-minute-old timestamp (`STALE = () => Date.now() - 31 * 60_000`), confirming the real threshold is 30, not whatever the caller supplies.
- **Refactor:** drop the first parameter from `refreshBalances` and `checkAge`'s `minutes` argument (inline `30 * 60_000` at the one comparison site, or keep a `STALE_MINUTES = 30` const); update the `auth.vue` call site to drop the now-removed argument.
- **LOC delta:** −4.
- **Risk / tests:** low; `apps/extension/src/utils/core.test.ts` (the `refreshBalances` describe block) covers the staleness behavior and would need its call-site signature updated in the same change.
- **Confidence:** high.

### F5 [duplication] Repeated Storybook `meta`/`Story` boilerplate across `design/*.stories.ts`

- **Where:** `apps/extension/src/design/Colors.stories.ts:11-20`, `Layout.stories.ts:11-20`, `Motion.stories.ts:10-19`, `Typography.stories.ts:10-19`.
- **Evidence:** each file opens with the byte-identical shape (only the title string varies):
  ```ts
  const meta: Meta = {
      title: "Design / Colors",
      tags: ["autodocs"],
      parameters: { layout: "fullscreen" },
  }
  export default meta
  type Story = StoryObj
  ```
- **Refactor:** a one-line helper in a new `design/story-meta.ts`: `export const designStoryMeta = (title: string): Meta => ({ title, tags: ["autodocs"], parameters: { layout: "fullscreen" } })`; each file becomes `export default designStoryMeta("Design / Colors")` (keep the local `type Story = StoryObj` alias since it's a type-only one-liner, not worth threading through).
- **LOC delta:** −16 (a ~5-line helper added; ~7 lines saved per file × 4 files, minus the added import line per file).
- **Risk / tests:** none — Storybook-only dev tooling, not built into the extension bundle, no runtime test coverage needed or expected.
- **Confidence:** med (small enough that a reviewer could reasonably call this not worth touching).

## Not worth it

- `utils/amount.ts`'s `comma`/`purgeNumber`/`normalizeAmount` (float-based, used only by `AmountCard.vue`) vs. the file's bigint `formatBaseUnits`/`parseAmountToBaseUnits` family: two genuinely different formatting philosophies coexist in one file, but `comma` operates on live-typed decimal strings pre-parse while the bigint helpers operate post-parse on base units — merging them would change float-precision behavior on a money-input path, which is out of scope for a lint-level refactor.
- `utils/storage.ts`'s `migrationIdle` has the same "wait for a storage key to clear, closing the check-then-subscribe race" shape as the three e2e gates (F1), but it deliberately has **no** safety timeout ("proceeding while a migration is mid-flight is the corruption we're preventing") and rejects on read error instead of timing out — folding it into the e2e-only helper would either weaken that contract or force an awkward superset API onto test-only code; left alone.
- `utils/journal-state.ts` has three switches over `JobErrorKind` (`humanizeErrorKind`, `categoricalLabel`, `failedSubtitleFor`) that look like the "parallel switches over the same discriminant" smell, but they produce different UI surfaces (a technical tag, a `{label, context}` chip, and a sentence subtitle) with different groupings and different owner-locked copy (per the file's own "UX-locked by the user" and multiple codex/opus audit references) — a shared table wouldn't shrink the line count meaningfully and risks silently changing copy on a user-facing, audit-hardened surface.
- `core/adapters/chrome-browser-api.ts` repeats a 2-line `X.addListener(fn); return () => X.removeListener(fn)` pattern ~6 times across `ChromeStorageAreaAdapter`, `ChromeRuntimeAdapter`, `ChromeWindowsAdapter`, `ChromeAlarmsAdapter`; each wraps a differently-shaped chrome API, so a generic subscribe-helper would need as much generic-type ceremony as it saves in line count.
- `utils/string.ts`'s `trimAddress`/`getInitials`/`capitalize`/`isValidHex` were checked against `packages/wallet-core/src/utils` and `packages/wallet-crypto/src` — no equivalents exist there; these are extension-UI-only concerns, not misplaced cross-package duplicates.
- `utils/tx-enrichment.ts`'s `METHOD_LABELS` map and `utils/primary-method.ts`'s `FEE_METHODS` set were checked for overlap with each other — they're already correctly split (primary-method owns fee-infra filtering, tx-enrichment owns display labels) with an explicit re-export (`tx-enrichment.ts:8`) to avoid a second copy.
