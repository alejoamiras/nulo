import type { StorageArea } from "@nulo/wallet-core/ports"

/**
 * Shared test-only helper: records `set` and `remove` calls on `area` whose key starts with
 * `prefix`, in call order, as `set:<key>` and `remove:<key>`. `afterSet` runs once a matching set
 * has resolved and before its caller resumes, which is where a test lands a racing deletion.
 * Imported only by test files, like `composition-harness.ts`.
 */
export function recordWrites(area: StorageArea, prefix: string, afterSet?: (key: string) => void): { log: string[]; restore: () => void } {
	const log: string[] = []
	const set = area.set.bind(area)
	const remove = area.remove.bind(area)
	area.set = async (entries) => {
		await set(entries)
		for (const key of Object.keys(entries)) {
			if (!key.startsWith(prefix)) continue
			log.push(`set:${key}`)
			afterSet?.(key)
		}
	}
	area.remove = async (keys) => {
		for (const key of typeof keys === "string" ? [keys] : keys) {
			if (key.startsWith(prefix)) log.push(`remove:${key}`)
		}
		await remove(keys)
	}
	return {
		log,
		restore: () => {
			area.set = set
			area.remove = remove
		},
	}
}
