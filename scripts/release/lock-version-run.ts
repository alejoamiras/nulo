/**
 * Writes a Release PR's extension version into the `bun.lock` on its branch. The write goes through
 * the Contents API with the release App's token, so GitHub signs the commit (main requires signed
 * commits) and the push re-runs the PR's CI. Run by `_release-pr-lockfile.yml`, which nothing waits
 * on: a failure here never holds a release.
 */

import { EXTENSION_PACKAGE_JSON, LOCKFILE, lockWithVersion, packageVersion, releaseBranch } from "./lock-version"

export interface LockIO {
	/** The branch's head commit, so both files are read from one snapshot. */
	head(branch: string): Promise<string>
	/** A file's text and blob sha at a commit. */
	read(path: string, commit: string): Promise<{ text: string; sha: string }>
	/** Commits `text` to `path` on `branch`, replacing the blob `replacing`. */
	write(path: string, branch: string, text: string, replacing: string, message: string): Promise<void>
	log(message: string): void
}

export async function runLockVersion(prJson: string, io: LockIO): Promise<0 | 1> {
	const branch = releaseBranch(prJson)
	if (!branch.ok) return fail(io, branch.reason)
	const commit = await io.head(branch.value)
	const version = packageVersion((await io.read(EXTENSION_PACKAGE_JSON, commit)).text)
	if (!version.ok) return fail(io, version.reason)
	const lock = await io.read(LOCKFILE, commit)
	const next = lockWithVersion(lock.text, version.value)
	if (!next.ok) return fail(io, next.reason)
	if (next.value === null) {
		io.log(`${LOCKFILE} on ${branch.value} already records ${version.value}`)
		return 0
	}
	await io.write(LOCKFILE, branch.value, next.value, lock.sha, `chore: record ${version.value} in ${LOCKFILE}`)
	io.log(`${LOCKFILE} on ${branch.value} now records ${version.value}`)
	return 0
}

function fail(io: LockIO, reason: string): 1 {
	io.log(`::error::${reason}`)
	return 1
}

if (import.meta.main) {
	const api = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY ?? ""}`
	const token = process.env.GH_TOKEN ?? ""
	const call = async (path: string, accept: string, init: RequestInit = {}): Promise<Response> => {
		const res = await fetch(`${api}/${path}`, {
			...init,
			headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28" },
			signal: AbortSignal.timeout(60_000),
		})
		if (!res.ok) {
			const detail = ((await res.json().catch(() => null)) as { message?: unknown } | null)?.message
			throw new Error(
				`${init.method ?? "GET"} ${path.split("?")[0]}: HTTP ${res.status}${typeof detail === "string" ? `: ${detail}` : ""}`,
			)
		}
		return res
	}
	const json = "application/vnd.github+json"
	const io: LockIO = {
		async head(branch) {
			const { object } = (await (await call(`git/ref/heads/${encodeURIComponent(branch)}`, json)).json()) as {
				object: { sha: string }
			}
			return object.sha
		},
		async read(path, commit) {
			const { sha } = (await (await call(`contents/${path}?ref=${commit}`, "application/vnd.github.object+json")).json()) as {
				sha: string
			}
			// The blob by its sha, so text and sha cannot disagree; the raw form has no 1 MB ceiling.
			return { text: await (await call(`git/blobs/${sha}`, "application/vnd.github.raw+json")).text(), sha }
		},
		async write(path, branch, text, replacing, message) {
			const body = JSON.stringify({ message, content: Buffer.from(text).toString("base64"), sha: replacing, branch })
			await call(`contents/${path}`, json, { method: "PUT", body })
		},
		log: (message) => console.log(message),
	}
	try {
		process.exit(await runLockVersion(process.env.PR_JSON ?? "", io))
	} catch (e) {
		console.log(`::error::${e instanceof Error ? e.message : "unexpected failure"}`)
		process.exit(1)
	}
}
