/**
 * Holdings / picker search. Literal, case-insensitive substring on symbol and name, prefix on the
 * contract when the query looks like an address. No RegExp, no sanitizer — a symbol may contain
 * any punctuation and the query never leaves the popup.
 */
export function matchesQuery(t: { symbol: string; name: string; contract: string }, query: string): boolean {
	const q = query.trim().toLowerCase()
	if (q === "") return true
	if (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) return true
	return q.startsWith("0x") && t.contract.toLowerCase().startsWith(q)
}
