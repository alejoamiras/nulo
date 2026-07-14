/**
 * The Phase-3 storage spike, committed as permanent regression coverage: proves the encrypted
 * per-(profile, chain) SQLite-OPFS PXE stores against the PRODUCTION-built extension.
 *
 * OPFS is ORIGIN-scoped, so the popup page sees the same tree the offscreen document writes —
 * every assertion here runs through `page.evaluate` on the popup, no offscreen attachment needed.
 *
 * Covered: store materialization under `pxe/<profileId>/<chainId>` (per-chain pool dirs — the
 * upstream default's single shared store must never reappear) · encryption at rest (no plaintext
 * SQLite magic in the pool files) · zero legacy IndexedDB `pxe/*` databases (the rc.2-era one-way
 * cleanup) · profile purge removes the profile's dirs WITHOUT a live runtime dependency while a
 * seeded sibling profile's dir survives (the isolation negative-control), and sweeps the
 * profile's legacy IndexedDB debris.
 *
 * Residual (documented in the plan's lessons): cross-RESTART persistence isn't driven here — the
 * bytes land in OPFS and reopen-compat within a session is exercised by every other network spec
 * (chain runtimes dispose/reinit on network switches); a full browser-restart harness would be
 * new infrastructure for standard sqlite durability.
 */
import { inject, expect } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { resetProfile } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

type OpfsEntry = { profileId: string; chains: string[] }

async function listPxeOpfs(page: Awaited<ReturnType<typeof openPopup>>): Promise<OpfsEntry[]> {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory()
		let pxe: FileSystemDirectoryHandle
		try {
			pxe = await root.getDirectoryHandle("pxe")
		} catch {
			return []
		}
		const out: { profileId: string; chains: string[] }[] = []
		// biome-ignore lint/suspicious/noExplicitAny: FileSystemDirectoryHandle async iteration isn't in the TS lib yet
		for await (const [profileId, handle] of (pxe as any).entries()) {
			if (handle.kind !== "directory") continue
			const chains: string[] = []
			// biome-ignore lint/suspicious/noExplicitAny: same as above
			for await (const [chain, chainHandle] of (handle as any).entries()) {
				if (chainHandle.kind === "directory") chains.push(chain)
			}
			out.push({ profileId, chains })
		}
		return out
	})
}

test.skipIf(!hasConfig)(
	"encrypted per-(profile,chain) OPFS stores: layout, encryption, purge isolation",
	{ timeout: 240_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")

		// ── 1. Store materialization: one profile dir, at least one chain dir under it. ──
		// tokenReadyExtension has already driven real PXE ops (token import + balance reads), so the
		// injected store MUST exist — if the encrypted open failed, that fixture could not have built.
		const entries = await listPxeOpfs(page)
		expect(entries).toHaveLength(1)
		const { profileId, chains } = entries[0]
		expect(chains.length).toBeGreaterThanOrEqual(1)
		console.log(`[opfs] store tree: pxe/${profileId}/{${chains.join(",")}}`)

		// ── 2. Encryption at rest: no plaintext SQLite header anywhere in the pool files. ──
		// An UNencrypted database leaks the magic "SQLite format 3\0" (at offset 0 of the DB image,
		// which the SAH pool stores at a fixed offset inside its files). ChaCha20'd pages are
		// indistinguishable from random — the magic must appear in NO file of the pool dir.
		const plaintextHits = await page.evaluate(async (pid: string) => {
			const root = await navigator.storage.getDirectory()
			const pxe = await root.getDirectoryHandle("pxe")
			const profile = await pxe.getDirectoryHandle(pid)
			const magic = "SQLite format 3"
			let files = 0
			let hits = 0
			// biome-ignore lint/suspicious/noExplicitAny: async iteration typing
			async function walk(dir: any): Promise<void> {
				for await (const [, handle] of dir.entries()) {
					if (handle.kind === "directory") await walk(handle)
					else {
						const file = await handle.getFile()
						const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
						files++
						const text = new TextDecoder("latin1").decode(head)
						if (text.includes(magic)) hits++
					}
				}
			}
			await walk(profile)
			return { files, hits }
		}, profileId)
		expect(plaintextHits.files).toBeGreaterThan(0)
		expect(plaintextHits.hits).toBe(0)
		console.log(`[opfs] ${plaintextHits.files} pool files scanned — zero plaintext SQLite headers`)

		// ── 3. Legacy layer: zero rc.2-era IndexedDB `pxe/*` databases. ──
		const legacyDbs = await page.evaluate(async () =>
			(await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith("pxe/")),
		)
		expect(legacyDbs).toEqual([])

		// ── 4. Seed the negative controls: a fake sibling profile's OPFS dir (must SURVIVE the
		// purge — profile isolation) and a fake legacy IndexedDB for OUR profile (must be swept). ──
		await page.evaluate(async (pid: string) => {
			const root = await navigator.storage.getDirectory()
			const pxe = await root.getDirectoryHandle("pxe", { create: true })
			const sibling = await pxe.getDirectoryHandle("fake-sibling-profile", { create: true })
			const chain = await sibling.getDirectoryHandle("999", { create: true })
			const marker = await chain.getFileHandle("marker.bin", { create: true })
			const w = await marker.createWritable()
			await w.write(new Uint8Array([1, 2, 3]))
			await w.close()
			await new Promise<void>((resolve, reject) => {
				const req = indexedDB.open(`pxe/${pid}/legacy-999`)
				req.onsuccess = () => {
					req.result.close()
					resolve()
				}
				req.onerror = () => reject(req.error)
			})
		}, profileId)

		// ── 5. Profile purge: the reset UI fires the awaited deletion cascade (coordinator →
		// clearProfileState → crypto-erase + registry-driven OPFS removal + legacy sweep). ──
		await resetProfile(page)
		await page.waitForFunction(() => window.location.hash.includes("/popup/register"), { timeout: 30_000 })

		// Poll: our profile's OPFS dir gone; the fake sibling INTACT (isolation negative-control).
		let after: OpfsEntry[] = []
		for (let i = 0; i < 120; i++) {
			after = await listPxeOpfs(page)
			if (!after.some((e) => e.profileId === profileId)) break
			await new Promise((r) => setTimeout(r, 500))
		}
		expect(after.some((e) => e.profileId === profileId)).toBe(false)
		expect(after.some((e) => e.profileId === "fake-sibling-profile")).toBe(true)

		// The seeded legacy IndexedDB for the purged profile is swept too.
		const legacyAfter = await page.evaluate(
			async (pid: string) => (await indexedDB.databases()).map((d) => d.name).filter((n) => n?.startsWith(`pxe/${pid}/`)),
			profileId,
		)
		expect(legacyAfter).toEqual([])

		console.log("[opfs] purge removed the profile's stores, spared the sibling, swept legacy IndexedDB")
		await page.close()
	},
)
