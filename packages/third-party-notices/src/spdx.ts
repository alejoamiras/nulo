/** A parsed SPDX licence expression. `WITH` exceptions are kept inside the id, so they never match an allowlist entry. */
export type SpdxNode =
	| { kind: "id"; id: string }
	| { kind: "and"; left: SpdxNode; right: SpdxNode }
	| { kind: "or"; left: SpdxNode; right: SpdxNode }

const TOKEN = /\s*(\(|\)|[A-Za-z0-9.+-]+)/y

function tokenize(expression: string): string[] {
	const tokens: string[] = []
	TOKEN.lastIndex = 0
	while (TOKEN.lastIndex < expression.length) {
		const at = TOKEN.lastIndex
		const match = TOKEN.exec(expression)
		if (!match?.[1]) {
			if (expression.slice(at).trim() === "") break
			throw new Error(`unparseable SPDX expression "${expression}"`)
		}
		tokens.push(match[1])
	}
	return tokens
}

/**
 * Parses an SPDX expression. `AND` binds tighter than `OR`, as the SPDX specification orders them.
 * @throws on anything that is not a well-formed expression, so a malformed field is never read as permissive.
 */
export function parseSpdx(expression: string): SpdxNode {
	const tokens = tokenize(expression)
	let at = 0

	const fail = (): never => {
		throw new Error(`unparseable SPDX expression "${expression}"`)
	}
	const isOperator = (token: string | undefined) => token === "AND" || token === "OR" || token === "WITH"

	function atom(): SpdxNode {
		const token = tokens[at++]
		if (token === undefined || token === ")" || isOperator(token)) return fail()
		if (token === "(") {
			const inner = or()
			if (tokens[at++] !== ")") return fail()
			return inner
		}
		if (tokens[at] !== "WITH") return { kind: "id", id: token }
		const exception = tokens[at + 1]
		if (exception === undefined || exception === "(" || exception === ")" || isOperator(exception)) return fail()
		at += 2
		return { kind: "id", id: `${token} WITH ${exception}` }
	}
	function and(): SpdxNode {
		let left = atom()
		while (tokens[at] === "AND") {
			at++
			left = { kind: "and", left, right: atom() }
		}
		return left
	}
	function or(): SpdxNode {
		let left = and()
		while (tokens[at] === "OR") {
			at++
			left = { kind: "or", left, right: and() }
		}
		return left
	}

	const tree = or()
	if (at !== tokens.length) return fail()
	return tree
}

/** `OR` is satisfied by any allowed branch, `AND` only by every branch being allowed. */
export function isSpdxAllowed(node: SpdxNode, allowed: ReadonlySet<string>): boolean {
	if (node.kind === "id") return allowed.has(node.id)
	const left = isSpdxAllowed(node.left, allowed)
	const right = isSpdxAllowed(node.right, allowed)
	return node.kind === "and" ? left && right : left || right
}
