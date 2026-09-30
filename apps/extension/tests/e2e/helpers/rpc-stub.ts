/**
 * A JSON-RPC stub for specs that reroute a seed's endpoint through `interceptRpc`'s `redirect`:
 * it binds an OS-assigned port (parallel-agent safe) and logs every method it receives; `answer`
 * decides which methods get a reply, and every other request blackholes (accepted, never
 * answered).
 */
import { createServer, type Server } from "node:http"
import type { AddressInfo, Socket } from "node:net"

const ZERO_ETH = `0x${"00".repeat(20)}`
const ZERO_AZTEC = `0x${"00".repeat(32)}`

/** Schema-valid `getNodeInfo` result (NodeInfoSchema: @aztec/stdlib contract/interfaces/node-info)
 *  for the chain the pair names: the wallet's identity check composes the two into its chain id
 *  (`walletChainId`), except for the local seed, which it pins by `l1ChainId` alone. */
export function nodeInfoResult(l1ChainId: number, rollupVersion: number): Record<string, unknown> {
	return {
		nodeVersion: "0.0.0-stub",
		l1ChainId,
		rollupVersion,
		l1ContractAddresses: Object.fromEntries(
			[
				"rollupAddress",
				"registryAddress",
				"inboxAddress",
				"outboxAddress",
				"feeJuiceAddress",
				"feeJuicePortalAddress",
				"coinIssuerAddress",
				"rewardDistributorAddress",
				"governanceProposerAddress",
				"governanceAddress",
				"stakingAssetAddress",
			].map((k) => [k, ZERO_ETH]),
		),
		protocolContractAddresses: {
			classRegistry: ZERO_AZTEC,
			feeJuice: ZERO_AZTEC,
			instanceRegistry: ZERO_AZTEC,
			multiCallEntrypoint: ZERO_AZTEC,
		},
		realProofs: false,
		txsLimits: { gas: { daGas: 0, l2Gas: 0 } },
	}
}

export interface StubServer {
	url: string
	methods: string[]
	close: () => Promise<void>
}

export type BatchPlan = { kind: "unparsed" } | { kind: "blackhole" } | { kind: "replies"; payload: unknown }

/** Plans the stub's answer to one request body. The aztec JSON-RPC client BATCHES: bodies
 *  arrive as arrays of request envelopes. Every element is logged into `methods` and asked of
 *  `answer`, in order, even after one proves unanswerable — a batch with ANY unanswerable element
 *  blackholes whole (no partial responses); a bare request answers as a bare object. An `answer`
 *  throw escapes. */
export function planBatchReplies(body: string, answer: (method: string) => unknown | undefined, methods: string[]): BatchPlan {
	let entries: Array<{ method?: string; id?: unknown }>
	let wasBatch = false
	try {
		const parsed = JSON.parse(body) as { method?: string } | Array<{ method?: string }>
		wasBatch = Array.isArray(parsed)
		entries = Array.isArray(parsed) ? parsed : [parsed]
	} catch {
		methods.push(`<unparsed:${body.slice(0, 60)}>`)
		return { kind: "unparsed" }
	}
	const replies: unknown[] = []
	let blackhole = false
	for (const entry of entries) {
		const method = entry?.method ?? "<no-method>"
		methods.push(method)
		const result = answer(method)
		if (result === undefined) blackhole = true
		else replies.push({ jsonrpc: "2.0", id: entry?.id ?? null, result })
	}
	if (blackhole) return { kind: "blackhole" }
	return { kind: "replies", payload: wasBatch ? replies : replies[0] }
}

export function startStub(answer: (method: string) => unknown | undefined): Promise<StubServer> {
	return new Promise((resolve) => {
		const methods: string[] = []
		const sockets = new Set<Socket>()
		const server: Server = createServer((req, res) => {
			let body = ""
			req.on("data", (c) => {
				body += String(c)
			})
			req.on("end", () => {
				const plan = planBatchReplies(body, answer, methods)
				if (plan.kind !== "replies") return
				res.setHeader("content-type", "application/json")
				res.end(JSON.stringify(plan.payload))
			})
		})
		server.on("connection", (s) => {
			sockets.add(s)
			s.on("close", () => sockets.delete(s))
		})
		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as AddressInfo).port
			resolve({
				url: `http://127.0.0.1:${port}`,
				methods,
				close: () =>
					new Promise<void>((r) => {
						for (const s of sockets) s.destroy()
						server.close(() => r())
					}),
			})
		})
	})
}
