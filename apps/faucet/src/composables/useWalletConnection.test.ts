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
import { __resetOpsInFlightForTests, withOperation } from "./useOpsInFlight"
import { __resetToastsForTests, useToast } from "./useToast"
import { nextTick } from "vue"

// Full-length canonical addresses: the hardened parser round-trips AztecAddress.fromStringUnsafe,
// which requires 32-byte hex (short fakes are rejected as malformed grant entries).
const ADDR_MAIN = `0x${"a1b2c3".padStart(64, "0")}`
const ADDR_A = `0x${"aaa".padStart(64, "0")}`
const ADDR_B = `0x${"bbb".padStart(64, "0")}`
const ADDR_ABC = `0x${"abc".padStart(64, "0")}`

function makeWallet(grantedAccounts: Array<{ alias?: string; item?: string }> = []) {
	return {
		requestCapabilities: vi.fn(async () => ({
			granted: [{ type: "accounts", accounts: grantedAccounts }],
		})),
		registerContract: vi.fn(async () => {}),
	}
}

/** connect() → picker → pick the sole row. The always-show picker means every
 *  legacy chain now passes through "choosing" + selectWallet. */
async function connectAndPick(c: ReturnType<typeof useWalletConnection>) {
	await c.connect()
	expect(c.status.value).toBe("choosing")
	c.selectWallet(c.discoveredWallets.value[0].key)
	// selectWallet transitions synchronously, then establishes async.
	for (let i = 0; i < 6; i++) await Promise.resolve()
}

function makePending(opts: { verificationHash?: string; confirmReturns?: unknown; confirmThrows?: Error } = {}) {
	return {
		verificationHash: opts.verificationHash ?? "deadbeef",
		confirm: vi.fn(async () => {
			if (opts.confirmThrows) throw opts.confirmThrows
			return opts.confirmReturns ?? makeWallet([{ alias: "Main", item: ADDR_MAIN }])
		}),
		cancel: vi.fn(async () => {}),
	}
}

describe("useWalletConnection", () => {
	beforeEach(() => {
		localStorage.clear()
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

	it("connect() lands in 'choosing'; selecting the row reaches 'verifying' with the emoji grid", async () => {
		const pending = makePending({ verificationHash: "abc123" })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await c.connect()
		expect(c.status.value).toBe("choosing")
		expect(c.discoveredWallets.value).toHaveLength(1)
		c.selectWallet(c.discoveredWallets.value[0].key)
		expect(c.status.value).toBe("verifying")
		for (let i = 0; i < 6; i++) await Promise.resolve()
		expect(c.verificationEmojis.value).toBe("🟢🔵🟡🟣🔴⚪⚫🟠🟤")
	})

	it("confirmVerification() runs the capability handshake and lands in 'connected'", async () => {
		const wallet = makeWallet([{ alias: "Main", item: ADDR_MAIN }])
		const pending = makePending({ confirmReturns: wallet })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await connectAndPick(c)
		await c.confirmVerification()
		expect(c.status.value).toBe("connected")
		expect(c.selectedAccount.value).toBe(ADDR_MAIN)
		expect(c.accounts.value).toEqual([{ address: ADDR_MAIN, alias: "Main" }])
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
		await connectAndPick(c)
		await c.confirmVerification()
		expect(c.status.value).toBe("error")
		expect(c.error.value?.category).toBe("capability-rejected")
	})

	it("cancelVerification() invokes pending.cancel and resets to idle", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await connectAndPick(c)
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
			async () => ({ granted: [{ type: "accounts", accounts: [{ alias: "Main", item: ADDR_ABC }] }] }),
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
		await connectAndPick(c)
		await c.confirmVerification()
		expect(c.status.value).toBe("error")
		await c.retryCapabilities()
		expect(c.status.value).toBe("connected")
		expect(c.selectedAccount.value).toBe(ADDR_ABC)
	})

	it("disconnect() calls provider.disconnect and resets state to idle", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await connectAndPick(c)
		await c.confirmVerification()
		await c.disconnect()
		expect(mockDisconnectProvider).toHaveBeenCalled()
		expect(c.status.value).toBe("idle")
		expect(c.wallet.value).toBeNull()
		expect(c.accounts.value).toEqual([])
	})

	it("multiple connect() calls are no-ops while a flow is live (including while choosing)", async () => {
		const c = useWalletConnection()
		const a = c.connect()
		const b = c.connect() // concurrent: second must not start a discovery
		await Promise.all([a, b])
		expect(mockGetAvailableWallets).toHaveBeenCalledTimes(1)
		expect(c.status.value).toBe("choosing")
		await c.connect() // while the picker is open: still a no-op
		expect(mockGetAvailableWallets).toHaveBeenCalledTimes(1)
	})

	it("subscribes to provider.onDisconnect during connect and resets state when it fires", async () => {
		const pending = makePending()
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await connectAndPick(c)
		expect(mockOnDisconnect).not.toHaveBeenCalled() // subscribes only after confirm
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
		await connectAndPick(c)
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
						{ alias: "Main", item: { toString: () => ADDR_A } },
						{ alias: "Saver", item: ADDR_B },
					],
				},
			],
		})
		expect(out).toEqual([
			{ address: ADDR_A, alias: "Main" },
			{ address: ADDR_B, alias: "Saver" },
		])
	})
})

