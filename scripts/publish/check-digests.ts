#!/usr/bin/env bun
/**
 * Binds a publication to rehearsed bytes: `bun scripts/publish/check-digests.ts <version> <tgz-dir>`.
 *
 * A version listed in `approved-digests.json` must pack exactly the listed tarballs, byte for byte.
 * The first publication must be listed: it is the one the rehearsal proved against its real
 * consumer. Later versions rely on the staged tests, the environment approval and the provenance
 * attestation, so an unlisted later version passes with a note.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const FIRST_VERSION = "0.1.0"
const APPROVED_FILE = join(import.meta.dir, "approved-digests.json")

export type ApprovedDigests = Record<string, Record<string, string>>

export interface Tarball {
	name: string
	sha256: string
}

export interface DigestCheck {
	ok: boolean
	failures: string[]
	notes: string[]
}

export function checkDigests(version: string, approved: ApprovedDigests, tarballs: Tarball[]): DigestCheck {
	const listed = approved[version]
	if (listed === undefined) {
		return version === FIRST_VERSION
			? { ok: false, failures: [`${version} is the first publication and has no entry in approved-digests.json`], notes: [] }
			: { ok: true, failures: [], notes: [`${version} has no approved digests; only ${FIRST_VERSION} is bound to rehearsed bytes`] }
	}
	const failures: string[] = []
	const packed = new Map(tarballs.map((t) => [t.name, t.sha256]))
	for (const [name, sha256] of Object.entries(listed)) {
		const actual = packed.get(name)
		if (actual === undefined) failures.push(`${name}: approved but not packed`)
		else if (actual !== sha256) failures.push(`${name}: sha256 ${actual}, approved ${sha256}`)
	}
	for (const name of packed.keys()) {
		if (!(name in listed)) failures.push(`${name}: packed but not approved`)
	}
	return { ok: failures.length === 0, failures, notes: [] }
}

if (import.meta.main) {
	const [version = "", dir = ""] = process.argv.slice(2)
	if (version === "" || dir === "") throw new Error("usage: bun scripts/publish/check-digests.ts <version> <tgz-dir>")
	const approved = JSON.parse(readFileSync(APPROVED_FILE, "utf8")) as ApprovedDigests
	const tarballs = readdirSync(dir)
		.filter((f) => f.endsWith(".tgz"))
		.sort()
		.map((name) => ({ name, sha256: new Bun.CryptoHasher("sha256").update(readFileSync(join(dir, name))).digest("hex") }))
	const result = checkDigests(version, approved, tarballs)
	for (const { name, sha256 } of tarballs) console.log(`${sha256}  ${name}`)
	for (const note of result.notes) console.log(note)
	for (const failure of result.failures) console.error(`::error::${failure}`)
	process.exit(result.ok ? 0 : 1)
}
