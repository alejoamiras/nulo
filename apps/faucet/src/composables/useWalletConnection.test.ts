import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * Mocks for the SDK boundary. The composable is module-singleton so we
 * import lazily AFTER the mocks register; each test exercises a state
 * transition under controlled SDK responses.
 *
 * The pure helper `extractGrantedAccounts` is unit-tested directly without
 * any mocking - it's import-stable.
 */

const mockEstablishSecureChannel = vi.fn()
const mockDisconnectProvider = vi.fn()
const mockOnDisconnect = vi.fn<(handler: () => void) => () => void>()
let lastDisconnectHandler: (() => void) | null = null

const mockProvider = {
	id: "nulo",
	name: "Nulo",
	establishSecureChannel: mockEstablishSecureChannel,
	disconnect: mockDisconnectProvider,
	isDisconnected: () => false,
	onDisconnect: (handler: () => void) => mockOnDisconnect(handler),
}

async function* yieldOne() {
	yield mockProvider
}

async function* yieldNone(): AsyncGenerator<typeof mockProvider, void, unknown> {
	// no providers - empty discovery
}

const mockGetAvailableWallets = vi.fn(() => ({
	wallets: yieldOne(),
	cancel: () => {},
	done: Promise.resolve(),
}))

vi.mock("@aztec/wallet-sdk/manager", () => ({
	WalletManager: {
		configure: vi.fn(() => ({
			getAvailableWallets: mockGetAvailableWallets,
		})),
	},
}))

vi.mock("@/lib/emoji", () => ({
	hashToEmoji: () => "🟢🔵🟡🟣🔴⚪⚫🟠🟤",
	toGrid: (s: string) => Array.from(s).slice(0, 9),
}))

vi.mock("@aztec/aztec.js/node", () => ({
	createAztecNodeClient: () => ({ getContract: async () => null }),
}))

vi.mock("@/contracts/deployments", () => ({
	DRIPPER: { toString: () => "0x1" },
	NULO: { toString: () => "0x2" },
	OLUN: { toString: () => "0x3" },
	rebuildDripperInstance: vi.fn(async () => ({ address: { toString: () => "0x1" } })),
	rebuildNuloInstance: vi.fn(async () => ({ address: { toString: () => "0x2" } })),
	rebuildOlunInstance: vi.fn(async () => ({ address: { toString: () => "0x3" } })),
}))

vi.mock("@/contracts/bridge-deployments", () => ({
	BRIDGE_FUEL: undefined,
	L1_USDC: "0xl1token",
	BRIDGE_TOKEN_SYMBOL: "USDC",
	BRIDGE_TOKEN_DECIMALS: 6,
	BRIDGE: { toString: () => "0x4" },
	BRIDGE_TOKEN: { toString: () => "0x5" },
	BRIDGE_PROXY: { toString: () => "0x6" },
	rebuildBridgeInstance: vi.fn(async () => ({ address: { toString: () => "0x4" } })),
	rebuildBridgeTokenInstance: vi.fn(async () => ({ address: { toString: () => "0x5" } })),
	rebuildBridgeProxyInstance: vi.fn(async () => ({ address: { toString: () => "0x6" } })),
}))

vi.mock("@nulo/bridge-core/artifacts", () => ({
	bridgeProxyArtifact: { name: "BridgeProxy" },
	tokenBridgeArtifact: { name: "TokenBridge" },
}))

vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js", () => ({
	DripperContractArtifact: { name: "Dripper" },
}))
vi.mock("@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js", () => ({
	TokenContractArtifact: { name: "Token" },
}))
vi.mock("@/contracts/sponsored-fpc", () => ({
	getSponsoredFpcInstance: async () => ({
		address: { toString: () => "0xfpc" },
	}),
}))
vi.mock("@/contracts/private-fpc", () => ({
	getPrivateFpc: async () => ({
		instance: { address: { toString: () => "0xprivatefpc" } },
		artifact: {},
	}),
}))

import { extractGrantedAccounts, useWalletConnection, __resetWalletConnectionForTests } from "./useWalletConnection"

function makeWallet(grantedAccounts: Array<{ alias?: string; item?: string }> = []) {
	return {
		requestCapabilities: vi.fn(async () => ({
			granted: [{ type: "accounts", accounts: grantedAccounts }],
		})),
		registerContract: vi.fn(async () => {}),
	}
}

function makePending(opts: { verificationHash?: string; confirmReturns?: unknown; confirmThrows?: Error } = {}) {
	return {
		verificationHash: opts.verificationHash ?? "deadbeef",
		confirm: vi.fn(async () => {
			if (opts.confirmThrows) throw opts.confirmThrows
			return opts.confirmReturns ?? makeWallet([{ alias: "Main", item: "0xa1b2c3" }])
		}),
		cancel: vi.fn(async () => {}),
	}
}