describe("switch gating during operations (D-18 wiring: session gate reads useOpsInFlight)", () => {
	beforeEach(() => {
		localStorage.clear()
		__resetWalletConnectionForTests()
		__resetOpsInFlightForTests()
	})

	it("selectAccount rejects while a tracked operation span is open, succeeds after it closes", async () => {
		const wallet = makeWallet([
			{ alias: "Main", item: ADDR_MAIN },
			{ alias: "Saver", item: ADDR_B },
		])
		const pending = makePending({ confirmReturns: wallet })
		mockEstablishSecureChannel.mockResolvedValue(pending)
		const c = useWalletConnection()
		await connectAndPick(c)
		await c.confirmVerification()
		expect(c.status.value).toBe("choosing-account")
		await c.confirmAccountChoice(ADDR_MAIN)
		expect(c.status.value).toBe("connected")

		let release: () => void = () => {}
		const span = withOperation(() => new Promise<void>((res) => (release = res)))
		expect(c.selectAccount(ADDR_B)).toBe(false) // blocked mid-operation, at the session boundary
		expect(c.selectedAccount.value).toBe(ADDR_MAIN)
		release()
		await span
		expect(c.selectAccount(ADDR_B)).toBe(true)
		expect(c.selectedAccount.value).toBe(ADDR_B)
	})
})

describe("selection-notice toasts (D-25/D-29: single module-level owner, exactly once)", () => {
	beforeEach(() => {
		localStorage.clear()
		__resetWalletConnectionForTests()
		__resetToastsForTests()
	})

	it("auto-remembered and truncation notices each toast exactly once and drain the queue", async () => {
		const c = useWalletConnection()
		const { toasts } = useToast()
		c.accounts.value = [
			{ address: ADDR_MAIN, alias: "Main" },
			{ address: ADDR_B, alias: "Saver" },
		]
		c.selectionNotices.value = [
			{ key: 0, kind: "auto-remembered", alias: "Main", address: ADDR_MAIN },
			{ key: 1, kind: "grant-truncated", hiddenCount: 4 },
		]
		await nextTick()
		expect(toasts.value.map((t) => t.text)).toEqual([
			"Using account Main",
			"Your wallet granted more accounts than the app can show — using the first 2 (4 hidden).",
		])
		expect(c.selectionNotices.value).toEqual([]) // drained by the single owner

		// The drain itself must not re-fire (empty-list retrigger is a no-op).
		await nextTick()
		expect(toasts.value).toHaveLength(2)
	})
})
