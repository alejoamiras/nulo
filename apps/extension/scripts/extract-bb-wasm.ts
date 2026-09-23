/**
 * Extract barretenberg WASM bytes from the installed `@aztec/bb.js` package
 * for build-time copy into `dist/<browser>/assets/`.
 *
 * Why: bb.js@4.2.0 ships its WASM in two forms — a standalone `.wasm.gz`
 * (under `dest/node/...`) and a JS module with the bytes inlined as a
 * base64-gzip data URI (under `dest/browser/.../fetch_code/browser/`).
 * The Nulo extension runs bb.js inside the MV3 service worker via a
 * custom shim (`src/shims/bb-fetch-code.ts`) that does `fetch()` against
 * `/assets/barretenberg{,-threads}.wasm.gz` — so the build needs to
 * place those two files in `dist/<browser>/assets/`.
 *
 * **Threads variant**: copy `dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz`
 * directly. Verified byte-identical to the threads data-URI payload in
 * the browser-inlined JS module at the time of writing.
 *
 * **Singlethreaded variant**: parse the data URI from
 * `dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js`,
 * base64-decode (the bytes are already gzip-encoded — DON'T gunzip+regzip),
 * and write to disk.
 *
 * **Hash assertion**: byte-compare the threads node `.wasm.gz` against
 * the threads browser data URI payload. If they ever diverge upstream,
 * fail the build loud — that means we can no longer trust the simpler
 * "use the node variant" path for the threads file, and the build needs
 * to switch to extracting both variants from the inlined JS.
 */

import { readFileSync } from "node:fs"
import { resolvePackageAsset } from "@nulo/resolve-asset"

const DATA_URI_RE = /"data:application\/gzip;base64,([A-Za-z0-9+/=]+)"/

/** Locate a file inside `@aztec/bb.js` (a declared dependency of this
 *  workspace), layout-agnostically — see @nulo/resolve-asset. */
export function resolveBbFile(file: string): string {
	return resolvePackageAsset("@aztec/bb.js", file, { from: import.meta.url })
}

/** Read the threads variant from npm's `dest/node/...` tree. Already a
 *  gzip-encoded WASM blob — return the raw bytes. */
export function readThreadsWasmGz(): Uint8Array {
	return readFileSync(resolveBbFile("dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz"))
}

/** Extract gzip-encoded WASM bytes from a bb.js inlined JS module
 *  (`dest/browser/.../fetch_code/browser/{barretenberg,barretenberg-threads}.js`).
 *  These modules look like:
 *    const barretenberg = "data:application/gzip;base64,H4sI...===";
 *    export default barretenberg;
 *  The base64 payload is the gzip bytes — return them, don't decompress. */
export function extractWasmGzFromInlinedJs(jsPath: string): Uint8Array {
	const source = readFileSync(jsPath, "utf8")
	const match = DATA_URI_RE.exec(source)
	if (!match) {
		throw new Error(
			`Could not find data:application/gzip;base64,... in ${jsPath}. ` +
				"@aztec/bb.js may have changed its inlined-WASM format; update extract-bb-wasm.ts.",
		)
	}
	return Uint8Array.from(Buffer.from(match[1]!, "base64"))
}

/** Extract the singlethreaded variant from the inlined browser JS module. */
export function readSingleWasmGz(): Uint8Array {
	return extractWasmGzFromInlinedJs(resolveBbFile("dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg.js"))
}

/** Extract the threaded variant from the inlined browser JS module
 *  (used by the hash-assertion sibling check). */
export function readThreadsWasmGzFromInlinedJs(): Uint8Array {
	return extractWasmGzFromInlinedJs(resolveBbFile("dest/browser/barretenberg_wasm/fetch_code/browser/barretenberg-threads.js"))
}

/** Convenience tuple consumed by the vite plugin: the two WASM payloads
 *  + a precomputed assertion that the threads source we used (the node
 *  `.wasm.gz`) matches what the browser inlined JS would unpack to.
 *  Throws if the assertion fails. */
export function extractBbWasm(): { single: Uint8Array; threads: Uint8Array } {
	const single = readSingleWasmGz()
	const threads = readThreadsWasmGz()
	const threadsFromInlined = readThreadsWasmGzFromInlinedJs()

	if (threads.length !== threadsFromInlined.length || !threads.every((b, i) => b === threadsFromInlined[i])) {
		throw new Error(
			"Hash divergence: @aztec/bb.js's threaded WASM differs between " +
				"`dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz` and the " +
				"data-URI payload in `dest/browser/.../fetch_code/browser/barretenberg-threads.js`. " +
				"This was identical at the time of writing — divergence means upstream split " +
				"the two builds. Update extract-bb-wasm.ts to read the threaded variant from " +
				"the inlined JS instead.",
		)
	}

	return { single, threads }
}
