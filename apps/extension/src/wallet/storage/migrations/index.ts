/**
 * The extension's numbered migration registry (the data door: extension update).
 *
 * The launch shape is version 1. Forward migrations are v2, v3, … — one file
 * each (copy `template.ts`), imported into the `migrations` array below. The
 * `version` inside each migration is the source of truth; nothing else to bump.
 *
 * The pure engine + its crash-safe journal live in `@nulo/wallet-core/migration`;
 * this only supplies the ordered list + the baseline. Wired at boot in
 * `../../runtime.ts` (before `config.load()`), driven against `chrome.storage.local`.
 */
import type { Migration } from "@nulo/wallet-core/migration"

/** The current on-disk shape. Fresh installs stamp this and run nothing. */
export const BASELINE_VERSION = 1

/** Forward-only, ascending. Empty until the first real schema change ships. */
export const migrations: Migration[] = []
