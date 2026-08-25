/**
 * Popup-side service-client registry.
 *
 * Historically this was `core.js` with module-eval side effects — importing
 * it opened `ProfileServiceClient` + `ContactServiceClient` ports eagerly,
 * which made the module impossible to import in tests without a live SW and
 * caused phantom ports when multiple popup surfaces loaded the bundle.
 *
 * The public shape (`managers`, `isBackgroundConnected`, `initTransactionService`,
 * `refreshBalances`) is preserved — every existing consumer keeps working
 * unchanged. Under the hood:
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

/** Reactive: true when the long-lived port to the service worker is open. */
export const isBackgroundConnected = ref(false)

/**
 * Service-client container. `profile` and `contact` are populated eagerly by
 * `initAppServiceContext()` (called at popup boot). `network`, `transaction`,
 * `account` are LAZY: `null` until the popup's unlock flow assigns them (after
 * `bootstrapActiveProfile()` resolves the active profile/network/account).
 *
 * The lazy three are typed `| null` (honest) — a bare `managers.network` read is
 * `NetworkServiceClient | null`, so an unchecked `.foo()` is a compile error IN
 * `.ts` CONSUMERS. (`vue-tsc` does NOT strict-null-check `.vue` `<script setup>`,
 * so `.vue` reads are NOT compiler-guarded today — use the accessors there by
 * convention; closing that `.vue` gap is a separate infra task.) Use
 * {@link requireNetwork}/{@link requireTransaction}/{@link requireAccount} (throw
 * if unset) for method calls in unlock-guarded code, or {@link getNetwork}/
 * {@link getTransaction}/{@link getAccount} (`| null`) where the unset case is
 * tolerated. Runtime is unchanged: the slots hold `null` before assignment exactly
 * as the prior `null as unknown as Client` lie did.
 */
export interface AppServices {
	profile: ProfileServiceClient
	network: NetworkServiceClient | null
	transaction: TransactionServiceClient | null
	account: AccountServiceClient | null
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

	// `network`, `transaction`, `account` remain `null` until the popup's unlock
	// flow sets them (see AppServices jsdoc + the require*/get* accessors).
	return {
		profile: profileService,
		network: null,
		transaction: null,
		account: null,
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

/**
 * The lazy clients, asserted non-null. Throw a clear error if read before the
 * popup's unlock flow assigned them — this REPLACES the prior silent `null.foo()`
 * TypeError; in unlock-guarded code (auth routes, post-`bootstrapActiveProfile`)
 * the client is always set, so the throw never fires there.
 */
export function requireNetwork(): NetworkServiceClient {
	const client = managers.network
	if (!client) throw new Error("network service not initialized (read before unlock)")
	return client
}
export function requireTransaction(): TransactionServiceClient {
	const client = managers.transaction
	if (!client) throw new Error("transaction service not initialized (read before unlock)")
	return client
}
export function requireAccount(): AccountServiceClient {
	const client = managers.account
	if (!client) throw new Error("account service not initialized (read before unlock)")
	return client
}

/** The lazy clients or `null` — for sites that tolerate the unset case (e.g.
 *  `getNetwork()?.disconnect()` before reassigning). */
export const getNetwork = (): NetworkServiceClient | null => managers.network
export const getTransaction = (): TransactionServiceClient | null => managers.transaction
export const getAccount = (): AccountServiceClient | null => managers.account

export async function refreshBalances(_minutes: number | undefined, accounts: Array<{ address: string }>): Promise<void> {
	if (!accounts?.length) return

	const tokenBalanceService = new TokenBalanceServiceClient()
	try {
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

		// The refreshes must settle BEFORE the disconnect: tearing the port down with them
		// in flight rejected the client's own pending calls, so the refresh outcome was lost
		// (and surfaced only as unhandled rejections). allSettled so one failed token's
		// refresh doesn't cut short the others.
		const refreshes: Array<Promise<unknown>> = []
		for (const tb of tokenBalances) {
			if (checkAge(tb.updatedAt, 30)) refreshes.push(tokenBalanceService.refreshTokenBalance(tb.id as number))
		}
		for (const result of await Promise.allSettled(refreshes)) {
			if (result.status === "rejected") console.error(result.reason)
		}
	} finally {
		// A thrown balance read used to skip the disconnect entirely, leaking the connection.
		tokenBalanceService.disconnect()
	}
}

export function initTransactionService(onTransactionAdded: (tx: Tx) => void, onTransactionUpdated: (tx: Tx) => void): void {
	if (managers.transaction) managers.transaction.disconnect()
	const transactionService = new TransactionServiceClient()
	transactionService.onTransactionAdded.add(onTransactionAdded)
	transactionService.onTransactionUpdated.add(onTransactionUpdated)
	transactionService.connect()
	managers.transaction = transactionService
}
