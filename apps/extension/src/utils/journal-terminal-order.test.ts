/**
 * The journal cards' evaluation order. The terminal card makes one token lookup and formats the
 * amount before it reads the title and the transfer type; neither card touches the token lookup
 * for a dApp op. A Vue render tracks whatever it reads before a throw, so the order is behaviour.
 */

import { describe, expect, test } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { buildJournalTerminalCardProps, journalCardTitle } from "./journal-state"

const CARD_KEYS = new Set(["tokenId", "amountRaw", "transferType", "title", "subtitle"])

function recorded<T extends object>(target: T, name: string, log: string[], keys?: Set<string>): T {
	return new Proxy(target, {
		get(t, key, receiver) {
			if (typeof key === "string" && (!keys || keys.has(key))) log.push(`${name}.${key}`)
			return Reflect.get(t, key, receiver)
		},
	})
}

function terminal(overrides: Partial<OperationRecord>): OperationRecord {
	return {
		id: "00",
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		progress: { stage: "cancelled" },
		error: null,
		terminalAt: 1_000,
		attempts: 0,
		createdAt: 0,
		updatedAt: 1_000,
		...overrides,
	}
}

function build(op: OperationRecord, log: string[]) {
	const token = recorded({ symbol: "USDC", decimals: 6 }, "token", log)
	const lookups: number[] = []
	const ctx = recorded(
		{
			tokenById: (id: number) => {
				lookups.push(id)
				log.push(`lookup(${id})`)
				return id === 42 ? token : undefined
			},
		},
		"ctx",
		log,
	)
	return { run: () => buildJournalTerminalCardProps(recorded(op, "op", log, CARD_KEYS), ctx), lookups }
}

describe("buildJournalTerminalCardProps — evaluation order", () => {
	test("a transfer card looks its token up once and formats the amount before the title and type", () => {
		const log: string[] = []
		const { run, lookups } = build(terminal({ tokenId: 42, amountRaw: "1500000", transferType: 0 }), log)
		expect(run()).toMatchObject({ title: "USDC", amount: "1.5", amountSymbol: "USDC" })
		expect(lookups).toEqual([42])
		expect(log).toEqual([
			"op.tokenId",
			"ctx.tokenById",
			"op.tokenId",
			"lookup(42)",
			"op.amountRaw",
			"op.amountRaw",
			"token.decimals",
			"token.symbol",
			"token.symbol",
			"op.transferType",
			"op.transferType",
		])
	})

	test("an amount that fails to format throws before the title or the transfer type is read", () => {
		const log: string[] = []
		const { run, lookups } = build(terminal({ tokenId: 42, amountRaw: "bad", transferType: 0 }), log)
		expect(run).toThrow()
		expect(lookups).toEqual([42])
		expect(log).toEqual(["op.tokenId", "ctx.tokenById", "op.tokenId", "lookup(42)", "op.amountRaw", "op.amountRaw", "token.decimals"])
	})

	test("a dApp card never reads the token lookup, even when its record carries a token id", () => {
		const log: string[] = []
		const { run, lookups } = build(
			terminal({ kind: "dapp_execute", origin: "dapp", tokenId: 42, amountRaw: "1500000", title: "swap", subtitle: "alpha.example" }),
			log,
		)
		expect(run()).toMatchObject({ title: "Swap", originLabel: "alpha.example", amount: null })
		expect(lookups).toEqual([])
		expect(log).toEqual(["op.title", "op.title", "op.subtitle"])
	})
})

describe("journalCardTitle — the awaiting card's title", () => {
	test("a dApp op never calls the token lookup; a transfer calls it once", () => {
		const lookups: number[] = []
		const tokenById = (id: number) => {
			lookups.push(id)
			return id === 42 ? { symbol: "USDC", decimals: 6 } : undefined
		}
		expect(journalCardTitle(terminal({ kind: "dapp_execute", origin: "dapp", tokenId: 42, title: "swap" }), tokenById)).toBe("Swap")
		expect(lookups).toEqual([])
		expect(journalCardTitle(terminal({ tokenId: 42 }), tokenById)).toBe("USDC")
		expect(lookups).toEqual([42])
	})
})
