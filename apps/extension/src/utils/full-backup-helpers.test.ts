import { EncryptionKey } from "@nulo/wallet-crypto"
import { describe, expect, it, vi } from "vitest"
import {
	AssemblyAbortedError,
	assembleFullBackup,
	type BackupSource,
	MAX_BACKUP_FILE_BYTES,
	collectRestoreErrors,
	detectBackupType,
	normalizeAllIds,
	readBackupFile,
	remapByMap,
	resolveRestoredActiveNetworkId,
} from "./full-backup-helpers"

describe("assembleFullBackup", () => {
	const twelveSources = (slice: (name: string) => unknown): { sources: BackupSource[]; spies: ReturnType<typeof vi.fn>[] } => {
		const names = [
			"profile",
			"network",
			"account",
			"imported-keys",
			"transaction",
			"token",
			"token-balance",
			"account-state",
			"auth-registry",
			"fpc",
			"contact",
			"config",
		]
		const spies = names.map((name) => vi.fn(async () => slice(name)))
		return { sources: names.map((name, i) => ({ name, backup: spies[i] })), spies }
	}

	it("calls every source exactly once (single-execution proof) and keys slices by source name", async () => {
		const { sources, spies } = twelveSources((name) => [{ from: name }])
		const result = await assembleFullBackup({ "wallet-version": "1.0.0" }, sources)
		for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
		const parsed = JSON.parse(result.compact) as { data: Record<string, unknown> }
		expect(Object.keys(parsed.data)).toHaveLength(12)
		expect(parsed.data.config).toEqual([{ from: "config" }])
	})

	it("seals so the import-side recompute reproduces the checksum (pretty file path)", async () => {
		const { sources } = twelveSources((name) => [{ from: name }])
		const result = await assembleFullBackup({ "wallet-version": "1.0.0", "master-key": "mk" }, sources)
		// Exactly what the importer does: parse the downloaded pretty file,
		// strip only `checksum`, compact-restringify, hash.
		const parsed = JSON.parse(result.pretty) as Record<string, unknown>
		const { checksum, ...body } = parsed
		expect(checksum).toBe(result.checksum)
		expect(await EncryptionKey.getHashHex(JSON.stringify(body))).toBe(result.checksum)
	})

	it("is immune to caller-side mutation after sealing (canonical snapshot)", async () => {
		const envelope: Record<string, unknown> = { "wallet-version": "1.0.0" }
		const slice: Record<string, unknown>[] = [{ v: 1 }]
		const sources: BackupSource[] = [{ name: "profile", backup: async () => slice }]
		const result = await assembleFullBackup(envelope, sources)
		envelope["wallet-version"] = "TAMPERED"
		slice[0].v = 999
		const parsed = JSON.parse(result.compact) as { "wallet-version": string; data: { profile: Array<{ v: number }> } }
		expect(parsed["wallet-version"]).toBe("1.0.0")
		expect(parsed.data.profile[0].v).toBe(1)
		const { checksum, ...body } = JSON.parse(result.compact) as Record<string, unknown>
		expect(await EncryptionKey.getHashHex(JSON.stringify(body))).toBe(checksum)
	})

	it("rejects an envelope that already carries a checksum", async () => {
		await expect(assembleFullBackup({ checksum: "forged" }, [])).rejects.toThrow(/must not carry a checksum/)
	})

	it("aborts via the onSlice probe without calling later sources", async () => {
		const { sources, spies } = twelveSources(() => [])
		let calls = 0
		const probe = () => ++calls <= 2
		await expect(assembleFullBackup({}, sources, probe)).rejects.toBeInstanceOf(AssemblyAbortedError)
		expect(spies[0]).toHaveBeenCalledTimes(1)
		expect(spies[1]).toHaveBeenCalledTimes(1)
		for (const spy of spies.slice(2)) expect(spy).not.toHaveBeenCalled()
	})

	it("skips null/undefined slices and drops undefined envelope fields", async () => {
		const sources: BackupSource[] = [
			{ name: "a", backup: async () => null },
			{ name: "b", backup: async () => undefined },
			{ name: "c", backup: async () => [1] },
		]
		const result = await assembleFullBackup({ present: "x", absent: undefined }, sources)
		const parsed = JSON.parse(result.compact) as Record<string, unknown> & { data: Record<string, unknown> }
		expect(Object.keys(parsed.data)).toEqual(["c"])
		expect("absent" in parsed).toBe(false)
		expect(parsed.present).toBe("x")
	})
})

