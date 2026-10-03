/**
 * release-please bumps `apps/extension/package.json` but cannot edit `bun.lock`: its JSON updater
 * runs `JSON.parse`, which refuses the lockfile's trailing commas. The lockfile then keeps the old
 * workspace version, and every `bun install` after a release rewrites it.
 */

export const LOCKFILE = "bun.lock"
export const EXTENSION_PACKAGE_JSON = "apps/extension/package.json"
const WORKSPACE = "apps/extension"

/** Every branch release-please opens starts so; nothing else is ever written to. */
export const RELEASE_BRANCH_PREFIX = "release-please--"

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
/** Bun writes a workspace entry as its path key, then `name`, then `version`. */
const ENTRY = /("apps\/extension": \{\s*"name": "[^"\n]*",\s*"version": ")([^"\n]*)(")/g

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string }

/** The head branch of release-please-action's `pr` output, refused unless release-please named it. */
export function releaseBranch(prJson: string): Verdict<string> {
	let branch: unknown
	try {
		branch = (JSON.parse(prJson) as { headBranchName?: unknown } | null)?.headBranchName
	} catch {
		return { ok: false, reason: "release-please's pr output is not JSON" }
	}
	if (typeof branch !== "string" || !branch.startsWith(RELEASE_BRANCH_PREFIX)) {
		return { ok: false, reason: `refusing to write to ${JSON.stringify(branch ?? null)}: not a release-please branch` }
	}
	return { ok: true, value: branch }
}

/** The release version a package.json declares. */
export function packageVersion(packageJson: string): Verdict<string> {
	let version: unknown
	try {
		version = (JSON.parse(packageJson) as { version?: unknown } | null)?.version
	} catch {
		return { ok: false, reason: `${EXTENSION_PACKAGE_JSON} is not JSON` }
	}
	if (typeof version !== "string" || !RELEASE_VERSION.test(version)) {
		return { ok: false, reason: `${EXTENSION_PACKAGE_JSON} declares no release version` }
	}
	return { ok: true, value: version }
}

function workspaceVersion(lock: string): string | undefined {
	try {
		const parsed = Bun.JSONC.parse(lock) as { workspaces?: Record<string, { version?: unknown }> } | null
		const version = parsed?.workspaces?.[WORKSPACE]?.version
		return typeof version === "string" ? version : undefined
	} catch {
		return undefined
	}
}

/** `lock` with the extension workspace at `version` and every other byte kept; `null` when it already is. */
export function lockWithVersion(lock: string, version: string): Verdict<string | null> {
	if (!RELEASE_VERSION.test(version)) return { ok: false, reason: `${JSON.stringify(version)} is not a release version` }
	const recorded = workspaceVersion(lock)
	if (recorded === undefined) return { ok: false, reason: `${LOCKFILE} does not parse or records no "${WORKSPACE}" version` }
	const entries = [...lock.matchAll(ENTRY)]
	if (entries.length !== 1 || entries[0]?.[2] !== recorded) {
		return { ok: false, reason: `${LOCKFILE}'s "${WORKSPACE}" entry is not laid out as name, then version` }
	}
	if (recorded === version) return { ok: true, value: null }
	const next = lock.replace(ENTRY, (_entry, head: string, _old: string, tail: string) => `${head}${version}${tail}`)
	if (workspaceVersion(next) !== version) return { ok: false, reason: `the edit did not reach the "${WORKSPACE}" entry` }
	return { ok: true, value: next }
}
