import { noticeNames } from "./generate.ts"

/** Names from an expected-minimum list: one per line, `#` comments and blank lines ignored. */
export function parseMinimum(list: string): string[] {
	return list
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"))
}

/** Expected names the notices file does not list. */
export function missingFromNotices(notices: string, minimum: readonly string[]): string[] {
	const listed = noticeNames(notices)
	return minimum.filter((name) => !listed.has(name))
}
