import { readFileSync } from "node:fs"
import { resolvePackageAsset } from "@nulo/resolve-asset"
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
	return resolvePackageAsset(pkg, file, { from: import.meta.url, entry: pkg === "@aztec/pxe" ? "./server" : undefined })
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

/**
 * Minimal in-memory FileSystemDirectoryHandle fake — just enough surface for the
 * registry helpers (getDirectoryHandle / removeEntry / entries / keys). Installed
 * via a navigator.storage.getDirectory stub per-test.
 */
class FakeDir {
	public readonly kind = "directory" as const
	private readonly children = new Map<string, FakeDir>()
	constructor(public readonly name: string) {}

	async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
		let child = this.children.get(name)
		if (!child) {
			if (!opts?.create) {
				const err = new DOMException(`No such directory: ${name}`, "NotFoundError")
				throw err
			}
			child = new FakeDir(name)
			this.children.set(name, child)
		}
		return child
	}

	async removeEntry(name: string, _opts?: { recursive?: boolean }): Promise<void> {
		if (!this.children.delete(name)) {
			throw new DOMException(`No such entry: ${name}`, "NotFoundError")
		}
	}

	async *entries(): AsyncIterableIterator<[string, FakeDir]> {
		for (const [k, v] of this.children) yield [k, v]
	}

	async *keys(): AsyncIterableIterator<string> {
		for (const k of this.children.keys()) yield k
	}

	has(name: string): boolean {
		return this.children.has(name)
	}
}

function installFakeOpfs(): { root: FakeDir; pxe: FakeDir } {
	const root = new FakeDir("")
	const pxe = new FakeDir("pxe")
	// Seed the pxe root eagerly — opfsRoot() only swallows its absence.
	// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
	;(root as any).children.set("pxe", pxe)
	vi.stubGlobal("navigator", {
		storage: { getDirectory: async () => root },
	})
	return { root, pxe }
}

describe("removeChainStoreDir — no empty-profile-dir sweep (D7)", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	async function seed(pxe: FakeDir, profileId: string, chainIds: number[]): Promise<FakeDir> {
		const profile = await pxe.getDirectoryHandle(profileId, { create: true })
		for (const id of chainIds) await profile.getDirectoryHandle(String(id), { create: true })
		return profile
	}

	it("removes only the chain dir and leaves the (now empty) profile dir in place", async () => {
		const { pxe } = installFakeOpfs()
		const { removeChainStoreDir } = await import("./opfs-store")
		const profile = await seed(pxe, "p1", [31337])

		await removeChainStoreDir({ profileId: "p1", chainId: 31337 })

		expect(profile.has("31337")).toBe(false)
		// The profile dir survives: the old sweep here TOCTOU-raced a concurrent
		// sibling-chain open. Profile dirs are removed only by removeProfileStoreDirs.
		expect(pxe.has("p1")).toBe(true)
	})

	it("leaves sibling chains untouched", async () => {
		const { pxe } = installFakeOpfs()
		const { removeChainStoreDir } = await import("./opfs-store")
		const profile = await seed(pxe, "p1", [31337, 11155111])

		await removeChainStoreDir({ profileId: "p1", chainId: 31337 })

		expect(profile.has("31337")).toBe(false)
		expect(profile.has("11155111")).toBe(true)
	})

	it("is idempotent: missing chain or profile dirs are swallowed", async () => {
		installFakeOpfs()
		const { removeChainStoreDir } = await import("./opfs-store")
		await expect(removeChainStoreDir({ profileId: "absent", chainId: 1 })).resolves.toBeUndefined()
	})

	it("an empty leftover profile dir is inert to the registry enumeration", async () => {
		const { pxe } = installFakeOpfs()
		const mod = await import("./opfs-store")
		await seed(pxe, "p1", [31337])
		await seed(pxe, "p2", [31337])

		await mod.removeChainStoreDir({ profileId: "p1", chainId: 31337 })

		const coords = await mod.listChainStoreDirs()
		expect(coords).toEqual([{ profileId: "p2", chainId: 31337 }])
	})
})
