/**
 * Helpers for mutating the dApp session record directly in chrome.storage.local.
 *
 * EntityStorage backs sessions at keys `nulo:core:dappSessions@<id>`, JSON-encoded.
 * Test driver (Puppeteer) opens the popup page and runs `chrome.storage.local`
 * calls there — no debug RPC added to the extension. The next dapp-interaction
 * service call re-reads via `tryGetDappSession` (service.ts:272), so the mutation
 * is observed without needing a SW restart.
 *
 * Used by tests that need an "elevated confirmationLevel" session (so non-sendTx
 * methods open the execute popup instead of going silent).
 */
import type { ExtensionContext } from "./extension"
import { openPopup } from "./extension"

export const SESSION_KEY_PREFIX = "nulo:core:dappSessions@"

/** AccessLevel enum values (mirrored from packages/wallet-bridge/src/session-types.ts). */
export const AccessLevel = {
	None: 0,
	AppState: 1,
	PublicData: 2,
	PxeState: 3,
	PrivateData: 4,
	Transactions: 5,
} as const

export type AccessLevelValue = (typeof AccessLevel)[keyof typeof AccessLevel]

/** Scan all session keys, return the id whose dappMetadata.url starts with origin. */
export async function getSessionIdForOrigin(ctx: ExtensionContext, origin: string): Promise<string> {
	const page = await openPopup(ctx)
	try {
		const id = await page.evaluate(
			async ({ originPrefix, prefix }: { originPrefix: string; prefix: string }) => {
				const all = await chrome.storage.local.get(null)
				for (const [key, value] of Object.entries(all)) {
					if (!key.startsWith(prefix)) continue
					try {
						const session = JSON.parse(value as string)
						if (typeof session?.dappMetadata?.url === "string" && session.dappMetadata.url.startsWith(originPrefix)) {
							return key.slice(prefix.length)
						}
					} catch {
						// not a JSON session record
					}
				}
				throw new Error(`No dApp session found for origin ${originPrefix}`)
			},
			{ originPrefix: origin, prefix: SESSION_KEY_PREFIX },
		)
		return id
	} finally {
		await page.close()
	}
}

/** Mutate `confirmationLevel` on a dApp session record. */
export async function setConfirmationLevel(ctx: ExtensionContext, sessionId: string, level: AccessLevelValue): Promise<void> {
	const page = await openPopup(ctx)
	try {
		await page.evaluate(
			async ({ key, level }: { key: string; level: number }) => {
				const result = await chrome.storage.local.get(key)
				const raw = result[key]
				if (typeof raw !== "string") throw new Error(`No session record at ${key}`)
				const session = JSON.parse(raw)
				session.confirmationLevel = level
				await chrome.storage.local.set({ [key]: JSON.stringify(session) })
			},
			{ key: `${SESSION_KEY_PREFIX}${sessionId}`, level: level as number },
		)
	} finally {
		await page.close()
	}
}
