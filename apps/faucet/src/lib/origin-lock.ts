/**
 * Origin-wide exclusive lock for value-moving critical sections (journal-ux plan L8).
 *
 * The journal engine's `withRecordLock` is a tab-local Set — it cannot stop a second TAB from
 * resuming the same record. `navigator.locks` is origin-wide: every tab of the faucet contends
 * on the same name. FAIL-CLOSED: when the API is unavailable (ancient browser, non-secure
 * context) the caller must refuse the operation rather than run unguarded — a resume is never
 * worth a potential double deposit.
 */
export interface OriginLockApi {
	request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T>): Promise<T>
}

export async function withOriginLock<T>(
	name: string,
	fn: () => Promise<T>,
	locksApi: OriginLockApi | undefined = (globalThis.navigator as Navigator | undefined)?.locks as OriginLockApi | undefined,
): Promise<T> {
	if (!locksApi || typeof locksApi.request !== "function") {
		throw new Error("Cross-tab locking is unavailable in this browser - refusing the operation (fail-closed).")
	}
	return await locksApi.request(name, { mode: "exclusive" }, fn)
}
