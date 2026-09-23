/** Rows under `prefix` from one whole-area read, as `[key, id, value]`: the full key for codecs
 *  that key their decode on it, the id being the key minus the prefix. */
export function prefixedEntries(all: Record<string, unknown>, prefix: string): Array<[key: string, id: string, value: unknown]> {
	const out: Array<[string, string, unknown]> = []
	for (const [k, v] of Object.entries(all)) {
		if (k.startsWith(prefix)) out.push([k, k.substring(prefix.length), v])
	}
	return out
}
