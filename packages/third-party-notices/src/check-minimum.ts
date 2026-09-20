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

const TARGET_DIRS = { chrome: ["chrome"], firefox: ["firefox"], both: ["chrome", "firefox"] } as const

/**
 * The build directories a CI target produced, under `distRoot`.
 * @throws on any other target, so a new or misspelt one can never assert nothing.
 */
export function buildDirsFor(target: string, distRoot: string): string[] {
	if (!Object.hasOwn(TARGET_DIRS, target)) throw new Error(`unknown build target "${target}"`)
	return TARGET_DIRS[target as keyof typeof TARGET_DIRS].map((dir) => `${distRoot}/${dir}`)
}