describe("detectBackupType", () => {
	it("detects plain JSON object", () => {
		expect(detectBackupType('{"hello":1}')).toBe("plain")
	})
	it("detects plain JSON array", () => {
		expect(detectBackupType("[1,2,3]")).toBe("plain")
	})
	it("trims leading/trailing whitespace before classifying", () => {
		expect(detectBackupType('   { "x": 1 }   ')).toBe("plain")
	})
	it("detects encrypted base64 prefix (first byte 0, length >=13)", () => {
		const bytes = new Uint8Array(20)
		const b64 = btoa(String.fromCharCode(...bytes))
		expect(detectBackupType(b64)).toBe("encrypted")
	})
	it("returns unknown for short base64", () => {
		const bytes = new Uint8Array(5)
		const b64 = btoa(String.fromCharCode(...bytes))
		expect(detectBackupType(b64)).toBe("unknown")
	})
	it("returns unknown for non-base64 garbage", () => {
		expect(detectBackupType("not really base64 ###")).toBe("unknown")
	})
})

describe("readBackupFile", () => {
	function makeFile(text: string, name = "backup.json"): File {
		// jsdom's File doesn't implement .text(); shim it.
		return { name, text: async () => text } as unknown as File
	}

	it("parses a plain JSON backup and extracts profileType", async () => {
		const text = JSON.stringify({ data: { profile: { type: "password" } } })
		const { selection, parseError } = await readBackupFile(makeFile(text))
		expect(parseError).toBeUndefined()
		expect(selection.type).toBe("plain")
		expect(selection.profileType).toBe("password")
		expect(selection.name).toBe("backup.json")
	})

	it("returns parseError for malformed plain JSON", async () => {
		const { selection, parseError } = await readBackupFile(makeFile("{ not: 'json'"))
		expect(parseError).toBeDefined()
		expect(parseError?.title).toMatch(/Invalid JSON/i)
		expect(selection.type).toBe("plain")
	})

	it("treats encrypted backup as raw text", async () => {
		const bytes = new Uint8Array(20)
		const b64 = btoa(String.fromCharCode(...bytes))
		const { selection } = await readBackupFile(makeFile(b64, "backup.txt"))
		expect(selection.type).toBe("encrypted")
		expect(selection.backup).toBe(b64)
		expect(selection.profileType).toBeNull()
	})

	it("classifies garbage as unknown", async () => {
		const { selection } = await readBackupFile(makeFile("hello world ###"))
		expect(selection.type).toBe("unknown")
	})

	function makeSizedFile(size: number, name = "backup.json"): File {
		return { name, size, text: async () => "{}" } as unknown as File
	}

	it("rejects an oversized file before reading it", async () => {
		const { parseError, selection } = await readBackupFile(makeSizedFile(MAX_BACKUP_FILE_BYTES + 1))
		expect(parseError?.title).toBe("Backup File Too Large")
		expect(selection.type).toBe("unknown")
		expect(selection.backup).toBeNull()
	})

	it("accepts a file exactly at the limit", async () => {
		const { parseError } = await readBackupFile(makeSizedFile(MAX_BACKUP_FILE_BYTES))
		expect(parseError).toBeUndefined()
	})
})

