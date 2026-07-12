/**
 * `@nulo/wallet-core/migration` — the pure, `chrome.*`-free data-preserving
 * storage-migration engine. The extension supplies the live `chrome.storage`
 * adapter + the numbered migration registry; the engine owns sequencing, the
 * crash-safe journal, fail-closed retry, and the marker decision table.
 */
export type {
	Migration,
	MigrationArea,
	MigrationContext,
	MigrationFailure,
	MigrationResult,
	MinimalStorageArea,
	StorageRef,
} from "./types"
export { defineMigration } from "./types"
export {
	Migrator,
	RESERVED_KEYS,
	SCHEMA_RESERVED_PREFIX,
	SCHEMA_RUNNING_KEY,
	SCHEMA_VERSION_KEY,
	type MigratorOptions,
} from "./migrator"
