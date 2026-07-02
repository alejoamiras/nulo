/**
 * Replacement for @aztec/bb.js fetchCode browser module.
 *
 * The original uses dynamic import() to load embedded WASM data URIs as a fallback
 * when wasmPath is not provided. Chrome MV3 service workers forbid import() at runtime.
 *
 * This shim replaces the import() fallback with a fetch() to the known WASM asset path.
 * The WASM files are emitted by the `bb-wasm-emit` vite plugin (see
 * `scripts/extract-bb-wasm.ts`) into `dist/<browser>/assets/` from the installed
 * `@aztec/bb.js` package — so bumping the npm dep auto-updates them.
 */
// @ts-expect-error — pako has no types in this context
import pako from "pako"

const DEFAULT_BASE_PATH = "/assets/barretenberg.wasm.gz"

export async function fetchCode(multithreaded: boolean, wasmPath?: string): Promise<ArrayBuffer> {
	const url = resolveWasmUrl(multithreaded, wasmPath ?? DEFAULT_BASE_PATH)
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`bb-fetch-code: ${url} → HTTP ${res.status} ${res.statusText}`)
	}
	const maybeCompressedData = await res.arrayBuffer()
	const buffer = new Uint8Array(maybeCompressedData)

	const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[2] === 0x08
	if (isGzip) {
		return pako.ungzip(buffer).buffer
	}
	return buffer.buffer
}

/**
 * Build the URL for the requested variant. Caller passes the **single-threaded**
 * base path (e.g. `/assets/barretenberg.wasm.gz`); we synthesize the threaded
 * sibling by inserting `-threads` into the filename when needed.
 *
 * Branches on `multithreaded` rather than blindly mangling the path so callers
 * passing `barretenberg-threads.wasm.gz` directly don't end up with
 * `barretenberg-threads-threads.wasm.gz`.
 */
function resolveWasmUrl(multithreaded: boolean, basePath: string): string {
	if (!multithreaded) return basePath

	// Strip a trailing `-threads` (in case caller is already pointing at the
	// threaded variant) so we always synthesize from the single-threaded base.
	const threadsSuffix = "-threads"
	const lastSlash = basePath.lastIndexOf("/")
	const dir = lastSlash >= 0 ? basePath.slice(0, lastSlash + 1) : ""
	const filename = lastSlash >= 0 ? basePath.slice(lastSlash + 1) : basePath
	const dotIdx = filename.indexOf(".")
	const stem = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename
	const ext = dotIdx >= 0 ? filename.slice(dotIdx) : ""
	const baseStem = stem.endsWith(threadsSuffix) ? stem.slice(0, -threadsSuffix.length) : stem
	return `${dir}${baseStem}${threadsSuffix}${ext}`
}