describe("collectRestoreErrors", () => {
	it("returns null for empty/non-array input", () => {
		expect(collectRestoreErrors("network", null as unknown as unknown[])).toBeNull()
		expect(collectRestoreErrors("network", [])).toBeNull()
		expect(collectRestoreErrors("", [{ restoreError: "x" }])).toBeNull()
	})

	it("filters generic services to only failed entries", () => {
		const result = collectRestoreErrors("network", [{ id: "a", restoreError: "boom" }, { id: "b" }, { id: "c", restoreError: "kaput" }])
		expect(result).toEqual([
			{ row: 0, id: "a", restoreError: "boom" },
			{ row: 1, id: "c", restoreError: "kaput" },
		])
	})

	it("returns null when no generic entries failed", () => {
		const result = collectRestoreErrors("network", [{ id: "a" }, { id: "b" }])
		expect(result).toBeNull()
	})

	it("preserves networkId for account-state and filters contracts/senders", () => {
		const result = collectRestoreErrors("account-state", [
			{
				networkId: "net1",
				contracts: [{ address: "x", restoreError: "fail" }, { address: "y" }],
				senders: [{ address: "s" }],
			},
			{
				networkId: "net2",
				contracts: [{ address: "z" }],
				senders: [{ address: "t", restoreError: "boom" }],
			},
			{
				networkId: "net3",
				contracts: [{ address: "ok" }],
				senders: [{ address: "ok" }],
			},
		])
		// Children are identified by POSITION: the addresses are registered contracts and
		// tagging senders, both of which are privacy signals in their own right.
		expect(result).toEqual([
			{ networkId: "net1", contracts: [{ child: 0, restoreError: "fail" }], senders: [] },
			{ networkId: "net2", contracts: [], senders: [{ child: 0, restoreError: "boom" }] },
		])
	})

	// These records reach the "View Errors" viewer, which offers a one-click copy of the whole
	// log, AND a console.warn that the hijacked console feeds into the log store.
	describe("payload stripping", () => {
		it("drops an imported key's sealed signing key", () => {
			const result = collectRestoreErrors("imported-keys", [
				{ id: "k1", profileId: "p1", chainId: 1, address: "0xacc", encryptedSigningKey: "SEALED-BLOB", restoreError: "boom" },
			])

			expect(JSON.stringify(result)).not.toContain("SEALED-BLOB")
			expect(result).toEqual([{ row: 0, id: "k1", profileId: "p1", chainId: 1, restoreError: "boom" }])
		})

		it("drops an endpoint URL, which routinely carries a provider API key", () => {
			const result = collectRestoreErrors("network", [
				{ id: "n1", endpoints: [{ id: "e1", rpcUrl: "https://mainnet.example.com/v2/SECRET-KEY" }], restoreError: "boom" },
			])

			expect(JSON.stringify(result)).not.toContain("SECRET-KEY")
			expect(result).toEqual([{ row: 0, id: "n1", restoreError: "boom" }])
		})

		it("drops contact PII", () => {
			const result = collectRestoreErrors("contact", [{ id: "c1", name: "Mom", address: "0xmom", restoreError: "boom" }])

			expect(JSON.stringify(result)).not.toContain("Mom")
			expect(JSON.stringify(result)).not.toContain("0xmom")
		})

		it("drops balances", () => {
			const result = collectRestoreErrors("token-balance", [
				{ id: "b1", publicBalance: "123456", privateBalance: "999999", restoreError: "boom" },
			])

			expect(JSON.stringify(result)).not.toContain("999999")
		})

		it("drops the instance/artifact blobs beside a failed account-state contract", () => {
			const result = collectRestoreErrors("account-state", [
				{
					networkId: "net1",
					contracts: [{ address: "0xc", instance: { packedBytecode: "BLOB" }, artifact: { name: "T" }, restoreError: "fail" }],
					senders: [],
				},
			])

			expect(JSON.stringify(result)).not.toContain("BLOB")
			expect(result).toEqual([{ networkId: "net1", contracts: [{ child: 0, restoreError: "fail" }], senders: [] }])
		})

		it("constrains allowlisted fields by TYPE, not just by name", () => {
			// Allowlisting names alone is not enough: a crafted backup can ship an allowlisted key
			// whose VALUE is an object carrying whatever it likes, and a name-only filter copies it
			// through intact.
			const result = collectRestoreErrors("token", [
				{ id: "t1", chainId: { rpcUrl: "https://mainnet.example.com/v2/SECRET-KEY" }, restoreError: "boom" },
			])

			expect(JSON.stringify(result)).not.toContain("SECRET-KEY")
			expect(JSON.stringify(result)).not.toContain("rpcUrl")
			expect(result).toEqual([{ row: 0, id: "t1", chainId: "[object]", restoreError: "boom" }])
		})

		it("bounds an allowlisted id that is really a payload wearing an id's name", () => {
			const result = collectRestoreErrors("token", [{ id: "X".repeat(5000), restoreError: "boom" }]) as Array<Record<string, unknown>>

			expect(result[0].id).toBe("[string:5000]")
		})

		it("scrubs and bounds restoreError — a fetch failure interpolates the whole endpoint", () => {
			const result = collectRestoreErrors("network", [
				{ id: "n1", restoreError: "fetch failed: https://rpc.example.com/v2/SECRET-KEY?apiKey=abc" },
			]) as Array<Record<string, unknown>>

			expect(JSON.stringify(result)).not.toContain("SECRET-KEY")
			expect(result[0].restoreError).toContain("https://rpc.example.com")
		})

		it("caps a very long restoreError", () => {
			const result = collectRestoreErrors("network", [{ id: "n1", restoreError: "x".repeat(9000) }]) as Array<Record<string, unknown>>

			expect((result[0].restoreError as string).length).toBeLessThanOrEqual(200)
		})

		it("caps a hostile backup's error count instead of recording all of it", () => {
			const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, restoreError: "boom" }))
			const result = collectRestoreErrors("contact", rows)

			expect(result).toHaveLength(201)
			expect(JSON.stringify(result?.[200])).toContain("further error(s) not recorded")
		})
	})
})

