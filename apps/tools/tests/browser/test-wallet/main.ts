/**
 * The page tools frames. The connection handler starts synchronously so the SDK's discovery probe
 * (10 s) always finds it; the wallet itself — a PXE — is created on the first secure message.
 */
import { Fr } from "@aztec/aztec.js/fields"
import { IframeConnectionHandler } from "@aztec/wallet-sdk/iframe/handlers"
import { parseProfile, type Seed, TOOLS_APP_ID } from "./profile"
import type { TestWallet } from "./wallet"

const identity = __NULO_TEST_WALLET__
const profile = parseProfile(new URL(location.href).searchParams.get("profile"))

const logEl = document.getElementById("log") as HTMLPreElement
const line = (level: string, message: string, data?: unknown) => {
	logEl.textContent += `[${level}] ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`
	console[level === "error" ? "error" : "log"](`[test-wallet:${profile}] ${message}`, data ?? "")
}
const logger = {
	debug: () => {},
	info: (m: string, d?: unknown) => line("info", m, d),
	warn: (m: string, d?: unknown) => line("warn", m, d),
	error: (m: string, d?: unknown) => line("error", m, d),
}

let booting: Promise<TestWallet> | undefined
function boot(): Promise<TestWallet> {
	booting ??= (async () => {
		// The patch extends the SDK's WalletSchema singleton, which the handler consults per call: a
		// `plain` wallet never loads it, so its transport answers the Nulo RPCs with an unknown method.
		if (profile !== "plain") await import("@nulo/wallet-sdk-schema-patch/register")
		const { TestWallet } = await import("./wallet")
		const wallet = await TestWallet.createFor(profile, identity)
		for (const seed of window.__nuloTestWalletSeeds ?? []) line("info", `imported ${(await wallet.importSeed(seed)).toString()}`)
		return wallet
	})()
	return booting
}

/** Every RPC the handler dispatches, timed, on the wallet's own log: a stalled dApp read is
 *  otherwise invisible from the page. Methods are bound to the real wallet so its private fields
 *  keep working; the proxy only observes. */
let callSeq = 0
type Fault = { method: string; pattern?: string } & ({ kind: "reject"; message: string } | { kind: "hold" } | { kind: "swallow" })
let fault: Fault | undefined
/** The one-shot fault, consumed by the first matching call; `undefined` when this call is not it.
 *  A rejection answers the call with an error; a hold never answers it at all (the page that made
 *  it must be reloaded to get past it — the shape of a wallet that went away mid-call); a swallow
 *  RUNS the call but never answers it — a wallet that sent the transaction and lost the reply. */
function faultFor(method: string, args: unknown[]): Promise<never> | "swallow" | undefined {
	if (!fault || fault.method !== method) return undefined
	if (fault.pattern !== undefined && !JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v)).includes(fault.pattern))
		return undefined
	const taken = fault
	fault = undefined
	if (taken.kind === "swallow") {
		line("warn", `injected swallow on ${method}: the call runs, the page never hears back`)
		return "swallow"
	}
	if (taken.kind === "hold") {
		line("warn", `injected hold on ${method}: this call never answers`)
		return new Promise<never>(() => {})
	}
	line("warn", `injected fault on ${method}: ${taken.message}`)
	return Promise.reject(new Error(taken.message))
}
/** How often each wallet method was asked, since this frame loaded — what "nothing was submitted" is read from. */
const calls: Record<string, number> = {}

function traced(wallet: TestWallet): TestWallet {
	return new Proxy(wallet, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver)
			if (typeof value !== "function" || typeof prop !== "string") return value
			return (...args: unknown[]) => {
				const id = ++callSeq
				calls[prop] = (calls[prop] ?? 0) + 1
				const t0 = performance.now()
				line("info", `→ ${prop} #${id}`)
				const settle = (mark: string) => line("info", `${mark} ${prop} #${id} ${Math.round(performance.now() - t0)}ms`)
				const injected = faultFor(prop, args)
				if (injected === "swallow") {
					void Promise.resolve(value.apply(target, args)).then(
						() => settle("← (swallowed)"),
						() => settle("✗ (swallowed)"),
					)
					return new Promise<never>(() => {})
				}
				if (injected) {
					settle("✗")
					return injected
				}
				const out: unknown = value.apply(target, args)
				if (out instanceof Promise) {
					out.then(
						() => settle("←"),
						() => settle("✗"),
					)
				} else settle("←")
				return out
			}
		},
	})
}

const asBigInt = (v: unknown) => Fr.fromString(String(v)).toBigInt()
function assertSandboxChain(chainInfo: unknown): void {
	const { chainId, version } = chainInfo as { chainId: unknown; version: unknown }
	if (asBigInt(chainId) !== BigInt(identity.l1ChainId) || asBigInt(version) !== BigInt(identity.rollupVersion)) {
		throw new Error(`test wallet: chain ${String(chainId)}/${String(version)} is not the sandbox`)
	}
}

const handler = new IframeConnectionHandler(
	{
		walletId: `nulo-test-wallet-${profile}`,
		walletName: `Nulo test wallet (${profile})`,
		walletVersion: "0.0.0",
		allowedOrigins: [identity.toolsOrigin],
		logger,
	},
	{
		onPendingDiscovery: (session) => handler.approveDiscovery(session.requestId),
		getWallet: (appId, chainInfo) => {
			if (appId !== TOOLS_APP_ID) throw new Error(`test wallet: app "${appId}" is not tools`)
			assertSandboxChain(chainInfo)
			return boot().then(traced)
		},
	},
)
handler.start()
document.getElementById("profile")!.textContent = profile

window.__nuloTestWallet = {
	profile,
	ready: () => boot().then(() => undefined),
	addAccount: async (secret, salt = "1") => (await boot()).importSeed({ secret, salt } as Seed).then((a) => a.toString()),
	accounts: async () => (await boot()).getAccounts().then((list) => list.map((a) => a.item.toString())),
	calls: () => ({ ...calls }),
	submitted: async () => (await boot()).submitted.map((t) => ({ ...t, feeLimit: t.feeLimit.toString() })),
	failNext: (method, pattern, message = `test wallet: injected failure of ${method}`) => {
		fault = { kind: "reject", method, pattern, message }
	},
	holdNext: (method, pattern) => {
		fault = { kind: "hold", method, pattern }
	},
	swallowNext: (method, pattern) => {
		fault = { kind: "swallow", method, pattern }
	},
	dropNextSubmission: async () => {
		;(await boot()).dropNextSubmission = true
	},
	declineNextGrant: async () => {
		;(await boot()).declineNextGrant = true
	},
}
