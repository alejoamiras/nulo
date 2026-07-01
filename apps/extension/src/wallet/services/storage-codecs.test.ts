/**
 * Round-trip corpus + drift-policy pins for the durable-store codecs (Q-01).
 * Each store now injects its zod row schema into `EntityStorage` (the
 * operation-journal precedent), which gives it the wallet-core `decodeRow`
 * guarantees:
 *   - JSON-SYNTAX failure → legacy policy (row dropped);
 *   - CODEC-VALIDATION failure → row KEPT on disk, read as undefined
 *     ("present but unreadable") — NEVER deleted. A too-strict schema can
 *     hide a row but can never destroy it.
 *
 * Per store: (a) a full-fidelity corpus row and a minimal row (optionals
 * absent) survive write→read byte-equal; (b) a drifted row (wrong type /
 * missing required field) reads as undefined AND stays on disk.
 */

import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EntityStorage } from "@/wallet/storage"
import { ContactSchema, type Contact } from "./contact/spec"
import { StoredFpcSchema, FpcType, type FpcInfo } from "./fpc/spec"
import { AccountSchema, AccountType, type Account } from "./account/spec"
import { AuthwitSchema, AuthwitStatusSchema, type Authwit } from "./auth-registry/spec"
import { TokenBalanceRawSchema, type TokenBalanceRaw } from "./token-balance/spec"
import { TokenSchema, type Token } from "./token/spec"
import { NetworkRowSchema, type Network } from "./network/spec"

type StoredFpc = Omit<FpcInfo, "isProtocol">

/** Per-store corpus: root, schema, full row, minimal row (optionals absent), drifted row. */
const CORPUS = [
	{
		name: "contact",
		root: "nulo:core:contacts",
		parse: (raw: unknown) => ContactSchema.parse(raw),
		full: { id: "c1", profileId: "p1", name: "Alice", address: "0xa", abbr: "AL" } satisfies Contact,
		minimal: { id: "c2", profileId: "p1", name: "B", address: "0xb", abbr: "B" } satisfies Contact,
		drifted: { id: "c3", profileId: "p1", name: "NoAddress", abbr: "N" },
	},
	{
		name: "fpc",
		root: "nulo:core:fpcs",
		parse: (raw: unknown) => StoredFpcSchema.parse(raw),
		full: { id: "f1", profileId: "p1", chainId: 1, type: FpcType.DefaultSponsoredFpc, address: "0xf", name: "F" } satisfies StoredFpc,
		minimal: { id: "f2", profileId: "p1", chainId: 1, type: FpcType.PrivateFpc, address: "0xf2" } satisfies StoredFpc,
		drifted: { id: "f3", profileId: "p1", chainId: 1, type: 99, address: "0xf3" },
	},
	{
		name: "account",
		root: "nulo:core:accounts",
		parse: (raw: unknown) => AccountSchema.parse(raw),
		full: {
			profileId: "p1",
			chainId: 1,
			address: "0xacc",
			index: 0,
			type: AccountType.Nulo_v1,
			name: "A",
			visible: true,
		} satisfies Account,
		minimal: {
			profileId: "p1",
			chainId: 1,
			address: "0xacc2",
			index: 1,
			type: AccountType.Nulo_v1,
			name: "B",
			visible: false,
		} satisfies Account,
		drifted: { profileId: "p1", chainId: 1, address: "0xacc3", index: "one", type: AccountType.Nulo_v1, name: "C", visible: true },
	},
	{
		name: "authwit",
		root: "nulo:core:auth-registry",
		parse: (raw: unknown) => AuthwitSchema.parse(raw),
		full: {
			id: 1,
			account: "0xa",
			hash: "0xh",
			content: { kind: "intent", consumer: "0xc", intent: ["i1"] },
			pending: true,
			txHash: "0xt",
		} as Authwit,
		minimal: { id: 2, account: "0xa", hash: "0xh2", content: { kind: "message_hash" } } as Authwit,
		drifted: { id: 3, account: "0xa", hash: "0xh3", content: "not-an-object" },
	},
	{
		name: "token-balance",
		root: "nulo:core:token-balances",
		parse: (raw: unknown) => TokenBalanceRawSchema.parse(raw),
		full: { id: 10, token: 1, account: "0xa", publicBalance: "5", privateBalance: "7", updatedAt: 123 } satisfies TokenBalanceRaw,
		minimal: { id: 11, token: 1, account: "0xa", updatedAt: 0 } satisfies TokenBalanceRaw,
		drifted: { id: 12, token: "one", account: "0xa", updatedAt: 0 },
	},
	{
		name: "token",
		root: "nulo:core:tokens",
		parse: (raw: unknown) => TokenSchema.parse(raw),
		full: {
			id: 1,
			profileId: "p1",
			chainId: 1,
			contract: "0xtok",
			name: "Tok",
			symbol: "TOK",
			decimals: 18,
			getNameFn: { name: "name", impl: 1 },
			transferPublicFn: { name: "transfer_public", impl: 2 },
		} as Token,
		minimal: { id: 2, profileId: "p1", chainId: 1, contract: "0xtok2", name: "T2", symbol: "T2", decimals: 6 } satisfies Token,
		drifted: { id: 3, profileId: "p1", chainId: 1, contract: "0xtok3", name: "T3", symbol: "T3", decimals: "18" },
	},
	{
		name: "network",
		root: "nulo:core:networks",
		parse: (raw: unknown) => NetworkRowSchema.parse(raw),
		full: {
			id: "n1",
			profileId: "p1",
			chainId: 7,
			name: "Net",
			primaryEndpointId: "e1",
			endpoints: [
				{ id: "e1", rpcUrl: "http://localhost:8080", label: "local" },
				{ id: "e2", rpcUrl: "http://backup:8080" },
			],
			kind: "testnet",
		} satisfies Network,
		minimal: {
			id: "n2",
			profileId: "p1",
			chainId: 8,
			name: "Min",
			primaryEndpointId: "e1",
			endpoints: [{ id: "e1", rpcUrl: "http://h" }],
		} satisfies Network,
		drifted: { id: "n3", profileId: "p1", chainId: 9, name: "Bad", primaryEndpointId: "e1", endpoints: "none" },
	},
] as const