describe("normalizeAllIds + remapByMap", () => {
	it("rewrites the given key in every array entry that has it", () => {
		const data: Record<string, unknown> = {
			account: [
				{ profileId: "old", id: "a1" },
				{ profileId: "old", id: "a2" },
			],
			network: [{ profileId: "old", id: "n1" }],
			meta: { profileId: "old" }, // non-array left untouched
			scalar: 42,
		}
		normalizeAllIds(data, "profileId", "new")
		expect(data.account).toEqual([
			{ profileId: "new", id: "a1" },
			{ profileId: "new", id: "a2" },
		])
		expect(data.network).toEqual([{ profileId: "new", id: "n1" }])
		expect(data.meta).toEqual({ profileId: "old" })
		expect(data.scalar).toBe(42)
	})

	it("leaves entries without the key unchanged", () => {
		const data: Record<string, unknown> = {
			account: [{ id: "a1" }, { profileId: "old", id: "a2" }],
		}
		normalizeAllIds(data, "profileId", "new")
		expect(data.account).toEqual([{ id: "a1" }, { profileId: "new", id: "a2" }])
	})

	it("SCOPED form (oldId given): rewrites only rows matching oldId — no cross-graft across networks (P2)", () => {
		// Two networks N1→M1, N2→M2. Each remap must touch ONLY its own rows.
		const data: Record<string, unknown> = {
			"account-state": [
				{ networkId: "N1", x: 1 },
				{ networkId: "N2", x: 2 },
			],
			fpc: [{ networkId: "N2", y: 1 }],
		}
		remapByMap(
			data,
			"networkId",
			new Map([
				["N1", "M1"],
				["N2", "M2"],
			]),
		)
		expect(data["account-state"]).toEqual([
			{ networkId: "M1", x: 1 },
			{ networkId: "M2", x: 2 },
		])
		expect(data.fpc).toEqual([{ networkId: "M2", y: 1 }])
	})

	it("SCOPED form: an unrelated networkId is left alone (no over-write)", () => {
		const data: Record<string, unknown> = { fpc: [{ networkId: "N1" }, { networkId: "N9" }] }
		remapByMap(data, "networkId", new Map([["N1", "M1"]]))
		expect(data.fpc).toEqual([{ networkId: "M1" }, { networkId: "N9" }])
	})

	it("(E) single-pass: a new id equal to a LATER source id does NOT cascade-rewrite", () => {
		// N1→R, and a second network's OLD id is also "R" (R→S). A sequential per-id
		// remap would rewrite N1's already-remapped "R" rows again on the R→S pass →
		// both alias to S. The single-pass map looks up each row's ORIGINAL value once.
		const data: Record<string, unknown> = { fpc: [{ networkId: "N1" }, { networkId: "R" }] }
		remapByMap(
			data,
			"networkId",
			new Map([
				["N1", "R"],
				["R", "S"],
			]),
		)
		expect(data.fpc).toEqual([{ networkId: "R" }, { networkId: "S" }])
	})

	it("ALL-ROWS form (oldId omitted): still normalizes a hostile row whose profileId differs (P2 guard)", () => {
		const data: Record<string, unknown> = {
			account: [
				{ profileId: "real-old", id: "a1" },
				{ profileId: "0xHOSTILE-FOREIGN", id: "a2" },
			],
		}
		normalizeAllIds(data, "profileId", "new")
		expect(data.account).toEqual([
			{ profileId: "new", id: "a1" },
			{ profileId: "new", id: "a2" },
		])
	})
})

