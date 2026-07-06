/**
 * Popup-side service-client registry.
 *
 * Historically this was `core.js` with module-eval side effects — importing
 * it opened `ProfileServiceClient` + `ContactServiceClient` ports eagerly,
 * which made the module impossible to import in tests without a live SW and
 * caused phantom ports when multiple popup surfaces loaded the bundle.
 *
 * The public shape (`managers`, `isBackgroundConnected`, `initTransactionService`,
 * `refreshBalances`, `setSentinel`, `checkSentinel`) is preserved — every
 * existing consumer keeps working unchanged. Under the hood:
 *   1. `managers` is a Proxy; client construction is deferred until first
 *      access (or until `initAppServiceContext()` is called explicitly).
 *   2. `initAppServiceContext()` is the explicit boot hook. Called from
 *      `popup/index.ts` at startup to preserve the old eager-init timing.
 *
 * Tests that import `@/utils/core` without calling `initAppServiceContext()`
 * and without touching `managers` pay nothing. Tests that want the real
 * clients can still call the init explicitly.
 */

import type { AccountServiceClient } from "@/wallet/services/account/client"
import { ContactServiceClient } from "@/wallet/services/contact/client"
import type { NetworkServiceClient } from "@/wallet/services/network/client"
import { ProfileServiceClient } from "@/wallet/services/profile/client"
import { TokenBalanceServiceClient } from "@/wallet/services/token-balance/client"
import type { Tx } from "@/wallet/services/transaction/spec"
import { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { storageLocalGet, storageLocalSet } from "@/utils/storage"

/** Reactive: true when the long-lived port to the service worker is open. */
export const isBackgroundConnected = ref(false)

/**
 * Service-client container. `profile` and `contact` are populated eagerly by
 * `initAppServiceContext()` (called at popup boot). `network`, `transaction`,
 * `account` start uninitialized and are assigned by the popup once the user
 * has unlocked and we know the active profile/network/account.
 *
 * Typed as always-populated to match the previous `.js` behavior; consumers
 * that access `managers.network` before the popup has assigned it get
 * undefined at runtime. This is a pre-existing contract, intentionally
 * unchanged in this commit — tightening it is deferred.
 */
export interface AppServices {
	profile: ProfileServiceClient
	network: NetworkServiceClient
	transaction: TransactionServiceClient
	account: AccountServiceClient
	contact: ContactServiceClient
}

let appServices: AppServices | undefined

function createAppServices(): AppServices {
	const onConnected = () => {
		isBackgroundConnected.value = true
	}
	const onDisconnected = () => {
		isBackgroundConnected.value = false
	}

	const profileService = new ProfileServiceClient()
	profileService.onConnected.add(onConnected)
	profileService.onDisconnected.add(onDisconnected)
	profileService.connect()

	const contactService = new ContactServiceClient()
	contactService.connect()

	// `network`, `transaction`, `account` remain unassigned until the popup's
	// unlock flow sets them. Typed as non-null to match previous .js shape;
	// see AppServices jsdoc.
	return {
		profile: profileService,
		network: null as unknown as NetworkServiceClient,
		transaction: null as unknown as TransactionServiceClient,
		account: null as unknown as AccountServiceClient,
		contact: contactService,
	}
}

/**
 * Eagerly create the profile + contact clients. Safe to call multiple times.
 * Call once at popup boot (see `popup/index.ts`) to match the old module-eval
 * init timing.
 */
export function initAppServiceContext(): AppServices {
	if (!appServices) appServices = createAppServices()
	return appServices
}

/**
 * Public handle. Lazily triggers `initAppServiceContext()` on first access,
 * so any consumer that reads `managers.profile` gets a live client even if
 * the boot hook wasn't called.
 */
export const managers: AppServices = new Proxy({} as AppServices, {
	get(_, prop: string | symbol) {
		const services = appServices ?? initAppServiceContext()
		return (services as unknown as Record<string | symbol, unknown>)[prop]
	},
	set(_, prop: string | symbol, value: unknown) {
		const services = appServices ?? initAppServiceContext()
		;(services as unknown as Record<string | symbol, unknown>)[prop] = value
		return true
	},
})

export async function refreshBalances(_minutes: number | undefined, accounts: Array<{ address: string }>): Promise<void> {
	if (!accounts?.length) return

	const tokenBalanceService = new TokenBalanceServiceClient()
	const tokenBalances: Array<{ id: number | string; updatedAt: number }> = []
	for (const acc of accounts) {
		tokenBalances.push(...(await tokenBalanceService.getTokenBalances(undefined, acc.address)))
	}

	function checkAge(updatedAt: number, minutes?: number): boolean {
		if (!minutes) return true
		const now = Date.now()
		const diff = now - updatedAt
		return diff >= minutes * 60 * 1_000
	}

	for (const tb of tokenBalances) {
		if (checkAge(tb.updatedAt, 30)) tokenBalanceService.refreshTokenBalance(tb.id as number)
	}

	tokenBalanceService.disconnect()
}

export function initTransactionService(onTransactionAdded: (tx: Tx) => void, onTransactionUpdated: (tx: Tx) => void): void {
	if (managers.transaction) managers.transaction.disconnect()
	const transactionService = new TransactionServiceClient()
	transactionService.onTransactionAdded.add(onTransactionAdded)
	transactionService.onTransactionUpdated.add(onTransactionUpdated)
	transactionService.connect()
	managers.transaction = transactionService
}

const sentinelPath = "nulo:ui:sentinel"

export async function setSentinel(): Promise<void> {
	await storageLocalSet({ [sentinelPath]: __SENTINEL__ })
}

export async function checkSentinel(): Promise<boolean> {
	return (await storageLocalGet(sentinelPath))[sentinelPath] === __SENTINEL__
}