describe("durable-store codecs (Q-01 R5a batch 1)", () => {
	for (const c of CORPUS) {
		describe(c.name, () => {
			test("round-trip corpus: full + minimal rows survive write→read equal", async () => {
				const api = new FakeBrowserApi()
				api.reset()
				const storage = new EntityStorage<Record<string, unknown>>(c.root, api.storage.local, c.parse)
				await storage.set("full", c.full as unknown as Record<string, unknown>)
				await storage.set("min", c.minimal as unknown as Record<string, unknown>)
				expect(await storage.get("full")).toEqual(c.full)
				expect(await storage.get("min")).toEqual(c.minimal)
			})

			test("drifted row is KEPT on disk but reads as undefined (never deleted)", async () => {
				const api = new FakeBrowserApi()
				api.reset()
				const key = `${c.root}@drift`
				await api.storage.local.set({ [key]: JSON.stringify(c.drifted) })
				const storage = new EntityStorage<Record<string, unknown>>(c.root, api.storage.local, c.parse)
				expect(await storage.get("drift")).toBeUndefined()
				// The raw key must still be present — validation failure never deletes.
				const raw = await api.storage.local.get(key)
				expect(raw[key]).toBeDefined()
			})
		})
	}

	test("authwit enabled-flag store: booleans round-trip; a non-boolean is kept-but-unreadable", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const parse = (raw: unknown) => AuthwitStatusSchema.parse(raw)
		const storage = new EntityStorage<boolean>("nulo:core:auth-registry-enabled", api.storage.local, parse)
		await storage.set("0xa", true)
		await storage.set("0xb", false)
		expect(await storage.get("0xa")).toBe(true)
		expect(await storage.get("0xb")).toBe(false)
		const key = "nulo:core:auth-registry-enabled@0xc"
		await api.storage.local.set({ [key]: JSON.stringify("yes") })
		expect(await storage.get("0xc")).toBeUndefined()
		expect((await api.storage.local.get(key))[key]).toBeDefined()
	})
})