describe("resolveRestoredActiveNetworkId (item 1b — preserve active-network across import)", () => {
	it("maps a CHANGED id through the index pairing", () => {
		const got = resolveRestoredActiveNetworkId("a", [{ id: "A" }], [{ id: "a" }])
		expect(got).toBe("A")
	})
	it("maps an UNCHANGED id via identity (the changed-only remap map would miss this)", () => {
		const got = resolveRestoredActiveNetworkId("b", [{ id: "b" }], [{ id: "b" }])
		expect(got).toBe("b")
	})
	it("picks the correct row among several", () => {
		const news = [{ id: "A" }, { id: "b" }, { id: "C" }]
		const olds = [{ id: "a" }, { id: "b" }, { id: "c" }]
		expect(resolveRestoredActiveNetworkId("a", news, olds)).toBe("A")
		expect(resolveRestoredActiveNetworkId("b", news, olds)).toBe("b")
		expect(resolveRestoredActiveNetworkId("c", news, olds)).toBe("C")
	})
	it("returns undefined when the selected source FAILED to restore", () => {
		const news = [{ id: "A" }, { id: "c", restoreError: "boom" }]
		const olds = [{ id: "a" }, { id: "c" }]
		expect(resolveRestoredActiveNetworkId("c", news, olds)).toBeUndefined()
	})
	it("returns undefined for a DUPLICATED source id (ambiguous pairing)", () => {
		const news = [{ id: "D1" }, { id: "D2" }]
		const olds = [{ id: "d" }, { id: "d" }]
		expect(resolveRestoredActiveNetworkId("d", news, olds)).toBeUndefined()
	})
	it("returns undefined for absent / non-string / foreign ids (hostile-safe)", () => {
		const news = [{ id: "A" }]
		const olds = [{ id: "a" }]
		expect(resolveRestoredActiveNetworkId(undefined, news, olds)).toBeUndefined()
		expect(resolveRestoredActiveNetworkId(12345 as unknown, news, olds)).toBeUndefined()
		expect(resolveRestoredActiveNetworkId({} as unknown, news, olds)).toBeUndefined()
		expect(resolveRestoredActiveNetworkId("does-not-exist", news, olds)).toBeUndefined()
	})
})

describe("collectRestoreErrors — account-state top-level records (skip/violation shapes)", () => {
	it("collects an item-level restoreError even when every child is clean", () => {
		const result = collectRestoreErrors("account-state", [
			{ networkId: "n1", senders: [], contracts: [], restoreError: "Skipped — couldn't reach the network" },
			{ networkId: "n2", senders: [{ address: "ok" }], contracts: [] },
		])
		expect(result).toEqual([{ networkId: "n1", contracts: [], senders: [], restoreError: "Skipped — couldn't reach the network" }])
	})

	it("carries the item-level error ALONGSIDE failed children", () => {
		const result = collectRestoreErrors("account-state", [
			{
				networkId: "n1",
				senders: [{ address: "s", restoreError: "boom" }],
				contracts: [],
				restoreError: "Skipped — ran out of time reaching the network (3 registration(s) not attempted)",
			},
		])
		expect(result).toHaveLength(1)
		const item = result?.[0] as { restoreError?: string; senders: unknown[] }
		expect(item.restoreError).toContain("ran out of time")
		expect(item.senders).toHaveLength(1)
	})

	it("collapses non-object result entries ([null]/[undefined]) into ONE constant record, never throws", () => {
		const result = collectRestoreErrors("account-state", [null, undefined, 42] as unknown as unknown[])
		expect(result).toEqual([
			{ networkId: "(result)", contracts: [], senders: [], restoreError: "malformed account-state restore result" },
		])
	})

	it("guards malformed child arrays instead of throwing (post-finalize path)", () => {
		const result = collectRestoreErrors("account-state", [
			{ networkId: "n1", senders: null, contracts: undefined, restoreError: "malformed account-state item" },
			{ networkId: "n2", senders: [null, { address: "s", restoreError: "x" }], contracts: [undefined] },
		] as unknown as unknown[])
		expect(result).toHaveLength(2)
	})
})
