#!/usr/bin/env bun
/**
 * Zips a directory so that the same files give the same bytes on every run. `zip -r .` does not:
 * it takes entries in readdir order, stamps each with the file's mtime (which an artifact download
 * resets to the download time) and adds platform extra fields, so two builds of one commit hashed
 * differently and a republish churned SHASUMS256.txt. Here the entries are sorted, every file is
 * stamped with SOURCE_DATE_EPOCH, and zip runs with -X (no platform extra fields), -D (no
 * directory entries), an explicit compression level, TZ=UTC (DOS timestamps are local time),
 * LC_ALL=C and no ZIP/ZIPOPT in its environment (zip reads default options from both).
 *
 * Usage: SOURCE_DATE_EPOCH=<seconds> bun scripts/release/zip-reproducible.ts <source-dir> <out.zip>
 */

import { readdirSync, rmSync, utimesSync } from "node:fs"
import { join, resolve } from "node:path"

/** `-@` splits its input on newlines, and a name outside printable ASCII would depend on the locale. */
const SAFE_NAME = /^[\x20-\x7e]+$/
/** A listed `-` means stdin to zip, even through `-@`: the entry would be stored empty, exit status zero. */
const STDIN_NAME = "-"

/** Every regular file under `dir`, as a relative POSIX path, in code-unit order (a total order, locale-free). */
export function listFiles(dir: string, prefix = ""): string[] {
	const files: string[] = []
	for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name
		if (!SAFE_NAME.test(entry.name) || entry.name === STDIN_NAME) throw new Error(`${rel}: name outside printable ASCII, or "-"`)
		if (entry.isDirectory()) files.push(...listFiles(dir, rel))
		else if (entry.isFile()) files.push(rel)
		else throw new Error(`${rel}: not a regular file or directory`)
	}
	return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function zipReproducible(sourceDir: string, outZip: string, epochSeconds: number): string[] {
	if (!Number.isInteger(epochSeconds) || epochSeconds <= 0) throw new Error(`SOURCE_DATE_EPOCH must be a positive integer, got ${epochSeconds}`)
	const files = listFiles(sourceDir)
	if (files.length === 0) throw new Error(`${sourceDir}: nothing to zip`)
	for (const file of files) utimesSync(join(sourceDir, file), epochSeconds, epochSeconds)
	const out = resolve(outZip)
	rmSync(out, { force: true })
	const { ZIP: _zip, ZIPOPT: _zipopt, ...env } = process.env
	// -MM: every listed name must be added, so a name zip cannot read fails the run instead of thinning the archive.
	const zip = Bun.spawnSync(["zip", "-q", "-X", "-D", "-6", "-MM", "-@", out], {
		cwd: sourceDir,
		stdin: Buffer.from(`${files.join("\n")}\n`),
		env: { ...env, TZ: "UTC", LC_ALL: "C" },
	})
	if (zip.exitCode !== 0) throw new Error(`zip exited ${zip.exitCode}: ${zip.stderr.toString().trim()}`)
	return files
}

if (import.meta.main) {
	const [sourceDir, outZip] = process.argv.slice(2)
	const epoch = Number(process.env.SOURCE_DATE_EPOCH)
	if (!sourceDir || !outZip || !process.env.SOURCE_DATE_EPOCH) {
		console.error("usage: SOURCE_DATE_EPOCH=<seconds> bun scripts/release/zip-reproducible.ts <source-dir> <out.zip>")
		process.exit(2)
	}
	const files = zipReproducible(sourceDir, outZip, epoch)
	console.log(`${outZip}: ${files.length} files, entries stamped ${new Date(epoch * 1000).toISOString()}`)
}
