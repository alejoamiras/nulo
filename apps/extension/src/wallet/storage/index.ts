/**
 * Storage barrel for the extension.
 *
 * `EntityStorage` and `ValueStorage` live in `@nulo/wallet-core/storage`;
 * re-exported here so call sites can import without the package path.
 * Their constructors require a `StorageArea` port (from `BrowserApi`)
 * passed explicitly from the composition root.
 */
export { EntityStorage, ValueStorage } from "@nulo/wallet-core/storage"
