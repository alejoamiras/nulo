/**
 * The smallest free `Account ${n}` among `names`. The number cannot come from `account.index`:
 * indexes count per account type, names are global.
 */
export function nextAccountName(names: readonly string[]): string {
	let n = 1
	while (names.includes(`Account ${n}`)) n++
	return `Account ${n}`
}
