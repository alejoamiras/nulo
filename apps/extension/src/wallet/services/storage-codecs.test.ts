/**
 * Round-trip corpus + drift-policy pins for the durable-store codecs.
 * Each store now injects its zod row schema into `EntityStorage` (the
 * operation-journal precedent), which gives it the wallet-core `decodeRow`
 * guarantees (B-23: the read path NEVER deletes):
 *   - JSON-SYNTAX failure → row KEPT on disk, read as undefined;
 *   - CODEC-VALIDATION failure → row KEPT on disk, read as undefined
 *     ("present but unreadable") — NEVER deleted. A too-strict schema can
 *     hide a row but can never destroy it. Removal happens only in the
 *     serialized purge second pass (`purgeMalformedRows`, F-B23).
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
import { TxSchema, TxStatus, type Tx } from "./transaction/spec"
import {
	IncomingTransferRecordSchema,
	IncomingTrustRecordSchema,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
} from "./incoming-transfer/spec"
import { AccessLevel, DappSessionSchema, type DappSession } from "./dapp-session/spec"

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
		full: {
			id: 10,
			token: 1,
			account: "0xa",
			publicBalance: "5",
			privateBalance: "7",
			updatedAt: 123,
			syncFailure: { at: 456, message: "sim failed" },
		} satisfies TokenBalanceRaw,
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
	{
		name: "transaction",
		root: "nulo:core:txs",
		parse: (raw: unknown) => TxSchema.parse(raw),
		full: {
			chainId: 1,
			account: "0xa",
			nonce: "n1",
			feePaymentMethod: 2,
			hash: "0xtx",
			createdAt: 1,
			updatedAt: 2,
			status: TxStatus.Finalized,
			executionResult: 0,
			block: { hash: "0xb", number: 7 },
			fee: "5",
			estimatedFee: "6",
			gasDetails: { l2GasLimit: 1, daGasLimit: 2, teardownL2GasLimit: 3, teardownDaGasLimit: 4 },
			error: "none",
			submittedEndpointUrl: "http://h",
			origin: { type: "ui" },
			calls: [
				{
					contract: "0xc",
					method: "transfer",
					args: [1, "two"],
					transfers: [{ from: "0xa", to: "0xb", token: { symbol: "T" }, type: 0, amount: "1" }],
				},
			],
		} as unknown as Tx,
		minimal: {
			chainId: 1,
			account: "0xa",
			nonce: "n2",
			feePaymentMethod: 0,
			hash: "0xtx2",
			createdAt: 1,
			updatedAt: 1,
			status: TxStatus.Pending,
			origin: { type: "dapp" },
			calls: [],
		} as unknown as Tx,
		drifted: {
			chainId: 1,
			account: "0xa",
			nonce: "n3",
			hash: "0xtx3",
			createdAt: 1,
			updatedAt: 1,
			status: "Pending",
			origin: {},
			calls: [],
		},
	},
	{
		name: "incoming-transfer-record-note",
		root: "nulo:core:incoming-transfers",
		parse: (raw: unknown) => IncomingTransferRecordSchema.parse(raw),
		full: {
			kind: "note",
			id: "note:p1|n1|0xsn",
			siloedNullifier: "0xsn",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 3,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xth",
			l2BlockNumber: 9,
			txIndexInBlock: 1,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 123,
			blockTimestamp: 456,
		} satisfies IncomingTransferRecord,
		minimal: {
			kind: "note",
			id: "note:p1|n1|0xsn2",
			siloedNullifier: "0xsn2",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			owner: "0xa",
			amountRaw: "1",
			noteHash: "0xnh2",
			txHash: "0xth2",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 1,
		} satisfies IncomingTransferRecord,
		drifted: {
			kind: "note",
			id: "note:p1|n1|0xsn3",
			siloedNullifier: "0xsn3",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			owner: "0xa",
			amountRaw: "1",
			noteHash: "0xnh3",
			txHash: "0xth3",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: "yes",
			discoveredAt: 1,
		},
	},
	{
		name: "incoming-transfer-record-public",
		root: "nulo:core:incoming-transfers",
		parse: (raw: unknown) => IncomingTransferRecordSchema.parse(raw),
		full: {
			kind: "public-event",
			id: "pub:p1|n1|0xth|2",
			from: "0xfrom",
			blockHash: "0xbh",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 3,
			amountRaw: "100",
			txHash: "0xth",
			l2BlockNumber: 9,
			txIndexInBlock: 1,
			indexInTx: 2,
			hidden: false,
			discoveredAt: 123,
			blockTimestamp: 456,
		} satisfies IncomingTransferRecord,
		minimal: {
			kind: "public-event",
			id: "pub:p1|n1|0xth2|0",
			from: "0xfrom2",
			blockHash: "0xbh2",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			amountRaw: "1",
			txHash: "0xth2",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 1,
		} satisfies IncomingTransferRecord,
		drifted: {
			kind: "public-event",
			id: "pub:p1|n1|0xth3|0",
			blockHash: "0xbh3",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			amountRaw: "1",
			txHash: "0xth3",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 1,
		},
	},
	{
		name: "incoming-trust",
		root: "nulo:core:incoming-trust",
		parse: (raw: unknown) => IncomingTrustRecordSchema.parse(raw),
		full: { profileId: "p1", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 5 } satisfies IncomingTrustRecord,
		minimal: { profileId: "p1", networkId: "n1", contract: "0xc2", state: "unknown", updatedAt: 0 } satisfies IncomingTrustRecord,
		drifted: { profileId: "p1", networkId: "n1", contract: "0xc3", state: "half-trusted", updatedAt: 0 },
	},
	{
		name: "dapp-session",
		root: "nulo:core:dappSessions",
		parse: (raw: unknown) => DappSessionSchema.parse(raw),
		full: {
			id: "s1",
			profileId: "p1",
			chainId: "31337",
			dappMetadata: { name: "D", description: "d", logo: "l", url: "https://d.example" },
			permissions: [{ methods: ["aztec_sendTx"], events: [] }],
			accounts: ["aztec:31337:0xa"],
			confirmationLevel: AccessLevel.Transactions,
			expiry: 999,
			verificationHash: "0xv",
			trustedVerification: true,
			accountAliases: { "aztec:31337:0xa": "Main" },
			capabilityGrants: [{ capability: { type: "accounts" }, grantedAt: 1 }],
			capabilityRejections: [{ capability: { type: "data" }, rejectedAt: 2 }],
		} as unknown as DappSession,
		minimal: {
			id: "s2",
			profileId: "p1",
			chainId: "31337",
			dappMetadata: {},
			permissions: [],
			accounts: [],
			confirmationLevel: AccessLevel.None,
			expiry: 0,
		} satisfies DappSession,
		drifted: {
			id: "s3",
			profileId: "p1",
			chainId: 31337,
			dappMetadata: {},
			permissions: [],
			accounts: [],
			confirmationLevel: AccessLevel.None,
			expiry: 0,
		},
	},
] as const

describe("durable-store codecs", () => {
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
