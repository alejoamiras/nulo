/**
 * An injected EIP-1193 wallet for the tools page, answered from Node: the page's `window.ethereum`
 * forwards every request through an exposed function to a viem wallet client over the sandbox's
 * anvil, which signs with the run's actor key. Wrong-chain, account-change and rejection cells
 * drive it through the control it returns.
 */
import type { BrowserContext, Page } from "@playwright/test"
import { type Address, createWalletClient, defineChain, type Hex, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export interface L1WalletOptions {
	rpcUrl: string
	privateKey: Hex
	chainId: number
}

export type RejectKind = "signature" | "transaction"

/** Narrows a hold to one transaction target — the deposit's router, not the ERC-20 approval before it. */
export interface HoldMatch {
	to?: Address
}

/** One Permit2 `PermitWitnessTransferFrom` the page asked the wallet to sign, as signed, with the wallet's clock. */
export interface SignedPermit {
	signedAt: number
	domain: { name?: string; chainId?: number; verifyingContract?: string }
	primaryType: string
	permitted: { token: string; amount: bigint }
	spender: string
	nonce: bigint
	deadline: bigint
	witness: Record<string, unknown>
}

export interface L1WalletControl {
	address: Address
	/** Everything the page has had signed so far — typed data, transactions, messages. */
	readonly signatures: number
	/** Every Permit2 permit signed so far, in order (other typed data is not a permit and is not listed). */
	permits(): SignedPermit[]
	/** How often the page asked for one wallet-side method (`eth_sendTransaction`,
	 *  `eth_signTypedData_v4`, `personal_sign`), held and refused calls included. */
	calls(method: string): number
	/** The chain `eth_chainId` answers; a change emits `chainChanged` in every page of the context. */
	setChainId(chainId: number): Promise<void>
	/** Swap the signing key; emits `accountsChanged`. */
	setAccount(privateKey: Hex): Promise<void>
	/** The next request of that kind is refused with EIP-1193 code 4001. */
	rejectNext(kind: RejectKind): void
	/** The next request of that kind (matching `match` when given) never answers — the shape of a
	 *  wallet whose prompt the user left open; the page that made it must be reloaded to get past it. */
	holdNext(kind: RejectKind, match?: HoldMatch): void
}

type Rpc = { method: string; params?: unknown[] }

const USER_REJECTED = { code: 4001, message: "User rejected the request." }

/** JSON turned every bigint into a string on the way over; the ABI types say which ones to restore. */
function coerceTyped(types: Record<string, { name: string; type: string }[]>, type: string, value: unknown): unknown {
	const fields = types[type]
	if (!fields || typeof value !== "object" || value === null) return value
	const out: Record<string, unknown> = {}
	for (const f of fields) {
		const v = (value as Record<string, unknown>)[f.name]
		if (/^u?int\d*$/.test(f.type)) out[f.name] = typeof v === "string" ? BigInt(v) : v
		else if (f.type.endsWith("[]")) out[f.name] = Array.isArray(v) ? v.map((x) => coerceTyped(types, f.type.slice(0, -2), x)) : v
		else out[f.name] = coerceTyped(types, f.type, v)
	}
	return out
}

/** The `eth_signTypedData_v4` payload as viem signs it: the domain's chain id numeric, `EIP712Domain` out of `types`. */
function typedDataOf(json: string) {
	const typed = JSON.parse(json) as {
		domain: Record<string, unknown>
		types: Record<string, { name: string; type: string }[]>
		primaryType: string
		message: Record<string, unknown>
	}
	const domain = { ...typed.domain, chainId: typed.domain.chainId === undefined ? undefined : Number(typed.domain.chainId) }
	const { EIP712Domain: _domain, ...types } = typed.types
	return {
		domain,
		types,
		primaryType: typed.primaryType,
		message: coerceTyped(types, typed.primaryType, typed.message) as Record<string, unknown>,
	}
}

export async function installL1Wallet(context: BrowserContext, o: L1WalletOptions): Promise<L1WalletControl> {
	const chain = (id: number) =>
		defineChain({
			id,
			name: `anvil-${id}`,
			nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
			rpcUrls: { default: { http: [o.rpcUrl] } },
		})
	let account = privateKeyToAccount(o.privateKey)
	let chainId = o.chainId
	let client = createWalletClient({ account, chain: chain(chainId), transport: http(o.rpcUrl) })
	const rejections = new Set<RejectKind>()
	const holds: Array<{ kind: RejectKind; match?: HoldMatch }> = []
	const counts: Record<string, number> = {}
	const permits: SignedPermit[] = []
	let signed = 0
	const recordPermit = (typed: ReturnType<typeof typedDataOf>) => {
		if (typed.primaryType !== "PermitWitnessTransferFrom") return
		const m = typed.message as {
			permitted: { token: string; amount: bigint }
			spender: string
			nonce: bigint
			deadline: bigint
			witness: Record<string, unknown>
		}
		permits.push({
			signedAt: Math.floor(Date.now() / 1000),
			domain: typed.domain as SignedPermit["domain"],
			primaryType: typed.primaryType,
			permitted: m.permitted,
			spender: m.spender,
			nonce: m.nonce,
			deadline: m.deadline,
			witness: m.witness,
		})
	}
	const takeRejection = (kind: RejectKind) => rejections.delete(kind)
	/** A matching hold is consumed and the call parks forever; a hold for another target stays armed. */
	const takeHold = (kind: RejectKind, to?: string): Promise<never> | undefined => {
		const i = holds.findIndex((h) => h.kind === kind && (h.match?.to === undefined || h.match.to.toLowerCase() === to?.toLowerCase()))
		if (i < 0) return undefined
		holds.splice(i, 1)
		return new Promise<never>(() => {})
	}
	const count = (method: string) => {
		counts[method] = (counts[method] ?? 0) + 1
	}

	const emit = (event: string, payload: unknown) =>
		Promise.all(
			context.pages().map((p) => p.evaluate(([e, v]) => window.__nuloL1Emit?.(e, v), [event, payload] as const).catch(() => {})),
		)

	const switchChain = async (id: number) => {
		chainId = id
		client = createWalletClient({ account, chain: chain(chainId), transport: http(o.rpcUrl) })
		await emit("chainChanged", `0x${id.toString(16)}`)
	}
	const refuse = (kind: RejectKind) => {
		if (takeRejection(kind)) throw USER_REJECTED
	}

	/** The wallet-side methods; anything else is a node read, proxied to anvil as-is. */
	const wallet: Record<string, (params: unknown[]) => Promise<unknown>> = {
		eth_requestAccounts: async () => [account.address],
		eth_accounts: async () => [account.address],
		eth_chainId: async () => `0x${chainId.toString(16)}`,
		wallet_switchEthereumChain: async (params) => {
			await switchChain(Number.parseInt((params[0] as { chainId: string }).chainId, 16))
			return null
		},
		eth_sendTransaction: (params) => {
			count("eth_sendTransaction")
			refuse("transaction")
			const tx = params[0] as { to?: Address; data?: Hex; value?: Hex; gas?: Hex }
			const held = takeHold("transaction", tx.to)
			if (held) return held
			signed++
			return client.sendTransaction({
				to: tx.to,
				data: tx.data,
				value: tx.value ? BigInt(tx.value) : undefined,
				gas: tx.gas ? BigInt(tx.gas) : undefined,
			})
		},
		eth_signTypedData_v4: (params) => {
			count("eth_signTypedData_v4")
			refuse("signature")
			const held = takeHold("signature")
			if (held) return held
			signed++
			const typed = typedDataOf(params[1] as string)
			recordPermit(typed)
			return account.signTypedData(typed)
		},
		personal_sign: (params) => {
			count("personal_sign")
			refuse("signature")
			const held = takeHold("signature")
			if (held) return held
			signed++
			return account.signMessage({ message: { raw: params[0] as Hex } })
		},
	}
	const handle = (rpc: Rpc) => {
		const params = rpc.params ?? []
		const method = wallet[rpc.method]
		return method ? method(params) : client.request({ method: rpc.method, params } as never)
	}

	// NULO_E2E_TRACE_L1=1 prints every request and its outcome to the runner's stdout.
	const trace = process.env.NULO_E2E_TRACE_L1 === "1" ? (line: string) => console.log(`[l1] ${line}`) : () => {}
	await context.exposeFunction("__nuloL1Request", async (json: string) => {
		const rpc = JSON.parse(json) as Rpc
		try {
			const result = await handle(rpc)
			trace(`${rpc.method} → ${JSON.stringify(result)?.slice(0, 80)}`)
			return JSON.stringify({ result })
		} catch (e) {
			const err = e as { code?: number; message?: string; shortMessage?: string }
			trace(`${rpc.method} ✗ ${err.shortMessage ?? err.message ?? String(e)}`)
			return JSON.stringify({ error: { code: err.code ?? -32000, message: err.shortMessage ?? err.message ?? String(e) } })
		}
	})
	await context.addInitScript(() => {
		const listeners = new Map<string, Set<(v: unknown) => void>>()
		const provider = {
			isNuloTestWallet: true,
			async request(args: { method: string; params?: unknown[] }) {
				const reply = JSON.parse(await window.__nuloL1Request(JSON.stringify(args))) as {
					result?: unknown
					error?: { code: number; message: string }
				}
				if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code })
				return reply.result
			},
			on(event: string, fn: (v: unknown) => void) {
				listeners.set(event, (listeners.get(event) ?? new Set()).add(fn))
				return provider
			},
			removeListener(event: string, fn: (v: unknown) => void) {
				listeners.get(event)?.delete(fn)
				return provider
			},
		}
		window.__nuloL1Emit = (event, value) => {
			for (const fn of listeners.get(event) ?? []) fn(value)
		}
		Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: false })
	})

	return {
		get address() {
			return account.address
		},
		get signatures() {
			return signed
		},
		calls: (method) => counts[method] ?? 0,
		permits: () => [...permits],
		setChainId: switchChain,
		async setAccount(privateKey) {
			account = privateKeyToAccount(privateKey)
			client = createWalletClient({ account, chain: chain(chainId), transport: http(o.rpcUrl) })
			await emit("accountsChanged", [account.address])
		},
		rejectNext(kind) {
			rejections.add(kind)
		},
		holdNext(kind, match) {
			holds.push({ kind, match })
		},
	}
}

/** The frame a page hosts for the test wallet, once the SDK has created it. */
export function walletFrameOf(page: Page, walletOrigins: readonly string[]) {
	return page.frames().find((f) => walletOrigins.includes(originOf(f.url())) && f.url().includes("profile="))
}

function originOf(url: string): string {
	try {
		return new URL(url).origin
	} catch {
		return ""
	}
}

declare global {
	interface Window {
		__nuloL1Request: (json: string) => Promise<string>
		__nuloL1Emit?: (event: string, value: unknown) => void
	}
}
