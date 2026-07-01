/**
 * Migration-aware facade over `chrome.storage.local` — the ONLY way UI code
 * (popup / onboarding / stores / composables) may touch local storage.
 *
 * Why: the boot migrator transforms persisted records under a durable
 * `nulo:schema:running` marker. UI pages are separate JS contexts that don't
 * share the service worker's in-memory state, so without a barrier a page
 * opened mid-migration could read a pre-migration row and write it back,
 * corrupting the transform. Every accessor here waits for the marker to clear
 * before touching data. Enforced by `storage-facade-ban.test.ts` (scans for
 * raw `chrome.storage.local` outside this file + the composition-root adapter).
 *
 * Deliberately NO timeout: proceeding while a migration is mid-flight is the
 * corruption we're preventing. If the SW died mid-migration the marker stays
 * set until the next boot resumes + clears it; the shell shows "Updating…"
 * (see `MigrationBarrier.vue`) rather than silently racing.
 */
import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"

/** Resolves once no migration is running. Fast path: one read, no listener. */
export async function migrationIdle(): Promise<void> {
	const flag = await chrome.storage.local.get(SCHEMA_RUNNING_KEY)
	if (!(SCHEMA_RUNNING_KEY in flag)) return
	await new Promise<void>((resolve) => {
		const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
			if (area !== "local" || !(SCHEMA_RUNNING_KEY in changes)) return
			if (changes[SCHEMA_RUNNING_KEY].newValue === undefined) {
				chrome.storage.onChanged.removeListener(listener)
				resolve()
			}
		}
		chrome.storage.onChanged.addListener(listener)
		// Re-check after subscribing: the marker may have cleared between the
		// first read and the listener attach (classic check-then-subscribe race).
		void chrome.storage.local.get(SCHEMA_RUNNING_KEY).then((again) => {
			if (!(SCHEMA_RUNNING_KEY in again)) {
				chrome.storage.onChanged.removeListener(listener)
				resolve()
			}
		})
	})
}

export async function storageLocalGet(keys?: string | string[] | null): Promise<Record<string, unknown>> {
	await migrationIdle()
	return chrome.storage.local.get(keys ?? undefined)
}

export async function storageLocalSet(items: Record<string, unknown>): Promise<void> {
	await migrationIdle()
	return chrome.storage.local.set(items)
}

export async function storageLocalRemove(keys: string | string[]): Promise<void> {
	await migrationIdle()
	return chrome.storage.local.remove(keys)
}
