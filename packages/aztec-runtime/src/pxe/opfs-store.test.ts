import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EthAddress } from "@aztec/foundation/eth-address"
import { DatabaseVersion } from "@aztec/stdlib/database-version/version"
import type { AztecSQLiteOPFSStore } from "@aztec/kv-store/sqlite-opfs"
import { initStoreVersionStamp, listChainStoreDirs, PxeStoreVersionMismatch, PXE_DATA_SCHEMA_VERSION_PIN } from "./opfs-store"

const nullLog = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, verbose: () => {}, fatal: () => {} } as never

/** Fake store whose `dbVersion` singleton returns a preset stamp; records clear()/set() calls. */
function fakeStore(storedStamp: string | undefined) {
	const calls = { cleared: false, set: undefined as string | undefined }
	const store = {
		openSingleton: () => ({
			getAsync: async () => storedStamp,
			set: async (v: string) => {
				calls.set = v
			},
		}),
		clear: vi.fn(async () => {
			calls.cleared = true
		}),
	} as unknown as AztecSQLiteOPFSStore
	return { store, calls }
}

const ROLLUP = "0x00000000000000000000000000000000000000aa"

function resolvePackageFile(pkg: string, file: string): string {
	const parts = pkg.startsWith("@") ? pkg.split("/").slice(0, 2) : [pkg.split("/")[0]]
	let dir = fileURLToPath(new URL(".", import.meta.url))
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "node_modules", ...parts, file)
		if (existsSync(candidate)) return candidate
		dir = dirname(dir)
	}
	throw new Error(`Cannot find ${pkg}/${file} in any node_modules`)
}

describe("opfs-store upstream pins", () => {
	it("PXE_DATA_SCHEMA_VERSION_PIN matches the installed @aztec/pxe (drift tripwire)", () => {
		// Upstream does not export the constant; the injected-store path must stamp the SAME
		// schema version the PXE writes with, or a future upstream bump would strand every
		// store on a stale stamp (or wipe on every open). A pin mismatch here means: bump the
		// PIN consciously alongside the @aztec upgrade — the wipe-on-mismatch is upstream's
		// designed reset semantics, scoped per-chain by our injection.
		const source = readFileSync(resolvePackageFile("@aztec/pxe", "dest/storage/metadata.js"), "utf8")
		const match = source.match(/PXE_DATA_SCHEMA_VERSION\s*=\s*(\d+)/)
		expect(match).not.toBeNull()
		expect(Number(match?.[1])).toBe(PXE_DATA_SCHEMA_VERSION_PIN)
	})
})

describe("initStoreVersionStamp — refuse-and-preserve on mismatch (D-B2v3, 5.0.1-aligned)", () => {
	function stampFor(schemaVersion: number, rollup: string): string {
		return new DatabaseVersion(schemaVersion, EthAddress.fromString(rollup)).toBuffer().toString("utf-8")
	}

	it("stamps a fresh (empty) store and never clears", async () => {
		const { store, calls } = fakeStore(undefined)
		await initStoreVersionStamp(store, ROLLUP, nullLog)
		expect(calls.cleared).toBe(false)
		expect(calls.set).toBe(stampFor(PXE_DATA_SCHEMA_VERSION_PIN, ROLLUP))
	})

	it("re-opens a matching store without throwing or clearing", async () => {
		const { store, calls } = fakeStore(stampFor(PXE_DATA_SCHEMA_VERSION_PIN, ROLLUP))
		await expect(initStoreVersionStamp(store, ROLLUP, nullLog)).resolves.toBeUndefined()
		expect(calls.cleared).toBe(false)
	})

	it("THROWS (never wipes) on a schema-version mismatch", async () => {
		const { store, calls } = fakeStore(stampFor(PXE_DATA_SCHEMA_VERSION_PIN - 1, ROLLUP))
		await expect(initStoreVersionStamp(store, ROLLUP, nullLog)).rejects.toBeInstanceOf(PxeStoreVersionMismatch)
		expect(calls.cleared).toBe(false)
		expect(calls.set).toBeUndefined()
	})

	it("THROWS (never wipes) on a rollup-address mismatch", async () => {
		const otherRollup = "0x00000000000000000000000000000000000000bb"
		const { store, calls } = fakeStore(stampFor(PXE_DATA_SCHEMA_VERSION_PIN, otherRollup))
		await expect(initStoreVersionStamp(store, ROLLUP, nullLog)).rejects.toBeInstanceOf(PxeStoreVersionMismatch)
		expect(calls.cleared).toBe(false)
	})

	it("THROWS (never wipes) on an unparseable stamp — a hostile/corrupt blob is refused, not wiped", async () => {
		const { store, calls } = fakeStore("not-a-valid-database-version-stamp")
		await expect(initStoreVersionStamp(store, ROLLUP, nullLog)).rejects.toBeInstanceOf(PxeStoreVersionMismatch)
		expect(calls.cleared).toBe(false)
	})
})

describe("opfsRoot narrowing — absence is benign, every other error propagates (D-audit)", () => {
	const realNavigator = globalThis.navigator

	afterEach(() => {
		// Restore the original navigator (undefined under node-env) — configurable so the next
		// test's stub can redefine it.
		Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true })
	})

	function stubNavigator(getDirectoryHandle: () => Promise<unknown>): void {
		Object.defineProperty(globalThis, "navigator", {
			value: { storage: { getDirectory: async () => ({ getDirectoryHandle, entries: async function* () {} }) } },
			configurable: true,
		})
	}

	it("treats a missing pxe root (NotFoundError) as an EMPTY registry (not an error)", async () => {
		stubNavigator(() => Promise.reject(new DOMException("nope", "NotFoundError")))
		await expect(listChainStoreDirs()).resolves.toEqual([])
	})

	it("PROPAGATES a non-NotFound failure (e.g. SecurityError) — never masks it as 'no stores'", async () => {
		stubNavigator(() => Promise.reject(new DOMException("denied", "SecurityError")))
		await expect(listChainStoreDirs()).rejects.toThrow("denied")
	})
})