describe("useWalletConnection", () => {
	beforeEach(() => {
		__resetWalletConnectionForTests()
		mockEstablishSecureChannel.mockReset()
		mockDisconnectProvider.mockReset()
		mockOnDisconnect.mockReset()
		lastDisconnectHandler = null
		mockOnDisconnect.mockImplementation((handler: () => void) => {
			lastDisconnectHandler = handler
			return () => {
				lastDisconnectHandler = null
			}
		})
		mockGetAvailableWallets.mockReset()
		mockGetAvailableWallets.mockImplementation(() => ({
			wallets: yieldOne(),
			cancel: () => {},
			done: Promise.resolve(),
		}))
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("starts in 'idle' state with empty fields", () => {
		const c = useWalletConnection()
		expect(c.status.value).toBe("idle")
		expect(c.wallet.value).toBeNull()
		expect(c.accounts.value).toEqual([])
		expect(c.selectedAccount.value).toBeNull()
		expect(c.verificationEmojis.value).toBeNull()
	})

	it("connect() transitions idle → discovering → verifying with emoji grid populated", async () => {
		const pending = makePending({ verificationHash: "abc123" })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		expect(c.status.value).toBe("verifying")
		expect(c.verificationEmojis.value).toBe("🟢🔵🟡🟣🔴⚪⚫🟠🟤")
	})

	it("confirmVerification() runs the capability handshake and lands in 'connected'", async () => {
		const wallet = makeWallet([{ alias: "Main", item: "0xa1b2c3" }])
		const pending = makePending({ confirmReturns: wallet })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.confirmVerification()
		expect(c.status.value).toBe("connected")
		expect(c.selectedAccount.value).toBe("0xa1b2c3")
		expect(c.accounts.value).toEqual([{ address: "0xa1b2c3", alias: "Main" }])
		// 7 = the combined faucet + bridge set (dripper, usdc, eth, proxy, token, bridge) + the PrivateFPC
		// (pre-registered so the no-fuel-claim private Fee-Juice balance read works under 5.0.1).
		expect(wallet.registerContract).toHaveBeenCalledTimes(7)
	})

	it("capability rejection lands in 'error' state with the capability-rejected category", async () => {
		const wallet = {
			requestCapabilities: vi.fn(async () => {
				throw new Error("Capability denied by user")
			}),
			registerContract: vi.fn(),
		}
		const pending = makePending({ confirmReturns: wallet })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.confirmVerification()
		expect(c.status.value).toBe("error")
		expect(c.error.value?.category).toBe("capability-rejected")
	})

	it("cancelVerification() invokes pending.cancel and resets to idle", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.cancelVerification()
		expect(pending.cancel).toHaveBeenCalled()
		expect(c.status.value).toBe("idle")
		expect(c.verificationEmojis.value).toBeNull()
	})

	it("connect() with no provider available transitions to 'error'", async () => {
		mockGetAvailableWallets.mockImplementationOnce(() => ({
			wallets: yieldNone(),
			cancel: () => {},
			done: Promise.resolve(),
		}))
		const c = useWalletConnection()
		await c.connect()
		expect(c.status.value).toBe("error")
		expect(c.error.value?.message).toMatch(/no wallet/i)
	})

	it("retryCapabilities re-runs the capability request after a rejection", async () => {
		const grants = [
			() => {
				throw new Error("Capability denied")
			},
			async () => ({ granted: [{ type: "accounts", accounts: [{ alias: "Main", item: "0xabc" }] }] }),
		]
		const wallet = {
			requestCapabilities: vi.fn(async () => {
				const fn = grants.shift()
				if (!fn) throw new Error("exhausted")
				return await fn()
			}),
			registerContract: vi.fn(async () => {}),
		}
		const pending = makePending({ confirmReturns: wallet })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.confirmVerification()
		expect(c.status.value).toBe("error")
		await c.retryCapabilities()
		expect(c.status.value).toBe("connected")
		expect(c.selectedAccount.value).toBe("0xabc")
	})

	it("disconnect() calls provider.disconnect and resets state to idle", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.confirmVerification()
		await c.disconnect()
		expect(mockDisconnectProvider).toHaveBeenCalled()
		expect(c.status.value).toBe("idle")
		expect(c.wallet.value).toBeNull()
		expect(c.accounts.value).toEqual([])
	})

	it("multiple connect() calls in a row are no-ops while a flow is in progress", async () => {
		mockEstablishSecureChannel.mockImplementation(
			() => new Promise(() => {}), // never resolves
		)
		const c = useWalletConnection()
		const a = c.connect()
		const b = c.connect()
		await Promise.race([Promise.all([a, b]), new Promise((r) => setTimeout(r, 50))])
		expect(mockGetAvailableWallets).toHaveBeenCalledTimes(1)
	})

	it("subscribes to provider.onDisconnect during connect and resets state when it fires", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.confirmVerification()
		expect(c.status.value).toBe("connected")
		expect(mockOnDisconnect).toHaveBeenCalledTimes(1)
		// Simulate the wallet dropping the channel on its end.
		lastDisconnectHandler?.()
		expect(c.status.value).toBe("idle")
		expect(c.wallet.value).toBeNull()
		expect(c.accounts.value).toEqual([])
	})

	it("granted-accounts rejection (empty granted.accounts) lands in 'error'", async () => {
		const wallet = makeWallet([]) // no accounts granted
		const pending = makePending({ confirmReturns: wallet })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		await c.confirmVerification()
		expect(c.status.value).toBe("error")
	})
})

describe("extractGrantedAccounts", () => {
	it("returns [] when input is null, undefined, or non-object", () => {
		expect(extractGrantedAccounts(null)).toEqual([])
		expect(extractGrantedAccounts(undefined)).toEqual([])
		expect(extractGrantedAccounts("nope")).toEqual([])
	})

	it("returns [] when no accounts capability is present", () => {
		expect(extractGrantedAccounts({ granted: [{ type: "contracts" }] })).toEqual([])
	})

	it("maps {alias, item} entries and stringifies item objects", () => {
		const out = extractGrantedAccounts({
			granted: [
				{
					type: "accounts",
					accounts: [
						{ alias: "Main", item: { toString: () => "0xaaa" } },
						{ alias: "Saver", item: "0xbbb" },
					],
				},
			],
		})
		expect(out).toEqual([
			{ address: "0xaaa", alias: "Main" },
			{ address: "0xbbb", alias: "Saver" },
		])
	})
})
