/**
 * Writes a Release PR's extension version into the `bun.lock` on its branch. The commit is made with
 * the release App's token through `createCommitOnBranch`, so GitHub signs it (main requires signed
 * commits), its push re-runs the PR's CI, and it lands only on the head both files were read from.
 * Run by `_release-pr-lockfile.yml`, which nothing waits on: a failure here never holds a release.
 */

import { EXTENSION_PACKAGE_JSON, LOCKFILE, lockWithVersion, packageVersion, releaseBranch } from "./lock-version"

export interface LockIO {
	head(branch: string): Promise<string>
	/** A file's text at a commit. */
	read(path: string, commit: string): Promise<string>
	/** Commits `text` to `path` only while `branch` still points at `expectedHead`; false when it moved. */
	commit(branch: string, expectedHead: string, path: string, text: string, message: string): Promise<boolean>
	log(message: string): void
}

/** Reads of a branch that keeps moving under the write, before giving up. */
export const ATTEMPTS = 3

export async function runLockVersion(prJson: string, io: LockIO): Promise<0 | 1> {
	const branch = releaseBranch(prJson)
	if (!branch.ok) return fail(io, branch.reason)
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		const head = await io.head(branch.value)
		const version = packageVersion(await io.read(EXTENSION_PACKAGE_JSON, head))
		if (!version.ok) return fail(io, version.reason)
		const next = lockWithVersion(await io.read(LOCKFILE, head), version.value)
		if (!next.ok) return fail(io, next.reason)
		if (next.value === null) {
			io.log(`${LOCKFILE} on ${branch.value} already records ${version.value}`)
			return 0
		}
		if (await io.commit(branch.value, head, LOCKFILE, next.value, `chore: record ${version.value} in ${LOCKFILE}`)) {
			io.log(`${LOCKFILE} on ${branch.value} now records ${version.value}`)
			return 0
		}
		io.log(`${branch.value} moved during the write; reading it again`)
	}
	return fail(io, `${branch.value} kept moving: ${LOCKFILE} not written in ${ATTEMPTS} attempts`)
}

function fail(io: LockIO, reason: string): 1 {
	io.log(`::error::${reason}`)
	return 1
}

if (import.meta.main) {
	const repo = process.env.GITHUB_REPOSITORY ?? ""
	const token = process.env.GH_TOKEN ?? ""
	const call = async (path: string, accept: string, init: RequestInit = {}): Promise<Response> => {
		const res = await fetch(`https://api.github.com/${path}`, {
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
			const ref = (await (await call(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, json)).json()) as {
				object: { sha: string }
			}
			return ref.object.sha
		},
		async read(path, commit) {
			return (await call(`repos/${repo}/contents/${path}?ref=${commit}`, "application/vnd.github.raw+json")).text()
		},
		async commit(branch, expectedHead, path, text, message) {
			const query = "mutation ($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }"
			const input = {
				branch: { repositoryNameWithOwner: repo, branchName: branch },
				expectedHeadOid: expectedHead,
				message: { headline: message },
				fileChanges: { additions: [{ path, contents: Buffer.from(text).toString("base64") }] },
			}
			const res = await call("graphql", json, { method: "POST", body: JSON.stringify({ query, variables: { input } }) })
			const { data, errors } = (await res.json()) as {
				data?: { createCommitOnBranch?: { commit?: { oid?: string } } } | null
				errors?: { type?: string; message?: string }[]
			}
			if (data?.createCommitOnBranch?.commit?.oid) return true
			// GraphQL reports a moved head inside a 200; any other error is a real failure.
			if (errors?.some((e) => e.type === "STALE_DATA" || /expected branch to point to/i.test(e.message ?? ""))) return false
			throw new Error(`createCommitOnBranch: ${errors?.map((e) => e.message).join("; ") || "no commit returned"}`)
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
